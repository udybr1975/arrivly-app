import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { sendPushToHost } from './_lib/push.js'
import { syncApartmentBookings } from './_lib/ical.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const authClient = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!
  )
  const { data: authData, error: authError } = await authClient.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })
  const userId = authData.user.id

  if (!req.body) return res.status(400).json({ error: 'Request body required' })

  const { apartment_id } = req.body as { apartment_id?: string }
  if (!apartment_id) return res.status(400).json({ error: 'apartment_id required' })

  const { data: apt, error: aptErr } = await supabase
    .from('apartments')
    .select('ical_urls, host_id, name')
    .eq('id', apartment_id)
    .single()

  if (aptErr || !apt) return res.status(404).json({ error: 'Apartment not found' })
  if (apt.host_id !== userId) return res.status(403).json({ error: 'Forbidden' })

  const { imported, skipped, errors } = await syncApartmentBookings(supabase, {
    id: apartment_id,
    ical_urls: apt.ical_urls,
  })

  if (imported > 0) {
    try {
      await sendPushToHost(supabase, apt.host_id, {
        title: imported === 1 ? 'New booking' : 'New bookings',
        body: `${imported} new booking${imported === 1 ? '' : 's'} synced for ${apt.name ?? 'your property'}`,
        url: '/dashboard/bookings',
      })
    } catch {
      // ignore — notification is best-effort
    }
  }

  return res.status(200).json({ imported, skipped, errors })
}
