import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Loader from './components/shared/Loader'
import { ToastProvider } from './components/shared/Toast'
import PrivateRoute from './components/shared/PrivateRoute'
import SuperAdminRoute from './components/shared/SuperAdminRoute'
import Layout from './components/shared/Layout'
import Login from './components/auth/Login'
import Signup from './components/auth/Signup'
import ResetPassword from './components/auth/ResetPassword'
import AuthCallback from './components/auth/AuthCallback'
import CompleteProfile from './components/auth/CompleteProfile'
import ChoosePlan from './components/host/ChoosePlan'
import Dashboard from './components/host/Dashboard'
import PropertySetup from './components/host/PropertySetup'
import BookingManager from './components/host/BookingManager'
import SharePanel from './components/host/SharePanel'
import BrandingPanel from './components/host/BrandingPanel'
import BillingPanel from './components/host/BillingPanel'
import EarningsPanel from './components/host/EarningsPanel'
import EarningsConnect from './components/host/EarningsConnect'
import Settings from './components/host/Settings'
import Messages from './components/host/Messages'
import GuestPage from './components/guest/GuestPage'
import WelcomePage from './components/guest/WelcomePage'
import SuperAdmin from './components/admin/SuperAdmin'
import Demo from './components/demo/Demo'
import Landing from './components/Landing'

// Lazily loaded, and that is deliberate: the four legal documents are imported into the
// bundle as raw text, and they must not ride in the main chunk that every guest page
// downloads on a phone. They are their own chunk, fetched only when /legal is opened.
const LegalIndex = lazy(() => import('./components/legal/Legal').then(m => ({ default: m.LegalIndex })))
const LegalDoc = lazy(() => import('./components/legal/Legal').then(m => ({ default: m.LegalDoc })))
import { ARRIVLY_CONFIG } from './config'
import ConsentBanner from './components/shared/ConsentBanner'
import { initAnalytics, trackPageView, isTrackedRoute, isAnalyticsLoaded } from './lib/analytics'

/**
 * SPA page-view tracking, plus the guard that keeps the guest-page exclusion true.
 *
 * Both analytics calls are consent- AND route-gated inside the module, so calling them
 * unconditionally on every navigation is safe: on a guest page they do nothing, and with no
 * stored consent they do nothing. initAnalytics() is idempotent and is what loads the script
 * for a visitor who granted consent on an earlier visit, since no banner is shown to them.
 *
 * THE FULL-LOAD GUARD IS THE PART THAT MATTERS. The route gate is an ENTRY gate: once gtag.js
 * is in the document it stays, and its enhanced-measurement hits read `window.location.href`
 * themselves — so arriving on `/guest?apt=…&token=…` through an in-app transition would hand
 * Google a booking token even though nothing here called a tracking function. LandingGate
 * below does exactly such a transition (`<Navigate to={'/guest?…'}>` for a saved booking in the
 * installed app). Replacing the document tears the script out; on the reload `initAnalytics()`
 * refuses the untracked route, so `isAnalyticsLoaded()` is false and this cannot loop.
 */
function AnalyticsTracker() {
  const { pathname } = useLocation()
  useEffect(() => {
    if (!isTrackedRoute(pathname)) {
      if (isAnalyticsLoaded()) {
        // reload(), NOT replace(current URL). When a replace target equals the current URL
        // except for a non-null FRAGMENT, the HTML navigation algorithm performs a fragment
        // navigation — no unload, so gtag.js would SURVIVE on exactly the fragment-bearing
        // routes (`/auth/callback#access_token=…`, `/reset-password#…`) this guard exists to
        // protect. reload() is unconditional and preserves path, query and fragment.
        window.location.reload()
      }
      return
    }
    initAnalytics()
    trackPageView(pathname)
  }, [pathname])
  return null
}

function LandingGate() {
  const [checking, setChecking] = useState(true)
  const [authed, setAuthed] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [standalone, setStandalone] = useState(false)
  const [savedGuest, setSavedGuest] = useState<{ apt: string; token: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    // getSession() is intentional — local-only, no network. PrivateRoute uses
    // getUser() for the real server-validated gate on every protected route.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) {
        const isStandalone =
          window.matchMedia('(display-mode: standalone)').matches ||
          (navigator as any).standalone === true
        setAuthed(!!session)
        setUserEmail(session?.user?.email ?? null)
        setStandalone(isStandalone)
        // savedGuest is intentionally only populated in standalone mode; the render
        // order (savedGuest before standalone) is correct for both current and future use.
        if (!session && isStandalone) {
          try {
            const raw = localStorage.getItem('arrivly_last_guest')
            if (raw) {
              const parsed = JSON.parse(raw)
              if (parsed?.apt && typeof parsed.apt === 'string' && parsed?.token && typeof parsed.token === 'string') {
                setSavedGuest({ apt: parsed.apt, token: parsed.token })
              }
            }
          } catch {}
        }
        setChecking(false)
      }
    })
    return () => { cancelled = true }
  }, [])

  if (checking) return <Loader />
  if (authed) return <Navigate to={userEmail === ARRIVLY_CONFIG.adminEmail ? '/admin' : '/dashboard'} replace />
  if (savedGuest) return <Navigate to={`/guest?apt=${savedGuest.apt}&token=${savedGuest.token}`} replace />
  // Installed app (standalone), logged out, no active guest booking → host login.
  // Create account link lives on the Login page so new hosts are covered too.
  if (standalone) return <Navigate to="/login" replace />
  return <Landing />
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <AnalyticsTracker />
        <Routes>
          {/* Public */}
          <Route path="/" element={<LandingGate />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/complete-profile" element={<CompleteProfile />} />
          <Route path="/demo" element={<Demo />} />
          <Route path="/guest" element={<GuestPage />} />
          <Route path="/w/:code" element={<WelcomePage />} />

          {/* Published legal documents — public, no auth. The DPA page renders its
              annexes, which is what makes "published at bemgu.app/legal" true. */}
          <Route path="/legal" element={<Suspense fallback={<Loader />}><LegalIndex /></Suspense>} />
          <Route path="/legal/:slug" element={<Suspense fallback={<Loader />}><LegalDoc /></Suspense>} />

          {/* Protected host routes */}
          <Route element={<PrivateRoute />}>
            <Route path="/choose-plan" element={<ChoosePlan />} />
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/dashboard/property/:aptId" element={<PropertySetup />} />
              <Route path="/dashboard/bookings" element={<BookingManager />} />
              <Route path="/dashboard/share" element={<SharePanel />} />
              {/* Legacy path — bookmarks and older in-app links must keep working. */}
              <Route path="/dashboard/qr" element={<Navigate to="/dashboard/share" replace />} />
              <Route path="/dashboard/branding" element={<BrandingPanel />} />
              <Route path="/dashboard/billing" element={<BillingPanel />} />
              <Route path="/dashboard/earnings" element={<EarningsPanel />} />
              <Route path="/dashboard/earnings/connect" element={<EarningsConnect />} />
              <Route path="/dashboard/messages" element={<Messages />} />
              <Route path="/dashboard/settings" element={<Settings />} />
            </Route>
          </Route>

          {/* Superadmin */}
          <Route element={<SuperAdminRoute />}>
            <Route path="/admin" element={<SuperAdmin />} />
          </Route>

          {/* Admin convenience redirects — outside all layout trees; /admin still gated by SuperAdminRoute */}
          <Route path="/superadmin" element={<Navigate to="/admin" replace />} />
          <Route path="/dashboard/admin" element={<Navigate to="/admin" replace />} />
        </Routes>
        <ConsentBanner />
      </BrowserRouter>
    </ToastProvider>
  )
}
