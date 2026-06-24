import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Host-auth endpoint: creates a manual booking + its own guest row server-side, so
// the client no longer reads or inserts `guests` directly (which had forced the
// wide-open guests RLS policies). Each booking gets a fresh guest row — no
// cross-host dedup. Behaviour matches the prior client flow: no push, no email.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Same alphabet/shape as the prior client randomRef (Crockford-ish, no ambiguous chars).
function randomRef(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let r = 'ARR-'
  for (let i = 0; i < 6; i++) r += chars[Math.floor(Math.random() * chars.length)]
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
