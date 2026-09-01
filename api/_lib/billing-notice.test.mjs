// Unit tests for the billing-notice decision (node:test + node:assert only).
// Run with:  npm run test:billing-notice
//
// WHAT THESE PIN, and why this file earns its place: every case here is a STATE TRANSITION at a
// payment processor. Reproducing one against Stripe costs a real card, a real charge and a real
// refund — the 3-D Secure case below was observed exactly once, live, on 1 Sep 2026, and cost
// €10 to see. These assertions are the only cheap way to keep it observed.
//
// THE TWO NEW CASES (a, b) ARE THE FIX. The other six exist to prove the fix did NOT move
// anything else: the notice chain is ordered, and inserting a branch into an ordered chain is
// precisely the edit that silently changes a neighbour.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideNotice } from './billing-notice.ts'

// base is the active/active steady state; paymentIntentStatus is null here because that is
// the shape of every transition that has nothing to do with a first charge. Each test that
// cares sets it explicitly.
const base = { stripeStatus: 'active', effectiveNewStatus: 'active', oldStatus: 'active', hadSubscription: true, isNewSubscription: false, paymentIntentStatus: null, tier: 1, oldTier: 1 }
const decide = over => decideNotice({ ...base, ...over })

test('a. first payment mid-3DS (trial -> incomplete on a NEW sub id) sends NO host notice', () => {
  const r = decide({ stripeStatus: 'incomplete', effectiveNewStatus: 'grace', oldStatus: 'trial', hadSubscription: false, isNewSubscription: true, paymentIntentStatus: 'requires_action' })
  assert.equal(r.notice, null)
  // The operator must still see it — suppressing the HOST contact is not suppressing the event.
  assert.equal(r.pendingAuthentication, true)
})

test('b. grace -> active is a recovery', () => {
  // hadSubscription is TRUE here on purpose: by the time the recovery event arrives, the
  // preceding `incomplete` event has already written stripe_subscription_id to the host row.
  // This is the real shape of the live transition, not a convenient one.
  const r = decide({ stripeStatus: 'active', effectiveNewStatus: 'active', oldStatus: 'grace' })
  assert.equal(r.notice, 'recovered')
  assert.equal(r.pendingAuthentication, false)
})

test('c. trial -> active with no sub id is still started (card without 3DS)', () => {
  const r = decide({ effectiveNewStatus: 'active', oldStatus: 'trial', hadSubscription: false })
  assert.equal(r.notice, 'started')
})

test('d. expired -> active is still started (re-subscribe)', () => {
  const r = decide({ effectiveNewStatus: 'active', oldStatus: 'expired' })
  assert.equal(r.notice, 'started')
})

test('e. active -> past_due is still grace (a REAL bounce, not an authentication step)', () => {
  const r = decide({ stripeStatus: 'past_due', effectiveNewStatus: 'grace', oldStatus: 'active' })
  assert.equal(r.notice, 'grace')
  assert.equal(r.pendingAuthentication, false)
})

test('f. active T1 -> active T2 is still upgraded', () => {
  const r = decide({ tier: 2, oldTier: 1 })
  assert.equal(r.notice, 'upgraded')
})

test('g. active -> canceled is still cancelled', () => {
  const r = decide({ stripeStatus: 'canceled', effectiveNewStatus: 'expired', oldStatus: 'active' })
  assert.equal(r.notice, 'cancelled')
})

test('i. RE-SUBSCRIBER mid-3DS (expired -> incomplete, DIFFERENT sub id) sends NO host notice', () => {
  // The case `!hadSubscription` would have missed: hosts.stripe_subscription_id is never
  // cleared on cancel or expiry, so a returning host still "has" one. Existence was the wrong
  // question; identity is the right one. Without this the fix silently fails for exactly the
  // hosts most likely to hit it.
  const r = decide({ stripeStatus: 'incomplete', effectiveNewStatus: 'grace', oldStatus: 'expired', hadSubscription: true, isNewSubscription: true })
  assert.equal(r.notice, null)
  assert.equal(r.pendingAuthentication, true)
})

test('h. grace(incomplete) -> incomplete_expired is cancelled — ACCEPTED RESIDUAL', () => {
  // A host who abandons the bank's 3-D Secure screen receives a cancellation email for a
  // subscription that never started. Recorded as an accepted residual rather than fixed: this
  // branch cannot tell it apart from a genuine cancellation without more state than the webhook
  // carries, and suppressing a real cancellation is the worse failure.
  const r = decide({ stripeStatus: 'incomplete_expired', effectiveNewStatus: 'expired', oldStatus: 'grace', hadSubscription: false, isNewSubscription: true })
  assert.equal(r.notice, 'cancelled')
})

test('the incomplete exclusion is scoped to a NEW subscription only (renewal on the SAME sub id still warns)', () => {
  // A renewal going `incomplete` on the SAME subscription is a real payment problem on a card
  // that used to work, and must still notify. This is the assertion that stops the fix being
  // widened into "never warn on incomplete".
  const r = decide({ stripeStatus: 'incomplete', effectiveNewStatus: 'grace', oldStatus: 'active', hadSubscription: true, isNewSubscription: false })
  assert.equal(r.notice, 'grace')
  assert.equal(r.pendingAuthentication, false)
})

test('f. a DECLINED first charge NOTIFIES — requires_payment_method is the positive signal', () => {
  // Item (f). Same subscription status as the 3DS case and the same isNewSubscription; ONLY the
  // payment intent separates them. Without this the host hears nothing until the eventual
  // cancellation email.
  const r = decide({ stripeStatus: 'incomplete', effectiveNewStatus: 'grace', oldStatus: 'trial', hadSubscription: false, isNewSubscription: true, paymentIntentStatus: 'requires_payment_method' })
  assert.equal(r.notice, 'grace')
  assert.equal(r.pendingAuthentication, false)
})

test('f. THE FAIL-SAFE CASE — a missing payment-intent status suppresses, never notifies', () => {
  // THE ASSERTION THAT PINS THE INVERSION. The obvious scoping ("suppress iff requires_action")
  // would notify here, resurrecting the (a) defect and telling a host mid-3DS that their payment
  // FAILED — the worse and more frequent failure, since most EU cards hit 3DS. A null status
  // means the intent was absent, unexpanded, or a bare id string; it is NOT evidence of a
  // decline. If someone "tidies" the condition into the literal form, this test fails.
  const r = decide({ stripeStatus: 'incomplete', effectiveNewStatus: 'grace', oldStatus: 'trial', hadSubscription: false, isNewSubscription: true, paymentIntentStatus: null })
  assert.equal(r.notice, null)
  assert.equal(r.pendingAuthentication, true)
})

test('f. a declined RENEWAL is unchanged — the SAME sub id always notifies, whatever the PI says', () => {
  // The suppression never applied to renewals, and (f) must not accidentally extend it there.
  // Asserted for both PI statuses so the renewal path is provably independent of the new input.
  for (const paymentIntentStatus of ['requires_payment_method', 'requires_action', null]) {
    const r = decide({ stripeStatus: 'incomplete', effectiveNewStatus: 'grace', oldStatus: 'active', hadSubscription: true, isNewSubscription: false, paymentIntentStatus })
    assert.equal(r.notice, 'grace')
    assert.equal(r.pendingAuthentication, false)
  }
})

test('grace -> active WITH a tier change is a recovery, not an upgrade (the ordering claim)', () => {
  // Pins the one intentional delta on a pre-existing case, and is the only assertion that would
  // catch someone "tidying" the chain by moving the recovered branch below the tier branch.
  const r = decide({ effectiveNewStatus: 'active', oldStatus: 'grace', tier: 2, oldTier: 1 })
  assert.equal(r.notice, 'recovered')
})

test('grace -> active with NO sub id on file is still started (started keeps its exact reach)', () => {
  // The prose claim that 'recovered' sits AFTER 'started' deliberately — asserted, not narrated.
  const r = decide({ effectiveNewStatus: 'active', oldStatus: 'grace', hadSubscription: false })
  assert.equal(r.notice, 'started')
})
