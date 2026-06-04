import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const MAX_BODY = 2000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL!
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return res.status(500).json({ error: 'Service not configured' })

  const authClient = createClient(supabaseUrl, anonKey)
  const { data: authData, error: authError } = await authClient.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })
  const userId = authData.user.id

  const admin = createClient(supabaseUrl, serviceKey)

  const { bookingId, body } = (req.body ?? {}) as { bookingId?: string; body?: string }
  if (!bookingId || typeof bookingId !== 'string') return res.status(400).json({ error: 'bookingId required' })
  if (typeof body !== 'string') return res.status(400).json({ error: 'body required' })

  const text = body.trim()
  if (!text) return res.status(400).json({ error: 'empty' })
  const truncated = text.slice(0, MAX_BODY)

  // Ownership: booking → apartment → host_id must match verified user.
  const { data: booking } = await admin
    .from('bookings')
    .select('id, apartment_id')
    .eq('id', bookingId)
    .maybeSingle()
  if (!booking) return res.status(404).json({ error: 'not_found' })

  const { data: apt } = await admin
    .from('apartments')
    .select('host_id')
    .eq('id', booking.apartment_id)
    .maybeSingle()
  if (!apt || apt.host_id !== userId) return res.status(403).json({ error: 'forbidden' })

  // apartment_id is server-derived from the booking row — never from client body.
  const { error: insertError } = await admin
    .from('messages')
    .insert({ booking_id: booking.id, apartment_id: booking.apartment_id, sender_role: 'host', body: truncated })
  if (insertError) {
    const msg = String(insertError.message ?? '').replace(/key=[^&\s]+/gi, 'key=REDACTED').slice(0, 120)
    console.error('[host-message] insert failed —', msg)
    return res.status(500).json({ error: 'send_failed' })
  }

  // TODO: fire guest push notification here once guest push subscriptions exist.

  const { data: messages, error: fetchError } = await admin
    .from('messages')
    .select('id, sender_role, body, created_at, read_at')
    .eq('booking_id', booking.id)
    .eq('apartment_id', booking.apartment_id)
    .order('created_at', { ascending: true })
  if (fetchError) {
    const msg = String(fetchError.message ?? '').replace(/key=[^&\s]+/gi, 'key=REDACTED').slice(0, 120)
    console.error('[host-message] fetch failed —', msg)
    return res.status(500).json({ error: 'fetch_failed' })
  }

  return res.status(200).json({ messages: messages ?? [] })
}
