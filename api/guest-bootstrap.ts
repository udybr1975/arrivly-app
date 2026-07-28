import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Service-role loader for the PUBLIC guest-page bootstrap. Moves the apartment,
// public apartment_details, host_picks and guide_recommendations reads off the client
// (which previously queried those four tables with the public anon key) onto the server,
// so those tables no longer need anon-readable RLS. Mirrors api/guest-state.ts's
// conventions exactly (UUID validation, service-role client, per-instance rate limiter,
// truncated secret-free logging).
//
// This endpoint returns ONLY non-sensitive, publicly-displayed data. It NEVER returns
// private apartment_details rows (is_private = true) — private check-in content stays
// exclusively on api/guest-details.ts behind its verified-tier gate. A missing OR hidden
// apartment yields an identical empty body, so the endpoint never distinguishes the two
// (GuestPage calls api/guest-availability separately to pick the unavailable vs neutral
// screen).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const svc = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const EMPTY = { apartment: null, details: [] as unknown[], picks: [] as unknown[], guide: null }

// --- Best-effort in-memory rate limiter (per-instance only; not shared across Lambdas) ---
const RL_MAX = 30
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

// --------------------------------------------------------------------------------

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
    // --- Apartment must exist AND be visible ---
    const { data: aptRow, error: aptErr } = await db
      .from('apartments')
      .select(
        'id, host_id, name, country, city, neighborhood, lat, lng, max_guests, ' +
          'accent_color, hero_image_url, city_image_url, city_image_credit, greeting_blurb, is_visible'
      )
      .eq('id', apt)
      .maybeSingle()
    if (aptErr) {
      console.error('[guest-bootstrap] apt query', aptErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'query_failed' })
    }
    // Identical empty body for missing vs hidden — never distinguish the two.
    if (!aptRow || aptRow.is_visible !== true) {
      return res.status(200).json(EMPTY)
    }

    // Strip is_visible from the response (internal gating field only).
    const apartment = { ...aptRow }
    delete (apartment as { is_visible?: unknown }).is_visible

    // --- Public sub-reads (never private rows). Run in parallel. ---
    const [detailsRes, picksRes, guideRes] = await Promise.all([
      db
        .from('apartment_details')
        .select('id, category, content, is_private')
        .eq('apartment_id', apt)
        .eq('is_private', false),
      db
        .from('host_picks')
        .select('id, name, category, address, lat, lng, note, display_order')
        .eq('apartment_id', apt)
        .order('display_order'),
      db
        .from('guide_recommendations')
        .select('categories')
        .eq('apartment_id', apt)
        .maybeSingle(),
    ])

    if (detailsRes.error) console.error('[guest-bootstrap] details query', detailsRes.error.message?.slice(0, 120))
    if (picksRes.error) console.error('[guest-bootstrap] picks query', picksRes.error.message?.slice(0, 120))
    if (guideRes.error) console.error('[guest-bootstrap] guide query', guideRes.error.message?.slice(0, 120))

    return res.status(200).json({
      apartment,
      details: detailsRes.data ?? [],
      picks: picksRes.data ?? [],
      guide: guideRes.data?.categories ?? null,
    })
  } catch (e) {
    console.error('[guest-bootstrap] unexpected', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
    return res.status(500).json({ error: 'internal_error' })
  }
}
