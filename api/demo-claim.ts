import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Host-auth endpoint: marks an ELIGIBLE fresh trial host as a demo signup by setting
// user_metadata.is_demo=true, so the subsequent /demo-create money-gate (which REQUIRES
// that metadata) can run. signInWithOAuth cannot set that metadata, so the Google demo
// path lands authenticated and calls this endpoint before the existing Choose → create
// step. DENY-BY-DEFAULT: only a host on a fresh, empty trial (no sub, 0 apartments) is
// ever touched, and demo-create independently re-checks EVERY condition — this is a
// second gate, not a bypass. Spends nothing (no AI, no Stripe), so no captcha needed.
// The demo-only host columns are still written ONLY by demo-create's service-role path.

const MAX_FIELD = 120

function scrub(e: unknown): string {
  return String((e as Error)?.message ?? e)
    .replace(/AIza[0-9A-Za-z_\-]{10,}/g, 'AIza_REDACTED')
    .replace(/key=[^&\s]+/gi, 'key=REDACTED')
    .slice(0, 120)
}

// Best-effort, per-instance IP+user rate limiter (same pattern/params as demo-create).
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

  const body = (req.body ?? {}) as { firstName?: unknown }
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim().slice(0, MAX_FIELD) : ''

  // Service-role client only AFTER auth. Never returned to the client.
  const admin = createClient(supabaseUrl, serviceKey)

  try {
    const { data: host, error: hostErr } = await admin
      .from('hosts')
      .select('is_demo, demo_expires_at, subscription_status, stripe_subscription_id, name')
      .eq('id', userId)
      .maybeSingle()
    if (hostErr || !host) {
      console.error('[demo-claim] host load failed —', hostErr?.message?.slice(0, 120))
      return res.status(500).json({ error: 'Could not start demo' })
    }

    // Already a demo host: an UNEXPIRED demo is an idempotent success (the caller proceeds
    // to Choose/create, where demo-create resumes it). An EXPIRED demo cannot start a new
    // one — return not_eligible so the caller routes to /dashboard (the expiry wall), rather
    // than advancing to Choose where demo-create would reject it as a confusing dead-end.
    if (host.is_demo === true) {
      const unexpired = !!host.demo_expires_at && new Date(host.demo_expires_at).getTime() > Date.now()
      if (unexpired) return res.status(200).json({ ok: true, already: true })
      return res.status(200).json({ ok: false, reason: 'not_eligible' })
    }

    // ELIGIBILITY (deny-by-default). This endpoint SETS the is_demo metadata, so it does
    // NOT require it here — but demo-create still re-checks every one of these plus the
    // metadata + captcha, so this is an independent gate, never a bypass. `is_demo !== true`
    // treats a NULL row value as non-demo.
    const { count: aptCount } = await admin
      .from('apartments')
      .select('id', { count: 'exact', head: true })
      .eq('host_id', userId)
    const eligible =
      host.is_demo !== true &&
      host.subscription_status === 'trial' &&
      !host.stripe_subscription_id &&
      (aptCount ?? 0) === 0
    if (!eligible) return res.status(200).json({ ok: false, reason: 'not_eligible' })

    // Mark the user as a demo signup, PRESERVING existing metadata (first_name/name/etc.).
    const existingMeta = (authData.user.user_metadata ?? {}) as Record<string, unknown>
    const { error: metaErr } = await admin.auth.admin.updateUserById(userId, {
      user_metadata: { ...existingMeta, is_demo: true },
    })
    if (metaErr) {
      console.error('[demo-claim] metadata update failed —', metaErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Could not start demo' })
    }

    // Best-effort name backfill (non-fatal, own-row): only when the host has no name yet.
    if (firstName && !((host.name as string | null)?.trim())) {
      try {
        // Supabase resolves { error } rather than throwing, so surface it explicitly;
        // the try/catch is a belt-and-braces guard for an unexpected throw.
        const { error: nameErr } = await admin.from('hosts').update({ name: firstName }).eq('id', userId)
        if (nameErr) console.warn('[demo-claim] name backfill failed (non-fatal) —', nameErr.message?.slice(0, 120))
      } catch (e) {
        console.warn('[demo-claim] name backfill failed (non-fatal) —', scrub(e))
      }
    }

    return res.status(200).json({ ok: true })
  } catch (e) {
    console.error('[demo-claim] failed —', scrub(e))
    return res.status(500).json({ error: 'Could not start demo' })
  }
}
