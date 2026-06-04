import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'apartment-images'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL!
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return res.status(500).json({ error: 'Delete service not configured' })

  const authClient = createClient(supabaseUrl, anonKey)
  const { data: authData, error: authError } = await authClient.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })
  const userId = authData.user.id

  const body = (req.body ?? {}) as { path?: unknown }
  const path = body.path

  if (
    typeof path !== 'string' ||
    !path ||
    !path.startsWith(`${userId}/`) ||
    path.startsWith('https://') ||
    path.includes('..')
  ) {
    return res.status(400).json({ error: 'Invalid path' })
  }

  // Service-role client: used only to delete the object. Never returned to client.
  const admin = createClient(supabaseUrl, serviceKey)
  const { error } = await admin.storage.from(BUCKET).remove([path])
  if (error) return res.status(500).json({ error: 'Delete failed' })

  return res.status(200).json({ ok: true })
}
