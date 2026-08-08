import type { SupabaseClient } from '@supabase/supabase-js'
import { randomInt } from 'node:crypto'
import { safeFetchIcal } from './safe-fetch.js'

/**
 * `errors` and `failures` are NOT two views of the same thing — do not simplify one into
 * the other.
 *
 * `errors` is everything worth telling the HOST: it mixes real failures with NOTICES that
 * are not failures at all (the MAX_ICAL_URLS truncation notice, which fires before any
 * fetch is even attempted, and the partial-sync notice when the time budget expires).
 * It is host-facing copy, rendered by PropertySetup.tsx.
 *
 * `failures` counts ONLY feeds that could not be READ (or whose reconcile RPC errored) —
 * the three genuine failure sites below, and nothing else. It exists because
 * cron-sync-ical's wholesale-failure alarm must not count a notice as a failure: keying
 * on `errors.length` classed an apartment with >20 calendar links as failed on every run
 * forever, and two such apartments alone could fire "All 2 attempted calendar syncs
 * failed tonight" when nothing had failed.
 */
export interface SyncResult {
  imported: number
  skipped: number
  errors: string[]
  /** Feeds that could not be read, or whose reconcile RPC errored. Notices are NOT counted. */
  failures: number
  capped?: boolean
}

// Clean, unambiguous reference token for a brand-new feed booking. Unbiased pick from
// crypto randomness (reference_number doubles as the guest access token, so it must not
// be predictable). 32^6 space, <100 bookings → collision is negligible; the RPC only
// consumes new_ref on INSERT (ignored on conflict), so existing references are preserved.
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function generateRef(): string {
  let s = ''
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[randomInt(REF_ALPHABET.length)]
  return `ARR-${s}`
}

// Host-controlled volume caps. A malicious host can point ical_urls at a feed with tens
// of thousands of VEVENTs (each event mints a fresh ARR- guest pass) or paste many URLs.
// A real single-unit calendar is far smaller: one unit holds one guest at a time, so a
// typical host has ~20-50 current+future events. 100 leaves headroom while still cutting
// the attack; a rare maxed-out far-booked unit may exceed it and be skipped (visible
// error). Over the event cap we mint NOTHING (safe default), never a partial batch. Tunable.
const MAX_ICAL_URLS = 20
const MAX_ICAL_EVENTS = 100

export function detectSource(url: string): string {
  if (/airbnb/i.test(url)) return 'airbnb'
  if (/vrbo|homeaway/i.test(url)) return 'vrbo'
  if (/booking\.com/i.test(url)) return 'booking'
  if (/tripadvisor/i.test(url)) return 'tripadvisor'
  if (/guesty/i.test(url)) return 'guesty'
  if (/hostaway/i.test(url)) return 'hostaway'
  if (/lodgify/i.test(url)) return 'lodgify'
  return 'ical'
}

function parseIcal(text: string): Array<{ uid: string; start: string; end: string; summary: string }> {
  const events: Array<{ uid: string; start: string; end: string; summary: string }> = []
  const blocks = text.split('BEGIN:VEVENT')
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i]
    const uid = (block.match(/^UID:(.+)$/m)?.[1] ?? '').trim()
    const rawStart = (block.match(/^DTSTART[^:]*:(.+)$/m)?.[1] ?? '').trim()
    const rawEnd = (block.match(/^DTEND[^:]*:(.+)$/m)?.[1] ?? '').trim()
    const summary = (block.match(/^SUMMARY:(.+)$/m)?.[1] ?? '').trim()
    if (!uid || !rawStart || !rawEnd) continue
    const toDate = (s: string) => s.replace(/T.*/, '').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')
    events.push({ uid, start: toDate(rawStart), end: toDate(rawEnd), summary })
  }
  return events
}

type ReconcileEvent = {
  uid: string
  check_in: string
  check_out: string
  is_block: boolean
  new_ref: string
}

/**
 * Sync one apartment's iCal URLs into bookings via the reconcile_ical_bookings RPC
 * (upsert keyed on apartment_id + ical_uid). The RPC inserts new feed rows, updates
 * dates/status on conflict (never touching guest_id/reference_number, so CSV-attached
 * guest names survive every sync), and soft-cancels feed rows of the same source family
 * whose uid dropped from the feed. Returns counts; never sends notifications (caller does).
 *
 * Events are grouped by base SOURCE and the RPC is called once per source, so the soft-
 * cancel sees the WHOLE source family at once. A source with ANY failed fetch is skipped
 * entirely (no RPC call) so a feed that didn't load can never cancel its own live rows.
 * Error strings are provider-label only — never the URL (which can embed auth tokens).
 *
 * OPTIONAL TIME BUDGET (`opts.deadlineAt`, epoch ms). The URL loop is SEQUENTIAL and
 * MAX_ICAL_URLS (20) x safeFetchIcal's 10s cap = up to 200s for ONE apartment, against a
 * 150s maxDuration — so the cost lives here, in the loop, and so does the bound. Omit
 * `deadlineAt` for the previous unbounded behaviour. It is an ABSOLUTE timestamp rather
 * than a duration because the cron runs apartments CONCURRENTLY against ONE shared run
 * budget, which a per-item duration cannot express.
 */
export async function syncApartmentBookings(
  db: SupabaseClient,
  apartment: { id: string; ical_urls: string | null },
  opts: { deadlineAt?: number } = {}
): Promise<SyncResult> {
  const { deadlineAt } = opts
  let imported = 0
  let skipped = 0
  const errors: string[] = []
  // Incremented at the THREE genuine failure sites only — never alongside a notice push.
  let failures = 0

  const allUrls = (apartment.ical_urls ?? '')
    .split('\n')
    .map((u) => u.trim())
    .filter((u) => u.startsWith('https://'))
  const urls = allUrls.slice(0, MAX_ICAL_URLS)
  if (allUrls.length > urls.length) {
    // NOTICE, not a failure: nothing has been fetched yet, so nothing has failed.
    errors.push(`only the first ${MAX_ICAL_URLS} calendar links were synced`)
  }
  if (urls.length === 0) return { imported, skipped, errors, failures }

  let totalEvents = 0
  let capped = false

  // Accumulate parsed events per base source; track which sources had ≥1 URL and which
  // had at least one failed fetch (so they're excluded from reconciliation this run).
  const eventsBySource = new Map<string, ReconcileEvent[]>()
  const sourcesSeen = new Set<string>()
  const incompleteSources = new Set<string>()

  // A URL dropped by MAX_ICAL_URLS is an UNREAD feed, exactly like a failed fetch — so its
  // source must be marked incomplete too. Without this, a dropped link sharing a source with
  // a kept one (e.g. two airbnb feeds, the 21st dropped) would reconcile that source from a
  // PARTIAL uid set, and the RPC's soft-cancel would cancel live bookings that existed only
  // in the dropped feed.
  for (const dropped of allUrls.slice(MAX_ICAL_URLS)) incompleteSources.add(detectSource(dropped))

  // Set when the time budget expired mid-loop, so the host-facing error is pushed once
  // rather than per unread URL.
  let ranOutOfTime = false

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]

    // Time budget expired. Every URL we have NOT fetched — this one and all the ones
    // behind it — is an UNREAD FEED, behaviourally identical to a link dropped by
    // MAX_ICAL_URLS above, so its source is marked incomplete for exactly the same
    // reason: reconciling a source from a PARTIAL uid set would let the RPC's soft-cancel
    // CANCEL LIVE BOOKINGS that existed only in the unread feed. That is guest-visible
    // data loss and strictly worse than the timeout this budget exists to prevent.
    //
    // Note the contrast with the `capped` exit below, and keep it: `capped` RETURNS before
    // reconciliation and mints nothing, so it never needed incompleteSources. This path
    // falls THROUGH to reconciliation — sources fully fetched before the deadline still
    // reconcile normally, because a deadline is a partial sync, not a failed one.
    if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
      for (const unread of urls.slice(i)) incompleteSources.add(detectSource(unread))
      ranOutOfTime = true
      break
    }

    const source = detectSource(url)
    sourcesSeen.add(source)
    if (!eventsBySource.has(source)) eventsBySource.set(source, [])
    try {
      const response = await safeFetchIcal(url)
      if (!response.ok) {
        errors.push(`${source}: HTTP ${response.status}`)
        failures++ // FAILURE: the feed answered, but not with a calendar we can read.
        incompleteSources.add(source)
        continue
      }
      const events = parseIcal(response.text)
      const bucket = eventsBySource.get(source)!
      for (const event of events) {
        if (totalEvents >= MAX_ICAL_EVENTS) { capped = true; break }
        bucket.push({
          uid: event.uid,
          check_in: event.start,
          check_out: event.end,
          is_block: /blocked|not available|unavailable|closed/i.test(event.summary),
          new_ref: generateRef(),
        })
        totalEvents++
      }
      if (capped) break
    } catch {
      // safeFetchIcal threw (blocked host, timeout, oversize, non-https, redirect cap,
      // transport error). Generic host-facing string only — no URL, no blocked-vs-network
      // distinction (no probing signal). Mark the source incomplete so we don't reconcile.
      errors.push(`${source}: couldn't be used (check it's a public https calendar link)`)
      failures++ // FAILURE: the feed could not be read at all.
      incompleteSources.add(source)
    }
  }

  // Generic, host-safe, no URL and no host — same register as the fetch-failure string.
  // NOTICE, not a failure: the feeds we DID read were read fine — this is a partial sync.
  if (ranOutOfTime) {
    errors.push("the sync ran out of time - not all calendars were read")
  }

  // Over the per-sync event cap => an abusive or malformed feed. Mint NOTHING and let the
  // caller alert: a partial 100-pass batch would still be an amplifier.
  if (capped) {
    // The appended string is a NOTICE too (the cap is our own safety limit, not a feed
    // fault), so `failures` carries only whatever genuinely failed before the cap was hit.
    // The caller alerts on `capped` in its own right, not through this count.
    return {
      imported: 0,
      skipped: 0,
      errors: [...errors, 'too many calendar events - sync skipped'],
      failures,
      capped: true,
    }
  }

  // Reconcile each fully-fetched source exactly once. A source with any failed fetch is
  // skipped (the error is already recorded) so the RPC's soft-cancel never fires against
  // a feed that didn't fully load.
  for (const source of sourcesSeen) {
    if (incompleteSources.has(source)) continue
    const p_events = eventsBySource.get(source) ?? []
    const { data, error } = await db.rpc('reconcile_ical_bookings', {
      p_apartment_id: apartment.id,
      p_source: source,
      p_events,
    })
    if (error) {
      errors.push(`${source}: sync failed`)
      failures++ // FAILURE: the feed was read, but reconciling it into bookings errored.
      continue
    }
    const res = (data ?? {}) as { imported?: number; updated?: number; cancelled?: number }
    imported += res.imported ?? 0
    skipped += res.updated ?? 0
  }

  return { imported, skipped, errors, failures }
}
