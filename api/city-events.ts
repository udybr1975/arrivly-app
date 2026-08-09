import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import {
  generateCityEvents,
  eventsCacheRef,
  readEventsCache,
  writeEventsCache,
  eventDateInWindow,
  type CityEventsPayload,
  type EventsCacheRef,
} from './_lib/city-events.js'
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

// ── READ-TIME PAST-EVENT FILTER ───────────────────────────────────────────────────────────────
//
// The generation window is 30 DAYS (was 7), so a cache row now legitimately holds events up to a
// month out — and a guest reading that row late must not be shown ones that have already
// happened. Filtering HERE costs nothing: no AI call, no Tavily credit, no write. It is the
// cheapest half of the widening, and it is what makes the widening safe.
//
// ONE PARSER, DELIBERATELY. This reuses `eventDateInWindow` rather than adding a second date
// reader. This codebase has had exactly one date-parsing defect class and it came from a guard
// with blind spots; two parsers with two sets of blind spots is strictly worse than one.
//
// GUEST READ PATH ONLY. `api/refresh-events.ts` returns its payload to the HOST, who is previewing
// what was just generated and should see all of it — do not copy this there.
//
// ══ THE FAR BOUND IS PART OF THE PARSER, NOT PADDING — KEEP IT WELL UNDER 365 ═════════════════
//
// `eventDateInWindow` INFERS the year from the bounds it is handed (the single-month branch never
// reads a 4-digit year out of the string at all — its day regex is `\b(\d{1,2})\b`), and keeps the
// event if ANY candidate placement intersects. So a span of 365+ days contains every (day, month)
// pair at least once and the predicate CAN NEVER RETURN false for a bare month-name date — the
// dominant shape, since the prompt asks for `date (as stated in the snippet)`.
//
// This was first written as 400 and it made the whole filter a no-op for exactly the dates it
// exists to catch: on 9 Aug 2026, "5 August" fails to intersect as Aug 2026 but intersects as Aug
// 2027, so it is kept. Both review gates caught it independently.
//
// 45 IS DERIVED, NOT PICKED: an event that is legitimately still ahead is at most 30 days out BY
// CONSTRUCTION (`eventWindow` generates a 30-day window, and generation is always in the past), so
// 45 leaves 15 days of slack over the furthest event any cache row can hold, while collapsing the
// candidate-year list to one in the common case. It introduces NO wrong-drop risk: the range
// branches test INTERSECTION, not containment, so a long run like "1 August - 30 November" read on
// 9 August still intersects `startMs` and is kept.
const READ_FILTER_FAR_BOUND_DAYS = 45

/**
 * Returns a NEW payload with already-past events removed. Never mutates its input, never writes
 * back to the cache — the cached row stays whole and this is presentation only.
 *
 * NEVER THROWS: on any failure it returns the payload UNFILTERED. A stale event shown to a guest
 * is a far smaller harm than an events tab that errors, and the fallback (`EventsPage` retries 3x)
 * would additionally spend hourly units on a failure retrying cannot fix.
 */
function dropPastEvents(payload: CityEventsPayload, ref: EventsCacheRef): CityEventsPayload {
  try {
    // Same UTC day-granular basis as `fmt`/`eventWindow`, so the bounds this filter enforces and
    // the dates the generator stated cannot drift apart on a timezone.
    const now = new Date()
    const startMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    // A CONCRETE far bound, never Infinity/MAX_SAFE_INTEGER — but NOT for the reason it is tempting
    // to write. `new Date(Infinity).getUTCFullYear()` is NaN, and the candidate years are OR-ed
    // through `.some()`, so a NaN entry contributes nothing and the check silently becomes
    // STRICTER, not looser. The real cost is that it disables the New-Year ROLLOVER placement the
    // cross-month branch depends on (`years = [sy-1, sy, endYear]`), which is a wrong-DROP risk.
    // The bound's size is the thing that matters here — see the derivation at the constant.
    const endMs = startMs + READ_FILTER_FAR_BOUND_DAYS * 86_400_000 + 86_399_999

    if (!Array.isArray(payload?.categories)) return payload

    let eventsBefore = 0
    let eventsAfter = 0
    // A structurally malformed category is dropped WITHOUT contributing to either counter — it has
    // no countable events. Tracked separately so the early return below cannot short-circuit past
    // a real change and hand back a payload we had already decided to strip.
    let structuralDrop = false
    const categories: CityEventsPayload['categories'] = []
    for (const cat of payload.categories) {
      if (!cat || !Array.isArray(cat.events)) {
        structuralDrop = true
        continue
      }
      const events = cat.events.filter((ev) => {
        eventsBefore++
        // A cached row is JSON from the DB and is NOT runtime-type-checked, so coerce here rather
        // than letting a non-string `date` throw inside the predicate: the outer catch would then
        // serve the ENTIRE payload unfiltered over one bad field. Same keep outcome either way
        // (`eventDateInWindow('')` returns null = keep), just localised to the one event.
        const date = typeof ev?.date === 'string' ? ev.date : ''
        // DROP ONLY ON EXACTLY `false`. `null` means CANNOT JUDGE and MUST be kept — that is the
        // function's contract and its deliberate safety direction, and `false` is the only verdict
        // that removes something a guest would otherwise see. Do not "improve" null into a drop.
        const keep = eventDateInWindow(date, startMs, endMs) !== false
        if (keep) eventsAfter++
        return keep
      })
      // A category with nothing left is dropped entirely; the survivors are returned as they are.
      if (events.length > 0) categories.push({ ...cat, events })
    }

    // Silent when nothing changed — and returning the ORIGINAL reference here is what guarantees
    // the no-drop path is allocation-free and provably non-mutating.
    if (eventsBefore === eventsAfter && !structuralDrop) return payload

    console.log('[city-events] read filter', {
      cacheKey: ref.cityKey ?? ref.apartmentId,
      eventsBefore,
      eventsAfter,
    })
    return { ...payload, categories }
  } catch (e) {
    console.warn(
      '[city-events] read filter failed (serving unfiltered) —',
      (e instanceof Error ? e.message : 'unknown').slice(0, 120)
    )
    return payload
  }
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
    .select('id, host_id, city, country, is_visible, canonical_city_key, canonical_city, canonical_country')
    .eq('id', apartmentId)
    .maybeSingle()
  if (aptErr || !apt || apt.is_visible === false || !apt.city) {
    return res.status(200).json({ error: true })
  }

  // WHICH row this apartment reads. The key comes from the DB row above — a caller supplies only
  // an apartment id and can never influence which city's events it reads.
  const cacheRef = eventsCacheRef(apt)

  // Hot path: serve the cache row directly, no generation.
  //
  // CACHE-KEY CHANGE IS DELIBERATELY A MISS, NOT A MIGRATION. An apartment that just gained a
  // canonical_city_key reads the city row for the first time and misses, even though its old
  // per-apartment row still holds good events. Do NOT "fix" this with a backfill or a copy: with
  // 2+ apartments per city a copy would have to elect one apartment's payload as the city's
  // truth, and that choice is arbitrary. The miss self-heals on the next cron run or lazy-fill.
  const { payload: cachedPayload } = await readEventsCache(supabase, cacheRef)
  // Filtered on the way OUT only — `readEventsCache`'s object is never mutated and the row is
  // never rewritten. This is the path where the filter actually earns its keep: a row generated
  // up to 20h ago (the shared freshness gate) against a 30-day window is exactly where past
  // events accumulate.
  if (cachedPayload) return res.status(200).json(dropPastEvents(cachedPayload, cacheRef))

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

  // Generate from ref.place, NOT apt.city: on the shared city row that is the server-derived
  // canonical city, so the content written can never disagree with the key it is written under.
  // The per-apartment fallback still uses the host's typed city (its row is not shared).
  const { payload } = await generateCityEvents({
    id: apt.id,
    city: cacheRef.place.city,
    country: cacheRef.place.country,
  })
  if (!payload) return res.status(200).json({ error: true })

  // Cache only a real result — never persist a failed generation.
  //
  // DELIBERATELY EXEMPT from the B3.1 empty-extraction guard that refresh-events.ts and
  // cron-refresh-events.ts carry — do NOT "fix" this asymmetry. This upsert is reachable ONLY on
  // a cache MISS (the hot path returned at the cached read above), so it can CREATE an empty row
  // but can never DESTROY a good one. Adding the guard here would block legitimate first-fills,
  // which is the one case the other two call sites explicitly allow. THAT REASONING HOLDS
  // UNCHANGED CITY-KEYED: a miss means no row exists for that key either.
  //
  // KNOWN CONSEQUENCE of sharing the row, stated so it is not rediscovered as a bug: an empty
  // first-fill written here is now visible to EVERY apartment in that city until something
  // non-empty replaces it. It self-heals — the cron and the host refresh both overwrite an empty
  // row with a non-empty extraction (their B3.1 guard only blocks writing an empty OVER an
  // existing row) — but it is a wider blast radius than the per-apartment row had.
  const { error: cacheWriteErr } = await writeEventsCache(
    supabase,
    cacheRef,
    payload,
    new Date().toISOString()
  )
  if (cacheWriteErr) console.error('[city-events] cache upsert failed —', cacheWriteErr)

  // ORDER MATTERS: the UNFILTERED payload is what was cached just above. The cache must stay whole
  // — it is read by every apartment in the city for up to 20h, and each of those reads applies its
  // own filter at its own moment — while a response is filtered for ONE guest at ONE moment.
  //
  // STATE THIS HONESTLY RATHER THAN DRESSING IT UP AS A DETECTOR: on THIS path the call is a
  // deliberate NO-OP, kept so both exits are filtered by construction and a future edit cannot
  // create an unfiltered one. It cannot fire, and that is provable, not hopeful — same request, so
  // this filter computes the SAME `startMs` as `eventWindow`, a strictly LARGER `endMs`, and a
  // SUPERSET of candidate years. Every event the generator kept (`true` or `null`) is therefore
  // kept here too, for any far bound >= 30 days. Do not read a `read filter` log line on this path
  // as a drift signal; it would mean the bound was set BELOW the generation window.
  return res.status(200).json(dropPastEvents(payload, cacheRef))
}
