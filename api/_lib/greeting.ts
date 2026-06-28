import { GoogleGenAI } from '@google/genai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { withRetry } from './retry.js'
import type { AptInput } from './guide.js'

export type { AptInput }

const MODEL = 'gemini-2.5-flash'
const cap = (s: string | null | undefined) => (s ?? '').slice(0, 200)

function scrubErr(e: unknown): string {
  return String((e as Error)?.message ?? e)
    .replace(/AIza[0-9A-Za-z_\-]{10,}/g, 'AIza_REDACTED')
    .replace(/key=[^&\s]+/gi, 'key=REDACTED')
    .slice(0, 160)
}

// Generates and saves a stable neighbourhood character blurb for the apartment.
// Called after a successful guide generation so location data is already confirmed.
// Note: not triggered on basic-info save (that path is client-side, no server hook).
export async function generateGreetingBlurb(
  db: SupabaseClient,
  apt: AptInput
): Promise<{ ok: boolean }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('[greeting] GEMINI_API_KEY not configured')
    return { ok: false }
  }

  const locationParts = [
    apt.street_number && apt.street
      ? `${cap(apt.street_number)} ${cap(apt.street)}`
      : cap(apt.street),
    cap(apt.neighborhood),
    cap(apt.city),
    cap(apt.country),
  ].filter(Boolean)

  const prompt =
    `A guest is arriving at a short-term rental in ${locationParts.join(', ')}. ` +
    `Write ONE warm paragraph (2–3 sentences, around 45 words) that welcomes them to this exact ` +
    `place by capturing its character — what the area is known for, its feel, what is nearby. ` +
    `Begin by naming the neighbourhood or city itself (for example, "El Born is…" or ` +
    `"Barcelona's Gothic Quarter…"). Do NOT open with a participle, gerund, or "-ing" phrase — ` +
    `specifically never begin with words like "Stepping", "Nestled", "Tucked", "Wandering", or "Strolling". ` +
    `Warm, first-person-host tone, present tense. No greeting words ("Dear", "Welcome", "Hello"). ` +
    `No weather, no signature, no lists, no markdown, no emojis — just the descriptive paragraph. ` +
    `Write in English.`

  const ai = new GoogleGenAI({ apiKey })

  const generate = async () => {
    const controller = new AbortController()
    // 12s per attempt × 2 attempts (1 retry) + 600ms delay ≈ 24.6s worst case
    const timer = setTimeout(() => controller.abort(), 12000)
    try {
      return await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 256,
          abortSignal: controller.signal,
        },
      })
    } finally {
      clearTimeout(timer)
    }
  }

  let text = ''
  try {
    const response = await withRetry(generate, { retries: 1, baseDelayMs: 600 })
    text = response.text?.trim() ?? ''
  } catch (e) {
    console.error('[greeting] blurb threw', { aptId: apt.id, msg: scrubErr(e) })
    return { ok: false }
  }

  if (!text) {
    console.error('[greeting] blurb empty', { aptId: apt.id })
    return { ok: false }
  }

  const { error } = await db
    .from('apartments')
    .update({ greeting_blurb: text })
    .eq('id', apt.id)

  if (error) {
    console.error('[greeting] blurb save failed', {
      aptId: apt.id,
      msg: error.message?.slice(0, 120),
    })
    return { ok: false }
  }

  return { ok: true }
}

export interface DailySuggestionArgs {
  apartmentId: string
  localDate: string
  dayPart: 'morning' | 'afternoon' | 'evening' | 'night'
  temp: number | null
  condition: string | null
  neighborhood: string | null
  city: string | null
  places: string[]
  stayDay: number
  recent: string[]
}

// Pure generation — no DB writes. The endpoint (api/daily-greeting.ts) handles caching.
export async function generateDailySuggestion(
  args: DailySuggestionArgs
): Promise<{ suggestion: string | null }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('[greeting] GEMINI_API_KEY not configured')
    return { suggestion: null }
  }

  const { dayPart, temp, condition, neighborhood, city, places, stayDay, recent } = args

  const weatherLine =
    temp != null
      ? `The current weather is ${temp}°C${condition ? `, ${condition}` : ''}.`
      : condition
      ? `Current conditions: ${condition}.`
      : ''

  const placesLine =
    places.length > 0
      ? `Nearby places you could mention if one fits: ${places.slice(0, 5).join(', ')}.`
      : ''

  // HARD day-part constraint: explicit ALLOW + DENY per part, phrased as a firm instruction.
  const dayPartRules: Record<DailySuggestionArgs['dayPart'], { allow: string; deny: string }> = {
    morning: {
      allow: 'coffee, breakfast, a bakery, a morning market, an early walk, or a sunrise viewpoint',
      deny: 'dinner, bars, nightlife, clubs, sunset-only or "tonight" content',
    },
    afternoon: {
      allow: 'lunch, sights, museums, shops, parks, or a daytime walk',
      deny: 'breakfast-specific spots, nightlife, bars, clubs, "this evening" or "tonight" content',
    },
    evening: {
      allow: 'dinner, the sunset, drinks, early live music, or an evening stroll',
      deny: 'breakfast, "this morning", or midday-only venues that have already closed',
    },
    night: {
      allow: 'a late bite, a calm late stroll, a bar, winding down, or night views',
      deny: 'breakfast, morning markets, "this morning" or "this afternoon" content',
    },
  }
  const rule = dayPartRules[dayPart]
  const dayPartBlock =
    `It is ${dayPart}. Suggest ONLY ${dayPart}-appropriate things: ${rule.allow}. ` +
    `Never mention ${rule.deny}.`

  // Anti-repeat: a bounded do-not-repeat list of what the guest has already seen.
  const recentBlock =
    recent.length > 0
      ? `Do NOT repeat any of these the guest has already seen: ` +
        `${recent.map(r => r.slice(0, 120)).join('; ')}. Choose something different.`
      : ''

  // Stay-day nudge: ease in on day 1; lean to less-obvious / different-kind picks from day 3.
  const stayDayBlock =
    stayDay <= 1
      ? `This is day ${stayDay} of the guest's stay — offer an easy, welcoming nearby pick.`
      : `This is day ${stayDay} of the guest's stay — they have likely seen the obvious spots, ` +
        `so lean to something less obvious or a different KIND of place. For a small neighbourhood, ` +
        `rotate the pool rather than refusing all repeats.`

  const location = [neighborhood, city].filter(Boolean).join(', ') || 'the area'

  const prompt =
    `You are a friendly short-term rental host. Write ONE short, warm suggestion sentence ` +
    `(maximum 30 words) for what a guest should do RIGHT NOW. ` +
    `${dayPartBlock} ` +
    `${weatherLine} ` +
    `The neighbourhood is ${location}. ` +
    `${placesLine} ` +
    `${stayDayBlock} ` +
    `${recentBlock} ` +
    `Match the weather if relevant (rain → cosy indoors; clear or mild → outdoors). ` +
    `First-person-host warmth. No greeting, no salutation, no signature, ` +
    `no markdown, no emojis. Write in English. One sentence only.`

  const ai = new GoogleGenAI({ apiKey })

  const generate = async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)
    try {
      return await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 128,
          abortSignal: controller.signal,
        },
      })
    } finally {
      clearTimeout(timer)
    }
  }

  let text = ''
  try {
    const response = await withRetry(generate, { retries: 1, baseDelayMs: 600 })
    text = response.text?.trim() ?? ''
  } catch (e) {
    console.error('[greeting] suggestion threw', { aptId: args.apartmentId, msg: scrubErr(e) })
    return { suggestion: null }
  }

  if (!text) return { suggestion: null }
  return { suggestion: text }
}
