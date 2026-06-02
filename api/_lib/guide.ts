import { GoogleGenAI } from '@google/genai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { geocodeAddress } from './geo.js'

export interface GuideResult {
  placeCount: number
}

const MODEL = 'gemini-2.5-flash'
const CATEGORIES = ['Restaurant', 'Bar', 'Coffee', 'Sight', 'Essential', 'Nightlife'] as const
type CategoryKey = typeof CATEGORIES[number]
const MAX_GEOCODE = 30
const GEOCODE_CONCURRENCY = 5

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
}

const cap = (s: string | null | undefined) => (s ?? '').slice(0, 200)

function buildPrompt(apt: AptInput): string {
  const locationParts = [
    apt.street_number && apt.street ? `${cap(apt.street_number)} ${cap(apt.street)}` : cap(apt.street),
    cap(apt.neighborhood),
    cap(apt.city),
    cap(apt.country),
  ].filter(Boolean)
  return (
    `You are a hyper-local neighbourhood guide expert. ` +
    `A guest is staying at: ${locationParts.join(', ')}. ` +
    `Create a neighbourhood guide with up to 5 places per category ` +
    `(Restaurant, Bar, Coffee, Sight, Essential, Nightlife). ` +
    `For each place provide: name (exact establishment name), ` +
    `description (one sentence in the area's primary language), ` +
    `and address (specific street address with neighbourhood and city). ` +
    `Prefer places within 15 minutes' walk. Only include places you are confident exist. ` +
    `Respond with ONLY a JSON object — no markdown, no prose — with exactly these keys: ` +
    `"Restaurant", "Bar", "Coffee", "Sight", "Essential", "Nightlife". ` +
    `Each key maps to an array of up to 5 objects of the form ` +
    `{"name": string, "description": string, "address": string}. ` +
    `description is one sentence in the area's primary language; address is a specific ` +
    `street address including neighbourhood and city. Use an empty array for a category ` +
    `with no confident picks.`
  )
}

export async function generateGuideForApartment(
  db: SupabaseClient,
  apt: AptInput
): Promise<GuideResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  const ai = new GoogleGenAI({ apiKey })

  let timer!: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), 30000)
  })

  const generatePromise = ai.models.generateContent({
    model: MODEL,
    contents: buildPrompt(apt),
    config: {
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },   // disable thinking — was eating the output budget
      maxOutputTokens: 8192,
    },
  })

  let raw = ''
  let finishReason: string | undefined
  try {
    const response = await Promise.race([generatePromise, timeoutPromise])
    clearTimeout(timer)
    raw = response.text?.trim() ?? ''
    finishReason = response.candidates?.[0]?.finishReason
      ? String(response.candidates[0].finishReason)
      : undefined
  } catch (e) {
    clearTimeout(timer)
    raw = ''
    // Truncate + scrub: the GenAI SDK can embed the API key in error/request-URL strings
    const msg = String((e as Error)?.message ?? e)
      .replace(/key=[^&\s]+/gi, 'key=REDACTED')
      .slice(0, 120)
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
    parsed = {}
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

  for (let i = 0; i < geocodeTasks.length; i += GEOCODE_CONCURRENCY) {
    const chunk = geocodeTasks.slice(i, i + GEOCODE_CONCURRENCY)
    const results = await Promise.all(chunk.map(t => geocodeAddress(t.query)))
    for (let j = 0; j < chunk.length; j++) {
      const coords = results[j]
      if (coords) {
        const { cat, idx } = chunk[j]
        const place = categories[cat]?.[idx]
        if (place) {
          place.lat = coords.lat
          place.lng = coords.lng
        }
      }
    }
  }

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
