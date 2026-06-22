// Forward geocoding via LocationIQ (EU endpoint). Best-effort, never throws.
//
// FREE-TIER RATE GATE: LocationIQ free allows ~2 req/sec. Callers fan out
// (guide.ts geocodes 5 at once, host-picks up to 20 at once), which would trip
// 429s. We serialize request *start* times here so every fetch begins at least
// MIN_START_GAP_MS after the previous one started (~1.8 req/s, safely under the
// cap). Requests may still overlap in flight — only START times are spaced.
// This makes throttling automatic with NO caller changes.

const MIN_START_GAP_MS = 550 // ~1.8 req/s start rate, under LocationIQ's ~2/s cap

// Module-level promise chain + lastStart timestamp. Each call awaits the gate,
// which resolves once enough time has elapsed since the previous start, then
// records its own start time before releasing the next waiter.
let gateChain: Promise<void> = Promise.resolve()
let lastStart = 0

function rateGate(): Promise<void> {
  // Chain onto the previous waiter so starts are strictly serialized.
  const next = gateChain.then(async () => {
    const now = Date.now()
    const wait = lastStart + MIN_START_GAP_MS - now
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
    lastStart = Date.now()
  })
  // Keep the chain alive even if a waiter is cancelled upstream.
  gateChain = next.catch(() => {})
  return next
}

interface LocationIQResult {
  lat: string
  lon: string
}

export async function geocodeAddress(query: string): Promise<{ lat: number; lng: number } | null> {
  const apiKey = process.env.LOCATIONIQ_API_KEY
  if (!apiKey) return null

  // Throttle the START of this request (see rate-gate note above).
  await rateGate()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    // EU forward geocoding. The key is in the URL — keep this path SILENT (no
    // logging anywhere below) so the key is never written to logs.
    const url = `https://eu1.locationiq.com/v1/search?key=${apiKey}&q=${encodeURIComponent(query)}&format=json&limit=1`
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    // Non-OK (404 "Unable to geocode", 429 rate limit, etc.) → null.
    if (!response.ok) return null
    const data = (await response.json()) as LocationIQResult[]
    if (!Array.isArray(data) || !data[0]) return null
    // LocationIQ returns "lat"/"lon" as STRINGS; normalise to our { lat, lng }.
    const lat = Number(data[0].lat)
    const lng = Number(data[0].lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng }
  } catch {
    // Abort, network error, parse error → null. Stay silent.
    return null
  } finally {
    clearTimeout(timeout)
  }
}
