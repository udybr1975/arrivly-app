import { useEffect, useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const NAV = [
  { to: '/dashboard',          label: 'Overview',     emoji: '📊', end: true },
  { to: '/dashboard/bookings', label: 'Bookings',     emoji: '📅' },
  { to: '/dashboard/qr',       label: 'QR codes',     emoji: '📲' },
  { to: '/dashboard/branding', label: 'Branding',     emoji: '🎨' },
  { to: '/dashboard/billing',  label: 'Billing',      emoji: '💳' },
]

interface HostData {
  brand_name: string | null
  trial_ends_at: string | null
  subscription_status: string | null
}

export default function Layout() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [host, setHost] = useState<HostData | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setEmail(user.email ?? '')
      const { data } = await supabase
        .from('hosts')
        .select('brand_name, trial_ends_at, subscription_status')
        .eq('id', user.id)
        .maybeSingle()
      if (data) setHost(data)
    }
    load()
  }, [])

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) {
      await supabase.auth.signOut({ scope: 'local' })
    }
    navigate('/login', { replace: true })
  }

  const trialRemaining = host?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(host.trial_ends_at).getTime() - Date.now()) / 86_400_000))
    : 0
  const showTrial = host?.subscription_status === 'trial' && trialRemaining > 0

  return (
    <div className="flex min-h-screen bg-[#f0ede6]">
      {/* Sidebar */}
      <aside className="w-[170px] shrink-0 bg-[#f8f6f2] border-r border-[#ddd8ce] p-[14px] flex flex-col min-h-screen">
        {/* Brand + email */}
        <div className="mb-3.5">
          <div className="text-[13px] font-semibold text-[#1a1a1a] truncate">
            {host?.brand_name ?? 'Arrivly'}
          </div>
          <div className="text-[10px] text-[#aaa] truncate">{email}</div>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-0.5 flex-1">
          {NAV.map(({ to, label, emoji, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-[7px] px-[10px] py-[7px] rounded-[7px] text-xs cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-white text-[#1a1a1a] font-semibold shadow-[0_1px_2px_rgba(0,0,0,.06)]'
                    : 'text-[#666] hover:bg-white/60'
                }`
              }
            >
              <span className="text-sm">{emoji}</span>
              {label}
            </NavLink>
          ))}
          <NavLink
            to="/dashboard/settings"
            className={({ isActive }) =>
              `flex items-center gap-[7px] px-[10px] py-[7px] rounded-[7px] text-xs cursor-pointer transition-colors ${
                isActive
                  ? 'bg-white text-[#1a1a1a] font-semibold shadow-[0_1px_2px_rgba(0,0,0,.06)]'
                  : 'text-[#666] hover:bg-white/60'
              }`
            }
          >
            <span className="text-sm">⚙️</span>
            Settings
          </NavLink>
        </nav>

        {/* Trial widget + sign out */}
        <div className="mt-auto pt-3.5 flex flex-col gap-2">
          {showTrial && (
            <div className="bg-[#e4f0da] rounded-[9px] p-[11px]">
              <div className="text-[10px] font-semibold text-[#2a5c0a]">Free trial</div>
              <div className="text-[22px] font-serif font-light text-[#1a3a0a] my-0.5">
                {trialRemaining}
              </div>
              <div className="text-[10px] text-[#2a5c0a] mb-1.5">days remaining</div>
              <NavLink
                to="/dashboard/billing"
                className="block bg-[#1a3a0a] text-white text-center py-1.5 rounded-[5px] text-[10px] font-semibold hover:opacity-80 transition-opacity"
              >
                Add card
              </NavLink>
            </div>
          )}
          <button
            onClick={signOut}
            className="text-[10px] text-[#999] hover:text-[#666] text-left px-1 transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 p-4 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
