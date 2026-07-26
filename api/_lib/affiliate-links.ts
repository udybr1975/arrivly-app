// Pure affiliate deep-link builder — no I/O, no env, unit-testable.
//
// Provider APIs return product URLs that are ALREADY affiliate-tagged with Bemgu's own
// ids (Viator: ?mcid=&pid=&medium=api&api_version=; Tiqets: ?partner=). We therefore
// PARSE-AND-REWRITE the URL (URLSearchParams.set) rather than blindly appending — so we
// never emit a link with two different pid/partner values or conflicting medium params.
//
// The c-full-critical consequence: for a tier >= EXPERIENCES_TIER_GATE host that has
// connected their OWN partner id, .set() REPLACES the embedded Bemgu id, so the outbound
// link carries ONLY the host's id and the marketplace pays the host directly.

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

const PROVIDER_ORIGIN: Record<ExperienceProvider, string> = {
  viator: 'https://www.viator.com',
  gyg: 'https://www.getyourguide.com',
  tiqets: 'https://www.tiqets.com',
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

// Parse a provider deep-link (full URL or site-relative path) onto the provider origin.
// Returns a URL object ready for searchParam rewriting. Falls back to the provider
// homepage if the input is unparseable, so we never emit a malformed link.
function parseOnOrigin(provider: ExperienceProvider, deepLink: string): URL {
  const origin = PROVIDER_ORIGIN[provider]
  const raw = (deepLink || '').trim()
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw)
    return new URL(raw.startsWith('/') ? raw : `/${raw}`, origin)
  } catch {
    return new URL(origin)
  }
}

/**
 * Build the outbound, affiliate-stamped booking link for a single experience.
 * Managed params are SET (replacing any value already embedded by the provider API),
 * so the link never carries a duplicated/conflicting id. The campaign tag is MANDATORY
 * on GYG (links without it fall into GYG's "no_reseller_campaign" bucket) and on Viator.
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
  // True when we resolved to the HOST's own partner id (not Bemgu's fallback).
  const usingHostId =
    hostTier >= EXPERIENCES_TIER_GATE && !!hostPartnerIds?.[provider]?.trim()
  const campaign = `bemgu-${apartmentId}`
  const url = parseOnOrigin(provider, deepLinkPath)

  if (provider === 'viator') {
    url.searchParams.set('pid', partnerId)
    // mcid (VIATOR_MCID) is BEMGU's channel id — it must never ride on a host-owned link.
    // On a host link, strip any mcid embedded by the API (which called with Bemgu's account);
    // on a Bemgu link, stamp Bemgu's mcid.
    if (usingHostId) url.searchParams.delete('mcid')
    else url.searchParams.set('mcid', VIATOR_MCID)
    url.searchParams.set('campaign', campaign)
    // Keep an API-supplied medium (e.g. medium=api) as-is; only stamp one when absent.
    if (!url.searchParams.has('medium')) url.searchParams.set('medium', 'link')
    // api_version (if present) is left untouched.
    return url.toString()
  }

  if (provider === 'gyg') {
    url.searchParams.set('partner_id', partnerId)
    url.searchParams.set('cmp', campaign)
    return url.toString()
  }

  // tiqets — tq_campaign surfaces as campaign_name in Tiqets partner reporting.
  url.searchParams.set('partner', partnerId)
  url.searchParams.set('tq_campaign', campaign)
  return url.toString()
}

/**
 * Build the GetYourGuide "See more" city link (search page for the city), stamped
 * with the resolved partner id + mandatory campaign tag. `partnerId` is passed in
 * already-resolved (the endpoint resolves it via resolvePartnerId).
 */
export function buildGygCityLink(city: string, apartmentId: string, partnerId: string): string {
  const url = new URL('https://www.getyourguide.com/s/')
  url.searchParams.set('q', city)
  url.searchParams.set('partner_id', partnerId)
  url.searchParams.set('cmp', `bemgu-${apartmentId}`)
  return url.toString()
}
