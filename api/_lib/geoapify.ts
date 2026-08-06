// Geoapify Places lookup for the ZERO-GOOGLE AI PILOT guide pipeline (Step 4).
// Best-effort, never throws, returns [] on any failure.
//
// SILENCE IS LOAD-BEARING: the API key travels in the URL as `apiKey=`, exactly like geo.ts's
// LocationIQ key. Nothing on the request path may log the URL, the response body, or the error
// — a single console.error(err) here would put the key in the logs. scrubErr's `key=` rule is a
// case-insensitive backstop that also catches `apiKey=`, but this module does not rely on it.
//
// FREE-TIER RATE GATE: Geoapify free allows 5 req/s. Callers are SEQUENTIAL by design (the
// guide runs six category queries one after another), and this module-level gate spaces request
// START times by MIN_START_GAP_MS so bursts cannot form even if a future caller fans out.
// Copied from geo.ts's proven pattern rather than reinvented.

const MIN_START_GAP_MS = 250 // 4 req/s start rate, under Geoapify's 5/s cap
const TIMEOUT_MS = 3000

let gateChain: Promise<void> = Promise.resolve()
let lastStart = 0

function rateGate(): Promise<void> {
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

// Coercion with the same semantics as guide.ts's `num`. Number(null) and Number('') are BOTH 0,
// so a plain Number() + isFinite check would turn a missing coordinate into a place at (0,0) —
// and this path deliberately has no MAX_PLACE_KM net, so that would reach the guest page with a
// Navigate button into the Gulf of Guinea.
const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// POI names AND addresses come from OSM, which is third-party-editable. Both reach the Groq
// prompt and the guest page, so bound both here at ingest, the way every host-supplied field is
// capped — not just the name.
const MAX_NAME_LEN = 120
const MAX_ADDR_LEN = 200

export interface PoiPlace {
  name: string
  lat: number
  lng: number
  street?: string
  formatted?: string
  categories: string[]
}

interface GeoapifyFeature {
  properties?: {
    name?: unknown
    lat?: unknown
    lon?: unknown
    street?: unknown
    formatted?: unknown
    categories?: unknown
  }
}

/**
 * Named POIs around a centre point. `categories` is a Geoapify category filter string
 * (comma-separated ids). Never throws; [] means "no usable result", never an error to surface.
 */
export async function placesNear(
  center: { lat: number; lng: number },
  categories: string,
  radiusM: number,
  limit: number,
): Promise<PoiPlace[]> {
  const apiKey = process.env.GEOAPIFY_API_KEY
  if (!apiKey) {
    // Safe to log: no URL has been built yet, so there is no key in scope to leak.
    console.warn('[geoapify] GEOAPIFY_API_KEY not configured')
    return []
  }
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return []

  await rateGate()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    // NOTE Geoapify orders coordinates LON,LAT in both `filter` and `bias` — the opposite of
    // our internal {lat,lng}. Getting this backwards silently returns places from the wrong
    // hemisphere rather than erroring, so it is spelled out here.
    const lon = center.lng
    const lat = center.lat
    const url =
      `https://api.geoapify.com/v2/places` +
      `?categories=${encodeURIComponent(categories)}` +
      `&filter=${encodeURIComponent(`circle:${lon},${lat},${radiusM}`)}` +
      `&bias=${encodeURIComponent(`proximity:${lon},${lat}`)}` +
      `&conditions=named` +
      `&limit=${limit}` +
      `&lang=en` +
      `&apiKey=${apiKey}`

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    // Non-OK (401 bad key, 429 quota, 5xx) → []. The STATUS is logged but never the URL or the
    // body: without it a bad key, an exhausted quota and "this neighbourhood has no cafes" are
    // indistinguishable, since every failure degrades to the same empty list.
    if (!response.ok) {
      console.warn('[geoapify] request failed', { status: response.status })
      return []
    }
    const data = (await response.json()) as { features?: GeoapifyFeature[] }
    const features = Array.isArray(data?.features) ? data.features : []

    const out: PoiPlace[] = []
    for (const f of features) {
      const p = f?.properties
      if (!p) continue
      const name = typeof p.name === 'string' ? p.name.trim().slice(0, MAX_NAME_LEN) : ''
      const plat = toNum(p.lat)
      const plng = toNum(p.lon)
      // Drop anything unnamed or without a usable fix — a place with no coordinate is worse
      // than absent here, since the whole point of the POI path is trustworthy coordinates.
      if (!name || plat === null || plng === null) continue
      out.push({
        name,
        lat: plat,
        lng: plng,
        ...(typeof p.street === 'string' && p.street.trim()
          ? { street: p.street.trim().slice(0, MAX_ADDR_LEN) }
          : {}),
        ...(typeof p.formatted === 'string' && p.formatted.trim()
          ? { formatted: p.formatted.trim().slice(0, MAX_ADDR_LEN) }
          : {}),
        categories: Array.isArray(p.categories) ? p.categories.filter((c): c is string => typeof c === 'string') : [],
      })
    }
    return out
  } catch {
    // Abort, network error, parse error → []. Stay silent: the URL carries the key.
    return []
  } finally {
    clearTimeout(timeout)
  }
}
