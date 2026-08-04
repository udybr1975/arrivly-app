// Redacts anything that looks like a Google API key or a key= URL param from an
// arbitrary error/value, then truncates. Use everywhere an error message derived
// from a Gemini/GenAI/geo call might be logged, so no key can ever reach a log.
export function scrubErr(e: unknown, max = 160): string {
  return String((e as Error)?.message ?? e)
    .replace(/AIza[0-9A-Za-z_\-]{10,}/g, 'AIza_REDACTED')
    .replace(/key=[^&\s]+/gi, 'key=REDACTED')
    .slice(0, max)
}
