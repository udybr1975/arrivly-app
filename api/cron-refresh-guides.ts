import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'
import { generateGuideForApartment } from './_lib/guide.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Freshness gate. A guide older than this is a candidate; anything newer is skipped
// untouched, so a run costs nothing for apartments that were done recently.
//
// WHY 25 AND NOT 30: the cron is DAILY and each run only has budget for a couple of
// apartments (see GUIDE_START_BUDGET_MS), so an apartment is refreshed by whichever run
// first finds it stale — not on a fixed date. At 30 the window would be exactly the
// nominal cadence, leaving zero slack: an apartment that goes stale on a day the budget
// runs out waits for the next run, and the effective interval drifts past a month. 25
// sits UNDER a month, so a monthly cadence is actually reachable with days of slack for
// the queue to work through the fleet.
const GUIDE_MAX_AGE_DAYS = 25

// Absolute deadline for STARTING another apartment (same shape as sync-ical.ts's
// SYNC_FETCH_BUDGET_MS).
//
// WHY AT ALL: the loop below is sequential and one apartment costs ~30-40s typically and
// ~100s worst case (see the timing comments in _lib/guide.ts). Nine apartments match this
// cron's filter, so a full pass cannot fit in maxDuration 150 (vercel.json) under any
// reading — unguarded, the run is killed mid-generation with no summary and no alarm.
//
// THE ARITHMETIC (150s total). The deadline bounds when a generation STARTS, not when it
// finishes, so an apartment begun 1ms before it still runs its full worst case. That
// overrun is part of the budget, not on top of it:
//   - in-flight generation overrunning the deadline  => 100s
//   - JSON response + platform overhead              =>   5s
// 150 - 105 = 45s of start budget. START is captured at handler entry, so the apartment
// query and the guide-row query sit INSIDE the budget instead of competing with the
// reserve (same reasoning as sync-ical.ts).
//
// This is deliberately NOT sync-ical's 115_000: that budget is sized for 10s fetches with
// a 35s reserve, a different job with a different worst case.
//
// A deadline is a PARTIAL RUN, not a failed one — the loop breaks, the response is 200,
// and the freshness gate plus the oldest-first ordering mean the next daily run picks up
// exactly where this one stopped.
const GUIDE_START_BUDGET_MS = 45_000

interface AptRow {
  id: string
  name: string | null
  street: string | null
  street_number: string | null
  neighborhood: string | null
  city: string | null
  country: string | null
  lat: number | null
  lng: number | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startedAt = Date.now()

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const { data, error } = await supabase
    .from('apartments')
    .select('id, name, street, street_number, neighborhood, city, country, lat, lng, hosts!inner(is_test)')
    // TEST ROWS ARE EXCLUDED ON BOTH COLUMNS, AND ONLY THE HOST ONE IS AUTHORITATIVE.
    // MEASURED 23 Aug 2026, not assumed: (1) NO trigger maintains apartments.is_test — it is a
    // one-time backfill, so the next apartment a test host creates defaults to false and would
    // re-enter this cron on the apartment predicate alone; (2) `authenticated` holds column-level
    // UPDATE on apartments.is_test but only SELECT on hosts.is_test. So the apartment column is a
    // denormalised CONVENIENCE that is neither maintained on INSERT nor protected from the host,
    // and hosts!inner is what actually holds. Both predicates run in ONE query against ONE
    // planner — the apartment one is not a "cheap first cut" and buys no speed; it is kept so a
    // SINGLE apartment can be marked test under a real host. It is also the only predicate that
    // can wrongly EXCLUDE a real row, which is why the REVOKE on apartments.is_test is an open
    // follow-up. Both columns are NOT NULL DEFAULT false (verified), so .eq(false) is NULL-safe.
    .eq('is_test', false)
    .eq('hosts.is_test', false)
    .eq('is_visible', true)
    .not('city', 'is', null)
    .neq('city', '')
  if (error) return res.status(500).json({ error: 'Query failed' })

  const apartments = (data ?? []) as AptRow[]

  // Guide ages in ONE query, joined in memory. A PostgREST embed would express the same
  // thing less readably, and the fleet is single digits.
  const { data: guideRows, error: guideErr } = await supabase
    .from('guide_recommendations')
    .select('apartment_id, generated_at')
    .in('apartment_id', apartments.map((a) => a.id))
  if (guideErr) return res.status(500).json({ error: 'Query failed' })

  const generatedAt = new Map<string, number>()
  for (const row of (guideRows ?? []) as Array<{ apartment_id: string; generated_at: string | null }>) {
    const ms = row.generated_at ? Date.parse(row.generated_at) : NaN
    if (Number.isFinite(ms)) generatedAt.set(row.apartment_id, ms)
  }
  // An apartment with no guide row — or an unparseable timestamp — reads as infinitely
  // old, which makes it both always-stale and first in the ordering below with no special
  // case. That is the intended priority: never-generated beats merely-outdated.
  const ageKey = (id: string): number => generatedAt.get(id) ?? -Infinity

  const cutoffMs = startedAt - GUIDE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
  const queue = apartments
    .filter((apt) => ageKey(apt.id) < cutoffMs)
    .sort((a, b) => ageKey(a.id) - ageKey(b.id))
  const skippedFresh = apartments.length - queue.length

  let processed = 0
  let refreshed = 0
  let stoppedEarly = false
  const errors: string[] = []

  // SEQUENTIAL BY DESIGN — do not introduce mapPool here. The POI path's Geoapify leg is
  // rate-gated at module level and Groq's TPM ceiling is org-wide, so concurrency would
  // trade a timeout for a 429.
  for (const apt of queue) {
    // Checked BEFORE starting an apartment, never mid-generation: a generation that has
    // begun always runs to completion, which is what the 100s reserve above pays for.
    if (Date.now() - startedAt >= GUIDE_START_BUDGET_MS) {
      stoppedEarly = true
      break
    }
    processed++
    try {
      const { placeCount } = await generateGuideForApartment(supabase, {
        id: apt.id,
        street: apt.street,
        street_number: apt.street_number,
        neighborhood: apt.neighborhood,
        city: apt.city,
        country: apt.country,
        lat: apt.lat,
        lng: apt.lng,
      })
      if (placeCount > 0) refreshed++
      else errors.push(`${apt.id}: no places (kept previous)`)
    } catch {
      errors.push(`${apt.name ?? apt.id}: failed`)
    }
  }

  // Stopping on the deadline is a SUCCESS: 200 with the counts, and deliberately NOT an
  // entry in `errors` — nothing failed. `stopped_early` plus `remaining` make a
  // budget-bounded run visible from the response alone.
  return res.status(200).json({
    ok: true,
    apartments: apartments.length,
    processed,
    skipped_fresh: skippedFresh,
    refreshed,
    remaining: queue.length - processed,
    stopped_early: stoppedEarly,
    errors,
  })
}
