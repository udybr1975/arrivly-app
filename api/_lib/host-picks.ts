import { GoogleGenAI } from '@google/genai'
import { geocodeAddress } from './geo.js'
import { scrubErr } from './scrub.js'

const MODEL = 'gemini-2.5-flash'
const VALID_CATEGORIES = ['Restaurant', 'Bar', 'Coffee', 'Sight', 'Essential', 'Nightlife'] as const
type Category = typeof VALID_CATEGORIES[number]

export interface PickCandidate {
  name: string
  category: Category
  address: string
  lat: number | null
  lng: number | null
  located: boolean
}

export interface EnrichContext {
  city?: string | null
  neighborhood?: string | null
  country?: string | null
}

function coerceCategory(raw: unknown): Category {
  if (typeof raw === 'string' && (VALID_CATEGORIES as readonly string[]).includes(raw)) {
    return raw as Category
  }
  return 'Essential'
}

export async function enrichHostPicks(
  freeText: string,
  ctx: EnrichContext
): Promise<PickCandidate[]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  const ai = new GoogleGenAI({ apiKey })

  const locationStr = [ctx.neighborhood, ctx.city, ctx.country].filter(Boolean).join(', ')
  const prompt =
    `The host is located in ${locationStr}. ` +
    `Below is a list of places the host recommends to guests. ` +
    `Respond with ONLY a JSON array — no markdown, no prose — of objects of the form ` +
    `{"name": string, "category": string, "address": string}. ` +
    `category must be exactly one of: Restaurant, Bar, Coffee, Sight, Essential, Nightlife. ` +
    `address must be a specific street address including neighbourhood and city. ` +
    `Identify each place the host names; do not invent places they didn't mention.\n\n` +
    `Host's list:\n${freeText}`

  let timer!: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), 30000)
  })

  const generatePromise = ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 4096,
    },
  })

  let raw = ''
  try {
    const response = await Promise.race([generatePromise, timeoutPromise])
    clearTimeout(timer)
    raw = response.text?.trim() ?? ''
  } catch (e) {
    clearTimeout(timer)
    const msg = scrubErr(e, 120)
    console.error('[host-picks] generate threw', { msg })
    return []
  }

  // Defensive parse: strip code fences, fall back to [] on failure.
  //
  // THE `(?:...)` GROUP IS LOAD-BEARING — do not "simplify" it back to `json?`. Without the
  // group the `?` binds to the letter `n` alone, so the pattern reads "jso" plus an OPTIONAL
  // "n" and a BARE ``` fence is never stripped: JSON.parse then fails, rawParsed stays [],
  // and the host silently gets zero picks. Matches api/bulk-import.ts and
  // api/import-listing.ts.
  //
  // The CLOSING pattern here is the CORRECT form (`/```\s*$/i` — fence, then optional
  // trailing whitespace). The other three sites (bulk-import, import-listing, greeting)
  // were on the BROKEN form `/\s*```$/i` — which fails to strip a fence followed by a
  // newline or spaces, because `$` without `m` anchors at end-of-input and .trim() cannot
  // rescue a replace that never matched — and were corrected to this form in the PG-29 fix.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  let rawParsed: unknown[] = []
  try {
    const p = JSON.parse(cleaned)
    if (Array.isArray(p)) rawParsed = p
  } catch {
    rawParsed = []
  }

  // Coerce: keep only items with a non-empty name; normalise category + address
  const candidates = rawParsed
    .filter((item): item is Record<string, unknown> =>
      item !== null && typeof item === 'object' && !Array.isArray(item)
    )
    .filter((item) => typeof item['name'] === 'string' && (item['name'] as string).trim() !== '')
    .map((item) => ({
      name: (item['name'] as string).trim(),
      category: coerceCategory(item['category']),
      address: typeof item['address'] === 'string' ? item['address'] : '',
    }))

  if (candidates.length === 0) {
    // NEVER log `raw` here, not even truncated: it is UNSCRUBBED MODEL OUTPUT, and the prompt
    // above embeds `freeText` — the host's own typed list of places, capped at 5,000 chars by
    // generate-host-picks.ts and scrubbed by nothing. Length and shape are enough to tell an
    // empty generation from prose from a stray code fence; content would put host-authored
    // text in the Vercel logs.
    //
    // Same shape as the parse-failure logs in api/import-listing.ts and api/bulk-import.ts, so
    // the three sites do not diverge. Kept in this file's object-literal log style rather than
    // their positional one; the two facts logged are identical.
    console.error('[host-picks] empty result', {
      rawLen: raw.length,
      startsWithFence: raw.trimStart().startsWith('```'),
    })
    return []
  }

  // Geocode all candidates concurrently (each call has its own 3s timeout in geo.ts).
  // Cap at 20 to avoid a large fan-out on unexpectedly long Gemini output.
  const capped = candidates.slice(0, 20)
  const coords = await Promise.all(
    capped.map((c) => geocodeAddress(`${c.name}, ${c.address}`))
  )

  return capped.map((c, i) => ({
    ...c,
    lat: coords[i]?.lat ?? null,
    lng: coords[i]?.lng ?? null,
    located: coords[i] !== null,
  }))
}
