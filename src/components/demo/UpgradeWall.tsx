import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { TIER_COPY } from '../../lib/tierCopy'
import PlanCard from '../host/PlanCard'
import Loader from '../shared/Loader'

// Expired-demo upgrade wall — the ONLY thing a lapsed demo can see (rendered by Layout
// instead of the dashboard Outlet for every /dashboard/* route). Reuses PlanCard +
// tierCopy + the real plans fetch. EVERY card CTA opens KeepDemoModal (convert to a
// 14-day TRIAL — NOT a Stripe checkout); the modal is owned by Layout via onKeep.

const BTN_BRASS =
  'w-full text-[13px] font-semibold py-2.5 rounded-[10px] transition-colors bg-[#c8a24e] text-[#16100d] hover:bg-[#e7d6ad] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]/50'
const BTN_QUIET =
  'w-full text-[13px] font-semibold py-2.5 rounded-[10px] transition-colors bg-transparent border border-[#e4ddd0] text-[#231d17] hover:bg-[#f0ede6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]/40'

interface Plan {
  tier: number
  label: string
  price_cents: number
  currency: string
  max_properties: number | null
}

function currencySymbol(code: string): string {
  const map: Record<string, string> = { eur: '€', usd: '$', gbp: '£' }
  return map[code.toLowerCase()] ?? code.toUpperCase()
}

export default function UpgradeWall({ onKeep, onSignOut }: { onKeep: () => void; onSignOut: () => void }) {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('plans')
      .select('tier, label, price_cents, currency, max_properties')
      .order('tier', { ascending: true })
      .then(({ data }) => {
        if (!cancelled) {
          setPlans((data ?? []) as Plan[])
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="mx-auto max-w-5xl font-['Inter']">
      <div className="text-center mb-8">
        <div className="text-[10.5px] font-semibold uppercase tracking-[.1em] text-[#a8842f] mb-2">Your free demo has ended</div>
        <h1 className="font-['Fraunces'] font-light text-[30px] leading-tight text-[#231d17]">Your demo’s done — keep it live</h1>
        <p className="mt-2.5 text-[13.5px] leading-[1.6] text-[#6b6354] max-w-[540px] mx-auto">
          Everything you built is saved — your property, your guest page, your guide and your picks. Start your free 14-day trial to bring it all back to life. No card needed.
        </p>
      </div>

      {loading ? (
        <Loader />
      ) : plans.length === 0 ? (
        // Plans fetch failed/empty — keep the primary convert CTA on the wall itself.
        <div className="mx-auto max-w-sm text-center">
          <button onClick={onKeep} className={BTN_BRASS}>
            Start my free trial
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {plans.map((plan) => {
            const copy = TIER_COPY[plan.tier as 1 | 2 | 3 | 4]
            if (!copy) return null
            const featured = !!copy.mostPopular
            const sym = currencySymbol(plan.currency)
            const price = `${sym}${(plan.price_cents / 100).toFixed(0)}`
            const capacity =
              plan.max_properties === null
                ? 'Unlimited properties'
                : `Up to ${plan.max_properties} ${plan.max_properties === 1 ? 'property' : 'properties'}`
            const cta = (
              <button onClick={onKeep} className={featured ? BTN_BRASS : BTN_QUIET}>
                Start my free trial
              </button>
            )
            return (
              <PlanCard
                key={plan.tier}
                tierName={copy.name}
                price={price}
                valueProp={copy.tagline}
                capacityLabel={capacity}
                bullets={copy.bullets}
                featured={featured}
                cta={cta}
              />
            )
          })}
        </div>
      )}

      <div className="mt-7 text-center">
        <p className="text-[12px] text-[#b3aa9b] mb-2">14-day free trial · No card needed · Cancel anytime</p>
        <button
          onClick={onSignOut}
          className="text-[12.5px] font-medium text-[#8a8276] hover:text-[#231d17] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]/40 rounded px-2 py-1"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
