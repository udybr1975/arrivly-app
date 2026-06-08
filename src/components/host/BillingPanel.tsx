import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import { TIER_COPY } from '../../lib/tierCopy'
import Loader from '../shared/Loader'

interface BillingNotice {
  type: 'started' | 'upgraded' | 'downgraded' | 'cancelled' | 'grace'
  from_tier: number | null
  to_tier: number
  at: string
}

interface HostData {
  tier: number | null
  trial_ends_at: string | null
  subscription_status: string | null
  billing_notice: BillingNotice | null
}

interface Plan {
  tier: number
  label: string
  price_cents: number
  currency: string
  max_properties: number | null
  includes_booking: boolean
}

function currencySymbol(code: string): string {
  const map: Record<string, string> = { eur: '€', usd: '$', gbp: '£' }
  return map[code.toLowerCase()] ?? code.toUpperCase()
}

type BannerStyle = { bg: string; border: string; heading: string; muted: string }
const GREEN: BannerStyle = { bg: 'bg-[#e4f0da]', border: 'border-[#b8d9a0]', heading: 'text-[#2a5c0a]', muted: 'text-[#2a5c0a]/70' }
const AMBER: BannerStyle = { bg: 'bg-[#faeeda]', border: 'border-[#e8d0a0]', heading: 'text-[#7a4800]', muted: 'text-[#7a4800]/70' }
const RED: BannerStyle  = { bg: 'bg-[#fde4e4]', border: 'border-[#f5c6c6]', heading: 'text-[#8a1a1a]', muted: 'text-[#8a1a1a]/70' }

const TIER_NAMES: Record<number, string> = { 1: 'Starter', 2: 'Growth', 3: 'Portfolio', 4: 'Pro' }

function bannerConfig(notice: BillingNotice): { heading: string; body: string; style: BannerStyle } {
  const from = notice.from_tier !== null ? (TIER_NAMES[notice.from_tier] ?? `Tier ${notice.from_tier}`) : null
  const to = TIER_NAMES[notice.to_tier] ?? `Tier ${notice.to_tier}`
  switch (notice.type) {
    case 'started':    return { heading: `You're on the ${to} plan`, body: 'Your subscription is active.', style: GREEN }
    case 'upgraded':   return { heading: `Upgraded to ${to}`, body: from ? `Changed from ${from} to ${to}.` : `Now on ${to}.`, style: GREEN }
    case 'downgraded': return { heading: `Plan changed to ${to}`, body: from ? `Changed from ${from} to ${to}.` : `Now on ${to}.`, style: AMBER }
    case 'cancelled':  return { heading: 'Subscription cancelled', body: 'Your guest page is no longer active. Reactivate anytime.', style: RED }
    case 'grace':      return { heading: 'Payment issue', body: 'Your page is still live — please update your card.', style: RED }
  }
}

export default function BillingPanel() {
  const [host, setHost] = useState<HostData | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [plansError, setPlansError] = useState(false)
  const [pendingTier, setPendingTier] = useState<number | null>(null)
  const [ctaError, setCtaError] = useState<string | null>(null)
  const [managingPortal, setManagingPortal] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)
  const [checkoutResult, setCheckoutResult] = useState<'success' | 'cancelled' | null>(null)
  const [dismissing, setDismissing] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('checkout')
    if (result === 'success' || result === 'cancelled') {
      setCheckoutResult(result)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const [{ data: hostData }, { data: plansData, error: plansErr }] = await Promise.all([
        supabase
          .from('hosts')
          .select('tier, trial_ends_at, subscription_status, billing_notice')
          .eq('id', user.id)
          .maybeSingle(),
        supabase
          .from('plans')
          .select('tier, label, price_cents, currency, max_properties, includes_booking')
          .order('tier', { ascending: true }),
      ])
      setHost(hostData as HostData | null)
      if (plansErr) {
        setPlansError(true)
      } else {
        setPlans(plansData ?? [])
      }
      setLoading(false)
    }
    load()
  }, [])

  async function handleChoosePlan(tier: number) {
    setPendingTier(tier)
    setCtaError(null)
    try {
      const data = await api.post<{ url: string }>('/create-subscription', { tier })
      if (!data.url) throw new Error('no checkout url')
      window.location.href = data.url
    } catch {
      setCtaError('Something went wrong. Please try again.')
      setPendingTier(null)
    }
  }

  async function handleManagePortal() {
    setManagingPortal(true)
    setPortalError(null)
    try {
      const data = await api.post<{ url: string }>('/billing-portal', {})
      if (!data.url) throw new Error('no portal url')
      window.location.href = data.url
    } catch {
      setPortalError('Could not open the billing portal. Please try again.')
      setManagingPortal(false)
    }
  }

  async function handleDismissNotice() {
    setDismissing(true)
    try {
      await api.post('/dismiss-billing-notice', {})
      setHost(prev => prev ? { ...prev, billing_notice: null } : null)
    } catch {
      // swallow — banner stays visible on failure
    } finally {
      setDismissing(false)
    }
  }

  if (loading) return <Loader />

  const status = host?.subscription_status ?? 'trial'
  const hostTier = host?.tier ?? null
  const trialEndsAt = host?.trial_ends_at ?? null
  const trialRemaining = trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : 0
  const trialEndDate = trialEndsAt
    ? new Date(trialEndsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null
  const isManaged = status === 'active' || status === 'grace'
  const billingNotice = host?.billing_notice ?? null

  return (
    <div className="max-w-2xl">
      <h1 className="text-[17px] font-serif font-light text-[#1a1a1a] mb-4">Billing</h1>

      {billingNotice && (() => {
        const { heading, body, style } = bannerConfig(billingNotice)
        return (
          <div className={`${style.bg} border ${style.border} rounded-[10px] p-4 mb-5 flex items-start justify-between gap-3`}>
            <div>
              <div className={`text-[13px] font-semibold ${style.heading} mb-0.5`}>{heading}</div>
              {body && <div className={`text-[11px] ${style.muted}`}>{body}</div>}
            </div>
            <button
              onClick={handleDismissNotice}
              disabled={dismissing}
              aria-label="Dismiss"
              className={`shrink-0 ${style.heading} opacity-50 hover:opacity-100 text-lg leading-none bg-transparent border-none cursor-pointer disabled:cursor-not-allowed`}
            >
              &times;
            </button>
          </div>
        )
      })()}

      {checkoutResult === 'success' && (
        <div className="bg-[#e4f0da] border border-[#b8d9a0] rounded-[10px] p-4 mb-5">
          <div className="text-[13px] font-semibold text-[#2a5c0a] mb-0.5">You're all set</div>
          <div className="text-[11px] text-[#2a5c0a]/80">Thanks — your plan is being set up.</div>
        </div>
      )}

      {checkoutResult === 'cancelled' && (
        <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 mb-5">
          <div className="text-[11px] text-[#888]">Checkout cancelled — no changes were made.</div>
        </div>
      )}

      {status === 'trial' && host !== null && (
        <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 mb-5">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[13px] font-semibold text-[#1a1a1a]">Free trial</div>
            <span className="text-[10px] bg-[#dceef8] text-[#0c3d70] px-2 py-0.5 rounded-full font-medium">Trial</span>
          </div>
          <div className="text-[11px] text-[#888]">
            {trialRemaining > 0
              ? `${trialRemaining} day${trialRemaining !== 1 ? 's' : ''} left`
              : 'Trial period complete'}
            {trialEndDate && ` · ends ${trialEndDate}`}
          </div>
        </div>
      )}

      {status === 'active' && (
        <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 mb-5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[#1a1a1a]">
              {hostTier !== null ? (TIER_COPY[hostTier as 1 | 2 | 3 | 4]?.name ?? 'Active') : 'Active'} plan
            </span>
            <span className="text-[10px] bg-[#e4f0da] text-[#2a5c0a] px-2 py-0.5 rounded-full font-medium">Active</span>
          </div>
        </div>
      )}

      {(status === 'grace' || status === 'expired') && (
        <div className="bg-[#fde4e4] border border-[#f5c6c6] rounded-[10px] p-4 mb-5">
          <div className="text-[13px] font-semibold text-[#8a1a1a] mb-1">
            {status === 'grace' ? 'Payment failed — grace period' : 'Subscription inactive'}
          </div>
          <div className="text-[11px] text-[#8a1a1a]/70">Add a payment method to restore access.</div>
        </div>
      )}

      {isManaged && (
        <div className="mb-5">
          <button
            onClick={handleManagePortal}
            disabled={managingPortal}
            className="bg-[#1a1a1a] text-white rounded-[8px] px-4 py-[10px] text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {managingPortal ? 'Opening…' : 'Manage subscription'}
          </button>
          {portalError && (
            <div className="mt-2 text-[11px] text-[#8a1a1a]">{portalError}</div>
          )}
        </div>
      )}

      {plansError && (
        <div className="bg-[#fde4e4] border border-[#f5c6c6] rounded-[10px] p-4 text-[11px] text-[#8a1a1a] mb-4">
          Could not load plan details — please refresh to try again.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {plans.map(plan => {
          const copy = TIER_COPY[plan.tier as 1 | 2 | 3 | 4]
          if (!copy) return null
          const isCurrentPlan = plan.tier === hostTier && (isManaged || status === 'trial')
          const isMostPopular = !!copy.mostPopular
          const sym = currencySymbol(plan.currency)
          const price = `${sym}${(plan.price_cents / 100).toFixed(0)}`
          const capacity = plan.max_properties === null
            ? 'Unlimited properties'
            : `Up to ${plan.max_properties} ${plan.max_properties === 1 ? 'property' : 'properties'}`

          return (
            <div
              key={plan.tier}
              className={`bg-white rounded-[10px] p-4 flex flex-col relative ${
                isMostPopular ? 'border-2 border-[#1a1a1a]' : 'border border-[#ddd8ce]'
              }`}
            >
              {isMostPopular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#1a1a1a] text-white text-[10px] font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap">
                  Most popular
                </span>
              )}

              <div className="mb-3">
                <div className="text-[10px] uppercase tracking-[.06em] text-[#999] mb-0.5">{copy.name}</div>
                <div className="text-[22px] font-serif font-light text-[#1a1a1a] leading-none">
                  {price}<span className="text-[12px] text-[#888] font-sans font-normal">/mo</span>
                </div>
              </div>

              <p className="text-[11px] text-[#666] leading-relaxed mb-3">{copy.tagline}</p>

              <div className="border border-[#ddd8ce] rounded-[7px] px-3 py-1.5 text-[11px] text-[#444] mb-3">
                {capacity}
              </div>

              <ul className="space-y-1.5 mb-4 flex-1">
                {copy.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-[#444]">
                    <span className="text-[#2a5c0a] shrink-0 mt-px">✓</span>
                    {b}
                  </li>
                ))}
              </ul>

              {plan.tier === 4 ? (
                <button
                  disabled
                  className="w-full bg-[#1a1a1a] text-white py-2 rounded-[8px] text-xs font-semibold opacity-40 cursor-not-allowed"
                >
                  Available at launch
                </button>
              ) : isCurrentPlan ? (
                <div className="w-full text-center text-[11px] font-semibold text-[#1a1a1a] py-2 border border-[#ddd8ce] rounded-[8px] bg-[#f8f6f2]">
                  Your plan
                </div>
              ) : (
                <button
                  onClick={() => handleChoosePlan(plan.tier)}
                  disabled={pendingTier !== null}
                  className="w-full bg-[#1a1a1a] text-white py-2 rounded-[8px] text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pendingTier === plan.tier ? 'Loading…' : 'Choose plan'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {ctaError && (
        <div className="mt-3 text-[11px] text-[#8a1a1a]">{ctaError}</div>
      )}
    </div>
  )
}
