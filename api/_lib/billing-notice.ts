// THE BILLING-NOTICE DECISION — extracted from api/stripe-webhook.ts so the transitions are
// testable without Stripe (npm run test:billing-notice). The handler still owns the DB write,
// the one-shot claim and the fan-out; this file owns ONLY "which notice, if any, does this
// transition deserve".
//
// WHY IT IS A PURE FUNCTION AND MUST STAY ONE: every case here is a state TRANSITION, and a
// transition is exactly the thing that is expensive to reproduce against a live payment
// processor. The 3-D Secure case below cost a real €10 charge to observe once.
//
// THE DEFECT THIS FILE EXISTS TO FIX, measured live 1 Sep 2026 across five webhook deliveries:
// a brand-new subscription whose FIRST payment is waiting on the bank's 3-D Secure step arrives
// as Stripe status `incomplete`. mapStatus() maps that to `grace` — which is CORRECT as a stored
// state, the payment genuinely has not settled — but the notice layer then read `grace` and told
// the host their payment had FAILED. ~56 seconds later the same subscription arrived `active`,
// and the grace -> active transition matched no case at all, so the host was never told the
// money went through. A normal EU card produced: one failure email, then silence, after a
// successful charge.
//
// THE SHAPE OF THE FIX — and the reason `stripeStatus` is now an input at all: `grace` is not
// one situation. "The renewal bounced" and "the first payment is mid-authentication" are the
// same STORED status and completely different NEWS. The stored state stays as it was; only the
// message is decided differently, and it takes the raw Stripe status to tell them apart.
// A FIRST payment is identified by `isNewSubscription` — the event's subscription id is not
// the one already on the host row (true when that column is null). It is deliberately NOT
// `!hadSubscription`: `hosts.stripe_subscription_id` is only ever SET and never cleared on
// cancel or expiry, so a host who cancels and re-subscribes still "has" a subscription id and
// would have reproduced the exact defect this file fixes. Identity, not existence, is the
// question. A renewal on the SAME subscription going `incomplete` is NOT excluded and still
// notifies — that one is a real payment problem on a card that used to work.
//
// ITEM (f), 1 Sep 2026 — `incomplete` IS TWO SITUATIONS, AND ONLY ONE OF THEM IS HARMLESS.
// Stripe uses `incomplete` both for "the bank is running a 3-D Secure challenge" and for "the
// first charge was DECLINED". (a) suppressed both, so a declined host heard nothing until the
// eventual cancellation email. The payment intent's own status is what separates them:
// `requires_action` = a challenge in flight, `requires_payment_method` = declined, try another
// card.
//
// THE FAIL-SAFE DIRECTION IS DELIBERATE AND INVERTED FROM THE OBVIOUS READING. We suppress
// unless there is a POSITIVE decline signal — NOT "suppress iff requires_action". The two are
// identical when the payment intent is present and readable, and they differ on every path
// where it is absent, unexpanded, a bare id string, or a status Stripe adds later. On those
// paths the literal scoping would resurrect the (a) defect and tell a host mid-3DS that their
// payment FAILED — the worse failure AND the more frequent one, since most EU cards hit 3DS.
// A missing signal therefore means silence, and only `requires_payment_method` speaks.
// Decided in chat 1 Sep 2026; a reviewer proposing the inverse should be answered with this
// paragraph, not with a code change.
//
// NO NEW NoticeType. A decline reuses `grace`, whose copy ("payment failed / please update your
// card") is simply TRUE for a decline. Adding a union member would walk straight into the
// api/ <-> src/ two-unions trap recorded in CLAUDE.md — `NoticeType` here and
// `BillingNotice.type` in BillingPanel.tsx are independent declarations that nothing
// type-checks against each other, and that pair already caused one crash. If a future edit
// finds itself adding a member, that is the signal the shape is wrong.

export type NoticeType = 'started' | 'upgraded' | 'downgraded' | 'cancelled' | 'grace' | 'recovered'

export type NoticeInput = {
  /** Raw Stripe subscription status, e.g. 'incomplete' | 'active' | 'past_due'. */
  stripeStatus: string | null
  /** Our mapped status after this event, falling back to the stored one when unmapped. */
  effectiveNewStatus: string | null
  /** hosts.subscription_status BEFORE this event. */
  oldStatus: string | null
  /** Whether hosts.stripe_subscription_id was already set BEFORE this event. */
  hadSubscription: boolean
  /**
   * True when this event's subscription is NOT the one already on the host row — i.e. a
   * genuinely new subscription, including a re-subscribe after cancellation. Distinct from
   * `!hadSubscription`, which is false for a re-subscriber because the column is never cleared.
   */
  isNewSubscription: boolean
  /**
   * Status of the latest invoice's PaymentIntent, when the webhook could read one:
   * 'requires_action' (3-D Secure challenge in flight), 'requires_payment_method' (DECLINED),
   * 'succeeded', etc. NULL whenever it could not be read — an unexpanded field, a bare id
   * string, or no invoice at all. Null is treated as "no decline signal", never as a decline;
   * see the fail-safe paragraph above.
   */
  paymentIntentStatus: string | null
  tier: number
  oldTier: number | null
}

export type NoticeDecision = {
  notice: NoticeType | null
  /**
   * True only for the excluded first-payment-authentication case: no host notice, but the
   * operator still gets a DEFAULT-priority ntfy so the machinery is visibly running. This is
   * the same principle as the is_test rule — suppress the HOST contact, never the operator's
   * view of it.
   */
  pendingAuthentication: boolean
}

/**
 * Decide which billing notice a subscription transition deserves.
 *
 * ORDER IS LOAD-BEARING. It reproduces the original if/else chain with ONE branch inserted:
 *   1. expired      — a cancellation is ALWAYS a cancellation, whatever else changed.
 *   2. grace        — entering grace, EXCEPT a first payment mid-3DS (the fix).
 *   3. started      — fresh subscribe or re-subscribe after expiry. UNCHANGED, and 'recovered'
 *                     is deliberately placed AFTER it so its reach is byte-identical to before.
 *   4. recovered    — grace -> active (the fix). Placed BEFORE the tier branch, so a recovery
 *                     that ALSO changed tier reports as a recovery, not an upgrade.
 *   5. up/downgrade — tier moved on an already-live subscription.
 *
 * TWO PRE-EXISTING CASES MOVE, not one — branch 4's reachable set (active && oldStatus==='grace'
 * && hadSubscription) splits in two, and BOTH halves change:
 *   - tier !== oldTier  → was 'upgraded'/'downgraded', now 'recovered'.
 *   - tier === oldTier  → was NULL (silent), now 'recovered'. This is the LARGER half and it
 *     includes every genuine past_due -> active card-retry recovery, which previously told the
 *     host nothing at all. Desirable, and the point of the fix — but it IS a behaviour change on
 *     a transition that predates 3-D Secure, so it is written down rather than implied.
 * Every other existing transition is identical — see the enumeration in the commit.
 *
 * WHY 'recovered' SITS AFTER 'started' AND NOT BEFORE IT: at the moment of the recovery event
 * the host row ALREADY carries stripe_subscription_id, because the preceding `incomplete` event
 * wrote it. So the real 3-D Secure recovery has hadSubscription === true and never reaches the
 * 'started' branch anyway. Putting 'recovered' first would have bought nothing and would have
 * silently narrowed 'started'.
 */
export function decideNotice(input: NoticeInput): NoticeDecision {
  const { stripeStatus, effectiveNewStatus, oldStatus, hadSubscription, isNewSubscription, paymentIntentStatus, tier, oldTier } = input
  const liveNow = effectiveNewStatus === 'active' || effectiveNewStatus === 'trial'

  if (effectiveNewStatus === 'expired' && oldStatus !== 'expired') {
    // A host who abandons the bank's 3-D Secure screen reaches `incomplete_expired` and so
    // receives a cancellation email for a subscription that never started. ACCEPTED RESIDUAL,
    // recorded rather than silently fixed: the alternative is suppressing a genuine
    // cancellation, and this branch cannot tell the two apart without more state than the
    // webhook carries.
    return { notice: 'cancelled', pendingAuthentication: false }
  }

  if (effectiveNewStatus === 'grace' && oldStatus !== 'grace') {
    if (
      stripeStatus === 'incomplete' &&
      isNewSubscription &&
      // POSITIVE decline signal only — see the fail-safe paragraph in the header. A null or
      // unexpected status falls through to suppression, never to a false "payment failed".
      paymentIntentStatus !== 'requires_payment_method'
    ) {
      return { notice: null, pendingAuthentication: true }
    }
    return { notice: 'grace', pendingAuthentication: false }
  }

  if (liveNow && (oldStatus === 'expired' || oldStatus == null || !hadSubscription)) {
    return { notice: 'started', pendingAuthentication: false }
  }

  if (effectiveNewStatus === 'active' && oldStatus === 'grace') {
    return { notice: 'recovered', pendingAuthentication: false }
  }

  if (liveNow && oldTier !== null && tier !== oldTier) {
    return { notice: tier > oldTier ? 'upgraded' : 'downgraded', pendingAuthentication: false }
  }

  return { notice: null, pendingAuthentication: false }
}
