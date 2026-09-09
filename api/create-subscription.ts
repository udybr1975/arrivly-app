import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import {
  getStripe,
  priceIdForTier,
  ARRIVLY_STRIPE_METADATA,
  findBlockingSubscription,
} from './_lib/stripe.js'
import { sendNtfy } from './_lib/ntfy.js'
import { scrubErr } from './_lib/scrub.js'

// ═══ FOUNDING HOSTS ════════════════════════════════════════════════════════════════════════
// Fixed coupon id so the coupon is created exactly once in the Stripe account and every later
// claim reuses it. 100% off, duration 'once' = the first invoice only.
const FOUNDING_COUPON_ID = 'FOUNDING-HOST-1M'
const FOUNDING_TIER = 3 // Portfolio

/**
 * Retrieve-then-create, in that order, because creation is the racy half: two simultaneous
 * first claimants would both try to create the same id and one would get
 * `resource_already_exists`. That error is not a failure — it means the other request won — so
 * it falls back to a retrieve rather than surfacing.
 */
function couponTermsAreCorrect(c: { percent_off?: number | null; duration?: string; valid?: boolean }): boolean {
  // THE TERMS ARE CHECKED, NEVER ASSUMED, AND THE STRIPE ACCOUNT IS THE REASON. It is SHARED
  // with Anna's Stays, and a coupon id is a human-typeable string in a dashboard. A
  // duration:'repeating' or 'forever' coupon squatting on this id would give the subscription
  // away indefinitely while this code and both disclosures still read "first month free" —
  // wrong in the expensive direction, silently, forever.
  return c.percent_off === 100 && c.duration === 'once' && c.valid !== false
}

async function ensureFoundingCoupon(stripe: ReturnType<typeof getStripe>): Promise<string | null> {
  try {
    const existing = await stripe.coupons.retrieve(FOUNDING_COUPON_ID)
    // Null, not a throw: a wrong coupon must refuse the BENEFIT, never the signup.
    return couponTermsAreCorrect(existing) ? existing.id : null
  } catch {
    try {
      const created = await stripe.coupons.create({
        id: FOUNDING_COUPON_ID,
        percent_off: 100,
        duration: 'once',
        name: 'Founding Hosts — first month free',
        metadata: { ...ARRIVLY_STRIPE_METADATA },
      })
      return created.id
    } catch {
      // WRAPPED, because an unwrapped throw here escapes the founding block entirely, lands in
      // the handler's outer catch and returns 500 subscription_failed — breaking this file's
      // own rule that a coupon problem refuses the BENEFIT, never the signup, and doing it
      // AFTER a place has already been consumed.
      try {
        const existing = await stripe.coupons.retrieve(FOUNDING_COUPON_ID)
        return couponTermsAreCorrect(existing) ? existing.id : null
      } catch {
        return null
      }
    }
  }
}

/**
 * One month ahead, CLAMPED to the last day of the target month — because JavaScript overflows
 * where Stripe clamps, and the two must agree.
 *
 * setMonth(+1) on 31 January yields 3 March; Stripe bills 28 February. The host would be told a
 * date LATER than the day their card is actually taken, on an auto-charge disclosure. Every
 * claim started on the 29th-31st hits it.
 */
function oneMonthAheadUTC(from: Date): Date {
  const y = from.getUTCFullYear()
  const m = from.getUTCMonth()
  const day = from.getUTCDate()
  const targetY = m === 11 ? y + 1 : y
  const targetM = (m + 1) % 12
  const daysInTarget = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate()
  return new Date(Date.UTC(targetY, targetM, Math.min(day, daysInTarget)))
}

/** Whole euros stay "25"; a fractional price renders "25.50" instead of being rounded away. */
function formatMoney(amountCents: number, symbol: string): string {
  const whole = amountCents % 100 === 0
  return symbol + (amountCents / 100).toFixed(whole ? 0 : 2)
}

const APP_URL = process.env.VITE_APP_URL ?? 'https://bemgu.app'

type Flow = 'signup' | 'billing'
const VALID_FLOWS: Flow[] = ['signup', 'billing']

function buildUrls(flow: Flow): { successUrl: string; cancelUrl: string } {
  if (flow === 'signup') {
    return {
      successUrl: `${APP_URL}/dashboard?checkout=success`,
      cancelUrl: `${APP_URL}/choose-plan?checkout=cancelled`,
    }
  }
  return {
    successUrl: `${APP_URL}/dashboard/billing?checkout=success`,
    cancelUrl: `${APP_URL}/dashboard/billing?checkout=cancelled`,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL!
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return res.status(500).json({ error: 'Service not configured' })

  const authClient = createClient(supabaseUrl, anonKey)
  const { data: authData, error: authError } = await authClient.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })
  const userId = authData.user.id

  const { tier, flow: rawFlow, founding: rawFounding } = (req.body ?? {}) as {
    tier?: unknown
    flow?: unknown
    founding?: unknown
  }
  // THE FOUNDING FLAG IS NOT A CREDENTIAL, AND DOES NOT NEED TO BE. The programme is automatic
  // and open to anyone while places last — there is no eligibility to forge. What actually
  // bounds it is the server-side, race-safe claim below and the one-benefit-per-host rule; a
  // client asserting `founding: true` can win nothing it could not have won by clicking the
  // button on the landing page.
  const wantsFounding = rawFounding === true

  if (!Number.isInteger(tier) || (tier as number) < 1 || (tier as number) > 4) {
    return res.status(400).json({ error: 'tier must be an integer 1–4' })
  }
  if ((tier as number) === 4) {
    return res.status(403).json({ error: 'booking_tier_unavailable' })
  }

  const flow: Flow = VALID_FLOWS.includes(rawFlow as Flow) ? (rawFlow as Flow) : 'billing'
  const { successUrl, cancelUrl } = buildUrls(flow)

  try {
    const admin = createClient(supabaseUrl, serviceKey)

    // `stripe_subscription_id` is selected ONLY for the drift comparison in the guard below —
    // this endpoint never writes it. One query, not two.
    const { data: host } = await admin
      .from('hosts')
      .select('stripe_customer_id, contact_email, trial_ends_at, subscription_status, stripe_subscription_id')
      .eq('id', userId)
      .maybeSingle()

    if (!host) return res.status(404).json({ error: 'host_not_found' })

    const stripe = getStripe()

    // Find-or-create Stripe customer
    let customerId = (host.stripe_customer_id as string | null) ?? null
    // Tracked so the guard below can skip a pointless round trip — see its comment.
    let customerJustCreated = false
    if (!customerId) {
      customerJustCreated = true
      const customer = await stripe.customers.create({
        email: (host.contact_email as string | null) ?? undefined,
        metadata: { ...ARRIVLY_STRIPE_METADATA, host_id: userId },
      })
      customerId = customer.id
      const { error: custSaveErr } = await admin
        .from('hosts')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId)
      if (custSaveErr) {
        console.error('[create-subscription] failed to persist customer id —', String(custSaveErr.message).slice(0, 80))
        return res.status(500).json({ error: 'subscription_failed' })
      }
    }

    // ═══ DUPLICATE-SUBSCRIPTION GUARD ═══════════════════════════════════════════════════════
    //
    // Placed AFTER the customer is resolved (we need the customer id to ask) and BEFORE
    // `checkout.sessions.create` (after it, the damage is already done — Stripe would have a
    // second live subscription on the same customer).
    //
    // THIS ENDPOINT REFUSES; IT DOES NOT REPAIR. It never cancels, modifies or creates anything
    // in Stripe, and never writes a billing column — the webhook remains the single writer. A host
    // holding a live subscription belongs in `change-plan.ts` (which requires
    // `stripe_subscription_id` and accepts only trialing/active), not in a second Checkout.
    if (!customerJustCreated) {
      // Skipped entirely for a customer created moments ago in THIS request: it provably has no
      // subscriptions, so the round trip is pure latency on the signup path — the one flow where
      // it would be paid every single time.
      let subscriptions
      try {
        // `status: 'all'` deliberately: the helper decides what blocks. Asking Stripe to
        // pre-filter would hide the past_due/unpaid/paused cases this guard exists to catch, and
        // would silently make the drift alert blind to them too.
        // AUTO-PAGED, and the bound is the point. With `status: 'all'`, canceled and
        // incomplete_expired rows accumulate on a customer forever and Stripe returns them
        // NEWEST-FIRST — so a single un-paginated page could hide an OLDER live subscription
        // behind newer dead ones and wave the duplicate straight through. Not reachable at the
        // observed scale (the worst real customer has six), but the failure would be silent,
        // which is the kind this guard exists to stop. 300 is a deliberate ceiling rather than
        // unbounded paging: past that, refusing on what we have seen is safer than spending
        // unbounded round trips inside a request.
        subscriptions = await stripe.subscriptions
          .list({ customer: customerId, status: 'all', limit: 100 })
          .autoPagingToArray({ limit: 300 })
      } catch (listErr) {
        // FAIL CLOSED, and this asymmetry is the whole point: an unnecessary refusal is
        // recoverable by retrying, a duplicate live subscription bills a real customer twice and
        // needs manual Stripe surgery to undo. Never fall through to creating a session.
        console.error('[create-subscription] subscription lookup failed (failing closed) —', scrubErr(listErr, 120))
        return res.status(503).json({ error: 'billing_unavailable' })
      }

      const blocking = findBlockingSubscription(subscriptions)
      if (blocking) {
        // DRIFT: the blocking subscription is not the one the host row points at, which is the
        // exact signature of the production defect — the row was overwritten while the superseded
        // subscription kept billing. Alert only on a MISMATCH; a host clicking subscribe twice
        // with matching ids is ordinary behaviour and must not page anyone.
        const hostSubId = (host.stripe_subscription_id as string | null) ?? null
        if (blocking.subscription.id !== hostSubId) {
          console.warn(
            '[create-subscription] subscription id drift —',
            `host=${userId} stripe=${blocking.subscription.id} row=${hostSubId ?? 'null'} status=${blocking.subscription.status}`,
          )
          // Ids and the host uuid only — no key material, no email, no customer id. sendNtfy
          // never throws (it catches internally), so this cannot break the refusal path.
          await sendNtfy({
            title: 'Bemgu billing: subscription id drift',
            message:
              `A blocking Stripe subscription does not match the host row.\n` +
              `Host ${userId}\n` +
              `Stripe subscription ${blocking.subscription.id} (status ${blocking.subscription.status})\n` +
              `Host row stripe_subscription_id ${hostSubId ?? 'null'}\n` +
              `A new Checkout was REFUSED, nothing was changed in Stripe. ` +
              `ACTION: confirm which subscription is billing this host and cancel any superseded one in Stripe.`,
            priority: 'high',
          })
        }

        return res
          .status(409)
          .json({ error: blocking.reason === 'exists' ? 'subscription_exists' : 'subscription_needs_payment' })
      }
    }

    // ═══ FOUNDING CLAIM ═════════════════════════════════════════════════════════════════════
    //
    // Placed AFTER the duplicate-subscription guard, which is what makes the one-benefit rule
    // below sound: reaching this line proves the host has no live subscription.
    //
    // THE DB IS AUTHORITATIVE AND RACE-SAFE. `claim_founding_place()` takes a transaction-level
    // advisory lock, recomputes the held count from the SAME SQL the public counter reads, and
    // sets `founding_at` only if a place remains — so two simultaneous claimants cannot both
    // take place 50. Nothing here re-implements the counting rule; a second copy in TypeScript
    // is precisely how the page would come to advertise a place the server then refuses.
    let foundingApplied = false
    let foundingCouponId: string | null = null

    if (wantsFounding && (tier as number) === FOUNDING_TIER) {
      // ELIGIBILITY IS DECIDED BEFORE A PLACE IS CONSUMED. Claiming first and only then
      // discovering that this host already had their founding month would burn one of the 50
      // on someone who receives nothing, and a place taken in error is released only by waiting
      // out the 7-day window. `stripe_subscription_id` is SET on the first subscription and
      // NEVER CLEARED on cancel or expiry (see api/_lib/billing-notice.ts), so a null value is
      // a reliable "has never subscribed" marker:
      //   - first claim, checkout completed       -> coupon applied once. OK
      //   - claim, checkout ABANDONED, retried    -> still null, applied on the retry, which is
      //                                              correct: they never actually received it.
      //   - free month used, cancel, re-subscribe -> id is set, no claim, no second coupon.
      //   - plan change                           -> goes through change-plan.ts, never here.
      if ((host.stripe_subscription_id as string | null) !== null) {
        return res.status(409).json({ error: 'founding_not_eligible' })
      }

      const { data: claimRows, error: claimErr } = await admin.rpc('claim_founding_place', {
        p_host_id: userId,
      })
      const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows
      if (claimErr || !claim || typeof claim.claimed !== 'boolean') {
        // FAIL CLOSED ON THE BENEFIT, NEVER ON THE SIGNUP. A claim we could not evaluate must
        // not hand out a free month, but it must also not block someone from subscribing.
        // DISTINCT from 'founding_unavailable': telling a host "the places have just been taken"
        // when the database merely hiccuped is a false statement about a live offer. The typeof
        // guard also catches a shape change in the RPC's return type, which would otherwise read
        // claim.claimed as undefined and silently refuse every claim.
        console.error('[create-subscription] founding claim failed —', scrubErr(claimErr, 120))
        return res.status(503).json({ error: 'founding_check_failed' })
      }

      if (!claim.claimed) {
        // The programme filled between the page load and this click. REFUSING HERE IS THE
        // HONEST FALLBACK, and it is deliberately not "quietly create the normal subscription":
        // this host clicked a button that said the first month was free, and redirecting them
        // into a paid checkout without saying so is the kind of silent substitution the
        // auto-charge disclosure exists to prevent. The UI shows the notice and lets them pick
        // a plan normally — the signup is never failed, only the discount is refused.
        return res.status(409).json({ error: 'founding_unavailable' })
      }

      // The one-benefit-per-host rule is enforced by the eligibility check above, which runs
      // BEFORE the claim. Deliberately not restated here: two copies of the same reasoning
      // drift, and the copy that no longer sits beside its check is the one that goes stale.
      foundingCouponId = await ensureFoundingCoupon(stripe)
      if (!foundingCouponId) {
        // The coupon exists but does not say what we say it says. Refuse the benefit rather than
        // charge a host who was promised a free month.
        console.error('[create-subscription] founding coupon terms rejected')
        return res.status(503).json({ error: 'founding_check_failed' })
      }
      foundingApplied = true
    }

    // THE AUTO-CHARGE DISCLOSURE, BUILT SERVER-SIDE AND SHOWN ON THE CARD-ENTRY PAGE ITSELF.
    //
    // THE AMOUNT COMES FROM THE STRIPE PRICE, NOT FROM `plans.price_cents`. The DB column is
    // DISPLAY-ONLY and does not control what Stripe charges (CLAUDE.md says so explicitly), so
    // the two can drift — and the one sentence where a drifted number would be least
    // forgivable is the one telling a host what will be taken from their card. Reading the
    // Price object costs one API call on the founding path only and makes the disclosed amount
    // the charged amount by construction.
    let foundingCustomText: string | null = null
    if (foundingApplied) {
      try {
        const price = await stripe.prices.retrieve(priceIdForTier(tier as number))
        const amount = price.unit_amount
        const currency = (price.currency ?? 'eur').toUpperCase()
        const symbol = currency === 'EUR' ? '€' : `${currency} `
        // One month from now, CLAMPED like Stripe clamps (see oneMonthAheadUTC) and formatted
        // with an explicit UTC read so the server's timezone cannot shift the date. Accurate to the minutes between this call and the
        // host completing checkout, which is when the subscription actually starts.
        const charge = oneMonthAheadUTC(new Date())
        const when = charge.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        })
        if (typeof amount === 'number') {
          const money = formatMoney(amount, symbol)
          foundingCustomText =
            `First month free. From ${when}, ${money}/month is charged automatically. ` +
            `Cancel anytime before then and pay nothing.`
        }
      } catch (priceErr) {
        // No disclosure text rather than a WRONG one. The same sentence is also rendered on the
        // plan step before this point, so the host has still seen it; this is the belt to that
        // page's braces, and a belt that lies is worse than no belt.
        console.error('[create-subscription] founding price lookup failed —', scrubErr(priceErr, 120))
      }
    }

    // Pass remaining trial days through to Stripe — only for hosts still in trial status.
    // trial_ends_at is never cleared on conversion, so gating on status prevents re-applying
    // a stale trial date when an active host switches tiers.
    const trialEndsAt = host.trial_ends_at as string | null
    let trialEnd: number | undefined
    if (trialEndsAt && (host.subscription_status as string | null) === 'trial') {
      const trialMs = new Date(trialEndsAt).getTime()
      if (trialMs > Date.now()) {
        trialEnd = Math.floor(trialMs / 1000)
      }
    }

    // THE TRIAL IS DELIBERATELY SUPPRESSED FOR A FOUNDING CLAIM, and this is a disclosure
    // decision rather than a billing preference. The approved copy promises "one month free"
    // and the card-entry disclosure names a date ONE MONTH ahead. Stacking the 14-day trial on
    // top of a one-month coupon would make the real first charge land ~44 days out, so the
    // date shown to the host — on an auto-charge disclosure, the one sentence that most has to
    // be true — would be wrong. One mechanism, one month, one accurate date.
    if (foundingApplied) trialEnd = undefined

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceIdForTier(tier as number), quantity: 1 }],
      client_reference_id: userId,
      subscription_data: {
        metadata: {
          ...ARRIVLY_STRIPE_METADATA,
          host_id: userId,
          tier: String(tier),
          ...(foundingApplied ? { founding: 'true' } : {}),
        },
        ...(trialEnd !== undefined ? { trial_end: trialEnd } : {}),
      },
      // The 100%-off-once coupon. `payment_method_collection: 'always'` below is what keeps the
      // card requirement true even though the first invoice is EUR 0 — without it Stripe would
      // skip card collection on a fully discounted first period and month two would fail.
      ...(foundingCouponId ? { discounts: [{ coupon: foundingCouponId }] } : {}),
      payment_method_collection: 'always',
      // Rendered by Stripe directly above the Pay/Subscribe button — i.e. AT the point of card
      // entry, which is where an auto-charge disclosure has to be to do its job.
      ...(foundingCustomText ? { custom_text: { submit: { message: foundingCustomText } } } : {}),
      success_url: successUrl,
      cancel_url: cancelUrl,
    })

    return res.status(200).json({ url: session.url, founding: foundingApplied })
  } catch (err) {
    // `scrubErr` rather than the old inline `sk_`-only replace: it now covers `sk_` AND `whsec_`
    // AND the provider prefixes, so the hand-rolled version was strictly weaker than the shared
    // helper this file already imports. Leaving both in one file is how the next reader learns the
    // wrong lesson about which to reach for.
    console.error('[create-subscription] error —', scrubErr(err, 120))
    return res.status(500).json({ error: 'subscription_failed' })
  }
}
