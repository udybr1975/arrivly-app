// Unit tests for the pure duplicate-subscription guard (no test framework — node:test +
// node:assert only). Run with:  npm run test:stripe
//
// The `--import ./api/_lib/_ts-resolve.mjs` in that script lets Node load the `.ts` source
// through the repo's `.js` import convention.
//
// WHY THIS FILE EXISTS: `findBlockingSubscription` is the only thing standing between a host and
// a SECOND concurrent Stripe subscription on the same customer — the defect that was verified in
// production, where one host accumulated six subscription ids and a superseded one kept billing
// and silently reactivated a cancelled account. It is also the only enforcement point for the
// Anna's Stays isolation boundary on this path. Both directions are load-bearing:
//   too permissive → double billing a real customer, undoable only by manual Stripe surgery;
//   too strict     → a host permanently locked out of ever subscribing (see the `incomplete` case).
// The assertions ARE the contract. KEEP THEM GREEN.
//
// Note the guard is deliberately tested with plain object literals, not SDK fixtures — that is
// exactly why `SubscriptionLike` is a minimal structural type rather than `Stripe.Subscription`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findBlockingSubscription, ARRIVLY_STRIPE_METADATA } from './stripe.ts'

// Build a subscription carrying Bemgu's own metadata. `app` is spread from the SHARED constant,
// never hardcoded here — a test that hardcoded 'arrivly' would keep passing if the constant were
// ever changed, which is the one drift this file must not sleep through.
const arrivlySub = (id, status, extraMetadata = {}) => ({
  id,
  status,
  metadata: { ...ARRIVLY_STRIPE_METADATA, host_id: 'host-1', ...extraMetadata },
})

test("the metadata literal is byte-coupled to LIVE Stripe data — do not rename it", () => {
  // THE ONE ASSERTION THAT DOES NOT TEST THE FUNCTION, and the most valuable one here. Every
  // other test derives `app` from the constant, so renaming it to 'bemgu' would leave this whole
  // suite green — while every subscription ALREADY IN STRIPE still carries 'arrivly' and would
  // instantly become invisible to this guard, to the webhook's `metadata.app` filter, and to
  // change-plan's. Given the standing brand-vs-codename pressure on this exact identifier, that
  // rename is a live risk rather than a theoretical one. Renaming it requires migrating existing
  // Stripe metadata first; changing this line alone is the outage.
  assert.equal(ARRIVLY_STRIPE_METADATA.app, 'arrivly')
})

test('active subscription BLOCKS with reason exists', () => {
  const result = findBlockingSubscription([arrivlySub('sub_active', 'active')])
  assert.equal(result?.reason, 'exists')
  assert.equal(result?.subscription.id, 'sub_active')
})

test('trialing subscription BLOCKS with reason exists', () => {
  const result = findBlockingSubscription([arrivlySub('sub_trial', 'trialing')])
  assert.equal(result?.reason, 'exists')
  assert.equal(result?.subscription.id, 'sub_trial')
})

test('past_due / unpaid / paused BLOCK with reason needs_payment', () => {
  for (const status of ['past_due', 'unpaid', 'paused']) {
    const result = findBlockingSubscription([arrivlySub(`sub_${status}`, status)])
    assert.equal(result?.reason, 'needs_payment', `${status} must yield needs_payment`)
    assert.equal(result?.subscription.id, `sub_${status}`)
  }
})

test('canceled does NOT block', () => {
  assert.equal(findBlockingSubscription([arrivlySub('sub_gone', 'canceled')]), null)
})

test('incomplete and incomplete_expired do NOT block', () => {
  // THE LOCK-OUT CASE, and the reason it is spelled out: `incomplete` is an abandoned Checkout
  // that expires on its own within 24h. If it blocked, a host's own abandoned attempt would
  // refuse every retry and they could never subscribe at all.
  assert.equal(findBlockingSubscription([arrivlySub('sub_inc', 'incomplete')]), null)
  assert.equal(findBlockingSubscription([arrivlySub('sub_inc_exp', 'incomplete_expired')]), null)
})

test("ANNA'S STAYS ISOLATION — a non-Arrivly ACTIVE subscription does not block", () => {
  // The same Stripe account holds Anna's Stays. A Bemgu host who is also an Anna's Stays customer
  // must not be refused a subscription because of an unrelated product.
  const foreign = [
    { id: 'sub_annas', status: 'active', metadata: { app: 'annas-stays' } },
    { id: 'sub_no_meta', status: 'active', metadata: {} },
    { id: 'sub_null_meta', status: 'active', metadata: null },
    { id: 'sub_undef_meta', status: 'active' },
  ]
  assert.equal(findBlockingSubscription(foreign), null)
  // Metadata matching is EXACT — Stripe metadata is case-sensitive, as the webhook's own
  // `metadata.app` filter already depends on.
  assert.equal(findBlockingSubscription([{ id: 'sub_case', status: 'active', metadata: { app: 'Arrivly' } }]), null)
})

test('mixed input PREFERS exists over needs_payment', () => {
  // Order-independent: the needs_payment one is seen FIRST here, so a naive first-match-wins
  // implementation would return it and send the host to fix a card on a subscription they are
  // about to supersede.
  const result = findBlockingSubscription([
    arrivlySub('sub_broken', 'past_due'),
    arrivlySub('sub_live', 'active'),
  ])
  assert.equal(result?.reason, 'exists')
  assert.equal(result?.subscription.id, 'sub_live')
})

test('mixed input returns needs_payment when nothing is live', () => {
  const result = findBlockingSubscription([
    arrivlySub('sub_gone', 'canceled'),
    arrivlySub('sub_broken', 'past_due'),
    arrivlySub('sub_inc', 'incomplete'),
  ])
  assert.equal(result?.reason, 'needs_payment')
  assert.equal(result?.subscription.id, 'sub_broken')
})

test('a live Arrivly subscription still blocks when Anna\'s Stays rows are mixed in', () => {
  // Isolation must not become a blind spot: filtering out foreign rows must not filter out ours.
  const result = findBlockingSubscription([
    { id: 'sub_annas', status: 'active', metadata: { app: 'annas-stays' } },
    arrivlySub('sub_live', 'active'),
  ])
  assert.equal(result?.reason, 'exists')
  assert.equal(result?.subscription.id, 'sub_live')
})

test('an UNRECOGNISED status does not block — the documented residual, now pinned', () => {
  // Turns a prose claim in the helper's doc comment into a checked one. The five handled sets
  // cover all eight Stripe statuses today, so this is unreachable in practice — but if Stripe
  // ever adds a status meaning "live and billing", this test failing is NOT the signal (it will
  // still pass); the doc comment is. Recorded here so the fall-through direction is at least
  // deliberate and visible rather than incidental.
  assert.equal(findBlockingSubscription([arrivlySub('sub_future', 'some_future_status')]), null)
})

test('empty, null and malformed input never block and never throw', () => {
  // The caller passes `list.data` straight through; a defensive null must not become a 500 on a
  // path whose whole job is to refuse safely.
  assert.equal(findBlockingSubscription([]), null)
  assert.equal(findBlockingSubscription(null), null)
  assert.equal(findBlockingSubscription(undefined), null)
  assert.equal(findBlockingSubscription('not-an-array'), null)
  assert.equal(findBlockingSubscription([null, undefined, {}, { id: 5, status: 'active' }]), null)
  // A non-string status on an otherwise Arrivly-shaped row is skipped, not coerced.
  assert.equal(
    findBlockingSubscription([{ id: 'sub_x', status: null, metadata: { ...ARRIVLY_STRIPE_METADATA } }]),
    null,
  )
})
