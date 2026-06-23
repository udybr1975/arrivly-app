import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'
import { generateCityEvents } from './_lib/city-events.js'
import { sendNtfy } from './_lib/ntfy.js'

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
  let refreshed = 0
  let failed = 0

  for (const apt of candidates) {
    const { payload } = await generateCityEvents({ id: apt.id, city: apt.city, country: apt.country })
    if (!payload) {
      // Generation failed/quota — leave the existing row intact (stale but safe).
      failed++
      continue
    }
    const { error: upErr } = await supabase
      .from('city_events_cache')
      .upsert(
        { apartment_id: apt.id, payload, generated_at: new Date().toISOString() },
        { onConflict: 'apartment_id' }
      )
    if (upErr) {
      console.error('[cron-refresh-events] upsert failed —', upErr.message?.slice(0, 120))
      failed++
    } else {
      refreshed++
    }
  }

  // Signal only a wholesale failure (likely quota/outage) — never throw.
  if (candidates.length > 0 && refreshed === 0) {
    await sendNtfy({
      title: 'Arrivly city-events refresh',
      message: `All ${candidates.length} event refreshes failed today.`,
      priority: 'high',
    })
  }

  return res.status(200).json({ ok: true, candidates: candidates.length, refreshed, failed })
}
