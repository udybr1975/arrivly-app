import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import Loader from './Loader'

interface HostMin {
  stripe_subscription_id: string | null
  is_exempt: boolean | null
  is_demo: boolean | null
}

export default function PrivateRoute() {
  const location = useLocation()
  const [loading, setLoading] = useState(true)
  const [authed, setAuthed] = useState(false)
  const [host, setHost] = useState<HostMin | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
      if (!user) {
        setAuthed(false)
        setHost(null)
        setLoading(false)
        return
      }
      setAuthed(true)
      const { data } = await supabase
        .from('hosts')
        .select('stripe_subscription_id, is_exempt, is_demo')
        .eq('id', user.id)
        .maybeSingle()
      if (!cancelled) {
        setHost(data as HostMin | null)
        setLoading(false)
      }
    }
    check()
    return () => { cancelled = true }
  }, [])

  if (loading) return <Loader />
  if (!authed) return <Navigate to="/login" replace />

  const params = new URLSearchParams(location.search)
  const onChoosePlan = location.pathname === '/choose-plan'
  // Just returned from Stripe Checkout; webhook writes the sub id a moment later.
  // Scoped to /dashboard only — other protected paths should still require a plan.
  const returnedFromCheckout =
    params.get('checkout') === 'success' && location.pathname === '/dashboard'

  // A null host row (DB row not yet created or query failed) is treated as needsPlan:
  // better to land on /choose-plan than to show a broken dashboard.
  // undefined = still loading (handled above); null = row absent; HostMin = row found.
  // DEMO hosts (is_demo=true) have no Stripe sub by design — they must reach the
  // dashboard (and the expiry wall lives in Layout), so they bypass the /choose-plan
  // gate. Non-demo hosts are completely unaffected.
  const needsPlan = host === null
    || (host !== undefined && host.is_exempt !== true && host.is_demo !== true && !host.stripe_subscription_id)

  if (needsPlan && !onChoosePlan && !returnedFromCheckout) {
    return <Navigate to="/choose-plan" replace />
  }

  return <Outlet />
}
