import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { getStripe, tierForPriceId, ARRIVLY_STRIPE_METADATA } from './_lib/stripe.js'
import {
  sendEmail,
  subscriptionStartedEmail,
  subscriptionChangedEmail,
  subscriptionCancelledEmail,
} from './_lib/email.js'

export const config = { api: { bodyParser: false } }

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
    sub = await getStripe().subscriptions.retrieve(subId)
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
    .select('tier,subscription_status,stripe_subscription_id,contact_email,name')
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

  const customerId = typeof sub.customer === 'string'
    ? sub.customer
    : (sub.customer as Stripe.Customer | Stripe.DeletedCustomer).id

  const updatePayload: Record<string, unknown> = {
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    tier,
  }
  if (currentPeriodEnd !== null) updatePayload.current_period_end = currentPeriodEnd
  if (newStatus !== null) updatePayload.subscription_status = newStatus

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

  // Lifecycle emails — fire-and-forget, never throw
  const recipientEmail = hostRow.contact_email as string | null
  const hostName = hostRow.name as string | null
  const oldTier = hostRow.tier as number | null
  const oldStatus = hostRow.subscription_status as string | null
  const hadSubscription = !!(hostRow.stripe_subscription_id as string | null)

  if (recipientEmail) {
    try {
      if (
        (stripeEvent.type === 'checkout.session.completed' ||
          stripeEvent.type === 'customer.subscription.created') &&
        !hadSubscription
      ) {
        void sendEmail({ to: recipientEmail, ...subscriptionStartedEmail(hostName, tier) })
      } else if (
        stripeEvent.type === 'customer.subscription.updated' &&
        oldTier !== null &&
        oldTier !== tier
      ) {
        void sendEmail({ to: recipientEmail, ...subscriptionChangedEmail(hostName, oldTier, tier) })
      } else if (
        stripeEvent.type === 'customer.subscription.deleted' &&
        oldStatus !== 'expired'
      ) {
        void sendEmail({ to: recipientEmail, ...subscriptionCancelledEmail(hostName) })
      }
    } catch {
      // intentionally swallowed — email failures must not block the webhook response
    }
  }

  return res.status(200).json({ received: true })
}
