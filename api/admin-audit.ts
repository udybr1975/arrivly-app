import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Must match ARRIVLY_CONFIG.adminEmail in src/config.ts — not importable here (import.meta.env)
const ADMIN_EMAIL = 'udy.bar.yosef@gmail.com'

const anon = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!)
const svc  = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const h     = req.headers.authorization
  const token = h?.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const { data: { user }, error: userErr } = await anon().auth.getUser(token)
  if (userErr || !user) return res.status(401).json({ error: 'Unauthorized' })
  if (user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'forbidden' })

  const db = svc()
  try {
    const [
      { data: entries,  error: entriesErr  },
      { data: hostRows, error: hostsErr    },
    ] = await Promise.all([
      db.from('admin_audit')
        .select('id, actor_email, action, target_host_id, detail, created_at')
        .order('created_at', { ascending: false })
        .limit(50),
      db.from('hosts').select('id, brand_name, name'),
    ])

    if (entriesErr) {
      console.error('[admin-audit] entries', entriesErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Query failed' })
    }
    if (hostsErr) {
      console.error('[admin-audit] hosts', hostsErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'Query failed' })
    }

    const hostNames: Record<string, string> = {}
    for (const row of hostRows ?? []) {
      hostNames[row.id] = row.brand_name ?? row.name ?? row.id.slice(0, 8)
    }

    return res.status(200).json({ entries: entries ?? [], hostNames })
  } catch (e) {
    console.error('[admin-audit] unexpected', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
    return res.status(500).json({ error: 'Internal error' })
  }
}
