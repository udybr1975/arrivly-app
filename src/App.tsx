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
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/react'
import { initAnalytics, trackPageView, isTrackedRoute, isAnalyticsLoaded, getConsent, normalizePath } from './lib/analytics'

/**
 * VERCEL WEB ANALYTICS — behind the SAME two gates as GA4, for the same reasons.
 *
 * THE STOCK ONE-LINER INSTALL WOULD BE A DATA LEAK HERE. Vercel Analytics reports the FULL
 * page URL of every view, and on this project URLs are credentials: `/guest?apt=…&token=…`
 * carries a booking token, `/w/:code` a welcome code, `/dashboard/property/:aptId` an
 * apartment UUID. The published privacy policy promises analytics only with consent and never
 * on guest surfaces, and that promise is not per-vendor.
 *
 * MEASURED AT SOURCE, NOT ASSUMED — @vercel/analytics 2.0.1 `Analytics` injects its script in
 * a `useEffect(…, [])` THAT RETURNS NO CLEANUP. Unmounting the component does NOT remove the
 * script, does NOT stop its automatic route tracking, and does NOT clear `window.va`. So the
 * render gate below is an ENTRY gate — the same shape as gtag, and the same trap. Two things
 * therefore carry the guarantee, and NEITHER is the unmount:
 *   1. The render gate keeps the script from ever loading on an excluded route in the first
 *      place, and `AnalyticsTracker`'s full-document reload tears it out of a document that
 *      transitions onto one (see the flag below — the reload condition had to learn about this
 *      script, because it previously keyed on gtag's flag alone).
 *   2. `beforeSend` — registered on the analytics runtime and therefore surviving unmount. It
 *      drops any event on an untracked path and rewrites every surviving URL to a normalised,
 *      path-only form. TRUST IT SECOND, NOT FIRST: it is enforced inside
 *      `/_vercel/insights/script.js`, a remote script that is not in this repo and can change
 *      without a deploy here. The entry gate is the part we own. Do not relax the gate on the
 *      strength of the filter.
 *
 * WHAT `beforeSend` STRUCTURALLY CANNOT DO — AND WHY vercel.json NOW CARRIES A HEADER.
 * `BeforeSendEvent` is `{ type, url }` and nothing else: there is NO referrer field, so this
 * filter reaches exactly one of the two URL-shaped channels. `src/lib/analytics.ts`'s
 * `safeReferrer()` sanitises the other one for gtag, in JS — an option Vercel does not offer.
 * The reachable path was real: `GuestPage` does `window.location.replace('/guest?apt=…&token=…')`,
 * so that token-bearing URL becomes the document's `document.referrer`, which survives every
 * later pushState; two in-product <Link> taps then reach a tracked route. `Referrer-Policy:
 * strict-origin` in `vercel.json` closes it for BOTH tools at the browser, which is a mechanism
 * rather than a convention, and it is why the published policy's referrer sentence is true.
 * A VENDOR PRIVACY FILTER IS ONLY AS WIDE AS THE FIELDS THE VENDOR HANDS THE CALLBACK.
 *
 * KNOWN AND ACCEPTED — THE ACCEPT-PAGE VIEW IS NOT COUNTED BY VERCEL. `ConsentBanner` starts
 * GA4 on the very page the visitor accepted on by calling `trackPageView()` itself; it cannot
 * do the same here, because <Analytics/> renders from this component and the banner's local
 * state change does not re-render it, so Vercel starts one navigation later. The direction is
 * FEWER events, never more, so no published promise is affected — but it does mean the two
 * properties will disagree on first-accept sessions, and a visitor who accepts and then leaves
 * contributes zero Vercel events. Closing it means giving the banner a shared consent signal;
 * that file was outside this change's freeze lift.
 */

/**
 * Whether Vercel's script has been injected into THIS document. Module-level and never reset,
 * because the script it tracks is never removed either — a `useState` here would lie the moment
 * the component unmounted. Mirrors `isAnalyticsLoaded()` for gtag, and the reload guard reads
 * BOTH: keying that guard on gtag alone would leave Vercel's script alive on a guest page in
 * any future where GA4 is disabled and this is not.
 */
let vercelAnalyticsLive = false

/**
 * The second, independent layer. Runs on every event the Vercel runtime is about to send.
 *
 * FAIL-CLOSED, INCLUDING ON A URL IT CANNOT PARSE: anything that is not a URL on a tracked
 * path is dropped entirely (`null`), and anything that survives is rebuilt from origin +
 * NORMALISED PATHNAME — so the query string and fragment are not "stripped" so much as never
 * carried over, and a UUID segment becomes `:id`. Reuses `isTrackedRoute` and `normalizePath`
 * rather than restating either rule, so the exclusion list has exactly one definition.
 *
 * Declared at module scope so its identity is stable: the component re-registers it whenever
 * `props.beforeSend` changes, and an inline arrow would re-register on every render.
 */
function vercelBeforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const u = new URL(event.url)
    if (!isTrackedRoute(u.pathname)) return null
    // `...event` is a PASS-THROUGH, and that is the one thing to re-check on a version bump.
    // Today `BeforeSendEvent` is exactly `{ type, url }`, so the spread copies nothing but the
    // discriminant; an explicit `{ type: event.type, url }` would widen `type` and fail to
    // assign, which is why the spread is the pragmatic form. But the dependency is a caret
    // range: a minor that adds a payload field to `CustomEvent` would be copied through
    // UNFILTERED and still compile. `track()` is called nowhere in this repo, which is what
    // bounds it today.
    return { ...event, url: `${u.origin}${normalizePath(u.pathname)}` }
  } catch {
    return null
  }
}

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

  // Re-read on every navigation rather than held in state: this component re-renders on each
  // route change, which is the moment the answer can change.
  const analyticsAllowed = getConsent() === 'granted' && isTrackedRoute(pathname)

  useEffect(() => {
    if (analyticsAllowed) vercelAnalyticsLive = true
  }, [analyticsAllowed])

  useEffect(() => {
    if (!isTrackedRoute(pathname)) {
      if (isAnalyticsLoaded() || vercelAnalyticsLive) {
        // reload(), NOT replace(current URL). When a replace target equals the current URL
        // except for a non-null FRAGMENT, the HTML navigation algorithm performs a fragment
        // navigation — no unload, so the analytics scripts would SURVIVE on exactly the
        // fragment-bearing routes (`/auth/callback#access_token=…`, `/reset-password#…`) this
        // guard exists to protect. reload() is unconditional and preserves path, query and
        // fragment. A full document load is the ONLY way to remove Vercel's script, which
        // ships no teardown of its own.
        window.location.reload()
      }
      return
    }
    initAnalytics()
    trackPageView(pathname)
  }, [pathname])

  // Rendered ONLY under both gates, so the script never reaches an excluded route. It is not
  // removed again by unmounting (see the block comment above) — `beforeSend` is what continues
  // to hold once it is in the document.
  return analyticsAllowed ? <Analytics beforeSend={vercelBeforeSend} /> : null
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
