import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import AuthShell from './AuthShell'

const INPUT =
  'w-full bg-white border border-[#e0dacd] rounded-[11px] px-[15px] py-[13px] text-sm text-[#1c1c1a] placeholder:text-[#b3ab9b] focus:outline-none focus:border-[#c8a24e] focus:ring-2 focus:ring-[#c8a24e]/20 transition-colors'
const LABEL = 'block text-[11px] uppercase tracking-[.08em] text-[#8a8170] mb-1.5'

const SIGNUP_HEADLINE = (
  <>
    Every guest,
    <br />
    <em className="text-[#e7d6ad]">their own page.</em>
  </>
)
const SIGNUP_SUB =
  "One QR code in the apartment. WiFi, check-in, a live city guide, what's on this week, and a 24/7 concierge — branded to you."
const SIGNUP_POINTS = [
  'Personalised the moment they scan',
  'A live guide that refreshes itself',
  'Experiences they book — and you earn',
]

export default function Signup() {
  const navigate = useNavigate()
  const [firstName, setFirstName] = useState('')
  const [brandName, setBrandName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!agreed) return
    setLoading(true)
    setError('')

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { first_name: firstName.trim() } },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    // Email confirmation is disabled on this project; this is a safety fallback.
    if (!signUpData.session) {
      setAwaitingConfirmation(true)
      setLoading(false)
      return
    }

    const user = signUpData.user!
    const payload = { name: firstName.trim(), brand_name: brandName.trim(), contact_email: user.email }

    // The handle_new_user DB trigger creates the hosts row synchronously, but we
    // retry once in case of any propagation delay (the update silently no-ops on 0 rows).
    async function tryWrite() {
      const { data, error: err } = await supabase
        .from('hosts')
        .update(payload)
        .eq('id', user.id)
        .select('id')
      return { ok: !err && Array.isArray(data) && data.length > 0, error: err }
    }

    let result = await tryWrite()
    if (!result.ok && !result.error) {
      await new Promise<void>(r => setTimeout(r, 800))
      result = await tryWrite()
    }

    if (result.error || !result.ok) {
      setError('Account created but profile setup failed. Please try signing in.')
      setLoading(false)
      return
    }

    // contact_email is now written; send-welcome reads the recipient from the DB.
    void api.post('/send-welcome', {}).catch(() => {})

    navigate('/choose-plan')
  }

  if (awaitingConfirmation) {
    return (
      <AuthShell headline={SIGNUP_HEADLINE} sub={SIGNUP_SUB} points={SIGNUP_POINTS}>
        <h1 className="font-['Fraunces'] font-light text-[31px] leading-tight text-[#1c1c1a]">Check your email</h1>
        <p className="mt-3 text-sm leading-relaxed text-[#6f6757]">
          We've sent a confirmation link to <strong className="text-[#1c1c1a]">{email}</strong>. Click it to activate
          your account, then sign in.
        </p>
        <p className="mt-8 text-center text-sm text-[#6f6757]">
          <Link to="/login" className="font-semibold text-[#a8842f] underline decoration-[#c8a24e]/40 underline-offset-2 hover:text-[#c8a24e]">
            Back to sign in
          </Link>
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell headline={SIGNUP_HEADLINE} sub={SIGNUP_SUB} points={SIGNUP_POINTS}>
      {/* step indicator */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[.08em] text-[#8a8170]">
          <span>Step 1 of 2 · Create account</span>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[#e0dacd]">
          <div className="h-full w-1/2 rounded-full bg-[#c8a24e]" />
        </div>
      </div>

      <h1 className="font-['Fraunces'] font-light text-[31px] leading-tight text-[#1c1c1a]">Create your account</h1>
      <p className="mt-2 text-sm text-[#6f6757]">Start your 14-day free trial. No card needed to begin.</p>

      <form onSubmit={submit} className="mt-7 space-y-4">
        <div>
          <label className={LABEL} htmlFor="signup-first">First name</label>
          <input
            id="signup-first"
            type="text"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            className={INPUT}
            placeholder="Marco"
            autoComplete="given-name"
            minLength={2}
            required
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="signup-brand">Brand name</label>
          <input
            id="signup-brand"
            type="text"
            value={brandName}
            onChange={e => setBrandName(e.target.value)}
            className={INPUT}
            placeholder="Marco's Barcelona Stays"
            autoComplete="organization"
            minLength={2}
            required
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="signup-email">Email address</label>
          <input
            id="signup-email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className={INPUT}
            placeholder="marco@email.com"
            autoComplete="email"
            required
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="signup-password">Password</label>
          <input
            id="signup-password"
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

        {/* Plain div wrapper (not a <label>) + a single toggle path on each element,
            so a click never double-fires through native label forwarding. */}
        <div className="flex items-start gap-2.5 text-[13px] text-[#6f6757] pt-1">
          <button
            type="button"
            role="checkbox"
            aria-checked={agreed}
            aria-labelledby="signup-terms-label"
            onClick={() => setAgreed(v => !v)}
            className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]/50 ${
              agreed ? 'bg-[#c8a24e] border-[#c8a24e]' : 'bg-white border-[#cfc7b6]'
            }`}
          >
            {agreed && (
              <svg viewBox="0 0 24 24" className="h-3 w-3 text-[#16100d]" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
          <span id="signup-terms-label" onClick={() => setAgreed(v => !v)} className="cursor-pointer select-none">
            I agree to the terms and privacy policy
          </span>
        </div>

        {error && (
          <p role="alert" className="text-[12px] text-[#8a1a1a] bg-[#fde4e4] border border-[#f3c9c9] rounded-[9px] px-3 py-2.5">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || !agreed}
          className="group flex w-full items-center justify-center gap-2 bg-[#c8a24e] text-[#16100d] font-semibold rounded-[12px] py-[14px] text-sm transition-colors hover:bg-[#e7d6ad] disabled:opacity-40 disabled:hover:bg-[#c8a24e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f3ec]"
        >
          {loading ? 'Creating account…' : 'Create free account'}
          {!loading && (
            <svg viewBox="0 0 24 24" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          )}
        </button>

        <p className="text-center text-[12px] text-[#8a8170]">14-day free trial · No card needed · Cancel anytime</p>
      </form>

      <p className="mt-6 text-center text-sm text-[#6f6757]">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-[#a8842f] underline decoration-[#c8a24e]/40 underline-offset-2 hover:text-[#c8a24e]">
          Sign in
        </Link>
      </p>
    </AuthShell>
  )
}
