import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useToast } from '../shared/Toast'
import { checkPermission, subscribeToPush, unsubscribeFromPush, isSubscribed, reaffirmSubscription } from '../../lib/webpush'
import Loader from '../shared/Loader'
import InstallCard from './InstallCard'

type PushState = 'loading' | 'off' | 'on' | 'blocked'

interface HostData {
  brand_name: string | null
  subscription_status: string | null
  trial_ends_at: string | null
}

// ── Phase H chrome tokens (copied from BookingManager.tsx) ───────────────────
const CARD = 'bg-[#fffdf9] border border-[#e4ddd0] rounded-[14px] p-5 mb-4'
const EYEBROW = 'text-[10px] font-medium uppercase tracking-[.12em] text-[#a79e8e] mb-3'
const BTN_SAVE = 'bg-[#c8a24e] text-[#16100d] px-5 py-2.5 rounded-[10px] text-xs font-semibold hover:bg-[#e7d6ad] transition-colors disabled:opacity-40 disabled:hover:bg-[#c8a24e]'
const BTN_OUTLINE = 'bg-transparent border border-[#e4ddd0] text-[#231d17] px-4 py-2 rounded-[10px] text-xs font-semibold hover:bg-[#f0ede6] transition-colors disabled:opacity-40'
const BTN_DANGER = 'bg-transparent border border-[#e2c4bf] text-[#a23b32] px-4 py-2 rounded-[10px] text-xs font-semibold hover:bg-[#f7ece9] transition-colors'
const LINK = 'text-[12px] font-medium text-[#a8842f] hover:text-[#c8a24e] transition-colors'

// "Coming" pill for follow-up features that have no control yet.
function ComingPill() {
  return (
    <span className="text-[9.5px] font-semibold uppercase tracking-[.08em] bg-[#f6efdd] border border-[#ecdfbe] text-[#b09a6a] px-2 py-0.5 rounded-full">
      Coming
    </span>
  )
}

const NOTIFY_EVENTS = ['New booking added', 'Guest sends a message', 'Trial ending soon', 'Check-out reminder']

export default function Settings() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [userId, setUserId] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [host, setHost] = useState<HostData | null>(null)
  const [pushState, setPushState] = useState<PushState>('loading')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)
      setEmail(user.email ?? '')

      const { data: hostRow } = await supabase
        .from('hosts')
        .select('brand_name, subscription_status, trial_ends_at')
        .eq('id', user.id)
        .maybeSingle()
      if (hostRow) setHost(hostRow)

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

  // Mirror Layout.signOut exactly.
  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) {
      await supabase.auth.signOut({ scope: 'local' })
    }
    navigate('/login', { replace: true })
  }

  const trialRemaining = host?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(host.trial_ends_at).getTime() - Date.now()) / 86_400_000))
    : 0
  const showTrial = host?.subscription_status === 'trial' && trialRemaining > 0
  const statusLabel = host?.subscription_status
    ? host.subscription_status.charAt(0).toUpperCase() + host.subscription_status.slice(1)
    : '—'
  const initial = (host?.brand_name?.trim()?.[0] ?? email?.[0] ?? 'A').toUpperCase()

  return (
    <div className="max-w-2xl font-['Inter']">
      <h1 className="text-[22px] font-['Fraunces'] font-light text-[#231d17] mb-4">Settings</h1>

      {/* ── 1) ACCOUNT ─────────────────────────────────────────────────────── */}
      <div className={CARD}>
        <div className={EYEBROW}>Account</div>
        <div className="flex items-center gap-3">
          <div className="shrink-0 w-12 h-12 rounded-[14px] bg-gradient-to-br from-[#e7d6ad] to-[#c8a24e] text-[#16100d] font-['Fraunces'] text-[18px] flex items-center justify-center">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-semibold text-[#231d17] truncate">{host?.brand_name ?? 'Bemgu'}</div>
            <div className="text-[12px] text-[#8a8276] truncate">{email}</div>
          </div>
          {showTrial ? (
            <span className="shrink-0 text-[10px] px-2.5 py-1 rounded-full font-medium bg-[#e4f0da] text-[#2a5c0a]">
              Trial · {trialRemaining} days left
            </span>
          ) : (
            <span className="shrink-0 text-[10px] px-2.5 py-1 rounded-full font-medium bg-[#efece5] text-[#8a8276]">
              {statusLabel}
            </span>
          )}
        </div>

        <div className="border-t border-[#e4ddd0] mt-4 pt-3 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-[#a79e8e]">Brand name</span>
            <span className="flex items-center gap-2 text-right">
              <span className="text-[12px] text-[#231d17] truncate max-w-[160px]">{host?.brand_name ?? '—'}</span>
              <Link to="/dashboard/branding" className={LINK}>Edit in Branding →</Link>
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-[#a79e8e]">Plan</span>
            <Link to="/dashboard/billing" className={LINK}>Manage in Billing →</Link>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-[#a79e8e]">Email &amp; password</span>
            <ComingPill />
          </div>
        </div>
      </div>

      {/* ── 2) NOTIFICATIONS ───────────────────────────────────────────────── */}
      <div className={CARD}>
        <div className={EYEBROW}>Notifications</div>

        {pushState === 'loading' ? (
          <Loader />
        ) : (
          <>
            {pushState === 'off' && (
              <>
                <div className="text-[14px] font-semibold text-[#231d17] mb-1">Notifications are off</div>
                <p className="text-[12px] text-[#8a8276] leading-relaxed mb-4">
                  Get alerted on this device when something happens in your account.
                </p>
                <button onClick={handleEnable} disabled={busy} className={BTN_SAVE}>
                  {busy ? 'Enabling…' : 'Enable notifications'}
                </button>
              </>
            )}

            {pushState === 'on' && (
              <>
                <div className="text-[14px] font-semibold text-[#231d17] mb-1">Notifications are on</div>
                <p className="text-[12px] text-[#8a8276] leading-relaxed mb-4">
                  You'll receive alerts on this device for account activity.
                </p>
                <button onClick={handleDisable} disabled={busy} className={BTN_OUTLINE}>
                  {busy ? 'Turning off…' : 'Turn off'}
                </button>
              </>
            )}

            {pushState === 'blocked' && (
              <>
                <div className="text-[14px] font-semibold text-[#231d17] mb-1">Notifications are blocked</div>
                <p className="text-[12px] text-[#8a8276] leading-relaxed">
                  Your browser is blocking notifications for this site. To turn them on, open your browser&apos;s site settings, find this address, and allow notifications. Then come back here.
                </p>
              </>
            )}
          </>
        )}

        <div className="border-t border-[#e4ddd0] mt-4 pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
            {NOTIFY_EVENTS.map(label => (
              <div key={label} className="flex items-center gap-2 text-[12px] text-[#8a8276]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#c8a24e] shrink-0" />
                {label}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 mt-4">
            <span className="text-[12px] text-[#a79e8e]">Choose which alerts &amp; email notifications</span>
            <ComingPill />
          </div>
        </div>
      </div>

      {/* ── 3) THIS DEVICE ─────────────────────────────────────────────────── */}
      {/* InstallCard mounts immediately so its beforeinstallprompt listener
          is registered before the push-loading async resolves. */}
      <InstallCard />

      {/* ── 4) ACCOUNT ACTIONS ─────────────────────────────────────────────── */}
      <div className={CARD}>
        <div className={EYEBROW}>Account actions</div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-[#231d17]">Sign out</div>
            <p className="text-[12px] text-[#8a8276]">Sign out of Bemgu on this browser.</p>
          </div>
          <button onClick={signOut} className={`${BTN_DANGER} shrink-0`}>Sign out</button>
        </div>
        <div className="border-t border-[#e4ddd0] mt-4 pt-3 flex items-center justify-between gap-3">
          <span className="text-[12px] text-[#a79e8e]">Delete account &amp; data</span>
          <ComingPill />
        </div>
      </div>

      {/* ── 5) FOOTER ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-1 mt-2">
        <span className="text-[11px] text-[#8a8276]">Bemgu</span>
        <div className="flex items-center gap-3 text-[11px] text-[#8a8276]">
          {/* TODO: real Terms/Privacy/Support URLs */}
          <a href="#" className="hover:text-[#231d17] transition-colors">Terms</a>
          <span className="text-[#cdc6b8]">·</span>
          <a href="#" className="hover:text-[#231d17] transition-colors">Privacy</a>
          <span className="text-[#cdc6b8]">·</span>
          <a href="#" className="hover:text-[#231d17] transition-colors">Support</a>
        </div>
      </div>
    </div>
  )
}
