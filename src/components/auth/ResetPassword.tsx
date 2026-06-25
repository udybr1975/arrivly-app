import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import AuthShell from './AuthShell'

const INPUT =
  'w-full bg-white border border-[#e0dacd] rounded-[11px] px-[15px] py-[13px] text-sm text-[#1c1c1a] placeholder:text-[#b3ab9b] focus:outline-none focus:border-[#c8a24e] focus:ring-2 focus:ring-[#c8a24e]/20 transition-colors'
const LABEL = 'block text-[11px] uppercase tracking-[.08em] text-[#8a8170] mb-1.5'
const BUTTON =
  'group flex w-full items-center justify-center gap-2 bg-[#c8a24e] text-[#16100d] font-semibold rounded-[12px] py-[14px] text-sm transition-colors hover:bg-[#e7d6ad] disabled:opacity-40 disabled:hover:bg-[#c8a24e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f3ec]'

const LOGIN_HEADLINE = (
  <>
    Welcome
    <br />
    <em className="text-[#e7d6ad]">back home.</em>
  </>
)
const LOGIN_SUB = 'Your properties, guest pages, bookings and messages — all in one calm place.'

type Mode = 'request' | 'update'

export default function ResetPassword() {
  const navigate = useNavigate()
  // Supabase appends the recovery token to the URL hash on the link target.
  const [mode, setMode] = useState<Mode>(() =>
    typeof window !== 'undefined' && window.location.hash.includes('type=recovery') ? 'update' : 'request'
  )

  // request-mode state
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  // update-mode state
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') setMode('update')
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const redirectTo = (import.meta.env.VITE_APP_URL || window.location.origin) + '/reset-password'
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    setLoading(false)
    // Avoid account enumeration: never reveal whether the email exists. Surface only
    // rate-limit errors (so the user knows to wait); otherwise always show the same
    // neutral confirmation.
    if (error && /rate limit|too many/i.test(error.message)) {
      setError(error.message)
      return
    }
    setSent(true)
  }

  async function submitUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    navigate('/dashboard')
  }

  return (
    <AuthShell headline={LOGIN_HEADLINE} sub={LOGIN_SUB}>
      {mode === 'update' ? (
        <>
          <h1 className="font-['Fraunces'] font-light text-[31px] leading-tight text-[#1c1c1a]">Choose a new password</h1>
          <p className="mt-2 text-sm text-[#6f6757]">Pick a strong password you'll remember.</p>

          <form onSubmit={submitUpdate} className="mt-8 space-y-4">
            <div>
              <label className={LABEL} htmlFor="reset-new">New password</label>
              <input
                id="reset-new"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={INPUT}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="reset-confirm">Confirm password</label>
              <input
                id="reset-confirm"
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className={INPUT}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>

            {confirm.length > 0 && password !== confirm && (
              <p role="alert" className="text-[12px] text-[#8a1a1a]">Passwords do not match.</p>
            )}
            {error && (
              <p role="alert" className="text-[12px] text-[#8a1a1a] bg-[#fde4e4] border border-[#f3c9c9] rounded-[9px] px-3 py-2.5">{error}</p>
            )}

            <button type="submit" disabled={loading} className={BUTTON}>
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>
        </>
      ) : sent ? (
        <>
          <h1 className="font-['Fraunces'] font-light text-[31px] leading-tight text-[#1c1c1a]">Check your email</h1>
          <p className="mt-3 text-sm leading-relaxed text-[#6f6757]">
            If an account exists for <strong className="text-[#1c1c1a]">{email}</strong>, we've sent a link to reset
            your password. It may take a minute to arrive — check your spam folder too.
          </p>
          <p className="mt-8 text-center text-sm text-[#6f6757]">
            <Link to="/login" className="font-semibold text-[#a8842f] underline decoration-[#c8a24e]/40 underline-offset-2 hover:text-[#c8a24e]">
              Back to sign in
            </Link>
          </p>
        </>
      ) : (
        <>
          <h1 className="font-['Fraunces'] font-light text-[31px] leading-tight text-[#1c1c1a]">Reset your password</h1>
          <p className="mt-2 text-sm text-[#6f6757]">Enter your email and we'll send a reset link.</p>

          <form onSubmit={submitRequest} className="mt-8 space-y-4">
            <div>
              <label className={LABEL} htmlFor="reset-email">Email address</label>
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className={INPUT}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>

            {error && (
              <p role="alert" className="text-[12px] text-[#8a1a1a] bg-[#fde4e4] border border-[#f3c9c9] rounded-[9px] px-3 py-2.5">{error}</p>
            )}

            <button type="submit" disabled={loading} className={BUTTON}>
              {loading ? 'Sending…' : 'Send reset link'}
              {!loading && (
                <svg viewBox="0 0 24 24" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-sm text-[#6f6757]">
            Remembered it?{' '}
            <Link to="/login" className="font-semibold text-[#a8842f] underline decoration-[#c8a24e]/40 underline-offset-2 hover:text-[#c8a24e]">
              Sign in
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  )
}
