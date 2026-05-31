import { supabase } from './supabase'

export type SubscribeResult =
  | { ok: true }
  | {
      ok: false
      reason: 'unsupported' | 'denied' | 'no-key' | 'subscribe-failed' | 'invalid-subscription' | 'save-failed'
    }

export async function checkPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied'
  return Notification.permission
}

export async function subscribeToPush(hostId?: string, apartmentId?: string): Promise<SubscribeResult> {
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
    // A subscription left over from an earlier visit (created before the VAPID
    // key existed, or with a different key) makes a fresh subscribe throw
    // InvalidStateError on some browsers. Clear it first, then subscribe clean.
    const existing = await reg.pushManager.getSubscription()
    if (existing) {
      await existing.unsubscribe()
    }
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    })
  } catch {
    return { ok: false, reason: 'subscribe-failed' }
  }

  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, reason: 'invalid-subscription' }
  }

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      host_id: hostId ?? null,
      apartment_id: apartmentId ?? null,
      role: hostId ? 'host' : 'guest',
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth_key: json.keys.auth,
    },
    { onConflict: 'endpoint' }
  )
  if (error) {
    return { ok: false, reason: 'save-failed' }
  }

  return { ok: true }
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

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}
