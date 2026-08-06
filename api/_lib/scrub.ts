// Redacts anything that looks like a Google API key (AIza…), a Groq API key (gsk_…) or a
// key= URL param from an arbitrary error/value, then truncates. Use everywhere an error
// message derived from a Gemini/GenAI/Groq/geo call might be logged, so no key can ever
// reach a log. Redaction runs BEFORE the truncate so a key cannot survive as a fragment.
export function scrubErr(e: unknown, max = 160): string {
  return String((e as Error)?.message ?? e)
    .replace(/AIza[0-9A-Za-z_\-]{10,}/g, 'AIza_REDACTED')
    .replace(/gsk_[0-9A-Za-z_\-]{10,}/g, 'gsk_REDACTED')
    .replace(/key=[^&\s]+/gi, 'key=REDACTED')
    .slice(0, max)
}
