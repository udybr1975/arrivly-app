import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isPushConfigured, sendPushToHost } from './_lib/push'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!isPushConfigured()) {
    return res.status(500).json({ error: 'Push not configured' })
  }

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const sb = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    }
  )
  const { data: authData, error: authError } = await sb.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })
  const userId = authData.user.id

  if (!req.body) return res.status(400).json({ error: 'title is required' })

  const { title, body, url, apartmentId } = req.body as {
    title?: string
    body?: string
    url?: string
    apartmentId?: string
  }

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' })
  }

  const summary = await sendPushToHost(
    sb,
    userId,
    { title, body, url },
    apartmentId && typeof apartmentId === 'string' ? apartmentId : undefined
  )

  return res.status(200).json(summary)
}
