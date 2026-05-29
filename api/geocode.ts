import type { VercelRequest, VercelResponse } from '@vercel/node'

interface GoogleGeocodeResult {
  status: string
  results: Array<{
    geometry: { location: { lat: number; lng: number } }
  }>
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { address } = req.body as { address?: string }
  if (!address || typeof address !== 'string' || !address.trim()) {
    return res.status(400).json({ error: 'address is required' })
  }

  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'Geocoding not configured' })

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address.trim())}&key=${apiKey}`
    const response = await fetch(url)
    const data = await response.json() as GoogleGeocodeResult

    if (data.status !== 'OK' || !data.results[0]) {
      return res.status(200).json({ error: 'Address not found' })
    }

    const { lat, lng } = data.results[0].geometry.location
    return res.status(200).json({ lat, lng })
  } catch {
    return res.status(500).json({ error: 'Geocoding request failed' })
  }
}
