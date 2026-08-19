// Listing importer — the PURE half: prompt text, JSON coercion and validation.
//
// Split out of api/import-listing.ts so every rule below is testable with plain node (no
// network, no supabase) — see api/_lib/import-listing.test.mjs. The endpoint keeps auth,
// ownership, the model call and the HTTP shape.
//
// THE MODEL'S OUTPUT IS UNTRUSTED INPUT. It is shown to the host in a review screen and can be
// applied to their property, so every field is whitelisted, typed, trimmed and capped here.
// Nothing reaches the client that did not survive this file.

import { EXTRAS_CATEGORIES, isExtrasCategory } from '../../src/lib/detailCategories.js'
import { CREDENTIAL_WORDS_RE } from '../../src/lib/listingText.js'

/** Per-field character cap. Generous for an entry-instructions paragraph, far below anything
 *  that could bloat a response — a model that ignores the prompt and echoes the whole document
 *  into one field gets clipped rather than passed through. */
export const MAX_FIELD_CHARS = 4_000

/** Array caps. Sized to the domain, not to the model's imagination: there are seven extras
 *  categories (a few items each is plausible), and a skipped/conflicts list longer than this is
 *  noise the host will not read. */
export const MAX_EXTRAS_ITEMS = 20
export const MAX_SKIPPED_ITEMS = 30
export const MAX_CONFLICT_ITEMS = 20
export const MAX_CONFLICT_VALUES = 5

export interface ImportBasics {
  description?: string
  street?: string
  street_number?: string
  floor_note?: string
  max_guests?: number
  city?: string
  neighborhood?: string
  country?: string
}
export interface ImportWifi { ssid?: string; password?: string }
export interface ImportCheckin {
  check_in_from?: string
  check_out_by?: string
  door_code?: string
  entry_instructions?: string
}
export interface ImportExtra { category: string; content: string }
export interface ImportConflict { field: string; values: string[] }

export interface ImportProposal {
  basics: ImportBasics
  wifi: ImportWifi
  checkin: ImportCheckin
  rules?: string
  extras: ImportExtra[]
  picks_text?: string
}

export interface ValidatedImport {
  proposal: ImportProposal
  skipped: string[]
  conflicts: ImportConflict[]
  /** Sentences removed from PUBLIC fields because they carried an access code. Surfaced so the
   *  client can say why a section reads thinner, rather than leaving the host to wonder. */
  redacted: number
}

// Whitelists. A key not named here is STRIPPED — the model cannot introduce a field, and a
// future column cannot be written by prompt injection in a host's uploaded document.
const BASIC_STRING_KEYS = ['description', 'street', 'street_number', 'floor_note', 'city', 'neighborhood', 'country'] as const
const WIFI_KEYS = ['ssid', 'password'] as const
const CHECKIN_KEYS = ['check_in_from', 'check_out_by', 'door_code', 'entry_instructions'] as const

export const SYSTEM_PROMPT =
  'You are sorting a short-term rental host\'s own guest guide / house manual into the fields of their property page. ' +
  'Output ONLY a JSON object with these keys: ' +
  '"basics" (object: description, street, street_number, floor_note, max_guests (number), city, neighborhood, country), ' +
  '"wifi" (object: ssid, password), ' +
  '"checkin" (object: check_in_from, check_out_by, door_code, entry_instructions), ' +
  '"rules" (string), ' +
  '"extras" (array of { "category": string, "content": string }), ' +
  '"picks_text" (string), ' +
  '"skipped" (array of short strings), ' +
  '"conflicts" (array of { "field": string, "values": array of strings }). ' +
  'Every "extras" category MUST be exactly one of: ' + EXTRAS_CATEGORIES.join(', ') + '. ' +
  // NEAR THE TOP AND IMPERATIVE, because it is the rule a live test caught the model breaking:
  // it filed door codes correctly into checkin AND repeated the values inside public extras prose
  // ("lockbox with building code 1125A", "courtyard gate code 1125"). The prompt is a REQUEST —
  // scrubCredentialSentences in the validation layer is the belt that does not depend on
  // compliance. Both exist on purpose.
  'Access codes, PINs, passwords and lock combinations must appear ONLY in the wifi and checkin fields. ' +
  'When writing extras or rules content, mention the FACT if useful ("the courtyard gate is code-locked") ' +
  'but NEVER the code value itself. This applies even if the source text repeats the code in several places. ' +
  'Put safety information under "Safety" — for example a fuse box or trip switch, emergency numbers, ' +
  'the smoke alarm, a fire extinguisher or blanket, first aid, water shut-off, and the building ' +
  'maintenance or caretaker contact FOR EMERGENCIES. Do not let safety content fall into "Good to know". ' +
  'EXTRACT, NEVER INVENT: every value must be traceable to a phrase in the supplied text. ' +
  'Omit any field that is not present. Prefer an empty object or empty array over guessed content. ' +
  'Preserve the language of the document and never translate the content. ' +
  'Category names and JSON keys stay in English. ' +
  'IGNORE the following and instead add a short label for each to "skipped": cancellation or refund policy, ' +
  'review scores and ratings, empty FAQ stubs, booking-platform boilerplate such as "Unavailable: ..." amenity lines, ' +
  'prices and fees, chat-export timestamps, and legal or damage-deposit text. ' +
  'NEVER extract the host\'s own phone number, WhatsApp number or email address into any field; ' +
  'if the text contains them, add the skipped label "host contact details". ' +
  'If the same fact appears twice with different values (for example two different check-out times), ' +
  'put the likelier value in its field AND record both values in "conflicts". ' +
  '"picks_text" is for passages where the host recommends restaurants, cafes, bars, sights or shops — ' +
  'copy them verbatim or lightly joined; do not invent addresses and do not impose structure. ' +
  'Output the raw JSON object only, no other text, no code fences.'

// ── credential scrub for PUBLIC fields ────────────────────────────────────────────────────
//
// WHY THIS EXISTS ON TOP OF THE PROMPT: a live test of the importer showed the model filing door
// codes CORRECTLY into the private checkin fields and ALSO repeating the values inside public
// extras prose — "lockbox with building code 1125A, lockbox code 0321" under Safety, "courtyard
// gate code 1125" under Good to know. The review screen's badge caught them, but the badge is the
// LAST line of defence and the sort should never have produced that content. The prompt now
// forbids it; THIS is the belt that does not depend on the model complying.
//
// SERVER-SIDE ONLY, AND THAT IS WHY IT LIVES HERE rather than beside the badge in
// src/lib/listingText.ts: SENTENCE_SPLIT_RE uses a lookbehind, which is unsupported before Safari
// 16.4. In listingText — which IS bundled into the browser — an old iPad would fail to parse the
// whole module and take the property editor's import UI down with it. Nothing in the browser
// calls this.

// Conservative, language-tolerant sentence split. The lookbehind KEEPS the terminator on the
// preceding fragment, so the pieces below stay recognisable as sentences.
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+|\n+/

// BROADER than the badge's DIGIT_RUN_RE, and boundary-free: `\b\d{3,8}\b` does not match the
// '1125' in 'building code 1125A'. A bare 3+ digit run cannot be reached by a time ('15:00') or a
// small number ('Space 14'), and it only ever fires in CONJUNCTION with a credential word.
const SCRUB_DIGIT_RUN_RE = /\d{3,8}/

// A "code" followed by something that looks like a VALUE.
// DELIBERATE NARROWING of the obvious shape (`\bcode\s*[:\-]?\s*\S+`): that form also matches
// "code is", so "The door code is given at check-in" — a useful FACT sentence carrying no value —
// would have been destroyed. Requiring a digit-bearing token keeps the fact and kills the value.
const CODE_VALUE_RE = /\bcode\s*[:\-]?\s*\S*\d\S*/i

// SCRUB-ONLY word set: the badge's list plus bare `code`/`combination` and the stems below.
// WHY BROADER THAN THE BADGE: the badge enumerates door/gate/alarm/entry code, and the live test
// showed that misses what hosts actually write — "barrier code is 4432", "building code",
// "keypad combination". The badge can afford to be narrow because a false positive there costs a
// click; this drops text from a public field, so it must not depend on having guessed the noun.
// SAFE ONLY BECAUSE OF THE CONJUNCTION: bare `code` alone would gut ordinary prose, but paired
// with a digit run it fires on "the barrier code is 4432" and NOT on "the gate is code-locked".
//
// PLURALS AND ACCENTS ARE PART OF THE LANGUAGE, NOT AN EXTRA: `\bcode\b` does not match "Codes",
// and unaccented `codigo` does not match "código" — Barcelona is a live market and Finnish `koodi`
// is the ordinary word, not just the `ovikoodi` compound. Each of those was a real miss INSIDE the
// languages this list claims to cover, which is a different and worse thing than the declared
// limitation below.
//
// LANGUAGE-SCOPED, NOT LANGUAGE-AGNOSTIC — say so plainly, because SYSTEM_PROMPT tells the model
// to preserve the document's language and the token budget exists precisely so a Greek or CJK
// manual can be imported. A manual in a language outside this list gets NO scrub and falls back to
// the badge, which is a real fallback for DIGIT codes in any language and no fallback at all for
// an alphabetic one. Extend the list when a market is added.
const SCRUB_EXTRA_WORDS_RE =
  // `koodi` UNANCHORED, and that is the point: Finnish builds compounds, so an anchored \bkoodi
  // matches only the bare word and misses porttikoodi, rappukoodi, avainkoodi — while the
  // separately listed `ovikoodi` is itself the proof that compounds are the expected shape.
  // Finland is the PRIMARY market; anchoring here undid the language it was added for.
  // SWEDISH `\bkod\b` WAS REMOVED, NOT FIXED. Unanchored it would be worse: `kod` is "at/by",
  // one of the commonest words in Croatian/Serbian/Bosnian, so paired with a 3-digit run it
  // silently deleted "Autobusna stanica je kod zgrade, linija 205." — an aggressive scrub in a
  // language this file PROMISES not to scrub at all. It cost more than it bought.
  /\bcodes?\b|\bcombinations?\b|c[oó]digo|koodi|zugangscode|kennwort|passwort|codice|senha|κωδικ|hasło/i
const SCRUB_WORDS_RE = new RegExp(CREDENTIAL_WORDS_RE.source + '|' + SCRUB_EXTRA_WORDS_RE.source, 'i')

// Compounds where "code" is NOT a credential. Blanked before the noun test so "The postal code is
// 00100" survives — a real sentence in this market, and `código postal` is routine in Barcelona.
// A QR or bar code is the same class: a sentence about one is not a sentence about a secret.
const BENIGN_CODE_PHRASES_RE =
  /\b(?:postal|post|zip|area|dialling|dialing|dress|country|qr|bar|error)\s+codes?\b|\bc[oó]digo\s+postal\b|\bcode\s+postal\b/gi

// A fragment that is NOTHING BUT a value — "1125A", "0321.", "(1125)", "• 1125".
// NOT a regex, because the obvious one (`^\W*\S*\d\S*\W*$`) has two defects: `\W` is ASCII-only,
// so Greek and Cyrillic LETTERS count as padding and "Διαμέρισμα 412" qualifies as "nothing but a
// value" — a multi-word fragment that could then be merged onto its neighbour; and the adjacent
// `\W*`/`\S*` runs overlap on punctuation, which backtracks quadratically on a long punctuation-
// only fragment. Stripping Unicode-aware padding and testing the core is linear and script-blind.
function isOrphanValue(fragment: string): boolean {
  const core = fragment.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  return core !== '' && !/\s/.test(core) && /\d/.test(core)
}

// NOTE none of SCRUB_WORDS_RE / SCRUB_DIGIT_RUN_RE / CODE_VALUE_RE carries /g, so `.test` on them
// is stateless and they are used directly below — no per-sentence copy. BENIGN_CODE_PHRASES_RE
// DOES carry /g and IS copied per use, because a shared lastIndex would make results depend on
// call order.

function namesCredential(sentence: string): boolean {
  // Blank the benign compounds first so "postal code" cannot satisfy the noun half.
  return SCRUB_WORDS_RE.test(sentence.replace(new RegExp(BENIGN_CODE_PHRASES_RE.source, 'gi'), ' '))
}

/**
 * Remove sentences that carry an access code from text bound for a PUBLIC field.
 *
 * THE CONJUNCTION IS THE POINT: a sentence dies only when it names a credential AND carries
 * something value-shaped. "The courtyard gate is code-locked" keeps the useful fact; "courtyard
 * gate code 1125" loses the secret. Dropping on either signal alone would gut ordinary prose.
 *
 * THE ORPHAN MERGE IS WHAT CLOSES THE SPLIT-VALUE HOLE. A label and its value on separate lines
 * ("Building code\n1125A") arrive as two fragments, NEITHER carrying both signals, so a naive pass
 * keeps both. An earlier fix re-scrubbed the rejoined text, which worked for that case and then
 * DELETED A WHOLE BULLETED SECTION: bullets carry no terminators, so pass 1 flattened four unrelated
 * safety lines into one sentence and pass 2 dropped all of them for one code, while the banner
 * still said "1 sentence". Merging only the ADJACENT ORPHAN fixes both — the pair dies, the
 * neighbours live, and `redacted` stays truthful. It also closes the terminator variant
 * ("Gate code.\n1125"), which no amount of re-scrubbing could, because the split is idempotent
 * across a full stop.
 *
 * RETURNS THE INPUT UNTOUCHED WHEN NOTHING WAS DROPPED, so a clean bulleted list keeps its line
 * breaks. When something IS dropped, survivors are rejoined with a newline if the source contained
 * ANY newline (presence, not dominance — a mostly-prose field with one line break is re-wrapped one
 * sentence per line), otherwise a space. Nothing is corrupted: the lookbehind keeps each
 * terminator on its own fragment.
 *
 * NEVER call this on wifi/checkin values — those fields are where codes BELONG.
 */
export function scrubCredentialSentences(text: string): { text: string; redacted: number } {
  const rawFragments = text.split(SENTENCE_SPLIT_RE).filter(s => s.trim())
  if (rawFragments.length === 0) return { text, redacted: 0 }

  // Glue each value-only fragment onto the credential-naming fragment before it.
  const units: string[] = []
  for (const fragment of rawFragments) {
    const previous = units[units.length - 1]
    if (
      previous !== undefined &&
      isOrphanValue(fragment) &&
      !namesCredential(fragment) &&
      namesCredential(previous)
    ) {
      units[units.length - 1] = `${previous} ${fragment.trim()}`
      continue
    }
    units.push(fragment.trim())
  }

  const kept: string[] = []
  let redacted = 0
  for (const unit of units) {
    const probe = unit.replace(new RegExp(BENIGN_CODE_PHRASES_RE.source, 'gi'), ' ')
    const carriesValue = SCRUB_DIGIT_RUN_RE.test(probe) || CODE_VALUE_RE.test(probe)
    if (namesCredential(unit) && carriesValue) { redacted++; continue }
    kept.push(unit)
  }

  if (redacted === 0) return { text, redacted: 0 }
  return { text: kept.join(text.includes('\n') ? '\n' : ' ').trim(), redacted }
}

// ── coercion helpers ──────────────────────────────────────────────────────────────────────

function cleanString(v: unknown, cap = MAX_FIELD_CHARS): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  if (!t) return undefined
  return t.length > cap ? t.slice(0, cap) : t
}

/**
 * PROVIDER WORKAROUND, same class as bulk-import's array unwrap and replicated here at the
 * granularity this endpoint's schema needs. Groq's json_object mode emits a top-level OBJECT, so
 * a field the prompt asks to be an ARRAY can arrive wrapped (e.g. "extras": {"items": [...]}).
 * Unwrap a single array-valued property; anything else degrades to [] rather than throwing,
 * because a malformed sub-field must not cost the host the whole import.
 */
export function coerceArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object') {
    const arrays = Object.values(v as Record<string, unknown>).filter(Array.isArray)
    if (arrays.length === 1) return arrays[0] as unknown[]
  }
  return []
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/**
 * The same workaround one level up: the whole proposal can arrive wrapped in a single
 * object-valued property (e.g. {"result": {...}}). Unwrap only when the outer object carries
 * NONE of our known keys, so a legitimate response is never re-interpreted.
 */
export function unwrapProposal(parsed: unknown): Record<string, unknown> {
  const obj = asObject(parsed)
  const KNOWN = ['basics', 'wifi', 'checkin', 'rules', 'extras', 'picks_text', 'skipped', 'conflicts']
  if (KNOWN.some(k => k in obj)) return obj
  const objectValues = Object.values(obj).filter(v => v && typeof v === 'object' && !Array.isArray(v))
  if (objectValues.length === 1) return objectValues[0] as Record<string, unknown>
  return obj
}

// ── validation ────────────────────────────────────────────────────────────────────────────

/**
 * Turn whatever the model returned into a proposal that is safe to render and apply.
 * NEVER throws and never rejects wholesale: an unusable sub-field is dropped, because a host
 * whose WiFi block was malformed should still get their house rules.
 * An entirely empty proposal is a VALID result — the caller returns 200 and the client renders
 * the empty state.
 */
export function validateImport(parsed: unknown): ValidatedImport {
  const root = unwrapProposal(parsed)
  // Counts sentences removed from the PUBLIC-BOUND prose fields — extras content, rules, and the
  // two free-prose basics (description, floor_note). wifi/checkin are NEVER scrubbed: those
  // fields are exactly where a door code belongs.
  let redacted = 0

  const rawBasics = asObject(root.basics)
  const basics: ImportBasics = {}
  // `description` and `floor_note` are FREE PROSE on a public-by-intent row — floor_note is
  // exactly where a model puts "Flat 4B, keypad 1125A". Measured 19 Aug 2026: NEITHER column is
  // selected by api/guest-bootstrap.ts or api/welcome.ts, so this is defence for a LATENT path,
  // not a live leak — but it is one `select` away, and the client badge already treats both as
  // suspect (they are outside NUMERIC_BY_CONSTRUCTION). Scrubbing them stops the two layers
  // disagreeing about which fields are public-risky. The other basics keys are single values,
  // not prose, and are left alone.
  const PROSE_BASIC_KEYS = new Set<string>(['description', 'floor_note'])
  for (const k of BASIC_STRING_KEYS) {
    const v = cleanString(rawBasics[k])
    if (v === undefined) continue
    if (PROSE_BASIC_KEYS.has(k)) {
      const scrubbedBasic = scrubCredentialSentences(v)
      redacted += scrubbedBasic.redacted
      if (scrubbedBasic.text) basics[k] = scrubbedBasic.text
      continue
    }
    basics[k] = v
  }
  // max_guests: accept a number or a numeric string ("Sleeps 4" never reaches here — the model
  // is asked for a number). Must be a whole number in a plausible range or it is DROPPED, never
  // clamped: clamping would silently write a value the document does not support, and this field
  // feeds a real column.
  const rawGuests = rawBasics.max_guests
  const guests = typeof rawGuests === 'number' ? rawGuests : Number(cleanString(rawGuests) ?? NaN)
  if (Number.isFinite(guests) && Number.isInteger(guests) && guests >= 1 && guests <= 50) {
    basics.max_guests = guests
  }

  const rawWifi = asObject(root.wifi)
  const wifi: ImportWifi = {}
  for (const k of WIFI_KEYS) {
    const v = cleanString(rawWifi[k])
    if (v !== undefined) wifi[k] = v
  }

  const rawCheckin = asObject(root.checkin)
  const checkin: ImportCheckin = {}
  for (const k of CHECKIN_KEYS) {
    const v = cleanString(rawCheckin[k])
    if (v !== undefined) checkin[k] = v
  }

  // Same gate bulk-import uses, and for the same reason: isExtrasCategory is exact and
  // case-sensitive, so a hallucinated or near-miss category is dropped rather than coerced.
  const extras: ImportExtra[] = []
  for (const item of coerceArray(root.extras)) {
    if (extras.length >= MAX_EXTRAS_ITEMS) break
    const o = asObject(item)
    const rawCategory = o.category
    const content = cleanString(o.content)
    // typeof, NOT cleanString: cleanString TRIMS, and a trimmed 'Parking ' would then pass a
    // gate whose whole job is to be exact. The category is matched byte-for-byte or dropped.
    if (typeof rawCategory !== 'string' || !isExtrasCategory(rawCategory) || content === undefined) continue
    // PUBLIC field — scrub before it can be rendered or applied. If every sentence carried a
    // code, the item itself goes: an empty Safety row is worse than no Safety row.
    const scrubbed = scrubCredentialSentences(content)
    redacted += scrubbed.redacted
    if (!scrubbed.text) continue
    extras.push({ category: rawCategory, content: scrubbed.text })
  }

  const skipped: string[] = []
  for (const s of coerceArray(root.skipped)) {
    if (skipped.length >= MAX_SKIPPED_ITEMS) break
    // Short labels, not paragraphs — this renders as a list of chips.
    const v = cleanString(s, 120)
    if (v !== undefined) skipped.push(v)
  }

  const conflicts: ImportConflict[] = []
  for (const c of coerceArray(root.conflicts)) {
    if (conflicts.length >= MAX_CONFLICT_ITEMS) break
    const o = asObject(c)
    const field = cleanString(o.field, 80)
    if (field === undefined) continue
    const values: string[] = []
    for (const v of coerceArray(o.values)) {
      if (values.length >= MAX_CONFLICT_VALUES) break
      const s = cleanString(v, 200)
      if (s !== undefined) values.push(s)
    }
    // A conflict with fewer than two values is not a conflict — drop it rather than render a
    // row that says "these disagree" beside a single value.
    if (values.length >= 2) conflicts.push({ field, values })
  }

  const proposal: ImportProposal = { basics, wifi, checkin, extras }
  // House rules are is_private:false — the same public destination as extras, so the same belt.
  const rules = cleanString(root.rules)
  if (rules !== undefined) {
    const scrubbedRules = scrubCredentialSentences(rules)
    redacted += scrubbedRules.redacted
    if (scrubbedRules.text) proposal.rules = scrubbedRules.text
  }
  // picks_text is NOT scrubbed. Stated in terms of VISIBILITY, not destination table, because
  // host_picks IS anon-readable (api/guest-bootstrap.ts, api/welcome.ts): the path exists but is
  // narrow — /generate-host-picks extracts PLACES from this prose, PropertySetup sets note: '',
  // and the host confirms every candidate before a row is written. A code sentence would have to
  // survive as a place name or address and then be approved. Recorded as accepted, not overlooked.
  const picks = cleanString(root.picks_text)
  if (picks !== undefined) proposal.picks_text = picks

  return { proposal, skipped, conflicts, redacted }
}

/** True when the model found nothing usable. The client renders the global empty state; the
 *  endpoint still answers 200, because "nothing to import" is an outcome, not an error. */
export function isEmptyProposal(p: ImportProposal): boolean {
  return (
    Object.keys(p.basics).length === 0 &&
    Object.keys(p.wifi).length === 0 &&
    Object.keys(p.checkin).length === 0 &&
    p.extras.length === 0 &&
    !p.rules &&
    !p.picks_text
  )
}
