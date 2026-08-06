import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'
import { generateCityEvents } from './_lib/city-events.js'
import { sendNtfy } from './_lib/ntfy.js'
import { mapPool } from './_lib/pool.js'

// Daily cron (04:00 UTC). Refreshes the city_events cache ONLY for visible apartments
// that have a current or soon-starting booking (current/next 7 days) — so the AI spend
// is bounded to apartments a guest is actually about to use. Every other apartment
// stays lazy-fill-on-demand. Stale-safe: if generation fails for an apartment, the
// existing cache row is left intact (guests keep last-good events, never an empty panel).

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface AptRow { id: string; city: string | null; country: string | null }

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

  // Parallelise with a deliberately LOW limit (2): each iteration is a Gemini call
  // against the events key's free-tier daily cap, so keep concurrency small to avoid
  // concentrating quota bursts while still fitting a multi-apartment run inside the
  // 150s maxDuration (vercel.json). Each task returns { ok } and performs its own stale-safe upsert;
  // counts are aggregated in a single pass after the pool, so totals + the
  // wholesale-failure ntfy condition are identical to the sequential version.
  const outcomes = await mapPool(candidates, 2, async (apt): Promise<{ ok: boolean; skipped?: boolean }> => {
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
  for (const o of outcomes) {
    if (o.skipped) skipped++
    else if (o.ok) refreshed++
    else failed++
  }

  // Signal only a wholesale failure (likely quota/outage) — never throw.
  // KNOWN AND DELIBERATELY LEFT AS-IS (B3.1): a run that is ENTIRELY SKIPS now satisfies
  // `refreshed === 0` and WILL fire this alarm, whose text then says "All N event refreshes
  // failed today" — which is inaccurate, since nothing failed and every existing panel was
  // deliberately preserved. Plausible in a genuinely quiet week across few apartments. The
  // condition that matches the intent is `refreshed === 0 && skipped === 0`; it was NOT changed
  // here because that is an alarm-semantics change and this task is scoped to the data-loss fix.
  // See the commit body. Until then, read this alert together with the `skipped` count below.
  if (candidates.length > 0 && refreshed === 0) {
    await sendNtfy({
      title: 'Bemgu city-events refresh',
      message: `All ${candidates.length} event refreshes failed today.`,
      priority: 'high',
    })
  }

  return res.status(200).json({ ok: true, candidates: candidates.length, refreshed, failed, skipped })
}
