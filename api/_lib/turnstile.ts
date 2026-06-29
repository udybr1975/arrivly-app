// Cloudflare Turnstile server-side verification (the demo fresh-create "money gate").
//
// FAIL-CLOSED by design: returns false on a missing/empty token, an unset
// TURNSTILE_SECRET_KEY, a non-2xx response, a timeout, or any fetch/parse error —
// never throws. The SECRET and the TOKEN are never logged (the only thing logged is a
// short, generic error string from the fetch machinery, which carries neither — the
// secret/token live in the POST body, not in any thrown message or URL).

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const TIMEOUT_MS = 5000

export async function verifyTurnstile(
  token: string | undefined | null,
  ip?: string,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!token || !secret) return false

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const form = new URLSearchParams()
    form.set('secret', secret)
    form.set('response', token)
    if (ip) form.set('remoteip', ip)

    const resp = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: controller.signal,
    })
    if (!resp.ok) return false
    const data = (await resp.json()) as { success?: boolean }
    return data.success === true
  } catch (e) {
    // Generic, bounded message only — contains neither the secret nor the token.
    console.warn('[turnstile] verify failed —', String((e as Error)?.message ?? e).slice(0, 120))
    return false
  } finally {
    clearTimeout(timer)
  }
}
