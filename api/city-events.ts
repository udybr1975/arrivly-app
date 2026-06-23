import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { generateCityEvents } from './_lib/city-events.js'

// PUBLIC guest read path. Cache-first: ~all guests hit a DB read only. The ONLY way
// to trigger a Gemini call is to be the first caller for an uncached apartment
// (lazy first-fill), and that path is rate-limited. The daily cron pre-fills the
// cache for apartments with current/upcoming bookings, so most apartments are warm.
// Returns the cached payload ({ week, categories }) or { error: true } — unchanged
// shape, so the guest EventsPage needs no change.

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Best-effort, per-instance rate limiter — backstop on the LAZY-FILL (Gemini) path
// only. Cached reads (the hot path) are never limited. Keyed by apartmentId+IP.
const RL_MAX = 5
const RL_WINDOW_MS = 60_000
const rlHits = new Map<string, { count: number; windowStart: number }>()
function rateLimited(key: string, now: number): boolean {
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { apartmentId } = (req.body ?? {}) as { apartmentId?: string }
  if (!apartmentId || typeof apartmentId !== 'string') {
    return res.status(400).json({ error: 'apartmentId required' })
  }

  // Authoritative apartment from DB — never trust a client-supplied city.
  const { data: apt, error: aptErr } = await supabase
    .from('apartments')
    .select('id, city, country, is_visible')
    .eq('id', apartmentId)
    .maybeSingle()
  if (aptErr || !apt || apt.is_visible === false || !apt.city) {
    return res.status(200).json({ error: true })
  }

  // Hot path: serve the cache row directly, no Gemini.
  const { data: cached } = await supabase
    .from('city_events_cache')
    .select('payload')
    .eq('apartment_id', apartmentId)
    .maybeSingle()
  if (cached?.payload) return res.status(200).json(cached.payload)

  // Lazy first-fill: rate-limit (this is the only Gemini-touching guest path).
  if (rateLimited(`${apartmentId}:${clientIp(req)}`, Date.now())) {
    return res.status(429).json({ error: true })
  }

  const { payload } = await generateCityEvents({ id: apt.id, city: apt.city, country: apt.country })
  if (!payload) return res.status(200).json({ error: true })

  // Cache only a real result — never persist an empty/failed generation.
  const { error: upErr } = await supabase
    .from('city_events_cache')
    .upsert(
      { apartment_id: apartmentId, payload, generated_at: new Date().toISOString() },
      { onConflict: 'apartment_id' }
    )
  if (upErr) console.error('[city-events] cache upsert failed —', upErr.message?.slice(0, 120))

  return res.status(200).json(payload)
}
