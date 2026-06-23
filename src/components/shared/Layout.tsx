import { useEffect, useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ARRIVLY_CONFIG } from '../../config'

const NAV = [
  { to: '/dashboard',          label: 'Overview',     emoji: '📊', end: true },
  { to: '/dashboard/bookings',  label: 'Bookings',     emoji: '📅' },
  { to: '/dashboard/messages', label: 'Messages',     emoji: '💬' },
  { to: '/dashboard/qr',       label: 'QR codes',     emoji: '📲' },
  { to: '/dashboard/branding', label: 'Branding',     emoji: '🎨' },
  { to: '/dashboard/billing',  label: 'Billing',      emoji: '💳' },
]

interface HostData {
  brand_name: string | null
  trial_ends_at: string | null
  subscription_status: string | null
  stripe_subscription_id: string | null
}

export default function Layout() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [host, setHost] = useState<HostData | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    let mounted = true
    let intervalId: number

    async function countUnread() {
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('sender_role', 'guest')
        .is('read_at', null)
      if (mounted) setUnread(count ?? 0)
    }

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setEmail(user.email ?? '')
      const { data } = await supabase
        .from('hosts')
        .select('brand_name, trial_ends_at, subscription_status, stripe_subscription_id')
        .eq('id', user.id)
        .maybeSingle()
      if (data) setHost(data)
      await countUnread()
      if (mounted) intervalId = window.setInterval(countUnread, 30_000)
    }

    const handleVisibility = () => { if (document.visibilityState === 'visible') countUnread() }
    const handleRead = () => countUnread()

    load()
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('arrivly:messages-read', handleRead)

    return () => {
      mounted = false
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('arrivly:messages-read', handleRead)
    }
  }, [])

  useEffect(() => {
    if (!('setAppBadge' in navigator)) return
    if (unread > 0) {
      void (navigator as any).setAppBadge(unread)
    } else {
      void (navigator as any).clearAppBadge?.()
    }
  }, [unread])

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
  const hasSub = !!host?.stripe_subscription_id

  const closeMenu = () => setMenuOpen(false)

  return (
    <div className="flex min-h-screen bg-[#f0ede6]">

      {/* Mobile top bar — hidden on md+ */}
      <div className="md:hidden fixed top-0 inset-x-0 h-12 z-30 bg-[#f8f6f2] border-b border-[#ddd8ce] flex items-center px-3 gap-2">
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls="sidebar-nav"
          className="p-1.5 text-[#666] hover:text-[#1a1a1a] transition-colors"
        >
          <Menu size={18} />
        </button>
        <span className="text-[13px] font-semibold text-[#1a1a1a] truncate">
          {host?.brand_name ?? 'Arrivly'}
        </span>
      </div>

      {/* Backdrop — closes drawer on tap */}
      {menuOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={closeMenu}
        />
      )}

      {/* Sidebar — off-canvas on mobile, static on desktop */}
      <aside id="sidebar-nav" className={`
        fixed inset-y-0 left-0 z-50 w-[170px] shrink-0
        bg-[#f8f6f2] border-r border-[#ddd8ce] p-[14px]
        flex flex-col min-h-screen
        transform transition-transform duration-200
        ${menuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:static md:translate-x-0 md:z-auto
      `}>
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
              onClick={closeMenu}
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
              {to === '/dashboard/messages' && unread > 0 && (
                <span className="ml-auto bg-[#1a1a1a] text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                  {unread}
                </span>
              )}
            </NavLink>
          ))}
          <NavLink
            to="/dashboard/settings"
            onClick={closeMenu}
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
                onClick={closeMenu}
                className="block bg-[#1a3a0a] text-white text-center py-1.5 rounded-[5px] text-[10px] font-semibold hover:opacity-80 transition-opacity"
              >
                {hasSub ? 'Manage plan' : 'Add card'}
              </NavLink>
            </div>
          )}
          {email === ARRIVLY_CONFIG.adminEmail && (
            <NavLink
              to="/admin"
              onClick={closeMenu}
              className={({ isActive }) =>
                `flex items-center gap-[7px] px-[10px] py-[7px] rounded-[7px] text-xs cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-white text-[#1a1a1a] font-semibold shadow-[0_1px_2px_rgba(0,0,0,.06)]'
                    : 'text-[#666] hover:bg-white/60'
                }`
              }
            >
              <span className="text-sm">🔒</span>
              ← Admin
            </NavLink>
          )}
          <button
            onClick={signOut}
            className="text-[10px] text-[#999] hover:text-[#666] text-left px-1 transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main — pt-16 clears the fixed mobile top bar; md:pt-4 restores normal padding */}
      <main className="flex-1 px-4 pb-4 pt-16 md:pt-4 overflow-auto min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
