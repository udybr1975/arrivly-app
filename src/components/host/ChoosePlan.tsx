import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import { TIER_COPY } from '../../lib/tierCopy'
import Loader from '../shared/Loader'
import PlanCard from './PlanCard'
import { trackEvent } from '../../lib/analytics'

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

// Portfolio. MIRRORS FOUNDING_TIER in api/create-subscription.ts — the server is authoritative
// and will simply not apply the benefit to any other tier, so a drift here degrades to "no
// discount", never to a wrong charge.
const FOUNDING_TIER = 3

/**
 * The date one month from today, for the auto-charge disclosure.
 *
 * LOCAL DATE PARTS, NEVER toISOString() — the project's calendar rule.
 *
 * CLAMPED, BECAUSE JAVASCRIPT OVERFLOWS WHERE STRIPE CLAMPS. `setMonth(+1)` on 31 January
 * yields 3 March; Stripe bills 28 February. An earlier version of this comment asserted the
 * opposite — that the two agree — which is exactly the sentence that would have stopped the
 * next reader spotting it. They disagree, in the worst direction for this particular sentence:
 * the host would be told a date LATER than the day their card is actually taken.
 *
 * This is the SECOND place the host sees this sentence. The first-class one is rendered by
 * Stripe on the card-entry page itself via `custom_text`, built server-side from the STRIPE
 * PRICE. This copy is built from `plans.price_cents`, which is display-only — so if the two
 * ever drift, the authoritative one is the one on the payment page.
 */
function oneMonthFromToday(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const targetY = m === 11 ? y + 1 : y
  const targetM = (m + 1) % 12
  const daysInTarget = new Date(targetY, targetM + 1, 0).getDate()
  const d = new Date(targetY, targetM, Math.min(now.getDate(), daysInTarget))
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function currencySymbol(code: string): string {
  const map: Record<string, string> = { eur: '€', usd: '$', gbp: '£' }
  return map[code.toLowerCase()] ?? code.toUpperCase()
}

// The endpoint's error CODE, for routing decisions — a message and a route are different jobs.
function apiErrorCode(err: unknown): string | undefined {
  try { return JSON.parse((err as Error).message)?.error } catch { return undefined }
}

// Shown when the guard refused AND the billing portal then failed to open. Keeps the one fact
// that actually reassures the host — they have not been charged twice — instead of collapsing to
// a generic "something went wrong", which is what the portal's own error handling would say.
function portalFallbackCopy(code: 'subscription_exists' | 'subscription_needs_payment'): string {
  const tail = "We couldn't open your billing details just now — please try again in a moment."
  return code === 'subscription_exists'
    ? `You already have a subscription, so nothing new was started and you haven't been charged twice. ${tail}`
    : `Your existing subscription needs a payment first. ${tail}`
}

function parseApiError(err: unknown): string {
  const code = apiErrorCode(err)
  if (code === 'booking_tier_unavailable') return 'This tier is not yet available. Please choose a different plan.'
  // The duplicate-subscription guard on /create-subscription. Both are REFUSALS — nothing was
  // started in Stripe and nothing was charged — so the copy must not read as a failure.
  if (code === 'subscription_exists') return "You already have a subscription, so nothing new was started and you haven't been charged twice. Opening your billing details, where you can review and manage it…"
  if (code === 'subscription_needs_payment') return 'Your existing subscription needs a payment first. Opening your billing details so you can update your card…'
  if (code === 'billing_unavailable') return "We couldn't reach our payment provider just now, so nothing was started. Please try again in a moment."
  // The founding programme filled between the landing page and this click. NOT an error the
  // host caused, and deliberately not a silent downgrade into a paid checkout — see the server
  // comment at the claim.
  if (code === 'founding_unavailable') return 'The founding places have just been taken. Nothing was started and you have not been charged — you can still start on any plan below with the usual free trial.'
  // Deliberately NOT the same message as "places taken": this host has had their founding month
  // already, and telling them the programme filled would be untrue.
  if (code === 'founding_not_eligible') return "This account has already used its founding month, so it can't be claimed again. Nothing was started and you have not been charged — you can start on any plan below."
  // A check we could not complete, which is NOT the same as an offer that has closed.
  if (code === 'founding_check_failed') return "We couldn't confirm the founding offer just now, so nothing was started and you have not been charged. Please try again in a moment."
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
  // A founding claim carried through signup metadata — the only channel that survives email
  // confirmation (see Signup.tsx). Cleared the moment the server says the places are gone, so
  // the page stops promising a free month it can no longer deliver.
  const [founding, setFounding] = useState(false)
  // Guards the redirect below, which happens AFTER an awaited round trip to /billing-portal: a
  // host who leaves the page while that request is in flight must not be sent to Stripe by a
  // response that outlived their intent.
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

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
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>
      if (meta.founding_claim === true) {
        setFounding(true)
        // Preselect Portfolio so the disclosure block below already shows the founding terms
        // rather than the generic trial line.
        setFocusedTier(FOUNDING_TIER)
      }

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
      const claimingFounding = founding && tier === FOUNDING_TIER
      const data = await api.post<{ url: string; founding?: boolean }>('/create-subscription', {
        tier,
        flow: 'signup',
        ...(claimingFounding ? { founding: true } : {}),
      })
      if (!data.url) throw new Error('no checkout url')
      // Fired only when the SERVER confirms the benefit was actually applied — never on intent.
      // Parameterless, like every other funnel event.
      if (data.founding === true) trackEvent('founding_host_claim')
      window.location.href = data.url
    } catch (err) {
      setError(parseApiError(err))

      // The duplicate-subscription guard refused: this host already has a subscription, so the
      // plan picker can only ever refuse them again.
      //
      // NOT `/dashboard/billing`, WHICH BOUNCES. `PrivateRoute`'s `needsPlan` is keyed on
      // `hosts.stripe_subscription_id`, and the drift case is exactly a row where that is null or
      // stale — so an internal redirect sends them straight back here. The Stripe portal is
      // outside that gate and always available (billing-portal needs only `stripe_customer_id`,
      // which this host must have for the guard to have fired at all), and it is where they can
      // actually see and cancel the superseded subscription.
      const code = apiErrorCode(err)
      // Drop back to the ordinary picker: the message above explains why, the founding label and
      // disclosure disappear, and every plan stays available with its normal trial. The signup
      // is untouched — only the discount was refused.
      // Drop the founding framing only when the offer is genuinely gone for this host. A
      // transient check failure leaves it in place so a retry can still claim it.
      if (code === 'founding_unavailable' || code === 'founding_not_eligible') setFounding(false)
      if (code === 'subscription_exists' || code === 'subscription_needs_payment') {
        // The cards stay DISABLED across this hand-off — `setChoosingTier(null)` deliberately does
        // not run before it. Otherwise a host can click a second card mid-flight and race two
        // `window.location.href` assignments.
        try {
          const portal = await api.post<{ url?: string }>('/billing-portal', {})
          if (portal?.url && mountedRef.current) {
            window.location.href = portal.url
            return
          }
        } catch { /* fall through to the honest fallback below */ }
        // NOTHING OPENED. The message set above ends in "Opening your billing details…", so
        // leaving it would promise a redirect that is never going to arrive. Replace it with copy
        // that still carries the reassurance the host most needs — no second charge — and an
        // action they can actually take.
        if (mountedRef.current) setError(portalFallbackCopy(code))
      }
      setChoosingTier(null)
    }
  }

  if (loading) return <Loader />

  const disclosurePlan = focusedTier !== null ? plans.find(p => p.tier === focusedTier) : null
  // Read separately from `disclosurePlan` so the founding sentence never depends on which card
  // the pointer happens to be over.
  const foundingPlan = plans.find(p => p.tier === FOUNDING_TIER) ?? null

  return (
    <div className="min-h-screen bg-[#f0ede6] flex flex-col items-center py-10 px-4 font-['Inter']">
      <div className="w-full max-w-5xl">

        {/* Header */}
        <div className="mb-7 text-center">
          <div className="font-mono text-[11px] text-[#a79e8e] uppercase tracking-[.2em] mb-3">Bemgu</div>
          <h1 className="text-[26px] font-['Fraunces'] font-light text-[#231d17] mb-1">
            {founding ? 'Claim your founding place' : 'Choose your plan'}
          </h1>
          <p className="text-xs text-[#6b6354]">
            {founding ? 'Portfolio, with your first month free.' : '14-day free trial — no charge today.'}
          </p>
        </div>

        {/* Cancelled banner */}
        {cancelledBanner && (
          <div className="max-w-3xl mx-auto bg-[#fffdf9] border border-[#e4ddd0] rounded-[12px] p-4 mb-5">
            <p className="text-[12px] text-[#6b6354]">No problem — choose a plan when you're ready.</p>
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
                {choosingTier === plan.tier
                  ? 'Loading…'
                  : founding && plan.tier === FOUNDING_TIER
                  ? 'Claim founding place'
                  : 'Start free trial'}
              </button>
            )

            return (
              <div
                key={plan.tier}
                onMouseEnter={() => { if (!isDisabled) setFocusedTier(plan.tier) }}
              >
                <PlanCard
                  tierName={copy.name}
                  descriptor={founding && plan.tier === FOUNDING_TIER ? 'Founding — first month free' : copy.descriptor}
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
        <div className="max-w-3xl mx-auto bg-[#fffdf9] border border-[#e4ddd0] rounded-[12px] p-4 text-[11px] text-[#6b6354] leading-relaxed space-y-1.5">
          {/* GATED ON THE TIER ACTUALLY SELECTED, AND IT NAMES THAT TIER. Ungated, a founding
              visitor who picked Starter saw "first month free, then EUR 25 from <date>" on the
              last screen before card entry while actually buying EUR 10 with a 14-day trial —
              wrong amount, wrong date and wrong mechanism, on the one sentence this whole
              change treats as load-bearing. Naming Portfolio inside the sentence is the second
              half of the fix: on a touch device there is no hover, so the preselected tier can
              still be showing when a finger lands on a different card, and a disclosure that
              says which plan it describes cannot be misread as describing another. */}
          {founding && foundingPlan && focusedTier === FOUNDING_TIER ? (
            <p>
              <span className="font-semibold text-[#231d17]">Portfolio, founding — first month free.</span>{' '}
              From {oneMonthFromToday()},{' '}
              {currencySymbol(foundingPlan.currency)}{(foundingPlan.price_cents / 100).toFixed(0)}/month
              {' '}is charged automatically. Cancel anytime before then and pay nothing.
            </p>
          ) : disclosurePlan ? (
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
