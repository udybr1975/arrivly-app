import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isDisposableEmail } from './_lib/disposable-domains.js'

// PUBLIC POST, no auth. Pre-flight for the free 48h demo signup: tells the UI whether
// an email can start a demo, should resume an existing unexpired demo, or belongs to a
// real account (→ login). Uses the service-role client SERVER-SIDE only (anon cannot
// read hosts.contact_email under RLS). Leaks nothing about account existence beyond the
// three stated reason codes. There is NO UI calling this yet — wired in a later stage.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Best-effort, per-instance IP rate limiter (same pattern as city-events / guest-chat).
const RL_MAX = 10
const RL_WINDOW_MS = 60_000
const RL_MAX_KEYS = 5000
const rlHits = new Map<string, { count: number; windowStart: number }>()
function rateLimited(key: string, now: number): boolean {
  if (rlHits.size > RL_MAX_KEYS) {
    for (const [k, v] of rlHits) {
      if (now - v.windowStart >= RL_WINDOW_MS) rlHits.delete(k)
    }
  }
  const entry = rlHits.get(key)
  if (!entry || now - entry.windowStart >= RL_WINDOW_MS) {
    rlHits.set(key, { count: 1, windowStart: now })
    return false
  }
  entry.count += 1
  return entry.count > RL_MAX
}
function clientIp(req: VercelRequest): string {
  const xff = req.headers['x-forwarded-for']
  const first = Array.isArray(xff) ? xff[0] : xff
  if (first) return first.split(',')[0].trim()
  return req.socket?.remoteAddress ?? 'unknown'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (rateLimited(clientIp(req), Date.now())) {
    return res.status(429).json({ error: 'rate_limited' })
  }

  const raw = (req.body ?? {}) as { email?: unknown }
  const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : ''
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'invalid_email' })
  }
  if (isDisposableEmail(email)) {
    return res.status(200).json({ ok: false, reason: 'disposable_email' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return res.status(500).json({ error: 'Service not configured' })
  const admin = createClient(supabaseUrl, serviceKey)

  // Case-insensitive exact match. Escape LIKE wildcards so a crafted email can't
  // broaden the match (ilike treats % and _ as wildcards).
  const escaped = email.replace(/[\\%_]/g, (m) => '\\' + m)

  let hosts: Array<{ is_demo: boolean | null; demo_expires_at: string | null }> = []
  try {
    const { data, error } = await admin
      .from('hosts')
      .select('is_demo, demo_expires_at')
      .ilike('contact_email', escaped)
      .limit(50)
    if (error) {
      console.error('[demo-precheck] lookup failed —', error.message?.slice(0, 120))
      return res.status(500).json({ error: 'Could not check email' })
    }
    hosts = data ?? []
  } catch {
    return res.status(500).json({ error: 'Could not check email' })
  }

  const now = Date.now()
  // A real (non-demo) account always wins → route to login. `is_demo !== true` (not
  // `=== false`) so a NULL is_demo counts as a real account, never a demo.
  if (hosts.some((h) => h.is_demo !== true)) {
    return res.status(200).json({ ok: false, reason: 'account_exists' })
  }
  // An unexpired demo → resume it.
  if (hosts.some((h) => h.is_demo === true && h.demo_expires_at && new Date(h.demo_expires_at).getTime() > now)) {
    return res.status(200).json({ ok: true, resume: true })
  }
  // No real account, no live demo (none, or only expired demos) → fresh start allowed.
  return res.status(200).json({ ok: true })
}
