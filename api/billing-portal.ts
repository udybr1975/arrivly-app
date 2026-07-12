import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { getStripe } from './_lib/stripe.js'

const APP_URL = process.env.VITE_APP_URL ?? 'https://bemgu.app'

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

  try {
    const admin = createClient(supabaseUrl, serviceKey)

    const { data: host, error: hostErr } = await admin
      .from('hosts')
      .select('stripe_customer_id')
      .eq('id', userId)
      .maybeSingle()

    if (hostErr) {
      console.error('[billing-portal] host lookup error —', String(hostErr.message).slice(0, 80))
      return res.status(500).json({ error: 'portal_failed' })
    }
    if (!host?.stripe_customer_id) return res.status(400).json({ error: 'no_subscription' })

    const stripe = getStripe()
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: host.stripe_customer_id as string,
      return_url: `${APP_URL}/dashboard/billing`,
    })

    return res.status(200).json({ url: portalSession.url })
  } catch (err) {
    const msg = String((err as Error).message ?? '')
      .replace(/sk_[a-zA-Z0-9_]+/gi, 'sk_REDACTED')
      .slice(0, 120)
    console.error('[billing-portal] error —', msg)
    return res.status(500).json({ error: 'portal_failed' })
  }
}
