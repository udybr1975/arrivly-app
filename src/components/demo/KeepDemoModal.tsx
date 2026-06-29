import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'

// Reusable "keep your demo" → convert-to-trial dialog. Sets the password client-side via
// Supabase auth, then calls /api/demo-convert (which never sees the password) to flip the
// host from demo to a normal 14-day trial. Also used by the expiry wall in a later stage.
// a11y: role=dialog + aria-modal, Escape to close, focus trap, return focus on close.

const INPUT =
  'w-full bg-white border border-[#e0dacd] rounded-[11px] px-[15px] py-[13px] text-sm text-[#1c1c1a] placeholder:text-[#b3ab9b] focus:outline-none focus:border-[#c8a24e] focus:ring-2 focus:ring-[#c8a24e]/20 transition-colors'
const LABEL = 'block text-[11px] uppercase tracking-[.08em] text-[#8a8170] mb-1.5'

type Props = { open: boolean; onClose: () => void }

export default function KeepDemoModal({ open, onClose }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const dialogRef = useRef<HTMLDivElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const submittingRef = useRef(false)

  // On open: snapshot the trigger for focus-return, reset fields, fetch the account email.
  useEffect(() => {
    if (!open) return
    returnFocusRef.current = (document.activeElement as HTMLElement) ?? null
    setPassword('')
    setError('')
    setDone(false)
    let cancelled = false
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setEmail(data.user?.email ?? '')
    })
    const t = window.setTimeout(() => firstFieldRef.current?.focus(), 0)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [open])

  // Return focus to the trigger when the dialog closes.
  useEffect(() => {
    if (open) return
    returnFocusRef.current?.focus?.()
  }, [open])

  // Escape to close + Tab focus trap (gated on open).
  useEffect(() => {
    if (!open) return
    const SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const focusables = Array.from(root.querySelectorAll<HTMLElement>(SELECTOR))
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || !root.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submittingRef.current) return
    if (password.length < 8) return setError('Please choose a password of at least 8 characters.')
    submittingRef.current = true
    setError('')
    setLoading(true)
    try {
      const { error: pwErr } = await supabase.auth.updateUser({ password })
      if (pwErr) {
        setError('We couldn’t set that password. Please try a different one.')
        return
      }
      const r = await api.post<{ ok?: boolean }>('/demo-convert', {})
      if (!r?.ok) {
        setError('We couldn’t finish setting up your account. Please try again.')
        return
      }
      setDone(true)
      // Full reload so Layout + Dashboard re-fetch the now-normal (non-demo) host state.
      window.location.assign('/dashboard')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
      submittingRef.current = false
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/45" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keep-demo-title"
        className="w-full max-w-[400px] rounded-[16px] border border-[#e4ddd0] bg-[#fffdf9] p-6 shadow-[0_24px_60px_rgba(35,29,23,0.28)] outline-none font-['Inter']"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="keep-demo-title" className="font-['Fraunces'] font-light text-[24px] leading-tight text-[#231d17]">
          Keep your page
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[#6b6354]">
          Set a password and your demo becomes a full account — everything you’ve built is saved, with 14 days free and no card.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className={LABEL} htmlFor="keep-email">Account email</label>
            <input id="keep-email" type="email" value={email} readOnly aria-readonly="true" className={`${INPUT} bg-[#f3efe7] text-[#6b6354] cursor-not-allowed`} />
          </div>
          <div>
            <label className={LABEL} htmlFor="keep-password">Create a password</label>
            <input
              id="keep-password"
              ref={firstFieldRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>

          {error && (
            <p role="alert" className="text-[12px] text-[#8a1a1a] bg-[#fde4e4] border border-[#f3c9c9] rounded-[9px] px-3 py-2.5">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || done}
            className="group flex w-full items-center justify-center gap-2 bg-[#c8a24e] text-[#16100d] font-semibold rounded-[12px] py-[14px] text-sm transition-colors hover:bg-[#e7d6ad] disabled:opacity-40 disabled:hover:bg-[#c8a24e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffdf9]"
          >
            {done ? 'All set — taking you in…' : loading ? 'Setting up…' : 'Start my 14-day trial'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={loading || done}
            className="w-full text-center text-[13px] font-medium text-[#8a8276] hover:text-[#231d17] transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]/40 rounded py-1"
          >
            Not yet
          </button>
        </form>
      </div>
    </div>
  )
}
