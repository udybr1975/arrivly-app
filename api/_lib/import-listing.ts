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

  const rawBasics = asObject(root.basics)
  const basics: ImportBasics = {}
  for (const k of BASIC_STRING_KEYS) {
    const v = cleanString(rawBasics[k])
    if (v !== undefined) basics[k] = v
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
    extras.push({ category: rawCategory, content })
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
  const rules = cleanString(root.rules)
  if (rules !== undefined) proposal.rules = rules
  const picks = cleanString(root.picks_text)
  if (picks !== undefined) proposal.picks_text = picks

  return { proposal, skipped, conflicts }
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
