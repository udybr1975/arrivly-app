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
    `Write ONE warm, welcoming paragraph (2–3 sentences, around 45 words) that captures ` +
    `the character of this exact neighbourhood for an arriving guest — what the area is known for, ` +
    `its feel, what is nearby. Warm, first-person-host tone, present tense. ` +
    `Do not start with a greeting word ("Dear", "Welcome", "Hello"). ` +
    `No weather, no signature, no lists, no markdown, no emojis — ` +
    `just the descriptive paragraph. Write in English.`

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

  const { dayPart, temp, condition, neighborhood, city, places } = args

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

  const dayPartHints: Record<DailySuggestionArgs['dayPart'], string> = {
    morning: 'It is morning — a great time for coffee, breakfast, or an early walk.',
    afternoon: 'It is afternoon — good for sights, lunch, or a wander.',
    evening: 'It is evening — ideal for dinner, drinks, or catching the sunset.',
    night: 'It is night — nice for a calm stroll, late bites, or winding down.',
  }

  const location = [neighborhood, city].filter(Boolean).join(', ') || 'the area'

  const prompt =
    `You are a friendly short-term rental host. Write ONE short, warm suggestion sentence ` +
    `(maximum 30 words) for what a guest should do RIGHT NOW. ` +
    `${dayPartHints[dayPart]} ` +
    `${weatherLine} ` +
    `The neighbourhood is ${location}. ` +
    `${placesLine} ` +
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
