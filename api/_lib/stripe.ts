import Stripe from 'stripe'

let _stripe: Stripe | null = null

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY not configured')
    _stripe = new Stripe(key)
  }
  return _stripe
}

const TIER_ENV_KEYS: Record<number, string> = {
  1: 'STRIPE_PRICE_TIER_1',
  2: 'STRIPE_PRICE_TIER_2',
  3: 'STRIPE_PRICE_TIER_3',
}

export function priceIdForTier(tier: number): string {
  const envKey = TIER_ENV_KEYS[tier]
  if (!envKey) throw new Error(`No price env for tier ${tier}`)
  const priceId = process.env[envKey]
  if (!priceId) throw new Error(`${envKey} not configured`)
  return priceId
}

export function tierForPriceId(priceId: string): number | null {
  for (const [tier, envKey] of Object.entries(TIER_ENV_KEYS)) {
    if (process.env[envKey] === priceId) return Number(tier)
  }
  return null
}

export const ARRIVLY_STRIPE_METADATA = { app: 'arrivly' } as const

export { getStripe }
