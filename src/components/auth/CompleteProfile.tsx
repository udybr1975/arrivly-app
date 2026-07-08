import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import { ARRIVLY_CONFIG } from '../../config'
import AuthShell from './AuthShell'
import Loader from '../shared/Loader'

const INPUT =
  'w-full bg-white border border-[#e0dacd] rounded-[11px] px-[15px] py-[13px] text-sm text-[#1c1c1a] placeholder:text-[#b3ab9b] focus:outline-none focus:border-[#c8a24e] focus:ring-2 focus:ring-[#c8a24e]/20 transition-colors'
const LABEL = 'block text-[11px] uppercase tracking-[.08em] text-[#8a8170] mb-1.5'

const HEADLINE = (
  <>
    Every guest,
    <br />
    <em className="text-[#e7d6ad]">their own page.</em>
  </>
)
const SUB =
  "One QR code in the apartment. WiFi, check-in, a live city guide, what's on this week, and a 24/7 concierge — branded to you."

/**
 * First-login brand bootstrap (route /complete-profile, public but self-guarded).
 *
 * A social sign-in skips the Signup form, and Google doesn't supply a first name,
 * so an OAuth host lands with an empty name AND empty brand_name. This step
 * collects both and writes them to the hosts row (mirroring Signup's write +
 * send-welcome), then continues to /choose-plan. Guarded: no user → /login;
 * brand already set → /dashboard.
 */
export default function CompleteProfile() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [firstName, setFirstName] = useState('')
  const [brandName, setBrandName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
      if (!user) {
        navigate('/login', { replace: true })
        return
      }

      const { data } = await supabase
        .from('hosts')
        .select('name, brand_name')
        .eq('id', user.id)
        .maybeSingle()
      if (cancelled) return

      const row = data as { name: string | null; brand_name: string | null } | null
      if (row?.brand_name?.trim()) {
        navigate('/dashboard', { replace: true })
        return
      }

      // Prefill first name: existing hosts.name → Google given_name → first token
      // of name/full_name → ''.
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>
      const fromMeta = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
      const fullName = fromMeta(meta.name) || fromMeta(meta.full_name)
      const prefill =
        (row?.name?.trim() || '') ||
        fromMeta(meta.given_name) ||
        (fullName ? fullName.split(/\s+/)[0] : '')

      setUserId(user.id)
      setUserEmail(user.email ?? null)
      setFirstName(prefill)
      setReady(true)
    }
    bootstrap()
    return () => { cancelled = true }
  }, [navigate])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!agreed || !userId) return
    setLoading(true)
    setError('')

    const payload = {
      name: firstName.trim(),
      brand_name: brandName.trim(),
      contact_email: userEmail,
    }

    async function tryWrite() {
      const { data, error: err } = await supabase
        .from('hosts')
        .update(payload)
        .eq('id', userId!)
        .select('id')
      return { ok: !err && Array.isArray(data) && data.length > 0, error: err }
    }

    let result = await tryWrite()
    if (!result.ok && !result.error) {
      await new Promise<void>(r => setTimeout(r, 800))
      result = await tryWrite()
    }

    if (result.error || !result.ok) {
      setError('Something went wrong saving your details. Please try again.')
      setLoading(false)
      return
    }

    // contact_email is now written; send-welcome reads the recipient from the DB.
    void api.post('/send-welcome', {}).catch(() => {})

    // A fresh admin OAuth account reaches brand bootstrap before AuthCallback's
    // admin branch; route it to /admin here so it isn't stranded on /choose-plan.
    if (userEmail === ARRIVLY_CONFIG.adminEmail) {
      navigate('/admin', { replace: true })
    } else {
      navigate('/choose-plan', { replace: true })
    }
  }

  if (!ready) return <Loader />

  return (
    <AuthShell headline={HEADLINE} sub={SUB}>
      {/* step indicator */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[.08em] text-[#8a8170]">
          <span>Step 2 of 2 · Finish your brand</span>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[#e0dacd]">
          <div className="h-full w-full rounded-full bg-[#c8a24e]" />
        </div>
      </div>

      <h1 className="font-['Fraunces'] font-light text-[31px] leading-tight text-[#1c1c1a]">Finish your brand</h1>
      <p className="mt-2 text-sm text-[#6f6757]">A couple of details and your guest pages are ready to go.</p>

      <form onSubmit={submit} className="mt-7 space-y-4">
        <div>
          <label className={LABEL} htmlFor="cp-first">First name</label>
          <input
            id="cp-first"
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
          <label className={LABEL} htmlFor="cp-brand">Brand name</label>
          <input
            id="cp-brand"
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

        {/* Plain div wrapper (not a <label>) + a single toggle path on each element,
            so a click never double-fires through native label forwarding. */}
        <div className="flex items-start gap-2.5 text-[13px] text-[#6f6757] pt-1">
          <button
            type="button"
            role="checkbox"
            aria-checked={agreed}
            aria-labelledby="cp-terms-label"
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
          <span id="cp-terms-label" onClick={() => setAgreed(v => !v)} className="cursor-pointer select-none">
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
          {loading ? 'Saving…' : 'Continue'}
          {!loading && (
            <svg viewBox="0 0 24 24" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          )}
        </button>
      </form>
    </AuthShell>
  )
}
