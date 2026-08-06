// Redacts anything that looks like a Google API key (AIza…), a Groq API key (gsk_…), a Tavily
// API key (tvly-…) or a key= URL param from an arbitrary error/value, then truncates. Use
// everywhere an error message derived from a Gemini/GenAI/Groq/Tavily/geo call might be logged,
// so no key can ever reach a log. Redaction runs BEFORE the truncate so a key cannot survive as
// a fragment. NOTE the `key=` rule is case-insensitive and unanchored, which is what also covers
// Geoapify's `apiKey=` URL param; Tavily's key travels in an Authorization header, so it needed
// its own prefix rule rather than being caught by that one.
export function scrubErr(e: unknown, max = 160): string {
  return String((e as Error)?.message ?? e)
    .replace(/AIza[0-9A-Za-z_\-]{10,}/g, 'AIza_REDACTED')
    .replace(/gsk_[0-9A-Za-z_\-]{10,}/g, 'gsk_REDACTED')
    .replace(/tvly-[0-9A-Za-z_\-]{10,}/g, 'tvly-REDACTED')
    .replace(/key=[^&\s]+/gi, 'key=REDACTED')
    .slice(0, max)
}
