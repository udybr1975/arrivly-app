// The PROMPT FENCE for short scalars. It lives ALONE in this module, with no imports and no
// top-level side effects, so a surface can fence a value without importing anything that
// reads privileged data (PG-38). Callers today: api/_lib/guest-access.ts (the guest system
// instruction) and api/welcome-chat.ts (the PUBLIC pre-arrival one).

// SHORT SCALARS GO INTO THE SYSTEM INSTRUCTION THROUGH HERE, never raw.
//
// WHY A READ-BOUNDARY FIX: a write-boundary fix must be repeated at every writer, forever,
// including writers that do not exist yet — a read-boundary fix is done once. These values are
// written by api/create-booking.ts, api/import-airbnb-csv.ts and the property editor today;
// sanitising there would have to be re-done at every future writer. This is the one place they
// are INTERPOLATED, so this is where the fence belongs.
//
// LATENT AND FORWARD-LOOKING, NOT A LIVE HOLE — do not read this as an active vulnerability.
// Every writer today is HOST-authenticated, and a host already controls this entire prompt
// through apartment_details, so a host gains NOTHING by injecting here. It is fenced because
// the writers will not always be host-authored: iCal pre-fill and guest self-identify are both
// on the roadmap, and at that point guestName becomes GUEST-controlled text sitting on the
// second line of a system instruction.
//
// KILLING LINE BREAKS IS THE LOAD-BEARING PART. Multi-line injection is what makes this work
// on a single-line field: a value containing a line break can close the sentence and open what
// reads as a new instruction.
//
// IT TAKES **TWO** OF THE STEPS BELOW TO DO THAT, AND NEITHER IS OPTIONAL — this is the trap
// to read before editing them. The control-character class covers C0, DEL and C1, which is LF,
// CR and NEL. It does NOT reach **U+2028 LINE SEPARATOR or U+2029 PARAGRAPH SEPARATOR**; those
// are caught ONLY by the `\s+` collapse, because JS `\s` includes them. So the collapse is a
// SECURITY step wearing the clothes of a formatting one. Measured: remove it and a value
// carrying U+2028 forges a line again. Do not drop it as cosmetic.
//
// Control characters are replaced rather than deleted for a second reason: they hide text from
// a reviewer reading a log or a diff without hiding it from the model. Truncation is last — an
// over-long value is itself a way to push the real rules out of attention, though it is a
// marginal control here next to the uncapped document and details blocks.
//
// NO NONCE FENCE HERE, DELIBERATELY. A nonce fence is for a multi-line THIRD-PARTY DOCUMENT,
// which is why the HOST DOCUMENT block in api/_lib/guest-access.ts has one. An 80-character
// scalar does not warrant
// one and it would cost tokens on every verified turn for no gain.
//
// SCOPE, so the next reader does not assume it is wider than it is: this covers the SHORT
// SCALARS on the opening line, the address line and the guest line. It does NOT cover the
// scalars inside detailsBlock, picksBlock or guideBlock — those sit inside multi-line blocks
// that are newline-joined by construction, so collapsing whitespace there would destroy the
// format. That is a different fix with a different shape.
export function asPromptScalar(v: string | null | undefined, maxLen: number): string {
  if (!v) return ''
  return v
    // C0 (includes newline, CR, tab) and C1/DEL become a SPACE, never removed outright, so two
    // words separated only by a newline do not silently fuse into one.
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    // QUOTE CHARACTERS ARE FOLDED, and this is a mechanism rather than tidiness. Once the
    // newline is gone the double quote is the ONLY structural delimiter left that a value can
    // forge — the calling modules (api/_lib/guest-access.ts and api/welcome-chat.ts) wrap these
    // in "..." , so a value containing one can close the
    // quotation early and leave its own text sitting at top level, outside the quotes. Folding
    // to an apostrophe keeps the value readable and removes the last delimiter those modules
    // emit. It is deliberately not exhaustive over quote-like
    // characters: backtick, guillemets, fullwidth quote and the curly SINGLES all survive. They
    // cannot close an ASCII `"`, so they are a perception attack on the model, not a structural
    // one — which puts them squarely in the NOT CLOSED box in api/_lib/guest-access.ts, not in
    // a gap this fold
    // pretends to cover.
    .replace(/["\u201C\u201D]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
    // slice() counts UTF-16 code units, so a cut can land inside a surrogate pair and leave a
    // lone high surrogate — which is not valid UTF-8 and can surface as an encoding error on
    // the way to the provider. Drop it; the cost is one character of an already-truncated value.
    .replace(/[\uD800-\uDBFF]$/, '')
}
