// Unit tests for the pure affiliate link-builder (no test framework — node:test +
// node:assert only). Run with:  npm run test:affiliate-links
//
// The `--import ./api/_lib/_ts-resolve.mjs` in that script lets Node load the `.ts`
// source through the repo's `.js` import convention.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildExperienceLink,
  buildGygCityLink,
  resolvePartnerId,
} from './affiliate-links.ts'
import {
  BEMGU_VIATOR_PID,
  BEMGU_TIQETS_PARTNER_ID,
  BEMGU_GYG_PARTNER_ID,
  VIATOR_MCID,
} from './affiliate-config.ts'

const APT = '11111111-2222-3333-4444-555555555555'
const CAMPAIGN = `bemgu-${APT}`

// Count how many times a query param key appears (duplication guard).
function count(url, key) {
  return [...new URL(url).searchParams.keys()].filter((k) => k === key).length
}

test('viator: rewrites a pre-tagged API url without duplicating params', () => {
  const pre = `https://www.viator.com/tours/Paris/x?mcid=${VIATOR_MCID}&pid=${BEMGU_VIATOR_PID}&medium=api&api_version=2.0`
  const out = buildExperienceLink({ provider: 'viator', deepLinkPath: pre, apartmentId: APT, hostTier: 1, hostPartnerIds: null })
  const u = new URL(out)
  assert.equal(count(out, 'pid'), 1)
  assert.equal(count(out, 'mcid'), 1)
  assert.equal(count(out, 'medium'), 1)
  assert.equal(u.searchParams.get('pid'), BEMGU_VIATOR_PID)
  assert.equal(u.searchParams.get('mcid'), VIATOR_MCID)
  assert.equal(u.searchParams.get('campaign'), CAMPAIGN)
  // API-supplied medium is preserved (not overwritten with medium=link).
  assert.equal(u.searchParams.get('medium'), 'api')
  assert.equal(u.searchParams.get('api_version'), '2.0')
})

test('viator: adds medium=link only when absent', () => {
  const out = buildExperienceLink({ provider: 'viator', deepLinkPath: '/tours/x', apartmentId: APT, hostTier: 1, hostPartnerIds: null })
  assert.equal(new URL(out).searchParams.get('medium'), 'link')
})

test('viator: a tier-3 host id is IGNORED — Bemgu pid and mcid always ride', () => {
  // INVERTED 11 Aug 2026. This test previously asserted the host id REPLACED Bemgu's pid, which
  // Viator Partner Support ruled in writing (4 Aug 2026) is PROHIBITED: links are served from
  // bemgu.app, and the VPP General Terms define "Partner Site" as a property the registered
  // partner owns/operates/maintains, while Service Terms B-1.5 forbids display of Links through
  // any other channel. Do NOT "fix" this back — the assertions below ARE the compliance boundary.
  const pre = `https://www.viator.com/tours/x?pid=${BEMGU_VIATOR_PID}&mcid=${VIATOR_MCID}&medium=api`
  const out = buildExperienceLink({
    provider: 'viator', deepLinkPath: pre, apartmentId: APT, hostTier: 3,
    hostPartnerIds: { viator: 'P99999999', gyg: null, tiqets: null },
  })
  assert.equal(count(out, 'pid'), 1)
  assert.equal(new URL(out).searchParams.get('pid'), BEMGU_VIATOR_PID, 'Viator must carry BEMGU pid')
  assert.ok(!out.includes('P99999999'), 'a stored host Viator id must never reach the link')
  // mcid rides because this is a Bemgu link — the stale-id inconsistency the derived
  // `usingHostId` exists to prevent would have stripped it.
  assert.equal(new URL(out).searchParams.get('mcid'), VIATOR_MCID, 'Bemgu mcid must ride')
})

test('viator: resolvePartnerId ignores a host id at every tier', () => {
  for (const tier of [1, 2, 3, 4]) {
    assert.equal(
      resolvePartnerId('viator', tier, { viator: 'P99999999', gyg: null, tiqets: null }),
      BEMGU_VIATOR_PID,
      `tier ${tier} must resolve to Bemgu's Viator pid`,
    )
  }
})

test('tiqets: rewrites a pre-tagged partner param, adds tq_campaign, no dupes', () => {
  const pre = `https://www.tiqets.com/en/paris-x-p123456/?partner=${BEMGU_TIQETS_PARTNER_ID}`
  const out = buildExperienceLink({ provider: 'tiqets', deepLinkPath: pre, apartmentId: APT, hostTier: 1, hostPartnerIds: null })
  const u = new URL(out)
  assert.equal(count(out, 'partner'), 1)
  assert.equal(u.searchParams.get('partner'), BEMGU_TIQETS_PARTNER_ID)
  assert.equal(u.searchParams.get('tq_campaign'), CAMPAIGN)
})

test('tiqets: tier-3 host id replaces embedded Bemgu partner', () => {
  const pre = `https://www.tiqets.com/x/?partner=${BEMGU_TIQETS_PARTNER_ID}`
  const out = buildExperienceLink({
    provider: 'tiqets', deepLinkPath: pre, apartmentId: APT, hostTier: 3,
    hostPartnerIds: { viator: null, gyg: null, tiqets: 'host-777' },
  })
  assert.equal(new URL(out).searchParams.get('partner'), 'host-777')
  assert.ok(!out.includes(BEMGU_TIQETS_PARTNER_ID))
})

test('gyg city link: mandatory partner_id + cmp, no dupes', () => {
  const out = buildGygCityLink('Barcelona', APT, BEMGU_GYG_PARTNER_ID)
  const u = new URL(out)
  assert.equal(count(out, 'partner_id'), 1)
  assert.equal(count(out, 'cmp'), 1)
  assert.equal(u.searchParams.get('partner_id'), BEMGU_GYG_PARTNER_ID)
  assert.equal(u.searchParams.get('cmp'), CAMPAIGN)
  assert.equal(u.searchParams.get('q'), 'Barcelona')
})

test('resolvePartnerId: below gate always Bemgu, even with a host id set', () => {
  assert.equal(resolvePartnerId('viator', 2, { viator: 'P99999999', gyg: null, tiqets: null }), BEMGU_VIATOR_PID)
})

test('resolvePartnerId: at gate falls back to Bemgu when host id blank', () => {
  assert.equal(resolvePartnerId('viator', 3, { viator: '   ', gyg: null, tiqets: null }), BEMGU_VIATOR_PID)
})

test('unparseable deep link degrades to a stamped provider homepage (no throw)', () => {
  const out = buildExperienceLink({ provider: 'gyg', deepLinkPath: 'http://', apartmentId: APT, hostTier: 1, hostPartnerIds: null })
  const u = new URL(out)
  assert.equal(u.hostname, 'www.getyourguide.com')
  assert.equal(u.searchParams.get('cmp'), CAMPAIGN)
})
