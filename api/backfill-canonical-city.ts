import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'
import { reverseGeocode } from './_lib/geo.js'

// One-shot backfill: give every already-existing visible apartment a canonical city identity.
// New apartments get theirs from /api/resolve-canonical-city on address save; this covers the
// rows that predate that.
//
// IDEMPOTENT AND RE-RUNNABLE: the query itself skips anything that already has a key, so a
// second run is a no-op rather than 4 more LocationIQ calls per apartment.
//
// CRON_SECRET-gated via the shared helper (same gate as every cron), NOT host auth: it touches
// every host's rows, so there is no single owner who could legitimately authorise it.

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Latest elapsed time at which a NEW apartment may still be STARTED. Past it we defer rather
// than begin work that cannot finish, so the run always reaches its own JSON summary instead of
// being killed mid-flight — the silent-truncation failure fixed in d254df9.
//
// ⚠ RE-DERIVE THIS if the rate gate, the reverse-geocode timeout or maxDuration changes:
//   worst case per apartment:
//     LocationIQ rate gate (MIN_START_GAP_MS, _lib/geo.ts)  =  0.55s
//     reverseGeocode AbortController timeout                =  3.00s
//     Supabase update                                       = ~0.30s
//                                                           -> ~3.85s, call it 4s
//   reserve for the pre-loop query and the response: 10s
//   maxDuration 150s (vercel.json) - 4 - 10 = 136s
const START_DEADLINE_MS = 136_000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  // Captured at handler entry so the pre-loop query is inside the budget rather than competing
  // with the reserve (the d254df9 correction).
  const startedAt = Date.now()

  // `canonical_resolved_at IS NULL` is what makes this genuinely idempotent, and it is NOT
  // redundant with the key filter. A row can resolve to a city with NO valid country_code, which
  // stores city/country/resolved_at but leaves canonical_city_key NULL by design. Filtering on
  // the key alone would re-pick that row on EVERY future run and spend another LocationIQ call
  // forever. Filtering on resolved_at means "never successfully attempted": a row whose resolve
  // genuinely failed writes nothing, so resolved_at stays NULL and it IS retried next run.
  const { data: apts, error } = await supabase
    .from('apartments')
    .select('id, lat, lng')
    .eq('is_visible', true)
    .is('canonical_city_key', null)
    .is('canonical_resolved_at', null)
    .not('lat', 'is', null)
    .not('lng', 'is', null)
  if (error) return res.status(500).json({ error: 'Query failed' })

  const candidates = (apts ?? []) as Array<{ id: string; lat: number | null; lng: number | null }>

  let resolved = 0
  let unresolved = 0
  let deferred = 0
  // Counted separately from `resolved` because it is NOT a usable outcome for commit 2: the city
  // resolved but the country_code did not, so canonical_city_key is NULL and this apartment will
  // fall back to per-apartment behaviour. Without its own bucket it would hide inside `resolved`
  // and a run that produced zero usable keys would report as a full success.
  let resolvedNoKey = 0

  // SEQUENTIAL, concurrency 1 — deliberately, and not a missed optimisation. The 550ms gate in
  // _lib/geo.ts serialises request START times across the whole process, so parallel callers
  // would queue on the gate anyway while each holding an open lambda slot. Same reasoning as the
  // concurrency-1 fix in cron-refresh-events (d254df9).
  for (const apt of candidates) {
    if (Date.now() - startedAt > START_DEADLINE_MS) {
      // Deferred, not failed: the row keeps its NULL key, is picked up by the next run, and in
      // commit 2 a null key falls back to per-apartment behaviour. Re-run to finish.
      deferred++
      continue
    }
    if (typeof apt.lat !== 'number' || typeof apt.lng !== 'number') { unresolved++; continue }

    const canonical = await reverseGeocode(apt.lat, apt.lng)
    if (!canonical) {
      // Write nothing on failure, so resolved_at stays NULL and the next run retries this row.
      // Logged (id only, never a URL — the LocationIQ key travels in the query string) because
      // otherwise a vendor outage and a genuinely unresolvable coordinate look identical in the
      // summary.
      console.warn('[backfill-canonical-city] reverse geocode returned nothing', { aptId: apt.id })
      unresolved++
      continue
    }

    const { error: upErr } = await supabase
      .from('apartments')
      .update({
        canonical_city: canonical.city,
        canonical_country: canonical.country,
        canonical_country_code: canonical.countryCode,
        canonical_city_key: canonical.cityKey,
        canonical_resolved_at: new Date().toISOString(),
      })
      .eq('id', apt.id)
    if (upErr) {
      console.error('[backfill-canonical-city] update failed —', upErr.message?.slice(0, 120))
      unresolved++
      continue
    }
    if (canonical.cityKey) resolved++
    else resolvedNoKey++
  }

  return res.status(200).json({
    ok: true,
    candidates: candidates.length,
    resolved,
    resolvedNoKey,
    unresolved,
    deferred,
  })
}
