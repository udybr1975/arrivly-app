import { useEffect, useRef, useState } from 'react'
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
  stripe_subscription_id: string | null
  current_period_end: string | null
  pending_tier: number | null
  cancel_at_period_end: boolean | null
}

interface Plan {
  tier: number
  label: string
  price_cents: number
  currency: string
  max_properties: number | null
  includes_booking: boolean
}

type ModalState = { kind: 'switch'; tier: number } | { kind: 'cancel' } | null

function currencySymbol(code: string): string {
  const map: Record<string, string> = { eur: '€', usd: '$', gbp: '£' }
  return map[code.toLowerCase()] ?? code.toUpperCase()
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function priceForTier(tier: number, plans: Plan[]): string {
  const plan = plans.find(p => p.tier === tier)
  if (!plan) return ''
  return `${currencySymbol(plan.currency)}${(plan.price_cents / 100).toFixed(0)}/mo`
}

function parseApiError(err: unknown): string {
  let code: string | undefined
  try { code = JSON.parse((err as Error).message)?.error } catch {}
  if (!code) {
    const msg = String((err as Error)?.message ?? '')
    if (msg.includes('not_switchable')) code = 'not_switchable'
    else if (msg.includes('pending_change_in_progress')) code = 'pending_change_in_progress'
    else if (msg.includes('already_on_tier')) code = 'already_on_tier'
    else if (msg.includes('no_subscription')) code = 'no_subscription'
    else if (msg.includes('booking_tier_unavailable')) code = 'booking_tier_unavailable'
  }
  switch (code) {
    case 'not_switchable': return "This plan can't be changed right now. If a payment is overdue, update your card first."
    case 'pending_change_in_progress': return "You already have a scheduled plan change — undo it first, then cancel."
    case 'already_on_tier': return "You're already on this plan."
    case 'no_subscription': return "No active subscription found."
    case 'booking_tier_unavailable': return "This tier is not yet available."
    case 'payment_failed': return "Your card couldn't be charged for the upgrade, so your plan wasn't changed. Update your payment method and try again."
    default: return 'Something went wrong. Please try again.'
  }
}

type BannerStyle = { bg: string; border: string; heading: string; muted: string; btn: string }
const GREEN: BannerStyle = {
  bg: 'bg-[#e4f0da]', border: 'border-[#b8d9a0]', heading: 'text-[#2a5c0a]', muted: 'text-[#2a5c0a]/70',
  btn: 'border-[#2a5c0a]/40 text-[#2a5c0a] hover:bg-[#2a5c0a]/10',
}
const AMBER: BannerStyle = {
  bg: 'bg-[#faeeda]', border: 'border-[#e8d0a0]', heading: 'text-[#7a4800]', muted: 'text-[#7a4800]/70',
  btn: 'border-[#7a4800]/40 text-[#7a4800] hover:bg-[#7a4800]/10',
}
const RED: BannerStyle = {
  bg: 'bg-[#fde4e4]', border: 'border-[#f5c6c6]', heading: 'text-[#8a1a1a]', muted: 'text-[#8a1a1a]/70',
  btn: 'border-[#8a1a1a]/40 text-[#8a1a1a] hover:bg-[#8a1a1a]/10',
}

const TIER_NAMES_LOCAL: Record<number, string> = { 1: 'Starter', 2: 'Growth', 3: 'Portfolio', 4: 'Pro' }

function bannerConfig(notice: BillingNotice): { heading: string; body: string; style: BannerStyle } {
  const from = notice.from_tier !== null ? (TIER_NAMES_LOCAL[notice.from_tier] ?? `Tier ${notice.from_tier}`) : null
  const to = TIER_NAMES_LOCAL[notice.to_tier] ?? `Tier ${notice.to_tier}`
  switch (notice.type) {
    case 'started':    return { heading: `You're on the ${to} plan`, body: 'Your subscription is active.', style: GREEN }
    case 'upgraded':   return { heading: `Upgraded to ${to}`, body: from ? `Changed from ${from} to ${to}.` : `Now on ${to}.`, style: GREEN }
    case 'downgraded': return { heading: `Plan changed to ${to}`, body: from ? `Changed from ${from} to ${to}.` : `Now on ${to}.`, style: AMBER }
    case 'cancelled':  return { heading: 'Subscription cancelled', body: 'Your guest page is no longer active. Reactivate anytime.', style: RED }
    case 'grace':      return { heading: 'Payment issue', body: 'Your page is still live — please update your card.', style: RED }
  }
}

const SELECT_FIELDS =
  'tier, trial_ends_at, subscription_status, billing_notice, stripe_subscription_id, current_period_end, pending_tier, cancel_at_period_end'

export default function BillingPanel() {
  const [host, setHost] = useState<HostData | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [plansError, setPlansError] = useState(false)
  const [checkoutResult, setCheckoutResult] = useState<'success' | 'cancelled' | null>(null)
  const [dismissing, setDismissing] = useState(false)
  const [modal, setModal] = useState<ModalState>(null)
  const [choosingTier, setChoosingTier] = useState<number | null>(null)
  const [switchPending, setSwitchPending] = useState(false)
  const [undoPending, setUndoPending] = useState(false)
  const [cancelActionPending, setCancelActionPending] = useState(false)
  const [resumeActionPending, setResumeActionPending] = useState(false)
  const [portalPending, setPortalPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [upgradeProcessing, setUpgradeProcessing] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)
  useEffect(() => { return () => { mountedRef.current = false } }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('checkout')
    if (result === 'success' || result === 'cancelled') {
      setCheckoutResult(result)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  useEffect(() => {
    if (modal && modalRef.current) modalRef.current.focus()
  }, [modal])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && modal) { setModal(null); setActionError(null) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [modal])

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const [{ data: hostData }, { data: plansData, error: plansErr }] = await Promise.all([
        supabase.from('hosts').select(SELECT_FIELDS).eq('id', user.id).maybeSingle(),
        supabase.from('plans').select('tier, label, price_cents, currency, max_properties, includes_booking').order('tier', { ascending: true }),
      ])
      setHost(hostData as HostData | null)
      if (plansErr) setPlansError(true)
      else setPlans(plansData ?? [])
      setLoading(false)
    }
    load()
  }, [])

  async function refetchHost() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('hosts').select(SELECT_FIELDS).eq('id', user.id).maybeSingle()
    setHost(data as HostData | null)
  }

  // --- Actions ---

  async function handleChoosePlan(tier: number) {
    setChoosingTier(tier)
    setActionError(null)
    try {
      const data = await api.post<{ url: string }>('/create-subscription', { tier })
      if (!data.url) throw new Error('no checkout url')
      window.location.href = data.url
    } catch (err) {
      setActionError(parseApiError(err))
      setChoosingTier(null)
    }
  }

  async function handleSwitch(tier: number) {
    setSwitchPending(true)
    setActionError(null)
    try {
      const data = await api.post<{ mode: string; effective_at?: string }>('/change-plan', { tier })
      setModal(null)
      await refetchHost()
      if (data.mode === 'immediate') {
        setUpgradeProcessing(true)
        setTimeout(async () => {
          if (mountedRef.current) {
            await refetchHost()
            setUpgradeProcessing(false)
          }
        }, 3000)
      }
    } catch (err) {
      setActionError(parseApiError(err))
    } finally {
      setSwitchPending(false)
    }
  }

  async function handleUndoSwitch() {
    const currentTier = host?.tier
    if (currentTier == null) return
    setUndoPending(true)
    setActionError(null)
    try {
      await api.post('/change-plan', { tier: currentTier })
      await refetchHost()
    } catch (err) {
      setActionError(parseApiError(err))
    } finally {
      setUndoPending(false)
    }
  }

  async function handleCancel() {
    setCancelActionPending(true)
    setActionError(null)
    try {
      await api.post('/cancel-subscription', {})
      setModal(null)
      await refetchHost()
    } catch (err) {
      setActionError(parseApiError(err))
    } finally {
      setCancelActionPending(false)
    }
  }

  async function handleResume() {
    setResumeActionPending(true)
    setActionError(null)
    try {
      await api.post('/cancel-subscription', { resume: true })
      await refetchHost()
    } catch (err) {
      setActionError(parseApiError(err))
    } finally {
      setResumeActionPending(false)
    }
  }

  async function handlePaymentPortal() {
    setPortalPending(true)
    setActionError(null)
    try {
      const data = await api.post<{ url: string }>('/billing-portal', {})
      if (!data.url) throw new Error('no portal url')
      window.location.href = data.url
    } catch (err) {
      setActionError(parseApiError(err))
    } finally {
      setPortalPending(false)
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

  // --- Derived state ---
  const status = host?.subscription_status ?? 'trial'
  const hostTier = host?.tier ?? null
  const hasSubscription = !!host?.stripe_subscription_id
  const pendingTier = (host?.pending_tier ?? null) as number | null
  const cancelPending = host?.cancel_at_period_end === true
  const trialEndsAt = host?.trial_ends_at ?? null
  const trialEndDate = trialEndsAt ? formatDate(trialEndsAt) : null
  const trialRemaining = trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : 0
  const periodEndDate = host?.current_period_end
    ? formatDate(host.current_period_end)
    : trialEndDate ?? 'the end of your current period'
  const chooseMode = !hasSubscription || status === 'expired'
  const manageMode = !chooseMode
  const locked = manageMode && (pendingTier !== null || cancelPending)
  const billingNotice = host?.billing_notice ?? null

  return (
    <div className="max-w-2xl">
      <h1 className="text-[17px] font-serif font-light text-[#1a1a1a] mb-4">Billing</h1>

      {/* Dismissible billing_notice banner from webhook */}
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

      {/* Checkout result banners */}
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

      {/* Status banners */}
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
        <div className={`${RED.bg} border ${RED.border} rounded-[10px] p-4 mb-5`}>
          <div className={`text-[13px] font-semibold ${RED.heading} mb-1`}>
            {status === 'grace' ? 'Payment failed — grace period' : 'Subscription inactive'}
          </div>
          <div className={`text-[11px] ${RED.muted}`}>Add a payment method to restore access.</div>
        </div>
      )}

      {/* Cancel-pending banner (shown when cancelPending; wins over pending-tier if both set) */}
      {cancelPending && (
        <div className={`${AMBER.bg} border ${AMBER.border} rounded-[10px] p-4 mb-5 flex items-start justify-between gap-3`}>
          <div>
            <div className={`text-[13px] font-semibold ${AMBER.heading} mb-0.5`}>Subscription ending</div>
            <div className={`text-[11px] ${AMBER.muted}`}>
              Your subscription cancels on {periodEndDate}. Your guest pages stay live until then.
            </div>
          </div>
          <button
            onClick={handleResume}
            disabled={resumeActionPending}
            className={`shrink-0 text-[11px] font-semibold border rounded-[7px] px-2.5 py-1 ${AMBER.btn} disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap`}
          >
            {resumeActionPending ? 'Resuming…' : 'Resume subscription'}
          </button>
        </div>
      )}

      {/* Pending tier-change banner (only when cancel is not set) */}
      {!cancelPending && pendingTier !== null && (() => {
        const pCopy = TIER_COPY[pendingTier as 1 | 2 | 3 | 4]
        const hCopy = hostTier !== null ? TIER_COPY[hostTier as 1 | 2 | 3 | 4] : null
        return (
          <div className={`${AMBER.bg} border ${AMBER.border} rounded-[10px] p-4 mb-5 flex items-start justify-between gap-3`}>
            <div>
              <div className={`text-[13px] font-semibold ${AMBER.heading} mb-0.5`}>Plan change scheduled</div>
              <div className={`text-[11px] ${AMBER.muted}`}>
                Switching to {pCopy?.name ?? `Tier ${pendingTier}`} on {periodEndDate}.
                {hCopy && ` You stay on ${hCopy.name} until then.`}
              </div>
            </div>
            <button
              onClick={handleUndoSwitch}
              disabled={undoPending}
              className={`shrink-0 text-[11px] font-semibold border rounded-[7px] px-2.5 py-1 ${AMBER.btn} disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap`}
            >
              {undoPending ? 'Undoing…' : 'Undo change'}
            </button>
          </div>
        )
      })()}

      {/* Plan load error */}
      {plansError && (
        <div className={`${RED.bg} border ${RED.border} rounded-[10px] p-4 text-[11px] ${RED.heading} mb-4`}>
          Could not load plan details — please refresh to try again.
        </div>
      )}

      {/* Non-modal action error */}
      {actionError && !modal && (
        <div className={`${RED.bg} border ${RED.border} rounded-[10px] p-3 mb-4 text-[11px] ${RED.heading}`}>
          {actionError}
        </div>
      )}

      {/* Upgrade processing indicator */}
      {upgradeProcessing && (
        <div className="text-[11px] text-[#888] mb-4">Upgrade processing — your plan will update shortly.</div>
      )}

      {/* Plan cards */}
      <div className="grid grid-cols-2 gap-3">
        {plans.map(plan => {
          const copy = TIER_COPY[plan.tier as 1 | 2 | 3 | 4]
          if (!copy) return null
          const isMostPopular = !!copy.mostPopular
          const sym = currencySymbol(plan.currency)
          const price = `${sym}${(plan.price_cents / 100).toFixed(0)}`
          const capacity = plan.max_properties === null
            ? 'Unlimited properties'
            : `Up to ${plan.max_properties} ${plan.max_properties === 1 ? 'property' : 'properties'}`
          const isCurrentTier = manageMode && plan.tier === hostTier
          const isScheduledTier = manageMode && pendingTier !== null && plan.tier === pendingTier && plan.tier !== hostTier
          const borderCls = isMostPopular ? 'border-2 border-[#1a1a1a]' : 'border border-[#ddd8ce]'
          const ringCls = isCurrentTier ? 'ring-2 ring-[#1a1a1a]/15' : ''

          return (
            <div
              key={plan.tier}
              className={`bg-white rounded-[10px] p-4 flex flex-col relative ${borderCls} ${ringCls}`}
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
                <button disabled className="w-full bg-[#1a1a1a] text-white py-2 rounded-[8px] text-xs font-semibold opacity-40 cursor-not-allowed">
                  Available at launch
                </button>
              ) : chooseMode ? (
                <button
                  onClick={() => handleChoosePlan(plan.tier)}
                  disabled={choosingTier !== null}
                  className="w-full bg-[#1a1a1a] text-white py-2 rounded-[8px] text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {choosingTier === plan.tier ? 'Loading…' : 'Choose plan'}
                </button>
              ) : isCurrentTier ? (
                <div className="w-full text-center text-[11px] font-semibold text-[#1a1a1a] py-2 border border-[#ddd8ce] rounded-[8px] bg-[#f8f6f2]">
                  Current plan
                </div>
              ) : isScheduledTier ? (
                <div className="w-full text-center text-[11px] font-medium text-[#888] py-2 border border-[#ddd8ce] rounded-[8px] bg-[#f8f6f2] cursor-default">
                  Scheduled · {periodEndDate}
                </div>
              ) : (
                <button
                  onClick={() => { setActionError(null); setModal({ kind: 'switch', tier: plan.tier }) }}
                  disabled={locked}
                  className="w-full bg-[#1a1a1a] text-white py-2 rounded-[8px] text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {plan.tier > (hostTier ?? 0) ? 'Upgrade' : 'Downgrade'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Manage footer */}
      {manageMode && (
        <div className="mt-5 flex items-start justify-between gap-4">
          <div>
            <button
              onClick={() => { setActionError(null); setModal({ kind: 'cancel' }) }}
              disabled={locked}
              className="text-[11px] font-medium text-[#8a1a1a] border border-[#f5c6c6] rounded-[8px] px-3 py-2 bg-transparent hover:bg-[#fde4e4] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Cancel subscription
            </button>
            {locked && (
              <div className="text-[10px] text-[#888] mt-1.5">Undo the scheduled change first</div>
            )}
          </div>
          <button
            onClick={handlePaymentPortal}
            disabled={portalPending}
            className="text-[11px] text-[#888] hover:text-[#444] underline underline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {portalPending ? 'Opening…' : 'Payment method & receipts →'}
          </button>
        </div>
      )}

      {/* Confirmation modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            className="bg-[#f8f6f2] rounded-[12px] border border-[#ddd8ce] p-6 max-w-sm w-full shadow-xl outline-none"
          >

            {modal.kind === 'switch' && (() => {
              const mTier = modal.tier
              const mCopy = TIER_COPY[mTier as 1 | 2 | 3 | 4]
              const mPlan = plans.find(p => p.tier === mTier)
              const mPrice = priceForTier(mTier, plans)
              const hCopy = hostTier !== null ? TIER_COPY[hostTier as 1 | 2 | 3 | 4] : null
              const hPrice = hostTier !== null ? priceForTier(hostTier, plans) : ''
              const isUp = mTier > (hostTier ?? 0)
              if (!mCopy) return null

              let modalCopy
              let confirmLabel: string
              if (status === 'trial') {
                modalCopy = <>You'll move to {mCopy.name} now. You're still in your free trial{trialEndDate ? ` until ${trialEndDate}` : ''}, so you won't be charged today — your first payment will be at the {mCopy.name} price ({mPrice}).</>
                confirmLabel = 'Confirm'
              } else if (status === 'active' && isUp) {
                modalCopy = <>You'll move to {mCopy.name} now and we'll charge the prorated difference for the rest of this period. Your renewal date stays the same.</>
                confirmLabel = 'Upgrade now'
              } else {
                modalCopy = <>
                  Your plan will change from {hCopy?.name ?? 'your current plan'} ({hPrice}) to {mCopy.name} ({mPrice}) at the start of your next billing period — {periodEndDate}. You keep {hCopy?.name ?? 'your current plan'} until then, and you won't be charged now.
                  {hostTier !== null && mTier < hostTier && mPlan && (
                    <> Note: {mCopy.name} covers up to {mPlan.max_properties !== null ? mPlan.max_properties : 'unlimited'} properties — make sure you're within that by {periodEndDate}.</>
                  )}
                </>
                confirmLabel = 'Confirm switch'
              }

              return (
                <>
                  <h2 className="text-[15px] font-serif font-light text-[#1a1a1a] mb-3">
                    {isUp ? `Upgrade to ${mCopy.name}?` : `Switch to ${mCopy.name}?`}
                  </h2>
                  <p className="text-[12px] text-[#555] leading-relaxed mb-4">
                    {modalCopy}
                  </p>
                  {actionError && (
                    <div className={`text-[11px] ${RED.heading} mb-3`}>{actionError}</div>
                  )}
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => { setModal(null); setActionError(null) }}
                      disabled={switchPending}
                      className="text-[12px] text-[#444] border border-[#ddd8ce] rounded-[8px] px-4 py-2 bg-white hover:bg-[#f8f6f2] transition-colors disabled:opacity-50"
                    >
                      Keep {hCopy?.name ?? 'current plan'}
                    </button>
                    <button
                      onClick={() => handleSwitch(mTier)}
                      disabled={switchPending}
                      className="text-[12px] text-white bg-[#1a1a1a] rounded-[8px] px-4 py-2 font-semibold hover:bg-[#333] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {switchPending ? 'Confirming…' : confirmLabel}
                    </button>
                  </div>
                </>
              )
            })()}

            {modal.kind === 'cancel' && (
              <>
                <h2 className="text-[15px] font-serif font-light text-[#1a1a1a] mb-3">Cancel subscription?</h2>
                <p className="text-[12px] text-[#555] leading-relaxed mb-4">
                  Your guest pages stay live until {periodEndDate} (the end of your billing period). After that, visitors see a "temporarily unavailable" screen until you resubscribe. You can resubscribe anytime.
                </p>
                {actionError && (
                  <div className={`text-[11px] ${RED.heading} mb-3`}>{actionError}</div>
                )}
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => { setModal(null); setActionError(null) }}
                    disabled={cancelActionPending}
                    className="text-[12px] text-[#444] border border-[#ddd8ce] rounded-[8px] px-4 py-2 bg-white hover:bg-[#f8f6f2] transition-colors disabled:opacity-50"
                  >
                    Keep subscription
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={cancelActionPending}
                    className="text-[12px] text-white bg-[#8a1a1a] rounded-[8px] px-4 py-2 font-semibold hover:bg-[#a02020] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {cancelActionPending ? 'Cancelling…' : 'Cancel plan'}
                  </button>
                </div>
              </>
            )}

          </div>
        </div>
      )}
    </div>
  )
}
