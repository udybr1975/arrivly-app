import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import AuthShell from '../auth/AuthShell'
import SocialAuthButtons from '../auth/SocialAuthButtons'
import TurnstileWidget from './TurnstileWidget'

// Public, flag-gated demo ENTRY flow (no dashboard chrome). Off unless
// VITE_DEMO_ENABLED === 'true'; otherwise this route redirects to "/".
const DEMO_ENABLED = import.meta.env.VITE_DEMO_ENABLED === 'true'
// Mirrors SocialAuthButtons' own gate — used to also hide the standalone "or" divider
// between the Google buttons and the email form when social sign-in is off.
const SOCIAL_AUTH_ENABLED = import.meta.env.VITE_SOCIAL_AUTH === 'true'
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const INPUT =
  'w-full bg-white border border-[#e0dacd] rounded-[11px] px-[15px] py-[13px] text-sm text-[#1c1c1a] placeholder:text-[#b3ab9b] focus:outline-none focus:border-[#c8a24e] focus:ring-2 focus:ring-[#c8a24e]/20 transition-colors'
const LABEL = 'block text-[11px] uppercase tracking-[.08em] text-[#8a8170] mb-1.5'
const PRIMARY =
  'group flex w-full items-center justify-center gap-2 bg-[#c8a24e] text-[#16100d] font-semibold rounded-[12px] py-[14px] text-sm transition-colors hover:bg-[#e7d6ad] disabled:opacity-40 disabled:hover:bg-[#c8a24e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f3ec]'

const DEMO_HEADLINE = (
  <>
    See it live,
    <br />
    <em className="text-[#e7d6ad]">in your city.</em>
  </>
)
const DEMO_SUB =
  'Spin up a real, branded guest page for your neighbourhood in under a minute — free for 48 hours, no card.'

type Intent = 'create' | 'resume' | 'expired'
type ApiResp = { ok?: boolean; reason?: string; resume?: boolean; apartmentId?: string; token?: string; already?: boolean }

// Shared demo-intent handoff across the Google OAuth round-trip (/demo → Google →
// /auth/callback → /demo). sessionStorage so it dies with the tab; stale after 30 min.
const DEMO_INTENT_KEY = 'arrivly_demo_intent'
const DEMO_INTENT_TTL_MS = 30 * 60 * 1000
type DemoIntent = { city: string; neighbourhood: string; street: string; streetNumber: string; firstName: string; ts: number }

function readDemoIntent(): DemoIntent | null {
  try {
    const raw = sessionStorage.getItem(DEMO_INTENT_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (
      p && typeof p.ts === 'number' && Date.now() - p.ts <= DEMO_INTENT_TTL_MS &&
      typeof p.city === 'string' && typeof p.neighbourhood === 'string'
    ) {
      return {
        city: p.city,
        neighbourhood: p.neighbourhood,
        street: typeof p.street === 'string' ? p.street : '',
        streetNumber: typeof p.streetNumber === 'string' ? p.streetNumber : '',
        firstName: typeof p.firstName === 'string' ? p.firstName : '',
        ts: p.ts,
      }
    }
    sessionStorage.removeItem(DEMO_INTENT_KEY)
    return null
  } catch {
    try { sessionStorage.removeItem(DEMO_INTENT_KEY) } catch {}
    return null
  }
}

function clearDemoIntent() {
  try { sessionStorage.removeItem(DEMO_INTENT_KEY) } catch {}
}

// api.post throws `new Error(rawResponseBody)` on non-2xx — pull the reason code out of
// the JSON body for the 403 captcha_failed case (guarded; the body may not be JSON).
function parseReason(err: unknown): string | null {
  try {
    const msg = (err as Error)?.message
    return msg ? (JSON.parse(msg)?.reason ?? null) : null
  } catch {
    return null
  }
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-[12px] text-[#8a1a1a] bg-[#fde4e4] border border-[#f3c9c9] rounded-[9px] px-3 py-2.5">
      {children}
    </p>
  )
}

function StepHeader({ n, label }: { n: number; label: string }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[.08em] text-[#8a8170]">
        <span>Step {n} of 3 · {label}</span>
      </div>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[#e0dacd]">
        <div className="h-full rounded-full bg-[#c8a24e] transition-all" style={{ width: `${(n / 3) * 100}%` }} />
      </div>
    </div>
  )
}

// 6-digit one-time-code input with auto-advance, backspace, arrows and paste.
function CodeBoxes({
  code,
  setCode,
  disabled,
  onComplete,
}: {
  code: string[]
  setCode: React.Dispatch<React.SetStateAction<string[]>>
  disabled: boolean
  onComplete: () => void
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  useEffect(() => {
    refs.current[0]?.focus()
  }, [])

  function setDigit(i: number, v: string) {
    const d = v.replace(/\D/g, '').slice(-1)
    setCode((prev) => {
      const n = [...prev]
      n[i] = d
      return n
    })
    if (d && i < 5) refs.current[i + 1]?.focus()
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !code[i] && i > 0) refs.current[i - 1]?.focus()
    else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus()
    else if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus()
    else if (e.key === 'Enter' && code.join('').length === 6) {
      // Prevent the surrounding <form> from ALSO submitting (double verifyOtp on one
      // single-use token). onComplete() owns the submit here.
      e.preventDefault()
      onComplete()
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!t) return
    e.preventDefault()
    setCode(() => {
      const n = Array(6).fill('')
      for (let k = 0; k < t.length; k++) n[k] = t[k]
      return n
    })
    refs.current[Math.min(t.length, 5)]?.focus()
  }

  return (
    <div className="flex gap-2 justify-between" role="group" aria-label="6-digit verification code">
      {code.map((c, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el }}
          value={c}
          onChange={(e) => setDigit(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={onPaste}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          className="w-full aspect-square text-center text-[20px] font-['Fraunces'] text-[#1c1c1a] bg-white border border-[#e0dacd] rounded-[11px] focus:outline-none focus:border-[#c8a24e] focus:ring-2 focus:ring-[#c8a24e]/20 transition-colors disabled:opacity-50"
        />
      ))}
    </div>
  )
}

export default function Demo() {
  const navigate = useNavigate()

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [intent, setIntent] = useState<Intent>('create')
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [city, setCity] = useState('')
  const [neighbourhood, setNeighbourhood] = useState('')
  const [street, setStreet] = useState('')
  const [streetNumber, setStreetNumber] = useState('')
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  // A SEPARATE, fresh token captured on the final Choose step — Turnstile tokens are
  // single-use/short-lived, so the step-1 token is stale by the time we POST create.
  // choiceWidgetKey is bumped to remount the widget for a clean retry after a failure.
  const [choiceToken, setChoiceToken] = useState<string | null>(null)
  const [choiceWidgetKey, setChoiceWidgetKey] = useState(0)
  const [code, setCode] = useState<string[]>(['', '', '', '', '', ''])
  const [blocked, setBlocked] = useState(false) // account_exists
  const [expiredPrompt, setExpiredPrompt] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Synchronous in-flight guard: blocks a second verifyOtp before React flushes
  // `loading` (Enter + form-submit, or a fast double-click on Verify).
  const verifyingRef = useRef(false)
  // True when returning from Google OAuth with a pending demo intent — show a brief
  // loading state while we claim eligibility, instead of flashing the fresh step-1 form.
  // Initialised synchronously so no flash occurs on the first paint.
  const [resuming, setResuming] = useState<boolean>(() => readDemoIntent() !== null)

  // ── POST-OAUTH RESUME ────────────────────────────────────────────────────────
  // Only runs when a demo intent is pending (normal fresh entry is untouched). On a
  // valid session it rehydrates the fields and claims demo eligibility, then hands off
  // to the existing Choose (step 3) → demo-create money-gate path, UNCHANGED.
  useEffect(() => {
    const intent = readDemoIntent()
    if (!intent) return
    let cancelled = false
    async function resume(pending: DemoIntent) {
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
      if (!user) {
        // No session (e.g. user bailed at Google) → drop the intent, normal fresh flow.
        clearDemoIntent()
        setResuming(false)
        return
      }
      setCity(pending.city)
      setNeighbourhood(pending.neighbourhood)
      setStreet(pending.street)
      setStreetNumber(pending.streetNumber)
      setFirstName(pending.firstName)
      try {
        const r = await api.post<ApiResp>('/demo-claim', { firstName: pending.firstName })
        if (cancelled) return
        if (r?.ok) {
          // Eligible (or already a demo) → the existing Choose + Turnstile create path runs.
          setResuming(false)
          setStep(3)
          return
        }
        if (r?.reason === 'not_eligible') {
          // Already has a real account — let them into the dashboard.
          clearDemoIntent()
          navigate('/dashboard')
          return
        }
        clearDemoIntent()
        setResuming(false)
        setError('We couldn’t start your demo. Please sign in and try again.')
      } catch {
        if (cancelled) return
        clearDemoIntent()
        setResuming(false)
        setError('We couldn’t start your demo. Please sign in and try again.')
      }
    }
    resume(intent)
    return () => { cancelled = true }
    // Mount-only: the intent handoff is read once on return from OAuth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist the entry fields before the Google redirect; SocialAuthButtons aborts the
  // OAuth sign-in when this returns false. First name is optional here — Google supplies it.
  function persistDemoIntent(): boolean {
    if (!city.trim() || !neighbourhood.trim()) {
      setError('Please add your city and neighbourhood first.')
      return false
    }
    try {
      sessionStorage.setItem(DEMO_INTENT_KEY, JSON.stringify({
        city: city.trim(),
        neighbourhood: neighbourhood.trim(),
        street: street.trim(),
        streetNumber: streetNumber.trim(),
        firstName: firstName.trim(),
        ts: Date.now(),
      }))
    } catch {}
    return true
  }

  // Flag OFF → nothing publicly reachable.
  if (!DEMO_ENABLED) return <Navigate to="/" replace />

  async function startOtp(nextIntent: Intent): Promise<boolean> {
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: true,
        ...(captchaToken ? { captchaToken } : {}),
        data: { first_name: firstName.trim(), is_demo: true },
      },
    })
    if (otpErr) {
      setError('We couldn’t send your code. Please try again in a moment.')
      return false
    }
    setIntent(nextIntent)
    setCode(['', '', '', '', '', ''])
    setStep(2)
    return true
  }

  async function submitStep1(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const em = email.trim().toLowerCase()
    if (!firstName.trim()) return setError('Please enter your first name.')
    if (!EMAIL_RE.test(em)) return setError('Please enter a valid email address.')
    if (!city.trim() || !neighbourhood.trim()) return setError('Please add your city and neighbourhood.')

    setLoading(true)
    try {
      const r = await api.post<ApiResp>('/demo-precheck', { email: em })
      if (r.ok === false) {
        if (r.reason === 'disposable_email') return setError('Please use a permanent email address (no temporary inboxes).')
        // Defensive: an OTP dead-end shouldn't carry a stale Google demo intent.
        if (r.reason === 'account_exists') { clearDemoIntent(); return setBlocked(true) }
        if (r.reason === 'demo_expired') { clearDemoIntent(); return setExpiredPrompt(true) }
        return setError('Something went wrong. Please try again.')
      }
      await startOtp(r.resume === true ? 'resume' : 'create')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function continueExpired() {
    setError('')
    setLoading(true)
    try {
      await startOtp('expired')
      setExpiredPrompt(false)
    } finally {
      setLoading(false)
    }
  }

  async function verify(e?: React.FormEvent) {
    e?.preventDefault()
    if (verifyingRef.current) return
    const token = code.join('')
    if (token.length !== 6) return setError('Enter the 6-digit code from your email.')
    verifyingRef.current = true
    setError('')
    setLoading(true)
    try {
      const { error: vErr } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: 'email' })
      if (vErr) return setError('That code didn’t work. Please check it and try again.')

      if (intent === 'create') {
        setStep(3)
        return
      }
      if (intent === 'resume') {
        const r = await api.post<ApiResp>('/demo-create', {})
        if (r?.ok) return navigate('/dashboard')
        return setError('We couldn’t resume your demo. Please try again.')
      }
      // intent === 'expired' → just sign in; the expired-demo wall is a later stage.
      navigate('/dashboard')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
      verifyingRef.current = false
    }
  }

  function resetChoiceCaptcha() {
    setChoiceToken(null)
    setChoiceWidgetKey((k) => k + 1) // remount the widget → fresh single-use token
  }

  async function choose(path: 'quick' | 'full') {
    setError('')
    setLoading(true)
    try {
      const r = await api.post<ApiResp>('/demo-create', {
        city: city.trim(),
        neighbourhood: neighbourhood.trim(),
        street: street.trim(),
        streetNumber: streetNumber.trim(),
        path,
        turnstileToken: choiceToken ?? '',
      })
      if (r?.ok) {
        clearDemoIntent() // demo created — the OAuth handoff intent is done with.
        if (path === 'full' && r.apartmentId) return navigate(`/dashboard/property/${r.apartmentId}`)
        return navigate('/dashboard')
      }
      if (r?.reason === 'not_eligible') return setError('This account can’t start a demo. Try signing in instead.')
      setError('We couldn’t set up your demo. Please try again.')
    } catch (err) {
      // demo-create returns 403 { reason:'captcha_failed' } (non-2xx → api.post throws).
      if (parseReason(err) === 'captcha_failed') {
        resetChoiceCaptcha()
        return setError('That security check didn’t pass. Please complete it and try again.')
      }
      setError('We couldn’t set up your demo. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function resendCode() {
    setError('')
    setLoading(true)
    try {
      await startOtp(intent)
    } finally {
      setLoading(false)
    }
  }

  // ── Returning from Google OAuth: brief claim/loading state ───────────────────
  if (resuming) {
    return (
      <AuthShell headline={DEMO_HEADLINE} sub={DEMO_SUB}>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#c8a24e]" />
          <p className="mt-4 text-sm text-[#6f6757]">Starting your demo…</p>
        </div>
      </AuthShell>
    )
  }

  // ── account_exists: dead-end with a route to login ───────────────────────────
  if (blocked) {
    return (
      <AuthShell headline={DEMO_HEADLINE} sub={DEMO_SUB}>
        <h1 className="font-['Fraunces'] font-light text-[31px] leading-tight text-[#1c1c1a]">You already have an account</h1>
        <p className="mt-3 text-sm leading-relaxed text-[#6f6757]">
          There’s already a Bemgu account for <strong className="text-[#1c1c1a]">{email.trim().toLowerCase()}</strong>. Sign in to pick up where you left off.
        </p>
        <Link to="/login" className={`${PRIMARY} mt-7`}>
          Go to sign in
          <ArrowIcon />
        </Link>
        <button
          type="button"
          onClick={() => { setBlocked(false); setError('') }}
          className="mt-4 w-full text-center text-[13px] font-medium text-[#a8842f] hover:text-[#c8a24e] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]/40 rounded py-1"
        >
          Use a different email
        </button>
      </AuthShell>
    )
  }

  return (
    <AuthShell headline={DEMO_HEADLINE} sub={DEMO_SUB}>
      {/* ── STEP 1: Your place ── */}
      {step === 1 && (
        <>
          <StepHeader n={1} label="Your place" />
          <h1 className="font-['Fraunces'] font-light text-[31px] leading-tight text-[#1c1c1a]">Try Bemgu free for 48 hours</h1>
          <p className="mt-2 text-sm text-[#6f6757]">Tell us where, and we’ll build you a live guest page to explore. No card needed.</p>

          {expiredPrompt ? (
            <div className="mt-7">
              <div className="rounded-[12px] border border-[#e7d6ad] bg-[#fffdf9] px-4 py-3.5 text-sm leading-relaxed text-[#6f6757]">
                Your demo has ended — start your free trial to keep your page.
              </div>
              <button type="button" onClick={continueExpired} disabled={loading} className={`${PRIMARY} mt-5`}>
                {loading ? 'One moment…' : 'Continue'}
                {!loading && <ArrowIcon />}
              </button>
              <button
                type="button"
                onClick={() => { setExpiredPrompt(false); setError('') }}
                className="mt-4 w-full text-center text-[13px] font-medium text-[#a8842f] hover:text-[#c8a24e] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]/40 rounded py-1"
              >
                Use a different email
              </button>
              {error && <div className="mt-4"><ErrorLine>{error}</ErrorLine></div>}
            </div>
          ) : (
            <>
            {/* Location first — required, and read from state by both submitStep1 and
                persistDemoIntent, so these live outside the form without affecting validation. */}
            <div className="mt-7 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL} htmlFor="demo-city">City</label>
                  <input id="demo-city" type="text" value={city} onChange={(e) => setCity(e.target.value)} className={INPUT} placeholder="Helsinki" autoComplete="address-level2" autoFocus required />
                </div>
                <div>
                  <label className={LABEL} htmlFor="demo-hood">Neighbourhood</label>
                  <input id="demo-hood" type="text" value={neighbourhood} onChange={(e) => setNeighbourhood(e.target.value)} className={INPUT} placeholder="Kallio" required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL} htmlFor="demo-street">Street</label>
                  <input id="demo-street" type="text" value={street} onChange={(e) => setStreet(e.target.value)} className={INPUT} placeholder="Runeberginkatu" autoComplete="address-line1" />
                </div>
                <div>
                  <label className={LABEL} htmlFor="demo-streetno">Street number</label>
                  <input id="demo-streetno" type="text" value={streetNumber} onChange={(e) => setStreetNumber(e.target.value)} className={INPUT} placeholder="17" autoComplete="address-line2" />
                </div>
              </div>
              <p className="-mt-1 text-[12px] text-[#8a8170]">Optional — adds turn-by-turn directions for your guests.</p>
            </div>

            {/* Google demo entry — self-hides unless VITE_SOCIAL_AUTH==='true'. Renders its
                own "continue with" divider above the buttons. Persists the entry fields, then
                Google → /auth/callback → back here to finish (step 3). */}
            <SocialAuthButtons dividerLabel="continue with" onBeforeRedirect={persistDemoIntent} />

            {/* Standalone "or" divider between the Google buttons and the email form. Gated on
                the same flag SocialAuthButtons uses, so it never floats when social is off. */}
            {SOCIAL_AUTH_ENABLED && (
              <div className="mt-6 flex items-center gap-3" aria-hidden>
                <span className="h-px flex-1 bg-[#e0dacd]" />
                <span className="text-[11px] uppercase tracking-[.14em] text-[#8a8170]">or</span>
                <span className="h-px flex-1 bg-[#e0dacd]" />
              </div>
            )}

            {/* Email / OTP path — kept together in the form so Enter-to-submit still works. */}
            <form onSubmit={submitStep1} className="mt-6 space-y-4">
              <div>
                <label className={LABEL} htmlFor="demo-first">First name</label>
                <input id="demo-first" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={INPUT} placeholder="Marco" autoComplete="given-name" required />
              </div>
              <div>
                <label className={LABEL} htmlFor="demo-email">Email address</label>
                <input id="demo-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} placeholder="you@example.com" autoComplete="email" required />
              </div>

              {TURNSTILE_SITE_KEY && (
                <TurnstileWidget siteKey={TURNSTILE_SITE_KEY} onToken={setCaptchaToken} />
              )}

              {error && <ErrorLine>{error}</ErrorLine>}

              <button type="submit" disabled={loading} className={PRIMARY}>
                {loading ? 'Checking…' : 'Continue'}
                {!loading && <ArrowIcon />}
              </button>
              <p className="text-center text-[12px] text-[#8a8170]">Free for 48 hours · No card · Cancel anytime</p>
            </form>
            </>
          )}

          <p className="mt-6 text-center text-sm text-[#6f6757]">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-[#a8842f] underline decoration-[#c8a24e]/40 underline-offset-2 hover:text-[#c8a24e]">Sign in</Link>
          </p>
        </>
      )}

      {/* ── STEP 2: Verify ── */}
      {step === 2 && (
        <>
          <StepHeader n={2} label="Verify" />
          <h1 className="font-['Fraunces'] font-light text-[31px] leading-tight text-[#1c1c1a]">Check your email</h1>
          <p className="mt-2 text-sm text-[#6f6757]">We sent a 6-digit code to <strong className="text-[#1c1c1a]">{email.trim().toLowerCase()}</strong>. Enter it below.</p>

          <form onSubmit={verify} className="mt-7 space-y-5">
            <CodeBoxes code={code} setCode={setCode} disabled={loading} onComplete={() => verify()} />

            {error && <ErrorLine>{error}</ErrorLine>}

            <button type="submit" disabled={loading || code.join('').length !== 6} className={PRIMARY}>
              {loading ? 'Verifying…' : 'Verify & continue'}
              {!loading && <ArrowIcon />}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[#6f6757]">
            Didn’t get it?{' '}
            <button type="button" onClick={resendCode} disabled={loading} className="font-semibold text-[#a8842f] hover:text-[#c8a24e] transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]/40 rounded">Resend code</button>
          </p>
        </>
      )}

      {/* ── STEP 3: Choose (create only) ── */}
      {step === 3 && (
        <>
          <StepHeader n={3} label="Choose" />
          <h1 className="font-['Fraunces'] font-light text-[31px] leading-tight text-[#1c1c1a]">How should we set it up?</h1>
          <p className="mt-2 text-sm text-[#6f6757]">Pick how much we pre-fill. You can change everything later.</p>

          <div className="mt-7 space-y-3">
            <button
              type="button"
              onClick={() => choose('quick')}
              disabled={loading}
              className="group w-full text-left rounded-[14px] border border-[#c8a24e] bg-[#fffdf9] p-4 transition-colors hover:bg-[#fbf6ea] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]/40"
            >
              <div className="flex items-center justify-between">
                <span className="font-['Fraunces'] text-[18px] text-[#1c1c1a]">Quick</span>
                <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#a8842f] bg-[rgba(200,162,78,0.16)] rounded-full px-2 py-0.5">Recommended</span>
              </div>
              <p className="mt-1 text-[13px] leading-[1.5] text-[#6f6757]">We auto-fill a neighbourhood guide, this week’s local events and a couple of host picks, so your page feels alive in seconds.</p>
            </button>

            <button
              type="button"
              onClick={() => choose('full')}
              disabled={loading}
              className="group w-full text-left rounded-[14px] border border-[#e0dacd] bg-[#fffdf9] p-4 transition-colors hover:border-[#c8a24e] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]/40"
            >
              <div className="font-['Fraunces'] text-[18px] text-[#1c1c1a]">Full setup</div>
              <p className="mt-1 text-[13px] leading-[1.5] text-[#6f6757]">Start from a blank page and add everything yourself in the editor — WiFi, check-in, rules and picks.</p>
            </button>
          </div>

          {/* Fresh, verified token for the actual create call (the step-1 token is stale). */}
          {TURNSTILE_SITE_KEY && (
            <div className="mt-5">
              <TurnstileWidget key={choiceWidgetKey} siteKey={TURNSTILE_SITE_KEY} onToken={setChoiceToken} />
            </div>
          )}

          {loading && <p className="mt-5 text-center text-[13px] text-[#8a8170]">Setting up your demo…</p>}
          {error && <div className="mt-5"><ErrorLine>{error}</ErrorLine></div>}
        </>
      )}
    </AuthShell>
  )
}
