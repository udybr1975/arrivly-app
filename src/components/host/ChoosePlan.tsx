import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import { TIER_COPY } from '../../lib/tierCopy'
import Loader from '../shared/Loader'
import PlanCard from './PlanCard'

// CTA button recipes (PlanCard slot). All w-full, 13px, semibold, rounded-[10px].
const BTN_BRASS = 'w-full text-[13px] font-semibold py-2.5 rounded-[10px] transition-colors bg-[#c8a24e] text-[#16100d] hover:bg-[#e7d6ad] disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_QUIET = 'w-full text-[13px] font-semibold py-2.5 rounded-[10px] transition-colors bg-transparent border border-[#e4ddd0] text-[#231d17] hover:bg-[#f0ede6] disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_DISABLED_CREAM = 'w-full text-[13px] font-semibold py-2.5 rounded-[10px] bg-[#ece6da] text-[#a79e8e] cursor-not-allowed'
const BTN_DISABLED_FEATURED = 'w-full text-[13px] font-semibold py-2.5 rounded-[10px] bg-[rgba(247,243,236,0.10)] text-[#8f887b] cursor-not-allowed'

interface Plan {
  tier: number
  label: string
  price_cents: number
  currency: string
  max_properties: number | null
}

interface HostCheck {
  stripe_subscription_id: string | null
}

function currencySymbol(code: string): string {
  const map: Record<string, string> = { eur: '€', usd: '$', gbp: '£' }
  return map[code.toLowerCase()] ?? code.toUpperCase()
}

function parseApiError(err: unknown): string {
  let code: string | undefined
  try { code = JSON.parse((err as Error).message)?.error } catch {}
  if (code === 'booking_tier_unavailable') return 'This tier is not yet available. Please choose a different plan.'
  return 'Something went wrong. Please try again.'
}

export default function ChoosePlan() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [plans, setPlans] = useState<Plan[]>([])
  const [focusedTier, setFocusedTier] = useState<number | null>(null)
  const [choosingTier, setChoosingTier] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelledBanner, setCancelledBanner] = useState(false)

  // Read ?checkout=cancelled once on mount (Stripe cancel redirect).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('checkout') === 'cancelled') {
      setCancelledBanner(true)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
      if (!user) { navigate('/login', { replace: true }); return }

      const { data } = await supabase
        .from('hosts')
        .select('stripe_subscription_id')
        .eq('id', user.id)
        .maybeSingle()

      if (cancelled) return
      const hostCheck = data as HostCheck | null
      if (hostCheck?.stripe_subscription_id) {
        navigate('/dashboard', { replace: true })
        return
      }

      const { data: plansData } = await supabase
        .from('plans')
        .select('tier, label, price_cents, currency, max_properties')
        .order('tier', { ascending: true })

      if (!cancelled) {
        setPlans((plansData ?? []) as Plan[])
        setLoading(false)
      }
    }
    init()
    return () => { cancelled = true }
  }, [navigate])

  async function handleChoose(tier: number) {
    // setFocusedTier so the disclosure block shows the selected tier's price.
    setFocusedTier(tier)
    setChoosingTier(tier)
    setError(null)
    try {
      const data = await api.post<{ url: string }>('/create-subscription', { tier, flow: 'signup' })
      if (!data.url) throw new Error('no checkout url')
      window.location.href = data.url
    } catch (err) {
      setError(parseApiError(err))
      setChoosingTier(null)
    }
  }

  if (loading) return <Loader />

  const disclosurePlan = focusedTier !== null ? plans.find(p => p.tier === focusedTier) : null

  return (
    <div className="min-h-screen bg-[#f0ede6] flex flex-col items-center py-10 px-4 font-['Inter']">
      <div className="w-full max-w-5xl">

        {/* Header */}
        <div className="mb-7 text-center">
          <div className="font-mono text-[11px] text-[#a79e8e] uppercase tracking-[.2em] mb-3">Bemgu</div>
          <h1 className="text-[26px] font-['Fraunces'] font-light text-[#231d17] mb-1">Choose your plan</h1>
          <p className="text-xs text-[#8a8276]">14-day free trial — no charge today.</p>
        </div>

        {/* Cancelled banner */}
        {cancelledBanner && (
          <div className="max-w-3xl mx-auto bg-[#fffdf9] border border-[#e4ddd0] rounded-[12px] p-4 mb-5">
            <p className="text-[12px] text-[#8a8276]">No problem — choose a plan when you're ready.</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="max-w-3xl mx-auto bg-[#fbe9e9] border border-[#f0cccc] rounded-[12px] p-3 mb-5 text-[11px] text-[#8a1a1a]">
            {error}
          </div>
        )}

        {/* Plan cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          {plans.map(plan => {
            const copy = TIER_COPY[plan.tier as 1 | 2 | 3 | 4]
            if (!copy) return null
            const featured = !!copy.mostPopular
            const isDisabled = plan.tier === 4
            const sym = currencySymbol(plan.currency)
            const price = `${sym}${(plan.price_cents / 100).toFixed(0)}`
            const capacity = plan.max_properties === null
              ? 'Unlimited properties'
              : `Up to ${plan.max_properties} ${plan.max_properties === 1 ? 'property' : 'properties'}`

            const cta: ReactNode = isDisabled ? (
              <button disabled className={featured ? BTN_DISABLED_FEATURED : BTN_DISABLED_CREAM}>
                Coming soon
              </button>
            ) : (
              <button
                onClick={() => handleChoose(plan.tier)}
                disabled={choosingTier !== null}
                className={featured ? BTN_BRASS : BTN_QUIET}
              >
                {choosingTier === plan.tier ? 'Loading…' : 'Start free trial'}
              </button>
            )

            return (
              <div
                key={plan.tier}
                onMouseEnter={() => { if (!isDisabled) setFocusedTier(plan.tier) }}
              >
                <PlanCard
                  tierName={copy.name}
                  price={price}
                  valueProp={copy.tagline}
                  capacityLabel={capacity}
                  bullets={copy.bullets}
                  featured={featured}
                  comingSoonTag={isDisabled}
                  cta={cta}
                />
              </div>
            )
          })}
        </div>

        {/* Disclosure block */}
        <div className="max-w-3xl mx-auto bg-[#fffdf9] border border-[#e4ddd0] rounded-[12px] p-4 text-[11px] text-[#8a8276] leading-relaxed space-y-1.5">
          {disclosurePlan ? (
            <p>
              <span className="font-semibold text-[#231d17]">14-day free trial — no charge today.</span>{' '}
              After your trial, you'll be billed{' '}
              {currencySymbol(disclosurePlan.currency)}{(disclosurePlan.price_cents / 100).toFixed(0)}/month
              {' '}for the {TIER_COPY[disclosurePlan.tier as 1 | 2 | 3 | 4]?.name ?? ''} plan, renewing
              monthly. Cancel anytime from your dashboard.
            </p>
          ) : (
            <p>
              <span className="font-semibold text-[#231d17]">14-day free trial — no charge today.</span>{' '}
              After your trial, you'll be billed monthly for your chosen plan, renewing monthly.
              Cancel anytime from your dashboard.
            </p>
          )}
          <p>Your card details are entered securely on the next screen (Stripe).</p>
        </div>

      </div>
    </div>
  )
}
