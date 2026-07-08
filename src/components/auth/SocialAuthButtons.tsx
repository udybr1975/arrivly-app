import { useState } from 'react'
import { supabase } from '../../lib/supabase'

/**
 * Shared social sign-in buttons for the Login and Signup surfaces.
 *
 * Gated behind VITE_SOCIAL_AUTH — renders NOTHING unless it is exactly 'true',
 * so no button appears until the OAuth providers are configured in Supabase.
 * The Apple button is additionally gated behind VITE_SOCIAL_APPLE (postponed).
 *
 * On click we kick off supabase.auth.signInWithOAuth, which full-page-redirects
 * the browser to the provider; on return, /auth/callback (AuthCallback) resolves
 * the session and routes the host. We do NOT change the client flow type — the
 * project stays on the implicit/hash flow that ResetPassword depends on.
 */

type Provider = 'google' | 'apple'

const SOCIAL_ENABLED = import.meta.env.VITE_SOCIAL_AUTH === 'true'
const APPLE_ENABLED = import.meta.env.VITE_SOCIAL_APPLE === 'true'

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.87z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.63H1.29a12 12 0 0 0 0 10.74l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.63l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="#fff" aria-hidden>
      <path d="M17.05 12.53c-.02-2.05 1.68-3.03 1.75-3.08-.95-1.4-2.44-1.59-2.97-1.61-1.26-.13-2.47.74-3.11.74-.64 0-1.63-.72-2.68-.7-1.38.02-2.65.8-3.36 2.03-1.43 2.49-.37 6.17 1.03 8.19.68.99 1.5 2.1 2.57 2.06 1.03-.04 1.42-.66 2.67-.66 1.24 0 1.6.66 2.68.64 1.11-.02 1.81-1.01 2.49-2 .78-1.15 1.11-2.26 1.12-2.32-.02-.01-2.15-.83-2.18-3.28zM15.02 6.28c.57-.69.95-1.65.85-2.6-.82.03-1.81.54-2.4 1.23-.53.61-.99 1.58-.86 2.51.91.07 1.84-.46 2.41-1.14z" />
    </svg>
  )
}

export default function SocialAuthButtons({
  redirectPath = '/auth/callback',
  dividerLabel = 'or',
}: {
  redirectPath?: string
  dividerLabel?: string
}) {
  const [busy, setBusy] = useState<Provider | null>(null)
  const [error, setError] = useState('')

  if (!SOCIAL_ENABLED) return null

  async function signIn(provider: Provider) {
    setBusy(provider)
    setError('')
    const redirectTo = `${window.location.origin}${redirectPath}`
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    })
    if (oauthError) {
      // On success the browser full-page-redirects, so this only runs on failure.
      setError(oauthError.message)
      setBusy(null)
    }
  }

  const BASE =
    'flex w-full items-center justify-center gap-2.5 rounded-[12px] py-[13px] text-sm font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f3ec]'

  return (
    <div className="mt-6">
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => signIn('google')}
          disabled={busy !== null}
          aria-busy={busy === 'google'}
          className={`${BASE} bg-white border border-[#e0dacd] text-[#1c1c1a] hover:bg-[#faf7f0]`}
        >
          <GoogleIcon />
          {busy === 'google' ? 'Redirecting…' : 'Continue with Google'}
        </button>

        {APPLE_ENABLED && (
          <button
            type="button"
            onClick={() => signIn('apple')}
            disabled={busy !== null}
            aria-busy={busy === 'apple'}
            className={`${BASE} bg-black text-white hover:bg-[#1a1a1a]`}
          >
            <AppleIcon />
            {busy === 'apple' ? 'Redirecting…' : 'Continue with Apple'}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[12px] text-[#8a1a1a] bg-[#fde4e4] border border-[#f3c9c9] rounded-[9px] px-3 py-2.5">
          {error}
        </p>
      )}

      <div className="mt-6 flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-[#e0dacd]" />
        <span className="text-[11px] uppercase tracking-[.14em] text-[#8a8170]">{dividerLabel}</span>
        <span className="h-px flex-1 bg-[#e0dacd]" />
      </div>
    </div>
  )
}
