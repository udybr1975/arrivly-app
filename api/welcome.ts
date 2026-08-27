import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Service-role loader for the PUBLIC per-apartment welcome page (/w/:code). Resolves an
// apartment by its short public welcome_code and returns ONLY publicly-displayable data.
// Modelled on api/guest-bootstrap.ts (svc() client, per-instance rate limiter, truncated
// secret-free logging). NEVER returns private apartment_details rows (WiFi / check-in
// content became private in 27b881b and stay behind api/guest-details.ts), never returns
// welcome_code / is_visible / welcome_show_address, and never leaks any billing state beyond
// the one bit `showFooter` has always carried. A missing OR hidden apartment yields an
// identical 'unavailable' body — no oracle.
//
// HOST_ID IS NOT RETURNED AS A FIELD BUT IS DERIVABLE FROM AN IMAGE PATH, and that is
// accepted rather than overlooked: `hero_image_url` is `{hostId}/{aptId}/hero-{ts}.jpg` and
// `brand.logo_url` is `{hostId}/logo-{ts}.jpg` (api/create-upload-url.ts). The logo already
// shipped that way on every state, so the cover photo adds nothing new — the bucket is
// public-read and no authority attaches to the UUID itself.

const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/

const svc = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const UNAVAILABLE = { state: 'unavailable' as const, brand: null }

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
  // This response varies by a per-guest credential (the welcome code), so it must never
  // be stored by a CDN, a proxy or the browser. Set BEFORE the method guard so every
  // path carries it — there are multiple return sites in this file and a future one
  // added below would otherwise ship uncovered.
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const now = Date.now()
  if (rateLimited(clientIp(req), now)) {
    return res.status(429).json({ error: 'rate_limited' })
  }

  const code = typeof req.query.code === 'string' ? req.query.code.trim() : ''
  if (!code || !CODE_RE.test(code)) return res.status(400).json({ error: 'bad_request' })

  const db = svc()
  try {
    const { data: aptRow, error: aptErr } = await db
      .from('apartments')
      .select(
        'id, host_id, name, city, country, neighborhood, lat, lng, ' +
          'street, street_number, welcome_note, welcome_show_address, is_visible, ' +
          'hero_image_url, city_image_url, city_image_credit'
      )
      .eq('welcome_code', code)
      .maybeSingle()
    if (aptErr) {
      console.error('[welcome] apt query', aptErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'query_failed' })
    }

    // A. No match OR hidden — identical body for both (no existence oracle).
    if (!aptRow || aptRow.is_visible !== true) {
      return res.status(200).json(UNAVAILABLE)
    }

    // Brand + billing state (billing state is used ONLY to branch; never returned).
    const { data: hostRow, error: hostErr } = await db
      .from('hosts')
      .select('brand_name, logo_url, whatsapp, accent_color, subscription_status')
      .eq('id', aptRow.host_id)
      .maybeSingle()
    if (hostErr) {
      console.error('[welcome] host query', hostErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'query_failed' })
    }
    if (!hostRow) {
      // Apartment with no host row is a broken state — treat as unavailable, no oracle.
      return res.status(200).json(UNAVAILABLE)
    }

    const brand = {
      brand_name: hostRow.brand_name ?? null,
      logo_url: hostRow.logo_url ?? null,
      whatsapp: hostRow.whatsapp ?? null,
      accent_color: hostRow.accent_color ?? null,
    }

    // B. Expired — brand only. NOTHING else. Never expose subscription_status.
    if (hostRow.subscription_status === 'expired') {
      return res.status(200).json({ state: 'expired', brand })
    }

    // C. Live (trial / active / grace).
    const showAddress = aptRow.welcome_show_address === true
    const apartment: Record<string, unknown> = {
      id: aptRow.id,
      name: aptRow.name,
      city: aptRow.city,
      country: aptRow.country,
      neighborhood: aptRow.neighborhood,
      welcome_note: aptRow.welcome_note ?? null,
      // Cover photo + its Unsplash attribution. DELIBERATELY NOT GATED BY
      // welcome_show_address: that flag protects the STREET and the COORDINATES, and a
      // cover photo is neither. Do not couple them — a host who hides their address still
      // wants their property to look like a place someone would want to stay in.
      hero_image_url: aptRow.hero_image_url ?? null,
      city_image_url: aptRow.city_image_url ?? null,
      city_image_credit: aptRow.city_image_credit ?? null,
    }
    // Address ONLY when the host opted in — omitted entirely otherwise. lat/lng are gated
    // by the SAME flag: exact coordinates reverse-geocode to the address, so hiding the
    // street while shipping coords would defeat the toggle.
    if (showAddress) {
      apartment.street = aptRow.street
      apartment.street_number = aptRow.street_number
      apartment.lat = aptRow.lat
      apartment.lng = aptRow.lng
    }

    const [detailsRes, picksRes, guideRes] = await Promise.all([
      db
        .from('apartment_details')
        .select('id, category, content')
        .eq('apartment_id', aptRow.id)
        .eq('is_private', false),
      db
        .from('host_picks')
        .select('id, name, category, address, lat, lng, note, display_order')
        .eq('apartment_id', aptRow.id)
        .order('display_order'),
      db
        .from('guide_recommendations')
        .select('categories')
        .eq('apartment_id', aptRow.id)
        .maybeSingle(),
    ])

    if (detailsRes.error) console.error('[welcome] details query', detailsRes.error.message?.slice(0, 120))
    if (picksRes.error) console.error('[welcome] picks query', picksRes.error.message?.slice(0, 120))
    if (guideRes.error) console.error('[welcome] guide query', guideRes.error.message?.slice(0, 120))

    // View counter — best-effort, non-blocking: a failure must NEVER fail the request.
    // Count only (no IP / UA / referrer / any visitor identifier is ever stored).
    try {
      const day = new Date().toISOString().slice(0, 10) // UTC today
      const { data: existing } = await db
        .from('welcome_views')
        .select('views')
        .eq('apartment_id', aptRow.id)
        .eq('day', day)
        .maybeSingle()
      const next = (typeof existing?.views === 'number' ? existing.views : 0) + 1
      await db
        .from('welcome_views')
        .upsert({ apartment_id: aptRow.id, day, views: next }, { onConflict: 'apartment_id,day' })
    } catch (e) {
      console.error('[welcome] view counter', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
    }

    return res.status(200).json({
      state: 'live',
      brand,
      apartment,
      details: detailsRes.data ?? [],
      picks: picksRes.data ?? [],
      guide: guideRes.data?.categories ?? null,
      showFooter: hostRow.subscription_status === 'trial',
    })
  } catch (e) {
    console.error('[welcome] unexpected', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
    return res.status(500).json({ error: 'internal_error' })
  }
}
