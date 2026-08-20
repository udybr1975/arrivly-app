// Listing-importer TEXT rules — the parts that must agree between the browser (which extracts
// and truncates) and api/import-listing.ts (which re-checks what actually arrived).
//
// BROWSER-BUNDLED. This module reaches the client through ImportListing -> PropertySetup, so
// NOTHING here may use syntax an older browser cannot PARSE — a parse error takes the whole module
// down, not just the offending function. Specifically: no lookbehind (`(?<=`), unsupported before
// Safari 16.4. The importer's sentence scrub uses one, which is why it lives server-side in
// api/_lib/import-listing.ts and not here.
//
// DEPENDENCY-FREE ON PURPOSE (zero imports). It is consumed from an api/ serverless function
// running as native Node ESM, so anything browser-only or env-dependent would break it at Lambda
// startup. Same precedent as src/guide/content.ts and src/lib/detailCategories.ts.
//
// WHY THE LIMIT LIVES HERE AND NOT IN BOTH PLACES: the client truncates and shows the notice,
// the server re-truncates because a client value is untrusted. Two copies of 20,000 would be two
// things to keep in step; one export cannot drift.

/**
 * Absolute character ceiling — a cheap pre-check, NOT the real constraint. See
 * CONTENT_TOKEN_BUDGET below, which is what actually binds.
 */
export const MAX_IMPORT_CHARS = 12_000

/**
 * Ceiling for the stored source document, MIRRORING the DB CHECK on
 * `apartment_source_docs.content` (length <= 20000, verified at source 19 Aug 2026). Deliberately
 * a SEPARATE constant from MAX_IMPORT_CHARS: that one is derived from the Groq TPM reservation and
 * can move, this one is a database constraint and cannot.
 * CURRENTLY UNREACHABLE, and the REASON is the part worth writing down — an earlier version of
 * this comment gave the wrong one. It is not that MAX_IMPORT_CHARS is 12,000; it is that
 * truncateForImport caps by TOKENS, and CONTENT_TOKEN_BUDGET (3,300) x the estimator's 3
 * chars/token for ASCII bounds any stored document at 9,900 characters — fewer in any other
 * script. So the slice is defence against a future change to the token budget or to the caller,
 * not against today's input. Measured, not reasoned from the constant names.
 */
export const SOURCE_DOC_MAX_CHARS = 20_000

/**
 * The real cap: estimated PROMPT tokens for the document text.
 *
 * DERIVED FROM THE TPM CEILING. Groq debits promptTokens + max_tokens as a RESERVATION, and a
 * reservation above the verified 8,000 TPM ceiling can NEVER be satisfied on any bucket state —
 * a PERMANENT failure no retry clears. Measured, not assumed:
 *
 *   system    SYSTEM_PROMPT, 3,272 chars, measured with estimateTokens = 1,097
 *   content   CONTENT_TOKEN_BUDGET                                     = 3,300
 *   output    max_tokens in api/import-listing.ts                      = 2,800
 *   reservation                                                        = 7,197 < 8,000
 *
 * A CHARACTER cap alone CANNOT be safe here, and this is the trap the first version fell into.
 * SYSTEM_PROMPT tells the model to preserve the document's language, and nothing restricts the
 * script a host may upload. Measured with estimateTokens over 12,000 chars:
 *   Latin  ≈ 4,000 tokens · Greek ≈ 7,600 · CJK far worse per character.
 * So 12,000 chars of Greek would alone have consumed almost the whole minute. Budgeting in
 * TOKENS makes the cap self-adjusting: a Latin document truncates near 9,900 chars (clearing the
 * largest real document measured — a 9,190-char Booking.com export), a Greek one much earlier,
 * and both produce the same honest truncation notice the host already understands.
 */
export const CONTENT_TOKEN_BUDGET = 3_300

/** Groq's verified org-wide ceiling. The reservation must stay under it — see the table above. */
export const TPM_CEILING = 8_000

/** Output half of the reservation. Exported so api/import-listing.ts does not hand-copy it and
 *  so the whole arithmetic can be asserted in one test rather than trusted in three comments. */
export const OUTPUT_TOKEN_BUDGET = 2_800

/**
 * Deliberately CONSERVATIVE token estimate — it should over-count, never under-count, because
 * under-counting is what produces an unsatisfiable reservation.
 *
 * TWO estimates, and the LARGER wins:
 *  (a) character-based — ASCII at 3 chars/token (real prose is nearer 4), non-ASCII at 1.2.
 *  (b) whitespace-run count — every whitespace-delimited run costs AT LEAST one BPE token.
 *
 * (b) exists because (a) alone is conservative for PROSE but NOT for whitespace-exploded text,
 * and THIS FILE'S OWN PDF PATH CAN PRODUCE EXACTLY THAT: pdfjs joins text items with a space, and
 * some PDFs emit one item per glyph, giving 'T h e  h o u s e'. Char-counting scores that at ~1
 * token per 3 chars when the truth is nearer 1 per 2 — the under-count that yields a permanent,
 * unretryable over-reservation. Measured: an exploded sample scores 2,867 by (a) and 3,401 by
 * (b). Normal prose is the other way round (3,117 vs 1,530), so (b) never binds on real text and
 * the largest real document measured is unaffected.
 *
 * This is an estimate for BUDGETING, not a tokenizer; it never needs to be exact, only safe.
 * KNOWN residual: astral code points (emoji, ZWJ sequences) count as one wide unit and can cost
 * more — bounded, because Groq rejects an over-limit reservation without debiting it.
 */
export function estimateTokens(text: string): number {
  let ascii = 0
  let wide = 0
  for (const ch of text) {
    if (ch.codePointAt(0)! < 128) ascii++
    else wide++
  }
  const charBased = ascii / 3 + wide / 1.2
  const runs = text.match(/\S+/g)?.length ?? 0
  return Math.ceil(Math.max(charBased, runs))
}

/**
 * Below this, an extracted PDF is almost certainly a scan (image-only, no text layer).
 * The client shows the "paste it instead" copy and does NOT call the API — there is nothing to
 * sort, and a model call on 12 characters is pure spend.
 */
export const MIN_EXTRACTED_CHARS = 40

/**
 * WhatsApp exports prefix EVERY line with `[HH:MM, D/M/YYYY] Sender Name: `.
 * Left in, those stamps are the single largest source of junk tokens in a pasted chat log, and
 * the sender names are personal data with no reason to reach a model. Stripped in the browser,
 * before the text is ever displayed or sent.
 *
 * The `[^:]{1,40}` sender bound is deliberate: it cannot cross a colon, so a message whose BODY
 * contains a colon keeps its body, and an unbounded run can never swallow a paragraph.
 */
export const WHATSAPP_STAMP_RE = /\[\d{1,2}:\d{2}, \d{1,2}\/\d{1,2}\/\d{4}\] [^:]{1,40}: /g

/** Remove WhatsApp export stamps. Returns the input unchanged when there are none. */
export function stripWhatsAppStamps(text: string): string {
  // A fresh regex per call: WHATSAPP_STAMP_RE carries /g, so it is stateful via lastIndex and
  // sharing it across calls would make results depend on call order.
  return text.replace(new RegExp(WHATSAPP_STAMP_RE.source, 'g'), '')
}

/**
 * Apply BOTH caps: the character ceiling first (cheap), then the token budget (what binds).
 * `truncated` drives the client's warning and the API's response flag.
 * Boundary: text already inside both caps is returned untouched and NOT flagged.
 */
export function truncateForImport(text: string): { text: string; truncated: boolean } {
  let out = text.length > MAX_IMPORT_CHARS ? text.slice(0, MAX_IMPORT_CHARS) : text
  let truncated = out.length < text.length

  if (estimateTokens(out) > CONTENT_TOKEN_BUDGET) {
    // One proportional cut gets close; the loop then converges from above. Bounded by the 0.95
    // factor and the length floor, so it always terminates — a dense script simply lands on a
    // shorter string, which is the whole point.
    const ratio = CONTENT_TOKEN_BUDGET / estimateTokens(out)
    out = out.slice(0, Math.max(1, Math.floor(out.length * ratio)))
    while (out.length > 1 && estimateTokens(out) > CONTENT_TOKEN_BUDGET) {
      out = out.slice(0, Math.floor(out.length * 0.95))
    }
    truncated = true
  }

  // A UTF-16 slice can cut an astral character in half and leave a LONE HIGH SURROGATE at the
  // end. Harmless for a model call, but the importer now WRITES this text to Postgres, which
  // rejects an unpaired surrogate — surfacing as an opaque driver message on the "Chat
  // knowledge" section. Dropping one trailing orphan is exact; a well-formed pair is untouched.
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1)

  return { text: out, truncated }
}

// SCRIPT-agnostic, not language-agnostic — and the distinction is the honest one: `\d` is
// ASCII-only, so this covers a code written in ASCII numerals whatever the surrounding language,
// and covers NOTHING written in Arabic-Indic or fullwidth numerals. SYSTEM_PROMPT tells the model
// to preserve the document's language, so a word list alone would have covered one of the three
// markets this serves; a digit run covers the rest, up to that ASCII limit.
// '15:00' and 'EUR 45' do not match — neither contains a 4-digit run. A street number or a year
// does, and costs one click; that is the tradeoff this file already accepts.
// LEADING boundary only. `\b\d{4,8}\b` cannot match the '1125' in '1125A' — A is a word
// character, so the trailing boundary fails — and an alphanumeric code is exactly the shape the live
// incident had. Dropping the trailing boundary catches it; keeping the leading one stops a match
// mid-token ('a12345'). Still 4, not the scrub's 3: this fires on its own (the badge is a
// disjunction), so a 3-digit run here would badge 'Room 101'.
// CONSEQUENCE WORTH NAMING: without the trailing boundary this also matches the FIRST four digits
// of a longer run, so a phone number or a timestamp now badges. Safe direction — the badge only
// unticks — and SYSTEM_PROMPT already tells the model to skip host contact details.
export const DIGIT_RUN_RE = /\b\d{4,8}/
// English + the languages of the live market (Finnish, Spanish, French). Bare 'pass' is
// DELIBERATELY absent: it flagged 'Passeig de Gracia', 'passage' and 'passport'. A badge that
// cries wolf on an address line teaches the host to ignore it, which defeats the control.
export const CREDENTIAL_WORDS_RE =
  /password|passcode|wi-?fi|ssid|door\s*code|gate\s*code|alarm\s*code|entry\s*code|key\s*pad|key\s*safe|\bpin\b|lock\s*box|salasana|ovikoodi|contrase|clave|codigo|cerradura|mot\s*de\s*passe|code\s*d.entr|digicode/i

export function looksLikeCredentialText(
  text: string,
  opts: { digitRun?: boolean } = {},
): boolean {
  // Fresh regexes per call — neither carries /g today, but a future edit adding one would
  // otherwise make results depend on call order. Same trap as WHATSAPP_STAMP_RE.
  if (new RegExp(CREDENTIAL_WORDS_RE.source, 'i').test(text)) return true
  // The digit run is the language-agnostic half. Callers may switch it off for fields that are
  // number-bearing by construction (addresses, postcodes) — see looksLikeCredential in
  // ImportListing, and the cry-wolf argument recorded there.
  if (opts.digitRun === false) return false
  return new RegExp(DIGIT_RUN_RE.source).test(text)
}

/**
 * Find the access code inside a private check-in row, for the guest page's one-tap copy cell.
 *
 * ONE IMPLEMENTATION, EXPORTED. There were three uncoordinated copies of the old pattern — the
 * quick-access strip, the check-in card, and a fourth declared inside the test — so the test
 * pinned something nothing shipped and editing one call site was invisible to the suite.
 *
 * TOKENISE, THEN FILTER. Not a regex that tries to express the whole rule. Two earlier attempts
 * failed here in ways worth recording, because both produced a WRONG VALUE rather than none, and
 * a wrong code is far worse than no code: the guest stands at the door with something plausible
 * that cannot work, where an absent button would have sent them to the full text.
 *
 *   1. `([A-Za-z0-9#*-]{3,12})` bounded by \b and a negative lookahead LOOKED fail-closed and was
 *      not. `\b` is defined against [A-Za-z0-9_], but the class admits `-`, `#` and `*` — every
 *      one of which creates a fresh legal boundary INSIDE a code. So "1234-5678-9012" slid the
 *      window and returned "-5678-9012", and "*1234#" returned "1234#", silently dropping a
 *      leading character. A CHARACTER CLASS THAT ADMITS NON-WORD CHARACTERS INVALIDATES EVERY \b
 *      USED AS ITS BOUNDARY.
 *   2. Slicing the line to the window before matching made the window a TERMINATOR as well as a
 *      distance: the lookahead then saw end-of-window instead of the next character, so a code
 *      straddling the cut was truncated rather than rejected.
 *
 * Matching whole tokens and testing their LENGTH fixes both: an over-long code is seen entire and
 * rejected, and a code containing punctuation is returned intact. The window is now only a
 * distance test on where the token starts.
 *
 * A VALUE MUST CONTAIN A DIGIT, as a FILTER over every candidate in the window rather than a veto
 * on the first — "El código de la puerta es 1125" puts two words between the label and the value,
 * and a lazy single-regex version matched "puerta", found no digit and gave up.
 *
 * BENIGN COMPOUNDS ARE EXCLUDED ON BOTH SIDES, mirroring BENIGN_CODE_PHRASES_RE server-side.
 * English puts the qualifier first ("postal code 00100"), French and Spanish put it after ("code
 * postal 75003", "código postal"), and without both checks the postcode wins over the real code
 * later in the sentence.
 *
 * KEYWORDS COVER THE LIVE MARKET, with leading \b only on the English words: Finnish compounds
 * ("porttikoodi", "ovikoodi") and French "digicode" must match INSIDE a word, while `\bpins?`
 * must not fire on "Chopin".
 *
 * Every failure direction is safe: no match means no copy cell, and the full row text is shown to
 * the same viewer on the same page regardless.
 */
export const DOOR_CODE_KEYWORD_RE = /(?:\bcodes?|digicode|\bpins?|koodi|c[oó]digos?|\bclaves?)\b/i

/** Distance only — how far after the keyword a value may START. Never crosses a line. */
export const DOOR_CODE_WINDOW = 26

/** Accepted token length. The anti-truncation argument reduces to SLICE_SLACK > DOOR_CODE_MAX_LEN:
 *  a token is judged only if it starts inside the window, so it must be VISIBLE past the cap to be
 *  rejected whole rather than trimmed into the band. These were two bare literals in separate
 *  statements; raising the cap past the slack silently reopened the defect four gate rounds closed,
 *  and no test could see it. Derived now, and pinned by a test. */
export const DOOR_CODE_MIN_LEN = 3
export const DOOR_CODE_MAX_LEN = 12
export const DOOR_CODE_SLICE_SLACK = DOOR_CODE_MAX_LEN + 4

/** A whole run of code-ish characters. Length is checked in code, not by the regex, so an
 *  over-long token is REJECTED rather than trimmed. */
export const DOOR_CODE_TOKEN_RE = /[A-Za-z0-9#*-]+/

const BENIGN_BEFORE_RE = /(?:postal|post|zip|area|dialling|dialing|dress|country|qr|bar|error)\s*$/i
const BENIGN_AFTER_RE = /^\s*(?:postal|postale|zip|area|de\s+barras)\b/i

export function extractDoorCode(text: string): string | null {
  // Fresh regexes per call: /g is stateful via lastIndex, and a shared instance would make results
  // depend on call order.
  const keyword = new RegExp(DOOR_CODE_KEYWORD_RE.source, 'gi')
  let k: RegExpExecArray | null
  while ((k = keyword.exec(text)) !== null) {
    // Bounded slice, not the whole tail: slicing the remainder on every keyword hit is O(n*k).
    // WINDOW + DOOR_CODE_SLICE_SLACK is enough to see a token that STARTS inside the window and
    // runs past it, which
    // is what lets an over-long code be rejected WHOLE instead of trimmed.
    const line = text
      .slice(keyword.lastIndex, keyword.lastIndex + DOOR_CODE_WINDOW + DOOR_CODE_SLICE_SLACK)
      .split(/[\n\r]/)[0]
    if (BENIGN_BEFORE_RE.test(text.slice(Math.max(0, k.index - 14), k.index))) continue
    if (BENIGN_AFTER_RE.test(line.slice(0, 14))) continue
    for (const m of line.matchAll(new RegExp(DOOR_CODE_TOKEN_RE.source, 'g'))) {
      if ((m.index ?? 0) >= DOOR_CODE_WINDOW) break
      const token = m[0]
      // BREAK, not continue, on an over-cap token THAT CARRIES A DIGIT. Falling through to a shorter neighbour offered
      // a room number as the door code — measured: "Door code: ABCD1234EFGH56 room 214" returned
      // "214". An over-cap token inside the window is strong evidence it WAS the intended value,
      // so the honest answer is no code rather than a different one. Short non-digit tokens still
      // fall through, which is what keeps "El codigo de la puerta es 1125" working.
      // The digit test is what keeps the break narrow: an over-cap token with no digit is an
      // ORDINARY WORD sitting between the label and the value, and Finnish and Spanish put long
      // ones there routinely ("Ovikoodi rakennuksessa 1125" — 13 chars; "accommodation" — 13).
      // Breaking on those would silently lose codes in the home market. An over-cap token WITH a
      // digit is the code-shaped impostor this guard exists for, so it still abandons the keyword.
      if (token.length > DOOR_CODE_MAX_LEN) { if (/\d/.test(token)) break; continue }
      if (token.length >= DOOR_CODE_MIN_LEN && /\d/.test(token)) return token
    }
  }
  return null
}
