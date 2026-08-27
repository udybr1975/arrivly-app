import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { sendNtfy } from './_lib/ntfy.js'
import { randomInt } from 'node:crypto'

// Host-auth endpoint: creates a manual booking + its own guest row server-side, so
// the client no longer reads or inserts `guests` directly (which had forced the
// wide-open guests RLS policies). Each booking gets a fresh guest row — no
// cross-host dedup. Behaviour matches the prior client flow: no push, no email.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Reference token for a new booking. `reference_number` DOUBLES AS THE GUEST ACCESS TOKEN —
// it is what /api/guest-details, /api/guest-state and /api/guest-chat accept as the
// credential — SO IT MUST NOT BE PREDICTABLE, and that is why this uses node:crypto rather
// than Math.random().
//
// THE DEFECT THIS REPLACED WAS PREDICTABILITY, NOT BIAS, and the distinction matters so the
// next reader does not "simplify" it back. The alphabet is 32 characters, a power of two, so
// `Math.floor(Math.random() * 32)` was uniform — nothing was skewed. What was wrong is that
// V8's Math.random is xorshift128+ drawn from a shared per-isolate pool, and its state is
// RECOVERABLE FROM OBSERVED OUTPUTS. Be precise about the cost, because the fix does not
// depend on exaggerating it. A token exposes only floor(x*32) — the TOP 5 BITS of each
// draw — so against 128 bits of state an attacker needs AT LEAST ~26 consecutive draws,
// i.e. FIVE-ISH tokens minted back to back on one warm instance, plus a lattice/SAT solve.
// ONE token is 30 bits and is nowhere near enough. The samples must also be CONTIGUOUS in
// the draw stream, so any other Math.random consumer on that isolate inserts unknowns and
// makes it harder still. Expensive and co-residency-dependent, then — but it is a path to
// a NEIGHBOURING token that ignores the 32^6 search space entirely, and it predicts
// BACKWARDS as well as forwards. Math.random is not a security primitive and a credential
// must not be drawn from it at any price. randomInt() closes it; it also rejection-
// samples, which costs nothing here but keeps the function correct if the alphabet ever
// stops being a power of two.
//
// THREE MINTERS PRODUCE THIS CREDENTIAL and they must agree: this one, demo-create.ts
// (identical body), and api/_lib/ical.ts generateRef — which builds the suffix separately
// and template-literals the prefix, so it is the same OUTPUT SHAPE by a different
// implementation, not the same code. All three now draw from node:crypto. They had already
// drifted once on exactly this property: ical.ts had crypto from the start and the other
// two did not, because both inherited their body from the old CLIENT-side helper, where
// node:crypto was not available. A fourth minter must not repeat that.
// Alphabet: Crockford-ish, no ambiguous characters (no I/O/0/1).
function randomRef(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let r = 'ARR-'
  for (let i = 0; i < 6; i++) r += chars[randomInt(chars.length)]
  return r
}

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL!
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return res.status(500).json({ error: 'Booking service not configured' })

  const authClient = createClient(supabaseUrl, anonKey)
  const { data: authData, error: authError } = await authClient.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })
  const userId = authData.user.id

  const body = (req.body ?? {}) as {
    apartment_id?: unknown; first_name?: unknown; check_in?: unknown; check_out?: unknown
  }
  const apartmentId = typeof body.apartment_id === 'string' ? body.apartment_id : ''
  const firstName = typeof body.first_name === 'string' ? body.first_name.trim() : ''
  const checkIn = typeof body.check_in === 'string' ? body.check_in : ''
  const checkOut = typeof body.check_out === 'string' ? body.check_out : ''

  if (!UUID_RE.test(apartmentId)) return res.status(400).json({ error: 'Invalid input' })
  if (!firstName || firstName.length > 80) return res.status(400).json({ error: 'Invalid input' })
  if (!isValidDate(checkIn) || !isValidDate(checkOut)) return res.status(400).json({ error: 'Invalid input' })
  if (checkOut <= checkIn) return res.status(400).json({ error: 'Invalid input' })

  // Service-role client only AFTER auth + input validation. Never returned to client.
  const admin = createClient(supabaseUrl, serviceKey)

  // Ownership: the apartment must belong to the authenticated host. Never trust the
  // client apartment_id for authorization.
  const { data: apt } = await admin
    .from('apartments')
    .select('id')
    .eq('id', apartmentId)
    .eq('host_id', userId)
    .maybeSingle()
  if (!apt) return res.status(403).json({ error: 'Forbidden' })

  // ── Booking-flood brake + alarm (the "amplifier" fix) ───────────────────────────
  // create-booking mints a fresh in-dates guest pass on every call, with no cap and
  // host-controlled dates, so a script could mint unlimited valid passes that unlock the
  // paid guest AI (guest-chat, daily-greeting). This is a REAL cross-instance rate limit
  // via the atomic bump_api_counter RPC (per host, per UTC hour): the counter IS the brake,
  // so blocked attempts still increment and stay blocked for the rest of the hour. Fires
  // ONE ntfy when the host first crosses the limit. Fails OPEN on an infra error so a
  // counter outage never locks a real host out of adding bookings.
  const BOOKING_HOURLY_LIMIT = 30
  {
    const { data: hourCount, error: counterErr } = await admin.rpc('bump_api_counter', {
      p_host_id: userId,
      p_endpoint: 'create-booking',
    })
    if (counterErr) {
      // Fail open: never block a legitimate booking on a counter/infra failure.
      console.error('[create-booking] counter bump failed (fail-open) —', counterErr.message?.slice(0, 120))
    } else if (typeof hourCount === 'number' && hourCount > BOOKING_HOURLY_LIMIT) {
      if (hourCount === BOOKING_HOURLY_LIMIT + 1) {
        try {
          await sendNtfy({
            title: 'Bemgu abuse alert: booking flood',
            message:
              // BODY BUDGET: sendNtfy slices `message` to 500 chars (api/_lib/ntfy.ts).
              // MEASURED 483 with a 36-char host UUID = 17 spare. RE-MEASURE ON EVERY EDIT —
              // adding the ATTEMPTS caveat took this to 633 and silently truncated the entire
              // ACTION line, which is the one sentence that tells the operator what to do.
              // ACTION IS SECOND, DELIBERATELY, so truncation can never eat the actionable part
              // (the same ordering rule cron-spend-audit.ts already documents).
              `Feature: Booking creation (/api/create-booking)\n` +
              `Host ${userId} tripped the rate limit (over ${BOOKING_HOURLY_LIMIT} ATTEMPTS/hour) - now blocked this hour.\n` +
              `ACTION: block this host in Supabase. Logs: /api/create-booking\n` +
              `NOTE: rejected 409s bump the counter too - can trip with few or no bookings created.\n` +
              `AMPLIFIER: bookings mint guest passes that unlock the paid AI (this endpoint spends nothing).\n` +
              `Watch spend: guest-chat (GEMINI_API_KEY_CHAT), daily-greeting (GEMINI_API_KEY).`,
            priority: 'high',
          })
        } catch (e) {
          console.warn('[create-booking] flood alarm failed (non-fatal)', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
        }
      }
      return res.status(429).json({ error: 'rate_limited' })
    }
  }

  // ── OVERLAP GUARD (B10) ─────────────────────────────────────────────────────────
  // The server is the source of truth for availability. The client had no check at all,
  // and two overlapping confirmed bookings on one property were created without
  // complaint in live testing.
  //
  // HALF-OPEN INTERVALS [check_in, check_out). Two stays conflict iff
  //     new.check_in < existing.check_out AND new.check_out > existing.check_in
  // which is expressed below as existing.check_in < new.check_out (lt) AND
  // existing.check_out > new.check_in (gt).
  //
  // SAME-DAY TURNOVER PASSES BY CONSTRUCTION, and that is the point of half-open rather
  // than closed intervals: guest A leaves on the 20th, guest B arrives on the 20th, so
  // A = [10, 20) and B = [20, 25). Testing B: 20 < 20 is FALSE, no conflict. Testing A
  // against B: 20 > 20 is FALSE, no conflict. Neither ordering reports one. Turnover is
  // normal STR operation and must never be blocked.
  //
  // SCOPE: ALL non-cancelled bookings on this apartment, INCLUDING block-sourced rows —
  // blocked dates are unavailable dates. Cancelled rows are free again by definition.
  // Read with the admin client so the answer is RLS-independent, and scoped to the one
  // apartment whose ownership was just proven above.
  //
  // Dates are YYYY-MM-DD `date` columns; string and chronological order coincide, so the
  // comparison is correct whether Postgres compares them as dates or the strings are
  // compared directly.
  //
  // PLACED AFTER THE BRAKE DELIBERATELY: the counter IS the brake, so every attempt must
  // cost a unit. Rejecting a conflict before the bump would turn this into an unbraked
  // probe. (The probe would be of the host's OWN occupancy, which they can already read
  // through RLS - so the load-bearing reason is simply that the counter must count attempts,
  // and the ntfy wording above now says so.)
  //
  // THIS SCAN IS NOT AUTHORITATIVE AND MUST NOT BE READ AS ONE. Two known gaps, accepted
  // here rather than hidden:
  //   1. TOCTOU - two concurrent adds can both pass the scan and both insert. There is no DB
  //      exclusion constraint (that needs a migration). The window is one round-trip and the
  //      actor is one authenticated host with the button disabled while saving.
  //   2. OVERLAP-FREEDOM IS NOT AN INVARIANT OF THIS TABLE AT ALL: reconcile_ical_bookings
  //      writes feed rows with no overlap awareness, so a sync can introduce an overlap a
  //      second after any manual add.
  // Read this guard as "stop the host fat-fingering a double booking" - the defect it was
  // built for - never as "the calendar can never overlap". An exclusion constraint is the
  // real fix for that.
  const { data: conflict, error: conflictErr } = await admin
    .from('bookings')
    .select('reference_number, check_in, check_out, source')
    .eq('apartment_id', apartmentId)
    .neq('status', 'cancelled')
    .lt('check_in', checkOut)
    .gt('check_out', checkIn)
    .order('check_in', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (conflictErr) {
    // FAIL CLOSED. Unlike the counter above (which fails open so an infra blip cannot lock
    // a host out), an unreadable calendar must not be treated as an empty one — that would
    // silently permit the double booking this guard exists to prevent.
    console.error('[create-booking] overlap check failed —', conflictErr.message?.slice(0, 120))
    return res.status(500).json({ error: 'Could not add booking' })
  }

  if (conflict) {
    // Name the conflict so the client can say WHICH booking is in the way. Only the host's
    // own booking on their own apartment is described, so this discloses nothing new.
    return res.status(409).json({
      error: 'dates_unavailable',
      conflict: {
        reference_number: conflict.reference_number,
        check_in: conflict.check_in,
        check_out: conflict.check_out,
        source: conflict.source,
      },
    })
  }

  // Fresh guest row per booking — no cross-host dedup.
  const { data: guest, error: guestErr } = await admin
    .from('guests')
    .insert({ first_name: firstName, last_name: '', email: '' })
    .select('id')
    .single()
  if (guestErr || !guest) {
    console.error('[create-booking] guest insert failed —', guestErr?.message?.slice(0, 120))
    return res.status(500).json({ error: 'Could not add booking' })
  }

  // Insert the booking, regenerating the reference on a unique-violation collision.
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
    if (!bookErr) {
      const { data: created } = await admin
        .from('bookings')
        .select('id')
        .eq('reference_number', ref)
        .maybeSingle()
      return res.status(200).json({ ok: true, reference_number: ref, booking_id: created?.id ?? null })
    }
    if (bookErr.code !== '23505') {
      console.error('[create-booking] booking insert failed —', bookErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Could not add booking' })
    }
    // 23505 unique violation on reference_number — retry with a new ref.
  }

  console.error('[create-booking] exhausted reference retries')
  return res.status(500).json({ error: 'Could not add booking' })
}
