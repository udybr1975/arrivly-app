import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'
import { fetchViatorExperiences, fetchTiqetsExperiences } from './_lib/experiences-providers.js'
import { sendNtfy } from './_lib/ntfy.js'
import { mapPool } from './_lib/pool.js'

// Daily cron (05:00 UTC). Refreshes the experiences cache ONLY for visible apartments
// with a current or soon-starting booking (current/next 7 days), so provider-API spend
// is bounded to apartments a guest is actually about to use. Every other apartment stays
// lazy-fill-on-demand. Stale-safe: a failed/empty provider fetch leaves the existing
// cache row intact (guests keep last-good experiences, never an empty panel). Only
// PRODUCT DATA is cached here — outbound affiliate links are always built at serve time.

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface AptRow { id: string; city: string | null; country: string | null; lat: number | null; lng: number | null }

function utcDay(offsetDays: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const today = utcDay(0)
  const plus7 = utcDay(7)

  const { data: bookings, error: bErr } = await supabase
    .from('bookings')
    .select('apartment_id, source, check_in, check_out')
    .in('status', ['confirmed', 'completed'])
    .gte('check_out', today)
    .lte('check_in', plus7)
  if (bErr) return res.status(500).json({ error: 'Query failed' })

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

  const { data: apts, error: aErr } = await supabase
    .from('apartments')
    .select('id, city, country, lat, lng')
    .in('id', aptIds)
    .eq('is_visible', true)
    .not('city', 'is', null)
  if (aErr) return res.status(500).json({ error: 'Query failed' })

  const candidates = (apts ?? []) as AptRow[]

  // Concurrency 2: each iteration makes two provider API calls; keep it small to avoid
  // concentrating provider-quota bursts while still fitting inside the 60s maxDuration.
  // Each task performs its own stale-safe upserts and returns whether it wrote anything.
  const outcomes = await mapPool(candidates, 2, async (apt): Promise<{ ok: boolean }> => {
    const city = apt.city ?? ''
    const [viator, tiqets] = await Promise.all([
      fetchViatorExperiences(apt.lat, apt.lng, city),
      fetchTiqetsExperiences(apt.lat, apt.lng, city),
    ])
    const stamp = new Date().toISOString()
    const expires = new Date(Date.now() + CACHE_TTL_MS).toISOString()

    let wrote = false
    for (const [provider, list] of [
      ['viator', viator],
      ['tiqets', tiqets],
    ] as const) {
      // Stale-safe: only overwrite when we actually got fresh, non-empty data.
      if (list.length === 0) continue
      const { error: upErr } = await supabase
        .from('experiences_cache')
        .upsert(
          { apartment_id: apt.id, provider, experiences: list, fetched_at: stamp, expires_at: expires },
          { onConflict: 'apartment_id,provider' }
        )
      if (upErr) console.error('[cron-refresh-experiences] upsert failed —', upErr.message?.slice(0, 120))
      else wrote = true
    }
    return { ok: wrote }
  })

  let refreshed = 0
  let failed = 0
  for (const o of outcomes) {
    if (o.ok) refreshed++
    else failed++
  }

  // Heads-up when nothing got refreshed. NOTE: adapters return [] for BOTH a real
  // failure (outage/quota) AND a city with genuinely zero provider inventory, and the
  // cron cannot tell them apart — so this is 'default' priority (a nudge to check
  // provider status if unexpected), not a high-priority "everything is broken" alarm.
  if (candidates.length > 0 && refreshed === 0) {
    await sendNtfy({
      title: 'Bemgu experiences refresh',
      message: `No experiences refreshed today across ${candidates.length} apartment(s) — empty inventory or provider issue.`,
      priority: 'default',
    })
  }

  return res.status(200).json({ ok: true, candidates: candidates.length, refreshed, failed })
}
