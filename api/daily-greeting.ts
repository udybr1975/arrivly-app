import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveGuestAccess } from './_lib/guest-access.js'
import { generateDailySuggestion } from './_lib/greeting.js'

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_RE = /^[A-Za-z0-9-]{4,32}$/
const DAY_PARTS = ['morning', 'afternoon', 'evening', 'night'] as const
type DayPart = typeof DAY_PARTS[number]

// Helsinki "today" (YYYY-MM-DD) — matches resolveGuestAccess's booking gating timezone.
function helsinkiToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Helsinki' }).split(' ')[0]
}

function svc() {
  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function scrubErr(e: unknown): string {
  return String((e as Error)?.message ?? e)
    .replace(/AIza[0-9A-Za-z_\-]{10,}/g, 'AIza_REDACTED')
    .replace(/key=[^&\s]+/gi, 'key=REDACTED')
    .slice(0, 160)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const body = req.body as Record<string, unknown> | null

  const apt = typeof body?.apt === 'string' ? body.apt.trim() : ''
  // token may be absent (returns 'public' tier → null suggestion, no Gemini call)
  const rawToken = typeof body?.token === 'string' ? body.token.trim() : null
  const token = rawToken !== null && TOKEN_RE.test(rawToken) ? rawToken : null
  const dayPart = typeof body?.day_part === 'string' ? body.day_part.trim() : ''

  if (!apt || !UUID_RE.test(apt)) return res.status(400).json({ error: 'invalid_apartment' })
  if (!dayPart || !DAY_PARTS.includes(dayPart as DayPart)) return res.status(400).json({ error: 'invalid_day_part' })

  // local_date is always derived server-side from Helsinki timezone (same as resolveGuestAccess)
  // to prevent cache flooding via arbitrary client-supplied dates.
  const localDate = helsinkiToday()

  // temp: accept only finite numbers in a realistic range; reject Infinity/NaN/extreme values
  const rawTemp = body?.temp
  const temp =
    typeof rawTemp === 'number' && Number.isFinite(rawTemp) && rawTemp >= -80 && rawTemp <= 60
      ? rawTemp
      : null

  const condition =
    typeof body?.condition === 'string' && body.condition.trim()
      ? body.condition.trim().slice(0, 100)
      : null

  const db = svc()
  try {
    // service-role OK — access is gated by the token→booking chain in resolveGuestAccess.
    // Only verified guests (in-dates confirmed booking) receive AI suggestions.
    // Non-verified paths return null so the UI falls back to static copy.
    const access = await resolveGuestAccess(db, apt, token)
    if (access.tier !== 'verified' || !access.bookingId) {
      return res.status(200).json({ suggestion: null })
    }
    const bookingId = access.bookingId

    // Day of stay: whole days since check-in (UTC-midnight diff on YYYY-MM-DD strings,
    // so no timezone drift) + 1, clamped to a minimum of 1.
    let stayDay = 1
    if (access.checkIn) {
      const diffMs = Date.parse(localDate + 'T00:00:00Z') - Date.parse(access.checkIn + 'T00:00:00Z')
      stayDay = Math.max(1, Math.floor(diffMs / 86_400_000) + 1)
    }

    // Cache read — keyed per booking now (booking_id, local_date, day_part)
    const { data: cached } = await db
      .from('daily_greetings')
      .select('suggestion')
      .eq('booking_id', bookingId)
      .eq('local_date', localDate)
      .eq('day_part', dayPart)
      .maybeSingle()

    if (cached?.suggestion) {
      return res.status(200).json({ suggestion: cached.suggestion })
    }

    // Cache miss: load apartment context for the prompt
    const { data: apartment } = await db
      .from('apartments')
      .select('neighborhood, city')
      .eq('id', apt)
      .maybeSingle()

    // Gather up to 5 nearby place names: host_picks first, then guide_recommendations
    const [{ data: picks }, { data: guide }] = await Promise.all([
      db.from('host_picks').select('name').eq('apartment_id', apt).order('display_order').limit(5),
      db.from('guide_recommendations').select('categories').eq('apartment_id', apt).maybeSingle(),
    ])

    const placeNames: string[] = []
    for (const p of picks ?? []) {
      if (placeNames.length >= 5) break
      if (typeof p.name === 'string' && p.name.trim()) placeNames.push(p.name.trim())
    }
    if (placeNames.length < 5 && guide?.categories) {
      const cats = guide.categories as Record<string, Array<{ name?: string }>>
      for (const items of Object.values(cats)) {
        if (placeNames.length >= 5) break
        if (!Array.isArray(items)) continue
        for (const item of items) {
          if (placeNames.length >= 5) break
          if (typeof item.name === 'string' && item.name.trim()) {
            placeNames.push(item.name.trim())
          }
        }
      }
    }

    // Sliding do-not-repeat window: this booking's most recent ~6 suggestions
    // (most-recent first). Bounds the anti-repeat list to recent history, not the whole stay.
    const { data: recentRows } = await db
      .from('daily_greetings')
      .select('suggestion')
      .eq('booking_id', bookingId)
      .order('local_date', { ascending: false })
      .order('generated_at', { ascending: false })
      .limit(6)
    const recent: string[] = (recentRows ?? [])
      .map(r => (typeof r.suggestion === 'string' ? r.suggestion.trim() : ''))
      .filter(Boolean)

    const { suggestion } = await generateDailySuggestion({
      apartmentId: apt,
      localDate,
      dayPart: dayPart as DayPart,
      temp,
      condition,
      neighborhood: apartment?.neighborhood ?? null,
      city: apartment?.city ?? null,
      places: placeNames,
      stayDay,
      recent,
    })

    if (!suggestion) {
      return res.status(200).json({ suggestion: null })
    }

    // Cache insert; on unique-key violation (concurrent request already won the race),
    // re-select and return the existing row
    const weatherSummary = ((temp != null ? `${temp}°C ` : '') + (condition ?? '')).trim()

    const { error: insertErr } = await db.from('daily_greetings').insert({
      apartment_id: apt,
      booking_id: bookingId,
      local_date: localDate,
      day_part: dayPart,
      stay_day: stayDay,
      suggestion,
      weather_summary: weatherSummary || null,
    })

    if (insertErr) {
      // Unique-key violation (23505) on (booking_id, local_date, day_part) from a concurrent
      // insert — return whichever row won. Other insert errors also fall here; re-select
      // returns the just-generated suggestion as fallback so the guest still receives a response.
      const { data: existing } = await db
        .from('daily_greetings')
        .select('suggestion')
        .eq('booking_id', bookingId)
        .eq('local_date', localDate)
        .eq('day_part', dayPart)
        .maybeSingle()
      return res.status(200).json({ suggestion: existing?.suggestion ?? suggestion })
    }

    return res.status(200).json({ suggestion })
  } catch (e) {
    console.error('[daily-greeting] unexpected', scrubErr(e))
    // Always degrade to null — never 5xx the guest hero
    return res.status(200).json({ suggestion: null })
  }
}
