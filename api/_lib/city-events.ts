import { GoogleGenAI } from '@google/genai'
import { withRetry } from './retry.js'

// Shared city-events generator (mirrors the guide.ts / greeting.ts lib split).
// The Gemini generation + JSON parse/sanitize logic lives here so both the guest
// read path (api/city-events.ts lazy-fill) and the daily cron (api/cron-refresh-events.ts)
// and the host manual refresh (api/refresh-events.ts) share ONE implementation.
// NEVER throws to the caller — returns { payload: null } on any failure. Keys are
// scrubbed from logs (AIza / key= → REDACTED).

const MODEL = 'gemini-2.5-flash'
// UTC, day-granular — deterministic regardless of server locale (no per-city tz dependency).
const fmt = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export interface CityEventItem {
  title: string
  venue: string
  date: string
  desc: string
  price: string
  url: string
}
export interface CityEventCategory {
  name: string
  events: CityEventItem[]
}
export interface CityEventsPayload {
  week: string
  categories: CityEventCategory[]
}

function scrubErr(e: unknown): string {
  return String((e as Error)?.message ?? e)
    .replace(/AIza[0-9A-Za-z_\-]{10,}/g, 'AIza_REDACTED')
    .replace(/key=[^&\s]+/gi, 'key=REDACTED')
    .slice(0, 120)
}

/**
 * Generate the next-7-days city events for an apartment via grounded Gemini.
 * Returns { payload } on success, { payload: null } on any failure (never throws).
 */
export async function generateCityEvents(
  apt: { id: string; city: string | null; country: string | null }
): Promise<{ payload: CityEventsPayload | null }> {
  const apiKey = process.env.GEMINI_API_KEY_EVENTS || process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('[city-events] GEMINI_API_KEY not set')
    return { payload: null }
  }
  if (!apt.city) return { payload: null }

  const now = new Date()
  const until = new Date(now)
  until.setUTCDate(now.getUTCDate() + 7)
  const today = fmt(now)
  const untilStr = fmt(until)
  const city = (apt.city ?? '').slice(0, 80)
  const country = (apt.country ?? '').slice(0, 80)
  const place = country ? `${city}, ${country}` : city

  const prompt =
    `Today is ${today}. Use web search to find as many real, specific events as you can verify happening in ${place} ` +
    `between ${today} and ${untilStr} — the next 7 days only. Aim for at least 10 and up to 15. ` +
    `Include concerts, exhibitions, markets, festivals, sports, theatre, food and nightlife with real venues and dates. ` +
    `Do NOT include past events, generic "things to do", duplicates, or anything you cannot verify is scheduled in this window. ` +
    `Accuracy matters more than quantity — include fewer rather than invent or pad. ` +
    `Return ONLY raw JSON — no markdown, no code fences — shaped exactly as: ` +
    `{"week":"${today} – ${untilStr}","categories":[{"name":"This week","events":[{"title":"","venue":"","date":"","desc":"","price":"","url":""}]}]}. ` +
    `Each event: title (name), venue (place), date (day or date within the window), desc (one short sentence), ` +
    `price (very short, e.g. "Free" or "€20" — max ~12 characters, no parentheses or notes), ` +
    `url (the official event or ticket page if you are confident it is correct, otherwise an empty string — never invent a URL). ` +
    `If you cannot verify any real events, return {"week":"${today} – ${untilStr}","categories":[]}.`

  const ai = new GoogleGenAI({ apiKey })

  // Per-attempt AbortController (~28s). withRetry({ retries: 1 }) → 2 attempts max,
  // worst case ~2×28s + backoff ≈ 57s, inside the 60s function maxDuration.
  const generate = async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 28000)
    try {
      return await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        // googleSearch grounding cannot be combined with responseMimeType JSON,
        // so we parse fenced text defensively.
        config: {
          tools: [{ googleSearch: {} }] as any,
          thinkingConfig: { thinkingBudget: 0 } as any,
          maxOutputTokens: 4096,
          abortSignal: controller.signal,
        },
      })
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    const response = await withRetry(generate, { retries: 1 })
    const raw = (response.text || '').replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.categories)) {
      const SAFE_SCHEME = /^https?:\/\//i
      parsed.categories.forEach((cat: any) => {
        cat.events?.forEach((ev: any) => {
          if (ev.url && !SAFE_SCHEME.test(String(ev.url).trim())) ev.url = ''
        })
      })
      return { payload: parsed as CityEventsPayload }
    }
    return { payload: null }
  } catch (e) {
    console.warn(`[city-events] generation failed — ${scrubErr(e)}`)
    return { payload: null }
  }
}
