import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { getStripe, priceIdForTier, tierForPriceId, ARRIVLY_STRIPE_METADATA } from './_lib/stripe.js'
import { sendEmail, formatMoney, subscriptionScheduledChangeEmail, subscriptionChangeRevertedEmail, adminSubscriptionRequestEmail } from './_lib/email.js'
import { sendNtfy } from './_lib/ntfy.js'

const ADMIN_EMAIL = 'udy.bar.yosef@gmail.com'
const TIER_NAMES_C: Record<number, string> = { 1: 'Starter', 2: 'Growth', 3: 'Portfolio', 4: 'Pro' }

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
      .select('stripe_subscription_id, subscription_status, tier, pending_tier, name, contact_email')
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
        // B-1) Revert: release the schedule so the sub continues as-is, then send emails
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
        const contactEmail = host.contact_email as string | null
        const hostNameR = host.name as string | null
        const renewalIsoR = periodEndUnix
          ? new Date(periodEndUnix * 1000).toISOString()
          : new Date().toISOString()
        const { data: currentPlanData } = await admin
          .from('plans')
          .select('price_cents, currency')
          .eq('tier', currentTier)
          .maybeSingle()
        const revertPriceCents = (currentPlanData as any)?.price_cents ?? 0
        const revertCurrency = (currentPlanData as any)?.currency ?? 'eur'
        await Promise.allSettled([
          ...(contactEmail ? [sendEmail({
            to: contactEmail,
            ...subscriptionChangeRevertedEmail(hostNameR, currentTier, {
              priceCents: revertPriceCents,
              currency: revertCurrency,
              renewalIso: renewalIsoR,
            }),
          })] : []),
          sendEmail({
            to: ADMIN_EMAIL,
            ...adminSubscriptionRequestEmail({
              event: 'reverted',
              hostName: hostNameR,
              hostEmail: contactEmail,
              hostId: userId,
              fromTier: pendingTier,
              toTier: currentTier,
              priceCents: revertPriceCents,
              currency: revertCurrency,
            }),
          }),
          sendNtfy({
            title: 'Bemgu',
            message: `${hostNameR ?? 'A host'} undid a scheduled change — staying on ${TIER_NAMES_C[currentTier] ?? `Tier ${currentTier}`}`,
            priority: 'default',
          }),
        ])
        return res.status(200).json({ mode: 'reverted' })

      } else if (newTier > currentTier) {
        // B-2) Upgrade: apply immediately with proration; no request-time email (webhook fans out on apply)
        // Release any pending downgrade schedule first
        const rawSchedule = sub.schedule as Stripe.SubscriptionSchedule | string | null
        if (rawSchedule) {
          const scheduleId = typeof rawSchedule === 'string' ? rawSchedule : (rawSchedule as Stripe.SubscriptionSchedule).id
          await stripe.subscriptionSchedules.release(scheduleId)
          // Note: if payment then fails, the pending downgrade schedule is gone but tier is unchanged (acceptable, low-frequency)
        }
        try {
          await stripe.subscriptions.update(sub.id, {
            items: [{ id: currentItemId, price: priceIdForTier(newTier) }],
            proration_behavior: 'always_invoice',
            payment_behavior: 'error_if_incomplete',
            metadata: {
              ...(sub.metadata as Record<string, string>),
              app: ARRIVLY_STRIPE_METADATA.app,
              tier: String(newTier),
            },
          })
        } catch (upgradeErr) {
          const isPaymentErr =
            (upgradeErr as any)?.type === 'card_error' ||
            (upgradeErr as any)?.code === 'card_declined' ||
            (upgradeErr as any)?.code === 'invoice_payment_failed' ||
            (upgradeErr as any)?.statusCode === 402
          if (isPaymentErr) return res.status(402).json({ error: 'payment_failed' })
          throw upgradeErr
        }
        // Webhook writes tier after payment confirms; clear only pending_tier here
        const { error: dbErrU } = await admin.from('hosts').update({ pending_tier: null }).eq('id', userId)
        if (dbErrU) console.error('[change-plan] pending_tier clear failed:', String(dbErrU.message).slice(0, 120))
        return res.status(200).json({ mode: 'immediate' })

      } else {
        // B-3) Downgrade: defer via subscription schedule, then send emails
        let schedule: Stripe.SubscriptionSchedule
        const rawSchedule = sub.schedule as Stripe.SubscriptionSchedule | string | null
        if (!rawSchedule) {
          schedule = await stripe.subscriptionSchedules.create({ from_subscription: sub.id })
        } else if (typeof rawSchedule === 'string') {
          schedule = await stripe.subscriptionSchedules.retrieve(rawSchedule)
        } else {
          schedule = rawSchedule
        }

        // Use the schedule's own first phase verbatim so phase 1 ends at the REAL
        // current-period boundary (end_date). iterations:1 from a historical start_date
        // was applying the new price immediately in production.
        const p0 = schedule.phases[0]
        if (!p0) {
          return res.status(409).json({ error: 'schedule_phase_unavailable' })
        }
        const p0Items = p0.items.map(item => ({
          price: typeof item.price === 'string' ? item.price : (item.price as Stripe.Price).id,
          quantity: item.quantity ?? 1,
        }))
        const rawEndDate = p0.end_date as number | null | undefined
        const fallbackEndDate = Math.floor(Date.now() / 1000) + 2592000
        const phaseEndDate: number = rawEndDate ?? periodEndUnix ?? fallbackEndDate
        if (phaseEndDate === fallbackEndDate) {
          console.warn('[change-plan] phaseEndDate fallback triggered — using now+30d; sub:', sub.id)
        }

        await stripe.subscriptionSchedules.update(schedule.id, {
          phases: [
            {
              items: p0Items,
              start_date: p0.start_date as any,
              end_date: phaseEndDate as any,
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

        const effectiveAt = new Date(phaseEndDate * 1000).toISOString()

        // Query cap + price data and send request-time emails
        const [{ data: newPlanData }, { count: aptCount }] = await Promise.all([
          admin.from('plans').select('max_properties, price_cents, currency').eq('tier', newTier).maybeSingle(),
          admin.from('apartments').select('id', { count: 'exact', head: true }).eq('host_id', userId),
        ])
        const newCap = (newPlanData as any)?.max_properties ?? null
        const newPlanPriceCents = (newPlanData as any)?.price_cents ?? 0
        const newPlanCurrency = (newPlanData as any)?.currency ?? 'eur'
        const propertyCount = aptCount ?? 0
        const contactEmailD = host.contact_email as string | null
        const hostNameD = host.name as string | null
        await Promise.allSettled([
          ...(contactEmailD ? [sendEmail({
            to: contactEmailD,
            ...subscriptionScheduledChangeEmail(
              hostNameD,
              currentTier,
              newTier,
              effectiveAt,
              { priceCents: newPlanPriceCents, currency: newPlanCurrency, propertyCount, newCap },
            ),
          })] : []),
          sendEmail({
            to: ADMIN_EMAIL,
            ...adminSubscriptionRequestEmail({
              event: 'scheduled_downgrade',
              hostName: hostNameD,
              hostEmail: contactEmailD,
              hostId: userId,
              fromTier: currentTier,
              toTier: newTier,
              effectiveAt,
              priceCents: newPlanPriceCents,
              currency: newPlanCurrency,
            }),
          }),
          sendNtfy({
            title: 'Bemgu',
            message: `${hostNameD ?? 'A host'} scheduled a downgrade to ${TIER_NAMES_C[newTier] ?? `Tier ${newTier}`} (${formatMoney(newPlanPriceCents, newPlanCurrency)}/mo) — effective ${effectiveAt.split('T')[0]}`,
            priority: 'default',
          }),
        ])

        return res.status(200).json({ mode: 'scheduled', effective_at: effectiveAt })
      }

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
