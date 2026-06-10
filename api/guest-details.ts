import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveGuestAccess } from './_lib/guest-access.js'

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_RE = /^[A-Za-z0-9-]{4,32}$/

const svc = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const apt   = typeof req.query.apt   === 'string' ? req.query.apt.trim()   : ''
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : ''

  if (!apt || !UUID_RE.test(apt) || !token || !TOKEN_RE.test(token)) {
    return res.status(400).json({ error: 'bad_request' })
  }

  const db = svc()
  try {
    const access = await resolveGuestAccess(db, apt, token)
    if (access.tier !== 'verified') return res.status(403).json({ error: 'forbidden' })

    const { data: rows, error } = await db
      .from('apartment_details')
      .select('id, category, content, is_private')
      .eq('apartment_id', apt)
      .eq('is_private', true)

    if (error) {
      console.error('[guest-details] query', error.message?.slice(0, 120))
      return res.status(500).json({ error: 'query_failed' })
    }

    return res.status(200).json({ details: rows ?? [] })
  } catch (e) {
    console.error('[guest-details] unexpected', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
    return res.status(500).json({ error: 'internal_error' })
  }
}
