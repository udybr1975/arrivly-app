// Pure affiliate deep-link builder — no I/O, no env, unit-testable.
//
// Given a provider-site deep-link PATH (no affiliate params) it stamps the correct
// partner id (host's own at tier >= EXPERIENCES_TIER_GATE, else Bemgu's) plus the
// per-apartment campaign tag, and returns the full outbound URL.

import {
  BEMGU_GYG_PARTNER_ID,
  BEMGU_VIATOR_PID,
  VIATOR_MCID,
  BEMGU_TIQETS_PARTNER_ID,
  EXPERIENCES_TIER_GATE,
} from './affiliate-config.js'

export type ExperienceProvider = 'viator' | 'gyg' | 'tiqets'

export interface HostPartnerIds {
  viator: string | null
  gyg: string | null
  tiqets: string | null
}

const BEMGU_IDS: Record<ExperienceProvider, string> = {
  viator: BEMGU_VIATOR_PID,
  gyg: BEMGU_GYG_PARTNER_ID,
  tiqets: BEMGU_TIQETS_PARTNER_ID,
}

// Resolve which partner id the outbound link should carry.
export function resolvePartnerId(
  provider: ExperienceProvider,
  hostTier: number,
  hostPartnerIds: HostPartnerIds | null | undefined,
): string {
  if (hostTier >= EXPERIENCES_TIER_GATE) {
    const own = hostPartnerIds?.[provider]
    if (own && own.trim()) return own.trim()
  }
  return BEMGU_IDS[provider]
}

// Append query params to a base URL, choosing ? or & correctly if the base already
// carries a query string. Everything is URL-encoded.
function appendParams(base: string, params: Record<string, string>): string {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  if (!qs) return base
  return base + (base.includes('?') ? '&' : '?') + qs
}

// Normalise a provider deep-link path onto a provider origin. `deepLinkPath` is
// expected to be a site-relative path ("/tours/..."); if a full URL slips through we
// use it as-is so we never double-prefix an origin.
function onOrigin(origin: string, deepLinkPath: string): string {
  const p = (deepLinkPath || '').trim()
  if (/^https?:\/\//i.test(p)) return p
  return origin + (p.startsWith('/') ? p : `/${p}`)
}

/**
 * Build the outbound, affiliate-stamped booking link for a single experience.
 * The campaign tag is MANDATORY on GYG (links without it fall into GYG's
 * "no_reseller_campaign" bucket) and on Viator.
 */
export function buildExperienceLink(args: {
  provider: ExperienceProvider
  deepLinkPath: string
  apartmentId: string
  hostTier: number
  hostPartnerIds: HostPartnerIds | null | undefined
}): string {
  const { provider, deepLinkPath, apartmentId, hostTier, hostPartnerIds } = args
  const partnerId = resolvePartnerId(provider, hostTier, hostPartnerIds)
  const campaign = `bemgu-${apartmentId}`

  if (provider === 'viator') {
    // All four params are MANDATORY for attribution.
    return appendParams(onOrigin('https://www.viator.com', deepLinkPath), {
      pid: partnerId,
      mcid: VIATOR_MCID,
      medium: 'link',
      campaign,
    })
  }

  if (provider === 'gyg') {
    // cmp is MANDATORY — a missing campaign lands in GYG's no_reseller_campaign bucket.
    return appendParams(onOrigin('https://www.getyourguide.com', deepLinkPath), {
      partner_id: partnerId,
      cmp: campaign,
    })
  }

  // tiqets
  // TODO: campaign param pending answer from affiliates@tiqets.com — do not invent one.
  return appendParams(onOrigin('https://www.tiqets.com', deepLinkPath), {
    partner: partnerId,
  })
}

/**
 * Build the GetYourGuide "See more" city link (search page for the city), stamped
 * with the resolved partner id + mandatory campaign tag. `partnerId` is passed in
 * already-resolved (the endpoint resolves it via resolvePartnerId).
 */
export function buildGygCityLink(city: string, apartmentId: string, partnerId: string): string {
  const base = `https://www.getyourguide.com/s/?q=${encodeURIComponent(city)}`
  return appendParams(base, {
    partner_id: partnerId,
    cmp: `bemgu-${apartmentId}`,
  })
}
