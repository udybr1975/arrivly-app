import { supabase } from './supabase'

export type SubscribeResult =
  | { ok: true }
  | {
      ok: false
      reason: 'unsupported' | 'denied' | 'no-key' | 'subscribe-failed' | 'invalid-subscription' | 'save-failed'
      detail?: string
    }

type AcquireResult =
  | { ok: true; subscription: { endpoint: string; keys: { p256dh: string; auth: string } } }
  | { ok: false; reason: 'unsupported' | 'denied' | 'no-key' | 'subscribe-failed' | 'invalid-subscription'; detail?: string }

// Encapsulates the browser-side permission + VAPID subscribe flow (no DB writes).
// Reuses an existing PushSubscription when the VAPID key matches, unsubscribes stale
// subs otherwise (the mobile InvalidStateError fix).
async function acquirePushSubscription(): Promise<AcquireResult> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'unsupported' }
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, reason: 'denied' }
  }

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!vapidPublicKey) {
    return { ok: false, reason: 'no-key' }
  }

  let subscription: PushSubscription
  try {
    const reg = await navigator.serviceWorker.ready
    const appServerKey = urlBase64ToUint8Array(vapidPublicKey)
    const existing = await reg.pushManager.getSubscription()

    if (existing && applicationServerKeyMatches(existing, appServerKey)) {
      // Same VAPID key — reuse so the endpoint stays stable (no orphaned DB row).
      subscription = existing
    } else {
      if (existing) await existing.unsubscribe()
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey,
      })
    }
  } catch (e) {
    const err = e instanceof Error ? e : null
    return { ok: false, reason: 'subscribe-failed', detail: err ? `${err.name}: ${err.message.slice(0, 80)}` : 'unknown error' }
  }

  const json = subscription.toJSON()
  const { endpoint, keys } = json
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return { ok: false, reason: 'invalid-subscription', detail: 'missing keys' }
  }

  return { ok: true, subscription: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } } }
}

export async function checkPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied'
  return Notification.permission
}

export async function subscribeToPush(hostId?: string, apartmentId?: string): Promise<SubscribeResult> {
  const acquired = await acquirePushSubscription()
  if (!acquired.ok) return acquired

  const { subscription } = acquired
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      host_id: hostId ?? null,
      apartment_id: apartmentId ?? null,
      role: hostId ? 'host' : 'guest',
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth_key: subscription.keys.auth,
    },
    { onConflict: 'endpoint' }
  )
  if (error) return { ok: false, reason: 'save-failed' }
  return { ok: true }
}

// Guest subscribe — no direct DB write (guests are anon; RLS blocks client writes).
// POSTs to /api/guest-subscribe which writes with the service-role key server-side.
export async function subscribeGuestToPush(apartmentId: string, token: string): Promise<SubscribeResult> {
  const acquired = await acquirePushSubscription()
  if (!acquired.ok) return acquired

  const { subscription } = acquired
  try {
    const res = await fetch('/api/guest-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apartmentId,
        token,
        subscription: {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
        },
      }),
    })
    if (!res.ok) return { ok: false, reason: 'save-failed', detail: `http ${res.status}` }
  } catch {
    return { ok: false, reason: 'save-failed' }
  }

  return { ok: true }
}

// True when the page is running as an installed PWA (standalone display mode).
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true
  )
}

// Returns true when on iOS Safari but NOT running as a standalone PWA.
// Mirrors InstallPrompt.tsx exactly — standalone check first, then iOS Safari UA filter.
export function iosNeedsHomeScreen(): boolean {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true
  const ua = navigator.userAgent
  const iosSafari = /iphone|ipad|ipod/i.test(ua) && !/crios|fxios/i.test(ua)
  return iosSafari && !standalone
}

export async function unsubscribeFromPush(hostId?: string): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  const { endpoint } = sub
  await sub.unsubscribe()
  const q = supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  await (hostId ? q.eq('host_id', hostId) : q)
}

export async function isSubscribed(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  if (Notification.permission !== 'granted') return false
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return sub !== null
  } catch {
    return false
  }
}

// Silently reaffirms the current browser subscription in the DB without prompting.
// Call on Settings load when the browser reports subscribed — heals a pruned row.
export async function reaffirmSubscription(hostId: string): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  if (Notification.permission !== 'granted') return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return
  await supabase.from('push_subscriptions').upsert(
    {
      host_id: hostId,
      apartment_id: null,
      role: 'host',
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth_key: json.keys.auth,
    },
    { onConflict: 'endpoint' }
  )
}

function applicationServerKeyMatches(sub: PushSubscription, key: Uint8Array): boolean {
  const k = sub.options?.applicationServerKey
  if (!k) return false
  const a = new Uint8Array(k as ArrayBuffer)
  if (a.byteLength !== key.byteLength) return false
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== key[i]) return false
  return true
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}
