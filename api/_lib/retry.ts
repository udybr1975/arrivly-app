export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 2
  const baseDelayMs = opts.baseDelayMs ?? 600
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (attempt === retries || !isTransient(e)) throw e
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt))
    }
  }
  throw lastErr
}

function isTransient(e: any): boolean {
  const status = Number(e?.status ?? e?.code)
  if (status === 429 || (status >= 500 && status <= 599)) return true
  if (e?.name === 'AbortError') return true
  const msg = String(e?.message ?? '').toLowerCase()
  return /(429|5\d\d|unavailable|overloaded|internal error|timed? ?out|econnreset|etimedout|fetch failed|socket hang up|network)/.test(msg)
}
