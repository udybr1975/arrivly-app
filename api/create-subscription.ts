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

  const { tier, flow: rawFlow } = (req.body ?? {}) as { tier?: unknown; flow?: unknown }

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

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceIdForTier(tier as number), quantity: 1 }],
      client_reference_id: userId,
      subscription_data: {
        metadata: { ...ARRIVLY_STRIPE_METADATA, host_id: userId, tier: String(tier) },
        ...(trialEnd !== undefined ? { trial_end: trialEnd } : {}),
      },
      payment_method_collection: 'always',
      success_url: successUrl,
      cancel_url: cancelUrl,
    })

    return res.status(200).json({ url: session.url })
  } catch (err) {
    // `scrubErr` rather than the old inline `sk_`-only replace: it now covers `sk_` AND `whsec_`
    // AND the provider prefixes, so the hand-rolled version was strictly weaker than the shared
    // helper this file already imports. Leaving both in one file is how the next reader learns the
    // wrong lesson about which to reach for.
    console.error('[create-subscription] error —', scrubErr(err, 120))
    return res.status(500).json({ error: 'subscription_failed' })
  }
}
