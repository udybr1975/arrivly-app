import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveGuestAccess } from './_lib/guest-access.js'
import { generateDailySuggestion } from './_lib/greeting.js'
import { scrubErr } from './_lib/scrub.js'
import { sendNtfy } from './_lib/ntfy.js'

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

    // Cache miss: load apartment context for the prompt (host_id added for the spend brake)
    const { data: apartment } = await db
      .from('apartments')
      .select('host_id, neighborhood, city')
      .eq('id', apt)
      .maybeSingle()

    // ── Per-host spend brake + alarm on the paid path (cache MISS only, BEFORE Gemini) ──
    // Each miss spends one gemini-2.5-flash call on the shared GEMINI_API_KEY. The cache
    // caps a single booking at 4/day, so the exposure is MANY passes (self-minted by a
    // hostile host). This cross-instance atomic counter, keyed on the apartment's HOST,
    // caps generations per host per hour regardless of accumulated passes. Guest-facing:
    // on breach we DEGRADE to null (static copy), never 429 the guest hero. ONE ntfy at
    // limit+1. FAIL-CLOSED on both an unresolved host_id and a counter error — see below.
    // ASCII-only alert; env var NAME + public project ID only, never a key value. LIMIT is
    // intentionally low for current scale (few hosts); raise when Tier 4 / many hosts exist.
    const DAILY_GREETING_HOURLY_LIMIT = 50
    const greetingHostId = typeof apartment?.host_id === 'string' ? apartment.host_id : null
    // FAIL CLOSED. `.maybeSingle()` returns {data:null,error} instead of throwing, so a failed
    // apartment read would otherwise SKIP the whole brake and generate unbraked+unalarmed —
    // under the very DB stress that also breaks the counter. `apartments.host_id` is NOT NULL
    // and the row must exist (resolveGuestAccess just matched a booking against it), so null
    // here means DB failure, never a valid state. Costs only the static fallback line.
    if (!greetingHostId) {
      console.warn('[daily-greeting] host_id unresolved (fail-closed)')
      return res.status(200).json({ suggestion: null })
    }
    {
      const { data: greetCount, error: greetCountErr } = await db.rpc('bump_api_counter', {
        p_host_id: greetingHostId,
        p_endpoint: 'daily-greeting',
      })
      if (greetCountErr) {
        // FAIL CLOSED, deliberately — the opposite of the sibling brakes, because here the
        // blocked behaviour IS the fallback: a guest gets the same static line either way.
        // Failing closed costs a cosmetic sentence; failing open would spend uncapped Gemini
        // during exactly the burst that broke the counter (a hot single-row counter under
        // load is what produces lock contention and statement timeouts).
        console.warn('[daily-greeting] counter bump failed (fail-closed)', scrubErr(greetCountErr, 120))
        return res.status(200).json({ suggestion: null })
      } else if (typeof greetCount !== 'number') {
        // No usable count (e.g. the RPC's return shape changed) — the brake would otherwise
        // disable itself silently. Log loudly and generate: the shape is stable today, so a
        // hard block here would be a self-inflicted outage on an unproven failure mode.
        console.error('[daily-greeting] counter returned a non-numeric count — brake inactive', typeof greetCount)
      } else if (greetCount > DAILY_GREETING_HOURLY_LIMIT) {
        if (greetCount === DAILY_GREETING_HOURLY_LIMIT + 1) {
          try {
            await sendNtfy({
              title: 'Bemgu spend alert: daily-greeting',
              message:
                `Feature: Daily guest greeting (/api/daily-greeting)\n` +
                `Host ${greetingHostId} generated ${greetCount} greetings this hour (limit ${DAILY_GREETING_HOURLY_LIMIT}).\n` +
                `Provider: AI_PROVIDER_GREETING (default GROQ). Host may be a TARGET, not the culprit.\n` +
                `DISABLE: rotate the ACTIVE provider's key - GROQ_API_KEY, or GEMINI_API_KEY if flipped.\n` +
                `ACTION: INVESTIGATE, do not auto-block. Key = apartment host: culprit or VICTIM (leaked token). Revoke token or block per findings.`,
              priority: 'high',
            })
          } catch (e) {
            console.warn('[daily-greeting] alarm failed (non-fatal)', scrubErr(e, 120))
          }
        }
        return res.status(200).json({ suggestion: null })
      }
    }

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
