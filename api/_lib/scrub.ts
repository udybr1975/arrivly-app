// Redacts anything that looks like a Google API key (AIza…), a Groq API key (gsk_…), a Tavily
// API key (tvly-…), a Stripe secret or webhook key (sk_… / whsec_…), or a key= URL param from an
// arbitrary error/value, then truncates. Use everywhere an error message derived from a
// Gemini/GenAI/Groq/Tavily/geo/Stripe call might be logged, so no key can ever reach a log.
// Redaction runs BEFORE the truncate so a key cannot survive as a fragment. NOTE the `key=` rule
// is case-insensitive and unanchored, which is what also covers Geoapify's `apiKey=` URL param;
// Tavily's key travels in an Authorization header, so it needed its own prefix rule rather than
// being caught by that one.
//
// THE STRIPE RULES WERE ADDED LAST AND ARE THE REASON TO CHECK THIS LIST BEFORE REUSING IT: the
// billing endpoints (`create-subscription`, `change-plan`) each carried their OWN inline `sk_` /
// `whsec_` scrub, so a caller reaching for this shared helper on a Stripe path was getting a
// STRICTLY WEAKER scrub than the hand-rolled one next to it. A shared scrubber that does not know
// about a provider whose errors it is asked to scrub is a trap, not a convenience. The patterns
// deliberately mirror those inline rules (`[a-zA-Z0-9_]+`, case-insensitive) so behaviour is
// identical wherever the switch is made.
export function scrubErr(e: unknown, max = 160): string {
  return String((e as Error)?.message ?? e)
    .replace(/AIza[0-9A-Za-z_\-]{10,}/g, 'AIza_REDACTED')
    .replace(/gsk_[0-9A-Za-z_\-]{10,}/g, 'gsk_REDACTED')
    .replace(/tvly-[0-9A-Za-z_\-]{10,}/g, 'tvly-REDACTED')
    .replace(/sk_[a-zA-Z0-9_]+/gi, 'sk_REDACTED')
    .replace(/whsec_[a-zA-Z0-9_]+/gi, 'whsec_REDACTED')
    .replace(/key=[^&\s]+/gi, 'key=REDACTED')
    .slice(0, max)
}
