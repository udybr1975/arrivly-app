import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { getStripe, priceIdForTier, ARRIVLY_STRIPE_METADATA } from './_lib/stripe.js'

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

    const { data: host } = await admin
      .from('hosts')
      .select('stripe_customer_id, contact_email, trial_ends_at, subscription_status')
      .eq('id', userId)
      .maybeSingle()

    if (!host) return res.status(404).json({ error: 'host_not_found' })

    const stripe = getStripe()

    // Find-or-create Stripe customer
    let customerId = (host.stripe_customer_id as string | null) ?? null
    if (!customerId) {
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
    const msg = String((err as Error).message ?? '')
      .replace(/sk_[a-zA-Z0-9_]+/gi, 'sk_REDACTED')
      .slice(0, 120)
    console.error('[create-subscription] error —', msg)
    return res.status(500).json({ error: 'subscription_failed' })
  }
}
