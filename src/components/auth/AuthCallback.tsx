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
 *   - no brand_name  → /complete-profile (brand bootstrap)
 *   - admin email     → /admin
 *   - otherwise       → /dashboard  (PrivateRoute then sends new hosts to /choose-plan)
 */
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
          .select('name, brand_name')
          .eq('id', user!.id)
          .maybeSingle()
        return data as { name: string | null; brand_name: string | null } | null
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
      if (!brand) {
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
