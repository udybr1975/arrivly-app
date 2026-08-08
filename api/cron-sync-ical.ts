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

// Shared fetch budget for the whole run, as an ABSOLUTE deadline handed to EVERY
// apartment — so the run is bounded no matter how the pool interleaves. A per-item
// duration could not express this: four items share one wall clock.
//
// THE ARITHMETIC (150s maxDuration). The deadline bounds when a fetch STARTS, not when it
// finishes, so a fetch begun 1ms before it still runs safeFetchIcal's full 10s cap. The
// up-to-4 workers overrun CONCURRENTLY, so that is +10s of wall clock, not +40s. The
// overrun is inside the budget, not on top of it:
//   - in-flight fetches overrunning the deadline (4 in parallel)                 => 10s
//   - those same up-to-4 apartments then finish their reconcile RPCs
//     (<=8 sources x ~2s, sequential per apartment, 4 concurrent)                => 16s
//   - the sequential per-host push loop                                          => 20s
//   - aggregation, JSON response, platform overhead                              =>  4s
// 150 - 50 = 100s. Apartments still QUEUED when the deadline passes cost almost nothing:
// every URL is unread, so every source is incomplete and no RPC is called at all.
const RUN_FETCH_BUDGET_MS = 100_000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startedAt = Date.now()

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const { data, error } = await supabase
    .from('apartments')
    .select('id, host_id, name, ical_urls')
    .not('ical_urls', 'is', null)
    .neq('ical_urls', '')
  if (error) return res.status(500).json({ error: 'Query failed' })

  const apartments = (data ?? []) as AptRow[]

  // Parallelise the per-apartment sync with a bounded pool (4 in flight). Each iCal fetch
  // is network-bound and already capped at 10s by safeFetchIcal, so up to 4 concurrent
  // shortens a many-apartment run without raising any per-fetch timeout — but concurrency
  // alone does NOT bound the run against the 150s maxDuration (vercel.json), because ONE
  // apartment can cost up to 20 URLs x 10s = 200s on its own. The shared deadline below is
  // what actually bounds it. Each task RETURNS its result; aggregation happens in a single
  // sequential pass below, so the shared Map/array are never mutated concurrently and the
  // totals/byHost output are identical to the sequential loop.
  const deadlineAt = startedAt + RUN_FETCH_BUDGET_MS
  const synced = await mapPool(apartments, 4, async (apt) => ({
    apt,
    result: await syncApartmentBookings(supabase, { id: apt.id, ical_urls: apt.ical_urls }, { deadlineAt }),
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
