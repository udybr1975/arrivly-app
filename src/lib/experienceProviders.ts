// Front-end metadata for the three experience marketplaces (Earnings + Connect surfaces).
// Everything here is presentation copy + PUBLIC links; NO secrets. Partner IDs are plain
// identifiers (validated below), never URLs.

export type ProviderKey = 'viator' | 'gyg' | 'tiqets'

export interface ProviderMeta {
  key: ProviderKey
  label: string
  // The hosts column that stores this provider's partner id.
  column: 'viator_partner_id' | 'gyg_partner_id' | 'tiqets_partner_id'
  // Where a host applies to the affiliate programme.
  applyUrl: string
  // Where a host reads their real bookings/commission (we don't ingest these yet).
  portalUrl: string
  // Guidance for locating the partner id inside that provider's portal.
  findIdCopy: string
  placeholder: string
  // Hard block (Viator's format is known) vs warn-only (GYG/Tiqets formats unverified).
  hardValidate: boolean
}

export const EXPERIENCE_PROVIDERS: ProviderMeta[] = [
  {
    key: 'viator',
    label: 'Viator',
    column: 'viator_partner_id',
    applyUrl: 'https://www.viator.com/partner/affiliate/',
    portalUrl: 'https://www.partner.viator.com/',
    findIdCopy:
      'In your Viator partner dashboard it appears at the top right of every page — a “P” followed by 8 digits.',
    placeholder: 'P01234567',
    hardValidate: true,
  },
  {
    key: 'gyg',
    label: 'GetYourGuide',
    column: 'gyg_partner_id',
    applyUrl: 'https://partner.getyourguide.com/',
    portalUrl: 'https://partner.getyourguide.com/',
    findIdCopy:
      'Sign in to the GetYourGuide partner portal — your partner ID is shown in your profile / account settings.',
    placeholder: 'ABC1234',
    hardValidate: false,
  },
  {
    key: 'tiqets',
    label: 'Tiqets',
    column: 'tiqets_partner_id',
    applyUrl: 'https://www.tiqets.com/en/partners/',
    portalUrl: 'https://www.tiqets.com/en/partners/',
    findIdCopy:
      'Sign in to the Tiqets partner portal — your partner ID is listed in your account / affiliate settings.',
    placeholder: 'your-partner-id',
    hardValidate: false,
  },
]

export const VIATOR_ID_RE = /^P\d{8}$/

// Normalise a pasted partner id before validation/save. Viator ids are uppercased.
export function normalizePartnerId(key: ProviderKey, raw: string): string {
  const trimmed = raw.trim()
  return key === 'viator' ? trimmed.toUpperCase() : trimmed
}

export type ValidationResult = { ok: true } | { ok: false; hard: boolean; message: string }

// Validate a normalised id. Viator format is a hard block; the others are warn-only
// (non-empty, <= 64 chars) because their exact formats are unverified.
export function validatePartnerId(key: ProviderKey, normalized: string): ValidationResult {
  if (!normalized) return { ok: false, hard: true, message: 'Enter your partner ID.' }
  if (normalized.length > 64) return { ok: false, hard: true, message: 'That ID looks too long — please check it.' }
  if (key === 'viator' && !VIATOR_ID_RE.test(normalized)) {
    return { ok: false, hard: true, message: 'Viator IDs look like “P” followed by 8 digits (e.g. P01234567).' }
  }
  return { ok: true }
}
