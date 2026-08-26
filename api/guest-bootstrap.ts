import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveGuestAccess } from './_lib/guest-access.js'

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
//
// COORDINATES ARE GATED. Exact lat/lng reverse-geocode to the street address, so they
// are the same disclosure api/welcome.ts gates behind apartments.welcome_show_address.
// Returning them here for any visible apartment UUID would defeat that toggle in one
// hop. lat/lng are therefore included only when welcome_show_address is true, OR when
// resolveGuestAccess() rates the supplied token 'verified' for THIS apartment — the
// canonical gate: a confirmed/completed booking AND today inside the stay dates.
// Otherwise both fields are OMITTED — absent, not null, mirroring welcome.ts's
// omission style.
//
// ORACLE SCOPE, stated precisely: a WRONG token is indistinguishable from no token
// (same status, same body shape). A VALID one is distinguishable, because the
// coordinates appear — that is the feature, and it tells the holder nothing that
// api/guest-state.ts does not already tell them for the same token in the same
// window. Do NOT loosen the gate to status-only, which would extend that signal to
// future-dated and long-past tokens that guest-state deliberately flattens.
//
// This response varies by token, so it must NEVER gain an s-maxage/CDN cache header:
// a cached coordinate-bearing body could be served to a tokenless caller.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_RE = /^[A-Za-z0-9-]{4,32}$/   // identical to api/guest-state.ts

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

  // Optional token — the ONLY thing it can unlock here is lat/lng. Malformed input is
  // rejected exactly as api/guest-state.ts rejects it; a well-formed but unknown token
  // simply fails the booking lookup below and yields the coordinate-free body.
  const tokenProvided = req.query.token !== undefined
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : ''
  if (tokenProvided && !TOKEN_RE.test(token)) return res.status(400).json({ error: 'bad_request' })

  const db = svc()
  try {
    // --- Apartment must exist AND be visible ---
    const { data: aptRow, error: aptErr } = await db
      .from('apartments')
      .select(
        'id, host_id, name, country, city, neighborhood, lat, lng, max_guests, ' +
          'accent_color, hero_image_url, city_image_url, city_image_credit, greeting_blurb, ' +
          'is_visible, welcome_show_address, is_public_demo'
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

    // Coordinate gate — see the header note. The host's public-address toggle is the
    // first door; a verified booking token is the second. The booking lookup runs only
    // when it can change the outcome, so the public case costs no extra query.
    let coordsAllowed = aptRow.welcome_show_address === true
    if (!coordsAllowed && tokenProvided) {
      // Reuse the CANONICAL token gate rather than re-implementing it. A status-only
      // check is NOT equivalent: resolveGuestAccess also requires the stay to be in
      // dates, and both gates caught that divergence here. It matters most for the
      // pre-arrival case — api/_lib/welcome-claim.ts hands the ARR- token to whoever
      // holds the confirmation code, and api/welcome.ts refuses that same person the
      // address and the coordinates, so a future-dated token unlocking coords here
      // would reopen the bypass one hop later. A completed booking likewise stops
      // being a coordinate credential the day after checkout.
      const access = await resolveGuestAccess(db, apt, token)
      coordsAllowed = access.tier === 'verified'
    }

    // Strip the internal gating fields from the response (never returned to the client).
    const apartment = { ...aptRow }
    delete (apartment as { is_visible?: unknown }).is_visible
    delete (apartment as { welcome_show_address?: unknown }).welcome_show_address
    // is_public_demo is surfaced DELIBERATELY, as a top-level flag rather than an apartment
    // field, because it is a property of the PAGE (chrome, scripted chat, messaging off) and
    // not of the apartment record. It is not a secret: the demo apartment is linked from the
    // landing page and announces itself in its own banner. It stays OMITTED for every real
    // apartment rather than sent as false, so nothing here becomes an oracle for a flag that
    // only ever has one true row.
    delete (apartment as { is_public_demo?: unknown }).is_public_demo
    if (!coordsAllowed) {
      delete (apartment as { lat?: unknown }).lat
      delete (apartment as { lng?: unknown }).lng
    }

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
      ...(aptRow.is_public_demo === true ? { isPublicDemo: true } : {}),
    })
  } catch (e) {
    console.error('[guest-bootstrap] unexpected', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
    return res.status(500).json({ error: 'internal_error' })
  }
}
