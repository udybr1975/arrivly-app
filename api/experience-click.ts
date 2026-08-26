import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Click beacon: logs an anonymous "guest tapped Book" event so hosts (tier 3+) and
// Bemgu can see engagement per apartment/provider/product. NO PII is stored — the table
// has only apartment_id, provider, product_id, clicked_at (never IP/UA/guest identity).
// Fire-and-forget from the guest UI; responds 204 fast. Insert failures (e.g. a stale
// apartment_id failing the FK) are swallowed — this is best-effort analytics, not a gate.

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PROVIDERS = new Set(['viator', 'gyg', 'tiqets'])

// Best-effort per-instance limiter (30/min per apartmentId+IP) — backstop against a
// single client spamming the beacon. Not a hard cross-instance cap (serverless memory).
const RL_MAX = 30
const RL_WINDOW_MS = 60_000
const RL_MAX_KEYS = 5000
const rlHits = new Map<string, { count: number; windowStart: number }>()
function rateLimited(key: string, now: number): boolean {
  // Opportunistic bounded-memory sweep: drop expired entries when the map grows large.
  if (rlHits.size > RL_MAX_KEYS) {
    for (const [k, v] of rlHits) {
      if (now - v.windowStart >= RL_WINDOW_MS) rlHits.delete(k)
    }
  }
  const entry = rlHits.get(key)
  if (!entry || now - entry.windowStart >= RL_WINDOW_MS) {
    rlHits.set(key, { count: 1, windowStart: now })
    return false
  }
  entry.count += 1
  return entry.count > RL_MAX
}
function clientIp(req: VercelRequest): string {
  const xff = req.headers['x-forwarded-for']
  const first = Array.isArray(xff) ? xff[0] : xff
  if (first) return first.split(',')[0].trim()
  return req.socket?.remoteAddress ?? 'unknown'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = (req.body ?? {}) as { apartmentId?: unknown; provider?: unknown; productId?: unknown }
  const apartmentId = typeof body.apartmentId === 'string' ? body.apartmentId : ''
  const provider = typeof body.provider === 'string' ? body.provider : ''
  const productId =
    typeof body.productId === 'string' && body.productId.length > 0
      ? body.productId.slice(0, 200)
      : null

  if (!UUID_RE.test(apartmentId) || !PROVIDERS.has(provider)) {
    return res.status(400).json({ error: 'Invalid input' })
  }

  if (rateLimited(`${apartmentId}:${clientIp(req)}`, Date.now())) {
    // Silently drop over-limit beacons; still 204 so the client never blocks.
    return res.status(204).end()
  }

  // DEMO TRAFFIC IS NOT ENGAGEMENT. Two distinct flags, both excluded here, and this is the
  // single choke point for both — every earnings and admin figure downstream is computed from
  // this table, so filtering at read time would mean remembering to filter in every reader
  // forever:
  //   · apartments.is_public_demo — the landing page's public peek. Marketplace cards stay
  //     LIVE and clickable there (outbound links cost nothing and the fixture carries no
  //     partner IDs, so any sale is Bemgu's), but a visitor tapping one is a browser, not a
  //     guest, and must not appear as a click on a host's Earnings panel.
  //   · hosts.is_demo — the 48-hour sandbox host clicking around their own seeded page.
  // Silent 204, exactly like the over-limit path: this is a fire-and-forget beacon and the
  // client must never learn which apartments are counted.
  // TWO PLAIN SELECTS, NOT A `hosts!inner(...)` EMBED. An embed would be one round-trip, but
  // it fails as a QUERY ERROR if the FK is ever renamed or made ambiguous — and combined with
  // the fail-closed branch below that would silently drop EVERY beacon fleet-wide while
  // logging one line per click. Two column reads on a primary key cannot fail that way.
  const { data: aptRow, error: aptErr } = await supabase
    .from('apartments')
    .select('host_id, is_public_demo')
    .eq('id', apartmentId)
    .maybeSingle()
  if (aptErr) {
    // Fail CLOSED on the lookup, unlike the insert below. The cost of dropping a beacon is a
    // missing tally row on a best-effort analytics table; the cost of inserting one blind is
    // demo traffic permanently mixed into a host's earnings, which nothing downstream can
    // undo. Cheap direction to be wrong in.
    console.warn('[experience-click] apartment lookup failed, beacon dropped —', aptErr.message?.slice(0, 120))
    return res.status(204).end()
  }
  if (!aptRow || aptRow.is_public_demo === true) return res.status(204).end()

  const { data: hostRow, error: hostErr } = await supabase
    .from('hosts')
    .select('is_demo')
    .eq('id', aptRow.host_id)
    .maybeSingle()
  if (hostErr) {
    console.warn('[experience-click] host lookup failed, beacon dropped —', hostErr.message?.slice(0, 120))
    return res.status(204).end()
  }
  if (hostRow?.is_demo === true) return res.status(204).end()

  const { error } = await supabase
    .from('experience_clicks')
    .insert({ apartment_id: apartmentId, provider, product_id: productId })
  if (error) console.warn('[experience-click] insert skipped —', error.message?.slice(0, 120))

  return res.status(204).end()
}
