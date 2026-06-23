import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

// Service-role resolver for a guest's booking STATE. This moves the booking
// reads off the client (which previously queried the `bookings` table with the
// public anon key) onto the server. It reproduces GuestPage.tsx's exact booking
// semantics — neutral / thankyou / active — EXCEPT the tokenless date-lookup now
// requires a valid per-apartment QR key (apartment_qr_secrets.qr_secret).
//
// Responses are intentionally FLAT: every non-active outcome returns the neutral
// shape, so the endpoint never leaks (via status code or body) whether a token
// exists-but-is-out-of-dates vs. simply isn't found. 400 is only for malformed
// input. Expired-subscription handling and the localStorage "previous guest"
// comparison stay in GuestPage and are NOT part of this endpoint.

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_RE = /^[A-Za-z0-9-]{4,32}$/

const svc = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const NEUTRAL = { state: 'neutral' as const, token: null, guestName: null }

// --- Best-effort in-memory rate limiter -------------------------------------
// Per-instance only: serverless memory is NOT shared across Lambda instances,
// so this caps abuse from a single warm instance, not globally. A shared-store
// (Redis/Upstash) limiter is a future hardening option — do not oversell this.
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

// ----------------------------------------------------------------------------

async function resolveGuestName(db: SupabaseClient, guestId: string | null): Promise<string | null> {
  if (!guestId) return null
  const { data: g } = await db.from('guests').select('first_name').eq('id', guestId).maybeSingle()
  return g?.first_name ?? null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const now = Date.now()
  if (rateLimited(clientIp(req), now)) {
    return res.status(429).json({ error: 'rate_limited' })
  }

  // --- 1. Validate inputs ---
  const apt = typeof req.query.apt === 'string' ? req.query.apt.trim() : ''
  if (!apt || !UUID_RE.test(apt)) return res.status(400).json({ error: 'bad_request' })

  const tokenProvided = req.query.token !== undefined
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : ''
  if (tokenProvided && !TOKEN_RE.test(token)) return res.status(400).json({ error: 'bad_request' })

  const keyProvided = req.query.key !== undefined
  const key = typeof req.query.key === 'string' ? req.query.key : ''
  if (keyProvided && (key.length === 0 || key.length > 64)) {
    return res.status(400).json({ error: 'bad_request' })
  }

  // Helsinki "now" ("YYYY-MM-DD HH:MM:SS") + date part — matches GuestPage gating.
  const helsinkiNow = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Helsinki' })
  const helsinkiToday = helsinkiNow.split(' ')[0]

  const db = svc()
  try {
    // --- 2. Apartment must exist AND be visible ---
    const { data: apartment, error: aptErr } = await db
      .from('apartments')
      .select('id, is_visible')
      .eq('id', apt)
      .maybeSingle()
    if (aptErr) {
      console.error('[guest-state] apt query', aptErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'query_failed' })
    }
    if (!apartment || apartment.is_visible !== true) {
      return res.status(200).json(NEUTRAL)
    }

    // --- 3. TOKEN PATH ---
    if (tokenProvided) {
      const { data: booking } = await db
        .from('bookings')
        .select('reference_number, check_in, check_out, guest_id, status')
        .eq('reference_number', token)
        .eq('apartment_id', apt)
        .in('status', ['confirmed', 'completed'])
        .limit(1)
        .maybeSingle()

      if (booking) {
        const checkoutCutoff = booking.check_out + ' 11:00:00'
        if (helsinkiNow >= checkoutCutoff) {
          const guestName = await resolveGuestName(db, booking.guest_id)
          return res.status(200).json({ state: 'thankyou', token, guestName })
        }
        if (helsinkiToday >= booking.check_in && helsinkiToday <= booking.check_out) {
          const guestName = await resolveGuestName(db, booking.guest_id)
          return res.status(200).json({ state: 'active', token, guestName })
        }
        // future/other → fall through to keyed date path
      }
    }

    // --- 4. KEYED DATE PATH (only with a supplied key matching the apartment secret) ---
    if (keyProvided) {
      const { data: secretRow, error: secretErr } = await db
        .from('apartment_qr_secrets')
        .select('qr_secret')
        .eq('apartment_id', apt)
        .maybeSingle()

      // Log (truncated, secret-free) so a missing-table / RLS-misconfig deploy is
      // visible in logs rather than silently always-neutral. The response shape is
      // unchanged on error (still falls through to neutral) to avoid any leak.
      if (secretErr) console.error('[guest-state] secret query', secretErr.message?.slice(0, 120))

      // Constant-shape failure: a wrong/missing key reveals nothing (→ step 5).
      if (secretRow && secretRow.qr_secret === key) {
        const { data: dateBooking } = await db
          .from('bookings')
          .select('reference_number, guest_id')
          .eq('apartment_id', apt)
          .eq('status', 'confirmed')
          .lte('check_in', helsinkiToday)
          .gt('check_out', helsinkiToday)
          .not('reference_number', 'is', null)
          .order('source', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (dateBooking?.reference_number) {
          const guestName = await resolveGuestName(db, dateBooking.guest_id)
          return res.status(200).json({ state: 'active', token: dateBooking.reference_number, guestName })
        }
      }
    }

    // --- 5. DEFAULT ---
    return res.status(200).json(NEUTRAL)
  } catch (e) {
    console.error('[guest-state] unexpected', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
    return res.status(500).json({ error: 'internal_error' })
  }
}
