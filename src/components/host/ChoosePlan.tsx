import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import { TIER_COPY } from '../../lib/tierCopy'
import Loader from '../shared/Loader'

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
    <div className="min-h-screen bg-[#f0ede6] flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-2xl">

        {/* Header */}
        <div className="mb-7 text-center">
          <div className="font-mono text-[11px] text-[#bbb] uppercase tracking-[.2em] mb-3">Arrivly</div>
          <h1 className="text-[22px] font-serif font-light text-[#1a1a1a] mb-1">Choose your plan</h1>
          <p className="text-xs text-[#888]">14-day free trial — no charge today.</p>
        </div>

        {/* Cancelled banner */}
        {cancelledBanner && (
          <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 mb-5">
            <p className="text-[12px] text-[#888]">No problem — choose a plan when you're ready.</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-[#fde4e4] border border-[#f5c6c6] rounded-[10px] p-3 mb-5 text-[11px] text-[#8a1a1a]">
            {error}
          </div>
        )}

        {/* Plan cards */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          {plans.map(plan => {
            const copy = TIER_COPY[plan.tier as 1 | 2 | 3 | 4]
            if (!copy) return null
            const isMostPopular = !!copy.mostPopular
            const isDisabled = plan.tier === 4
            const sym = currencySymbol(plan.currency)
            const price = `${sym}${(plan.price_cents / 100).toFixed(0)}`
            const capacity = plan.max_properties === null
              ? 'Unlimited properties'
              : `Up to ${plan.max_properties} ${plan.max_properties === 1 ? 'property' : 'properties'}`
            const borderCls = isMostPopular ? 'border-2 border-[#1a1a1a]' : 'border border-[#ddd8ce]'

            return (
              <div
                key={plan.tier}
                className={`bg-white rounded-[10px] p-4 flex flex-col relative ${borderCls}`}
                onMouseEnter={() => { if (!isDisabled) setFocusedTier(plan.tier) }}
              >
                {isMostPopular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#1a1a1a] text-white text-[10px] font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap">
                    Most popular
                  </span>
                )}

                <div className="mb-3">
                  <div className="text-[10px] uppercase tracking-[.06em] text-[#999] mb-0.5">{copy.name}</div>
                  <div className="text-[22px] font-serif font-light text-[#1a1a1a] leading-none">
                    {isDisabled ? '—' : price}
                    {!isDisabled && (
                      <span className="text-[12px] text-[#888] font-sans font-normal">/mo</span>
                    )}
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

                {isDisabled ? (
                  <button
                    disabled
                    className="w-full bg-[#1a1a1a] text-white py-2 rounded-[8px] text-xs font-semibold opacity-40 cursor-not-allowed"
                  >
                    Coming soon
                  </button>
                ) : (
                  <button
                    onClick={() => handleChoose(plan.tier)}
                    disabled={choosingTier !== null}
                    className="w-full bg-[#1a1a1a] text-white py-2 rounded-[8px] text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {choosingTier === plan.tier ? 'Loading…' : 'Start free trial'}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Disclosure block */}
        <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 text-[11px] text-[#888] leading-relaxed space-y-1.5">
          {disclosurePlan ? (
            <p>
              <span className="font-semibold text-[#444]">14-day free trial — no charge today.</span>{' '}
              After your trial, you'll be billed{' '}
              {currencySymbol(disclosurePlan.currency)}{(disclosurePlan.price_cents / 100).toFixed(0)}/month
              {' '}for the {TIER_COPY[disclosurePlan.tier as 1 | 2 | 3 | 4]?.name ?? ''} plan, renewing
              monthly. Cancel anytime from your dashboard.
            </p>
          ) : (
            <p>
              <span className="font-semibold text-[#444]">14-day free trial — no charge today.</span>{' '}
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
