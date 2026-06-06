import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

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
  if (user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'forbidden' })

  const hostId = typeof req.query.host_id === 'string' ? req.query.host_id.trim() : ''
  if (!hostId || !UUID_RE.test(hostId)) {
    return res.status(400).json({ error: 'Missing or invalid host_id' })
  }

  const db = svc()
  try {
    const [
      { data: hostRow,  error: hostErr  },
      { data: aptRows,  error: aptErr   },
      { data: planRows, error: planErr  },
    ] = await Promise.all([
      db.from('hosts')
        .select('brand_name, name, contact_email, city, tier, subscription_status, trial_ends_at, accent_color, logo_url, is_exempt, created_at, price_override_cents, discount_percent, discount_until, property_cap_override')
        .eq('id', hostId)
        .maybeSingle(),
      db.from('apartments')
        .select('id, name, city, is_visible, hero_image_url, accent_color')
        .eq('host_id', hostId),
      db.from('plans')
        .select('tier, name, price_cents, max_properties')
        .order('tier'),
    ])

    if (hostErr) {
      console.error('[admin-impersonate] host',  hostErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Query failed' })
    }
    if (aptErr) {
      console.error('[admin-impersonate] apts',  aptErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Query failed' })
    }
    if (planErr) {
      console.error('[admin-impersonate] plans', planErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Query failed' })
    }
    if (!hostRow) return res.status(404).json({ error: 'Host not found' })

    // Compute effective price — identical logic to admin-overview.ts
    type PlanRow = { tier: number; name: string; price_cents: number; max_properties: number | null }
    const plans = (planRows ?? []) as PlanRow[]
    const plan  = plans.find(p => p.tier === (hostRow.tier ?? 1))
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const base  = hostRow.price_override_cents ?? plan?.price_cents ?? 1900
    let effective_price_cents = base
    if (hostRow.discount_percent) {
      const active = !hostRow.discount_until || new Date(hostRow.discount_until) >= today
      if (active) effective_price_cents = Math.round(base * (1 - hostRow.discount_percent / 100))
    }

    const aptIds: string[] = (aptRows ?? []).map((a: { id: string }) => a.id)

    const [
      { data: bookingRows, error: bookingErr },
      { data: picksRows,   error: picksErr   },
    ] = await Promise.all([
      aptIds.length > 0
        ? db.from('bookings').select('apartment_id').in('apartment_id', aptIds)
        : Promise.resolve({ data: [] as { apartment_id: string }[], error: null }),
      aptIds.length > 0
        ? db.from('host_picks').select('apartment_id').in('apartment_id', aptIds)
        : Promise.resolve({ data: [] as { apartment_id: string }[], error: null }),
    ])

    if (bookingErr) {
      console.error('[admin-impersonate] bookings', bookingErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Query failed' })
    }
    if (picksErr) {
      console.error('[admin-impersonate] picks', picksErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Query failed' })
    }

    const bookingCount = new Map<string, number>()
    const picksCount   = new Map<string, number>()
    for (const b of (bookingRows ?? []) as { apartment_id: string }[]) {
      bookingCount.set(b.apartment_id, (bookingCount.get(b.apartment_id) ?? 0) + 1)
    }
    for (const p of (picksRows ?? []) as { apartment_id: string }[]) {
      picksCount.set(p.apartment_id, (picksCount.get(p.apartment_id) ?? 0) + 1)
    }

    const apartments = (aptRows ?? []).map((a: {
      id: string; name: string | null; city: string | null; is_visible: boolean;
      hero_image_url: string | null; accent_color: string | null
    }) => ({
      id:               a.id,
      name:             a.name,
      city:             a.city,
      is_visible:       a.is_visible,
      hero_image_url:   a.hero_image_url,
      accent_color:     a.accent_color,
      bookings_count:   bookingCount.get(a.id) ?? 0,
      host_picks_count: picksCount.get(a.id)   ?? 0,
    }))

    // Best-effort audit — log on error, never fail the main request
    const { error: auditErr } = await db.from('admin_audit').insert({
      actor_email:    user.email ?? user.id,
      action:         'impersonate_view',
      target_host_id: hostId,
      detail:         { apartments: apartments.length },
    })
    if (auditErr) console.error('[admin-impersonate] audit', auditErr.message?.slice(0, 120))

    return res.status(200).json({
      host: {
        ...hostRow,
        effective_price_cents,
        plan_label:          plan?.name          ?? null,
        plan_max_properties: plan?.max_properties ?? null,
      },
      apartments,
    })
  } catch (e) {
    console.error('[admin-impersonate] unexpected', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
    return res.status(500).json({ error: 'Internal error' })
  }
}
