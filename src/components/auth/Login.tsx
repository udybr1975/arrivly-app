import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const INPUT = 'w-full bg-[#f8f6f2] border border-[#ddd8ce] rounded-[8px] px-3 py-2 text-xs text-[#444] focus:outline-none focus:border-[#1a1a1a] transition-colors'
const LABEL = 'block text-[10px] uppercase tracking-[.06em] text-[#999] mb-[3px]'

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
    <div className="min-h-screen flex items-center justify-center bg-[#f0ede6] px-4">
      <div className="w-full max-w-[320px]">
        <div className="mb-5">
          <h1 className="text-[17px] font-serif font-light text-[#1a1a1a] mb-1">Sign in to your account</h1>
        </div>

        <form onSubmit={submit} className="space-y-[7px]">
          <div>
            <label className={LABEL}>Email address</label>
            <input
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
            <label className={LABEL}>Password</label>
            <input
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
            <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#1a1a1a] text-white rounded-[8px] py-[10px] text-xs font-semibold hover:opacity-80 transition-opacity disabled:opacity-40 mt-1"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="text-center pt-2 text-xs text-[#888]">
            No account?{' '}
            <Link to="/signup" className="text-[#1a1a1a] font-semibold underline">Start free trial</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
