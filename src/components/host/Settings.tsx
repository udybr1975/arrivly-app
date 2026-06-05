import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../shared/Toast'
import { checkPermission, subscribeToPush, unsubscribeFromPush, isSubscribed, reaffirmSubscription } from '../../lib/webpush'
import Loader from '../shared/Loader'
import InstallCard from './InstallCard'

type PushState = 'loading' | 'off' | 'on' | 'blocked'

export default function Settings() {
  const { toast } = useToast()
  const [userId, setUserId] = useState<string | null>(null)
  const [pushState, setPushState] = useState<PushState>('loading')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      const permission = await checkPermission()
      if (permission === 'denied') {
        setPushState('blocked')
        return
      }
      const subscribed = await isSubscribed()
      if (subscribed) {
        await reaffirmSubscription(user.id)
      }
      setPushState(subscribed ? 'on' : 'off')
    }
    init()
  }, [])

  async function handleEnable() {
    if (!userId) return
    setBusy(true)
    const result = await subscribeToPush(userId)
    if (result.ok) {
      setPushState('on')
      toast('Notifications enabled', 'success')
      setBusy(false)
      return
    }
    if (result.reason === 'denied') {
      const permission = await checkPermission()
      if (permission === 'denied') {
        setPushState('blocked')
      } else {
        toast('Notification permission was not granted', 'error')
      }
    } else {
      const messages: Record<string, string> = {
        unsupported: 'This browser does not support notifications',
        'no-key': 'Push is not set up on the server yet',
        'subscribe-failed': 'Could not register this device for notifications',
        'invalid-subscription': 'Could not register this device for notifications',
        'save-failed': 'Could not save your notification settings',
      }
      toast(messages[result.reason] ?? 'Could not enable notifications', 'error')
    }
    setBusy(false)
  }

  async function handleDisable() {
    setBusy(true)
    await unsubscribeFromPush(userId ?? undefined)
    setPushState('off')
    toast('Notifications turned off', 'success')
    setBusy(false)
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-[17px] font-serif font-light text-[#1a1a1a] mb-4">Settings</h1>

      {/* InstallCard mounts immediately so its beforeinstallprompt listener
          is registered before the push-loading async resolves. */}
      <InstallCard />

      {pushState === 'loading' ? <Loader /> : (
      <div className="bg-[#1c1c1a] rounded-[10px] p-5">
        <div className="text-[11px] uppercase tracking-[.08em] text-gray-400 mb-3">Notifications</div>

        {pushState === 'off' && (
          <>
            <div className="text-[15px] font-semibold text-white mb-1">Notifications are off</div>
            <p className="text-[12px] text-gray-400 leading-relaxed mb-4">
              Get alerted on this device when something happens in your account.
            </p>
            <button
              onClick={handleEnable}
              disabled={busy}
              className="bg-white text-[#1c1c1a] px-4 py-2 rounded-[8px] text-xs font-semibold hover:opacity-80 transition-opacity disabled:opacity-40"
            >
              {busy ? 'Enabling…' : 'Enable notifications'}
            </button>
          </>
        )}

        {pushState === 'on' && (
          <>
            <div className="text-[15px] font-semibold text-white mb-1">Notifications are on</div>
            <p className="text-[12px] text-gray-400 leading-relaxed mb-4">
              You'll receive alerts on this device for account activity.
            </p>
            <button
              onClick={handleDisable}
              disabled={busy}
              className="bg-white/10 border border-white/20 text-white px-4 py-2 rounded-[8px] text-xs font-semibold hover:bg-white/20 transition-colors disabled:opacity-40"
            >
              {busy ? 'Turning off…' : 'Turn off'}
            </button>
          </>
        )}

        {pushState === 'blocked' && (
          <>
            <div className="text-[15px] font-semibold text-white mb-1">Notifications are blocked</div>
            <p className="text-[12px] text-gray-400 leading-relaxed">
              Your browser is blocking notifications for this site. To turn them on, open your browser&apos;s site settings, find this address, and allow notifications. Then come back here.
            </p>
          </>
        )}
      </div>
      )}
    </div>
  )
}
