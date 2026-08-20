// Shared apartment_details category taxonomy — the single source of truth for both
// the host editor (PropertySetup) and the guest page (GuestPage), plus the AI
// bulk-import validator in api/bulk-import.ts.
//
// DEPENDENCY-FREE ON PURPOSE (zero imports — no React, no import.meta.env, no
// src/config.ts). It is consumed from an api/ serverless function running as native
// Node ESM, so anything browser-only or env-dependent would break it at Lambda
// startup. Same precedent as src/guide/content.ts.
//
// WHY IT EXISTS: the guest page matches categories by case-insensitive REGEX while
// the host page used to load and delete them by EXACT STRING. A row the guest page
// rendered but the host page could not see survived the host's save and the guest
// then saw the section twice. Both sides now share these predicates, so the host
// delete uses the same test as the guest read — except for house rules, where the host
// additionally excludes private rows because that save re-publishes as is_private:false.

/**
 * The eight free-form "extras" categories. Exact-match, case-sensitive — see isExtrasCategory.
 * FROZEN because this array gates AI output in api/bulk-import.ts and is now shared between the
 * browser bundle and a warm Lambda; the freeze makes a stray push THROW rather than widen that
 * gate (the `string[]` cast erases readonly, so TypeScript alone would not catch one).
 * Object.freeze, NOT `as const` — a readonly literal tuple's `.includes(someString)` would fail
 * to compile at the src/ call sites, which (unlike api/) are typechecked by `npm run build`.
 */
// ORDER IS DISPLAY ORDER on the guest page, which maps over this array rather than over the
// rows — so 'During your stay' is FIRST deliberately: hospitality renders before utilities.
// (The host editor did NOT honour this until 38c1c40's successor sorted its rows by this same
// index — it rendered in unspecified DB order. Verified, not assumed.)
export const EXTRAS_CATEGORIES: string[] = Object.freeze(['During your stay', 'Parking', 'Recycling & Bins', 'Appliances', 'Transport', 'Amenities', 'Safety', 'Good to know']) as string[]

/** Canonical labels every WRITE must use, so stored data converges on one spelling. */
export const DETAIL_CATEGORY = {
  WIFI: 'WiFi',
  CHECKIN: 'Check-in',
  RULES: 'House Rules',
} as const

// The three regexes below are the ones GuestPage has always used to READ. They are
// deliberately permissive: a read must never hide live guest content. Note they are
// NOT disjoint in general — e.g. 'House entry rules' matches both isRulesCategory and
// isCheckinCategory. They ARE mutually exclusive across the eleven categories that exist
// today, which detail-categories.test.mjs asserts.

/** True for any category the guest page renders as house rules. */
export function isRulesCategory(category: string | null | undefined): boolean {
  return /rule|house|policy|policies|guidelines/i.test(category ?? '')
}

/** True for any category the guest page renders as WiFi. */
export function isWifiCategory(category: string | null | undefined): boolean {
  return /wifi|wi-fi|internet|wireless/i.test(category ?? '')
}

/** True for any category the guest page renders as check-in info. */
export function isCheckinCategory(category: string | null | undefined): boolean {
  return /check.?in|check.?out|timing|door|code|entry/i.test(category ?? '')
}

/**
 * Exact, CASE-SENSITIVE membership in EXTRAS_CATEGORIES.
 * Do NOT loosen this: api/bulk-import.ts validates AI output against it, and it is
 * the only gate stopping a hallucinated category from being written.
 */
export function isExtrasCategory(category: string | null | undefined): boolean {
  return typeof category === 'string' && EXTRAS_CATEGORIES.includes(category)
}
