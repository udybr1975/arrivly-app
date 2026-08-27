import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Must match ARRIVLY_CONFIG.adminEmail in src/config.ts — not importable here (import.meta.env)
const ADMIN_EMAIL = 'udy.bar.yosef@gmail.com'

const anon = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!)
const svc  = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // This response varies by the ADMIN Bearer token in the Authorization header, and its URL
  // carries NO parameters at all — so a URL-keyed shared cache would hold every host row
  // under ONE key. Never let it be stored by a CDN, a proxy or the browser. Set BEFORE the
  // method guard and before any branch, so every return path carries it AND so its presence
  // can never itself signal that a valid credential was supplied.
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const h = req.headers.authorization
  const token = h?.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const { data: { user }, error: userErr } = await anon().auth.getUser(token)
  if (userErr || !user) return res.status(401).json({ error: 'Unauthorized' })
  if (user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'forbidden' })

  const db = svc()
  try {
    const [
      { data: hostRows,    error: hostErr      },
      { data: planRows,    error: planErr      },
      { data: aptRows,     error: aptErr       },
      { data: bookingRows, error: bookingErr   },
      { data: settingsRow, error: settingsErr  },
    ] = await Promise.all([
      db.from('hosts')
        .select('id, brand_name, name, contact_email, city, subscription_status, tier, is_exempt, is_test, is_demo, trial_ends_at, created_at, price_override_cents, discount_percent, discount_until, property_cap_override')
        .order('created_at', { ascending: false }),
      db.from('plans').select('*').order('tier'),
      db.from('apartments').select('id, host_id'),
      db.from('bookings').select('apartment_id'),
      db.from('app_settings').select('trial_days').eq('id', 1).maybeSingle(),
    ])

    if (hostErr)     { console.error('[admin-overview] hosts',    hostErr.message?.slice(0, 120));     return res.status(500).json({ error: 'Query failed' }) }
    if (planErr)     { console.error('[admin-overview] plans',    planErr.message?.slice(0, 120));     return res.status(500).json({ error: 'Query failed' }) }
    if (aptErr)      { console.error('[admin-overview] apts',     aptErr.message?.slice(0, 120));      return res.status(500).json({ error: 'Query failed' }) }
    if (bookingErr)  { console.error('[admin-overview] bookings', bookingErr.message?.slice(0, 120));  return res.status(500).json({ error: 'Query failed' }) }
    if (settingsErr) { console.error('[admin-overview] settings', settingsErr.message?.slice(0, 120)); return res.status(500).json({ error: 'Query failed' }) }

    type PlanRow = { tier: number; price_cents: number; max_properties: number | null; includes_booking: boolean }
    const plans = (planRows ?? []) as PlanRow[]
    const planMap = new Map(plans.map(p => [p.tier, p]))

    // apartments_count per host + apartment→host lookup for bookings
    const aptCountByHost = new Map<string, number>()
    const aptToHost      = new Map<string, string>()
    for (const a of aptRows ?? []) {
      aptCountByHost.set(a.host_id, (aptCountByHost.get(a.host_id) ?? 0) + 1)
      aptToHost.set(a.id, a.host_id)
    }

    // bookings_count per host via apartment→host mapping
    const bookingCountByHost = new Map<string, number>()
    for (const b of bookingRows ?? []) {
      const hostId = aptToHost.get(b.apartment_id)
      if (hostId) bookingCountByHost.set(hostId, (bookingCountByHost.get(hostId) ?? 0) + 1)
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const hosts = (hostRows ?? []).map(h => {
      const plan = planMap.get(h.tier ?? 1)
      const base = h.price_override_cents ?? plan?.price_cents ?? 1900
      let effective_price_cents = base
      if (h.discount_percent) {
        const active = !h.discount_until || new Date(h.discount_until) >= today
        if (active) effective_price_cents = Math.round(base * (1 - h.discount_percent / 100))
      }
      const days_left = h.trial_ends_at
        ? Math.floor((new Date(h.trial_ends_at).getTime() - Date.now()) / 86400000)
        : null

      return {
        ...h,
        is_exempt: !!h.is_exempt,
        is_test: !!h.is_test,
        is_demo: !!h.is_demo,
        apartments_count:  aptCountByHost.get(h.id)     ?? 0,
        bookings_count:    bookingCountByHost.get(h.id)  ?? 0,
        effective_price_cents,
        days_left,
      }
    })

    // Metrics describe the REAL business only. The full `hosts` list is still returned intact,
    // each row carrying is_test, for a LATER UI pass — SuperAdmin.tsx does not render the flag
    // yet, so until it does the operator sees `totals` excluding hosts that the list below still
    // shows, with no on-screen cue. Deliberate; the greying-out is the next change, not this one.
    // TWO exclusions now, and they are different populations: is_test is the operator's own
    // fixture accounts, is_demo is a 48-hour SANDBOX signup. A sandbox host is a stranger
    // trying the product, not a customer — counting them would inflate total_hosts and
    // on_trial on the one dashboard the launch is read from, and every one of them expires.
    // MRR is untouched by the second filter in practice (a demo host has no subscription),
    // but it is applied to the same list on purpose: one definition of "a real host".
    const realHosts = hosts.filter(h => !h.is_test && !h.is_demo)

    const mrr_cents = realHosts
      .filter(h => h.subscription_status === 'active' && !h.is_exempt)
      .reduce((sum, h) => sum + h.effective_price_cents, 0)

    const totals = {
      total_hosts:  realHosts.length,
      on_trial:     realHosts.filter(h => h.subscription_status === 'trial').length,
      paid_active:  realHosts.filter(h => h.subscription_status === 'active').length,
      grace:        realHosts.filter(h => h.subscription_status === 'grace').length,
      expired:      realHosts.filter(h => h.subscription_status === 'expired').length,
      mrr_cents,
    }

    return res.status(200).json({ hosts, totals, plans, trial_days: settingsRow?.trial_days ?? 30 })
  } catch (e) {
    console.error('[admin-overview] unexpected', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
    return res.status(500).json({ error: 'Internal error' })
  }
}
