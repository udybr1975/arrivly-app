import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const h = req.headers.authorization
  const token = h?.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL!
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return res.status(500).json({ error: 'Service not configured' })

  const { data: { user }, error: userErr } = await createClient(supabaseUrl, anonKey).auth.getUser(token)
  if (userErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  const admin = createClient(supabaseUrl, serviceKey)
  const { error } = await admin
    .from('hosts')
    .update({ billing_notice: null })
    .eq('id', user.id)

  if (error) {
    console.error('[dismiss-billing-notice] update error:', error.message?.slice(0, 120))
    return res.status(500).json({ error: 'Update failed' })
  }

  return res.status(200).json({ ok: true })
}
