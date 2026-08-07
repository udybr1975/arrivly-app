// Forward + reverse geocoding via LocationIQ (EU endpoint). Best-effort, never throws.
//
// FREE-TIER RATE GATE: LocationIQ free allows ~2 req/sec. Callers fan out
// (guide.ts geocodes 5 at once, host-picks up to 20 at once), which would trip
// 429s. We serialize request *start* times here so every fetch begins at least
// MIN_START_GAP_MS after the previous one started (~1.8 req/s, safely under the
// cap). Requests may still overlap in flight — only START times are spaced.
// This makes throttling automatic with NO caller changes.
//
// The gate is SHARED BY BOTH DIRECTIONS (geocodeAddress + reverseGeocode) on purpose: the
// rate limit is per-key, not per-endpoint, so a second gate would let the two directions
// collectively exceed the cap while each looked compliant on its own.

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

// ── Reverse geocoding: coordinates → canonical city identity ──────────────────────────────
//
// Exists to give an apartment a STABLE, GLOBALLY-UNIQUE city key that is not the host's typed
// free text (which arrived as "Helsinki" / "HELSINKI" / "Finland " with a trailing space). The
// key is what the city-level events cache will be keyed on.
//
// Contract is deliberately IDENTICAL to geocodeAddress above: same shared rate gate, same key,
// same 3s abort, SILENT on every path (the key is in the URL, so a single log line anywhere in
// here would leak it), and it NEVER throws — every failure returns null.

interface ReverseResult {
  address?: {
    city?: string
    country?: string
    country_code?: string
  }
}

export interface CanonicalCity {
  city: string
  country: string | null
  countryCode: string | null
  cityKey: string | null
}

// Deterministic normalisation for the key half. Trim, collapse internal whitespace, lowercase.
// DELIBERATELY does NOT strip accents or punctuation: "san sebastián" must stay stable, and
// stripping is lossy — two genuinely different cities can collapse onto one key, which in the
// city-level cache means one city silently reading another's events.
export function normaliseCityForKey(city: string): string {
  return city.trim().replace(/\s+/g, ' ').toLowerCase()
}

export async function reverseGeocode(lat: number, lng: number): Promise<CanonicalCity | null> {
  const apiKey = process.env.LOCATIONIQ_API_KEY
  if (!apiKey) return null

  // Validate BEFORE spending a request (and before the gate delays the caller).
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null

  await rateGate()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    // normalizecity=1 and accept-language=en are BOTH load-bearing, verified, and must not be
    // dropped: without normalizecity OSM returns town/village for smaller places and
    // address.city comes back EMPTY, so a host in a small town would get a null key; without
    // accept-language the same city can return as Helsinki or Helsingfors on different calls,
    // which would split one city's cache into two.
    // Key is in the URL — this path stays SILENT (no logging in any branch below).
    const url = `https://eu1.locationiq.com/v1/reverse?key=${apiKey}&lat=${lat}&lon=${lng}&format=json&addressdetails=1&normalizecity=1&accept-language=en`
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return null

    // /v1/reverse returns a single OBJECT (unlike /v1/search's array). Accept an array-wrapped
    // body too rather than assuming — a shape surprise should degrade to null, not throw.
    const body = (await response.json()) as ReverseResult | ReverseResult[]
    const data = (Array.isArray(body) ? body[0] : body) as ReverseResult | undefined
    const addr = data?.address
    if (!addr) return null

    // NOTE the recorded LocationIQ trap (numbers as STRINGS, `lon` not `lng`) applies to the
    // coordinate fields — which this function deliberately does NOT read, since the caller
    // already has the coordinates. Do not start reading them here without the Number() guards.
    const city = typeof addr.city === 'string' ? addr.city.trim() : ''
    if (!city) return null // no usable key without a city

    const rawCc = typeof addr.country_code === 'string' ? addr.country_code.trim().toLowerCase() : ''
    const countryCode = /^[a-z]{2}$/.test(rawCc) ? rawCc : null

    // The key REQUIRES a country code. A bare city name is not globally unique (Helsinki is
    // also in the USA; there are dozens of Springfields), and a collision here means two
    // unrelated cities sharing one events cache row. No fallback — null is the honest answer.
    const cityKey = countryCode ? `${countryCode}:${normaliseCityForKey(city)}` : null

    return {
      city,
      country: typeof addr.country === 'string' ? addr.country : null,
      countryCode,
      cityKey,
    }
  } catch {
    // Abort, network error, parse error → null. Stay silent.
    return null
  } finally {
    clearTimeout(timeout)
  }
}
