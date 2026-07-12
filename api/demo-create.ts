import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { geocodeAddress } from './_lib/geo.js'
import { generateGuideForApartment } from './_lib/guide.js'
import { generateCityEvents } from './_lib/city-events.js'
import { verifyTurnstile } from './_lib/turnstile.js'
import { fetchCityImage } from './_lib/city-image.js'

// Host-auth endpoint: turns a fresh trial host into a free 48h DEMO and seeds a
// ready-to-explore guest page (one apartment + one active "Alex" booking, optionally
// guide/events/picks). DENY-BY-DEFAULT — only an eligible fresh trial host (or an
// existing unexpired demo, idempotently resumed) is ever touched. The demo-only host
// columns (is_demo / demo_expires_at / property_cap_override / tier / trial_ends_at)
// are written ONLY via the service-role client. No Stripe, no card. There is NO UI
// calling this yet — wired in a later flagged stage.

const DEFAULT_DEMO_HOURS = 48
const MAX_FIELD = 120

// Static, city-agnostic showcase content — identical for every demo (NOT AI-generated),
// seeded on BOTH the Quick and Full paths so the guest page + editor are fully populated.
const HOUSE_RULES = `Make yourself completely at home — this is your space for the stay. A few gentle requests so the next guests arrive to the same warm welcome you did:
- Check-out is by 11:00. If you need a little longer, just message and we'll do our best.
- Quiet hours are 22:00–08:00. Please keep things calm for the neighbours late at night.
- No smoking anywhere indoors — you're very welcome to smoke on the balcony or outside.
- No parties or events, please. Small gatherings are fine; loud ones aren't.
- Please switch off the A/C and lights when you head out, and don't move large furniture.
- Rubbish and recycling go in the bins by the entrance — bags are under the kitchen sink.
Thank you for treating the home with care. Anything you need, we're a message away.`

const ENTRY_INSTRUCTIONS = `The building entrance is at the address on your booking. Take the lift to the 3rd floor — the apartment is door 3B on your right. The apartment key is in the small lockbox beside the door (code 7310); please return it there on departure. If anything doesn't work on arrival, message your host right here and we'll sort it immediately.`

// Same alphabet/shape as create-booking's randomRef (Crockford-ish, no ambiguous chars).
function randomRef(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let r = 'ARR-'
  for (let i = 0; i < 6; i++) r += chars[Math.floor(Math.random() * chars.length)]
  return r
}

function scrub(e: unknown): string {
  return String((e as Error)?.message ?? e)
    .replace(/AIza[0-9A-Za-z_\-]{10,}/g, 'AIza_REDACTED')
    .replace(/key=[^&\s]+/gi, 'key=REDACTED')
    .slice(0, 120)
}

// Best-effort, per-instance IP rate limiter (same pattern as city-events / guest-chat).
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

// UTC date helpers — booking dates must be device-LOCAL-independent (stored/compared as date).
function utcDateStr(offsetDays: number): string {
  const t = new Date()
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + offsetDays))
    .toISOString()
    .slice(0, 10)
}

async function createDemoApartment(
  admin: SupabaseClient,
  userId: string,
  city: string,
  neighbourhood: string,
  street = '',
  streetNumber = '',
): Promise<string> {
  // Best-effort geocode — the apartment is created either way. With a street, geocode
  // door-level; otherwise keep the neighbourhood-centroid lookup (unchanged).
  const hasStreet = street.length > 0
  const query = hasStreet
    ? `${street} ${streetNumber}, ${neighbourhood}, ${city}`.replace(/\s+/g, ' ').trim()
    : `${neighbourhood}, ${city}`
  const coords = await geocodeAddress(query)
  const { data, error } = await admin
    .from('apartments')
    .insert({
      host_id: userId,
      name: `Your ${neighbourhood} apartment`,
      // Country derived from the geocoder (Basics tab marks it required); null on a miss.
      country: coords?.country ?? null,
      city,
      neighborhood: neighbourhood,
      street: hasStreet ? street : null,
      street_number: hasStreet && streetNumber ? streetNumber : null,
      max_guests: 2,
      is_visible: true,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      // accent_color omitted → NULL → inherits the account default.
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`apartment insert failed — ${error?.message?.slice(0, 120) ?? 'unknown'}`)
  return data.id as string
}

// Static showcase apartment_details — the EXACT category strings/formats the dashboard
// editor (PropertySetup) reads, so they appear in the WiFi / House rules / Check-in tabs
// AND on the guest page. Best-effort; the caller wraps this in one try/catch.
async function seedShowcaseDetails(admin: SupabaseClient, apartmentId: string): Promise<void> {
  const { error } = await admin.from('apartment_details').insert([
    { apartment_id: apartmentId, category: 'WiFi', is_private: false, content: 'Network: BemguStay\nPassword: WelcomeHome2026' },
    { apartment_id: apartmentId, category: 'House Rules', is_private: false, content: HOUSE_RULES },
    { apartment_id: apartmentId, category: 'Check-in', is_private: true, content: 'Check-in from: 15:00' },
    { apartment_id: apartmentId, category: 'Check-in', is_private: true, content: 'Check-out by: 11:00' },
    { apartment_id: apartmentId, category: 'Check-in', is_private: true, content: 'Door code: 2049#' },
    { apartment_id: apartmentId, category: 'Check-in', is_private: true, content: ENTRY_INSTRUCTIONS },
  ])
  if (error) throw new Error(`details insert failed — ${error.message?.slice(0, 120)}`)
}

// Seed one active sample booking (guest "Alex", spanning a 48h demo). Fresh guest row
// per booking (mirrors create-booking). Returns the ARR- token.
async function seedActiveBooking(admin: SupabaseClient, apartmentId: string): Promise<string> {
  const checkIn = utcDateStr(-1)
  const checkOut = utcDateStr(3)
  const { data: guest, error: guestErr } = await admin
    .from('guests')
    .insert({ first_name: 'Alex', last_name: '', email: '' })
    .select('id')
    .single()
  if (guestErr || !guest) throw new Error(`guest insert failed — ${guestErr?.message?.slice(0, 120) ?? 'unknown'}`)

  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = randomRef()
    const { error: bookErr } = await admin.from('bookings').insert({
      apartment_id: apartmentId,
      guest_id: guest.id,
      check_in: checkIn,
      check_out: checkOut,
      status: 'confirmed',
      reference_number: ref,
      source: 'manual',
    })
    if (!bookErr) return ref
    if (bookErr.code !== '23505') throw new Error(`booking insert failed — ${bookErr.message?.slice(0, 120)}`)
    // 23505 unique violation on reference_number — retry with a new ref.
  }
  throw new Error('exhausted reference retries')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // AUTH: host-only (anon getUser), exactly like create-booking.
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

  const body = (req.body ?? {}) as {
    city?: unknown; neighbourhood?: unknown; path?: unknown; turnstileToken?: unknown
    street?: unknown; streetNumber?: unknown
  }
  const city = typeof body.city === 'string' ? body.city.trim() : ''
  const neighbourhood = typeof body.neighbourhood === 'string' ? body.neighbourhood.trim() : ''
  const path = body.path === 'quick' || body.path === 'full' ? body.path : ''
  const turnstileToken = typeof body.turnstileToken === 'string' ? body.turnstileToken : ''
  // OPTIONAL door-level address (CREATE branch only). Absence is valid → centroid geocode.
  const street = typeof body.street === 'string' ? body.street.trim() : ''
  const streetNumber = typeof body.streetNumber === 'string' ? body.streetNumber.trim() : ''
  // NOTE: city/neighbourhood/path + the captcha token are used inside the CREATE branch
  // only — the idempotent RESUME path is called with an empty body `{}` and never needs
  // them (resume does no AI spend, so it is captcha-exempt).

  // Service-role client only AFTER auth. Never returned to the client.
  const admin = createClient(supabaseUrl, serviceKey)

  const { data: host, error: hostErr } = await admin
    .from('hosts')
    .select('is_demo, demo_expires_at, subscription_status, stripe_subscription_id')
    .eq('id', userId)
    .maybeSingle()
  if (hostErr || !host) {
    console.error('[demo-create] host load failed —', hostErr?.message?.slice(0, 120))
    return res.status(500).json({ error: 'Could not start demo' })
  }

  const now = Date.now()
  const isUnexpiredDemo =
    host.is_demo === true && !!host.demo_expires_at && new Date(host.demo_expires_at).getTime() > now

  try {
    // ── IDEMPOTENT RESUME ─────────────────────────────────────────────────────
    if (isUnexpiredDemo) {
      const { data: apts } = await admin
        .from('apartments')
        .select('id')
        .eq('host_id', userId)
        .order('created_at', { ascending: true })
        .limit(1)
      let apartmentId = apts?.[0]?.id as string | undefined
      if (!apartmentId) apartmentId = await createDemoApartment(admin, userId, city, neighbourhood)

      // Reuse an existing active confirmed manual booking; only seed if none.
      const today = utcDateStr(0)
      const { data: existing } = await admin
        .from('bookings')
        .select('reference_number')
        .eq('apartment_id', apartmentId)
        .eq('status', 'confirmed')
        .eq('source', 'manual')
        .gte('check_out', today)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const tok = existing?.reference_number ?? (await seedActiveBooking(admin, apartmentId))
      return res.status(200).json({ ok: true, resumed: true, apartmentId, token: tok })
    }

    // ── CREATE-only input validation (resume above never reaches here) ────────
    if (!city || city.length > MAX_FIELD) return res.status(400).json({ error: 'Invalid input' })
    if (!neighbourhood || neighbourhood.length > MAX_FIELD) return res.status(400).json({ error: 'Invalid input' })
    if (!path) return res.status(400).json({ error: 'Invalid input' })
    // Street / street number are OPTIONAL; only their length is bounded when present.
    if (street.length > MAX_FIELD || streetNumber.length > MAX_FIELD) return res.status(400).json({ error: 'Invalid input' })

    // ── CAPTCHA (the money gate) — verify BEFORE the eligibility check, any host
    // mutation, apartment creation, or AI spend. Fail-closed (false on missing token /
    // unset secret / network error). Resume above is intentionally exempt.
    const captchaOk = await verifyTurnstile(turnstileToken, clientIp(req))
    if (!captchaOk) return res.status(403).json({ ok: false, reason: 'captcha_failed' })

    // ── ELIGIBILITY TO CREATE (deny-by-default) ───────────────────────────────
    const { count: aptCount } = await admin
      .from('apartments')
      .select('id', { count: 'exact', head: true })
      .eq('host_id', userId)
    // The user must ALSO be marked as a demo signup in their auth metadata. Only the
    // /demo OTP flow sets user_metadata.is_demo=true; a normal trial signup never does,
    // so a regular new host (same row-state: trial / no sub / 0 apartments) can NEVER be
    // demo-ified here. `is_demo !== true` (not `=== false`) treats a NULL row value as
    // non-demo even if a host row wasn't backfilled to the column default.
    const isDemoMeta = authData.user.user_metadata?.is_demo === true
    const eligible =
      isDemoMeta &&
      host.is_demo !== true &&
      host.subscription_status === 'trial' &&
      !host.stripe_subscription_id &&
      (aptCount ?? 0) === 0
    if (!eligible) return res.status(200).json({ ok: false, reason: 'not_eligible' })

    // ── CREATE ────────────────────────────────────────────────────────────────
    const { data: settings } = await admin
      .from('app_settings')
      .select('demo_hours')
      .eq('id', 1)
      .maybeSingle()
    const demoHours = Number.isFinite(settings?.demo_hours) ? Number(settings!.demo_hours) : DEFAULT_DEMO_HOURS
    const expiresIso = new Date(now + demoHours * 3600 * 1000).toISOString()

    // Flip host to demo BEFORE inserting the apartment, so property_cap_override=1 is in
    // force for the enforce_property_cap trigger. subscription_status stays 'trial'.
    const { error: updErr } = await admin
      .from('hosts')
      .update({
        is_demo: true,
        demo_expires_at: expiresIso,
        property_cap_override: 1,
        tier: 1,
        trial_ends_at: expiresIso,
      })
      .eq('id', userId)
    if (updErr) {
      console.error('[demo-create] host demo flip failed —', updErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Could not start demo' })
    }

    const apartmentId = await createDemoApartment(admin, userId, city, neighbourhood, street, streetNumber)
    const tok = await seedActiveBooking(admin, apartmentId)

    // Static showcase details (WiFi / House rules / Check-in) — same for every demo on
    // BOTH paths, NOT AI-generated. Best-effort (one try/catch, non-fatal).
    try {
      await seedShowcaseDetails(admin, apartmentId)
    } catch (e) {
      console.warn('[demo-create] details seed failed (non-fatal) —', scrub(e))
    }

    // City hero image (BOTH paths) via the shared Unsplash-by-city logic. Best-effort:
    // the guest page already renders the credit when city_image_url is used.
    try {
      const ci = await fetchCityImage(city)
      if (ci) {
        await admin
          .from('apartments')
          .update({ city_image_url: ci.imageUrl, city_image_credit: ci.credit })
          .eq('id', apartmentId)
          .eq('host_id', userId)
      }
    } catch (e) {
      console.warn('[demo-create] city image seed failed (non-fatal) —', scrub(e))
    }

    // QUICK path: best-effort AI seeding. Each step is isolated — a generation failure
    // must NEVER fail demo creation (the demo works without them). FULL path skips all AI.
    if (path === 'quick') {
      try {
        await generateGuideForApartment(admin, {
          id: apartmentId,
          neighborhood: neighbourhood,
          city,
          country: null,
        })
      } catch (e) {
        console.warn('[demo-create] guide seed failed (non-fatal) —', scrub(e))
      }

      // Up to 2 host picks derived from the just-generated guide (reuses that generation
      // output; real, geocoded places — no separate Gemini call, no invented places).
      try {
        const { data: guideRow } = await admin
          .from('guide_recommendations')
          .select('categories')
          .eq('apartment_id', apartmentId)
          .maybeSingle()
        const cats = (guideRow?.categories ?? null) as Record<string, Array<Record<string, unknown>>> | null
        if (cats) {
          const rows: Array<Record<string, unknown>> = []
          for (const key of Object.keys(cats)) {
            const list = Array.isArray(cats[key]) ? cats[key] : []
            for (const p of list) {
              if (rows.length >= 2) break
              if (
                p &&
                typeof p.name === 'string' &&
                typeof p.lat === 'number' &&
                typeof p.lng === 'number'
              ) {
                rows.push({
                  apartment_id: apartmentId,
                  name: p.name,
                  category: key,
                  address: typeof p.address === 'string' ? p.address : null,
                  note: typeof p.description === 'string' ? p.description : null,
                  lat: p.lat,
                  lng: p.lng,
                  display_order: rows.length + 1,
                })
              }
            }
            if (rows.length >= 2) break
          }
          if (rows.length) await admin.from('host_picks').insert(rows)
        }
      } catch (e) {
        console.warn('[demo-create] picks seed failed (non-fatal) —', scrub(e))
      }

      try {
        const { payload } = await generateCityEvents({ id: apartmentId, city, country: null })
        if (payload) {
          await admin.from('city_events_cache').upsert(
            { apartment_id: apartmentId, payload, generated_at: new Date().toISOString() },
            { onConflict: 'apartment_id' },
          )
        }
      } catch (e) {
        console.warn('[demo-create] events seed failed (non-fatal) —', scrub(e))
      }
    }

    return res.status(200).json({ ok: true, apartmentId, token: tok })
  } catch (e) {
    console.error('[demo-create] failed —', scrub(e))
    return res.status(500).json({ error: 'Could not start demo' })
  }
}
