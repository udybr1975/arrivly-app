import { GoogleGenAI } from '@google/genai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { geocodeAddress } from './geo.js'
import { withRetry } from './retry.js'

export interface GuideResult {
  placeCount: number
}

const MODEL = 'gemini-2.5-flash'
const CATEGORIES = ['Restaurant', 'Bar', 'Coffee', 'Sight', 'Essential', 'Nightlife'] as const
type CategoryKey = typeof CATEGORIES[number]
const MAX_GEOCODE = 30
const GEOCODE_CONCURRENCY = 5
// Sanity bound on how far a guide place may sit from the apartment. Generous enough for a
// large city (the prompt asks for a 15-minute walk, so real picks land far inside it) while
// still rejecting the regional administrative centroids the geocoder returns where OSM
// coverage is thin. Beyond this the coordinate is dropped, NOT the place.
const MAX_PLACE_KM = 25
// UTC, day-granular — deterministic regardless of server locale (mirrors city-events.ts).
const fmt = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

// Great-circle distance in km.
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

interface Place {
  name: string
  description?: string
  address?: string
  lat?: number
  lng?: number
}

type CategoriesMap = Partial<Record<CategoryKey, Place[]>>

export interface AptInput {
  id: string
  street?: string | null
  street_number?: string | null
  neighborhood?: string | null
  city?: string | null
  country?: string | null
  // Optional: when present, biases geocoding to the apartment's locality and enables the
  // MAX_PLACE_KM sanity check. Absent → unbiased, unchecked geocoding exactly as before.
  lat?: number | null
  lng?: number | null
}

const cap = (s: string | null | undefined) => (s ?? '').slice(0, 200)

function buildPrompt(apt: AptInput): string {
  const locationParts = [
    apt.street_number && apt.street ? `${cap(apt.street_number)} ${cap(apt.street)}` : cap(apt.street),
    cap(apt.neighborhood),
    cap(apt.city),
    cap(apt.country),
  ].filter(Boolean)
  const today = fmt(new Date())
  return (
    `Today is ${today}. You are a hyper-local neighbourhood guide expert. ` +
    `A guest is staying at: ${locationParts.join(', ')}. ` +
    `Use web search to find real, currently-open places near that address, and verify each one before including it. ` +
    `Create a neighbourhood guide with up to 5 places per category ` +
    `(Restaurant, Bar, Coffee, Sight, Essential, Nightlife). ` +
    `For each place provide: name (the exact establishment name as written locally — never translate or anglicise it), ` +
    `description (ONE sentence, in ENGLISH), ` +
    `and address (specific street address with neighbourhood and city). ` +
    `Prefer places within 15 minutes' walk. ` +
    `Only include a place if web search confirms it exists at that address and has not permanently closed. ` +
    `Accuracy matters far more than quantity — return fewer places rather than invent, pad, or guess. ` +
    `Never include a place you could not verify. ` +
    `Respond with ONLY raw JSON — no markdown, no code fences, no prose — with exactly these keys: ` +
    `"Restaurant", "Bar", "Coffee", "Sight", "Essential", "Nightlife". ` +
    `Each key maps to an array of up to 5 objects of the form ` +
    `{"name": string, "description": string, "address": string}. ` +
    `Use an empty array for a category with no verified picks.`
  )
}

export async function generateGuideForApartment(
  db: SupabaseClient,
  apt: AptInput
): Promise<GuideResult> {
  const apiKey = process.env.GEMINI_API_KEY_GUIDES || process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  const ai = new GoogleGenAI({ apiKey })

  const generate = async () => {
    const controller = new AbortController()
    // 40s per attempt: 2 attempts × 40s + 600ms delay + ~18s geocoding ≈ 98.6s < 120s maxDuration
    const timer = setTimeout(() => controller.abort(), 40000)
    try {
      return await ai.models.generateContent({
        model: MODEL,
        contents: buildPrompt(apt),
        // googleSearch grounding cannot be combined with responseMimeType JSON,
        // so we parse the plain-text reply defensively.
        config: {
          tools: [{ googleSearch: {} }] as any,
          thinkingConfig: { thinkingBudget: 0 },   // disable thinking — was eating the output budget
          maxOutputTokens: 8192,
          abortSignal: controller.signal,
        },
      })
    } finally {
      clearTimeout(timer)
    }
  }

  let raw = ''
  let finishReason: string | undefined
  try {
    const response = await withRetry(generate, { retries: 1, baseDelayMs: 600 })
    raw = response.text?.trim() ?? ''
    finishReason = response.candidates?.[0]?.finishReason
      ? String(response.candidates[0].finishReason)
      : undefined
  } catch (e) {
    raw = ''
    // Truncate + scrub: the GenAI SDK can embed the API key in error/request-URL strings
    const msg = String((e as Error)?.message ?? e)
      .replace(/AIza[0-9A-Za-z_\-]{10,}/g, 'AIza_REDACTED')
      .replace(/key=[^&\s]+/gi, 'key=REDACTED')
      .slice(0, 160)
    console.error('[guide] generate threw', { aptId: apt.id, msg })
  }

  // Defensive: strip code fences, fall back to {} on parse failure
  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim()
  let parsed: Record<string, unknown> = {}
  try {
    const p = JSON.parse(cleaned)
    if (p !== null && typeof p === 'object' && !Array.isArray(p)) {
      parsed = p as Record<string, unknown>
    }
  } catch {
    // Without responseMimeType the reply is no longer guaranteed to be bare JSON, so the
    // model may wrap it in leading/trailing prose. Retry on the first-brace..last-brace slice.
    try {
      const start = cleaned.indexOf('{')
      const end = cleaned.lastIndexOf('}')
      if (start !== -1 && end > start) {
        const p2 = JSON.parse(cleaned.slice(start, end + 1))
        if (p2 !== null && typeof p2 === 'object' && !Array.isArray(p2)) {
          parsed = p2 as Record<string, unknown>
        }
      }
    } catch {
      parsed = {}
    }
  }

  // Coerce to known shape: keep only items with a non-empty name string
  const categories: CategoriesMap = {}
  for (const cat of CATEGORIES) {
    const raw_arr = parsed[cat]
    if (Array.isArray(raw_arr)) {
      const places: Place[] = raw_arr
        .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
        .filter((item) => typeof item['name'] === 'string' && (item['name'] as string).trim() !== '')
        .map((item) => ({
          name: (item['name'] as string).trim(),
          ...(typeof item['description'] === 'string' ? { description: item['description'] } : {}),
          ...(typeof item['address'] === 'string' ? { address: item['address'] } : {}),
        }))
      categories[cat] = places
    }
  }

  // Geocode best-effort: collect place+address pairs, cap at MAX_GEOCODE, batch GEOCODE_CONCURRENCY at a time
  const geocodeTasks: Array<{ cat: CategoryKey; idx: number; query: string }> = []
  outer: for (const cat of CATEGORIES) {
    const places = categories[cat] ?? []
    for (let i = 0; i < places.length; i++) {
      if (geocodeTasks.length >= MAX_GEOCODE) break outer
      const p = places[i]
      if (p.name && p.address) {
        geocodeTasks.push({ cat, idx: i, query: `${p.name}, ${p.address}` })
      }
    }
  }

  // Bias geocoding to the apartment when we know where it is. apt.country holds a country
  // NAME ("Peru"), not the ISO alpha-2 code countrycodes needs, so no countryCode is passed.
  // Coerce rather than typeof-gate: apartments.lat/lng are double precision (PostgREST sends
  // real JSON numbers today), but a numeric-as-string would silently disable the whole fix,
  // so accept either. null/undefined/'' stay null instead of coercing to 0.
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const aptLat = num(apt.lat)
  const aptLng = num(apt.lng)
  const bias = aptLat !== null && aptLng !== null ? { lat: aptLat, lng: aptLng } : undefined

  let located = 0
  for (let i = 0; i < geocodeTasks.length; i += GEOCODE_CONCURRENCY) {
    const chunk = geocodeTasks.slice(i, i + GEOCODE_CONCURRENCY)
    const results = await Promise.all(chunk.map(t => geocodeAddress(t.query, bias)))
    for (let j = 0; j < chunk.length; j++) {
      const coords = results[j]
      if (!coords) continue
      // Reject an implausible fix (regional centroid). The place STAYS in the guide — its
      // text is still useful and it is usually real — but with no lat/lng the guest page
      // renders it without a Navigate button rather than sending someone 100km inland.
      if (bias && distanceKm(bias.lat, bias.lng, coords.lat, coords.lng) > MAX_PLACE_KM) continue
      const { cat, idx } = chunk[j]
      const place = categories[cat]?.[idx]
      if (place) {
        place.lat = coords.lat
        place.lng = coords.lng
        located++
      }
    }
  }

  // Counts only — no addresses, no keys.
  console.log('[guide] geocoded', {
    aptId: apt.id,
    located,
    attempted: geocodeTasks.length,
    biased: Boolean(bias),
  })

  let placeCount = 0
  for (const cat of CATEGORIES) {
    placeCount += categories[cat]?.length ?? 0
  }

  if (placeCount === 0) {
    console.error('[guide] empty result', {
      aptId: apt.id,
      rawLen: raw.length,
      finishReason: finishReason ?? null,
      sample: raw.slice(0, 200),
    })
    // Transient Gemini failure (timeout / 5xx / empty). Do NOT upsert — overwriting an existing
    // guide with {} would wipe a previously-good guide. Leave any existing row intact and let the
    // caller surface a retryable error.
    return { placeCount: 0 }
  }

  const { error: upsertErr } = await db.from('guide_recommendations').upsert(
    {
      apartment_id: apt.id,
      neighborhood: apt.neighborhood ?? null,
      categories,
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'apartment_id' }
  )
  if (upsertErr) throw new Error(`Upsert failed: ${upsertErr.message}`)

  return { placeCount }
}
