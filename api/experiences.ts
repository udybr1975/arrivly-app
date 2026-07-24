import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import {
  fetchViatorExperiences,
  fetchTiqetsExperiences,
  rankAndCap,
  type NormalizedExperience,
} from './_lib/experiences-providers.js'
import {
  buildExperienceLink,
  buildGygCityLink,
  resolvePartnerId,
  type HostPartnerIds,
} from './_lib/affiliate-links.js'

// PUBLIC guest read path for bookable experiences. Cache-first — ~all guests hit a DB
// read only. The ONLY way to trigger a provider API call is to be the first caller for
// an apartment whose cache is missing/stale (lazy fill), and that path is rate-limited.
// The daily cron pre-fills the cache for apartments with current/upcoming bookings.
//
// Experience PRODUCT DATA is cached (7 days). Outbound affiliate LINKS are built AT
// SERVE TIME from the host's live tier + partner ids, so a host connecting their own
// partner id takes effect immediately with no cache invalidation. Experience data is
// not sensitive (matches the city-events posture) — no token verification — but the
// lazy-fill path is rate-limited to protect the provider quotas.

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CACHED_PROVIDERS = ['viator', 'tiqets'] as const
type CachedProvider = (typeof CACHED_PROVIDERS)[number]

// Best-effort per-instance limiter — backstop on the provider-API (lazy-fill) path
// only. Cached reads (the hot path) are never limited. Keyed by apartmentId+IP.
const RL_MAX = 5
const RL_WINDOW_MS = 60_000
const RL_MAX_KEYS = 5000
const rlHits = new Map<string, { count: number; windowStart: number }>()
function rateLimited(key: string, now: number): boolean {
  // Opportunistic bounded-memory sweep: drop expired entries when the map grows large.
  if (rlHits.size > RL_MAX_KEYS) {
    for (const [k, v] of rlHits) {
      if (now - v.windowStart >= RL_WINDOW_MS) rlHits.delete(k)
    }
  }
  const entry = rlHits.get(key)
  if (!entry || now - entry.windowStart >= RL_WINDOW_MS) {
    rlHits.set(key, { count: 1, windowStart: now })
    return false
  }
  entry.count += 1
  return entry.count > RL_MAX
}
function clientIp(req: VercelRequest): string {
  const xff = req.headers['x-forwarded-for']
  const first = Array.isArray(xff) ? xff[0] : xff
  if (first) return first.split(',')[0].trim()
  return req.socket?.remoteAddress ?? 'unknown'
}

async function fetchProvider(
  provider: CachedProvider,
  apt: { city: string; lat: number | null; lng: number | null },
): Promise<NormalizedExperience[]> {
  if (provider === 'viator') return fetchViatorExperiences(apt.lat, apt.lng, apt.city)
  return fetchTiqetsExperiences(apt.lat, apt.lng, apt.city)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { apartmentId } = (req.body ?? {}) as { apartmentId?: string }
  if (!apartmentId || typeof apartmentId !== 'string' || !UUID_RE.test(apartmentId)) {
    return res.status(400).json({ error: 'apartmentId required' })
  }

  // Authoritative apartment + its host tier/partner-ids from DB.
  const { data: apt, error: aptErr } = await supabase
    .from('apartments')
    .select(
      'id, city, country, lat, lng, is_visible, host_id, ' +
        'hosts:host_id ( tier, viator_partner_id, gyg_partner_id, tiqets_partner_id )'
    )
    .eq('id', apartmentId)
    .maybeSingle()

  if (aptErr || !apt || apt.is_visible === false || !apt.city) {
    return res.status(200).json({ experiences: [], gygCityLink: null })
  }

  // Supabase returns a to-one embed as an object (or array under some configs).
  const hostRow: any = Array.isArray((apt as any).hosts) ? (apt as any).hosts[0] : (apt as any).hosts
  const hostTier = Number(hostRow?.tier ?? 1)
  const hostPartnerIds: HostPartnerIds = {
    viator: hostRow?.viator_partner_id ?? null,
    gyg: hostRow?.gyg_partner_id ?? null,
    tiqets: hostRow?.tiqets_partner_id ?? null,
  }

  const aptCore = { city: apt.city as string, lat: apt.lat as number | null, lng: apt.lng as number | null }

  // Read both cache rows.
  const { data: cacheRows } = await supabase
    .from('experiences_cache')
    .select('provider, experiences, expires_at')
    .eq('apartment_id', apartmentId)

  const now = Date.now()
  const cacheByProvider = new Map<CachedProvider, { experiences: NormalizedExperience[]; fresh: boolean }>()
  for (const row of (cacheRows ?? []) as any[]) {
    const provider = row.provider as CachedProvider
    if (!CACHED_PROVIDERS.includes(provider)) continue
    const list = Array.isArray(row.experiences) ? (row.experiences as NormalizedExperience[]) : []
    const fresh = row.expires_at ? new Date(row.expires_at).getTime() > now : false
    cacheByProvider.set(provider, { experiences: list, fresh })
  }

  // Baseline = whatever is cached (fresh OR stale — stale-safe fallback).
  const productsByProvider = new Map<CachedProvider, NormalizedExperience[]>()
  for (const p of CACHED_PROVIDERS) productsByProvider.set(p, cacheByProvider.get(p)?.experiences ?? [])

  const needFetch = CACHED_PROVIDERS.filter((p) => !cacheByProvider.get(p)?.fresh)

  if (needFetch.length) {
    // Only the provider-API path is limited — serve stale/empty baseline if limited.
    if (!rateLimited(`${apartmentId}:${clientIp(req)}`, now)) {
      const fetched = await Promise.all(needFetch.map((p) => fetchProvider(p, aptCore)))
      const stamp = new Date(now).toISOString()
      const expires = new Date(now + CACHE_TTL_MS).toISOString()
      for (let i = 0; i < needFetch.length; i++) {
        const provider = needFetch[i]
        const list = fetched[i]
        // Never cache/serve an empty result as success — keep the stale baseline instead.
        if (list.length > 0) {
          productsByProvider.set(provider, list)
          const { error: upErr } = await supabase
            .from('experiences_cache')
            .upsert(
              { apartment_id: apartmentId, provider, experiences: list, fetched_at: stamp, expires_at: expires },
              { onConflict: 'apartment_id,provider' }
            )
          if (upErr) console.error('[experiences] cache upsert failed —', upErr.message?.slice(0, 120))
        }
      }
    }
  }

  // Merge + rank across providers, then stamp outbound links at serve time.
  const merged = rankAndCap([
    ...(productsByProvider.get('viator') ?? []),
    ...(productsByProvider.get('tiqets') ?? []),
  ])

  const experiences = merged.map((e) => ({
    provider: e.provider,
    productId: e.productId,
    title: e.title,
    imageUrl: e.imageUrl,
    rating: e.rating,
    reviewCount: e.reviewCount,
    priceAmount: e.priceAmount,
    priceCurrency: e.priceCurrency,
    durationLabel: e.durationLabel,
    url: buildExperienceLink({
      provider: e.provider,
      deepLinkPath: e.deepLinkPath,
      apartmentId,
      hostTier,
      hostPartnerIds,
    }),
  }))

  // GYG "See more" city link (link/widget-based — no content API at our access level).
  const gygPartnerId = resolvePartnerId('gyg', hostTier, hostPartnerIds)
  const gygCityLink = buildGygCityLink(apt.city as string, apartmentId, gygPartnerId)

  return res.status(200).json({ experiences, gygCityLink })
}
