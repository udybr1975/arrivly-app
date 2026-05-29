import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

interface GoogleGeocodeResult {
  status: string
  results: Array<{
    geometry: { location: { lat: number; lng: number } }
  }>
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!)
  const { data: authData, error: authError } = await sb.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })

  const { address } = req.body as { address?: string }
  if (!address || typeof address !== 'string' || !address.trim()) {
    return res.status(400).json({ error: 'address is required' })
  }

  const trimmed = address.trim()
  if (trimmed.length > 250) return res.status(400).json({ error: 'address too long' })

  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'Geocoding not configured' })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(trimmed)}&key=${apiKey}`
    const response = await fetch(url, { signal: controller.signal })
    const geoData = await response.json() as GoogleGeocodeResult

    if (geoData.status !== 'OK' || !geoData.results[0]) {
      return res.status(200).json({ error: 'Address not found' })
    }

    const { lat, lng } = geoData.results[0].geometry.location
    return res.status(200).json({ lat, lng })
  } catch {
    return res.status(500).json({ error: 'Geocoding request failed' })
  } finally {
    clearTimeout(timeout)
  }
}
