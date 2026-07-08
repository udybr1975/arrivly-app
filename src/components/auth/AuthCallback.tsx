import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { ARRIVLY_CONFIG } from '../../config'
import Loader from '../shared/Loader'

/**
 * OAuth landing (route /auth/callback, public).
 *
 * After a social sign-in the provider full-page-redirects here with the session
 * in the URL hash. detectSessionInUrl (on by default, implicit/hash flow)
 * populates the session asynchronously, so we poll getUser() briefly before
 * giving up. Once the session exists we route the host:
 *   - existing demo (is_demo) → /dashboard (Layout shows the wall if expired)
 *   - pending demo intent + empty brand → /demo (finish a Google demo)
 *   - pending demo intent + brand set → /dashboard (real account; ignore intent)
 *   - no brand_name → /complete-profile (brand bootstrap)
 *   - admin email → /admin
 *   - otherwise → /dashboard  (PrivateRoute then sends new hosts to /choose-plan)
 */
const DEMO_INTENT_KEY = 'arrivly_demo_intent'
const DEMO_INTENT_TTL_MS = 30 * 60 * 1000

// Returns true if a fresh (non-stale) demo intent is present; clears a stale/broken one.
function hasFreshDemoIntent(): boolean {
  try {
    const raw = sessionStorage.getItem(DEMO_INTENT_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.ts === 'number' && Date.now() - parsed.ts <= DEMO_INTENT_TTL_MS) {
      return true
    }
    sessionStorage.removeItem(DEMO_INTENT_KEY)
    return false
  } catch {
    try { sessionStorage.removeItem(DEMO_INTENT_KEY) } catch {}
    return false
  }
}

export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false

    async function resolveUser() {
      // Poll getUser() over ~5s while detectSessionInUrl populates the session.
      for (let attempt = 0; attempt < 20; attempt++) {
        if (cancelled) return null
        const { data: { user } } = await supabase.auth.getUser()
        if (cancelled) return null
        if (user) return user
        await new Promise<void>(r => setTimeout(r, 250))
      }
      return null
    }

    async function run() {
      // Provider denial / OAuth error comes back as a query or hash param.
      const params = new URLSearchParams(window.location.search)
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      if (params.get('error') || hashParams.get('error') || params.get('error_description') || hashParams.get('error_description')) {
        if (!cancelled) navigate('/login', { replace: true })
        return
      }

      const user = await resolveUser()
      if (cancelled) return
      if (!user) {
        navigate('/login', { replace: true })
        return
      }

      // Read the hosts row; retry once if the trigger-created row hasn't propagated.
      async function readHost() {
        const { data } = await supabase
          .from('hosts')
          .select('name, brand_name, is_demo')
          .eq('id', user!.id)
          .maybeSingle()
        return data as { name: string | null; brand_name: string | null; is_demo: boolean | null } | null
      }

      let hostRow = await readHost()
      if (cancelled) return
      if (!hostRow) {
        await new Promise<void>(r => setTimeout(r, 800))
        if (cancelled) return
        hostRow = await readHost()
        if (cancelled) return
      }

      const brand = hostRow?.brand_name?.trim()
      const pendingDemo = hasFreshDemoIntent()

      if (hostRow?.is_demo === true) {
        // Existing demo host — the demo intent (if any) is moot; let them in.
        try { sessionStorage.removeItem(DEMO_INTENT_KEY) } catch {}
        navigate('/dashboard', { replace: true })
      } else if (pendingDemo && !brand) {
        // Fresh Google user finishing a demo — /demo consumes the intent (Choose → create).
        navigate('/demo', { replace: true })
      } else if (pendingDemo && brand) {
        // Real existing account that happened to have a demo intent — ignore it.
        try { sessionStorage.removeItem(DEMO_INTENT_KEY) } catch {}
        navigate('/dashboard', { replace: true })
      } else if (!brand) {
        navigate('/complete-profile', { replace: true })
      } else if (user.email === ARRIVLY_CONFIG.adminEmail) {
        navigate('/admin', { replace: true })
      } else {
        navigate('/dashboard', { replace: true })
      }
    }

    run()
    return () => { cancelled = true }
  }, [navigate])

  return <Loader />
}
