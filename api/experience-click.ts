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

  const { error } = await supabase
    .from('experience_clicks')
    .insert({ apartment_id: apartmentId, provider, product_id: productId })
  if (error) console.warn('[experience-click] insert skipped —', error.message?.slice(0, 120))

  return res.status(204).end()
}
