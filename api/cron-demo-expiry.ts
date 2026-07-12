import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'
import { sendEmail, demoEndedEmail } from './_lib/email.js'

// Hourly: closes lapsed demos. The live guest page is gated on apartments.is_visible
// (NOT subscription_status), so we flip status='expired' (which the client dashboard
// wall reads) AND set the apartment(s) is_visible=false (which actually closes the
// guest page). CRON_SECRET-gated, fails closed. Service-role.

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const APP_URL = process.env.VITE_APP_URL || 'https://bemgu.app'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const nowIso = new Date().toISOString()

  // 1) IDEMPOTENT guest-page close for EVERY lapsed demo — NOT gated on the status
  // transition, so it runs (and self-heals) every hour. This is decoupled from the
  // one-time email claim below on purpose: if a prior run flipped the status but its
  // page-close transiently failed, the host would be skipped by the `<> 'expired'`
  // claim forever — yet the guest page (gated on apartments.is_visible) would stay live.
  // Re-closing every lapsed demo's still-visible apartments each run fixes that.
  const { data: lapsed, error: lapsedErr } = await supabase
    .from('hosts')
    .select('id')
    .eq('is_demo', true)
    .lte('demo_expires_at', nowIso)
  if (lapsedErr) {
    console.error('[cron-demo-expiry] lapsed query failed —', lapsedErr.message?.slice(0, 120))
    return res.status(500).json({ error: 'query_failed' })
  }
  const lapsedIds = (lapsed ?? []).map((h) => h.id as string)
  if (lapsedIds.length > 0) {
    const { error: hideErr } = await supabase
      .from('apartments')
      .update({ is_visible: false })
      .in('host_id', lapsedIds)
      .eq('is_visible', true)
    if (hideErr) console.error('[cron-demo-expiry] hide apartments failed —', hideErr.message?.slice(0, 120))
  }

  // 2) ATOMIC CLAIM: flip + claim every lapsed demo in ONE UPDATE...RETURNING, for the
  // ONE-TIME email only. The `<> 'expired'` predicate is re-evaluated on the locked row
  // under concurrency, so overlapping runs each transition a host at most once → no
  // double-email. (Page closure above is idempotent and independent of this claim.)
  const { data: claimed, error } = await supabase
    .from('hosts')
    .update({ subscription_status: 'expired' })
    .eq('is_demo', true)
    .lte('demo_expires_at', nowIso)
    .neq('subscription_status', 'expired')
    .select('id, contact_email, name')
  if (error) {
    console.error('[cron-demo-expiry] claim failed —', error.message?.slice(0, 120))
    return res.status(500).json({ error: 'claim_failed' })
  }

  const hosts = (claimed ?? []) as Array<{ id: string; contact_email: string | null; name: string | null }>
  let emailed = 0

  for (const host of hosts) {
    // Best-effort email — a send failure must NOT fail the run or undo the flip. The
    // recipient comes from the DB row only.
    if (host.contact_email) {
      const result = await sendEmail({ to: host.contact_email, ...demoEndedEmail({ firstName: host.name, appUrl: APP_URL }) })
      if (result.ok) emailed++
    }
  }

  return res.status(200).json({ ok: true, expired: hosts.length, emailed })
}
