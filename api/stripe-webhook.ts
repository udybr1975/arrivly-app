import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { getStripe, tierForPriceId, ARRIVLY_STRIPE_METADATA, subscriptionIdFromInvoice } from './_lib/stripe.js'
import {
  sendEmail,
  formatMoney,
  subscriptionStartedEmail,
  subscriptionChangedEmail,
  subscriptionCancelledEmail,
  subscriptionPastDueEmail,
  subscriptionRecoveredEmail,
  adminSubscriptionEventEmail,
} from './_lib/email.js'
import { decideNotice, type NoticeType } from './_lib/billing-notice.js'
import { sendPushToHost } from './_lib/push.js'
import { sendNtfy } from './_lib/ntfy.js'

export const config = { api: { bodyParser: false } }

const ADMIN_EMAIL = 'udy.bar.yosef@gmail.com'

// Tier names duplicated from src/lib/tierCopy.ts — same cross-boundary pattern as EXTRAS_CATEGORIES.
const TIER_NAMES_W: Record<number, string> = { 1: 'Starter', 2: 'Growth', 3: 'Portfolio', 4: 'Pro' }

function scrubKeys(msg: string): string {
  return msg
    .replace(/sk_[a-zA-Z0-9_]+/gi, 'sk_REDACTED')
    .replace(/whsec_[a-zA-Z0-9_]+/gi, 'whsec_REDACTED')
    .slice(0, 160)
}

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function mapStatus(stripeStatus: string): string | null {
  switch (stripeStatus) {
    case 'trialing': return 'trial'
    case 'active': return 'active'
    case 'incomplete':
    case 'past_due':
    case 'unpaid':
    case 'paused': return 'grace'
    case 'canceled':
    case 'incomplete_expired': return 'expired'
    default:
      console.log('[stripe-webhook] unknown stripe status, not updating:', stripeStatus)
      return null
  }
}

const HANDLED_TYPES = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured')
    return res.status(500).json({ error: 'Webhook not configured' })
  }

  let rawBuffer: Buffer
  try {
    rawBuffer = await getRawBody(req)
  } catch (err) {
    console.error('[stripe-webhook] body read error:', scrubKeys(String((err as Error).message ?? '')))
    return res.status(400).json({ error: 'Failed to read body' })
  }

  const sig = req.headers['stripe-signature']
  if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' })

  let stripeEvent: Stripe.Event
  try {
    stripeEvent = getStripe().webhooks.constructEvent(rawBuffer, sig as string, webhookSecret)
  } catch (err) {
    console.error('[stripe-webhook] signature failure:', scrubKeys(String((err as Error).message ?? '')))
    return res.status(400).json({ error: 'Webhook signature verification failed' })
  }

  if (!HANDLED_TYPES.has(stripeEvent.type)) {
    return res.status(200).json({ ignored: true })
  }

  // Resolve subscription ID from the event object
  const obj = stripeEvent.data.object as Record<string, unknown>
  let subId: string | null = null
  if (stripeEvent.type === 'checkout.session.completed') {
    const s = obj.subscription
    subId = typeof s === 'string' ? s : null
  } else if (stripeEvent.type.startsWith('customer.subscription.')) {
    const id = obj.id
    subId = typeof id === 'string' ? id : null
  } else {
    // invoice.* — Basil moved the subscription ref off the root to
    // `parent.subscription_details.subscription`, so reading only `obj.subscription` resolved null
    // on any post-Basil endpoint and silently ignored every invoice event. Same straddle-both-
    // versions shape as the `current_period_end` fallback below.
    subId = subscriptionIdFromInvoice(obj)
  }

  if (!subId) {
    console.log('[stripe-webhook] no subscription id in event:', stripeEvent.type)
    return res.status(200).json({ ignored: true })
  }

  // Retrieve live subscription — idempotency + out-of-order safety
  let sub: Stripe.Subscription
  try {
    // `latest_invoice.payment_intent` — ONE MORE LEVEL OF THE SAME EXPAND, not an extra API
    // call. The payment intent's status is the only thing that separates "3-D Secure challenge
    // in flight" from "first charge DECLINED"; both surface as subscription status
    // `incomplete`. See api/_lib/billing-notice.ts.
    //
    // THIS READ DEPENDS ON THE PINNED WIRE VERSION. api/_lib/stripe.ts pins
    // 2025-02-24.acacia, where `Invoice.payment_intent` exists. BASIL (2025-03-31+) REMOVED
    // that field from the Invoice object; under Basil the value is reached through the
    // invoice's payments data instead, so this expand PATH IS NO LONGER VALID and the fix is a
    // code change, not a version-string edit.
    // WHAT BASIL ACTUALLY DOES HERE IS NOT VERIFIED, AND THE TWO POSSIBILITIES ARE OPPOSITE
    // ENDS OF THE LOUDNESS SCALE — do not plan the migration until you have measured which:
    //   (i) Stripe validates expand paths server-side and 400s an unknown one. Then this
    //       retrieve THROWS, the catch below returns 500, and EVERY billing event stops
    //       processing — Stripe retries, then disables the endpoint. Loud and total.
    //   (ii) The path is silently dropped. Then `paymentIntentStatus` resolves null and, by the
    //       fail-safe direction, declined first charges quietly stop notifying. Silent.
    // (i) is the more likely reading and the one to prepare for. An earlier version of this
    // comment asserted (ii) as fact; it was never measured. Measure it against a Basil-pinned
    // sandbox call before moving the pin.
    sub = await getStripe().subscriptions.retrieve(subId, { expand: ['latest_invoice.payment_intent'] })
  } catch (err) {
    console.error('[stripe-webhook] subscription retrieve error:', scrubKeys(String((err as Error).message ?? '')))
    return res.status(500).json({ error: 'Failed to retrieve subscription' })
  }

  // Arrivly isolation — same Stripe account also holds Anna's Stays events
  if (sub.metadata?.app !== ARRIVLY_STRIPE_METADATA.app) {
    return res.status(200).json({ ignored: true })
  }

  const priceId = sub.items.data[0]?.price?.id
  const tier = priceId ? tierForPriceId(priceId) : null
  if (tier === null) {
    console.log('[stripe-webhook] unknown price id, ignoring:', priceId)
    return res.status(200).json({ ignored: true })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    console.error('[stripe-webhook] SUPABASE_SERVICE_ROLE_KEY not configured')
    return res.status(500).json({ error: 'Service not configured' })
  }
  const admin = createClient(supabaseUrl, serviceKey)

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  // Resolve host: prefer sub.metadata.host_id (validated), else look up by stripe_customer_id
  const rawHostId = sub.metadata?.host_id ?? null
  let hostId: string | null = rawHostId && UUID_RE.test(rawHostId) ? rawHostId : null
  if (!hostId) {
    const customerId = typeof sub.customer === 'string'
      ? sub.customer
      : (sub.customer as Stripe.Customer | Stripe.DeletedCustomer).id
    if (customerId) {
      const { data } = await admin
        .from('hosts')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .maybeSingle()
      hostId = data?.id ?? null
    }
  }

  if (!hostId) {
    console.log('[stripe-webhook] cannot resolve host for subscription:', subId)
    return res.status(200).json({ ignored: true })
  }

  // Read host row BEFORE writing for transition detection
  const { data: hostRow } = await admin
    .from('hosts')
    .select('tier,subscription_status,stripe_subscription_id,contact_email,name,pending_tier,is_test')
    .eq('id', hostId)
    .maybeSingle()

  if (!hostRow) {
    console.log('[stripe-webhook] host row not found:', hostId)
    return res.status(200).json({ ignored: true })
  }

  // Defensive by shape, not by trust: `payment_intent` is typed string | PaymentIntent | null,
  // and is a bare id string whenever the expand did not apply. Anything that is not an object
  // with a status yields null, which the decision layer reads as "no decline signal".
  // NOTE the name: `latestInvoice` is already bound further down in this same function scope
  // (the amount_paid read), so this one is deliberately distinct rather than shadowing it.
  const invoiceForIntent = sub.latest_invoice
  const pi =
    invoiceForIntent && typeof invoiceForIntent === 'object'
      ? (invoiceForIntent as Stripe.Invoice & { payment_intent?: string | Stripe.PaymentIntent | null }).payment_intent
      : null
  const paymentIntentStatus: string | null =
    pi && typeof pi === 'object' ? ((pi as Stripe.PaymentIntent).status ?? null) : null

  const newStatus = mapStatus(sub.status)
  // ITEM-LEVEL FIRST, THEN ROOT — DO NOT COLLAPSE THIS TO ONE READ. The two branches are two
  // different Stripe API versions, and keeping both is what makes an API-version change
  // survivable rather than a silent data loss:
  //   acacia (2025-02-24, the version now pinned in api/_lib/stripe.ts) carries
  //     `current_period_end` on the subscription ROOT;
  //   Basil  (2025-03-31) MOVED it onto `items.data[0]`.
  // Whichever version is on the wire, one of these two reads is the live one and the other is
  // absent — so this expression is correct across the upgrade instead of only after it.
  //
  // WHAT DROPPING THE APPARENTLY-DEAD BRANCH WOULD COST — NOT TODAY, BUT AT THE NEXT VERSION
  // CHANGE, when the branch that survived becomes the absent one. Delete the item-level read now
  // and nothing happens at all, which is exactly the trap: the cost is deferred to whoever moves
  // the pin, and by then the deletion looks unrelated.
  //
  // WHEN IT DOES BITE, THE OBVIOUS GUESS IS WRONG. It is NOT "null on every host row": the write
  // below is GUARDED on non-null, so the column is simply NOT WRITTEN. Existing subscribers keep
  // a FROZEN stale value and only hosts who never had one stay NULL — which is harder to spot
  // than a null, because grepping for nulls finds none and wrongly clears the bug. Nothing throws
  // and nothing logs.
  //
  // Deliberately NOT enumerating the downstream symptoms here — a list in this comment would be a
  // second copy of derivable facts, and it rotted on every pass before it was removed. Trace them
  // at the time instead. IT TAKES TWO GREPS, NOT ONE, because the consumers straddle a file
  // boundary and the camelCase local finds only half:
  //   `currentPeriodEnd`          — the local, consumed inside this handler;
  //   `hosts.current_period_end`  — the persisted column, read OUTSIDE this file (the host-facing
  //                                 renewal / cancels-on date), which is where a frozen value is
  //                                 most visible and longest-lived.
  //
  // ONLY THE ITEM-LEVEL `as any` IS REQUIRED. That read is a Basil shape absent from the installed
  // acacia typings entirely — `types/SubscriptionItems.d.ts` has no `current_period_end` — so
  // without the cast the forward-compatible branch would not compile.
  //
  // THE ROOT CAST IS REDUNDANT, AND NOT HARMLESS. `types/Subscriptions.d.ts` declares the field on
  // the root, so that read compiles uncast today; the cast's real effect is to SUPPRESS the
  // compile error a Basil-typed SDK bump would otherwise raise there — the same migration signal
  // api/_lib/stripe.ts deliberately preserves and tells you not to cast away. Removing it is a
  // code change and out of scope here; just know the canary is blunted on this read while it stands.
  //
  // WHICH VERSION GOVERNS WHAT — the two objects in this handler are versioned by DIFFERENT
  // things, and conflating them is the trap:
  //   `sub` comes from `subscriptions.retrieve()`, an OUTBOUND call, so its shape follows the
  //     client's pinned apiVersion (api/_lib/stripe.ts).
  //   The EVENT PAYLOAD parsed above is rendered by Stripe BEFORE it reaches us, at the version
  //     stored on the webhook ENDPOINT (Dashboard config). `constructEvent` only HMAC-verifies and
  //     JSON.parses — it performs no version translation — so THE CLIENT PIN DOES NOT GOVERN IT.
  //
  // AND THE PAYLOAD IS NOT UNIFORMLY SAFE ACROSS THAT GAP. `checkout.session.completed`'s
  // `subscription` and `customer.subscription.*`'s `id` both survived acacia -> Basil. THE INVOICE
  // PAYLOAD DID NOT: Basil REMOVED `subscription` from Invoice, relocating it to
  // `parent.subscription_details.subscription`. That branch now goes through
  // `subscriptionIdFromInvoice` (api/_lib/stripe.ts), which reads the current shape then the
  // pre-Basil root, so it spans both versions — it did not before, and this was NOT hypothetical:
  // the endpoint was verified rendering 2026-04-22.dahlia on 10 Aug 2026, so both invoice events
  // had ALWAYS resolved null and returned 200 {ignored:true} — no compile error and no throw,
  // because the read comes off a `Record<string, unknown>` cast, and indistinguishable from a
  // legitimately ignored event. Impact was contained only because `customer.subscription.updated`
  // covers the same ground; that fix restored a REDUNDANT path, it did not repair a broken one.
  //
  // The endpoint's configured version is LIVE DASHBOARD STATE, NOT ASSERTABLE FROM THIS FILE.
  // Re-versioning it is a DASHBOARD ACTION WITH NO DEPLOY — its own migration, separate from the
  // client pin. Check the Dashboard; do not trust an undated claim here. (The previous version of
  // this paragraph carried exactly such a claim, and it was already wrong when written.)
  //
  // This is one of FOUR sites carrying this fallback: also api/change-plan.ts (1) and
  // api/cancel-subscription.ts (2). Change one, change all.
  const periodEndUnix =
    (sub.items?.data?.[0] as any)?.current_period_end ??
    (sub as any).current_period_end ??
    null
  const currentPeriodEnd = periodEndUnix
    ? new Date(periodEndUnix * 1000).toISOString()
    : null

  // Pricing data for email enrichment — Stripe item price is already expanded
  const subPrice = sub.items.data[0]?.price as Stripe.Price | null
  const priceCentsFromStripe: number | null = subPrice?.unit_amount ?? null
  const currencyFromStripe: string | null = subPrice?.currency ?? null
  const latestInvoice = sub.latest_invoice as Stripe.Invoice | null
  const amountChargedCents: number | null = latestInvoice?.amount_paid ?? null

  const customerId = typeof sub.customer === 'string'
    ? sub.customer
    : (sub.customer as Stripe.Customer | Stripe.DeletedCustomer).id

  const updatePayload: Record<string, unknown> = {
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    tier,
    cancel_at_period_end: !!sub.cancel_at_period_end,
  }
  if (currentPeriodEnd !== null) updatePayload.current_period_end = currentPeriodEnd
  if (newStatus !== null) updatePayload.subscription_status = newStatus
  if (tier === (hostRow.pending_tier as number | null) || newStatus === 'expired') {
    updatePayload.pending_tier = null
  }

  try {
    const { error: updateErr } = await admin
      .from('hosts')
      .update(updatePayload)
      .eq('id', hostId)
    if (updateErr) {
      console.error('[stripe-webhook] DB update error:', scrubKeys(String(updateErr.message ?? '')))
      return res.status(500).json({ error: 'DB update failed' })
    }
  } catch (err) {
    console.error('[stripe-webhook] DB update exception:', scrubKeys(String((err as Error).message ?? '')))
    return res.status(500).json({ error: 'DB update exception' })
  }

  // Subscription-change fan-out — parallel, each failure isolated
  const recipientEmail = hostRow.contact_email as string | null
  const hostName = hostRow.name as string | null
  const oldTier = hostRow.tier as number | null
  const oldStatus = hostRow.subscription_status as string | null
  const hadSubscription = !!(hostRow.stripe_subscription_id as string | null)
  // A test host must never be contacted. The DB update above, the admin email (d), the admin
  // push (e), ntfy (f) and the audit row (g) all still fire — the operator wants to SEE test
  // events; only the host-facing email (b) and host push (c) are suppressed.
  const isTestHost = hostRow.is_test === true
  const effectiveNewStatus = newStatus ?? oldStatus

  // The transition -> notice mapping lives in _lib/billing-notice.ts as a PURE function so it
  // can be tested without Stripe (npm run test:billing-notice). mapStatus() and the DB write
  // above are deliberately unchanged: `grace` remains the correct STORED state while a payment
  // is pending — only the message differs.
  const { notice, pendingAuthentication } = decideNotice({
    stripeStatus: sub.status ?? null,
    effectiveNewStatus,
    oldStatus,
    hadSubscription,
    // Identity, not existence: stripe_subscription_id is never cleared on cancel/expiry, so
    // `!hadSubscription` would be false for a re-subscriber and would miss their 3-D Secure
    // first payment entirely. Null column => new subscription, which is the correct reading.
    isNewSubscription: sub.id !== (hostRow.stripe_subscription_id as string | null),
    paymentIntentStatus,
    tier,
    oldTier,
  })

  if (pendingAuthentication) {
    // FIRST payment waiting on the bank's 3-D Secure step. No host notice — nothing has failed,
    // and telling a host their payment failed while their card is being authenticated is the
    // defect this branch exists to prevent. The operator still sees it, at DEFAULT priority
    // (this is not an alarm), with the host id only and no personal data — same shape as the
    // other ntfy calls in this file.
    console.log('[stripe-webhook] first payment pending authentication (incomplete), no host notice')
    await sendNtfy({
      title: 'Payment pending (3DS)',
      message: `First payment authenticating — host ${hostId}`,
      priority: 'default',
    })
  }

  if (notice !== null) {
    // 'null' literal distinguishes absent period-end from empty string in the sig
    const noticeSig = `${tier}|${effectiveNewStatus}|${currentPeriodEnd ?? 'null'}`
    const { data: claimRows, error: claimErr } = await admin
      .from('hosts')
      .update({ last_billing_notice_sig: noticeSig })
      .eq('id', hostId)
      .neq('last_billing_notice_sig', noticeSig)   // column is NOT NULL default '' — no null pitfalls
      .select('id')
    if (claimErr) console.error('[stripe-webhook] notice claim error:', scrubKeys(String(claimErr.message ?? '')))
    if (!claimErr && (claimRows?.length ?? 0) > 0) {
      const n = notice  // capture narrowed type for async closures
      const toTierName = TIER_NAMES_W[tier] ?? `Tier ${tier}`
      const fromTierName = oldTier !== null ? (TIER_NAMES_W[oldTier] ?? `Tier ${oldTier}`) : null

      // Resolve safe price — Stripe item is the primary source; DB plans is the fallback
      let priceCents = priceCentsFromStripe
      let currency = currencyFromStripe
      if (priceCents === null || currency === null) {
        const { data: planFallback } = await admin
          .from('plans')
          .select('price_cents, currency')
          .eq('tier', tier)
          .maybeSingle()
        priceCents = priceCents ?? ((planFallback as any)?.price_cents ?? null)
        currency = currency ?? ((planFallback as any)?.currency ?? null)
      }
      const safePriceCents = priceCents ?? 0
      const safeCurrency = currency ?? 'eur'
      const safeRenewalIso = currentPeriodEnd ?? new Date().toISOString()

      const HOST_PUSH: Record<NoticeType, { title: string; body: string }> = {
        started:    { title: 'Subscription active', body: `You're on the ${toTierName} plan.` },
        upgraded:   { title: `Upgraded to ${toTierName}`, body: fromTierName ? `Changed from ${fromTierName} to ${toTierName}.` : `Now on ${toTierName}.` },
        downgraded: { title: `Plan changed to ${toTierName}`, body: fromTierName ? `Changed from ${fromTierName} to ${toTierName}.` : `Now on ${toTierName}.` },
        cancelled:  { title: 'Subscription cancelled', body: 'Your guest page is no longer active.' },
        grace:      { title: 'Payment issue', body: 'Your page is still live — please update your card.' },
        recovered:  { title: 'Payment received', body: `You're on the ${toTierName} plan — your guest pages are live.` },
      }
      const ADMIN_MSG: Record<NoticeType, string> = {
        started:    `A host subscribed to ${toTierName}`,
        upgraded:   `A host upgraded to ${toTierName}`,
        downgraded: `A host downgraded to ${toTierName}`,
        cancelled:  'A host cancelled their subscription',
        grace:      "A host's payment failed",
        recovered:  "A host's pending payment went through",
      }
      const { title: hostPushTitle, body: hostPushBody } = HOST_PUSH[n]
      const adminMsg = ADMIN_MSG[n]
      const ntfyPriority: 'high' | 'default' = (n === 'grace' || n === 'cancelled') ? 'high' : 'default'

      await Promise.allSettled([
        // a) billing_notice — server-only JSONB column, service-role write
        admin.from('hosts').update({
          billing_notice: { type: n, from_tier: oldTier, to_tier: tier, at: new Date().toISOString() },
        }).eq('id', hostId),

        // b) host lifecycle email
        (async () => {
          if (!recipientEmail || isTestHost) return
          const tmpl =
            n === 'started'
              ? subscriptionStartedEmail(hostName, tier, { priceCents: safePriceCents, currency: safeCurrency, nextPaymentIso: safeRenewalIso })
              : n === 'upgraded' || n === 'downgraded'
              ? subscriptionChangedEmail(hostName, oldTier ?? tier, tier, {
                  priceCents: safePriceCents,
                  currency: safeCurrency,
                  renewalIso: safeRenewalIso,
                  amountChargedCents: n === 'upgraded' ? amountChargedCents : undefined,
                })
              : n === 'cancelled'
              ? subscriptionCancelledEmail(hostName, { endedIso: currentPeriodEnd })
              : n === 'recovered'
              ? subscriptionRecoveredEmail(hostName, tier, { priceCents: safePriceCents, currency: safeCurrency, nextPaymentIso: safeRenewalIso })
              : subscriptionPastDueEmail(hostName)
          await sendEmail({ to: recipientEmail, ...tmpl })
        })(),

        // c) host push
        isTestHost
          ? Promise.resolve()
          : sendPushToHost(admin, hostId, { title: hostPushTitle, body: hostPushBody, url: '/dashboard/billing' }),

        // d) admin event email
        sendEmail({
          to: ADMIN_EMAIL,
          ...adminSubscriptionEventEmail({
            event: n,
            hostName,
            hostEmail: recipientEmail,
            hostId,
            fromTier: oldTier,
            toTier: tier,
            status: effectiveNewStatus ?? 'unknown',
            priceCents: safePriceCents,
            currency: safeCurrency,
            amountChargedCents: n === 'upgraded' ? amountChargedCents : null,
            renewalIso: safeRenewalIso,
          }),
        }),

        // e) admin push — resolve admin host row first
        (async () => {
          const { data: adminHost } = await admin
            .from('hosts')
            .select('id')
            .eq('contact_email', ADMIN_EMAIL)
            .maybeSingle()
          if (!adminHost?.id) return
          await sendPushToHost(admin, adminHost.id as string, {
            title: 'Bemgu subscription',
            body: adminMsg,
            url: '/admin',
          })
        })(),

        // f) ntfy — enriched for upgrades with charged amount (guard > 0 so €0 proration shows plain text)
        sendNtfy({
          title: 'Bemgu',
          message: n === 'upgraded' && amountChargedCents != null && amountChargedCents > 0
            ? `A host upgraded to ${toTierName} — ${formatMoney(amountChargedCents, safeCurrency)} charged, ${formatMoney(safePriceCents, safeCurrency)}/mo`
            : adminMsg,
          priority: ntfyPriority,
        }),

        // g) audit
        admin.from('admin_audit').insert({
          actor_email: 'stripe-webhook',
          action: 'subscription_event',
          target_host_id: hostId,
          detail: { event: n, from_tier: oldTier, to_tier: tier, status: effectiveNewStatus, sub_id: sub.id },
        }),
      ])
    }
  }

  return res.status(200).json({ received: true })
}
