import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  QrIcon,
  PinIcon,
  SparkleIcon,
  HandIcon,
  CityMapIcon,
  ChatIcon,
  KeyIcon,
  WifiIcon,
  TicketIcon,
  ArrowRightIcon,
} from './landing-icons'

/**
 * Arrivly marketing landing page.
 * Dark-charcoal, brass-accented. Fonts (Fraunces display / Inter body) are loaded
 * in index.html and SCOPED to this tree via the root wrapper's font-family — the
 * dashboard's Georgia/system stack is untouched.
 *
 * Dynamic pricing (trial length + from-price) is fetched from /api/public-pricing on
 * mount with DB-matching safe defaults so there is no flash. The two €-figures in the
 * marketplace callouts are ILLUSTRATIVE EXAMPLES — hardcoded, not product pricing.
 */

// ── palette (kept inline as arbitrary Tailwind values; documented here for reference)
// ink #16100d · charcoal #1c1c1a · raised #23211d · border #2c2925
// cream #f0ede6 · cream-2 #f6f3ec · cream-line #ddd8ce
// brass #c8a24e · brass-deep #a8842f · brass-soft #e7d6ad

type Pricing = { trialDays: number; fromPriceEuros: number; currency: string }
const DEFAULT_PRICING: Pricing = { trialDays: 14, fromPriceEuros: 10, currency: 'eur' }

// Public demo entry — only live when the flag is exactly 'true'. Otherwise the
// "See a live demo" button keeps its current inert behaviour.
const DEMO_ENABLED = import.meta.env.VITE_DEMO_ENABLED === 'true'

// Scroll-reveal wrapper: fades + lifts children into view once. Respects
// prefers-reduced-motion (shows immediately, no animation) and is SSR-safe
// (window only touched inside the client-only effect).
function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            setShown(true)
            io.disconnect()
          }
        })
      },
      { threshold: 0.12 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      style={shown ? { transitionDelay: `${delay}ms` } : undefined}
      className={`transition-all duration-700 ease-out motion-reduce:transition-none ${
        shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'
      } ${className}`}
    >
      {children}
    </div>
  )
}

const FEATURES = [
  {
    Icon: HandIcon,
    title: 'A welcome with their name',
    desc: 'Guests land on a page that greets them by name, with your branding, their dates, and a warm note for the city.',
  },
  {
    Icon: CityMapIcon,
    title: 'A live neighbourhood guide',
    desc: 'Curated places generated for your exact street — cafés, food, sights — for any city in the world. It refreshes itself.',
  },
  {
    Icon: TicketIcon,
    title: "What's on this week",
    desc: 'A live list of events, markets and shows happening near the apartment during their stay. No effort from you.',
  },
  {
    Icon: SparkleIcon,
    title: 'An AI concierge chatbot',
    desc: 'Answers guest questions 24/7 — WiFi, check-out time, the nearest pharmacy — grounded in your apartment details.',
  },
  {
    Icon: ChatIcon,
    title: 'Message your guests directly',
    desc: 'A private thread between you and each guest, right on their page. Push notifications keep you both in the loop.',
  },
  {
    Icon: KeyIcon,
    title: 'Private check-in details',
    desc: 'Door codes and entry steps revealed only to a verified guest during their stay — never to the public web.',
  },
  {
    Icon: WifiIcon,
    title: 'One-tap WiFi',
    desc: 'Network and password parsed into a single tap-to-connect card. The first thing every guest looks for.',
  },
  {
    Icon: PinIcon,
    title: 'An experiences marketplace',
    desc: 'Tours, tables and tickets your guests can book — turning your guide into a revenue stream (rolling out by tier).',
  },
]

const FAQS = [
  {
    q: 'Do my guests need to download an app?',
    a: 'No. Arrivly opens in any browser straight from the QR code — nothing to install, no app store. Guests can optionally add it to their home screen for one-tap access and push messages, but that is entirely their choice.',
  },
  {
    q: 'Does it work with Airbnb, Vrbo and Booking.com?',
    a: 'Yes. Paste in your calendar links and bookings sync automatically, whichever platform a guest booked through — or add direct bookings yourself. One QR code covers them all.',
  },
  {
    q: 'How does the AI city guide work?',
    a: 'We generate a guide for the apartment’s exact street — cafés, restaurants, sights and practical spots — for any city in the world, and refresh it over time. Your own host picks sit alongside it.',
  },
  {
    q: 'How does the revenue share work?',
    a: 'When a guest books an experience through the marketplace, you earn a share — the guest books directly with the provider, so you are never the middleman and hold no inventory. The figures shown are illustrative; the actual share varies by provider and tier.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Start with a free trial — no card needed to begin — and cancel whenever you like from your dashboard. No lock-in.',
  },
]

const STEPS = [
  {
    Icon: QrIcon,
    n: '01',
    title: 'Print one QR code',
    desc: 'Generate it once and place it in the apartment. The link never changes, so you never reprint it.',
  },
  {
    Icon: PinIcon,
    n: '02',
    title: 'Guests scan on arrival',
    desc: 'They land on a page branded to you, personalised with their name and stay dates — no login, no friction.',
  },
  {
    Icon: SparkleIcon,
    n: '03',
    title: 'They get everything',
    desc: 'WiFi, check-in, house rules, a live city guide, what’s-on this week, and a 24/7 concierge chatbot.',
  },
]

const TRUST = ['Airbnb', 'Vrbo', 'Booking.com', 'Direct']

// Example guest-page accent for the marketing phone. The real guest page renders in the
// HOST's own accent; this is fixed terracotta marketing chrome — change it here only.
const EXAMPLE_ACCENT = '#a8542e'
const PHONE_MS = 3400

// Two tiny nav glyphs the shared landing-icons set doesn't cover (home, gear). Decorative,
// stroke = currentColor so they inherit the nav item's colour. No new imports.
function HomeGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M4 11.5 12 5l8 6.5" />
      <path d="M6 10.5V19h12v-8.5" />
    </svg>
  )
}
function GearGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2M12 18.5v2M4.6 7.5l1.7 1M17.7 15.5l1.7 1M4.6 16.5l1.7-1M17.7 8.5l1.7-1" />
    </svg>
  )
}

// ── The phone mockup: an auto-cycling, presentational recreation of the real guest page
// (Home → Explore → Chat → Settings). Decorative + aria-hidden; not wired to any data.
function PhoneMockup() {
  const [index, setIndex] = useState(0)
  // Bumping restartKey tears down + rebuilds the interval, giving a manually-picked screen
  // a full dwell. pausedRef lets hover pause without re-running the effect.
  const [restartKey, setRestartKey] = useState(0)
  const pausedRef = useRef(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return // stay on Home
    const id = setInterval(() => {
      if (!pausedRef.current) setIndex(i => (i + 1) % 4)
    }, PHONE_MS)
    return () => clearInterval(id)
  }, [restartKey])

  const goTo = (i: number) => { setIndex(i); setRestartKey(k => k + 1) }

  // Bottom nav in the real on-screen order (Home, Chat, Explore, Settings); each maps to its
  // screen index (Home=0, Explore=1, Chat=2, Settings=3).
  const nav = [
    { label: 'Home', idx: 0, Icon: HomeGlyph },
    { label: 'Chat', idx: 2, Icon: ChatIcon },
    { label: 'Explore', idx: 1, Icon: PinIcon },
    { label: 'Settings', idx: 3, Icon: GearGlyph },
  ]

  // Screens, ordered by index: 0 Home, 1 Explore, 2 Chat, 3 Settings.
  const screens = [
    // 0 — HOME
    <div key="home" className="h-full overflow-hidden">
      <div className="relative h-[150px]">
        <img src="/landing/sagrada.jpg" alt="" className="h-full w-full object-cover" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#120e0b]/85 via-[#120e0b]/25 to-transparent" />
        <div className="absolute inset-x-3.5 bottom-2.5 text-white">
          <div className="text-[8px] uppercase tracking-[.18em] text-white/75">Barcelona, Spain</div>
          <div className="font-['Fraunces'] text-[19px] font-light leading-tight">Welcome to El Born.</div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-semibold text-white" style={{ background: EXAMPLE_ACCENT }}>M</span>
            <span className="font-['Fraunces'] text-[10px] italic text-white/85">— Casa Marco</span>
          </div>
        </div>
      </div>
      <div className="space-y-2 px-3.5 pb-[56px] pt-2.5">
        <div className="font-['Fraunces'] text-[13px] text-[#1c1c1a]">Dear Marco,</div>
        <p className="text-[10px] leading-snug text-[#36322c]">
          Good evening. El Born is all winding medieval lanes, design shops and vermut bars — and you&apos;re right in the middle of it.
        </p>
        <div className="overflow-hidden rounded-[10px] border border-[#e9e4d9] bg-[#fffdf9]">
          <div className="h-[3px]" style={{ background: EXAMPLE_ACCENT }} />
          <div className="p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[8px] font-semibold uppercase tracking-[.14em]" style={{ color: EXAMPLE_ACCENT }}>Right now · Evening</span>
              <span className="shrink-0 rounded-full border border-[#e9e4d9] bg-[#fbfaf7] px-1.5 py-0.5 text-[8px] text-[#9a958c]">18°C · Clear</span>
            </div>
            <p className="mt-1 text-[10px] leading-snug text-[#36322c]">Bar Cañete pours the best vermut at this hour — go before eight to get a stool.</p>
          </div>
        </div>
        <div className="overflow-hidden rounded-[10px] border border-[#e9e4d9] bg-[#fffdf9]">
          <div className="h-[3px]" style={{ background: EXAMPLE_ACCENT }} />
          <div className="flex items-center gap-2 px-2.5 py-2">
            <WifiIcon className="h-3.5 w-3.5" style={{ color: EXAMPLE_ACCENT }} />
            <div className="min-w-0">
              <div className="text-[8px] uppercase tracking-wide text-[#9a958c]">WiFi · tap to copy</div>
              <div className="truncate text-[10px] font-medium text-[#1c1c1a]">CasaMarco_5G</div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    // 1 — EXPLORE
    <div key="explore" className="h-full overflow-hidden px-3.5 pb-[56px] pt-3.5">
      <div className="text-[8px] uppercase tracking-[.18em]" style={{ color: EXAMPLE_ACCENT }}>Explore</div>
      <div className="font-['Fraunces'] text-[17px] font-light text-[#1c1c1a]">Around you</div>
      <div className="mt-2.5 flex items-center justify-center gap-1.5 rounded-[9px] px-3 py-2 text-white" style={{ background: EXAMPLE_ACCENT }}>
        <PinIcon className="h-3 w-3" />
        <span className="text-[10px] font-semibold">Take me home — walking directions</span>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {['Food', 'Coffee', 'Sights', 'Bars'].map((p, i) => (
          <span
            key={p}
            className="rounded-full border px-2 py-0.5 text-[9px]"
            style={i === 0
              ? { background: EXAMPLE_ACCENT + '1f', borderColor: EXAMPLE_ACCENT + '55', color: EXAMPLE_ACCENT }
              : { borderColor: '#e9e4d9', color: '#9a958c' }}
          >
            {p}
          </span>
        ))}
      </div>
      <div className="mt-2.5 space-y-2">
        {[
          { tag: 'Host pick · Dinner', name: 'Bar Cañete', meta: '3 min walk' },
          { tag: 'Guide · Sight', name: 'Basílica de Santa Maria', meta: '4 min walk' },
        ].map(c => (
          <div key={c.name} className="rounded-[10px] border border-[#e9e4d9] bg-[#fffdf9] p-2.5">
            <div className="flex items-center gap-1.5">
              <PinIcon className="h-3 w-3" style={{ color: EXAMPLE_ACCENT }} />
              <span className="text-[8px] uppercase tracking-wide text-[#9a958c]">{c.tag}</span>
            </div>
            <div className="mt-0.5 font-['Fraunces'] text-[12px] text-[#1c1c1a]">{c.name}</div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[9px] text-[#9a958c]">{c.meta}</span>
              <span className="flex items-center gap-1 text-[9px] font-semibold" style={{ color: EXAMPLE_ACCENT }}>
                Navigate <ArrowRightIcon className="h-2.5 w-2.5" />
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-center text-[7.5px] text-[#9a958c]">© OpenStreetMap · Geocoding by LocationIQ</div>
    </div>,
    // 2 — CHAT
    <div key="chat" className="flex h-full flex-col px-3.5 pb-[56px] pt-3.5">
      <div className="text-[8px] uppercase tracking-[.18em]" style={{ color: EXAMPLE_ACCENT }}>Assistant</div>
      <div className="font-['Fraunces'] text-[17px] font-light text-[#1c1c1a]">Ask anything</div>
      <div className="mt-2.5 flex-1 space-y-2 overflow-hidden">
        <div className="ml-auto max-w-[78%] rounded-[12px] rounded-br-sm px-2.5 py-1.5 text-[10px] leading-snug text-white" style={{ background: EXAMPLE_ACCENT }}>What&apos;s the door code?</div>
        <div className="mr-auto max-w-[82%] rounded-[12px] rounded-bl-sm border border-[#e9e4d9] bg-[#fffdf9] px-2.5 py-1.5 text-[10px] leading-snug text-[#36322c]">It&apos;s 4-7-2-9 # on the keypad — you&apos;re on the 2nd floor, door on the right.</div>
        <div className="ml-auto max-w-[78%] rounded-[12px] rounded-br-sm px-2.5 py-1.5 text-[10px] leading-snug text-white" style={{ background: EXAMPLE_ACCENT }}>Late-night food near here?</div>
        <div className="mr-auto max-w-[82%] rounded-[12px] rounded-bl-sm border border-[#e9e4d9] bg-[#fffdf9] px-2.5 py-1.5 text-[10px] leading-snug text-[#36322c]">El Xampanyet does pintxos till midnight, two minutes away on Carrer de Montcada.</div>
      </div>
      <div className="mt-2 flex items-center justify-between rounded-full border border-[#e9e4d9] bg-[#fffdf9] px-3 py-1.5">
        <span className="text-[10px] text-[#9a958c]">Message…</span>
        <span className="text-[11px]" style={{ color: EXAMPLE_ACCENT }}>➤</span>
      </div>
    </div>,
    // 3 — SETTINGS
    <div key="settings" className="h-full overflow-hidden px-3.5 pb-[56px] pt-3.5">
      <div className="text-[8px] uppercase tracking-[.18em]" style={{ color: EXAMPLE_ACCENT }}>Settings</div>
      <div className="font-['Fraunces'] text-[17px] font-light text-[#1c1c1a]">Your stay</div>
      <div className="mt-2.5 space-y-2">
        <div className="overflow-hidden rounded-[10px] border border-[#e9e4d9] bg-[#fffdf9]">
          <div className="h-[3px]" style={{ background: EXAMPLE_ACCENT }} />
          <div className="p-2.5">
            <div className="text-[11px] font-semibold text-[#1c1c1a]">Add to Home Screen</div>
            <div className="mt-0.5 text-[9px] leading-snug text-[#9a958c]">One tap — open it like an app, no install.</div>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-[10px] border border-[#e9e4d9] bg-[#fffdf9] p-2.5">
          <div>
            <div className="text-[11px] font-semibold text-[#1c1c1a]">Notifications</div>
            <div className="text-[9px] text-[#9a958c]">Replies from your host</div>
          </div>
          <span className="flex h-4 w-7 items-center rounded-full p-0.5" style={{ background: EXAMPLE_ACCENT }}>
            <span className="ml-auto h-3 w-3 rounded-full bg-white" />
          </span>
        </div>
        <div className="flex items-center justify-between rounded-[10px] border border-[#e9e4d9] bg-[#fffdf9] px-2.5 py-2 text-[11px] font-medium text-[#1c1c1a]">
          Save this page <span style={{ color: EXAMPLE_ACCENT }}>↗</span>
        </div>
        <div className="flex items-center justify-between rounded-[10px] border border-[#e9e4d9] bg-[#fffdf9] px-2.5 py-2 text-[11px] font-medium text-[#1c1c1a]">
          Message the host <ArrowRightIcon className="h-3 w-3" style={{ color: EXAMPLE_ACCENT }} />
        </div>
      </div>
    </div>,
  ]

  return (
    // Decorative illustration — hidden from the a11y tree (rotating text isn't announced);
    // all inner controls are tabIndex=-1 so the aria-hidden subtree has no focusable elements.
    <div aria-hidden className="relative mx-auto w-[270px] shrink-0">
      {/* device frame */}
      <div
        className="relative rounded-[40px] bg-[#16100d] p-[10px] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.55)] ring-1 ring-white/5"
        onMouseEnter={() => { pausedRef.current = true }}
        onMouseLeave={() => { pausedRef.current = false }}
      >
        <div className="relative h-[440px] overflow-hidden rounded-[31px] bg-[#fbfaf7]">
          {/* crossfading screens */}
          {screens.map((screen, i) => (
            <div
              key={i}
              className={`absolute inset-0 motion-safe:transition-opacity motion-safe:duration-700 ${i === index ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
            >
              {screen}
            </div>
          ))}

          {/* persistent frosted bottom nav */}
          <div className="absolute inset-x-2.5 bottom-2.5 flex items-stretch justify-around rounded-2xl border border-[#e9e4d9] bg-[#fbfaf7]/85 py-1.5 backdrop-blur">
            {nav.map(item => {
              const active = index === item.idx
              return (
                <button
                  key={item.label}
                  type="button"
                  tabIndex={-1}
                  onClick={() => goTo(item.idx)}
                  className="flex flex-1 flex-col items-center gap-0.5"
                  style={{ color: active ? EXAMPLE_ACCENT : '#9a958c' }}
                >
                  <item.Icon className="h-3.5 w-3.5" />
                  <span className="text-[7px] uppercase tracking-wide">{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* dot pager (brass on the dark marketing chrome) */}
      <div className="mt-4 flex items-center justify-center gap-1.5">
        {[0, 1, 2, 3].map(i => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            onClick={() => goTo(i)}
            className="h-1.5 rounded-full transition-all"
            style={i === index ? { width: 16, background: '#c8a24e' } : { width: 6, background: '#c8a24e55' }}
          />
        ))}
      </div>

      {/* lift-out callout — booked a table (illustrative example earning) */}
      <div className="absolute -right-5 top-[42%] w-[150px] rounded-[12px] border border-[#2c2925] bg-[#23211d] p-3 shadow-2xl sm:-right-8">
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[#c8a24e] opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#c8a24e]" />
          </span>
          <span className="text-[9px] uppercase tracking-wide text-white/50">Booked a table</span>
        </div>
        <div className="mt-1 font-['Fraunces'] text-[20px] font-light text-[#e7d6ad]">+€6.40</div>
        <div className="text-[8px] leading-tight text-white/35">example earning</div>
      </div>

      {/* lift-out callout — experience booked (illustrative; share varies) */}
      <div className="absolute -left-4 bottom-[14%] w-[160px] rounded-[12px] border border-[#2c2925] bg-[#23211d] p-3 shadow-2xl sm:-left-10">
        <div className="text-[9px] uppercase tracking-wide text-white/50">Sailing trip booked</div>
        <div className="mt-1 font-['Fraunces'] text-[20px] font-light text-[#e7d6ad]">+€18.60</div>
        <div className="text-[8px] leading-tight text-white/35">illustrative — actual share varies by provider</div>
      </div>
    </div>
  )
}

export default function Landing() {
  const [pricing, setPricing] = useState<Pricing>(DEFAULT_PRICING)

  useEffect(() => {
    let alive = true
    fetch('/api/public-pricing')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (alive && data && typeof data.trialDays === 'number' && typeof data.fromPriceEuros === 'number') {
          setPricing({
            trialDays: data.trialDays,
            fromPriceEuros: data.fromPriceEuros,
            currency: typeof data.currency === 'string' ? data.currency : 'eur',
          })
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const startLabel = `Start free — ${pricing.trialDays} days`

  return (
    // Root wrapper SCOPES Inter to the landing only; headings opt into Fraunces.
    <div className="min-h-screen bg-[#1c1c1a] font-['Inter'] text-[#f0ede6] antialiased [text-rendering:optimizeLegibility]">
      {/* ─────────────────────────── Sticky nav ─────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-[#2c2925] bg-[#1c1c1a]/90 backdrop-blur supports-[backdrop-filter]:bg-[#1c1c1a]/75">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-8">
          <a href="#top" className="font-['Fraunces'] text-[19px] font-medium tracking-tight text-[#f0ede6]">
            Arrivly
          </a>
          <div className="hidden items-center gap-7 md:flex">
            <a href="#how" className="text-[13px] text-[#f0ede6]/60 transition-colors hover:text-[#f0ede6]">How it works</a>
            <a href="#revenue" className="text-[13px] text-[#f0ede6]/60 transition-colors hover:text-[#f0ede6]">Revenue</a>
            <a href="#features" className="text-[13px] text-[#f0ede6]/60 transition-colors hover:text-[#f0ede6]">Features</a>
            <a href="#pricing" className="text-[13px] text-[#f0ede6]/60 transition-colors hover:text-[#f0ede6]">Pricing</a>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="rounded-lg px-3 py-2 text-[13px] text-[#f0ede6]/70 transition-colors hover:text-[#f0ede6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]"
            >
              Log in
            </Link>
            <Link
              to="/signup"
              className="rounded-lg bg-[#c8a24e] px-4 py-2 text-[13px] font-semibold text-[#16100d] transition-colors hover:bg-[#e7d6ad] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e7d6ad] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1c1c1a]"
            >
              Start free
            </Link>
          </div>
        </nav>
      </header>

      {/* ─────────────────────────── Hero ─────────────────────────── */}
      <section id="top" className="relative overflow-hidden bg-[#1c1c1a]">
        {/* warm brass glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 right-0 h-[520px] w-[520px] rounded-full bg-[#a8842f]/20 blur-[120px]"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 md:grid-cols-2 md:gap-8 md:py-24">
          <div className="text-center md:text-left">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#2c2925] bg-[#23211d] px-3 py-1 text-[11px] text-[#e7d6ad]">
              <SparkleIcon className="h-3 w-3 text-[#c8a24e]" />
              For short-term rental hosts
            </div>
            <h1 className="font-['Fraunces'] text-[40px] font-light leading-[1.05] tracking-tight text-[#f0ede6] sm:text-[52px]">
              Your guest concierge page.
              <br />
              <span className="italic text-[#c8a24e]">Your new revenue stream.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-[480px] text-[15px] leading-[1.7] text-[#f0ede6]/60 md:mx-0">
              One QR code in the apartment. Your guest scans it and gets WiFi, check-in, a live
              city guide, events and a 24/7 chatbot — branded to you. Then they book experiences,
              and you earn.
            </p>
            <p className="mx-auto mt-5 max-w-[480px] font-['Fraunces'] italic text-[17px] leading-snug text-[#e7d6ad] md:mx-0">
              Made by hosts, for hosts who care about their guests.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 md:justify-start">
              <Link
                to="/signup"
                className="group inline-flex items-center gap-2 rounded-xl bg-[#c8a24e] px-6 py-3.5 text-[15px] font-semibold text-[#16100d] transition-colors hover:bg-[#e7d6ad] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e7d6ad] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1c1c1a]"
              >
                {startLabel}
                <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              {/* "See a live demo" → /demo when the flag is on; inert otherwise. */}
              {DEMO_ENABLED ? (
                <Link
                  to="/demo"
                  className="rounded-xl border border-[#2c2925] bg-[#23211d] px-6 py-3.5 text-[15px] text-[#f0ede6]/80 transition-colors hover:border-[#c8a24e]/40 hover:text-[#f0ede6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]"
                >
                  See a live demo
                </Link>
              ) : (
                <button
                  type="button"
                  aria-disabled="true"
                  title="Live demo coming soon"
                  className="rounded-xl border border-[#2c2925] bg-[#23211d] px-6 py-3.5 text-[15px] text-[#f0ede6]/80 transition-colors hover:border-[#c8a24e]/40 hover:text-[#f0ede6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]"
                >
                  See a live demo
                </button>
              )}
            </div>
            <div className="mt-4 text-[12px] text-[#f0ede6]/35">
              {pricing.trialDays}-day free trial · No card needed to start · Cancel anytime
            </div>
          </div>

          <div className="flex justify-center pt-6 md:pt-0">
            <PhoneMockup />
          </div>
        </div>
      </section>

      {/* ─────────────────────────── Trust strip ─────────────────────────── */}
      <section className="border-y border-[#2c2925] bg-[#16100d]">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-5 py-7 sm:px-8 md:flex-row md:justify-between">
          <span className="text-[12px] uppercase tracking-[.16em] text-[#f0ede6]/35">
            Works with the booking sites you already use
          </span>
          <div className="flex flex-wrap items-center justify-center gap-x-9 gap-y-3">
            {TRUST.map(name => (
              <span key={name} className="font-['Fraunces'] text-[17px] font-medium text-[#f0ede6]/55">
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────── How it works ─────────────────────────── */}
      <section id="how" className="bg-[#1c1c1a] py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <div className="text-[12px] uppercase tracking-[.16em] text-[#c8a24e]">How it works</div>
            <h2 className="mt-3 font-['Fraunces'] text-[32px] font-light leading-tight text-[#f0ede6] sm:text-[40px]">
              Set it up once. It runs itself.
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 90}>
                <div className="h-full rounded-2xl border border-[#2c2925] bg-[#23211d] p-7">
                  <div className="flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#2c2925] bg-[#16100d] text-[#c8a24e]">
                      <s.Icon className="h-5 w-5" />
                    </div>
                    <span className="font-['Fraunces'] text-[20px] font-light text-[#f0ede6]/20">{s.n}</span>
                  </div>
                  <h3 className="mt-5 font-['Fraunces'] text-[20px] font-normal text-[#f0ede6]">{s.title}</h3>
                  <p className="mt-2 text-[14px] leading-[1.7] text-[#f0ede6]/55">{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────── Revenue / marketplace (cream) ─────────────────────────── */}
      <section id="revenue" className="bg-[#f0ede6] py-20 text-[#1c1c1a] sm:py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 sm:px-8 md:grid-cols-2">
          <Reveal>
            <div className="text-[12px] uppercase tracking-[.16em] text-[#a8842f]">The marketplace</div>
            <h2 className="mt-3 font-['Fraunces'] text-[32px] font-light leading-tight text-[#1c1c1a] sm:text-[40px]">
              Your guide becomes a revenue stream.
            </h2>
            <p className="mt-5 max-w-[460px] text-[15px] leading-[1.7] text-[#1c1c1a]/65">
              Guests already book tours, tables and tickets during their stay. With Arrivly they
              book them from your page — and a share comes back to you.
            </p>
            <ul className="mt-8 space-y-5">
              {[
                {
                  t: 'Earn on the whole catalogue',
                  d: 'Tours, restaurant tables, attraction tickets, transfers — every bookable experience a guest taps can earn.',
                },
                {
                  t: 'When a pick is bookable',
                  d: 'Your editorial recommendations turn reservable in a single tap, without the guest ever leaving the page.',
                },
                {
                  t: 'Never the middleman',
                  d: 'Guests book directly with the provider. You hold no inventory and carry no support burden — you simply earn a share.',
                },
              ].map(p => (
                <li key={p.t} className="flex gap-3.5">
                  <span className="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#c8a24e] text-[#16100d]">
                    <ArrowRightIcon className="h-3 w-3" />
                  </span>
                  <div>
                    <div className="font-['Fraunces'] text-[16px] text-[#1c1c1a]">{p.t}</div>
                    <div className="mt-0.5 text-[13.5px] leading-[1.6] text-[#1c1c1a]/60">{p.d}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={120}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="overflow-hidden rounded-2xl border border-[#ddd8ce] bg-white shadow-sm">
                <img src="/landing/restaurant.jpg" alt="A restaurant table set for dinner" className="h-32 w-full object-cover" loading="lazy" />
                <div className="p-4">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[#a8842f]">
                    <TicketIcon className="h-3.5 w-3.5" /> Table booked
                  </div>
                  <div className="mt-1 font-['Fraunces'] text-[24px] font-light text-[#1c1c1a]">+€6.40</div>
                  <div className="text-[11px] text-[#1c1c1a]/45">example earning</div>
                </div>
              </div>
              <div className="overflow-hidden rounded-2xl border border-[#ddd8ce] bg-white shadow-sm sm:mt-8">
                <img src="/landing/sailing.jpg" alt="A sailing trip on the water" className="h-32 w-full object-cover" loading="lazy" />
                <div className="p-4">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[#a8842f]">
                    <TicketIcon className="h-3.5 w-3.5" /> Experience booked
                  </div>
                  <div className="mt-1 font-['Fraunces'] text-[24px] font-light text-[#1c1c1a]">+€18.60</div>
                  <div className="text-[11px] leading-tight text-[#1c1c1a]/45">illustrative — actual share varies by provider</div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─────────────────────────── Feature grid ─────────────────────────── */}
      <section id="features" className="bg-[#1c1c1a] py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <div className="text-[12px] uppercase tracking-[.16em] text-[#c8a24e]">Everything on one page</div>
            <h2 className="mt-3 font-['Fraunces'] text-[32px] font-light leading-tight text-[#f0ede6] sm:text-[40px]">
              One link does the work of a welcome book, a concierge and a guidebook.
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 4) * 70}>
                <div className="group h-full rounded-2xl border border-[#2c2925] bg-[#23211d] p-6 transition-colors hover:border-[#c8a24e]/35">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#2c2925] bg-[#16100d] text-[#c8a24e]">
                    <f.Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 font-['Fraunces'] text-[17px] font-normal text-[#f0ede6]">{f.title}</h3>
                  <p className="mt-2 text-[13px] leading-[1.65] text-[#f0ede6]/55">{f.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────── Pricing teaser ─────────────────────────── */}
      <section id="pricing" className="bg-[#16100d] py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <div className="text-[12px] uppercase tracking-[.16em] text-[#c8a24e]">Pricing</div>
            <h2 className="mt-3 font-['Fraunces'] text-[32px] font-light leading-tight text-[#f0ede6] sm:text-[40px]">
              Simple, per-property pricing.
            </h2>
          </Reveal>
          <Reveal delay={100} className="mx-auto mt-12 max-w-md">
            <div className="rounded-2xl border border-[#2c2925] bg-[#23211d] p-8 text-center">
              <div className="text-[12px] uppercase tracking-[.14em] text-[#e7d6ad]">Starts from</div>
              <div className="mt-2 flex items-end justify-center gap-1.5">
                <span className="font-['Fraunces'] text-[56px] font-light leading-none text-[#f0ede6]">
                  €{pricing.fromPriceEuros}
                </span>
                <span className="pb-2 text-[14px] text-[#f0ede6]/45">/property / month</span>
              </div>
              <ul className="mx-auto mt-7 max-w-[280px] space-y-3 text-left">
                {[
                  `${pricing.trialDays}-day free trial — no card`,
                  'Every guest-page feature included',
                  'Tiers that scale with your portfolio',
                  'Cancel anytime',
                ].map(b => (
                  <li key={b} className="flex items-center gap-2.5 text-[13.5px] text-[#f0ede6]/75">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#c8a24e] text-[#16100d]">
                      <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
              <Link
                to="/signup"
                className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#c8a24e] px-6 py-3.5 text-[15px] font-semibold text-[#16100d] transition-colors hover:bg-[#e7d6ad] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e7d6ad] focus-visible:ring-offset-2 focus-visible:ring-offset-[#23211d]"
              >
                Start free trial
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
              <div className="mt-3 text-[11.5px] text-[#f0ede6]/35">Higher tiers unlock more properties and the experiences marketplace.</div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─────────────────────────── FAQ ─────────────────────────── */}
      <section className="bg-[#1c1c1a] py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-5 sm:px-8">
          <Reveal className="text-center">
            <div className="text-[12px] uppercase tracking-[.16em] text-[#c8a24e]">FAQ</div>
            <h2 className="mt-3 font-['Fraunces'] text-[32px] font-light leading-tight text-[#f0ede6] sm:text-[40px]">
              Questions, answered.
            </h2>
          </Reveal>
          <div className="mt-12 divide-y divide-[#2c2925] border-y border-[#2c2925]">
            {FAQS.map(item => (
              <details key={item.q} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[16px] font-medium text-[#f0ede6] outline-none transition-colors hover:text-[#e7d6ad] focus-visible:text-[#e7d6ad] [&::-webkit-details-marker]:hidden">
                  <span className="font-['Fraunces'] font-normal">{item.q}</span>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#2c2925] text-[#c8a24e] transition-transform duration-300 group-open:rotate-45">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </span>
                </summary>
                <p className="pb-6 pr-10 text-[14px] leading-[1.75] text-[#f0ede6]/60">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────── Final CTA ─────────────────────────── */}
      <section className="relative overflow-hidden bg-[#16100d] py-20 sm:py-28">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-[400px] w-[700px] -translate-x-1/2 rounded-full bg-[#a8842f]/15 blur-[120px]"
        />
        <div className="relative mx-auto max-w-2xl px-5 text-center sm:px-8">
          <h2 className="font-['Fraunces'] text-[36px] font-light leading-tight text-[#f0ede6] sm:text-[46px]">
            Ready to give every guest their own page?
          </h2>
          <p className="mx-auto mt-5 max-w-md text-[15px] leading-[1.7] text-[#f0ede6]/55">
            Set up your first property in minutes. No card needed to start your free trial.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/signup"
              className="group inline-flex items-center gap-2 rounded-xl bg-[#c8a24e] px-7 py-4 text-[15px] font-semibold text-[#16100d] transition-colors hover:bg-[#e7d6ad] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e7d6ad] focus-visible:ring-offset-2 focus-visible:ring-offset-[#16100d]"
            >
              {startLabel}
              <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            {/* "See a live demo" → /demo when the flag is on; inert otherwise. */}
            {DEMO_ENABLED ? (
              <Link
                to="/demo"
                className="rounded-xl border border-[#2c2925] bg-[#23211d] px-7 py-4 text-[15px] text-[#f0ede6]/80 transition-colors hover:border-[#c8a24e]/40 hover:text-[#f0ede6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]"
              >
                See a live demo
              </Link>
            ) : (
              <button
                type="button"
                aria-disabled="true"
                title="Live demo coming soon"
                className="rounded-xl border border-[#2c2925] bg-[#23211d] px-7 py-4 text-[15px] text-[#f0ede6]/80 transition-colors hover:border-[#c8a24e]/40 hover:text-[#f0ede6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]"
              >
                See a live demo
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ─────────────────────────── Footer ─────────────────────────── */}
      <footer className="border-t border-[#2c2925] bg-[#1c1c1a]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 px-5 py-9 sm:px-8 md:flex-row">
          <div className="text-center md:text-left">
            <div className="font-['Fraunces'] text-[17px] font-medium text-[#f0ede6]">Arrivly</div>
            <div className="mt-1 text-[12px] text-[#f0ede6]/40">© 2026 Arrivly. A separate product from Anna&apos;s Stays.</div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-[#f0ede6]/55">
            <a href="#how" className="transition-colors hover:text-[#f0ede6]">How it works</a>
            <a href="#features" className="transition-colors hover:text-[#f0ede6]">Features</a>
            <a href="#pricing" className="transition-colors hover:text-[#f0ede6]">Pricing</a>
            <Link to="/login" className="transition-colors hover:text-[#f0ede6]">Log in</Link>
            <span className="text-[#f0ede6]/30">arrivly.anna-stays.fi</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
