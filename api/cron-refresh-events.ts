import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'
import { generateCityEvents } from './_lib/city-events.js'
import { sendNtfy } from './_lib/ntfy.js'
import { mapPool } from './_lib/pool.js'

// Daily cron (09:00 UTC — the schedule in vercel.json is "0 9 * * *"; it was moved off 04:00
// by dbfc034). Refreshes the city_events cache ONLY for visible apartments
// that have a current or soon-starting booking (current/next 7 days) — so the AI spend
// is bounded to apartments a guest is actually about to use. Every other apartment
// stays lazy-fill-on-demand. Stale-safe: if generation fails for an apartment, the
// existing cache row is left intact (guests keep last-good events, never an empty panel).
//
// THROUGHPUT IS BOUNDED, NOT COMPLETE — do not diagnose this as a fault. The run is serialised
// (see the concurrency note below) and bounded by START_DEADLINE_MS, so a run refreshes typically
// a few (1-4, since an apartment starting at 64.9s elapsed is still attempted in full); the rest
// DEFER and are picked up on later runs, least-recently-refreshed first.
// A deferred apartment keeps its last-good cache row and stays reachable via lazy-fill, so no
// guest ever sees an empty panel because of a deferral.

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface AptRow { id: string; city: string | null; country: string | null }

// Latest elapsed time at which a NEW apartment may still be STARTED. Past it the mapper defers
// without calling the generator, so the run always reaches its own summary + ntfy instead of
// being killed mid-flight by the platform (a silent truncation: no JSON, no alarm).
//
// ⚠ RE-DERIVE THIS if any timeout, retry count or maxDuration changes. The arithmetic:
//
//   worst case per apartment (Tavily path — the slower of the two providers):
//     4 searches x 8000ms timeout      = 32.0s   (_lib/city-events.ts, searchWeb timeoutMs)
//     4 x 250ms module rate gate       =  1.0s   (_lib/tavily.ts MIN_START_GAP_MS)
//     2 extraction attempts x 20000ms  = 40.0s   (aiGenerate retries: 1, timeoutMs: 20000)
//     withRetry backoff                = ~0.6s
//     Supabase probe + upsert          = ~1.0s
//                                      -> ~74.6s, call it 75s
//   (the Gemini branch is 2 x 28s + backoff ~= 57s, so sizing off Tavily covers both)
//   reserve for sendNtfy (5s AbortController) and the response: 10s
//   maxDuration 150s (vercel.json) - 75 - 10 = 65s
//
// `startedAt` is taken at HANDLER ENTRY, so the pre-loop queries are already inside this 65s
// rather than competing with the reserve. The 4 x 250ms rate-gate line is over-counted on purpose
// (the gate spaces START times, so an 8s search has already paid it) — over-reserving is the safe
// direction for a guard whose whole job is to keep the run alive long enough to fire its alarm.
const START_DEADLINE_MS = 65_000

// UTC, day-granular (matches the generator's window).
function utcDay(offsetDays: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

// Count extracted events defensively — a non-array `categories`, a non-array `events` or a
// missing field all count as 0, and this must never throw on a malformed payload.
// NOTE: an identical twin lives in refresh-events.ts. Deliberately duplicated rather than
// shared, because _lib/city-events.ts is the generator and this guard belongs to the CALLERS.
// Keep the two in step.
function countEvents(payload: unknown): number {
  const cats = (payload as { categories?: unknown } | null)?.categories
  if (!Array.isArray(cats)) return 0
  let n = 0
  for (const c of cats) {
    const evs = (c as { events?: unknown } | null)?.events
    if (Array.isArray(evs)) n += evs.length
  }
  return n
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  // Captured at HANDLER ENTRY, not at the pool — deliberately. The three pre-loop Supabase queries
  // (bookings, apartments, cache-age) sit outside the mapper, so measuring from the pool would let
  // their latency escape the budget entirely and eat the reserve that has to cover sendNtfy's own
  // 5s timeout. Measuring from here makes the guard bound what it actually claims to bound.
  const startedAt = Date.now()

  const today = utcDay(0)
  const plus7 = utcDay(7)

  // Bookings current or starting within the next 7 days (inclusive, UTC day-granular).
  const { data: bookings, error: bErr } = await supabase
    .from('bookings')
    .select('apartment_id, source, check_in, check_out')
    .in('status', ['confirmed', 'completed'])
    .gte('check_out', today)
    .lte('check_in', plus7)
  if (bErr) return res.status(500).json({ error: 'Query failed' })

  // Drop calendar *_block rows; dedupe apartment ids.
  const aptIds = [
    ...new Set(
      ((bookings ?? []) as Array<{ apartment_id: string | null; source: string | null }>)
        .filter((b) => b.apartment_id && !String(b.source ?? '').toLowerCase().endsWith('_block'))
        .map((b) => b.apartment_id as string)
    ),
  ]
  if (aptIds.length === 0) {
    return res.status(200).json({ ok: true, candidates: 0, refreshed: 0, failed: 0 })
  }

  // Only visible apartments with a city qualify for a daily AI refresh.
  const { data: apts, error: aErr } = await supabase
    .from('apartments')
    .select('id, city, country')
    .in('id', aptIds)
    .eq('is_visible', true)
    .not('city', 'is', null)
  if (aErr) return res.status(500).json({ error: 'Query failed' })

  const candidates = (apts ?? []) as AptRow[]

  // LEAST-RECENTLY-REFRESHED FIRST. This is what stops the start-deadline below from creating a
  // permanently starved TAIL: with a stable order (whatever Postgres returns) the same apartments
  // sit past the deadline every single day, deterministically, and never refresh again. Sorting by
  // cache age makes deferral rotate — today's deferred apartment is tomorrow's first.
  //
  // NULL (never refreshed) sorts FIRST: an apartment with no cache row has nothing to fall back on
  // but the public lazy-fill, so it is the one that most deserves the slot.
  //
  // DEFENSIVE BY DESIGN: this is an optimisation, never a precondition. A failed or partial lookup
  // leaves the original order untouched and must never block the run.
  //
  // KNOWN RESIDUAL — rotation is driven by `generated_at`, which only a successful WRITE advances.
  // NEITHER a B3.1 skip (empty extraction, existing row preserved) NOR a failure advances it, so an
  // apartment that consistently extracts nothing — or consistently fails, which is the likelier
  // mode during a provider outage — keeps its old timestamp, permanently holds the head of the
  // queue and spends 4 Tavily credits every day while pushing the tail back. Ordering alone cannot
  // fix this: it needs a persisted "last ATTEMPTED" timestamp, i.e. a schema change, deliberately
  // not made here. Until then the tail is rotated, not guaranteed.
  if (candidates.length > 1) {
    const { data: cacheRows, error: cacheErr } = await supabase
      .from('city_events_cache')
      .select('apartment_id, generated_at')
      .in('apartment_id', candidates.map((a) => a.id))
    if (cacheErr) {
      console.warn(
        '[cron-refresh-events] cache-age lookup failed, keeping default order —',
        cacheErr.message?.slice(0, 120)
      )
    } else {
      const refreshedAt = new Map<string, number>()
      for (const r of (cacheRows ?? []) as Array<{ apartment_id: string | null; generated_at: string | null }>) {
        if (!r.apartment_id) continue
        const t = r.generated_at ? Date.parse(r.generated_at) : NaN
        // An unparseable timestamp is treated as "never refreshed" — the same direction as a
        // missing row, so a bad value can only cost priority, never starve.
        if (Number.isFinite(t)) refreshedAt.set(r.apartment_id, t)
      }
      // Sentinel 0 (epoch), NOT -Infinity: a real timestamp is always > 0, so 0 sorts first as
      // intended, and two never-refreshed rows subtract to 0 rather than to NaN.
      candidates.sort((a, b) => (refreshedAt.get(a.id) ?? 0) - (refreshedAt.get(b.id) ?? 0))
    }
  }

  // CONCURRENCY 1, and this is a correctness limit rather than a politeness one. Each iteration is
  // FOUR Tavily searches + a GROQ extraction on the default path (pilot Step 5 — the `gemini`
  // branch is still selectable via AI_PROVIDER_EVENTS, but rolling back to it is forbidden per
  // CLAUDE.md, and it is the cheaper of the two here anyway). Groq's free tier is 6K TPM ORG-WIDE,
  // shared by every AI surface across every tenant. At B3.3+
  // prompt sizes one extraction is ~3.5-5.5k tokens, so TWO in flight breach that ceiling
  // deterministically: the cron 429s itself AND starves guest-chat, the guide and daily-greeting
  // for every host while it runs. Serialising costs almost nothing here (daily, booking-filtered).
  //
  // Serialising is why the start-deadline exists: at ~75s worst case per apartment, run 3+ would
  // otherwise be killed mid-flight — silently, with no JSON summary and no wholesale-failure ntfy.
  //
  // Each task returns { ok } and performs its own stale-safe upsert; counts are aggregated in a
  // single pass after the pool.
  const outcomes = await mapPool(candidates, 1, async (apt): Promise<{ ok: boolean; skipped?: boolean; deferred?: boolean }> => {
    // START-DEADLINE GUARD — checked BEFORE the generator, so a deferred apartment spends no
    // Tavily credit and no Groq tokens. It is NOT a failure: it keeps its last-good cache row and
    // remains available via lazy-fill-on-demand, so no guest sees an empty panel.
    if (Date.now() - startedAt > START_DEADLINE_MS) {
      console.warn('[cron-refresh-events] deferred, run deadline reached', { aptId: apt.id })
      return { ok: false, deferred: true }
    }

    const { payload } = await generateCityEvents({ id: apt.id, city: apt.city, country: apt.country })
    if (!payload) {
      // Generation failed/quota — leave the existing row intact (stale but safe).
      return { ok: false }
    }

    // ── B3.1: never overwrite good events with an EMPTY extraction ─────────────────────────
    // `categories: []` is a VALID payload, so the `!payload` check above does not catch it. This
    // is the path that broke THIS FILE'S OWN header promise that "guests keep last-good events,
    // never an empty panel".
    //
    // An empty extraction is AMBIGUOUS — "found nothing" vs "genuinely a quiet week" cannot be
    // told apart here. DECISION: keep the OLD events in both cases; stale self-corrects on the
    // next run, an erased panel does not. ACCEPTED COST: a quiet week keeps showing last week's
    // events until something new is found. PROVIDER-AGNOSTIC — an empty Gemini payload would
    // destroy data identically.
    if (countEvents(payload) === 0) {
      const { data: existing, error: probeErr } = await supabase
        .from('city_events_cache')
        .select('apartment_id')
        .eq('apartment_id', apt.id)
        .maybeSingle()
      // FAIL CLOSED: `.maybeSingle()` reports query FAILURE as `data: null`, indistinguishable
      // from "no row", so an errored probe is treated as "a row exists" and the write is skipped.
      if (probeErr || existing) {
        console.warn('[cron-refresh-events] empty extraction, keeping existing events', {
          aptId: apt.id,
          reason: probeErr ? 'probe_failed' : 'row_exists',
        })
        return { ok: false, skipped: true }
      }
      // No row: an empty FIRST fill is honest and must not be blocked.
    }

    const { error: upErr } = await supabase
      .from('city_events_cache')
      .upsert(
        { apartment_id: apt.id, payload, generated_at: new Date().toISOString() },
        { onConflict: 'apartment_id' }
      )
    if (upErr) {
      console.error('[cron-refresh-events] upsert failed —', upErr.message?.slice(0, 120))
      return { ok: false }
    }
    return { ok: true }
  })

  // `refreshed` deliberately still means "a row was ACTUALLY WRITTEN", so the ntfy condition
  // below keeps exactly its previous meaning. Skips are counted separately: a skip is neither a
  // success nor a failure — the generation worked, we chose not to persist an empty result.
  let refreshed = 0
  let failed = 0
  let skipped = 0
  let deferred = 0
  for (const o of outcomes) {
    // A hole (mapPool's safety net swallowed a thrown mapper and left the slot empty) counts as a
    // FAILURE, not a crash. The mappers here are total, so this is unreachable today — but reading
    // `o.deferred` off `undefined` would throw past the alarm and 500 the run, which is one more
    // way to lose the signal this whole file exists to emit.
    if (!o) { failed++; continue }
    if (o.deferred) deferred++
    else if (o.skipped) skipped++
    else if (o.ok) refreshed++
    else failed++
  }

  // Signal only a GENUINE wholesale failure (likely quota/outage) — never throw.
  //
  // `skipped === 0` is part of the condition, not decoration (B3.2). B3.1 introduced a false
  // assertion here: an empty extraction used to be WRITTEN and counted as `refreshed`, so before
  // it this alarm could not lie this way. Afterwards a run where every apartment was deliberately
  // PRESERVED also satisfies `refreshed === 0`, and the message then claimed total failure when
  // nothing failed. That was not a rare edge either — the condition needs every candidate to
  // skip, and `candidates` is frequently 1 at current fleet size, so ONE empty extraction on ONE
  // booked apartment fired a high-priority total-failure alert. The cost is alarm fatigue on the
  // one signal that would reveal Tavily quota exhaustion, which matters given the 1000-credit
  // FLEET-WIDE MONTHLY pool.
  //
  // An ALL-SKIP run deliberately gets NO ntfy: it is a normal quiet week, and a routine
  // notification would train the operator to ignore this channel. It is visible in the JSON
  // summary and the per-apartment warn logs instead.
  //
  // DEFERRAL ENTERS THIS CONDITION AS `attempted`, NOT as `deferred === 0` — and the difference is
  // the whole point, because the obvious form is WRONG IN THE DANGEROUS DIRECTION.
  //
  // Serialising the pool reintroduced the B3.2 defect class: a run where one apartment failed and
  // the rest were never ATTEMPTED must not assert "All N failed", since N-1 were never tried. But
  // gating on `deferred === 0` over-corrects and MASKS the worst outage. Deferral is not orthogonal
  // to failure the way a skip is — it is CORRELATED with it:
  //   - FAST failure (Tavily 429 on the exhausted monthly pool, an HTTP error) returns in
  //     milliseconds, so nothing defers and the alarm fires. Fine either way.
  //   - SLOW failure (a hanging provider) burns the full ~75s on apartment 1, which pushes every
  //     remaining candidate past the deadline. Under `deferred === 0` that is SILENT — and it is
  //     the expensive mode, on the one detector that reveals Tavily/Groq exhaustion.
  // B3.2's `skipped` was safe to suppress on precisely because every provider fault lands as
  // `failed` and never as `skipped`, so a skip is positive evidence AGAINST an outage. `deferred`
  // fails that test. GENERAL RULE: suppressing a detector on a bucket CORRELATED with the fault is
  // not the same as suppressing on an orthogonal one.
  //
  // So the claim is scoped to what was actually tried: alarm when every ATTEMPTED apartment failed.
  // An all-deferred run stays silent (attempted === 0), a slow wholesale outage now fires, and the
  // false "All N failed" claim is still impossible — the message reports 1 of 1 attempted, not N.
  //
  // The message carries NO ACTION line, deliberately — see the fa8fa32 rule. An alarm that names
  // no remediation cannot misdirect one. Body stays ASCII-only and far inside sendNtfy's 500-char
  // slice. `skipped` is NECESSARILY 0 here since the condition gates on it; it is stated so the
  // alert is self-describing to anyone holding the older mental model in which this alarm could
  // also mean "deliberately preserved". Do not read it as a live signal.
  const attempted = candidates.length - deferred
  if (attempted > 0 && refreshed === 0 && skipped === 0 && failed === attempted) {
    await sendNtfy({
      title: 'Bemgu city-events refresh',
      message: `All ${attempted} attempted event refreshes failed today (${deferred} deferred, skipped ${skipped}).`,
      priority: 'high',
    })
  }

  return res.status(200).json({ ok: true, candidates: candidates.length, refreshed, failed, skipped, deferred })
}
