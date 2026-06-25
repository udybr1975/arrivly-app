import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Loader from './components/shared/Loader'
import { ToastProvider } from './components/shared/Toast'
import PrivateRoute from './components/shared/PrivateRoute'
import SuperAdminRoute from './components/shared/SuperAdminRoute'
import Layout from './components/shared/Layout'
import Login from './components/auth/Login'
import Signup from './components/auth/Signup'
import ChoosePlan from './components/host/ChoosePlan'
import Dashboard from './components/host/Dashboard'
import PropertySetup from './components/host/PropertySetup'
import BookingManager from './components/host/BookingManager'
import QRCodePanel from './components/host/QRCodePanel'
import BrandingPanel from './components/host/BrandingPanel'
import BillingPanel from './components/host/BillingPanel'
import Settings from './components/host/Settings'
import Messages from './components/host/Messages'
import GuestPage from './components/guest/GuestPage'
import SuperAdmin from './components/admin/SuperAdmin'
import Landing from './components/Landing'
import { ARRIVLY_CONFIG } from './config'

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
        <Routes>
          {/* Public */}
          <Route path="/" element={<LandingGate />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/guest" element={<GuestPage />} />

          {/* Protected host routes */}
          <Route element={<PrivateRoute />}>
            <Route path="/choose-plan" element={<ChoosePlan />} />
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/dashboard/property/:aptId" element={<PropertySetup />} />
              <Route path="/dashboard/bookings" element={<BookingManager />} />
              <Route path="/dashboard/qr" element={<QRCodePanel />} />
              <Route path="/dashboard/branding" element={<BrandingPanel />} />
              <Route path="/dashboard/billing" element={<BillingPanel />} />
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
      </BrowserRouter>
    </ToastProvider>
  )
}
