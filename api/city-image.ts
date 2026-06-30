import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { fetchCityImage } from './_lib/city-image.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL!
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY!

  const authClient = createClient(supabaseUrl, anonKey)
  const { data: authData, error: authError } = await authClient.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })

  const { apartmentId } = req.body as { apartmentId?: string }
  if (!apartmentId || typeof apartmentId !== 'string') {
    return res.status(400).json({ error: 'apartmentId is required' })
  }

  const accessKey = process.env.UNSPLASH_ACCESS_KEY
  if (!accessKey) return res.status(500).json({ error: 'Image service not configured' })

  // User-scoped client → RLS confines reads/writes to apartments this host owns.
  const db = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: apt } = await db
    .from('apartments')
    .select('id, city')
    .eq('id', apartmentId)
    .maybeSingle()
  if (!apt) return res.status(404).json({ error: 'Apartment not found' })

  const city = (apt.city ?? '').trim()
  if (!city) return res.status(200).json({ skipped: 'no city' })

  // Shared best-effort Unsplash fetch (collapses the prior granular skip reasons to null).
  const result = await fetchCityImage(city)
  if (!result) return res.status(200).json({ skipped: 'unavailable' })

  const { error: updateError } = await db.from('apartments')
    .update({ city_image_url: result.imageUrl, city_image_credit: result.credit })
    .eq('id', apartmentId)
    .eq('host_id', authData.user.id)
  if (updateError) return res.status(200).json({ skipped: 'request failed' })

  return res.status(200).json({ url: result.imageUrl })
}
