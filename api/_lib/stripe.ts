import Stripe from 'stripe'

let _stripe: Stripe | null = null

/**
 * THE WIRE API VERSION, PINNED IN SOURCE — and the reason it must be here rather than left to the
 * SDK is that OMITTING IT DOES NOT OMIT THE HEADER.
 *
 * Verified in the installed stripe@17.7.0 source, not assumed:
 *   cjs/apiVersion.js       ApiVersion = '2025-02-24.acacia'
 *   cjs/stripe.core.js:16   DEFAULT_API_VERSION = ApiVersion
 *   cjs/stripe.core.js:78   version: props.apiVersion || DEFAULT_API_VERSION
 *   cjs/RequestSender.js:223  'Stripe-Version': apiVersion
 * So `new Stripe(key)` sends the SDK's baked-in default on EVERY request, which made the wire API
 * version a property of whatever happened to be in node_modules. Until the lockfile was synced
 * (6bb48d5) that was unpinned, so a plain `npm install` could have moved the API version under a
 * live billing integration with no source change and nothing to review.
 *
 * THIS VALUE IS A NO-OP AT RUNTIME. It is byte-identical to what the SDK already sends today; the
 * change is that the API version is now a property of the SOURCE instead of the dependency tree.
 * Do not read this commit as an upgrade — it deliberately is not one.
 *
 * UPGRADING IT IS A REAL MIGRATION, NOT A STRING EDIT. The next line after acacia is Basil
 * (2025-03-31), which MOVED `current_period_end` off the subscription root onto
 * `items.data[0]`. An item-level -> root fallback is what makes that survivable, and it lives at
 * FOUR sites across THREE files — read all of them before touching this string, and expect to
 * verify a real webhook event afterwards:
 *   api/stripe-webhook.ts      (1 site)
 *   api/change-plan.ts         (1 site)
 *   api/cancel-subscription.ts (2 sites)
 *
 * TYPE NOTE: the SDK types `apiVersion` as `LatestApiVersion`, a single-member union equal to this
 * literal, so it typechecks with no cast. If a future SDK bump makes this line fail to compile,
 * that failure IS the migration notice — do not silence it with a cast.
 *
 * BUT DO NOT RELY ON CI TO RAISE IT: `npm run build` (`tsc -b && vite build`) does NOT typecheck
 * `api/` — no tsconfig includes it — so a dependency bump that moves the SDK default can land
 * GREEN. That notice surfaces in an editor or under an explicit `npx tsc --noEmit` on this file,
 * not in the build.
 */
const STRIPE_API_VERSION = '2025-02-24.acacia'

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY not configured')
    _stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION })
  }
  return _stripe
}

const TIER_ENV_KEYS: Record<number, string> = {
  1: 'STRIPE_PRICE_TIER_1',
  2: 'STRIPE_PRICE_TIER_2',
  3: 'STRIPE_PRICE_TIER_3',
}

export function priceIdForTier(tier: number): string {
  const envKey = TIER_ENV_KEYS[tier]
  if (!envKey) throw new Error(`No price env for tier ${tier}`)
  const priceId = process.env[envKey]
  if (!priceId) throw new Error(`${envKey} not configured`)
  return priceId
}

export function tierForPriceId(priceId: string): number | null {
  for (const [tier, envKey] of Object.entries(TIER_ENV_KEYS)) {
    if (process.env[envKey] === priceId) return Number(tier)
  }
  return null
}

export const ARRIVLY_STRIPE_METADATA = { app: 'arrivly' } as const

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DUPLICATE-SUBSCRIPTION GUARD
//
// WHY THIS EXISTS — a defect verified in production, not a hypothetical. `create-subscription.ts`
// opened a `mode: 'subscription'` Checkout session for the customer with NO check for an existing
// live subscription, so every run STACKED another concurrent subscription on the same Stripe
// customer. One host accumulated six subscription ids; `hosts.stripe_subscription_id` was
// overwritten each time while the superseded subscriptions kept billing, and on 9 Aug 2026 one of
// them renewed and flipped that host from `expired` back to `active`, firing a "subscription
// started" fan-out. In live mode that is double billing AND a cancelled host silently reactivating.
//
// WHAT THIS DOES NOT CLOSE, stated so the header is not read as a clean bill of health:
//   - NOTHING SERIALISES CONCURRENT REQUESTS. Two tabs, or a double-submit, can both pass the
//     guard and both open a Checkout session; if the host completes both, the duplicate returns.
//     Strictly improved by this guard, not eliminated by it — closing it needs a lock or an
//     idempotency key, not a read.
//   - It inspects only the customer `hosts.stripe_customer_id` points at. That column must stay
//     server-only for WRITE; if a host could null it they would get a fresh customer, stack a
//     second subscription on it, and this guard would report clean.
//
// WHY IT LIVES IN THIS FILE: it is Stripe domain logic whose correctness depends entirely on
// `ARRIVLY_STRIPE_METADATA` — the Anna's Stays isolation boundary declared three lines above.
// Separating the constant from the only function that enforces it is exactly how that boundary
// would drift. `tierForPriceId` is the precedent: a pure, env-free, unit-testable function already
// living here, and `create-subscription.ts` already imports from this module, so the guard adds no
// new file and no new import edge.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** A live subscription. The host must switch tiers, not open a second Checkout. */
const BLOCKING_EXISTS_STATUSES = new Set(['active', 'trialing'])

/**
 * A subscription that still EXISTS and can be recovered by fixing payment. Blocking for the same
 * reason: opening a second Checkout leaves the broken one behind, still attached and still billable.
 */
const BLOCKING_NEEDS_PAYMENT_STATUSES = new Set(['past_due', 'unpaid', 'paused'])

/**
 * DELIBERATELY NON-BLOCKING, and this is the half that is easy to get wrong: 'canceled',
 * 'incomplete' and 'incomplete_expired'.
 *
 * `incomplete` is the trap. It is the status of a Checkout the host abandoned at the card step,
 * and it expires on its own within 24h. Blocking on it would lock a host out of EVER subscribing —
 * their own abandoned attempt would refuse every retry. A guard that can permanently deny revenue
 * is worse than the duplicate it prevents, so incomplete sessions are invisible here.
 *
 * These three plus the two blocking sets cover all eight Stripe subscription statuses, so there is
 * no unknown-status path in practice today. An unrecognised future status falls through as
 * NON-blocking — the same lock-out reasoning — which is the residual worth knowing about: if Stripe
 * ever adds a status meaning "live and billing", it must be added to a blocking set above.
 */

export type SubscriptionBlockReason = 'exists' | 'needs_payment'

/**
 * Structural shape only — NOT `Stripe.Subscription`. Keeping the parameter minimal is what makes
 * this unit-testable with plain object literals instead of hand-built SDK fixtures; a real
 * `Stripe.Subscription[]` satisfies it structurally at the call site.
 */
export interface SubscriptionLike {
  id: string
  status: string
  metadata?: Record<string, string> | null
}

export interface BlockingSubscription {
  subscription: SubscriptionLike
  reason: SubscriptionBlockReason
}

/**
 * Returns the subscription that should block a new Checkout, with the reason — or null.
 *
 * PURE: no I/O, no env, no clock. The caller does the Stripe round trip and owns the HTTP response.
 *
 * ANNA'S STAYS ISOLATION IS THE FIRST RULE, NOT A FILTER APPLIED LATER. The same Stripe account
 * also holds Anna's Stays, so ONLY subscriptions carrying `metadata.app === 'arrivly'` are visible
 * to this function. Anything else must NEVER block — a Bemgu host who is also an Anna's Stays
 * customer would otherwise be refused a subscription because of an unrelated product. The check is
 * an exact match on the shared constant (Stripe metadata is case-sensitive, as the webhook's
 * `metadata.app` filter already documents).
 *
 * PREFERENCE ORDER: an 'exists' verdict wins over a 'needs_payment' one, so a host holding both
 * gets the more actionable route (switch plan) rather than being sent to fix a card on a
 * subscription they are about to supersede. Implemented by returning immediately on the first
 * 'exists' match while merely remembering the first 'needs_payment' one.
 */
export function findBlockingSubscription(
  subscriptions: readonly SubscriptionLike[] | null | undefined,
): BlockingSubscription | null {
  if (!Array.isArray(subscriptions)) return null

  let needsPayment: BlockingSubscription | null = null

  for (const sub of subscriptions) {
    if (!sub || typeof sub.id !== 'string' || typeof sub.status !== 'string') continue
    // Isolation first — an unrelated product's subscription is not merely lower priority here,
    // it is invisible.
    if (sub.metadata?.app !== ARRIVLY_STRIPE_METADATA.app) continue

    if (BLOCKING_EXISTS_STATUSES.has(sub.status)) {
      return { subscription: sub, reason: 'exists' }
    }
    if (!needsPayment && BLOCKING_NEEDS_PAYMENT_STATUSES.has(sub.status)) {
      needsPayment = { subscription: sub, reason: 'needs_payment' }
    }
  }

  return needsPayment
}

/** A Stripe ref field, which is a string id unless the caller expanded it into an object. */
function refId(v: unknown): string | null {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string') {
    return (v as { id: string }).id
  }
  return null
}

/**
 * The subscription id on an `invoice.*` payload, across API versions.
 *
 * Basil (2025-03-31) REMOVED `Invoice.subscription`, moving it to
 * `parent.subscription_details.subscription`. Read the current shape first, fall back to the
 * pre-Basil root — same straddle-both-versions reasoning as the `current_period_end` fallback.
 * Returns null for an invoice genuinely unrelated to a subscription; the caller ignores those.
 */
export function subscriptionIdFromInvoice(invoice: unknown): string | null {
  if (!invoice || typeof invoice !== 'object') return null
  const inv = invoice as Record<string, unknown>

  const parent = inv.parent
  const details =
    parent && typeof parent === 'object'
      ? (parent as Record<string, unknown>).subscription_details
      : null
  const fromParent =
    details && typeof details === 'object'
      ? refId((details as Record<string, unknown>).subscription)
      : null

  return fromParent ?? refId(inv.subscription)
}

export { getStripe }
