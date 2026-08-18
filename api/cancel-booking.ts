import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Host-auth endpoint: SOFT-cancels a manual booking (status -> 'cancelled').
//
// TWO INVARIANTS, both deliberate and both enforced here rather than in the client:
//
// 1. NEVER A HARD DELETE. The row stays, and `guest_id` / `reference_number` are never
//    touched. Cancelling is a state change, not an erasure — the guest side already
//    reads it correctly (a cancelled booking's token fails verification and the guest
//    gets the neutral page), and the messages attached to the booking must survive.
//
// 2. MANUAL SOURCE ONLY. Feed-sourced bookings (airbnb/vrbo/ical, and any *_block) are
//    owned by the channel: `reconcile_ical_bookings` is the only thing permitted to
//    change them, or the calendar stops matching the channel's truth and the next sync
//    silently reverts whatever we wrote. The client does not offer cancel on those rows,
//    but the server must not trust the client.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// THE EXACT INVERSE of the client's isManualSource() in BookingManager.tsx — that is the
// sibling to keep this in step with, NOT isBlockSource(), which answers a different question
// (is this row a *_block strip rather than a reservation card?) and is a substring test.
// Deliberately a strict `!== 'manual'` and not a substring check: every non-manual source is
// feed-owned, so enumerating feed names would be a denylist that a new channel silently
// defeats. A legacy NULL source counts as manual, matching what sourceLabel() renders.
// This file is the ENFORCING copy; the client's is only the affordance.
function isFeedOwned(source: string | null): boolean {
  if (!source) return false
  const s = source.toLowerCase()
  return s !== 'manual'
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
  const actorEmail = authData.user.email ?? authData.user.id

  const body = (req.body ?? {}) as { booking_id?: unknown }
  const bookingId = typeof body.booking_id === 'string' ? body.booking_id : ''
  if (!UUID_RE.test(bookingId)) return res.status(400).json({ error: 'Invalid input' })

  // Service-role client only AFTER auth + input validation. Never returned to client.
  const admin = createClient(supabaseUrl, serviceKey)

  // OWNERSHIP, VIA THE APARTMENT JOIN, WITH NO ORACLE. `apartments!inner` plus the
  // host_id equality means a booking that does not exist and a booking owned by another
  // host both resolve to null and both return the SAME 403 — the caller cannot use this
  // endpoint to discover whether a booking id is real.
  const { data: booking, error: loadErr } = await admin
    .from('bookings')
    .select('id, status, source, check_in, check_out, reference_number, apartment_id, apartments!inner(host_id)')
    .eq('id', bookingId)
    .eq('apartments.host_id', userId)
    .maybeSingle()

  if (loadErr) {
    console.error('[cancel-booking] load failed —', loadErr.message?.slice(0, 120))
    return res.status(500).json({ error: 'Could not cancel booking' })
  }
  if (!booking) return res.status(403).json({ error: 'Forbidden' })

  // Feed-owned rows are the sync's to change, never ours. Checked BEFORE the brake so a
  // client bug hammering this cannot burn a real host's hourly allowance.
  if (isFeedOwned(booking.source)) return res.status(400).json({ error: 'feed_owned' })
  if (booking.status === 'cancelled') return res.status(400).json({ error: 'already_cancelled' })

  // Per-host, per-UTC-hour brake matching create-booking's shape and limit. Cancelling
  // spends nothing and mints no guest pass, so this is not a spend brake — it bounds a
  // runaway client and keeps the endpoint's footprint consistent with its sibling. Fails
  // OPEN on infra error, for the same reason create-booking does: a counter outage must
  // never trap a host with a booking they cannot cancel.
  //
  // NOTE THE DELIBERATE ASYMMETRY WITH create-booking, which bumps BEFORE its overlap check
  // so that every attempt costs a unit. Here the rejections above (403 / feed_owned /
  // already_cancelled) run FIRST and cost nothing. The difference is that create-booking's
  // rejection path would otherwise be an unbraked probe, whereas these three are read-only
  // single-row lookups against the caller's own data with no oracle to protect — so charging
  // for them would only punish a buggy client. Do not "harmonise" the two without re-deriving
  // which side of that line the endpoint sits on.
  const CANCEL_HOURLY_LIMIT = 30
  {
    const { data: hourCount, error: counterErr } = await admin.rpc('bump_api_counter', {
      p_host_id: userId,
      p_endpoint: 'cancel-booking',
    })
    if (counterErr) {
      console.error('[cancel-booking] counter bump failed (fail-open) —', counterErr.message?.slice(0, 120))
    } else if (typeof hourCount === 'number' && hourCount > CANCEL_HOURLY_LIMIT) {
      return res.status(429).json({ error: 'rate_limited' })
    }
  }

  // SOFT cancel. Scoped by id AND status so a concurrent duplicate request cannot
  // double-apply, and re-scoped by apartment_id as a belt-and-braces guard that this
  // write can only ever land on the row ownership was proven for above.
  // `.select('id')` IS LOAD-BEARING, not decoration: without it a zero-row update is
  // indistinguishable from a one-row update (updErr is null either way) and the endpoint
  // would report success while the booking stayed live and its guest token kept working.
  // The `.neq` can legitimately match zero rows when a concurrent duplicate request won the
  // race — that is the case this detects. (`bookings.status` is NOT NULL, default
  // 'confirmed', VERIFIED against the live catalog, so the `.neq`-drops-NULL trap that would
  // otherwise apply here cannot occur; if that column ever becomes nullable this filter
  // silently starts skipping rows.)
  const { data: updated, error: updErr } = await admin
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', bookingId)
    .eq('apartment_id', booking.apartment_id)
    .neq('status', 'cancelled')
    .select('id')
  if (updErr) {
    console.error('[cancel-booking] update failed —', updErr.message?.slice(0, 120))
    return res.status(500).json({ error: 'Could not cancel booking' })
  }
  if (!updated || updated.length === 0) {
    // Nothing matched: the only reachable cause is a concurrent cancel that landed first,
    // since ownership, source and status were all just proven above. Report it as the same
    // terminal state that request produced rather than claiming this call did the work.
    return res.status(400).json({ error: 'already_cancelled' })
  }

  // AUDIT, best-effort and never fatal — the cancel already succeeded and failing the
  // request would tell the host it did not. This exists so "where did my booking go" has
  // an answer: a host-initiated cancel is otherwise indistinguishable from the reconcile
  // sync soft-cancelling a dropped feed row.
  //
  // `reference_number` IS THE GUEST TOKEN, and this table is retained 365 days and surfaced in
  // the SuperAdmin panel. Safe as built because the token is DEAD BY CONSTRUCTION at the moment
  // of this write — the update above just invalidated it, and every guest resolver filters
  // status in ('confirmed','completed'). IF AN UN-CANCEL PATH IS EVER ADDED, this stops being
  // true: it would revive a token already sitting in a year-long log. Drop the field then.
  const { error: auditErr } = await admin.from('admin_audit').insert({
    actor_email:    actorEmail,
    action:         'cancel_booking',
    target_host_id: userId,
    detail: {
      booking_id: bookingId,
      apartment_id: booking.apartment_id,
      reference_number: booking.reference_number,
      check_in: booking.check_in,
      check_out: booking.check_out,
      source: booking.source,
    },
  })
  if (auditErr) console.error('[cancel-booking] audit —', auditErr.message?.slice(0, 120))

  return res.status(200).json({ ok: true })
}
