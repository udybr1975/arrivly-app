import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { getStripe, tierForPriceId, ARRIVLY_STRIPE_METADATA } from './_lib/stripe.js'
import {
  sendEmail,
  formatMoney,
  subscriptionStartedEmail,
  subscriptionChangedEmail,
  subscriptionCancelledEmail,
  subscriptionPastDueEmail,
  adminSubscriptionEventEmail,
} from './_lib/email.js'
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
    // invoice.*
    const s = obj.subscription
    subId = typeof s === 'string' ? s : null
  }

  if (!subId) {
    console.log('[stripe-webhook] no subscription id in event:', stripeEvent.type)
    return res.status(200).json({ ignored: true })
  }

  // Retrieve live subscription — idempotency + out-of-order safety
  let sub: Stripe.Subscription
  try {
    sub = await getStripe().subscriptions.retrieve(subId, { expand: ['latest_invoice'] })
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
    .select('tier,subscription_status,stripe_subscription_id,contact_email,name,pending_tier')
    .eq('id', hostId)
    .maybeSingle()

  if (!hostRow) {
    console.log('[stripe-webhook] host row not found:', hostId)
    return res.status(200).json({ ignored: true })
  }

  const newStatus = mapStatus(sub.status)
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
  const effectiveNewStatus = newStatus ?? oldStatus

  type NoticeType = 'started' | 'upgraded' | 'downgraded' | 'cancelled' | 'grace'
  const liveNow = effectiveNewStatus === 'active' || effectiveNewStatus === 'trial'
  let notice: NoticeType | null = null
  if (effectiveNewStatus === 'expired' && oldStatus !== 'expired') {
    notice = 'cancelled'                       // a cancellation is ALWAYS a cancellation
  } else if (effectiveNewStatus === 'grace' && oldStatus !== 'grace') {
    notice = 'grace'
  } else if (liveNow && (oldStatus === 'expired' || oldStatus == null || !hadSubscription)) {
    notice = 'started'                         // fresh subscribe OR re-subscribe after expiry
  } else if (liveNow && oldTier !== null && tier !== oldTier) {
    notice = tier > oldTier ? 'upgraded' : 'downgraded'   // only on a LIVE sub
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
      }
      const ADMIN_MSG: Record<NoticeType, string> = {
        started:    `A host subscribed to ${toTierName}`,
        upgraded:   `A host upgraded to ${toTierName}`,
        downgraded: `A host downgraded to ${toTierName}`,
        cancelled:  'A host cancelled their subscription',
        grace:      "A host's payment failed",
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
          if (!recipientEmail) return
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
              : subscriptionPastDueEmail(hostName)
          await sendEmail({ to: recipientEmail, ...tmpl })
        })(),

        // c) host push
        sendPushToHost(admin, hostId, { title: hostPushTitle, body: hostPushBody, url: '/dashboard/billing' }),

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
            title: 'Arrivly subscription',
            body: adminMsg,
            url: '/admin',
          })
        })(),

        // f) ntfy — enriched for upgrades with charged amount (guard > 0 so €0 proration shows plain text)
        sendNtfy({
          title: 'Arrivly',
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
