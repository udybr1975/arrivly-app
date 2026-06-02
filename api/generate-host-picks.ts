import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { enrichHostPicks } from './_lib/host-picks.js'

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

  if (!req.body) return res.status(400).json({ error: 'apartmentId and text required' })
  const { apartmentId, text } = req.body as { apartmentId?: string; text?: string }
  if (!apartmentId) return res.status(400).json({ error: 'apartmentId required' })
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text required' })
  }

  const { data: apt, error: aptErr } = await supabase
    .from('apartments')
    .select('id, host_id, city, neighborhood, country')
    .eq('id', apartmentId)
    .single()

  if (aptErr || !apt) return res.status(404).json({ error: 'Apartment not found' })
  if (apt.host_id !== userId) return res.status(403).json({ error: 'Forbidden' })

  try {
    const picks = await enrichHostPicks(text.trim().slice(0, 5000), {
      city: apt.city,
      neighborhood: apt.neighborhood,
      country: apt.country,
    })
    return res.status(200).json({ picks })
  } catch {
    return res.status(500).json({ error: 'Pick generation failed' })
  }
}
