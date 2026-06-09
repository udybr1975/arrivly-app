import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { getStripe, priceIdForTier, tierForPriceId, ARRIVLY_STRIPE_METADATA } from './_lib/stripe.js'

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

  const { tier } = (req.body ?? {}) as { tier?: unknown }
  if (!Number.isInteger(tier) || (tier as number) < 1 || (tier as number) > 4) {
    return res.status(400).json({ error: 'tier must be an integer 1–4' })
  }
  if ((tier as number) === 4) {
    return res.status(403).json({ error: 'booking_tier_unavailable' })
  }
  const newTier = tier as number

  try {
    const admin = createClient(supabaseUrl, serviceKey)

    const { data: host } = await admin
      .from('hosts')
      .select('stripe_subscription_id, subscription_status, tier, pending_tier')
      .eq('id', userId)
      .maybeSingle()

    if (!host) return res.status(404).json({ error: 'host_not_found' })
    if (!host.stripe_subscription_id) return res.status(400).json({ error: 'no_subscription' })

    const stripe = getStripe()
    const sub = await stripe.subscriptions.retrieve(
      host.stripe_subscription_id as string,
      { expand: ['schedule'] },
    )

    if (sub.metadata?.app !== ARRIVLY_STRIPE_METADATA.app) {
      return res.status(403).json({ error: 'subscription_not_arrivly' })
    }

    const currentItemId = sub.items.data[0].id
    const currentPriceId = sub.items.data[0].price.id
    const currentTier = tierForPriceId(currentPriceId)
    if (currentTier === null) {
      return res.status(400).json({ error: 'unknown_current_price' })
    }

    const pendingTier = (host.pending_tier as number | null) ?? null

    if (newTier === currentTier && pendingTier === null) {
      // Allow fall-through for active subs with a dangling schedule so the revert path can release it
      const rawScheduleCheck = sub.schedule as Stripe.SubscriptionSchedule | string | null
      if (!rawScheduleCheck || sub.status !== 'active') {
        return res.status(400).json({ error: 'already_on_tier' })
      }
    }

    const periodEndUnix: number | null =
      (sub.items?.data?.[0] as any)?.current_period_end ??
      (sub as any).current_period_end ??
      null

    if (sub.status === 'trialing') {
      // A) Immediate switch — no charge during trial; new price applies at trial end
      await stripe.subscriptions.update(sub.id, {
        items: [{ id: currentItemId, price: priceIdForTier(newTier) }],
        proration_behavior: 'none',
        metadata: {
          ...(sub.metadata as Record<string, string>),
          app: ARRIVLY_STRIPE_METADATA.app,
          tier: String(newTier),
        },
      })
      const { error: dbErrA } = await admin.from('hosts').update({ pending_tier: null }).eq('id', userId)
      if (dbErrA) console.error('[change-plan] pending_tier clear failed:', String(dbErrA.message).slice(0, 120))
      return res.status(200).json({ mode: 'immediate' })

    } else if (sub.status === 'active') {
      if (newTier === currentTier) {
        // Revert a previously-scheduled change: release the schedule so the sub continues as-is
        const rawSchedule = sub.schedule as Stripe.SubscriptionSchedule | string | null
        const scheduleId: string | null =
          rawSchedule === null ? null
          : typeof rawSchedule === 'string' ? rawSchedule
          : rawSchedule.id
        if (scheduleId) {
          await stripe.subscriptionSchedules.release(scheduleId)
        }
        const { error: dbErrR } = await admin.from('hosts').update({ pending_tier: null }).eq('id', userId)
        if (dbErrR) console.error('[change-plan] pending_tier clear failed:', String(dbErrR.message).slice(0, 120))
        return res.status(200).json({ mode: 'reverted' })
      }

      // Defer the switch to the next period boundary via a subscription schedule
      let schedule: Stripe.SubscriptionSchedule
      const rawSchedule = sub.schedule as Stripe.SubscriptionSchedule | string | null
      if (!rawSchedule) {
        schedule = await stripe.subscriptionSchedules.create({ from_subscription: sub.id })
      } else if (typeof rawSchedule === 'string') {
        schedule = await stripe.subscriptionSchedules.retrieve(rawSchedule)
      } else {
        schedule = rawSchedule
      }

      const phaseStartDate: number | 'now' = schedule.current_phase?.start_date ?? 'now'

      await stripe.subscriptionSchedules.update(schedule.id, {
        phases: [
          {
            items: [{ price: currentPriceId, quantity: 1 }],
            start_date: phaseStartDate as any,
            iterations: 1,
          },
          {
            items: [{ price: priceIdForTier(newTier), quantity: 1 }],
            metadata: { app: ARRIVLY_STRIPE_METADATA.app, host_id: userId, tier: String(newTier) },
          },
        ],
        end_behavior: 'release',
        metadata: { app: ARRIVLY_STRIPE_METADATA.app, host_id: userId },
      })

      const { error: dbErrS } = await admin.from('hosts').update({ pending_tier: newTier }).eq('id', userId)
      if (dbErrS) console.error('[change-plan] pending_tier set failed:', String(dbErrS.message).slice(0, 120))

      const effectiveAt = periodEndUnix
        ? new Date(periodEndUnix * 1000).toISOString()
        : null

      return res.status(200).json({ mode: 'scheduled', effective_at: effectiveAt })

    } else {
      // grace / past_due / expired / canceled — must fix payment or re-subscribe first
      return res.status(409).json({ error: 'not_switchable' })
    }

  } catch (err) {
    const msg = String((err as Error).message ?? '')
      .replace(/sk_[a-zA-Z0-9_]+/gi, 'sk_REDACTED')
      .replace(/whsec_[a-zA-Z0-9_]+/gi, 'whsec_REDACTED')
      .slice(0, 120)
    console.error('[change-plan] error —', msg)
    return res.status(500).json({ error: 'change_failed' })
  }
}
