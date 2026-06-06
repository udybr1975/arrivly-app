import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Must match ARRIVLY_CONFIG.adminEmail in src/config.ts — not importable here (import.meta.env)
const ADMIN_EMAIL = 'udy.bar.yosef@gmail.com'

const anon = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!)
const svc  = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const h     = req.headers.authorization
  const token = h?.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const { data: { user }, error: userErr } = await anon().auth.getUser(token)
  if (userErr || !user) return res.status(401).json({ error: 'Unauthorized' })
  if (user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'forbidden' })

  const body = req.body ?? {}
  const { plans, trial_days } = body

  // Validate plans array — only price_cents and max_properties are editable
  if (plans !== undefined) {
    if (!Array.isArray(plans)) return res.status(400).json({ error: 'Invalid plans' })
    const seen = new Set<number>()
    for (const p of plans) {
      if (![1, 2, 3, 4].includes(p?.tier)) return res.status(400).json({ error: 'Invalid tier' })
      if (seen.has(p.tier)) return res.status(400).json({ error: 'Duplicate tier' })
      seen.add(p.tier)
      if (!Number.isInteger(p.price_cents) || p.price_cents < 0 || p.price_cents > 100000) {
        return res.status(400).json({ error: 'Invalid price_cents' })
      }
      const cap = p.max_properties
      if (cap !== null && cap !== undefined) {
        if (!Number.isInteger(cap) || cap < 1 || cap > 100000) {
          return res.status(400).json({ error: 'Invalid max_properties' })
        }
      }
    }
  }

  if (trial_days !== undefined && trial_days !== null) {
    if (!Number.isInteger(trial_days) || trial_days < 1 || trial_days > 365) {
      return res.status(400).json({ error: 'Invalid trial_days' })
    }
  }

  if (plans === undefined && (trial_days === undefined || trial_days === null)) {
    return res.status(400).json({ error: 'Nothing to update' })
  }

  const db = svc()
  try {
    if (Array.isArray(plans) && plans.length > 0) {
      const now     = new Date().toISOString()
      const results = await Promise.all(
        (plans as { tier: number; price_cents: number; max_properties: number | null }[]).map(p =>
          db.from('plans')
            .update({
              price_cents:    p.price_cents,
              max_properties: p.max_properties ?? null,
              updated_at:     now,
            })
            .eq('tier', p.tier)
        )
      )
      const planErr = results.find(r => r.error)?.error
      if (planErr) {
        console.error('[admin-plans] update plans', planErr.message?.slice(0, 120))
        return res.status(500).json({ error: 'Update failed' })
      }
    }

    if (trial_days !== undefined && trial_days !== null) {
      const { error: settingsErr } = await db.from('app_settings')
        .update({ trial_days })
        .eq('id', 1)
      if (settingsErr) {
        console.error('[admin-plans] update settings', settingsErr.message?.slice(0, 120))
        return res.status(500).json({ error: 'Update failed' })
      }
    }

    // Best-effort audit after updates succeed
    const { error: auditErr } = await db.from('admin_audit').insert({
      actor_email:    user.email ?? user.id,
      action:         'update_plans',
      target_host_id: null,
      detail:         { plans, trial_days },
    })
    if (auditErr) console.error('[admin-plans] audit', auditErr.message?.slice(0, 120))

    const [
      { data: planRows,    error: planReadErr    },
      { data: settingsRow, error: settingsReadErr },
    ] = await Promise.all([
      db.from('plans')
        .select('tier, label, price_cents, currency, max_properties, includes_booking, updated_at')
        .order('tier'),
      db.from('app_settings').select('trial_days').eq('id', 1).maybeSingle(),
    ])

    if (planReadErr) {
      console.error('[admin-plans] read-back plans', planReadErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Read-back failed' })
    }
    if (settingsReadErr) {
      console.error('[admin-plans] read-back settings', settingsReadErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Read-back failed' })
    }

    return res.status(200).json({
      plans:      planRows ?? [],
      trial_days: settingsRow?.trial_days ?? 30,
    })
  } catch (e) {
    console.error('[admin-plans] unexpected', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
    return res.status(500).json({ error: 'Internal error' })
  }
}
