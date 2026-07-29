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
// large city (the prompt's widest limit is a 30-minute walk — ~2.5km — for Sight/Nightlife,
// 15 minutes for the rest, so real picks land far inside it) while still rejecting the
// regional administrative centroids the geocoder returns where OSM coverage is thin.
// Beyond this the coordinate is dropped, NOT the place.
const MAX_PLACE_KM = 25
// One bonus generation for still-empty categories, but only when the main call was fast.
// Worst case with the retry (44.9s main + 25s retry + ~18s geocoding + generate-guide.ts's
// ~24.6s blurb call) ≈ 112.5s; without it (2×40s + 0.6s + 18s + 24.6s) ≈ 123.2s. Both inside
// the 150s maxDuration. A slow main call skips the bonus pass rather than risking a timeout.
const RETRY_MAX_ELAPSED_MS = 45000
const RETRY_TIMEOUT_MS = 25000
// UTC, day-granular — deterministic regardless of server locale (mirrors city-events.ts).
const fmt = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

// Dedupe key. Case/accent/punctuation-insensitive so "Café Bar Ñ!" and "cafe bar n" collide.
// NOTE: a name written entirely in a non-Latin script (Greek, Cyrillic, CJK, Hebrew, Arabic)
// normalises to '' — such names are always KEPT and never added to the seen-set, since they
// cannot be compared here and silently dropping them would gut non-Latin-script cities.
const normName = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

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

// One definition per category, so the retry prompt can request a SUBSET without restating
// (and drifting from) the rule wording. Text is verbatim from the full prompt shipped in a940158.
const CATEGORY_DEFS: Record<CategoryKey, string> = {
  Restaurant: `- Restaurant: sit-down places to eat a full meal.`,
  Bar: `- Bar: places to drink in the evening — wine bars, beer bars, tapas bars, pubs.`,
  Coffee:
    `- Coffee: cafes, coffee roasters, and bakeries with seating — somewhere to sit with a coffee during the day. ` +
    `This is a SEPARATE category from Bar and Restaurant: do not fold cafes into those. ` +
    `Almost every city neighbourhood has cafes, so an empty Coffee list nearly always means the search was not thorough enough — search again before returning one.`,
  Sight: `- Sight: things to see or visit — parks, museums, markets, notable architecture.`,
  Essential: `- Essential: practical daily needs — supermarket, pharmacy, ATM, laundry, drugstore.`,
  Nightlife: `- Nightlife: late-night venues — clubs, live music, late bars.`,
}

// The distance split from a940158 — the change that removed city-wide drift. Stated in full on
// both the main and retry prompts so a subset request still carries the hard limits.
const DISTANCE_RULES =
  `DISTANCE RULES, measured on foot from the exact address above. These are hard limits, not preferences:\n` +
  `- Restaurant, Bar, Coffee, Essential: within a 15-minute walk. These are daily needs; the guest will not cross the city for them.\n` +
  `- Sight, Nightlife: within a 30-minute walk. Slightly wider because these are destinations, but still WALKABLE.\n` +
  `Never include a place outside these limits, however famous it is. A city's best-known landmark or restaurant in another district is WRONG for this guide; ` +
  `an ordinary local place around the corner is RIGHT. If you are recommending somewhere because it is famous rather than because it is close, leave it out.\n`

/**
 * Build the guide prompt. `onlyCategories` narrows it to a subset for the empty-category retry:
 * same address line, same category definitions, same distance/verification/language rules and the
 * same raw-JSON contract, but requesting (and keying on) only those categories.
 */
function buildPrompt(apt: AptInput, onlyCategories?: readonly CategoryKey[]): string {
  const locationParts = [
    apt.street_number && apt.street ? `${cap(apt.street_number)} ${cap(apt.street)}` : cap(apt.street),
    cap(apt.neighborhood),
    cap(apt.city),
    cap(apt.country),
  ].filter(Boolean)
  const today = fmt(new Date())
  const cats: readonly CategoryKey[] =
    onlyCategories && onlyCategories.length > 0 ? onlyCategories : CATEGORIES
  // Keyed on whether a subset was REQUESTED, not on its length — asking for all six by name is
  // still a retry, and must not silently render as the untouched first-pass prompt.
  const isSubset = cats !== CATEGORIES
  return (
    `Today is ${today}. You are a hyper-local neighbourhood guide expert. ` +
    `A guest is staying at: ${locationParts.join(', ')}. ` +
    `Use web search to find real, currently-open places near that exact address, and verify each one before including it. ` +
    (isSubset
      ? `A previous search returned nothing for ${cats.join(', ')}, so search harder this time within the stated distance limit.\n`
      : '') +
    `Create a neighbourhood guide with up to 5 places in each of these ` +
    `${isSubset ? `${cats.length} ${cats.length === 1 ? 'category' : 'categories'}` : 'six categories'}:\n` +
    cats.map(c => CATEGORY_DEFS[c]).join('\n') + `\n` +
    DISTANCE_RULES +
    `Aim for 4-5 verified places per category. Return fewer only where the neighbourhood genuinely lacks them within the distance limit — ` +
    `but never invent, pad, or guess to reach a number, and never include a place you could not verify.\n` +
    `For each place provide: name (the exact establishment name as written locally — never translate or anglicise it), ` +
    `description (ONE sentence, in ENGLISH), ` +
    `and address (specific street address with neighbourhood and city).\n` +
    `Respond with ONLY raw JSON — no markdown, no code fences, no prose — with exactly these keys: ` +
    `${cats.map(c => `"${c}"`).join(', ')}. ` +
    `Each key maps to an array of up to 5 objects of the form ` +
    `{"name": string, "description": string, "address": string}. ` +
    `Use an empty array only for a category with no verified places inside the distance limit.`
  )
}

// Defensive: strip code fences, fall back to {} on parse failure. Without responseMimeType the
// reply is not guaranteed to be bare JSON, so on failure retry the first-brace..last-brace slice.
// Shared by the main call and the empty-category retry so the two cannot drift apart.
function parseModelJson(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim()
  try {
    const p = JSON.parse(cleaned)
    if (p !== null && typeof p === 'object' && !Array.isArray(p)) {
      return p as Record<string, unknown>
    }
  } catch {
    try {
      const start = cleaned.indexOf('{')
      const end = cleaned.lastIndexOf('}')
      if (start !== -1 && end > start) {
        const p2 = JSON.parse(cleaned.slice(start, end + 1))
        if (p2 !== null && typeof p2 === 'object' && !Array.isArray(p2)) {
          return p2 as Record<string, unknown>
        }
      }
    } catch {
      return {}
    }
  }
  return {}
}

// Coerce to known shape: keep only items with a non-empty name string.
function coercePlaces(parsed: Record<string, unknown>, cats: readonly CategoryKey[]): CategoriesMap {
  const out: CategoriesMap = {}
  for (const cat of cats) {
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
      out[cat] = places
    }
  }
  return out
}

/**
 * Merge `incoming` into `target`, dropping any place whose normalised name was already kept —
 * within a category OR in an earlier one. Walks the canonical CATEGORIES order, so the FIRST
 * occurrence wins (a place in both Restaurant and Nightlife stays under Restaurant). `seen`
 * persists across calls so retry results dedupe against what the main call already kept.
 * Keying on name alone is deliberate: the same place returns with differently-formatted
 * addresses across categories. The cost is that two branches of one chain collapse to one,
 * which is acceptable in a walking guide. Returns the number dropped.
 */
function dedupeInto(target: CategoriesMap, incoming: CategoriesMap, seen: Set<string>): number {
  let dropped = 0
  for (const cat of CATEGORIES) {
    const places = incoming[cat]
    if (!places) continue
    const kept = target[cat] ?? []
    for (const p of places) {
      const key = normName(p.name)
      if (key !== '') {
        if (seen.has(key)) {
          dropped++
          continue
        }
        seen.add(key)
      }
      kept.push(p)
    }
    target[cat] = kept
  }
  return dropped
}

export async function generateGuideForApartment(
  db: SupabaseClient,
  apt: AptInput
): Promise<GuideResult> {
  const t0 = Date.now()
  const apiKey = process.env.GEMINI_API_KEY_GUIDES || process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  const ai = new GoogleGenAI({ apiKey })

  const generate = async () => {
    const controller = new AbortController()
    // 40s per attempt: 2 attempts × 40s + 600ms delay + ~18s geocoding ≈ 98.6s, plus the caller's
    // ~24.6s blurb call ≈ 123.2s < 150s maxDuration. The empty-category retry is gated on
    // RETRY_MAX_ELAPSED_MS so it can only fire when the main call was well inside its budget.
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

  // Dedupe as we build: the model returns the same place under two categories (observed:
  // Frannz Club under both Restaurant and Nightlife at one address), which renders twice.
  const categories: CategoriesMap = {}
  const seenNames = new Set<string>()
  const deduped = dedupeInto(categories, coercePlaces(parseModelJson(raw), CATEGORIES), seenNames)

  // Per-generation diagnostic. Counts + finishReason + raw length ONLY — never the response
  // text, place names or the address. A thin-but-non-empty result (e.g. an empty Coffee list)
  // is invisible on the placeCount === 0 path, so log every generation, not just failures.
  const perCategory = {} as Record<CategoryKey, number>
  let generatedCount = 0
  for (const cat of CATEGORIES) {
    const n = categories[cat]?.length ?? 0
    perCategory[cat] = n
    generatedCount += n
  }
  console.log('[guide] generated', {
    aptId: apt.id,
    finishReason: finishReason ?? null,
    rawLen: raw.length,
    perCategory,
    deduped,
    total: generatedCount,
  })

  // ONE bonus grounded call for categories that came back empty. finishReason is STOP with the
  // reply at roughly half the token budget, so the model is stopping voluntarily — more prompt
  // text cannot fix an empty category, but a focused second request can. Single attempt (no
  // withRetry), shorter timeout, and skipped entirely when the main call was slow so this can
  // never push the invocation past maxDuration. Failure here must never lose what we already have.
  // Gated on generatedCount > 0: when the main call produced NOTHING (thrown, quota 429, empty
  // reply) every category is empty and the retry would be a third doomed call on the same failing
  // key — the expensive case on a quota-exhausted day. A retry is a top-up, not a substitute for
  // a failed generation; the placeCount === 0 path below already handles total failure.
  const emptyCats = generatedCount > 0
    ? CATEGORIES.filter((c) => (categories[c]?.length ?? 0) === 0)
    : []
  const elapsedMs = Date.now() - t0
  if (emptyCats.length > 0 && elapsedMs >= RETRY_MAX_ELAPSED_MS) {
    console.log('[guide] retry skipped', {
      aptId: apt.id,
      categories: emptyCats,
      elapsedMs,
      reason: 'elapsed_budget',
    })
  } else if (emptyCats.length > 0) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), RETRY_TIMEOUT_MS)
      let retryRaw = ''
      let retryFinish: string | undefined
      try {
        const retryRes = await ai.models.generateContent({
          model: MODEL,
          contents: buildPrompt(apt, emptyCats),
          config: {
            tools: [{ googleSearch: {} }] as any,
            thinkingConfig: { thinkingBudget: 0 },
            maxOutputTokens: 8192,
            abortSignal: controller.signal,
          },
        })
        retryRaw = retryRes.text?.trim() ?? ''
        retryFinish = retryRes.candidates?.[0]?.finishReason
          ? String(retryRes.candidates[0].finishReason)
          : undefined
      } finally {
        clearTimeout(timer)
      }
      const retryDeduped = dedupeInto(
        categories,
        coercePlaces(parseModelJson(retryRaw), emptyCats),
        seenNames,
      )
      // These categories were empty before the retry, so the current length IS the gain.
      const gained = {} as Record<string, number>
      for (const cat of emptyCats) gained[cat] = categories[cat]?.length ?? 0
      console.log('[guide] retry', {
        aptId: apt.id,
        categories: emptyCats,
        finishReason: retryFinish ?? null,
        rawLen: retryRaw.length,
        gained,
        // Separates "the model returned nothing" from "everything it returned we already had".
        deduped: retryDeduped,
      })
    } catch (e) {
      const msg = String((e as Error)?.message ?? e)
        .replace(/AIza[0-9A-Za-z_\-]{10,}/g, 'AIza_REDACTED')
        .replace(/key=[^&\s]+/gi, 'key=REDACTED')
        .slice(0, 160)
      console.warn('[guide] retry failed (non-fatal)', { aptId: apt.id, categories: emptyCats, msg })
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
