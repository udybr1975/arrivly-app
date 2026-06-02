interface GoogleGeocodeResult {
  status: string
  results: Array<{
    geometry: { location: { lat: number; lng: number } }
  }>
}

export async function geocodeAddress(query: string): Promise<{ lat: number; lng: number } | null> {
  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY
  if (!apiKey) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}`
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    const data = await response.json() as GoogleGeocodeResult
    if (data.status !== 'OK' || !data.results[0]) return null
    return data.results[0].geometry.location
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
