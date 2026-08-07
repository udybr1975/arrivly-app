import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'
import {
  generateCityEvents,
  eventsCacheRef,
  readEventsCacheMeta,
  writeEventsCache,
  stampEventsAttempt,
  type EventsCacheRef,
} from './_lib/city-events.js'
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

interface AptRow {
  id: string
  city: string | null
  country: string | null
  canonical_city_key: string | null
  canonical_city: string | null
  canonical_country: string | null
}

// One unit of work. A city-keyed unit stands for EVERY booked apartment sharing that key, which
// is the whole saving: N apartments in one city used to cost N generations and N bills.
//
// `apt` is an ARBITRARY member (first returned by Postgres), and that is only safe because the
// generator is fed `ref.place` — the SERVER-DERIVED canonical city — rather than that member's
// host-typed `apt.city`. Every member of a key shares the same canonical city by construction,
// so which member represents the group cannot change what is searched or what is written. Feed
// the typed field here and the representative choice would silently decide the shared row's
// content, non-deterministically across runs.
interface WorkUnit {
  ref: EventsCacheRef
  apt: AptRow
  /** Sort key: least-recently-touched first. See the ordering note at the call site. */
  order: number
}

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
    .select('id, city, country, canonical_city_key, canonical_city, canonical_country')
    .in('id', aptIds)
    .eq('is_visible', true)
    .not('city', 'is', null)
  if (aErr) return res.status(500).json({ error: 'Query failed' })

  const aptRows = (apts ?? []) as AptRow[]

  // GROUP INTO UNITS OF WORK — the real saving in this commit.
  //   keyed apartments   -> ONE unit per DISTINCT canonical_city_key (first member represents it)
  //   unkeyed apartments -> one unit each, per-apartment exactly as before
  // Branching is on canonical_city_key ONLY, via the shared helper: canonical_resolved_at can be
  // set while the key is NULL (a city that resolved with no valid country code), so branching on
  // resolved_at would be a bug. Five of nine live apartments are unkeyed today.
  const cityUnits = new Map<string, WorkUnit>()
  const aptUnits: WorkUnit[] = []
  for (const apt of aptRows) {
    const ref = eventsCacheRef(apt)
    if (ref.cityKey) {
      if (!cityUnits.has(ref.cityKey)) cityUnits.set(ref.cityKey, { ref, apt, order: 0 })
    } else {
      aptUnits.push({ ref, apt, order: 0 })
    }
  }

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
  // THE TWO GROUPS ARE ORDERED ON DIFFERENT COLUMNS, deliberately, then merged on one scale:
  //   city units      -> city_events_by_city.last_attempted_at
  //   apartment units -> city_events_cache.generated_at  (unchanged from before this commit)
  //
  // WHY last_attempted_at, and why generated_at COULD NOT WORK — this is the OPEN-1 fix recorded
  // in d254df9's commit message. `generated_at` advances only on a successful WRITE: neither a
  // B3.1 skip (empty extraction, existing row preserved) nor a failure advances it. So a city
  // that consistently fails — the likeliest mode during a provider outage — or consistently
  // extracts nothing kept its old timestamp, permanently held the head of the queue, and spent
  // 4 Tavily credits every single day while pushing the tail back. The fix is a column that
  // every ATTEMPT stamps, which is why stampEventsAttempt runs on success, skip AND failure.
  //
  // The per-apartment fallback has no last_attempted_at column anywhere, so it keeps today's
  // generated_at ordering and therefore keeps today's residual. That is not a regression: it is
  // exactly the pre-commit-2 behaviour, and the fallback shrinks as apartments gain keys.
  //
  // MERGED ON ONE SCALE rather than one group before the other: putting either group first would
  // starve the other under START_DEADLINE_MS. The two columns mean different things (attempted vs
  // written) but both answer "how long since we last did work for this unit", which is exactly
  // what the deadline needs to rotate fairly.
  const units: WorkUnit[] = [...cityUnits.values(), ...aptUnits]
  if (units.length > 1) {
    const cityKeys = [...cityUnits.keys()]
    const aptIdsForOrder = aptUnits.map((u) => u.apt.id)

    // DEFENSIVE BY DESIGN, unchanged in spirit: ordering is an optimisation, never a
    // precondition. A failed or partial lookup leaves that group's order untouched and must never
    // block the run. Sentinel 0 (epoch) means "never touched" and sorts first — a real timestamp
    // is always > 0, and two never-touched units subtract to 0 rather than NaN.
    if (cityKeys.length > 0) {
      const { data: cityRows, error: cityErr } = await supabase
        .from('city_events_by_city')
        .select('city_key, last_attempted_at')
        .in('city_key', cityKeys)
      if (cityErr) {
        console.warn(
          '[cron-refresh-events] city cache-age lookup failed, keeping default order —',
          cityErr.message?.slice(0, 120)
        )
      } else {
        for (const r of (cityRows ?? []) as Array<{ city_key: string | null; last_attempted_at: string | null }>) {
          if (!r.city_key) continue
          const t = r.last_attempted_at ? Date.parse(r.last_attempted_at) : NaN
          const unit = cityUnits.get(r.city_key)
          if (unit && Number.isFinite(t)) unit.order = t
        }
      }
    }

    if (aptIdsForOrder.length > 0) {
      const { data: cacheRows, error: cacheErr } = await supabase
        .from('city_events_cache')
        .select('apartment_id, generated_at')
        .in('apartment_id', aptIdsForOrder)
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
        for (const u of aptUnits) u.order = refreshedAt.get(u.apt.id) ?? 0
      }
    }

    units.sort((a, b) => a.order - b.order)
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
  const outcomes = await mapPool(units, 1, async (unit): Promise<{ ok: boolean; skipped?: boolean; deferred?: boolean }> => {
    const { ref, apt } = unit
    // START-DEADLINE GUARD — checked BEFORE the generator, so a deferred unit spends no
    // Tavily credit and no Groq tokens. It is NOT a failure: it keeps its last-good cache row and
    // remains available via lazy-fill-on-demand, so no guest sees an empty panel.
    //
    // Deliberately BEFORE the attempt stamp too: a deferred unit was never attempted, so stamping
    // it would push it down the queue for work it did not do — the exact starvation this ordering
    // exists to prevent.
    if (Date.now() - startedAt > START_DEADLINE_MS) {
      console.warn('[cron-refresh-events] deferred, run deadline reached', {
        aptId: apt.id,
        cityKey: ref.cityKey,
      })
      return { ok: false, deferred: true }
    }

    // Stamp BEFORE generating, so a run that is killed mid-generation still counts as an attempt
    // and cannot pin the head of the queue. No-op for the per-apartment fallback (no column).
    await stampEventsAttempt(supabase, ref)

    // ref.place, NOT apt.city — see the WorkUnit note: the representative member must not be able
    // to decide what a shared row contains.
    const { payload } = await generateCityEvents({
      id: apt.id,
      city: ref.place.city,
      country: ref.place.country,
    })
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
      // Probes whichever row the key selects — the guard is unchanged, only its target moved.
      const probe = await readEventsCacheMeta(supabase, ref)
      // FAIL CLOSED: `.maybeSingle()` reports query FAILURE as `data: null`, indistinguishable
      // from "no row", so an errored probe is treated as "a row exists" and the write is skipped.
      if (probe.error || probe.exists) {
        console.warn('[cron-refresh-events] empty extraction, keeping existing events', {
          aptId: apt.id,
          cityKey: ref.cityKey,
          reason: probe.error ? 'probe_failed' : 'row_exists',
        })
        return { ok: false, skipped: true }
      }
      // No row: an empty FIRST fill is honest and must not be blocked.
    }

    const { error: upErr } = await writeEventsCache(supabase, ref, payload, new Date().toISOString())
    if (upErr) {
      console.error('[cron-refresh-events] upsert failed —', upErr)
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
  const attempted = units.length - deferred
  if (attempted > 0 && refreshed === 0 && skipped === 0 && failed === attempted) {
    await sendNtfy({
      title: 'Bemgu city-events refresh',
      message: `All ${attempted} attempted event refreshes failed today (${deferred} deferred, skipped ${skipped}).`,
      priority: 'high',
    })
  }

  // `candidates` keeps its meaning of "units of work attempted this run" so the existing field is
  // not silently redefined against a different denominator; the two new fields show the grouping
  // that produced it (cityUnits + aptUnits === candidates).
  return res.status(200).json({
    ok: true,
    candidates: units.length,
    cityUnits: cityUnits.size,
    aptUnits: aptUnits.length,
    bookedApartments: aptRows.length,
    refreshed,
    failed,
    skipped,
    deferred,
  })
}
