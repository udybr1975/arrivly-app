import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Guest-facing availability probe. GuestPage.tsx calls this ONLY when its anon read
// of the apartment returns nothing — which happens when a property is unpublished
// (RLS apartments_guest_read gates on is_visible) OR the apt id is unknown. For an
// existing-but-hidden apartment we return ONLY the public brand display fields
// (brand_name, logo_url, accent_color) so the page can render a branded
// "temporarily unavailable" screen. Nothing else (address, bookings, host email,
// details) is exposed. A live apartment or an unknown id reveals no brand.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const svc = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Best-effort, per-instance rate limiter (mirrors guest-state.ts).
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

  const apt = typeof req.query.apt === 'string' ? req.query.apt.trim() : ''
  if (!apt || !UUID_RE.test(apt)) return res.status(400).json({ error: 'bad_request' })

  const db = svc()
  try {
    const { data: apartment, error: aptErr } = await db
      .from('apartments')
      .select('id, is_visible, host_id, accent_color')
      .eq('id', apt)
      .maybeSingle()
    if (aptErr) {
      console.error('[guest-availability] apt query', aptErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'query_failed' })
    }

    // Unknown id, or a visible apartment → reveal no brand.
    if (!apartment) return res.status(200).json({ status: 'unknown' })
    if (apartment.is_visible === true) return res.status(200).json({ status: 'live' })

    // Hidden (unpublished): return ONLY public brand display fields.
    const { data: hostRow, error: hostErr } = await db
      .from('hosts')
      .select('brand_name, logo_url')
      .eq('id', apartment.host_id)
      .maybeSingle()
    if (hostErr) {
      console.error('[guest-availability] host query', hostErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'query_failed' })
    }

    return res.status(200).json({
      status: 'draft',
      brand: {
        brand_name: hostRow?.brand_name ?? null,
        logo_url: hostRow?.logo_url ?? null,
        accent_color: apartment.accent_color ?? null,
      },
    })
  } catch (e) {
    console.error('[guest-availability] unexpected', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
    return res.status(500).json({ error: 'internal_error' })
  }
}
