import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'
import { sendPushToHost } from './_lib/push.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const REMINDER_DAYS_BEFORE = 5

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + REMINDER_DAYS_BEFORE))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + REMINDER_DAYS_BEFORE + 1))

  const { data, error } = await supabase
    .from('hosts')
    .select('id')
    .eq('subscription_status', 'trial')
    .gte('trial_ends_at', start.toISOString())
    .lt('trial_ends_at', end.toISOString())
  if (error) return res.status(500).json({ error: 'Query failed' })

  const hosts = (data ?? []) as Array<{ id: string }>
  let pushed = 0
  for (const host of hosts) {
    const summary = await sendPushToHost(supabase, host.id, {
      title: 'Trial ending soon',
      body: `Your Arrivly trial ends in ${REMINDER_DAYS_BEFORE} days. Add a payment method to keep your guest page live.`,
      url: '/dashboard/billing',
    })
    if (summary.sent > 0) pushed++
  }

  return res.status(200).json({ ok: true, eligible: hosts.length, pushed })
}
