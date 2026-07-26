import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Public, logged-out marketing endpoint for the landing page. The landing is anon,
// and anon cannot read `plans` (authenticated-only RLS) or `app_settings` (no read
// policy), so we expose ONLY marketing-safe DISPLAY values via the service-role key:
// the trial length, the lowest plan's monthly price, and the four tier rows (tier,
// price in euros, property cap, whether booking is included). NOTHING else is ever
// returned — no host data, no other columns, no table dumps. Fails soft (200 + safe
// defaults) on any error so the landing always renders. Edge-cached (s-maxage) as the
// primary load protection; the per-instance limiter is a lightweight backstop.

const SAFE_DEFAULTS = { trialDays: 14, fromPriceEuros: 10, currency: 'eur' as const }

type PublicPlan = { tier: number; priceEuros: number; maxProperties: number | null; includesBooking: boolean }

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

    const [settingsRes, plansRes] = await Promise.all([
      db.from('app_settings').select('trial_days').eq('id', 1).maybeSingle(),
      // ONLY the four non-secret display columns, all rows, ordered by tier.
      db.from('plans').select('tier, price_cents, max_properties, includes_booking').order('tier', { ascending: true }),
    ])

    if (settingsRes.error) {
      console.error('[public-pricing] settings query', settingsRes.error.message?.slice(0, 120))
      return res.status(200).json(SAFE_DEFAULTS)
    }
    if (plansRes.error) {
      console.error('[public-pricing] plans query', plansRes.error.message?.slice(0, 120))
      return res.status(200).json(SAFE_DEFAULTS)
    }

    const trialDaysRaw = settingsRes.data?.trial_days
    const trialDays = Number.isFinite(trialDaysRaw) ? Number(trialDaysRaw) : SAFE_DEFAULTS.trialDays

    // Build the public plans array (display values only) and derive fromPriceEuros as the
    // lowest tier price — preserving the field's original "starts from" semantics.
    const plans: PublicPlan[] = []
    for (const row of (plansRes.data ?? []) as Array<{ tier: unknown; price_cents: unknown; max_properties: unknown; includes_booking: unknown }>) {
      const tier = Number(row.tier)
      const priceCents = Number(row.price_cents)
      if (!Number.isFinite(tier) || !Number.isFinite(priceCents)) continue
      const maxRaw = row.max_properties
      plans.push({
        tier,
        priceEuros: Math.round(priceCents / 100),
        maxProperties: Number.isFinite(Number(maxRaw)) && maxRaw !== null ? Number(maxRaw) : null,
        includesBooking: row.includes_booking === true,
      })
    }

    const fromPriceEuros = plans.length
      ? Math.min(...plans.map(p => p.priceEuros))
      : SAFE_DEFAULTS.fromPriceEuros

    return res.status(200).json({ trialDays, fromPriceEuros, currency: 'eur', plans })
  } catch (e) {
    console.error('[public-pricing] unexpected', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
    return res.status(200).json(SAFE_DEFAULTS)
  }
}
