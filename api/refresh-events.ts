import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { generateCityEvents } from './_lib/city-events.js'

// Host manual "Refresh events" — Bearer-auth, ownership-gated, freshness-gated.
// A row newer than 20h is considered fresh and short-circuits WITHOUT a Gemini call
// (the host UI shows "up to date"). Older / missing → regenerate (rate-limited).
// Stale-safe: a failed generation never overwrites an existing good row.

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FRESH_MS = 20 * 60 * 60 * 1000 // 20 hours

// Per-host rate limiter (mirrors sync-ical.ts) — keyed by the verified userId.
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const authClient = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!
  )
  const { data: authData, error: authError } = await authClient.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })
  const userId = authData.user.id

  if (!req.body) return res.status(400).json({ error: 'apartment_id required' })
  const { apartment_id } = req.body as { apartment_id?: string }
  if (!apartment_id) return res.status(400).json({ error: 'apartment_id required' })

  const { data: apt, error: aptErr } = await supabase
    .from('apartments')
    .select('id, host_id, city, country')
    .eq('id', apartment_id)
    .maybeSingle()
  if (aptErr || !apt) return res.status(404).json({ error: 'Apartment not found' })
  if (apt.host_id !== userId) return res.status(403).json({ error: 'Forbidden' })

  // Freshness gate — cheap, runs before the rate limiter so fresh clicks don't burn the bucket.
  const { data: cached } = await supabase
    .from('city_events_cache')
    .select('generated_at')
    .eq('apartment_id', apartment_id)
    .maybeSingle()
  if (cached?.generated_at && Date.now() - new Date(cached.generated_at).getTime() < FRESH_MS) {
    return res.status(200).json({ refreshed: false, reason: 'fresh', generated_at: cached.generated_at })
  }

  // Abuse backstop on the Gemini path.
  if (rateLimited(userId, Date.now())) return res.status(429).json({ error: 'rate_limited' })

  const { payload } = await generateCityEvents({ id: apt.id, city: apt.city, country: apt.country })
  if (!payload) return res.status(200).json({ refreshed: false, reason: 'generation_failed' })

  const generated_at = new Date().toISOString()
  const { error: upErr } = await supabase
    .from('city_events_cache')
    .upsert({ apartment_id, payload, generated_at }, { onConflict: 'apartment_id' })
  if (upErr) {
    console.error('[refresh-events] upsert failed —', upErr.message?.slice(0, 120))
    return res.status(200).json({ refreshed: false, reason: 'generation_failed' })
  }

  return res.status(200).json({ refreshed: true, generated_at })
}
