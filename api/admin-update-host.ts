import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Must match ARRIVLY_CONFIG.adminEmail in src/config.ts — not importable here (import.meta.env)
const ADMIN_EMAIL = 'udy.bar.yosef@gmail.com'
const UUID_RE     = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE     = /^\d{4}-\d{2}-\d{2}$/

const VALID_STATUSES     = new Set(['trial', 'active', 'grace', 'expired'])
const ALLOWED_PATCH_KEYS = new Set([
  'tier', 'subscription_status', 'price_override_cents',
  'discount_percent', 'discount_until', 'property_cap_override',
])

const anon = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!)
const svc  = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const d = new Date(s)
  return !isNaN(d.getTime())
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const h     = req.headers.authorization
  const token = h?.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const { data: { user }, error: userErr } = await anon().auth.getUser(token)
  if (userErr || !user) return res.status(401).json({ error: 'Unauthorized' })
  if (user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'forbidden' })

  const body = req.body ?? {}
  const { host_id, patch = {}, extend_trial_days } = body

  if (typeof host_id !== 'string' || !UUID_RE.test(host_id)) {
    return res.status(400).json({ error: 'Invalid host_id' })
  }

  // Reject any unrecognised patch key — strict allowlist
  for (const k of Object.keys(patch)) {
    if (!ALLOWED_PATCH_KEYS.has(k)) return res.status(400).json({ error: 'Invalid patch field' })
  }

  const safePatch: Record<string, unknown> = {}

  if ('tier' in patch) {
    if (![1, 2, 3, 4].includes(patch.tier)) return res.status(400).json({ error: 'Invalid tier' })
    safePatch.tier = patch.tier
  }
  if ('subscription_status' in patch) {
    if (typeof patch.subscription_status !== 'string' || !VALID_STATUSES.has(patch.subscription_status)) {
      return res.status(400).json({ error: 'Invalid subscription_status' })
    }
    safePatch.subscription_status = patch.subscription_status
  }
  if ('price_override_cents' in patch) {
    if (patch.price_override_cents !== null) {
      if (!Number.isInteger(patch.price_override_cents) || patch.price_override_cents < 0 || patch.price_override_cents > 100000) {
        return res.status(400).json({ error: 'Invalid price_override_cents' })
      }
    }
    safePatch.price_override_cents = patch.price_override_cents
  }
  if ('discount_percent' in patch) {
    if (patch.discount_percent !== null) {
      if (!Number.isInteger(patch.discount_percent) || patch.discount_percent < 0 || patch.discount_percent > 100) {
        return res.status(400).json({ error: 'Invalid discount_percent' })
      }
    }
    safePatch.discount_percent = patch.discount_percent
  }
  if ('discount_until' in patch) {
    if (patch.discount_until !== null) {
      if (typeof patch.discount_until !== 'string' || !isValidDate(patch.discount_until)) {
        return res.status(400).json({ error: 'Invalid discount_until' })
      }
    }
    safePatch.discount_until = patch.discount_until
  }
  if ('property_cap_override' in patch) {
    if (patch.property_cap_override !== null) {
      if (!Number.isInteger(patch.property_cap_override) || patch.property_cap_override < 1 || patch.property_cap_override > 1000) {
        return res.status(400).json({ error: 'Invalid property_cap_override' })
      }
    }
    safePatch.property_cap_override = patch.property_cap_override
  }

  let extendDays: number | null = null
  if (extend_trial_days !== undefined && extend_trial_days !== null) {
    if (!Number.isInteger(extend_trial_days) || extend_trial_days < 1 || extend_trial_days > 365) {
      return res.status(400).json({ error: 'Invalid extend_trial_days' })
    }
    extendDays = extend_trial_days as number
  }

  if (Object.keys(safePatch).length === 0 && extendDays === null) {
    return res.status(400).json({ error: 'Nothing to update' })
  }

  const db = svc()
  try {
    if (extendDays !== null) {
      const { data: current, error: readErr } = await db
        .from('hosts')
        .select('trial_ends_at')
        .eq('id', host_id)
        .maybeSingle()

      if (readErr) {
        console.error('[admin-update-host] read trial', readErr.message?.slice(0, 120))
        return res.status(500).json({ error: 'Query failed' })
      }
      if (!current) return res.status(404).json({ error: 'Host not found' })

      // Extend from current end date if still future; otherwise extend from now
      const trialBase = current.trial_ends_at && new Date(current.trial_ends_at) > new Date()
        ? new Date(current.trial_ends_at)
        : new Date()
      trialBase.setDate(trialBase.getDate() + extendDays)
      safePatch.trial_ends_at = trialBase.toISOString()
    }

    const { error: updateErr } = await db
      .from('hosts')
      .update(safePatch)
      .eq('id', host_id)

    if (updateErr) {
      console.error('[admin-update-host] update', updateErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Update failed' })
    }

    // Best-effort audit — written after update succeeds; error never fails the request
    const { error: auditErr } = await db.from('admin_audit').insert({
      actor_email:    user.email ?? user.id,
      action:         'update_host',
      target_host_id: host_id,
      detail:         { patch: safePatch, extend_trial_days: extendDays },
    })
    if (auditErr) console.error('[admin-update-host] audit', auditErr.message?.slice(0, 120))

    // Read back updated row + plans for computed response
    const [
      { data: updatedRow, error: hostErr },
      { data: planRows,   error: planErr },
    ] = await Promise.all([
      db.from('hosts')
        .select('tier, subscription_status, trial_ends_at, price_override_cents, discount_percent, discount_until, property_cap_override')
        .eq('id', host_id)
        .maybeSingle(),
      db.from('plans')
        .select('tier, label, price_cents, max_properties')
        .order('tier'),
    ])

    if (hostErr) {
      console.error('[admin-update-host] read-back host', hostErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Read-back failed' })
    }
    if (planErr) {
      console.error('[admin-update-host] read-back plans', planErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Read-back failed' })
    }
    if (!updatedRow) return res.status(404).json({ error: 'Host not found' })

    // Effective price — identical logic to admin-overview/admin-impersonate
    type PlanRow = { tier: number; label: string; price_cents: number; max_properties: number | null }
    const plans = (planRows ?? []) as PlanRow[]
    const plan  = plans.find(p => p.tier === (updatedRow.tier ?? 1))
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const base  = updatedRow.price_override_cents ?? plan?.price_cents ?? 1900
    let effective_price_cents = base
    if (updatedRow.discount_percent) {
      const active = !updatedRow.discount_until || new Date(updatedRow.discount_until) >= today
      if (active) effective_price_cents = Math.round(base * (1 - updatedRow.discount_percent / 100))
    }

    return res.status(200).json({
      ...updatedRow,
      effective_price_cents,
      plan_label:          plan?.label          ?? null,
      plan_max_properties: plan?.max_properties ?? null,
    })
  } catch (e) {
    console.error('[admin-update-host] unexpected', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
    return res.status(500).json({ error: 'Internal error' })
  }
}
