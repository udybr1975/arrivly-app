import webpush from 'web-push'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface PushPayload {
  title: string
  body?: string
  url?: string
}

export interface PushSummary {
  sent: number
  pruned: number
  failed: number
}

interface SubRow {
  endpoint: string
  p256dh: string
  auth_key: string
}

let configured = false

// Reads the PUBLIC VAPID key from VITE_VAPID_PUBLIC_KEY by design: it is not a
// secret (the browser uses the same value to subscribe), and Vercel exposes all
// env vars to functions regardless of prefix. Do NOT "fix" this to a new var.
export function isPushConfigured(): boolean {
  if (configured) return true
  const subject = process.env.VAPID_SUBJECT
  const publicKey = process.env.VITE_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!subject || !publicKey || !privateKey) return false
  webpush.setVapidDetails(subject, publicKey, privateKey)
  configured = true
  return true
}

/**
 * Deliver a notification to every device a host has registered.
 * Never throws — returns a summary. Dead subscriptions (404/410) are pruned.
 * db must be able to read/delete the host's push_subscriptions rows
 * (service-role for internal callers, or the host's own RLS-scoped client).
 * Omit apartmentId for account-level host devices (they store apartment_id null).
 */
export async function sendPushToHost(
  db: SupabaseClient,
  hostId: string,
  payload: PushPayload,
  apartmentId?: string
): Promise<PushSummary> {
  const empty: PushSummary = { sent: 0, pruned: 0, failed: 0 }
  if (!isPushConfigured()) return empty
  if (!payload.title || !payload.title.trim()) return empty

  const base = db
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key')
    .eq('host_id', hostId)
    .eq('role', 'host')

  const { data, error } = await (apartmentId ? base.eq('apartment_id', apartmentId) : base)
  if (error || !data || data.length === 0) return empty

  const subs = data as SubRow[]
  const serialized = JSON.stringify({
    title: payload.title.trim().slice(0, 200),
    body: typeof payload.body === 'string' ? payload.body.slice(0, 500) : '',
    url: typeof payload.url === 'string' && (payload.url.startsWith('/') || payload.url.startsWith('https://'))
      ? payload.url.slice(0, 500)
      : '/',
  })

  let sent = 0
  let pruned = 0
  let failed = 0

  await Promise.all(
    subs.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth_key } },
          serialized
        )
        sent++
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode
        if (statusCode === 404 || statusCode === 410) {
          await db.from('push_subscriptions').delete().eq('host_id', hostId).eq('endpoint', row.endpoint).eq('role', 'host')
          pruned++
        } else {
          console.error('[push] delivery error', { statusCode })
          failed++
        }
      }
    })
  )

  return { sent, pruned, failed }
}
