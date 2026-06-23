import type { SupabaseClient } from '@supabase/supabase-js'
import { safeFetchIcal } from './safe-fetch.js'

export interface SyncResult {
  imported: number
  skipped: number
  errors: string[]
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

/**
 * Sync one apartment's iCal URLs into bookings. Dedupes by reference_number (iCal UID)
 * + apartment_id. Returns counts; never sends notifications (caller does). Error strings
 * are provider-label only — never the URL (which can embed auth tokens).
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

  for (const url of urls) {
    const source = detectSource(url)
    try {
      const response = await safeFetchIcal(url)
      if (!response.ok) {
        errors.push(`${source}: HTTP ${response.status}`)
        continue
      }
      const text = response.text
      const events = parseIcal(text)

      for (const event of events) {
        const isBlock = /blocked|not available|unavailable|closed/i.test(event.summary)

        const { data: existing } = await db
          .from('bookings')
          .select('id')
          .eq('reference_number', event.uid)
          .eq('apartment_id', apartment.id)
          .maybeSingle()

        if (existing) { skipped++; continue }

        const { error: insertErr } = await db.from('bookings').insert({
          apartment_id: apartment.id,
          guest_id: null,
          check_in: event.start,
          check_out: event.end,
          status: 'confirmed',
          reference_number: event.uid,
          source: isBlock ? `${source}_block` : source,
        })
        if (insertErr) { errors.push(`${source}: insert failed`) } else { imported++ }
      }
    } catch {
      // safeFetchIcal threw (blocked host, timeout, oversize, non-https, redirect cap,
      // transport error). Generic host-facing string only — no URL, no blocked-vs-network
      // distinction (no probing signal).
      errors.push(`${source}: couldn't be used (check it's a public https calendar link)`)
    }
  }

  return { imported, skipped, errors }
}
