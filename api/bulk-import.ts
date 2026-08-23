import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'
import { scrubErr } from './_lib/scrub.js'
import { aiGenerate, resolveProvider } from './_lib/ai-provider.js'
import { scrubCredentialSentences } from './_lib/import-listing.js'
import { EXTRAS_CATEGORIES, isExtrasCategory } from '../src/lib/detailCategories.js'

const MODEL = 'gemini-2.5-flash'

// TWO DOORS, ONE LESSON. `3417e01` added the eighth extras category 'During your stay'
// because all seven others were utility-shaped, so a host's picnic OFFERING had no home and
// the model shredded it into inventory. That commit fixed the TAXONOMY and the RULE — but
// only the taxonomy rippled here. This file interpolates EXTRAS_CATEGORIES, so the new
// category has been APPEARING in these instructions ever since while nothing told the model
// what it is for: the box existed and nothing pointed at it, and this older paste-a-wall-of-
// text path went on shredding offerings exactly as before.
//
// THE OFFERINGS PARAGRAPH BELOW IS COPIED FROM api/_lib/import-listing.ts, NOT REWRITTEN.
// A host pasting the same text into two doors must not get two different answers, and two
// prompts teaching one concept in two wordings drift apart on the next edit to either. If
// you change one, change both — and read 3417e01 first, which records why three rounds of
// tuning this wording failed before the taxonomy was the thing that moved.
//
// TWO THINGS ARE DELIBERATELY NOT COPIED, and the SECOND is the one that matters.
//
// (1) The importer's private-block disambiguation ('that private block is codes and
// practicalities only') exists because THAT prompt also writes checkin.entry_instructions,
// where the label "During your stay" appears twice with opposite meanings. This endpoint
// never touches entry_instructions and has no such collision, so importing the clause would
// teach a distinction that does not exist here and spend budget doing it. The half that does
// apply — the public category is offerings only, never a code or utility — is kept below,
// with only the 'the public … category' prefix dropped, since there is no private twin here.
//
// (2) THE IMPORTER'S CODES PARAGRAPH IS NOT COPIED EITHER, AND THAT IS A REAL GAP, NOT A
// TIDY OMISSION. It reads 'access codes … belong ONLY in wifi and checkin … never discard
// one — codes beyond the main door go in checkin.entry_instructions', and it cannot come
// across verbatim because its DISPOSITION TARGET DOES NOT EXIST HERE: this endpoint writes
// extras and nothing else. So the rule below is ADAPTED rather than copied — it keeps the
// suppression half and replaces 'relocate it' with 'point at the check-in info' — and the
// asymmetry it leaves is worth stating plainly rather than discovering later:
//   - this path writes `is_private: false` on EVERY row, so a code that slips through is
//     anon-readable on the guest page,
//   - and where the importer RELOCATES a stray code into entry_instructions ("never discard
//     one"), the rule below can only tell the model to DROP it — with no signal to the host
//     that anything was dropped, and pointing the guest at check-in info that, on this path,
//     nobody wrote the code into. That dangling pointer fails safe (the guest asks the host)
//     but it is a real difference in what the same manual produces through the two doors.
// A PROMPT SENTENCE IS A HINT, NOT A MECHANISM — and the mechanism is now HERE. Since
// 23 Aug 2026 `buildRows` below runs `scrubCredentialSentences`, the server-side belt added
// in 993fa3d after a code leaked into public extras on a live run, over every row before the
// insert; a row that collapses to empty is dropped rather than written blank. The paragraph
// above USED to end by saying this path had only the prompt, which was the asymmetry that
// mattered most between the two doors: that half is closed, and both doors now scrub.
// The suppression-vs-relocation difference in the bullet above is NOT closed and is
// structural — this endpoint has no entry_instructions to relocate into.
// Still read the rule below as a hint: it lowers how often a code reaches the scrub, and it
// is the scrub, not the rule, that bounds what reaches the guest page.
const SYSTEM_PROMPT =
  'You are a property information organiser. Split the provided property info text into the following fixed categories: ' +
  EXTRAS_CATEGORIES.join(', ') + '. ' +
  'Output ONLY a JSON array of { "category": string, "content": string } objects — one object per category that has relevant content. ' +
  'Merge multiple items for the same category into that one content string as short newline-separated lines. ' +
  'Keep content concise and guest-friendly. ' +
  // ORDER IS DELIBERATE: this sits AFTER 'concise' so the specific rule qualifies the general
  // one rather than the other way round, and BEFORE the "anything that does not fit goes under
  // Good to know" fallback — that fallback is what used to catch hospitality content and file
  // it as a utility line, so the routing rule has to be read before the catch-all.
  // THE NEXT FIVE STRING LINES ARE BYTE-IDENTICAL, ONCE CONCATENATED, TO the OFFERINGS
  // paragraph in api/_lib/import-listing.ts. The two files break the literal at DIFFERENT
  // points, so compare the concatenated strings, never the source lines — which is what
  // bulk-import.test.mjs does, and it compares the WHOLE block rather than sampling sentences
  // from it, so a sentence ADDED to or REMOVED from either side fails. That is the drift that
  // actually happens: 3417e01 added this rule to one prompt and not the other. Keep the block
  // contiguous — anything inserted mid-paragraph voids the comparison while looking harmless.
  'OFFERINGS: things the host presents as an offering — picnic kit, sauna, bikes, ' +
  'welcome treats, games — stay as ONE extras item under "During your stay". Never reduce an ' +
  'offering to an inventory line. Everywhere in extras, keep the host\'s requests, tips and ' +
  'colour words ("wash the bottles and leave them for the next guest", "tap water is ' +
  'excellent", bike colours): shorten formatting, never meaning. ' +
  // ADAPTED, NOT COPIED — see (1) and (2) above. Both sentences are deliberately AFTER the
  // shared block so they cannot break it.
  '"During your stay" is OFFERINGS ONLY, never a code or utility. ' +
  // ORDERING, ARGUED because the paragraph above argues the mirror case and this one was
  // left silent: this sentence tells the model to say the code is in the guest's check-in
  // info, and two clauses LATER the prompt says to skip Check-in content entirely. A literal
  // reader could take the second as cancelling the first — and because the exclusion is
  // later, the failure direction is DROPPING THE POINTER SENTENCE, never emitting the code.
  // That is the safe direction, which is why the order stands rather than being swapped.
  'CODES: never write an access code, PIN, password or lock combination into ANY category — ' +
  'name the thing and say the code is in the guest\'s check-in info. ' +
  'category MUST be exactly one of the listed categories; anything that does not fit goes under "Good to know". ' +
  'Do NOT include WiFi, Check-in, or House Rules content — skip it entirely. ' +
  'Output the raw JSON array only, no other text, no code fences.'

// Exported for `npm run test:bulk-import`. THE PROMPT TESTS assert the PROMPT'S CONTENT — that
// the offerings rule is present, that the category list is interpolated rather than hand-copied,
// and that the private-block clause is absent. Those do NOT assert model BEHAVIOUR: that needs
// a real generation, and this repo has no AI credentials outside Vercel. (The buildRows tests
// in the same file ARE behavioural — that function is pure, so the real scrub runs on real
// input with no model involved.) See the test file.
export { SYSTEM_PROMPT }

/**
 * Rows-building step, split out so the SCRUB is testable with plain node — see
 * api/_lib/bulk-import.test.mjs. Pure: no network, no supabase, no clock.
 *
 * THE MODEL'S OUTPUT IS UNTRUSTED INPUT and this path writes `is_private: false` on every
 * row, so a code the prompt failed to suppress would be anon-readable on the guest page.
 * `scrubCredentialSentences` is the same server-side belt api/_lib/import-listing.ts runs
 * on its extras. A row that was nothing but a code sentence collapses to empty and is
 * DROPPED rather than inserted blank — an empty card is worse than no card, exactly as the
 * importer argues at its own extras loop. The scrub is written before the trim so it stays
 * correct if the scrub ever stops trimming its own rejoin; today it does trim, so the order
 * is defensive rather than load-bearing, and no test pins it.
 *
 * DISPOSITION IS SUPPRESSION, NOT RELOCATION. The importer moves a stray code into
 * checkin.entry_instructions ("never discard one"); this endpoint writes extras and nothing
 * else, so there is no destination to move it to and the sentence simply goes.
 *
 * `redacted` is returned for LOGGING ONLY — the HTTP response shape is unchanged. It is a
 * count, never the removed text: the whole point is that the text does not travel.
 */
export function buildRows(
  apartmentId: string,
  valid: { category: string; content: string }[]
): { rows: { apartment_id: string; category: string; content: string; is_private: boolean }[]; redacted: number } {
  const rows: { apartment_id: string; category: string; content: string; is_private: boolean }[] = []
  let redacted = 0
  for (const item of valid) {
    const scrubbed = scrubCredentialSentences(item.content)
    redacted += scrubbed.redacted
    const content = scrubbed.text.trim()
    if (!content) continue
    rows.push({ apartment_id: apartmentId, category: item.category, content, is_private: false })
  }
  return { rows, redacted }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!)
  const { data: authData, error: authError } = await sb.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })

  if (!req.body) return res.status(400).json({ error: 'content is required' })

  const { apartmentId, content } = req.body as { apartmentId?: string; content?: string }
  if (!apartmentId || typeof apartmentId !== 'string') {
    return res.status(400).json({ error: 'apartmentId is required' })
  }
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content is required' })
  }
  if (content.trim().length > 8000) return res.status(400).json({ error: 'content too long' })

  const admin = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: apt } = await admin
    .from('apartments')
    .select('id')
    .eq('id', apartmentId)
    .eq('host_id', authData.user.id)
    .maybeSingle()
  if (!apt) return res.status(403).json({ error: 'forbidden' })

  // PILOT: provider decides WHICH model answers. Auth, ownership check, the 8000-char cap, the
  // parse/validation, the delete+insert and every response shape are untouched. The
  // GEMINI_API_KEY guard moved inside the gemini branch so the groq path survives Step 8.
  const provider = resolveProvider('bulk_import')

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    let raw = ''
    if (provider === 'groq') {
      // Budget parity with the gemini branch below, which is a SINGLE-SHOT 10s Promise.race
      // with no retry: retries 0. This endpoint has no rate limiter at all, so allowing 3
      // attempts here would have tripled its per-request model calls.
      raw = await aiGenerate('bulk_import', {
        system: SYSTEM_PROMPT,
        prompt: content.trim(),
        json: true,
        maxTokens: 2048,
        retries: 0,
        timeoutMs: 10000,
      })
    } else {
      const apiKey = process.env.GEMINI_API_KEY
      if (!apiKey) return res.status(500).json({ error: 'AI not configured' })
      const ai = new GoogleGenAI({ apiKey })

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), 10000)
      })

      const generatePromise = ai.models.generateContent({
        model: MODEL,
        contents: content.trim(),
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 } as any,
          maxOutputTokens: 2048,
        },
      })

      const response = await Promise.race([generatePromise, timeoutPromise])
      raw = response.text ?? ''
    }

    let parsed: unknown
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      console.error('[bulk-import] JSON parse failed — raw:', raw.slice(0, 200))
      return res.status(502).json({ error: 'parse_failed' })
    }

    // PROVIDER DIFFERENCE, handled here rather than by editing the prompt: Groq's json_object
    // mode emits a top-level OBJECT, so the array this prompt asks for can arrive wrapped
    // (e.g. {"categories":[…]}). Unwrap a single array-valued property before the check below.
    // A bare array — what Gemini returns in the normal case — never enters this branch, so the
    // Gemini path is unaffected in practice. It is NOT a strict no-op though: a wrapped object
    // from either provider used to 502 and is now accepted. That widening is intended, and the
    // per-item validation below still gates every category name and content string.
    // Anything still not an array falls through to the unchanged 502.
    if (!Array.isArray(parsed) && parsed && typeof parsed === 'object') {
      const arrays = Object.values(parsed as Record<string, unknown>).filter(Array.isArray)
      if (arrays.length === 1) parsed = arrays[0]
    }

    if (!Array.isArray(parsed)) {
      console.error('[bulk-import] response is not an array')
      return res.status(502).json({ error: 'parse_failed' })
    }

    const valid = (parsed as any[]).filter(
      item =>
        item &&
        typeof item === 'object' &&
        isExtrasCategory(item.category) &&
        typeof item.content === 'string' &&
        item.content.trim()
    ) as { category: string; content: string }[]

    if (valid.length === 0) {
      return res.status(200).json({ categories: [] })
    }

    // Scrub BEFORE the delete. If every row collapses to empty, this returns the same
    // { categories: [] } the `valid.length === 0` guard above returns — and, like that
    // guard, WITHOUT deleting: a run that has nothing to write must not wipe the extras
    // the host already has. The delete+insert ordering below is otherwise unchanged.
    //
    // THE PARTIAL CASE IS DELIBERATE AND WAS ARGUED, so it is not rediscovered as a bug.
    // The delete below is WHOLESALE — every extras category, not just the ones being
    // written — and that width is a documented decision: PropertySetup.tsx's apply path
    // describes itself as "deliberately narrower than bulk-import's delete-every-extras-
    // category". (That path narrows on a SECOND axis this one does not: it also filters
    // `is_private = false`, so the wide delete here destroys a host's PRIVATE extras rows
    // too. Pre-existing, unchanged by this commit, and noted so the citation above is not
    // read as claiming the two paths differ on one axis only.)
    // So a category the model did not emit has ALWAYS been wiped by a paste,
    // and a category the scrub empties is the same outcome by the same contract, not a new
    // one. Narrowing the delete to the surviving categories would reverse that decision
    // AND point the wrong way for this commit's own purpose: the row left standing could be
    // a previous run's leaked code, which is exactly what must not survive a re-paste.
    // What IS a real residual is that the host is not told — see the note at the warn below.
    const { rows, redacted } = buildRows(apartmentId, valid)
    if (redacted > 0) {
      // Count only, never the text. Silent suppression is the one thing the incident
      // comment above calls out as a real difference between the two doors, so at least
      // the operator can see it happened.
      //
      // THE HOST IS STILL NOT TOLD, and that is a KNOWN RESIDUAL, not an oversight. The
      // other door returns `redacted` in its response and ImportListing.tsx renders "We
      // left N sentence(s) out of the public sections"; this one returns categories only,
      // and PropertySetup.tsx renders NOTHING for an empty list while clearing the paste
      // box — so an all-scrubbed run looks to the host like it worked. Closing it means
      // adding a field to this response and a line to that component, which is a shape
      // change this commit deliberately does not make. Do not mistake the log for the fix.
      console.warn('[bulk-import] credential sentences removed before insert:', redacted)
    }
    if (rows.length === 0) {
      return res.status(200).json({ categories: [] })
    }

    await admin
      .from('apartment_details')
      .delete()
      .eq('apartment_id', apartmentId)
      .in('category', EXTRAS_CATEGORIES)

    const { error: insertErr } = await admin.from('apartment_details').insert(rows)
    if (insertErr) {
      console.error('[bulk-import] insert failed:', insertErr.message)
      return res.status(500).json({ error: 'save_failed' })
    }

    // Derived from the rows actually INSERTED, not from `valid` — a category whose only
    // content was a code sentence is gone, and the response must not claim it was saved.
    const categories = rows.map(row => row.category)
    return res.status(200).json({ categories })
  } catch (e) {
    const msg = scrubErr(e, 120)
    console.error('[bulk-import] generateContent failed —', msg)
    return res.status(502).json({ error: 'rewrite failed' })
  } finally {
    clearTimeout(timer!)
  }
}
