import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL!
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY!

  const authClient = createClient(supabaseUrl, anonKey)
  const { data: authData, error: authError } = await authClient.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })

  const { tier } = (req.body ?? {}) as { tier?: unknown }
  if (!Number.isInteger(tier) || (tier as number) < 1 || (tier as number) > 4) {
    return res.status(400).json({ error: 'tier must be an integer 1–4' })
  }

  // Pre-Stripe: billing not yet live — no tier changes made.
  return res.status(403).json({
    error: 'billing_not_live',
    message: 'Plan changes open when billing launches.',
  })
}
