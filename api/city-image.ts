import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

interface UnsplashPhoto {
  urls: { raw: string }
  user: { name: string; links: { html: string } }
  links: { download_location: string }
}
interface UnsplashSearch {
  results?: UnsplashPhoto[]
}

const APP_NAME = 'Arrivly'

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

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)
  try {
    const query = encodeURIComponent(`${city} city`)
    const searchUrl = `https://api.unsplash.com/search/photos?query=${query}&per_page=10&orientation=landscape&content_filter=high`
    const r = await fetch(searchUrl, {
      headers: { Authorization: `Client-ID ${accessKey}` },
      signal: controller.signal,
    })
    if (!r.ok) return res.status(200).json({ skipped: 'search unavailable' })

    const data = await r.json() as UnsplashSearch
    const photo = data.results?.[0]
    if (!photo) return res.status(200).json({ skipped: 'no results' })

    const imageUrl = `${photo.urls.raw}&w=1600&q=80&auto=format&fit=crop`
    const utm = `utm_source=${APP_NAME}&utm_medium=referral`
    const photographerUrl = photo.user.links.html.startsWith('https://') ? photo.user.links.html : 'https://unsplash.com'
    const credit = JSON.stringify({
      name: photo.user.name,
      userLink: `${photographerUrl}?${utm}`,
      unsplashLink: `https://unsplash.com/?${utm}`,
    })

    const { error: updateError } = await db.from('apartments')
      .update({ city_image_url: imageUrl, city_image_credit: credit })
      .eq('id', apartmentId)
      .eq('host_id', authData.user.id)
    if (updateError) throw updateError

    // Unsplash guideline: register a download when a photo is used. Best-effort.
    if (photo.links.download_location.startsWith('https://api.unsplash.com/')) {
      fetch(`${photo.links.download_location}?client_id=${accessKey}`).catch(() => {})
    }

    return res.status(200).json({ url: imageUrl })
  } catch {
    return res.status(200).json({ skipped: 'request failed' })
  } finally {
    clearTimeout(timeout)
  }
}
