import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'
import { sendPushToHost } from './_lib/push.js'
import { sendEmail, trialReminderEmail } from './_lib/email.js'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const REMINDER_DAYS_BEFORE = 5

function daysLeftFrom(trialEndsAt: string): number {
  return Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + REMINDER_DAYS_BEFORE))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + REMINDER_DAYS_BEFORE + 1))

  const { data, error } = await supabase
    .from('hosts')
    .select('id, name, contact_email, trial_ends_at')
    .eq('subscription_status', 'trial')
    .is('trial_reminder_sent_at', null)
    .gte('trial_ends_at', start.toISOString())
    .lt('trial_ends_at', end.toISOString())
  if (error) return res.status(500).json({ error: 'Query failed' })

  const hosts = (data ?? []) as Array<{ id: string; name: string | null; contact_email: string | null; trial_ends_at: string }>
  let pushed = 0, emailed = 0

  for (const host of hosts) {
    // Atomic claim: stamp before sending so a Lambda crash cannot cause a double-send.
    // If another cron run already claimed this host, maybeSingle() returns null → skip.
    const { data: claimed } = await supabase
      .from('hosts')
      .update({ trial_reminder_sent_at: new Date().toISOString() })
      .eq('id', host.id)
      .is('trial_reminder_sent_at', null)
      .select('id')
      .maybeSingle()
    if (!claimed) continue

    const daysLeft = daysLeftFrom(host.trial_ends_at)
    const dayWord = daysLeft === 1 ? 'day' : 'days'

    const summary = await sendPushToHost(supabase, host.id, {
      title: 'Trial ending soon',
      body: `Your Bemgu trial ends in ${daysLeft} ${dayWord}. Add a payment method to keep your guest page live.`,
      url: '/dashboard/billing',
    })
    if (summary.sent > 0) pushed++

    if (host.contact_email) {
      const result = await sendEmail({ to: host.contact_email, ...trialReminderEmail(host.name, daysLeft) })
      if (result.ok) emailed++
    }
  }

  return res.status(200).json({ ok: true, eligible: hosts.length, pushed, emailed })
}
