import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveMessagingAccess } from './_lib/guest-access.js'
import { sendPushToHost } from './_lib/push.js'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const MAX_BODY = 2000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { apartmentId, token, action, body } = (req.body ?? {}) as {
    apartmentId?: string; token?: string | null; action?: string; body?: string
  }
  if (!apartmentId || typeof apartmentId !== 'string') return res.status(400).json({ error: 'apartmentId required' })
  if (action !== 'list' && action !== 'send') return res.status(400).json({ error: 'invalid action' })

  // Authoritative apartment from DB — client is trusted only for id + token.
  const { data: apt } = await supabase
    .from('apartments')
    .select('id, name, host_id, is_visible')
    .eq('id', apartmentId)
    .maybeSingle()
  if (!apt || apt.is_visible === false) return res.status(404).json({ error: 'not_found' })

  const cleanToken = typeof token === 'string' && token !== 'null' && token.trim() ? token.trim() : null
  const access = await resolveMessagingAccess(supabase, apt.id, cleanToken)
  if (!access.allowed || !access.bookingId) return res.status(403).json({ error: 'not_verified' })

  if (action === 'send') {
    const text = String(body ?? '').trim()
    if (!text) return res.status(400).json({ error: 'empty' })
    const truncated = text.slice(0, MAX_BODY)

    // booking_id and apartment_id come ONLY from the server-resolved booking /
    // authoritative apartment row — never from the client body.
    const { error: insertError } = await supabase
      .from('messages')
      .insert({ booking_id: access.bookingId, apartment_id: apt.id, sender_role: 'guest', body: truncated })
    if (insertError) {
      const msg = String(insertError.message ?? '').replace(/key=[^&\s]+/gi, 'key=REDACTED').slice(0, 120)
      console.error('[guest-message] insert failed —', msg)
      return res.status(500).json({ error: 'send_failed' })
    }

    // Best-effort push to host — never throws, never blocks the response.
    void sendPushToHost(
      supabase,
      apt.host_id,
      { title: `New message · ${apt.name}`, body: truncated.slice(0, 120), url: '/dashboard/messages' }
    )
  }

  // Return the full thread for both actions.
  const { data: messages, error: fetchError } = await supabase
    .from('messages')
    .select('id, sender_role, body, created_at, read_at')
    .eq('booking_id', access.bookingId)
    .order('created_at', { ascending: true })
  if (fetchError) {
    const msg = String(fetchError.message ?? '').replace(/key=[^&\s]+/gi, 'key=REDACTED').slice(0, 120)
    console.error('[guest-message] fetch failed —', msg)
    return res.status(500).json({ error: 'fetch_failed' })
  }

  return res.status(200).json({ messages: messages ?? [] })
}
