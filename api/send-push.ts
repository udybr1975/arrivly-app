import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

interface SubRow {
  endpoint: string
  p256dh: string
  auth_key: string
}

type SendResult =
  | { ok: true; row: SubRow }
  | { ok: false; row: SubRow; err: unknown }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Validate VAPID config inside the handler (not at module top-level) so the
  // module can still be imported even when keys are absent in non-push envs.
  const VAPID_SUBJECT = process.env.VAPID_SUBJECT
  const VAPID_PUBLIC_KEY = process.env.VITE_VAPID_PUBLIC_KEY
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
  if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return res.status(500).json({ error: 'Push not configured' })
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

  // Auth — same pattern as rewrite-rules.ts but with user token in global
  // headers so all subsequent DB queries run under the caller's RLS context.
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const sb = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    }
  )
  const { data: authData, error: authError } = await sb.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })
  const userId = authData.user.id

  // Body validation
  if (!req.body) return res.status(400).json({ error: 'title is required' })

  const { title, body, url, apartmentId } = req.body as {
    title?: string
    body?: string
    url?: string
    apartmentId?: string
  }

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' })
  }

  const trimmedTitle = title.trim().slice(0, 200)
  const trimmedBody = typeof body === 'string' ? body.slice(0, 500) : ''
  const trimmedUrl = typeof url === 'string' ? url.slice(0, 500) : '/'

  // Subscription lookup — host_id guard is belt-and-suspenders; RLS also scopes it.
  const baseQuery = sb
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key')
    .eq('host_id', userId)
    .eq('role', 'host')

  const { data: rawSubs, error: subErr } = await (
    apartmentId && typeof apartmentId === 'string'
      ? baseQuery.eq('apartment_id', apartmentId)
      : baseQuery
  )
  if (subErr) return res.status(500).json({ error: 'lookup failed' })

  const subs = (rawSubs ?? []) as SubRow[]
  if (subs.length === 0) return res.status(200).json({ sent: 0, pruned: 0, failed: 0 })

  // Payload must match sw.js push handler: data.title / data.body / data.url
  const payload = JSON.stringify({ title: trimmedTitle, body: trimmedBody, url: trimmedUrl })

  const results: SendResult[] = await Promise.all(
    subs.map(row =>
      webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth_key } },
        payload
      )
      .then((): SendResult => ({ ok: true, row }))
      .catch((err: unknown): SendResult => ({ ok: false, row, err }))
    )
  )

  let sent = 0
  let pruned = 0
  let failed = 0

  for (const result of results) {
    if (result.ok) {
      sent++
    } else {
      const statusCode = (result.err as { statusCode?: number })?.statusCode
      if (statusCode === 404 || statusCode === 410) {
        await sb.from('push_subscriptions').delete()
          .eq('host_id', userId)
          .eq('endpoint', result.row.endpoint)
        pruned++
      } else {
        console.error('[send-push] delivery error', { statusCode })
        failed++
      }
    }
  }

  return res.status(200).json({ sent, pruned, failed })
}
