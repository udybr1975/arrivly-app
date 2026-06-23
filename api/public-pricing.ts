import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Public, logged-out marketing endpoint for the landing page. The landing is anon,
// and anon cannot read `plans` (authenticated-only RLS) or `app_settings` (no read
// policy), so we expose ONLY two marketing-safe values via the service-role key:
// the trial length and the lowest plan's monthly price. NOTHING else is ever
// returned — no host data, no table dumps. Fails soft (200 + safe defaults) on any
// error so the landing always renders. Edge-cached (s-maxage) as the primary load
// protection; the per-instance limiter is a lightweight backstop.

const SAFE_DEFAULTS = { trialDays: 14, fromPriceEuros: 10, currency: 'eur' as const }

// Best-effort, per-instance rate limiter (mirrors guest-availability.ts).
const RL_MAX = 60
const RL_WINDOW_MS = 60_000
const rlHits = new Map<string, { count: number; windowStart: number }>()
function rateLimited(ip: string, now: number): boolean {
  const entry = rlHits.get(ip)
  if (!entry || now - entry.windowStart >= RL_WINDOW_MS) {
    rlHits.set(ip, { count: 1, windowStart: now })
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
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const now = Date.now()
  if (rateLimited(clientIp(req), now)) {
    return res.status(429).json({ error: 'rate_limited' })
  }

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  // Missing config → fail soft with safe defaults, never a 500 that breaks the landing.
  if (!supabaseUrl || !serviceKey) {
    return res.status(200).json(SAFE_DEFAULTS)
  }

  try {
    const db = createClient(supabaseUrl, serviceKey)

    const [settingsRes, planRes] = await Promise.all([
      db.from('app_settings').select('trial_days').eq('id', 1).maybeSingle(),
      db.from('plans').select('price_cents').order('price_cents', { ascending: true }).limit(1).maybeSingle(),
    ])

    if (settingsRes.error) {
      console.error('[public-pricing] settings query', settingsRes.error.message?.slice(0, 120))
      return res.status(200).json(SAFE_DEFAULTS)
    }
    if (planRes.error) {
      console.error('[public-pricing] plan query', planRes.error.message?.slice(0, 120))
      return res.status(200).json(SAFE_DEFAULTS)
    }

    const trialDaysRaw = settingsRes.data?.trial_days
    const priceCentsRaw = planRes.data?.price_cents

    const trialDays = Number.isFinite(trialDaysRaw) ? Number(trialDaysRaw) : SAFE_DEFAULTS.trialDays
    const fromPriceEuros = Number.isFinite(priceCentsRaw)
      ? Math.round(Number(priceCentsRaw) / 100)
      : SAFE_DEFAULTS.fromPriceEuros

    return res.status(200).json({ trialDays, fromPriceEuros, currency: 'eur' })
  } catch (e) {
    console.error('[public-pricing] unexpected', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
    return res.status(200).json(SAFE_DEFAULTS)
  }
}
