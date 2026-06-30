import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  Menu,
  Home,
  QrCode,
  Palette,
  CalendarDays,
  MessageCircle,
  CreditCard,
  Settings as SettingsIcon,
  ShieldCheck,
  LogOut,
  ChevronUp,
  BookOpen,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ARRIVLY_CONFIG } from '../../config'
import { moduleForPath } from '../../guide/content'
import { GuideContext, type GuideContextValue } from '../../guide/guideContext'
import { demoRemaining } from '../demo/demoTime'
import KeepDemoModal from '../demo/KeepDemoModal'
import UpgradeWall from '../demo/UpgradeWall'
import Logo from './Logo'
import GuideDrawer from './GuideDrawer'
import PageHint from './PageHint'

type NavEntry = { to: string; label: string; Icon: ComponentType<{ size?: number; className?: string }>; end?: boolean }

// Grouped IA. Route `to` paths are unchanged from before — only labels/icons/grouping.
const NAV_GROUPS: Array<{ label?: string; items: NavEntry[] }> = [
  { items: [{ to: '/dashboard', label: 'Home', Icon: Home, end: true }] },
  {
    label: 'Your place',
    items: [
      { to: '/dashboard/qr', label: 'Guest page & QR', Icon: QrCode },
      { to: '/dashboard/branding', label: 'Branding', Icon: Palette },
    ],
  },
  {
    label: 'Guests',
    items: [
      { to: '/dashboard/bookings', label: 'Bookings', Icon: CalendarDays },
      { to: '/dashboard/messages', label: 'Messages', Icon: MessageCircle },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/dashboard/billing', label: 'Billing', Icon: CreditCard },
      { to: '/dashboard/settings', label: 'Settings', Icon: SettingsIcon },
    ],
  },
]

interface HostData {
  brand_name: string | null
  trial_ends_at: string | null
  subscription_status: string | null
  stripe_subscription_id: string | null
  is_demo: boolean | null
  demo_expires_at: string | null
}

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  `group flex items-center gap-[11px] pl-[10px] pr-2.5 py-[7px] rounded-[9px] text-[13px] border-l-[3px] transition-colors ${
    isActive
      ? 'bg-[rgba(200,162,78,0.13)] text-[#f4ecdb] border-[#c8a24e]'
      : 'text-[#b6ad9e] border-transparent hover:bg-white/5'
  }`

export default function Layout() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [host, setHost] = useState<HostData | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [accountOpen, setAccountOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [requestedModuleId, setRequestedModuleId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [dismissedHints, setDismissedHints] = useState<Record<string, boolean>>({})
  const [uiReady, setUiReady] = useState(false)
  const [keepOpen, setKeepOpen] = useState(false)
  // Tier chosen on the expired upgrade wall (drives the modal → Stripe Checkout for that
  // tier); null = active 'keep it' with no plan chosen yet → modal routes to /choose-plan.
  const [selectedTier, setSelectedTier] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const hamburgerRef = useRef<HTMLButtonElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  const accountRef = useRef<HTMLDivElement>(null)
  const guideTriggerRef = useRef<HTMLButtonElement>(null)
  const wasMenuOpen = useRef(false)

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
      setUserId(user.id)
      const { data } = await supabase
        .from('hosts')
        .select('brand_name, trial_ends_at, subscription_status, stripe_subscription_id, is_demo, demo_expires_at, ui_state')
        .eq('id', user.id)
        .maybeSingle()
      if (mounted && data) {
        setHost(data)
        const ui = data.ui_state && typeof data.ui_state === 'object' ? data.ui_state : {}
        const hints = ui.guideHints && typeof ui.guideHints === 'object' ? ui.guideHints : {}
        setDismissedHints(hints as Record<string, boolean>)
      }
      if (mounted) setUiReady(true)
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

  // Mobile-drawer a11y. Everything below is gated on `menuOpen`, which can only be
  // true on mobile (the hamburger trigger is in a md:hidden bar), so the static
  // desktop sidebar is completely unaffected.
  // While open: focus the first nav link, close on Escape, and trap Tab/Shift+Tab
  // inside the drawer so focus can't reach the page behind the backdrop.
  useEffect(() => {
    if (!menuOpen) return
    const aside = asideRef.current
    if (!aside) return
    const SELECTOR = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

    aside.querySelector<HTMLElement>(SELECTOR)?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        return
      }
      if (e.key !== 'Tab') return
      const focusables = Array.from(aside.querySelectorAll<HTMLElement>(SELECTOR))
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === first || !aside.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || !aside.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  // Return focus to the hamburger when the drawer closes — but never steal focus on
  // the initial mount (only on a true→false transition).
  useEffect(() => {
    if (wasMenuOpen.current && !menuOpen) hamburgerRef.current?.focus()
    wasMenuOpen.current = menuOpen
  }, [menuOpen])

  // Close the account popover on outside click (gated on accountOpen).
  useEffect(() => {
    if (!accountOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [accountOpen])

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) {
      await supabase.auth.signOut({ scope: 'local' })
    }
    navigate('/login', { replace: true })
  }

  // ── Guide hints (persisted to hosts.ui_state.guideHints) ───────────────────
  // Read-modify-write so any other ui_state keys are preserved; scoped to the
  // owner's row; updates ONLY the ui_state column; errors are swallowed.
  const persistHints = useCallback(
    async (nextHints: Record<string, boolean>) => {
      if (!userId) return
      try {
        const { data } = await supabase
          .from('hosts')
          .select('ui_state')
          .eq('id', userId)
          .maybeSingle()
        const current = data?.ui_state && typeof data.ui_state === 'object' ? data.ui_state : {}
        await supabase
          .from('hosts')
          .update({ ui_state: { ...current, guideHints: nextHints } })
          .eq('id', userId)
      } catch {
        /* swallow — hint state is best-effort */
      }
    },
    [userId],
  )

  const dismissHint = useCallback(
    (moduleId: string) => {
      const next = { ...dismissedHints, [moduleId]: true }
      setDismissedHints(next)
      void persistHints(next)
    },
    [dismissedHints, persistHints],
  )

  const restoreHint = useCallback(
    (moduleId: string) => {
      const next = { ...dismissedHints }
      delete next[moduleId]
      setDismissedHints(next)
      void persistHints(next)
    },
    [dismissedHints, persistHints],
  )

  const isDismissed = useCallback((moduleId: string) => !!dismissedHints[moduleId], [dismissedHints])

  const openGuide = useCallback((moduleId?: string) => {
    setRequestedModuleId(moduleId ?? null)
    setGuideOpen(true)
    setMenuOpen(false)
  }, [])

  const guideValue = useMemo<GuideContextValue>(
    () => ({ openGuide, isDismissed, dismissHint, restoreHint, uiReady }),
    [openGuide, isDismissed, dismissHint, restoreHint, uiReady],
  )

  // Brass "unseen" dot on a nav item whose page hint isn't dismissed yet.
  // Skips Home and any route with no (or coming-soon) module; gated on uiReady so
  // dots never flash before the dismissed state has loaded.
  const showHintDot = (to: string) => {
    if (!uiReady || to === '/dashboard') return false
    const mod = moduleForPath(to)
    return !!mod && mod.status !== 'coming-soon' && !dismissedHints[mod.id]
  }

  const isDemo = host?.is_demo === true

  // Tick the countdown while in demo mode (no-op for normal hosts).
  useEffect(() => {
    if (!isDemo) return
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [isDemo])

  const trialRemaining = host?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(host.trial_ends_at).getTime() - Date.now()) / 86_400_000))
    : 0
  // Demo hosts carry subscription_status='trial' too — suppress the normal trial widget
  // for them; they get the demo widget instead.
  const showTrial = host?.subscription_status === 'trial' && trialRemaining > 0 && !isDemo
  const hasSub = !!host?.stripe_subscription_id

  // Lapsed demo → the upgrade wall replaces the dashboard. Driven by the client clock
  // (so it appears the instant the demo lapses) OR by the cron-set 'expired' status.
  const demoExpired =
    isDemo && (demoRemaining(host?.demo_expires_at, now).expired || host?.subscription_status === 'expired')

  const closeMenu = () => setMenuOpen(false)

  return (
    <div className="flex min-h-screen bg-[#f0ede6] font-['Inter']">

      {/* Mobile top bar — hidden on md+ */}
      <div className="md:hidden fixed top-0 inset-x-0 h-12 z-30 bg-[#1c1c1a] border-b border-[#322c25] flex items-center px-3 gap-2.5">
        <button
          ref={hamburgerRef}
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls="sidebar-nav"
          className="p-1.5 text-[#b6ad9e] hover:text-[#f0ede6] transition-colors"
        >
          <Menu size={18} />
        </button>
        <Logo size={22} />
        <span className="text-[13px] font-semibold text-[#e9e3d7] truncate">
          {host?.brand_name ?? 'Arrivly'}
        </span>
      </div>

      {/* Backdrop — closes drawer on tap */}
      {menuOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          onClick={closeMenu}
        />
      )}

      {/* Sidebar — off-canvas on mobile, static on desktop */}
      <aside
        id="sidebar-nav"
        ref={asideRef}
        role={menuOpen ? 'dialog' : undefined}
        aria-modal={menuOpen ? true : undefined}
        aria-label={menuOpen ? 'Dashboard menu' : undefined}
        className={`
        fixed inset-y-0 left-0 z-50 w-[212px] shrink-0
        bg-[#1c1c1a] border-r border-[#322c25] p-3.5
        flex flex-col
        transform transition-transform duration-200
        ${menuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:sticky md:top-0 md:h-screen md:self-start md:translate-x-0 md:z-auto
      `}>
        {/* Brand */}
        <div className="mb-4 px-1">
          <Logo size={28} withWordmark wordmarkClassName="font-['Fraunces'] text-[17px] text-[#f0ede6]" />
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-2 flex-1 overflow-y-auto">
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.label ?? `g${gi}`} className="flex flex-col gap-0.5">
              {group.label && (
                <div className="px-[10px] pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-[.12em] text-[#7d7466]">
                  {group.label}
                </div>
              )}
              {group.items
                .filter((it) => !(isDemo && it.to === '/dashboard/billing'))
                .map(({ to, label, Icon, end }) => (
                <NavLink key={to} to={to} end={end} onClick={closeMenu} className={navItemClass}>
                  {({ isActive }) => (
                    <>
                      <Icon size={16} className={isActive ? 'text-[#c8a24e]' : 'text-[#9a9082]'} />
                      <span className="flex-1 truncate">{label}</span>
                      {showHintDot(to) && (
                        <span
                          aria-hidden="true"
                          title="New page tips"
                          className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#c8a24e]"
                        />
                      )}
                      {to === '/dashboard/messages' && unread > 0 && (
                        <span className="bg-[#c8a24e] text-[#16100d] text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                          {unread}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}

          {email === ARRIVLY_CONFIG.adminEmail && (
            <div className="flex flex-col gap-0.5">
              <div className="px-[10px] pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-[.12em] text-[#7d7466]">
                Admin
              </div>
              <NavLink to="/admin" onClick={closeMenu} className={navItemClass}>
                {({ isActive }) => (
                  <>
                    <ShieldCheck size={16} className={isActive ? 'text-[#c8a24e]' : 'text-[#9a9082]'} />
                    <span className="flex-1 truncate">Admin</span>
                  </>
                )}
              </NavLink>
            </div>
          )}

          {/* Guide & help — a toggle (NOT a NavLink): opens the docked Guide drawer
              without navigating, so the current page's nav item stays highlighted. */}
          <div className="mt-1.5 pt-1.5 border-t border-[#322c25]">
            <button
              ref={guideTriggerRef}
              onClick={() => {
                setRequestedModuleId(null)
                setGuideOpen((o) => !o)
                setMenuOpen(false)
              }}
              aria-haspopup="dialog"
              aria-expanded={guideOpen}
              className={`group flex items-center gap-[11px] pl-[10px] pr-2.5 py-[7px] rounded-[9px] text-[13px] border-l-[3px] w-full text-left transition-colors ${
                guideOpen
                  ? 'bg-[rgba(200,162,78,0.13)] text-[#f4ecdb] border-[#c8a24e]'
                  : 'text-[#b6ad9e] border-transparent hover:bg-white/5'
              }`}
            >
              <BookOpen size={16} className={guideOpen ? 'text-[#c8a24e]' : 'text-[#9a9082]'} />
              <span className="flex-1 truncate">Guide &amp; help</span>
            </button>
          </div>
        </nav>

        {/* Trial widget + account menu */}
        <div className="mt-auto pt-3.5 flex flex-col gap-2.5">
          {isDemo && (() => {
            const { expired, label } = demoRemaining(host?.demo_expires_at, now)
            return (
              <div className="rounded-[12px] p-[13px] bg-[rgba(200,162,78,0.10)] border border-[rgba(200,162,78,0.22)]">
                <div className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#e7d6ad]">Live demo</div>
                <div className="text-[18px] font-['Fraunces'] font-light text-[#f0ede6] leading-tight mt-1">
                  {expired ? 'Demo ended' : label}
                </div>
                <div className="text-[10.5px] text-[#8a8175] mt-0.5 mb-2.5">
                  {expired ? 'Start a trial to keep your page' : 'Everything you build is saved'}
                </div>
                <button
                  onClick={() => { setSelectedTier(null); setKeepOpen(true); closeMenu() }}
                  className="block w-full text-center py-2 rounded-[8px] text-[11px] font-semibold bg-[#c8a24e] text-[#16100d] hover:bg-[#e7d6ad] transition-colors"
                >
                  Start free trial
                </button>
              </div>
            )
          })()}

          {showTrial && (
            <div className="rounded-[12px] p-[13px] bg-[rgba(200,162,78,0.10)] border border-[rgba(200,162,78,0.22)]">
              <div className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#e7d6ad]">Free trial</div>
              <div className="text-[26px] font-['Fraunces'] font-light text-[#f0ede6] leading-none mt-1">
                {trialRemaining}
              </div>
              <div className="text-[10.5px] text-[#8a8175] mt-0.5 mb-2.5">days remaining</div>
              <NavLink
                to="/dashboard/billing"
                onClick={closeMenu}
                className="block text-center py-2 rounded-[8px] text-[11px] font-semibold bg-[#c8a24e] text-[#16100d] hover:bg-[#e7d6ad] transition-colors"
              >
                {hasSub ? 'Manage plan' : 'Add card'}
              </NavLink>
            </div>
          )}

          {/* Account row + upward popover */}
          <div
            ref={accountRef}
            className="relative"
            onKeyDown={(e) => {
              if (e.key === 'Escape' && accountOpen) {
                setAccountOpen(false)
                e.stopPropagation()
              }
            }}
          >
            {accountOpen && (
              <div
                role="menu"
                className="absolute left-0 right-0 bottom-[calc(100%+8px)] bg-[#211f1c] border border-[#3a342c] rounded-[13px] p-1.5 shadow-[0_14px_40px_rgba(0,0,0,0.5)]"
              >
                <button
                  role="menuitem"
                  onClick={() => { signOut() }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[9px] text-[13px] text-[#d98a7a] hover:bg-[rgba(217,138,122,0.12)] transition-colors"
                >
                  <LogOut size={16} className="text-[#d98a7a]" />
                  <span>Sign out</span>
                </button>
              </div>
            )}

            <button
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((o) => !o)}
              className="flex items-center gap-2.5 p-2 rounded-[11px] w-full text-left border border-transparent bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] hover:border-[#322c25] transition-colors"
            >
              <div className="shrink-0 w-[30px] h-[30px] rounded-[9px] bg-gradient-to-br from-[#e7d6ad] to-[#c8a24e] text-[#16100d] font-['Fraunces'] text-[14px] flex items-center justify-center">
                {(host?.brand_name?.trim()?.[0] ?? email?.[0] ?? 'A').toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-[#e9e3d7] truncate">
                  {host?.brand_name ?? 'Arrivly'}
                </div>
                <div className="text-[10px] text-[#8a8175] truncate">{email}</div>
              </div>
              <ChevronUp
                size={15}
                className={`shrink-0 text-[#8a8175] transition-transform ${accountOpen ? 'rotate-180' : ''}`}
              />
            </button>
          </div>
        </div>
      </aside>

      {/* Main — pt-16 clears the fixed mobile top bar; md restores normal padding */}
      <main className="flex-1 px-4 pb-8 pt-16 md:px-8 md:pt-8 overflow-auto min-w-0">
        <GuideContext.Provider value={guideValue}>
          {demoExpired ? (
            <UpgradeWall
              onKeep={(tier) => { setSelectedTier(tier >= 1 ? tier : null); setKeepOpen(true) }}
              onSignOut={signOut}
            />
          ) : (
            <>
              <PageHint />
              <Outlet />
            </>
          )}
        </GuideContext.Provider>
      </main>

      <GuideDrawer
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        triggerRef={guideTriggerRef}
        requestedModuleId={requestedModuleId}
      />

      <KeepDemoModal open={keepOpen} onClose={() => { setKeepOpen(false); setSelectedTier(null) }} tier={selectedTier} />
    </div>
  )
}
