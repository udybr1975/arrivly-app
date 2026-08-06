import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { generateCityEvents } from './_lib/city-events.js'
import { sendNtfy } from './_lib/ntfy.js'
import { resolveProvider } from './_lib/ai-provider.js'

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

  // Cross-instance per-host cap on the GROUNDED events generation. SEPARATE key from the
  // public lazy-fill so a public flood (reachable with just an apartment UUID) can never
  // exhaust the host's own refresh. Host reserve: 3/hour. FAIL CLOSED (low-stakes: the cron
  // still refreshes, existing cache stays). ONE ntfy at limit+1. Non-numeric logs and proceeds.
  const CITY_EVENTS_HOST_LIMIT = 3
  {
    const { data: evCount, error: evCountErr } = await supabase.rpc('bump_api_counter', {
      p_host_id: apt.host_id,
      p_endpoint: 'city-events-host',
    })
    if (evCountErr) {
      console.warn('[refresh-events] counter bump failed (fail-closed) -', evCountErr.message?.slice(0, 120))
      return res.status(200).json({ refreshed: false, reason: 'busy' })
    }
    if (typeof evCount !== 'number') {
      console.error('[refresh-events] bump_api_counter returned non-numeric - brake inactive', typeof evCount)
    } else if (evCount > CITY_EVENTS_HOST_LIMIT) {
      if (evCount === CITY_EVENTS_HOST_LIMIT + 1) {
        // fa8fa32 RULE: remediation text migrates with its surface. The closing ACTION line here
        // says "block this host" and is CORRECT — this counter is CALLER-keyed (the ownership
        // check at the top of this handler precedes the bump), unlike the public lazy-fill's
        // victim-keyed one. Do not converge the two.
        const eventsLines =
          resolveProvider('events') === 'gemini'
            ? `GROUNDED gemini-2.5-flash on GEMINI_API_KEY_EVENTS.\n` +
              `DISABLE if needed: GEMINI_API_KEY_EVENTS = project gen-lang-client-0131909896 (city events only).\n`
            : `Tavily search + Groq extraction.\n` +
              // This alarm has the budget to say the blunt part out loud: TAVILY_API_KEY is
              // events-only, but GROQ_API_KEY is shared by ALL AI surfaces, so revoking it is far
              // wider than the old events-only Google project it replaced. And check quota first
              // - an exhausted monthly credit pool is the likeliest cause here.
              `REVOKE + ROTATE IF NEEDED - CHECK VENDOR QUOTA FIRST: TAVILY_API_KEY (app.tavily.com, events only), or GROQ_API_KEY (console.groq.com) which stops ALL AI surfaces.\n`
        try {
          await sendNtfy({
            title: 'Bemgu spend alert: city-events (host refresh)',
            message:
              `Feature: City events - host refresh (/api/refresh-events)\n` +
              `Host ${apt.host_id} hit ${evCount} refresh generations this hour (limit ${CITY_EVENTS_HOST_LIMIT}).\n` +
              eventsLines +
              `ACTION: block this host in Supabase. Vercel logs: /api/refresh-events`,
            priority: 'high',
          })
        } catch (e) {
          console.warn('[refresh-events] alarm failed (non-fatal)', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
        }
      }
      return res.status(429).json({ error: 'rate_limited' })
    }
  }

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
