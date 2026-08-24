import { GoogleGenAI } from '@google/genai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { withRetry } from './retry.js'
import { scrubErr } from './scrub.js'
import { aiGenerate, resolveProvider } from './ai-provider.js'
import { geocodeAddress } from './geo.js'
import type { AptInput } from './guide.js'

export type { AptInput }

const MODEL = 'gemini-2.5-flash'
const cap = (s: string | null | undefined) => (s ?? '').slice(0, 200)

// ── GROUNDING THE BLURB ───────────────────────────────────────────────────────────────────
//
// WHY THIS EXISTS: two shipped blurbs claimed false geography — "a stone's throw from Sibelius
// Park" for a Kallio flat (the park is ~3km away in Töölö) and "just steps from Hakaniemi
// market" for an Ullanlinna flat (~2.5km). A guest who walks out expecting a park two streets
// away and finds a 40-minute walk has been misled by us, not by the model.
//
// A PROMPT RULE ALONE DOES NOT BIND A MODEL. The rule below is the first line of defence and
// it lowers the FREQUENCY of a false claim; the MECHANISM is that every named place is
// geocoded and distance-checked before the blurb is saved. Do not delete the check on the
// grounds that the prompt now says not to do it — that is the "prompt sentence standing in
// for a mechanism" failure this project has already recorded twice.
// NAMED FOR THIS FILE, not `MAX_PLACE_KM`: guide.ts exports a constant of that exact name set
// to 25, ~17x larger, and the two files are already joined by an import. One identifier, two
// meanings, is how the wrong bound gets copied.
const MAX_BLURB_PLACE_KM = 1.5

// Bounds LocationIQ spend AND wall clock. Each lookup costs up to geo.ts's 550ms shared rate
// gate + 3s abort, and this runs inside generate-guide's 150s budget AFTER a full guide run —
// see the deadline note below. A 45-word blurb naming more than three specific places is
// already outside what the prompt asks for, so exceeding this is a FAIL rather than a
// verification, which costs one model call instead of three geocodes.
const MAX_PLACES_TO_VERIFY = 3

// WALL-CLOCK DERIVATION — load-bearing, and it is the reason for the deadline parameter.
// guide.ts records generate-guide's worst case as ~123.2s against `maxDuration: 150`, of which
// ~24.6s is this blurb call. Verification and a regeneration are NEW cost on top of that:
//   verification  MAX_PLACES_TO_VERIFY x (geo.ts 550ms rate gate + 3s abort) = 3 x 3.55s = 10.65s
//   regeneration  SINGLE-SHOT 12s (not 24.6s: it is a fallback, and if it fails the existing
//                 blurb is kept, so a second attempt buys little and costs the budget)
// New blurb worst case 24.6 + 10.65 + 12 = 47.25s, i.e. +22.65s on the recorded 24.6s.
// 123.2 - 24.6 + 47.25 = ~145.9s, inside 150s but with ~4s of margin — which is precisely why
// both extra legs are ALSO deadline-gated rather than trusted to arithmetic. Re-derive
// guide.ts's comment in the same commit as any change here.
// NOT A HARD CEILING: geo.ts's rate gate is a MODULE-LEVEL chain shared by every concurrent
// invocation in the same Lambda instance, so two overlapping guide runs slow each other's
// verification. That is what the runtime deadline checks absorb — do not treat this number
// as a guarantee.
const VERIFY_MS = MAX_PLACES_TO_VERIFY * 3550
const RETRY_MS = 12000
const VERIFY_AND_RETRY_MS = VERIFY_MS + RETRY_MS

// COERCE, don't typeof-gate — the same reasoning guide.ts records for its own `num()`: a
// numeric-as-string would silently disable the proximity check, and every blurb would then
// regenerate place-free while appearing to work. null/undefined/'' stay null, never 0 (which
// would be a real coordinate in the Gulf of Guinea).
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Great-circle distance in km. Same formula as guide.ts's private copy; not imported because
// that one is not exported and widening its visibility for this is a bigger change than the
// eight lines it saves.
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

interface BlurbPayload {
  blurb: string
  places: string[]
}

// Defensive parse — the model's output is untrusted. Returns null on anything unexpected, and
// the caller treats null exactly as it treats a verification failure: regenerate without
// places. Groq returns its reasoning trace in `message.reasoning`, so `content` is already
// clean JSON and NO stripping logic belongs here (adding some is how a working parser breaks).
function parseBlurbPayload(raw: string): BlurbPayload | null {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(cleaned) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const obj = parsed as Record<string, unknown>
    if (typeof obj.blurb !== 'string' || !obj.blurb.trim()) return null
    // A MISSING `places` KEY IS NOT AN EMPTY LIST. Empty means "I named nothing"; missing means
    // the model did not answer the question, and treating that as "nothing to verify" would be
    // the single most likely way for an unverified claim to reach a guest page.
    if (!Array.isArray(obj.places)) return null
    const places = obj.places
      .filter((p): p is string => typeof p === 'string')
      .map(p => p.trim())
      .filter(Boolean)
    return { blurb: obj.blurb.trim(), places }
  } catch {
    return null
  }
}

/**
 * True only when EVERY named place geocodes AND sits within MAX_BLURB_PLACE_KM of the apartment.
 * (NOT `MAX_PLACE_KM` — that is guide.ts's identically-shaped constant set to 25, and writing it
 * here is precisely the copy the naming note at the top of this file exists to prevent.)
 * A place that fails to geocode is a FAIL, not a pass: unverifiable proximity is treated as
 * false, because the alternative is publishing a claim we could not check.
 * Logs the failures (place names and distances ONLY — never guest data, never coordinates,
 * and geo.ts itself stays silent because the API key sits in its URL).
 */
async function placesAreNearby(
  places: string[],
  apt: AptInput,
): Promise<boolean> {
  const lat = num(apt.lat)
  const lng = num(apt.lng)
  if (lat === null || lng === null) {
    // OUR data is missing, not the model's fault — but the claim is still unverifiable, so it
    // is still not published. Same rule, applied to ourselves.
    console.error('[greeting] blurb places unverifiable — apartment has no coordinates', {
      aptId: apt.id,
      places: places.length,
    })
    return false
  }
  if (places.length > MAX_PLACES_TO_VERIFY) {
    console.error('[greeting] blurb named too many places to verify', {
      aptId: apt.id,
      places: places.length,
      cap: MAX_PLACES_TO_VERIFY,
    })
    return false
  }

  const locality = [cap(apt.neighborhood), cap(apt.city), cap(apt.country)].filter(Boolean).join(', ')
  const bias = { lat, lng, countryCode: undefined as string | undefined }
  const failures: string[] = []

  // Sequential on purpose. geo.ts's shared rate gate spaces request STARTS ~550ms apart, so a
  // parallel fan-out would not go faster — it would only make the ordering of the log harder
  // to read. At most MAX_PLACES_TO_VERIFY lookups, once per apartment.
  for (const place of places) {
    const query = locality ? `${place}, ${locality}` : place
    const hit = await geocodeAddress(query, bias)
    if (!hit) {
      failures.push(`${place}=nogeocode`)
      continue
    }
    const km = distanceKm(lat, lng, hit.lat, hit.lng)
    if (km > MAX_BLURB_PLACE_KM) failures.push(`${place}=${km.toFixed(2)}km`)
  }

  if (failures.length) {
    console.error('[greeting] blurb failed proximity check', {
      aptId: apt.id,
      maxKm: MAX_BLURB_PLACE_KM,
      failed: failures.join(' | ').slice(0, 300),
    })
    return false
  }
  return true
}

// Generates and saves a stable neighbourhood character blurb for the apartment.
// Called after a successful guide generation so location data is already confirmed.
// Note: not triggered on basic-info save (that path is client-side, no server hook).
export async function generateGreetingBlurb(
  db: SupabaseClient,
  apt: AptInput,
  // Absolute epoch-ms budget from the CALLER, because the cost this guards against is spent
  // BEFORE this function starts: generate-guide runs a whole guide (up to ~98s) first, and
  // nothing measurable from in here can see that. Omitted = no deadline (existing callers and
  // tests are unaffected). See the wall-clock derivation at the call in generate-guide.ts.
  deadlineMs?: number
): Promise<{ ok: boolean }> {
  const budgetLeft = () => (deadlineMs === undefined ? Infinity : deadlineMs - Date.now())
  // Branches on the GUIDE surface deliberately, not a blurb-specific one: the blurb is generated
  // as part of a guide run, so one env var flips guide + blurb together and they can never end
  // up split across providers. The GEMINI_API_KEY guard moved inside the gemini branch below —
  // at the top it would break the Groq path once pilot Step 8 deletes the GEMINI_* vars.
  const provider = resolveProvider('guide')
  // Hoisted out of the gemini branch: a missing key must fail before any model call, not
  // after the first one has already been spent. Same log, same return value as before.
  const geminiKey = provider === 'gemini' ? process.env.GEMINI_API_KEY : undefined
  if (provider === 'gemini' && !geminiKey) {
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

  // THE GROUNDING RULE (the two sentences after the tone rules). It is the FIRST line of
  // defence, not the control — placesAreNearby() is the control. Prompt tokens are debited
  // against Groq's reservation like any others, so this is two sentences, not a lecture.
  const basePrompt =
    `A guest is arriving at a short-term rental in ${locationParts.join(', ')}. ` +
    `Write ONE warm paragraph (2–3 sentences, around 45 words) that welcomes them to this exact ` +
    `place by capturing its character — what the area is known for, its feel, what is nearby. ` +
    `Begin by naming the neighbourhood or city itself (for example, "El Born is…" or ` +
    `"Barcelona's Gothic Quarter…"). Do NOT open with a participle, gerund, or "-ing" phrase — ` +
    `specifically never begin with words like "Stepping", "Nestled", "Tucked", "Wandering", or "Strolling". ` +
    `Warm, first-person-host tone, present tense. No greeting words ("Dear", "Welcome", "Hello"). ` +
    `No weather, no signature, no lists, no markdown, no emojis — just the descriptive paragraph. ` +
    `Write in English. ` +
    `Name only places that are genuinely in, or directly adjacent to, the stated neighbourhood, and ` +
    `never claim walking distance or proximity unless you are certain of it. ` +
    `If you are unsure, describe the character of the area without naming any specific place. ` +
    `Name at most three specific places.`

  // JSON so the named places can be CHECKED rather than trusted. Shape is stated in the prompt
  // and parsed defensively; `responseJsonSchema` is deliberately not used (recorded as
  // unreliable with thinking off).
  const jsonContract =
    ` Respond ONLY with a JSON object: {"blurb": "<the paragraph>", "places": ["<each specific ` +
    `place name you mentioned>"]}. Include every specific named place in "places"; use an empty ` +
    `array if you named none. No markdown, no code fences.`

  // The retry. Nothing to verify by construction, so its result is accepted unchecked.
  const noPlacesInstruction =
    ` Do NOT name any specific place, landmark, park, market, street or venue. Describe the ` +
    `character of the area only. "places" must be an empty array.`

  const prompt = basePrompt + jsonContract

  // ONE call helper, shared by the first attempt and the single regeneration, so the two can
  // never drift apart in budget, retry count or timeout. The gemini key check moved ABOVE the
  // try (see top of function): leaving it in here would let a missing key spend the retry call
  // before failing, and the observable outcome — the same log, the same { ok: false } — is
  // unchanged.
  const callModel = async (p: string, o?: { singleShot?: boolean }): Promise<string> => {
    const retries = o?.singleShot ? 0 : 1
    if (provider !== 'gemini') {
      // BUDGET PARITY APPLIES TO `retries` AND `timeoutMs` ONLY — 1 retry (2 attempts) x 12s,
      // matching the gemini branch below so one counter unit costs the same number of attempts on
      // either path. IT DOES NOT APPLY TO THE TOKEN BUDGET: the gemini branch sets
      // `thinkingConfig: { thinkingBudget: 0 }`, so its cap is sized against a model with
      // thinking OFF, while gpt-oss bills reasoning INSIDE completion_tokens — thinking and
      // answering share this one allowance. Budgets are sized per provider, from that
      // provider's token semantics.
      //
      // DERIVATION (400), re-derived for the JSON payload — this arithmetic is load-bearing:
      //   prose answer  ~70 words (45 asked, capped generously for overshoot) x ~1.35 = ~95 -> 96
      //   JSON wrapper  {"blurb":"…","places":[…]}                                        ~12
      //   place names   up to MAX_PLACES_TO_VERIFY (3) x ~5 tok + separators, plus slack      ~36
      //   ANSWER SUBTOTAL                                                                  144
      //   reasoning headroom at reasoning_effort 'low'                                      256
      //   TOTAL                                                                             400
      // Was 352 when the call returned bare prose; +48 is the JSON structure and the places
      // array, nothing else. NOT rounded up beyond that — Groq reserves prompt + max_tokens
      // against a verified 8,000 TPM ceiling, so an unused cap is pure waste. Validate the 256
      // against `reasoningTokens` in the `[ai-provider] groq usage` line and tighten if generous.
      return (await aiGenerate('guide', {
        prompt: p,
        json: true,
        maxTokens: 400,
        retries,
        timeoutMs: 12000,
        // The blurb prompt carries the property's street address, and a Groq
        // `json_validate_failed` 400 echoes `failed_generation` into the log line. Host data
        // rather than guest data, and largely public on the guest page — but the flag exists
        // for exactly this shape, so it is set.
        redactErrorBody: true,
      })).trim()
    }

    const ai = new GoogleGenAI({ apiKey: geminiKey as string })
    const generate = async () => {
      const controller = new AbortController()
      // 12s per attempt × 2 attempts (1 retry) + 600ms delay ≈ 24.6s worst case
      const timer = setTimeout(() => controller.abort(), 12000)
      try {
        return await ai.models.generateContent({
          model: MODEL,
          contents: p,
          config: {
            thinkingConfig: { thinkingBudget: 0 },
            // JSON mode + thinkingBudget 0 + the shape in the prompt + a defensive parse is the
            // recorded working pattern. `responseJsonSchema` is deliberately NOT used.
            responseMimeType: 'application/json',
            // Unchanged at 256: with thinking OFF the whole allowance is the answer, and the
            // answer subtotal above is 144, so 256 already carries the JSON overhead.
            maxOutputTokens: 256,
            abortSignal: controller.signal,
          },
        })
      } finally {
        clearTimeout(timer)
      }
    }
    const response = await withRetry(generate, { retries, baseDelayMs: 600 })
    return response.text?.trim() ?? ''
  }

  // Nothing to verify WITH, so do not spend a call finding that out: an apartment with no
  // coordinates would otherwise generate, fail unconditionally, and regenerate — two calls and
  // ~35s to reach a result reachable in one. Same for a caller whose budget is already gone.
  const canVerify = num(apt.lat) !== null && num(apt.lng) !== null
  const enoughBudget = budgetLeft() > VERIFY_AND_RETRY_MS
  const placeFreeFromTheStart = !canVerify || !enoughBudget
  if (placeFreeFromTheStart) {
    console.error('[greeting] blurb generated place-free without verifying', {
      aptId: apt.id,
      reason: !canVerify ? 'no-coordinates' : 'insufficient-budget',
    })
  }

  let text = ''
  try {
    const firstPrompt = placeFreeFromTheStart
      ? basePrompt + noPlacesInstruction + jsonContract
      : prompt
    const first = parseBlurbPayload(await callModel(firstPrompt))

    // An UNPARSEABLE payload is treated exactly as a failed proximity check. Both mean the same
    // thing — we do not know what was claimed — and the safe response to not knowing is a blurb
    // that claims nothing. Naming no places is the only state that needs no verification.
    // BUDGET IS RE-CHECKED HERE, not just at the pre-check above. The pre-check reserves the
    // EXTRA LEGS ONLY — it runs BEFORE the first model call, whose own 24.6s is not in that
    // reservation, so a guide that finished at ~117s can pass the pre-check, spend 24.6s, and
    // arrive here already past the deadline. Verification would then push the function past
    // maxDuration AFTER the guide has been upserted, which is the "fails on work that
    // succeeded" shape the 150s raise exists to prevent. Falling through leaves text = '' and
    // the existing blurb intact.
    const accepted =
      first !== null &&
      (first.places.length === 0 ||
        (!placeFreeFromTheStart &&
          budgetLeft() > VERIFY_MS &&
          (await placesAreNearby(first.places, apt))))

    if (accepted && first) {
      text = first.blurb
    } else if (placeFreeFromTheStart || budgetLeft() < RETRY_MS) {
      // No second chance available — either this WAS the place-free attempt, or the budget is
      // gone. Leave `text` empty: the existing empty path logs it and returns { ok: false }
      // WITHOUT writing, so the apartment keeps whatever blurb it already had. Publishing an
      // unverified claim to avoid an empty write would be the wrong trade.
      text = ''
    } else {
      if (!first) {
        console.error('[greeting] blurb payload unparseable — regenerating without places', {
          aptId: apt.id,
        })
      }
      // EXACTLY ONE regeneration, and its COMPLIANCE IS CHECKED even though its geography is
      // not. "Nothing to verify" is only true if the model actually named nothing, and this
      // file's own header says a prompt rule does not bind a model — so the empty-array claim
      // is checked (free: `places` is already parsed) rather than assumed. A non-compliant
      // retry yields '' and keeps the existing blurb, and shows up in the log below.
      const retry = parseBlurbPayload(
        await callModel(basePrompt + noPlacesInstruction + jsonContract, { singleShot: true }),
      )
      if (retry && retry.places.length === 0) {
        text = retry.blurb
      } else {
        // Covers BOTH shapes: a retry that named places anyway (a compliance failure) and one
        // that would not parse (places: -1). Worded so the -1 case does not read as the former.
        console.error('[greeting] regeneration rejected (named places, or unparseable)', {
          aptId: apt.id,
          places: retry?.places.length ?? -1,
        })
        text = ''
      }
    }
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
  // PILOT: provider decides WHICH model answers. The 50/h victim-keyed fail-closed brake and
  // the per-booking/date/day-part cache both live in api/daily-greeting.ts and are untouched —
  // one counter bump is still exactly one call here, whichever provider runs.
  // The GEMINI_API_KEY guard moved INSIDE the gemini branch on purpose: once the pilot deletes
  // the GEMINI_* vars (Step 8), a top-level guard would null every suggestion on the groq path.
  const provider = resolveProvider('greeting')

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

  let text = ''
  try {
    if (provider === 'groq') {
      // BUDGET PARITY APPLIES TO `retries` AND `timeoutMs` ONLY — 1 retry (2 attempts) x 12s,
      // matching the gemini branch below so one counter unit costs the same number of attempts on
      // either path. IT DOES NOT APPLY TO THE TOKEN BUDGET: the gemini branch sets
      // `thinkingConfig: { thinkingBudget: 0 }`, so its 128 was sized against a model with
      // thinking OFF, and the groq branch inherited the NUMBER but not the CONDITION. gpt-oss
      // bills reasoning INSIDE completion_tokens, so 128 was the most exposed budget in the
      // codebase — a trace alone could plausibly consume all of it and return empty.
      //
      // DERIVATION (320): the prompt caps the answer at 30 words; allowing ~45 for overshoot,
      // 45 x ~1.35 tok/word = ~61, so 64 for the ANSWER. Plus 256 of explicit REASONING headroom
      // at reasoning_effort 'low' — the same allowance as the blurb even though the answer is
      // shorter, because this prompt is the more complex of the two to reason over (day part,
      // weather, stay day, recent picks, nearby places). 64 + 256 = 320. Groq reserves
      // prompt + max_tokens against a verified 8,000 TPM ceiling, so this is sized, not rounded
      // up; validate the 256 against `reasoningTokens` in the `[ai-provider] groq usage` line.
      text = (await aiGenerate('greeting', {
        prompt,
        maxTokens: 320,
        retries: 1,
        timeoutMs: 12000,
      })).trim()
    } else {
      const apiKey = process.env.GEMINI_API_KEY
      if (!apiKey) {
        console.error('[greeting] GEMINI_API_KEY not configured')
        return { suggestion: null }
      }
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

      const response = await withRetry(generate, { retries: 1, baseDelayMs: 600 })
      text = response.text?.trim() ?? ''
    }
  } catch (e) {
    console.error('[greeting] suggestion threw', { aptId: args.apartmentId, msg: scrubErr(e) })
    return { suggestion: null }
  }

  // MATCHES '[greeting] blurb empty' ABOVE. Until now this path returned null silently, so an
  // empty completion was UNDETECTABLE in production — which is exactly the failure mode a
  // reasoning model introduces when the trace eats the answer allowance, and it is the failure
  // this call's raised maxTokens is meant to prevent. Without the log there is no way to measure
  // whether that worked. Return shape is deliberately unchanged.
  if (!text) {
    console.error('[greeting] suggestion empty', { aptId: args.apartmentId })
    return { suggestion: null }
  }
  return { suggestion: text }
}
