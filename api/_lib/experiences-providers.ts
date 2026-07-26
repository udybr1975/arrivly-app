// Provider adapters for bookable experiences (Viator + Tiqets content APIs).
//
// Each adapter returns a NORMALIZED list of experiences and NEVER throws — on any
// failure it returns [] and logs a short (<=120 char) message that NEVER contains the
// API key or the full request URL/query. GYG has NO content API at our access level,
// so there is no GYG adapter here (GYG is link/widget-based — see affiliate-links.ts).
//
// deepLinkPath is stored as a SITE-RELATIVE PATH (no affiliate params); the pure
// link-builder (affiliate-links.ts) prefixes the provider origin and stamps ids.

import { withRetry } from './retry.js'

export type ExperienceProvider = 'viator' | 'gyg' | 'tiqets'

export interface NormalizedExperience {
  provider: ExperienceProvider
  productId: string
  title: string
  imageUrl: string | null
  imageCredit: string | null
  rating: number | null
  reviewCount: number | null
  priceAmount: number | null
  priceCurrency: 'EUR' | 'USD'
  durationLabel: string | null
  deepLinkPath: string
}

const TIMEOUT_MS = 10_000
const MAX_ITEMS = 8

function log(provider: string, msg: string): void {
  // Never include the key or full URL — callers pass short, key-free messages.
  console.warn(`[experiences:${provider}] ${String(msg).slice(0, 120)}`)
}

function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Extract a site-relative path from either a full URL or an already-relative path.
function toPath(url: unknown): string | null {
  const s = typeof url === 'string' ? url.trim() : ''
  if (!s) return null
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s)
      return u.pathname + u.search
    } catch {
      return null
    }
  }
  return s.startsWith('/') ? s : `/${s}`
}

function minutesToLabel(min: number | null): string | null {
  if (!min || min <= 0) return null
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m ? `${h}h ${m}m` : `${h}h`
}

// Timeout-guarded JSON fetch. Returns parsed JSON or throws (so withRetry can retry
// transient failures). The URL is passed but never logged by callers.
async function fetchJson(url: string, init: RequestInit): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    if (!res.ok) {
      const err = new Error(`http ${res.status}`) as Error & { status?: number }
      err.status = res.status
      throw err
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// ── Viator ────────────────────────────────────────────────────────────────────
// Viator Partner API (Basic/Affiliate access), freetext product search by city.
// ASSUMPTION (verify against real responses): endpoint /partner/search/freetext,
// header `exp-api-key`, `Accept: application/json;version=2.0`; response shape
// { products: { results: [ { productCode, title, images[].variants[].url,
//   reviews:{combinedAverageRating,totalReviews}, pricing:{summary:{fromPrice}},
//   duration:{fixedDurationInMinutes|...}, productUrl } ] } }. Prices are USD at our
// account level.
export async function fetchViatorExperiences(
  _lat: number | null,
  _lng: number | null,
  city: string,
): Promise<NormalizedExperience[]> {
  const key = process.env.VIATOR_API_KEY
  if (!key) return []
  if (!city) return []

  try {
    const data = await withRetry(
      () =>
        fetchJson('https://api.viator.com/partner/search/freetext', {
          method: 'POST',
          headers: {
            'exp-api-key': key,
            Accept: 'application/json;version=2.0',
            'Accept-Language': 'en',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            searchTerm: city.slice(0, 120),
            currency: 'USD',
            searchTypes: [{ searchType: 'PRODUCTS', pagination: { start: 1, count: 20 } }],
          }),
        }),
      { retries: 1 },
    )

    const results: any[] = Array.isArray(data?.products?.results)
      ? data.products.results
      : Array.isArray(data?.products)
        ? data.products
        : []

    const items: NormalizedExperience[] = []
    for (const p of results) {
      const productId = String(p?.productCode ?? p?.code ?? '').trim()
      const title = String(p?.title ?? '').trim()
      const deepLinkPath = toPath(p?.productUrl ?? p?.webURL ?? p?.url)
      if (!productId || !title || !deepLinkPath) continue

      // Image: first image's largest reasonable variant.
      let imageUrl: string | null = null
      const variants = p?.images?.[0]?.variants
      if (Array.isArray(variants) && variants.length) {
        const usable = variants
          .filter((v: any) => typeof v?.url === 'string')
          .sort((a: any, b: any) => (Number(a?.width) || 0) - (Number(b?.width) || 0))
        // Prefer the largest variant <= 720px wide, else the largest available.
        const pick =
          usable.filter((v: any) => (Number(v?.width) || 0) <= 720).pop() ?? usable[usable.length - 1]
        imageUrl = pick?.url ?? null
      }

      const durMin =
        num(p?.duration?.fixedDurationInMinutes) ??
        num(p?.duration?.variableDurationFromMinutes) ??
        null

      items.push({
        provider: 'viator',
        productId,
        title,
        imageUrl,
        imageCredit: null, // Viator image licence covers partner display; no credit line.
        rating: num(p?.reviews?.combinedAverageRating),
        reviewCount: num(p?.reviews?.totalReviews),
        priceAmount: num(p?.pricing?.summary?.fromPrice ?? p?.pricing?.summary?.fromPriceBeforeDiscount),
        priceCurrency: 'USD',
        durationLabel: minutesToLabel(durMin),
        deepLinkPath,
      })
    }

    return rankAndCap(items)
  } catch (e) {
    log('viator', (e as Error)?.message ?? 'fetch failed')
    return []
  }
}

// ── Tiqets ────────────────────────────────────────────────────────────────────
// Tiqets partner API product search near coordinates.
// ASSUMPTION (verify against real responses): endpoint /v2/products with
// coordinates + radius, header `Authorization: Token <token>`; response shape
// { products: [ { id, title, product_url, ratings:{average,count},
//   price:{amount,currency} | min_price, images:[{large|medium|small}] | image_url } ] }.
// Prices are EUR. If image access is not enabled on our token tier, imageUrl is null
// and we still return the product.
export async function fetchTiqetsExperiences(
  lat: number | null,
  lng: number | null,
  _city: string,
): Promise<NormalizedExperience[]> {
  const token = process.env.TIQETS_API_TOKEN
  if (!token) return []
  if (lat == null || lng == null) return []

  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      radius: '25',
      page_size: '20',
    })
    const data = await withRetry(
      () =>
        fetchJson(`https://api.tiqets.com/v2/products?${params.toString()}`, {
          method: 'GET',
          headers: {
            Authorization: `Token ${token}`,
            Accept: 'application/json',
          },
        }),
      { retries: 1 },
    )

    const results: any[] = Array.isArray(data?.products) ? data.products : []

    // TEMP DEBUG (remove after we confirm the real field names): reviewCount is parsing
    // null on every Tiqets product, so log the first product's rating-related fields once.
    if (results.length) {
      const p0 = results[0]
      const probe = {
        rating: p0?.rating,
        ratings: p0?.ratings,
        stars: p0?.stars,
        review_count: p0?.review_count,
        reviews_count: p0?.reviews_count,
        review_score: p0?.review_score,
      }
      log('tiqets:debug', JSON.stringify(probe))
    }

    const items: NormalizedExperience[] = []
    for (const p of results) {
      const productId = String(p?.id ?? p?.product_id ?? '').trim()
      const title = String(p?.title ?? p?.name ?? '').trim()
      const deepLinkPath = toPath(p?.product_url ?? p?.url)
      if (!productId || !title || !deepLinkPath) continue

      const firstImg = p?.images?.[0]
      const img =
        firstImg?.large ??
        firstImg?.medium ??
        firstImg?.small ??
        (typeof firstImg?.url === 'string' ? firstImg.url : null) ??
        (typeof p?.image_url === 'string' ? p.image_url : null)

      // Tiqets image objects may carry a credit/copyright line (licence clause 9.1c) —
      // surface it so the guest UI can render the required attribution caption.
      const creditRaw =
        firstImg?.credit ??
        firstImg?.copyright ??
        firstImg?.attribution ??
        p?.image_credit ??
        null
      const imageCredit =
        typeof creditRaw === 'string' && creditRaw.trim() ? creditRaw.trim().slice(0, 160) : null

      items.push({
        provider: 'tiqets',
        productId,
        title,
        imageUrl: typeof img === 'string' ? img : null,
        imageCredit,
        rating: num(p?.ratings?.average ?? p?.rating),
        reviewCount: num(p?.ratings?.count ?? p?.reviews_count ?? p?.review_count),
        priceAmount: num(p?.price?.amount ?? p?.min_price ?? p?.price),
        priceCurrency: 'EUR',
        durationLabel: null,
        deepLinkPath,
      })
    }

    return rankAndCap(items)
  } catch (e) {
    log('tiqets', (e as Error)?.message ?? 'fetch failed')
    return []
  }
}

// Sort by rating desc, then reviewCount desc; cap to MAX_ITEMS. NEVER by commission.
export function rankAndCap(items: NormalizedExperience[]): NormalizedExperience[] {
  return [...items]
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.reviewCount ?? 0) - (a.reviewCount ?? 0))
    .slice(0, MAX_ITEMS)
}
