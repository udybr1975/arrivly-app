import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'
import { sendPushToHost } from './_lib/push.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface ApartmentRef { id: string; host_id: string; name: string | null }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const today = new Date().toISOString().slice(0, 10) // UTC date YYYY-MM-DD

  const { data, error } = await supabase
    .from('bookings')
    .select('apartment_id, source, apartments!inner(id, host_id, name)')
    .eq('check_out', today)
    .in('status', ['confirmed', 'completed'])
  if (error) return res.status(500).json({ error: 'Query failed' })

  // Group real guest departures by host; exclude iCal "blocked" rows.
  const byHost = new Map<string, { count: number; names: Set<string> }>()
  let departures = 0
  for (const row of (data ?? []) as Array<{ source: string | null; apartments: ApartmentRef | ApartmentRef[] }>) {
    if (typeof row.source === 'string' && row.source.endsWith('_block')) continue
    const apt = Array.isArray(row.apartments) ? row.apartments[0] : row.apartments
    if (!apt?.host_id) continue
    departures++
    const entry = byHost.get(apt.host_id) ?? { count: 0, names: new Set<string>() }
    entry.count++
    if (apt.name) entry.names.add(apt.name)
    byHost.set(apt.host_id, entry)
  }

  let pushed = 0
  for (const [hostId, info] of byHost) {
    const names = [...info.names]
    const body =
      info.count === 1
        ? `A guest checks out today${names[0] ? ` at ${names[0]}` : ''}.`
        : `${info.count} guests check out today${names.length ? ` (${names.join(', ')})` : ''}.`
    const summary = await sendPushToHost(supabase, hostId, {
      title: 'Checkout today',
      body,
      url: '/dashboard/bookings',
    })
    if (summary.sent > 0) pushed++
  }

  return res.status(200).json({ ok: true, departures, hosts: byHost.size, pushed })
}
