import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'
import { sendPushToHost } from './_lib/push.js'
import { syncApartmentBookings } from './_lib/ical.js'
import { mapPool } from './_lib/pool.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface AptRow { id: string; host_id: string; name: string | null; ical_urls: string | null }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const { data, error } = await supabase
    .from('apartments')
    .select('id, host_id, name, ical_urls')
    .not('ical_urls', 'is', null)
    .neq('ical_urls', '')
  if (error) return res.status(500).json({ error: 'Query failed' })

  const apartments = (data ?? []) as AptRow[]

  // Parallelise the per-apartment sync with a bounded pool (4 in flight). Each iCal
  // fetch is network-bound and already capped at 10s by safeFetchIcal, so up to 4
  // concurrent keeps a many-apartment run inside the 60s maxDuration without raising
  // any per-fetch timeout. Each task RETURNS its result; aggregation happens in a
  // single sequential pass below, so the shared Map/array are never mutated
  // concurrently and the totals/byHost output are identical to the sequential loop.
  const synced = await mapPool(apartments, 4, async (apt) => ({
    apt,
    result: await syncApartmentBookings(supabase, { id: apt.id, ical_urls: apt.ical_urls }),
  }))

  const byHost = new Map<string, { count: number; names: Set<string> }>()
  let totalImported = 0
  const errors: string[] = []

  for (const { apt, result } of synced) {
    if (result.errors.length) errors.push(...result.errors.map((e) => `${apt.name ?? apt.id}: ${e}`))
    if (result.imported > 0) {
      totalImported += result.imported
      const entry = byHost.get(apt.host_id) ?? { count: 0, names: new Set<string>() }
      entry.count += result.imported
      if (apt.name) entry.names.add(apt.name)
      byHost.set(apt.host_id, entry)
    }
  }

  let pushed = 0
  for (const [hostId, info] of byHost) {
    const names = [...info.names]
    const scope =
      names.length === 1 ? ` for ${names[0]}` : names.length > 1 ? ` across ${names.length} properties` : ''
    const body =
      info.count === 1 ? `1 new booking synced${scope}.` : `${info.count} new bookings synced${scope}.`
    const summary = await sendPushToHost(supabase, hostId, {
      title: info.count === 1 ? 'New booking' : 'New bookings',
      body,
      url: '/dashboard/bookings',
    })
    if (summary.sent > 0) pushed++
  }

  return res.status(200).json({
    ok: true,
    apartments: apartments.length,
    imported: totalImported,
    hostsNotified: byHost.size,
    pushed,
    errors,
  })
}
