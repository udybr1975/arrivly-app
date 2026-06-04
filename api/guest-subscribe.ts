import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveMessagingAccess } from './_lib/guest-access.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return res.status(500).json({ error: 'Service not configured' })

  const supabase = createClient(process.env.VITE_SUPABASE_URL!, serviceKey)

  const { apartmentId, token, subscription } = (req.body ?? {}) as {
    apartmentId?: string
    token?: string | null
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  }

  if (!apartmentId || typeof apartmentId !== 'string') return res.status(400).json({ error: 'invalid_request' })
  if (
    !subscription?.endpoint || typeof subscription.endpoint !== 'string' ||
    !subscription?.keys?.p256dh || typeof subscription.keys.p256dh !== 'string' ||
    !subscription?.keys?.auth || typeof subscription.keys.auth !== 'string'
  ) return res.status(400).json({ error: 'invalid_request' })

  // Authoritative apartment — client is trusted only for id + token.
  const { data: apt } = await supabase
    .from('apartments')
    .select('id, host_id, is_visible')
    .eq('id', apartmentId)
    .maybeSingle()
  if (!apt || apt.is_visible === false) return res.status(404).json({ error: 'not_found' })

  const cleanToken = typeof token === 'string' && token !== 'null' && token.trim() ? token.trim() : null
  const access = await resolveMessagingAccess(supabase, apt.id, cleanToken)
  if (!access.allowed || !access.bookingId) return res.status(403).json({ error: 'not_verified' })

  // host_id / apartment_id / booking_id come ONLY from the server-resolved booking +
  // authoritative apartment row — never from the client body.
  const { error: upsertError } = await supabase
    .from('push_subscriptions')
    .upsert({
      host_id: apt.host_id,
      apartment_id: apt.id,
      booking_id: access.bookingId,
      role: 'guest',
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth_key: subscription.keys.auth,
    }, { onConflict: 'endpoint' })

  if (upsertError) {
    const msg = String(upsertError.message ?? '').replace(/key=[^&\s]+/gi, 'key=REDACTED').slice(0, 120)
    console.error('[guest-subscribe] upsert failed —', msg)
    return res.status(500).json({ error: 'subscribe_failed' })
  }

  return res.status(200).json({ ok: true })
}
