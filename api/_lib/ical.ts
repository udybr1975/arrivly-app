import type { SupabaseClient } from '@supabase/supabase-js'
import { randomInt } from 'node:crypto'
import { safeFetchIcal } from './safe-fetch.js'

export interface SyncResult {
  imported: number
  skipped: number
  errors: string[]
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
 */
export async function syncApartmentBookings(
  db: SupabaseClient,
  apartment: { id: string; ical_urls: string | null }
): Promise<SyncResult> {
  let imported = 0
  let skipped = 0
  const errors: string[] = []

  const urls = (apartment.ical_urls ?? '')
    .split('\n')
    .map((u) => u.trim())
    .filter((u) => u.startsWith('https://'))
  if (urls.length === 0) return { imported, skipped, errors }

  // Accumulate parsed events per base source; track which sources had ≥1 URL and which
  // had at least one failed fetch (so they're excluded from reconciliation this run).
  const eventsBySource = new Map<string, ReconcileEvent[]>()
  const sourcesSeen = new Set<string>()
  const incompleteSources = new Set<string>()

  for (const url of urls) {
    const source = detectSource(url)
    sourcesSeen.add(source)
    if (!eventsBySource.has(source)) eventsBySource.set(source, [])
    try {
      const response = await safeFetchIcal(url)
      if (!response.ok) {
        errors.push(`${source}: HTTP ${response.status}`)
        incompleteSources.add(source)
        continue
      }
      const events = parseIcal(response.text)
      const bucket = eventsBySource.get(source)!
      for (const event of events) {
        bucket.push({
          uid: event.uid,
          check_in: event.start,
          check_out: event.end,
          is_block: /blocked|not available|unavailable|closed/i.test(event.summary),
          new_ref: generateRef(),
        })
      }
    } catch {
      // safeFetchIcal threw (blocked host, timeout, oversize, non-https, redirect cap,
      // transport error). Generic host-facing string only — no URL, no blocked-vs-network
      // distinction (no probing signal). Mark the source incomplete so we don't reconcile.
      errors.push(`${source}: couldn't be used (check it's a public https calendar link)`)
      incompleteSources.add(source)
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
      continue
    }
    const res = (data ?? {}) as { imported?: number; updated?: number; cancelled?: number }
    imported += res.imported ?? 0
    skipped += res.updated ?? 0
  }

  return { imported, skipped, errors }
}
