import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import AuthShell from './AuthShell'

const INPUT =
  'w-full bg-white border border-[#e0dacd] rounded-[11px] px-[15px] py-[13px] text-sm text-[#1c1c1a] placeholder:text-[#b3ab9b] focus:outline-none focus:border-[#c8a24e] focus:ring-2 focus:ring-[#c8a24e]/20 transition-colors'
const LABEL = 'block text-[11px] uppercase tracking-[.08em] text-[#8a8170] mb-1.5'

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await supabase.auth.signOut({ scope: 'local' })
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(error.message)
      } else {
        navigate('/dashboard')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      headline={
        <>
          Welcome
          <br />
          <em className="text-[#e7d6ad]">back home.</em>
        </>
      }
      sub="Your properties, guest pages, bookings and messages — all in one calm place."
    >
      <h1 className="font-['Fraunces'] font-light text-[31px] leading-tight text-[#1c1c1a]">Welcome back</h1>
      <p className="mt-2 text-sm text-[#6f6757]">Sign in to manage your properties and guest pages.</p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label className={LABEL} htmlFor="login-email">Email address</label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className={INPUT}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label className={LABEL} htmlFor="login-password">Password</label>
            <Link to="/reset-password" className="text-[11px] font-medium text-[#a8842f] hover:text-[#c8a24e] transition-colors">
              Forgot password?
            </Link>
          </div>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className={INPUT}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </div>

        {error && (
          <p role="alert" className="text-[12px] text-[#8a1a1a] bg-[#fde4e4] border border-[#f3c9c9] rounded-[9px] px-3 py-2.5">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="group flex w-full items-center justify-center gap-2 bg-[#c8a24e] text-[#16100d] font-semibold rounded-[12px] py-[14px] text-sm transition-colors hover:bg-[#e7d6ad] disabled:opacity-40 disabled:hover:bg-[#c8a24e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f3ec]"
        >
          {loading ? 'Signing in…' : 'Sign in'}
          {!loading && (
            <svg viewBox="0 0 24 24" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          )}
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-[#6f6757]">
        New to Arrivly?{' '}
        <Link to="/signup" className="font-semibold text-[#a8842f] underline decoration-[#c8a24e]/40 underline-offset-2 hover:text-[#c8a24e]">
          Start your free trial
        </Link>
      </p>
    </AuthShell>
  )
}
