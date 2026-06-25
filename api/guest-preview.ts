import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { authorizePreview } from './_lib/guest-access.js'

// Must match ARRIVLY_CONFIG.adminEmail in src/config.ts — not importable here (import.meta.env)
const ADMIN_EMAIL = 'udy.bar.yosef@gmail.com'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const anon = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!)
const svc  = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const h = req.headers.authorization
  const token = h?.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const { data: { user }, error: userErr } = await anon().auth.getUser(token)
  if (userErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  const aptId = typeof req.query.apt === 'string' ? req.query.apt.trim() : ''
  if (!aptId || !UUID_RE.test(aptId)) {
    return res.status(400).json({ error: 'Missing or invalid apt' })
  }

  const db = svc()
  try {
    const { data: apt, error: aptErr } = await db
      .from('apartments')
      .select('id, host_id, name, neighborhood, city, country, lat, lng, accent_color, max_guests, hero_image_url, city_image_url, city_image_credit')
      .eq('id', aptId)
      .maybeSingle()

    if (aptErr) {
      console.error('[guest-preview] apartment', aptErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Query failed' })
    }
    if (!apt) return res.status(404).json({ error: 'Not found' })

    const auth = authorizePreview(apt.host_id, user.id, user.email, ADMIN_EMAIL)
    if (!auth.ok) return res.status(403).json({ error: 'forbidden' })

    const [
      { data: hostRow,  error: hostErr  },
      { data: detRows,  error: detErr   },
      { data: picks,    error: picksErr },
      { data: guide,    error: guideErr },
    ] = await Promise.all([
      db.from('hosts')
        .select('brand_name, logo_url, whatsapp, subscription_status, accent_color')
        .eq('id', apt.host_id)
        .maybeSingle(),
      db.from('apartment_details')
        .select('id, category, content, is_private')
        .eq('apartment_id', aptId),
      db.from('host_picks')
        .select('id, name, category, address, lat, lng, note, display_order')
        .eq('apartment_id', aptId)
        .order('display_order'),
      db.from('guide_recommendations')
        .select('categories')
        .eq('apartment_id', aptId)
        .maybeSingle(),
    ])

    if (hostErr) {
      console.error('[guest-preview] host', hostErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Query failed' })
    }
    if (detErr) {
      console.error('[guest-preview] details', detErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Query failed' })
    }
    if (picksErr) {
      console.error('[guest-preview] picks', picksErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Query failed' })
    }
    if (guideErr) {
      console.error('[guest-preview] guide', guideErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Query failed' })
    }

    return res.status(200).json({
      apartment: apt,
      host:      hostRow ?? { brand_name: null, logo_url: null, whatsapp: null, subscription_status: 'trial', accent_color: null },
      details:   detRows ?? [],
      hostPicks: picks ?? [],
      guide:     guide?.categories ?? {},
    })
  } catch (e) {
    console.error('[guest-preview] unexpected', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
    return res.status(500).json({ error: 'Internal error' })
  }
}
