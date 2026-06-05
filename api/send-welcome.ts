import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { sendEmail, welcomeEmail } from './_lib/email.js'

const anon = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!)
const admin = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const h = req.headers.authorization
  const token = h?.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const { data: { user }, error: userErr } = await anon().auth.getUser(token)
  if (userErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  const db = admin()
  // Claim: stamp only if not already set; the returned row means we won the claim.
  const { data: claimed, error: claimErr } = await db
    .from('hosts')
    .update({ welcome_email_sent_at: new Date().toISOString() })
    .eq('id', user.id)
    .is('welcome_email_sent_at', null)
    .select('name, contact_email')
    .maybeSingle()

  if (claimErr) {
    console.error('[send-welcome] claim error', claimErr.message?.slice(0, 120))
    return res.status(200).json({ sent: false, error: 'claim_failed' })
  }
  if (!claimed) return res.status(200).json({ sent: false, skipped: 'already_sent' })

  if (!claimed.contact_email) {
    await db.from('hosts').update({ welcome_email_sent_at: null }).eq('id', user.id)
    return res.status(200).json({ sent: false, skipped: 'no_email' })
  }

  const result = await sendEmail({ to: claimed.contact_email, ...welcomeEmail(claimed.name) })
  if (!result.ok) {
    await db.from('hosts').update({ welcome_email_sent_at: null }).eq('id', user.id) // release for retry
    return res.status(200).json({ sent: false, error: result.error })
  }
  return res.status(200).json({ sent: true })
}
