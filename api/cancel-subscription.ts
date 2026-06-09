import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { getStripe, ARRIVLY_STRIPE_METADATA } from './_lib/stripe.js'
import { sendEmail, subscriptionScheduledCancelEmail, subscriptionResumedEmail, adminSubscriptionRequestEmail } from './_lib/email.js'
import { sendNtfy } from './_lib/ntfy.js'

const ADMIN_EMAIL = 'udy.bar.yosef@gmail.com'

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

  const { resume } = (req.body ?? {}) as { resume?: unknown }
  if (typeof resume !== 'undefined' && typeof resume !== 'boolean') {
    return res.status(400).json({ error: 'resume must be a boolean' })
  }

  try {
    const admin = createClient(supabaseUrl, serviceKey)

    const { data: host } = await admin
      .from('hosts')
      .select('stripe_subscription_id, name, contact_email, tier')
      .eq('id', userId)
      .maybeSingle()

    if (!host) return res.status(404).json({ error: 'host_not_found' })
    if (!host.stripe_subscription_id) return res.status(400).json({ error: 'no_subscription' })

    const stripe = getStripe()
    const sub = await stripe.subscriptions.retrieve(host.stripe_subscription_id as string)

    if (sub.metadata?.app !== ARRIVLY_STRIPE_METADATA.app) {
      return res.status(403).json({ error: 'subscription_not_arrivly' })
    }

    if (resume === true) {
      await stripe.subscriptions.update(sub.id, { cancel_at_period_end: false })
      const { error: dbErrRes } = await admin.from('hosts').update({ cancel_at_period_end: false }).eq('id', userId)
      if (dbErrRes) console.error('[cancel-subscription] cancel_at_period_end clear failed:', String(dbErrRes.message).slice(0, 120))
      const contactEmailR = host.contact_email as string | null
      const currentTierR = host.tier as number | null
      const resumePeriodEndUnix: number | null =
        (sub.items?.data?.[0] as any)?.current_period_end ??
        (sub as any).current_period_end ??
        null
      const renewalIsoR = resumePeriodEndUnix
        ? new Date(resumePeriodEndUnix * 1000).toISOString()
        : new Date().toISOString()
      let resumePriceCents: number | null = null
      let resumeCurrency: string | null = null
      if (currentTierR !== null) {
        const { data: resumePlanData } = await admin
          .from('plans')
          .select('price_cents, currency')
          .eq('tier', currentTierR)
          .maybeSingle()
        resumePriceCents = (resumePlanData as any)?.price_cents ?? null
        resumeCurrency = (resumePlanData as any)?.currency ?? null
      }
      const hostNameR = host.name as string | null
      await Promise.allSettled([
        ...(contactEmailR ? [sendEmail({
          to: contactEmailR,
          ...subscriptionResumedEmail(hostNameR, {
            priceCents: resumePriceCents,
            currency: resumeCurrency,
            renewalIso: renewalIsoR,
          }),
        })] : []),
        sendEmail({
          to: ADMIN_EMAIL,
          ...adminSubscriptionRequestEmail({
            event: 'resumed',
            hostName: hostNameR,
            hostEmail: contactEmailR,
            hostId: userId,
            fromTier: currentTierR,
            toTier: currentTierR,
            priceCents: resumePriceCents,
            currency: resumeCurrency,
          }),
        }),
        sendNtfy({
          title: 'Arrivly',
          message: `${hostNameR ?? 'A host'} resumed their subscription`,
          priority: 'default',
        }),
      ])
      return res.status(200).json({ resumed: true })
    }

    // If a pending tier-change schedule is attached, reject — host must cancel the pending change first
    if (sub.schedule) {
      return res.status(409).json({ error: 'pending_change_in_progress' })
    }

    await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true })
    const { error: dbErrCan } = await admin.from('hosts').update({ cancel_at_period_end: true }).eq('id', userId)
    if (dbErrCan) console.error('[cancel-subscription] cancel_at_period_end set failed:', String(dbErrCan.message).slice(0, 120))

    const periodEndUnix: number | null =
      (sub.items?.data?.[0] as any)?.current_period_end ??
      (sub as any).current_period_end ??
      null
    const cancelAt = periodEndUnix
      ? new Date(periodEndUnix * 1000).toISOString()
      : null

    const contactEmailC = host.contact_email as string | null
    const hostNameC = host.name as string | null
    await Promise.allSettled([
      ...(contactEmailC ? [sendEmail({
        to: contactEmailC,
        ...subscriptionScheduledCancelEmail(hostNameC, cancelAt),
      })] : []),
      sendEmail({
        to: ADMIN_EMAIL,
        ...adminSubscriptionRequestEmail({
          event: 'scheduled_cancel',
          hostName: hostNameC,
          hostEmail: contactEmailC,
          hostId: userId,
          fromTier: (host.tier as number | null),
          toTier: null,
          effectiveAt: cancelAt,
        }),
      }),
      sendNtfy({
        title: 'Arrivly',
        message: `${hostNameC ?? 'A host'} scheduled a cancellation${cancelAt ? ` — effective ${cancelAt.split('T')[0]}` : ''}`,
        priority: 'high',
      }),
    ])

    return res.status(200).json({ cancel_at: cancelAt })

  } catch (err) {
    const msg = String((err as Error).message ?? '')
      .replace(/sk_[a-zA-Z0-9_]+/gi, 'sk_REDACTED')
      .replace(/whsec_[a-zA-Z0-9_]+/gi, 'whsec_REDACTED')
      .slice(0, 120)
    console.error('[cancel-subscription] error —', msg)
    return res.status(500).json({ error: 'cancel_failed' })
  }
}
