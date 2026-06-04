import { useState, useEffect, useRef } from 'react'
import { Send, X, Bell } from 'lucide-react'
import { subscribeGuestToPush, isSubscribed, checkPermission, iosNeedsHomeScreen } from '../../lib/webpush'

interface ThreadMessage {
  id: string
  sender_role: 'guest' | 'host'
  body: string
  created_at: string
  read_at: string | null
}

interface Props {
  apartmentId: string
  token: string
  accentColor: string
  brandName: string
  guestName: string | null
  onClose: () => void
}

type NudgeState = null | 'standard' | 'ios' | 'busy' | 'ok' | 'denied' | 'error'

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return timeStr
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + timeStr
}

export default function MessageHost({ apartmentId, token, accentColor, brandName, guestName, onClose }: Props) {
  const [thread, setThread] = useState<ThreadMessage[]>([])
  const [threadLoading, setThreadLoading] = useState(true)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [nudgeState, setNudgeState] = useState<NudgeState>(null)
  const [nudgeDetail, setNudgeDetail] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  // Ref so the interval callback can see the current sending state without stale closure
  const sendingRef = useRef(false)
  const mountedRef = useRef(true)
  useEffect(() => { return () => { mountedRef.current = false } }, [])

  const nudgeKey = `arrivly_guest_push_nudge_${token}`

  useEffect(() => {
    if (thread.length > 0 || !threadLoading) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [thread, threadLoading])

  // Initial load + 15s poll + visibilitychange re-fetch
  useEffect(() => {
    let cancelled = false

    const doFetch = async () => {
      if (sendingRef.current) return
      try {
        const res = await fetch('/api/guest-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apartmentId, token, action: 'list' }),
        })
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (!cancelled) setThread(data.messages ?? [])
      } catch {
        // silently ignore poll errors — keep showing the existing thread
      }
    }

    doFetch().then(() => {
      if (!cancelled) setThreadLoading(false)
    })

    const intervalId = setInterval(doFetch, 15_000)

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') doFetch()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelled = true
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [apartmentId, token])

  async function sendMessage() {
    const text = input.trim()
    if (!text || sending) return
    // Capture before the await — thread state is stale after the network call resolves.
    const firstMessage = !thread.some(m => m.sender_role === 'guest')
    setSending(true)
    sendingRef.current = true
    setSendError('')
    try {
      const res = await fetch('/api/guest-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apartmentId, token, action: 'send', body: text }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (mountedRef.current) {
        setThread(data.messages ?? [])
        setInput('')
      }
      // First-message push nudge — evaluate eligibility after a successful send.
      if (firstMessage && localStorage.getItem(nudgeKey) !== '1' && mountedRef.current) {
        if (iosNeedsHomeScreen()) {
          setNudgeState('ios')
        } else if ('PushManager' in window) {
          const perm = await checkPermission()
          if (mountedRef.current && perm !== 'denied') {
            const subscribed = await isSubscribed()
            if (mountedRef.current && !subscribed) {
              setNudgeState('standard')
            }
          }
        }
      }
    } catch {
      // Keep the typed text so the guest can retry; show inline error
      if (mountedRef.current) setSendError('Could not send — please try again.')
    } finally {
      sendingRef.current = false
      if (mountedRef.current) setSending(false)
    }
  }

  async function handleNudgeEnable() {
    if (!mountedRef.current) return
    setNudgeDetail('')
    setNudgeState('busy')
    const result = await subscribeGuestToPush(apartmentId, token)
    if (!mountedRef.current) return
    if (result.ok) {
      localStorage.setItem(nudgeKey, '1')
      setNudgeState('ok')
      setTimeout(() => { if (mountedRef.current) setNudgeState(null) }, 1500)
    } else if (result.reason === 'denied') {
      localStorage.setItem(nudgeKey, '1')
      setNudgeState('denied')
      setTimeout(() => { if (mountedRef.current) setNudgeState(null) }, 2000)
    } else {
      // Don't set the flag — let the guest retry from the More tab.
      setNudgeDetail(result.detail ?? '')
      setNudgeState('error')
    }
  }

  function handleNudgeDismiss() {
    localStorage.setItem(nudgeKey, '1')
    setNudgeState(null)
  }

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">

      {/* Header */}
      <div
        className="shrink-0 px-5 py-4 flex items-center justify-between text-white"
        style={{ background: accentColor }}
      >
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">
            {brandName.charAt(0)}
          </span>
          <div>
            <p className="text-sm font-medium leading-tight">{brandName}</p>
            <p className="text-[10px] tracking-[0.12em] uppercase opacity-70 leading-tight mt-0.5">
              Messages with your host
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center border-none cursor-pointer hover:bg-white/25 transition-colors"
        >
          <X size={16} className="text-white" />
        </button>
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3">
        {threadLoading ? (
          <div className="flex items-center justify-center py-20">
            <div
              className="w-8 h-8 border-2 border-gray-100 rounded-full animate-spin"
              style={{ borderTopColor: accentColor }}
            />
          </div>
        ) : thread.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-8">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mb-4 text-2xl font-bold text-white"
              style={{ background: accentColor }}
            >
              {brandName.charAt(0)}
            </div>
            <p className="text-sm text-gray-500 leading-relaxed">
              Send a message to {brandName}
              {guestName ? `, ${guestName}` : ''} — they'll be notified and reply right here.
            </p>
          </div>
        ) : (
          <>
            {thread.map(m => (
              <div key={m.id} className={`flex ${m.sender_role === 'guest' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                    m.sender_role === 'guest'
                      ? 'rounded-br-sm text-white'
                      : 'rounded-bl-sm bg-[#faf9f6] border border-gray-100 text-[#1c1c1a]'
                  }`}
                  style={m.sender_role === 'guest' ? { background: accentColor } : undefined}
                >
                  <p className="whitespace-pre-line leading-relaxed break-words">{m.body}</p>
                  <p className={`text-[10px] mt-1 ${m.sender_role === 'guest' ? 'text-white/60 text-right' : 'text-gray-400'}`}>
                    {fmtTime(m.created_at)}
                  </p>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Push nudge — shown above input after first message sent */}
      {nudgeState !== null && (
        <div className="shrink-0 px-4 py-3 bg-[#faf9f6] border-t border-gray-100">
          <div className="flex items-start gap-2.5">
            <Bell size={15} className="shrink-0 mt-0.5" style={{ color: accentColor }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[#1c1c1a] mb-0.5">Get replies on your phone</p>
              {nudgeState === 'ios' ? (
                <>
                  <p className="text-xs text-gray-500 leading-relaxed mb-2.5">
                    Add this page to your Home Screen first (Share → Add to Home Screen), then turn on notifications from the More tab.
                  </p>
                  <button
                    onClick={handleNudgeDismiss}
                    className="text-xs font-semibold px-3 py-1.5 rounded-full text-white border-none cursor-pointer"
                    style={{ background: accentColor }}
                  >
                    Got it
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-500 leading-relaxed mb-2.5">
                    Turn on notifications so you don't miss your host's reply.
                  </p>
                  {(nudgeState === 'standard' || nudgeState === 'busy') && (
                    <div className="flex gap-2">
                      <button
                        onClick={handleNudgeEnable}
                        disabled={nudgeState === 'busy'}
                        className="text-xs font-semibold px-3 py-1.5 rounded-full text-white border-none cursor-pointer disabled:opacity-50"
                        style={{ background: accentColor }}
                      >
                        {nudgeState === 'busy' ? 'Enabling…' : 'Turn on'}
                      </button>
                      <button
                        onClick={handleNudgeDismiss}
                        className="text-xs text-gray-500 px-3 py-1.5 rounded-full bg-transparent border-none cursor-pointer"
                      >
                        Not now
                      </button>
                    </div>
                  )}
                  {nudgeState === 'ok' && (
                    <p className="text-xs font-semibold" style={{ color: accentColor }}>Notifications on</p>
                  )}
                  {nudgeState === 'denied' && (
                    <p className="text-xs text-gray-500">Notifications were blocked</p>
                  )}
                  {nudgeState === 'error' && (
                    <p className="text-xs text-gray-500">
                      {nudgeDetail ? `Couldn't turn on — ${nudgeDetail}` : "Couldn't turn on — try again from the More tab"}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 border-t border-gray-100 px-4 py-3 bg-white">
        {sendError && (
          <p className="text-xs text-red-500 mb-2 px-1">{sendError}</p>
        )}
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value.slice(0, 2000))}
            onKeyDown={e => { if (e.key === 'Enter') sendMessage() }}
            placeholder={`Message ${brandName}…`}
            className="flex-1 bg-[#faf9f6] border border-gray-200 rounded-full px-4 py-2.5 text-sm outline-none focus:border-gray-400"
          />
          <button
            onClick={sendMessage}
            disabled={sending || !input.trim()}
            aria-label="Send"
            className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white border-none cursor-pointer disabled:opacity-40"
            style={{ background: accentColor }}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
