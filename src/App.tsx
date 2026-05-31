import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import { ToastProvider } from './components/shared/Toast'
import PrivateRoute from './components/shared/PrivateRoute'
import SuperAdminRoute from './components/shared/SuperAdminRoute'
import Layout from './components/shared/Layout'
import Login from './components/auth/Login'
import Signup from './components/auth/Signup'
import OnboardingFlow from './components/onboarding/OnboardingFlow'
import Dashboard from './components/host/Dashboard'
import PropertySetup from './components/host/PropertySetup'
import BookingManager from './components/host/BookingManager'
import QRCodePanel from './components/host/QRCodePanel'
import BrandingPanel from './components/host/BrandingPanel'
import BillingPanel from './components/host/BillingPanel'
import Settings from './components/host/Settings'
import GuestPage from './components/guest/GuestPage'
import SuperAdmin from './components/admin/SuperAdmin'

const FEATURES = [
  { emoji: '📲', title: 'Print one QR', desc: 'Place it in the apartment. Never update it. URL never changes.' },
  { emoji: '👤', title: 'Guest lands on their page', desc: 'Personalised with their name, stay dates, and your branding.' },
  { emoji: '🗺', title: 'AI city guide', desc: 'Generated for their exact street. Any city in the world. Updates monthly.' },
  { emoji: '💬', title: 'Built-in chatbot', desc: 'Answers guest questions 24/7. Knows your apartment. Zero effort from you.' },
]

function Landing() {
  return (
    <div className="min-h-screen bg-[#f0ede6]">
      <div className="max-w-4xl mx-auto">
        {/* Dark hero */}
        <div className="bg-[#1c1c1a] px-9 pt-12 pb-9">
          <div className="font-mono text-[11px] text-white/35 uppercase tracking-[.2em] mb-3.5">Arrivly</div>
          <h1 className="text-[28px] font-serif font-light text-white leading-tight max-w-[440px] mb-3">
            Give every guest their own personal page.
          </h1>
          <p className="text-[13px] text-white/55 max-w-[400px] leading-[1.7] mb-5">
            One QR code. Guest scans it. They get WiFi, house rules, a live city guide, and a personal welcome — in seconds. Works on Airbnb, VRBO, Booking.com.
          </p>
          <div className="flex gap-2.5 flex-wrap mb-2">
            <Link
              to="/signup"
              className="bg-white text-[#1c1c1a] px-5 py-2.5 rounded-[8px] text-[13px] font-semibold font-serif hover:bg-gray-100 transition-colors"
            >
              Start free — 30 days
            </Link>
            <button className="bg-transparent text-white/60 border border-white/25 px-5 py-2.5 rounded-[8px] text-[13px] hover:bg-white/10 transition-colors">
              See demo
            </button>
          </div>
          <div className="text-[11px] text-white/25">No credit card needed to start</div>
        </div>

        {/* Feature cards */}
        <div className="px-9 py-6 grid grid-cols-2 md:grid-cols-4 gap-3 bg-white border-b border-[#ede9e2]">
          {FEATURES.map(f => (
            <div key={f.title} className="bg-white border border-[#ddd8ce] rounded-[10px] p-3">
              <div className="text-xl mb-1.5">{f.emoji}</div>
              <div className="text-[13px] font-semibold mb-0.5 text-[#1a1a1a]">{f.title}</div>
              <div className="text-[11px] text-[#777] leading-[1.6]">{f.desc}</div>
            </div>
          ))}
        </div>

        {/* Pricing strip */}
        <div className="px-9 py-5 bg-[#f8f6f2] border-t border-[#ede9e2] flex items-center justify-between flex-wrap gap-3.5">
          <div>
            <div className="text-2xl font-serif font-light text-[#1a1a1a]">
              €19<span className="text-[13px] text-[#888] font-normal font-sans">/month per property</span>
            </div>
            <div className="text-xs text-[#888] mt-0.5">30 days free · Cancel anytime · No card needed to start</div>
          </div>
          <Link
            to="/signup"
            className="bg-[#1a1a1a] text-white px-6 py-2.5 rounded-[8px] text-xs font-semibold hover:opacity-80 transition-opacity"
          >
            Start free trial
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/" element={<Landing />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/guest" element={<GuestPage />} />

          {/* Protected host routes */}
          <Route element={<PrivateRoute />}>
            <Route path="/onboarding" element={<OnboardingFlow />} />
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/dashboard/property/:aptId" element={<PropertySetup />} />
              <Route path="/dashboard/bookings" element={<BookingManager />} />
              <Route path="/dashboard/qr" element={<QRCodePanel />} />
              <Route path="/dashboard/branding" element={<BrandingPanel />} />
              <Route path="/dashboard/billing" element={<BillingPanel />} />
              <Route path="/dashboard/settings" element={<Settings />} />
            </Route>
          </Route>

          {/* Superadmin */}
          <Route element={<SuperAdminRoute />}>
            <Route path="/admin" element={<SuperAdmin />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  )
}
