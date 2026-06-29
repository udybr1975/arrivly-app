import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Host-auth endpoint: converts the caller's own DEMO host into a normal 14-day trial
// host ("keep it"). The password is set client-side via Supabase auth — this endpoint
// never sees it. IDEMPOTENT: a non-demo caller is already a normal account and is left
// untouched (never re-trialed). The demo-only / billing columns it clears
// (is_demo / demo_expires_at / subscription_status / trial_ends_at / property_cap_override)
// are written ONLY via the service-role client. There is NO Stripe here.

const DEFAULT_TRIAL_DAYS = 14

function scrub(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/key=[^&\s]+/gi, 'key=REDACTED').slice(0, 120)
}

// Best-effort, per-instance IP rate limiter (same pattern as demo-create / city-events).
const RL_MAX = 5
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

  // AUTH: host-only (anon getUser), exactly like demo-create.
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL!
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return res.status(500).json({ error: 'Demo service not configured' })

  const authClient = createClient(supabaseUrl, anonKey)
  const { data: authData, error: authError } = await authClient.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })
  const userId = authData.user.id

  if (rateLimited(`${userId}:${clientIp(req)}`, Date.now())) {
    return res.status(429).json({ error: 'rate_limited' })
  }

  // Service-role client only AFTER auth. Never returned to the client.
  const admin = createClient(supabaseUrl, serviceKey)

  try {
    const { data: host, error: hostErr } = await admin
      .from('hosts')
      .select('is_demo')
      .eq('id', userId)
      .maybeSingle()
    if (hostErr || !host) {
      console.error('[demo-convert] host load failed —', scrub(hostErr))
      return res.status(500).json({ error: 'Could not convert' })
    }

    // IDEMPOTENT: a non-demo caller is already a normal account — never re-trial them.
    if (host.is_demo !== true) return res.status(200).json({ ok: true, already: true })

    const { data: settings } = await admin
      .from('app_settings')
      .select('trial_days')
      .eq('id', 1)
      .maybeSingle()
    const trialDays = Number.isFinite(settings?.trial_days) ? Number(settings!.trial_days) : DEFAULT_TRIAL_DAYS
    const trialEndsIso = new Date(Date.now() + trialDays * 86_400_000).toISOString()

    // Flip demo → normal trial via service-role ONLY. tier stays as-is (1).
    const { error: updErr } = await admin
      .from('hosts')
      .update({
        is_demo: false,
        demo_expires_at: null,
        subscription_status: 'trial',
        trial_ends_at: trialEndsIso,
        property_cap_override: null, // inherit the tier-1 plan cap
      })
      .eq('id', userId)
    if (updErr) {
      console.error('[demo-convert] update failed —', scrub(updErr))
      return res.status(500).json({ error: 'Could not convert' })
    }

    // Re-publish the demo apartment(s) — a host converting AFTER expiry had them hidden
    // by the expiry cron. Idempotent (no-op if already visible). Best-effort: the flip
    // above is the source of truth, so a republish hiccup must not fail the conversion.
    const { error: visErr } = await admin
      .from('apartments')
      .update({ is_visible: true })
      .eq('host_id', userId)
    if (visErr) console.error('[demo-convert] republish failed —', scrub(visErr))

    return res.status(200).json({ ok: true })
  } catch (e) {
    console.error('[demo-convert] failed —', scrub(e))
    return res.status(500).json({ error: 'Could not convert' })
  }
}
