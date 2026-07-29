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
  address?: { country?: string }
}

// Optional locality bias. LocationIQ's /v1/search has NO proximity parameter, so the bias
// is expressed as a viewbox + bounded=1 (confirmed against docs.locationiq.com/reference/search:
// `viewbox` takes "min_lon,min_lat,max_lon,max_lat", `bounded` (0|1) restricts results to it,
// `countrycodes` takes ISO 3166-1 alpha-2). Without this, a query whose OSM coverage is thin
// returns a regional ADMINISTRATIVE CENTROID rather than failing — which is how guide places
// ended up hundreds of km inland.
export interface GeoBias {
  lat: number
  lng: number
  countryCode?: string
}

// Half-span of the bias box. Deliberately wider than the caller's own sanity bound so the box
// is never the binding constraint — the caller's distance check stays authoritative.
const BIAS_HALF_SPAN_KM = 40
const KM_PER_DEG_LAT = 111.32

// Build the viewbox/bounded/countrycodes query fragment for a bias. Returns '' when the bias
// is unusable, so a malformed bias degrades to today's unbiased lookup rather than erroring.
function biasParams(bias: GeoBias): string {
  if (!Number.isFinite(bias.lat) || !Number.isFinite(bias.lng)) return ''
  if (Math.abs(bias.lat) > 90 || Math.abs(bias.lng) > 180) return ''

  const latDelta = BIAS_HALF_SPAN_KM / KM_PER_DEG_LAT
  // Longitude degrees shrink toward the poles. Clamp the cosine so a near-polar apartment
  // widens the box instead of dividing by ~0.
  const cosLat = Math.max(Math.cos((bias.lat * Math.PI) / 180), 0.01)
  const lonDelta = Math.min(BIAS_HALF_SPAN_KM / (KM_PER_DEG_LAT * cosLat), 180)

  const minLat = Math.max(bias.lat - latDelta, -90)
  const maxLat = Math.min(bias.lat + latDelta, 90)
  // Clamped, not wrapped: a box spanning the antimeridian would be malformed, so it is
  // truncated instead. Only affects apartments within ~40km of ±180° longitude.
  const minLon = Math.max(bias.lng - lonDelta, -180)
  const maxLon = Math.min(bias.lng + lonDelta, 180)

  const viewbox = `${minLon.toFixed(6)},${minLat.toFixed(6)},${maxLon.toFixed(6)},${maxLat.toFixed(6)}`
  let params = `&viewbox=${viewbox}&bounded=1`

  // ISO 3166-1 alpha-2 only; anything else is dropped rather than sent.
  const cc = bias.countryCode?.trim().toLowerCase()
  if (cc && /^[a-z]{2}$/.test(cc)) params += `&countrycodes=${cc}`
  return params
}

export async function geocodeAddress(
  query: string,
  bias?: GeoBias,
): Promise<{ lat: number; lng: number; country?: string | null } | null> {
  const apiKey = process.env.LOCATIONIQ_API_KEY
  if (!apiKey) return null

  // Throttle the START of this request (see rate-gate note above).
  await rateGate()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    // EU forward geocoding. The key is in the URL — keep this path SILENT (no
    // logging anywhere below) so the key is never written to logs.
    // No bias → this string is byte-identical to the pre-bias URL (unbiased behaviour intact).
    const url = `https://eu1.locationiq.com/v1/search?key=${apiKey}&q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1${bias ? biasParams(bias) : ''}`
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
    // Additive field — existing callers that read only lat/lng are unaffected.
    return { lat, lng, country: data[0].address?.country ?? null }
  } catch {
    // Abort, network error, parse error → null. Stay silent.
    return null
  } finally {
    clearTimeout(timeout)
  }
}
