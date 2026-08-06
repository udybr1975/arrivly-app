import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { generateCityEvents } from './_lib/city-events.js'
import { sendNtfy } from './_lib/ntfy.js'
import { resolveProvider } from './_lib/ai-provider.js'

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
    .select('id, host_id, city, country, is_visible')
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

  // Cross-instance per-host cap on the GROUNDED events generation (GEMINI_API_KEY_EVENTS).
  // SEPARATE key from the host refresh path: apartment UUIDs are public, so a shared budget
  // would let an anonymous flood on one UUID starve the host's own refresh. Public gets its
  // own 7/hour; the host reserve is untouchable from here. FAIL CLOSED (a block just yields
  // the no-events state). ONE ntfy at limit+1. Non-numeric RPC return logs loudly and proceeds.
  const CITY_EVENTS_PUBLIC_LIMIT = 7
  {
    const { data: evCount, error: evCountErr } = await supabase.rpc('bump_api_counter', {
      p_host_id: apt.host_id,
      p_endpoint: 'city-events-public',
    })
    if (evCountErr) {
      console.warn('[city-events] counter bump failed (fail-closed) -', evCountErr.message?.slice(0, 120))
      return res.status(200).json({ error: true })
    }
    if (typeof evCount !== 'number') {
      console.error('[city-events] bump_api_counter returned non-numeric - brake inactive', typeof evCount)
    } else if (evCount > CITY_EVENTS_PUBLIC_LIMIT) {
      if (evCount === CITY_EVENTS_PUBLIC_LIMIT + 1) {
        // fa8fa32 RULE: remediation text migrates with its surface. Rebuilt from
        // resolveProvider('events') at SEND time so an operator is never pointed at a Google
        // project for events that now spend Tavily + Groq. The closing ACTION line is
        // deliberately DIFFERENT from refresh-events.ts's: this key is the VICTIM host on a
        // public surface, so it must not say "block this host". Do not converge them.
        const eventsLines =
          resolveProvider('events') === 'gemini'
            ? `GROUNDED gemini-2.5-flash on GEMINI_API_KEY_EVENTS. Reachable with only an apartment UUID (public).\n` +
              `DISABLE if needed: GEMINI_API_KEY_EVENTS = project gen-lang-client-0131909896 (city events only).\n`
            : `Tavily search + Groq extraction. Reachable with only an apartment UUID (public).\n` +
              // CHECK QUOTA FIRST is load-bearing, not padding: on the Tavily path the LIKELIEST
              // cause of this alarm is a exhausted monthly credit pool (a null payload is never
              // cached, so guests re-enter the paid path and the count climbs). Revoking and
              // rotating during a quota outage is the wrong action entirely.
              `REVOKE + ROTATE IF NEEDED - CHECK VENDOR QUOTA FIRST: GROQ_API_KEY (console.groq.com) and TAVILY_API_KEY (app.tavily.com).\n`
        try {
          await sendNtfy({
            title: 'Bemgu spend alert: city-events (public)',
            message:
              `Feature: City events - public lazy-fill (/api/city-events)\n` +
              `Host ${apt.host_id} hit ${evCount} public events generations this hour (limit ${CITY_EVENTS_PUBLIC_LIMIT}).\n` +
              eventsLines +
              `ACTION: INVESTIGATE, do not auto-block. Key = apartment host = the VICTIM here, not the caller. Check source IPs.`,
            priority: 'high',
          })
        } catch (e) {
          console.warn('[city-events] alarm failed (non-fatal)', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
        }
      }
      return res.status(429).json({ error: true })
    }
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
