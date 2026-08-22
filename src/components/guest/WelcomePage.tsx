import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  MapPin, Navigation, Star, Wifi, KeyRound, Ticket, Send,
  Home, MessageCircle, Settings as SettingsIcon, Lock,
} from 'lucide-react'
import { resolveImageUrl, FALLBACK_HERO } from '../../lib/imageUtils'
import { getDirectionsUrl } from '../../lib/maps'
import { useInstallPrompt } from '../../lib/useInstallPrompt'
import { readStoredHints, rememberHints, forgetHints } from '../../lib/welcomeClaimStore'
import { ARRIVLY_CONFIG } from '../../config'
import ExperiencesSheet, { type ExperienceItem } from './ExperiencesSheet'
import TurnstileWidget from '../demo/TurnstileWidget'

// PUBLIC per-apartment welcome page (/w/:code). A host pastes this link into their booking
// platform's automated message; the guest opens it after booking, before travelling. No
// booking, no token, no login, no guest data collected.
//
// It wears the GUEST PAGE'S SHELL — photo hero, four-tab bar, quick-access strip — because
// the two pages are the same product to a guest, seen a few weeks apart. The visual language
// is COPIED, never imported: GuestPage.tsx is not touched by this file and must not be.
//
// WHAT MUST NEVER APPEAR HERE, no matter how the design moves: any private value. No WiFi
// password, no door code, no entry instructions. api/welcome.ts filters `is_private:false`
// server-side and this page has no token with which to ask for more. The locked quick-access
// tiles are LABELS, not withheld data — the values are not in the payload at all.

const DEFAULT_ACCENT = ARRIVLY_CONFIG.colourPresets[0].hex // #1c1c1a
const EXPERIENCES_ENABLED = import.meta.env.VITE_EXPERIENCES_ENABLED === 'true'
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined

interface Brand {
  brand_name: string | null
  logo_url: string | null
  whatsapp: string | null
  accent_color: string | null
}
interface WelcomeApartment {
  id: string
  name: string
  city: string | null
  country: string | null
  neighborhood: string | null
  welcome_note: string | null
  // Cover photo — NOT gated by welcome_show_address (that flag guards the street and the
  // coordinates; a photo is neither). See the matching note in api/welcome.ts.
  hero_image_url: string | null
  city_image_url: string | null
  city_image_credit: string | null
  // Address + coords are present only when the host enabled welcome_show_address.
  street?: string | null
  street_number?: string | null
  lat?: number | null
  lng?: number | null
}
interface Detail { id: string; category: string; content: string }
interface Pick {
  id: string; name: string; category: string; address: string | null
  lat: number | null; lng: number | null; note: string | null; display_order: number
}
type GuideCategories = Record<string, Array<{ name: string; description?: string; address?: string }>>

type Payload =
  | { state: 'live'; brand: Brand; apartment: WelcomeApartment; details: Detail[]; picks: Pick[]; guide: GuideCategories | null; showFooter: boolean }
  | { state: 'expired'; brand: Brand }
  | { state: 'unavailable'; brand: null }

type ChatMsg = { role: 'user' | 'assistant'; text: string }
type ActiveTab = 'home' | 'chat' | 'explore' | 'more'

// REQUIRED COPY. This is the replacement for the old PRIVATE_HINT line and it must stay on the
// Home tab: it is the only thing telling a guest that the locked tiles are a schedule rather
// than a missing feature, and the only place the QR fallback is mentioned pre-arrival.
const UNLOCK_EXPLAINER =
  "Your WiFi and entry details unlock right here on your check-in day. They're waiting inside the apartment too — there's a QR code on arrival."

// ── Pre-arrival personal link ────────────────────────────────────────────────────
// The host pastes ONE static template into their booking platform's automated message,
// carrying the PLATFORM'S OWN variables for the guest's first name and confirmation code:
//   https://bemgu.app/w/AAAA1111#c={{confirmation_code}}&g={{guest_first_name}}
//
// THE CODE COMES FIRST AND THAT ORDER IS LOAD-BEARING: a first name can contain a SPACE,
// which terminates an auto-linked URL. Code-first, a truncated link still arrives as
// `#c=CODE&g=Anna` — both values present, only the name shortened. Name-first it arrives as
// `#g=Anna`, the code is gone, and the feature silently never fires. Do not reorder these
// when copying the template; sharePlatforms.ts is the authoritative copy.
//
// THE HINTS ARE IN THE FRAGMENT ON PURPOSE, AND THIS IS NOT COSMETIC. vercel.json rewrites
// /(.*) to index.html, so a QUERY STRING would be written into Vercel's edge access log
// before any of this code runs — stripping it here afterwards would be theatre. A browser
// never transmits a fragment to a server and never puts it in a Referer, so the hints exist
// only in this tab until we POST them. Never move them into a query string, a GET, a URL we
// fetch, or a redirect target.
type ClaimHints = { g: string; c: string }
type ClaimResult =
  | { state: 'preview'; guestName: string | null; checkIn: string }
  | { state: 'thankyou'; guestName: string | null }

// The raw body as it arrives. DELIBERATELY LOOSE — 'preview', 'active', 'thankyou' and 'miss'
// are all read from the SAME field, and a union typed to only the two RENDERED states makes the
// other two unreachable to the compiler, which is how the persistence branches below would
// silently be dropped. ('braked' never reaches this type at all: it ships as a 429, so `data` is
// already null by then — which is why the brake can neither write nor clear.)
type ClaimResponse = {
  state?: string
  guestName?: string | null
  checkIn?: string
  token?: string
  apartmentId?: string
}

// Read the hints and REMOVE them from the address bar in the same breath, so they are never
// in a link the guest can copy, screenshot, or leave in their history. Called once per
// mount, during the first render — before any network call can be made with them.
function readAndStripHash(): ClaimHints | null {
  if (typeof window === 'undefined') return null
  const raw = window.location.hash.replace(/^#/, '')
  if (!raw) return null
  // URLSearchParams never throws on a malformed string — it simply yields no matches.
  const params = new URLSearchParams(raw)
  const g = params.get('g')
  const c = params.get('c')
  const hints: ClaimHints | null = g && c ? { g, c } : null
  // Strip unconditionally: a malformed fragment is cleared too, so nothing survives in the
  // URL bar on any path through this function. pathname + search, NOT pathname alone, so a
  // host who pastes the template with a ?utm_* tail does not silently lose it.
  //
  // TWO OTHER READERS OF THIS FRAGMENT EXIST, and neither is a leak today: react-router's
  // in-memory location still holds the original hash for this mount (this is a direct
  // history call, so the router is not notified) — nothing reads it, and the active hand-off
  // replaces it — and src/lib/supabase.ts creates its client with detectSessionInUrl on, so
  // supabase-js also parses the hash at module init and ignores non-auth fragments. Neither
  // transmits anything. Do NOT start reading useLocation().hash here on the assumption that
  // it has been cleaned.
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  return hints
}

// Whole days from local today to a 'YYYY-MM-DD' date. Built from local y/m/d parts on
// purpose: `new Date('YYYY-MM-DD')` parses as UTC and would shift the day for every
// positive-UTC viewer, which is the entire market this countdown is shown to.
function daysUntil(isoDate: string): number | null {
  const parts = isoDate.split('-').map(Number)
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null
  const target = new Date(parts[0], parts[1] - 1, parts[2])
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

function countdownLabel(isoDate: string): string | null {
  const days = daysUntil(isoDate)
  if (days === null || days < 0) return null
  if (days === 0) return 'You arrive today'
  if (days === 1) return 'You arrive tomorrow'
  return `${days} days to go`
}

function whatsappHref(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '')
  return `https://wa.me/${digits}`
}

/** True only for a parseable https:// URL — anything else never becomes an href. */
function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { return new URL(value).protocol === 'https:' } catch { return false }
}

function mapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

export default function WelcomePage() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)

  // Read + strip during the FIRST RENDER, not in an effect: an effect runs after paint, so
  // the hints would sit in the address bar (and in anything that samples it) for a frame.
  // The ref makes it once-per-mount — a second render finds the value already captured.
  //
  // A FRAGMENT ALWAYS WINS over the remembered value: the host's link is the live source of
  // truth, and the strip must run on every mount regardless of what storage holds.
  //
  // KEYED BY `code`, NOT JUST BY MOUNT. The route is /w/:code with no `key`, so navigating
  // between two welcome codes REUSES this component — and a mount-only ref would then POST
  // the FIRST property's confirmation code against the SECOND property's welcome code: a
  // guaranteed miss, a brake failure recorded, and a victim-keyed counter bumped against a
  // host who was never involved. Unreachable today (nothing links between two /w/ routes),
  // which is exactly why it must not be left to routing luck.
  const hintsRef = useRef<{ forCode: string | undefined; hints: ClaimHints | null } | null>(null)
  if (hintsRef.current === null || hintsRef.current.forCode !== code) {
    const fromUrl = readAndStripHash()
    hintsRef.current = { forCode: code, hints: fromUrl ?? (code ? readStoredHints(code) : null) }
  }
  const initialHints = hintsRef.current.hints

  const [claim, setClaim] = useState<ClaimResult | null>(null)
  // Only true when there is actually something to claim, so a plain link never waits.
  const [claiming, setClaiming] = useState(initialHints !== null)

  useEffect(() => {
    const captured = hintsRef.current
    const hints = captured && captured.forCode === code ? captured.hints : null
    // Clear the flag before returning: `claiming` starts true whenever hints were captured,
    // so a falsy `code` (only reachable if the route shape changes) would otherwise leave the
    // page on its spinner forever.
    if (!code || !hints) { setClaiming(false); return }
    let cancelled = false
    fetch('/api/welcome-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, g: hints.g, c: hints.c }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then((data: ClaimResponse | null) => {
        if (cancelled) return
        const state = data?.state
        // PERSISTENCE DECIDED BY THE BODY, NEVER BY r.ok — a miss is a 200. Write only what
        // the server actually resolved; forget what it refused or what is finished. 'braked'
        // deliberately does NEITHER: the brake answers before the lookup, so it is not
        // evidence either way and must not be able to erase a good stored value.
        // 'preview' carries the check-in date that bounds the entry's life; 'active' carries a
        // token instead, so it passes null and the store falls back to an already-stored date
        // or to today. See rememberHints.
        if (state === 'preview' || state === 'active') {
          rememberHints(code, hints, typeof data?.checkIn === 'string' ? data.checkIn : null)
        }
        else if (state === 'miss' || state === 'thankyou') forgetHints(code)

        // ACTIVE — hand off to the existing guest page with the token that already existed
        // on the booking. This feature does not rebuild that page and does not change how
        // its token works. A storage-sourced claim reaches this identically to a URL one.
        if (data && state === 'active' && data.apartmentId && data.token) {
          navigate(
            `/guest?apt=${encodeURIComponent(data.apartmentId)}&token=${encodeURIComponent(data.token)}`,
            { replace: true }
          )
          return
        }
        if (data && (state === 'preview' || state === 'thankyou')) setClaim(data as ClaimResult)
        // Anything else — a miss, the brake, a bad response — falls through to the ORDINARY
        // welcome page. A guest whose hint did not match must never see an error.
        setClaiming(false)
      })
      .catch(() => { if (!cancelled) setClaiming(false) })
    return () => { cancelled = true }
  }, [code, navigate])

  // Marketplace content ⇒ noindex (Viator licence). Same mechanism GuestPage uses:
  // inject a robots meta only while this page is mounted, remove on unmount.
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => { meta.remove() }
  }, [])

  useEffect(() => {
    if (!code) { setLoading(false); return }
    let cancelled = false
    fetch(`/api/welcome?code=${encodeURIComponent(code)}`)
      .then(r => (r.ok ? r.json() : { state: 'unavailable', brand: null }))
      .then((data: Payload) => {
        if (cancelled) return
        setPayload(data && (data as { state?: string }).state ? data : { state: 'unavailable', brand: null })
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setPayload({ state: 'unavailable', brand: null })
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [code])

  if (loading || claiming) {
    return (
      <div className="min-h-screen bg-[#fbfaf7] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#e9e4d9] border-t-[#1c1c1a] rounded-full animate-spin" />
      </div>
    )
  }

  if (!payload || payload.state === 'unavailable') {
    return (
      <div className="min-h-screen bg-[#fbfaf7] flex items-center justify-center px-6 font-['Inter']">
        <div className="text-center max-w-sm">
          <div className="font-['Fraunces'] text-[22px] text-[#1c1c1a] mb-2">This page isn't available</div>
          <p className="text-[14px] text-[#5b5853] leading-relaxed">The link may be old or incomplete. Check with your host for an up-to-date one.</p>
        </div>
      </div>
    )
  }

  const accent = payload.brand?.accent_color || DEFAULT_ACCENT
  const brandName = payload.brand?.brand_name || 'Your host'
  const logo = payload.brand?.logo_url ? resolveImageUrl(payload.brand.logo_url) : null
  const whatsapp = payload.brand?.whatsapp || null

  if (payload.state === 'expired') {
    return (
      <div className="min-h-screen bg-[#fbfaf7] flex items-center justify-center px-6 font-['Inter']">
        <div className="text-center max-w-sm">
          {logo && <img src={logo} alt="" className="h-14 w-auto mx-auto mb-4 object-contain" />}
          <div className="font-['Fraunces'] text-[24px] text-[#1c1c1a] mb-2">{brandName}</div>
          <p className="text-[14px] text-[#5b5853] leading-relaxed mb-6">
            This welcome page isn't available right now. Your host can help you directly.
          </p>
          {whatsapp && (
            <a
              href={whatsappHref(whatsapp)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[14px] font-semibold text-white"
              style={{ background: accent }}
            >
              Message on WhatsApp
            </a>
          )}
        </div>
      </div>
    )
  }

  return <LiveWelcome payload={payload} accent={accent} brandName={brandName} logo={logo} whatsapp={whatsapp} code={code!} claim={claim} />
}

// ── Small shared pieces ─────────────────────────────────────────────────────────

/** A quick-access tile that is deliberately INERT: not a button, not focusable, no value. */
function LockedTile({ Icon, label }: { Icon: typeof Wifi; label: string }) {
  return (
    // Inert BY CONSTRUCTION: a div, no role, no tabIndex, no handler — there is nothing to
    // activate and nothing behind it. The explanation rides in a visually-hidden span rather
    // than an aria-label, because aria-label on a role-less element is not a valid naming
    // context and most screen readers drop it silently.
    <div className="bg-[#faf8f4] border border-dashed border-[#ded8cc] rounded-xl p-3 flex flex-col items-start gap-2 text-left">
      <span className="sr-only">{label} — unlocks on your check-in day</span>
      <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#f0ece3] text-[#8a8276]">
        <Icon size={15} />
      </span>
      <span className="text-[10px] tracking-widest uppercase text-[#8a8276]">{label}</span>
      <span className="text-[13px] font-medium text-[#5b5853] flex items-center gap-1">
        <Lock size={11} /> On arrival
      </span>
    </div>
  )
}

function WhatsAppRow({ whatsapp, brandName, accent, logo }: { whatsapp: string; brandName: string; accent: string; logo: string | null }) {
  return (
    <a
      href={whatsappHref(whatsapp)}
      target="_blank"
      rel="noopener noreferrer"
      className="w-full flex items-center gap-3.5 bg-[#fffdf9] border border-[#e9e4d9] rounded-2xl p-4 shadow-[0_1px_5px_rgba(0,0,0,0.04)] text-left no-underline"
    >
      {logo ? (
        <img src={logo} alt={brandName} className="w-11 h-11 rounded-full object-cover shrink-0" />
      ) : (
        <span className="w-11 h-11 rounded-full flex items-center justify-center text-white text-base font-semibold shrink-0" style={{ background: accent }}>
          {brandName.charAt(0)}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[14px] text-[#1c1c1a]">Message {brandName} directly</p>
        <p className="text-[11.5px] text-[#5b5853] leading-snug mt-0.5">A question before you travel — WhatsApp is the fastest way to reach me.</p>
      </div>
      <span className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center" style={{ background: accent + '14', color: accent }}>
        <MessageCircle size={16} />
      </span>
    </a>
  )
}

function LiveWelcome({
  payload, accent, brandName, logo, whatsapp, code, claim,
}: {
  payload: Extract<Payload, { state: 'live' }>
  accent: string
  brandName: string
  logo: string | null
  whatsapp: string | null
  code: string
  // null for a plain link — the page then renders exactly as it always has. A PLAIN LINK
  // NEVER SELF-TRANSFORMS, on any date; only a CLAIMED one does.
  claim: ClaimResult | null
}) {
  const { apartment, details, picks, guide, showFooter } = payload
  const [activeTab, setActiveTab] = useState<ActiveTab>('home')

  const countdown = claim?.state === 'preview' ? countdownLabel(claim.checkIn) : null
  const area = [apartment.neighborhood, apartment.city].filter(Boolean).join(', ')
  const hasAddress = !!(apartment.street && apartment.street_number)
  const hasCoords = apartment.lat != null && apartment.lng != null
  const fullAddress = hasAddress
    ? [`${apartment.street} ${apartment.street_number}`, apartment.neighborhood, apartment.city, apartment.country].filter(Boolean).join(', ')
    : ''
  const mapLink = hasAddress
    ? (hasCoords ? getDirectionsUrl(apartment.lat!, apartment.lng!) : mapsSearchUrl(fullAddress))
    : null

  const guideEntries = guide ? Object.entries(guide).filter(([, items]) => Array.isArray(items) && items.length) : []
  // "Good to know" = public details EXCEPT any that would be WiFi/check-in (those are private
  // now and never arrive here, but filter defensively so the card only shows real extras).
  const goodToKnow = details.filter(d => d.category !== 'WiFi' && d.category !== 'Check-in')

  // Hero precedence, identical to GuestPage: host upload → cached by-city image (with its
  // attribution caption) → static fallback. The CITY IMAGE IS THE NORMAL CASE here — most
  // apartments have no host upload — so the caption is a mainline path, not an edge case.
  const heroSrc = apartment.hero_image_url
    ? resolveImageUrl(apartment.hero_image_url)
    : (apartment.city_image_url || FALLBACK_HERO)
  let heroCredit: { name: string; userLink: string; unsplashLink: string } | null = null
  if (!apartment.hero_image_url && apartment.city_image_url && apartment.city_image_credit) {
    try {
      const parsed = JSON.parse(apartment.city_image_credit)
      // BOTH LINKS ARE VALIDATED TO https BEFORE THEY BECOME hrefs. api/city-image.ts writes
      // this column with a USER-SCOPED client, so it is host-writable through PostgREST rather
      // than server-derived — which makes it the one unvalidated URL sink on a page that now
      // also holds a booking credential in this origin's localStorage. React's handling of a
      // javascript: href is version-dependent and is not a control to rely on.
      heroCredit = parsed && isHttpsUrl(parsed.userLink) && isHttpsUrl(parsed.unsplashLink)
        ? { name: String(parsed.name ?? 'Unsplash'), userLink: parsed.userLink, unsplashLink: parsed.unsplashLink }
        : null
    } catch { heroCredit = null }
  }

  const headline = claim?.state === 'thankyou'
    ? (claim.guestName ? `Thank you for staying, ${claim.guestName}.` : 'Thank you for staying.')
    : claim?.state === 'preview' && claim.guestName
      ? `See you soon, ${claim.guestName}.`
      : 'Your stay is almost here.'

  // ── Experiences (reuse the guest-page component + endpoint) ──
  const [experiences, setExperiences] = useState<ExperienceItem[] | null>(null)
  const [gygCityLink, setGygCityLink] = useState<string | null>(null)
  const [experiencesLoading, setExperiencesLoading] = useState(false)
  const [showExperiences, setShowExperiences] = useState(false)

  useEffect(() => {
    if (!EXPERIENCES_ENABLED) return
    let cancelled = false
    setExperiencesLoading(true)
    fetch('/api/experiences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apartmentId: apartment.id }),
    })
      .then(r => (r.ok ? r.json() : { experiences: [], gygCityLink: null }))
      .then((data: { experiences?: ExperienceItem[]; gygCityLink?: string | null }) => {
        if (cancelled) return
        setExperiences(Array.isArray(data.experiences) ? data.experiences : [])
        setGygCityLink(typeof data.gygCityLink === 'string' ? data.gygCityLink : null)
        setExperiencesLoading(false)
      })
      .catch(() => { if (!cancelled) { setExperiences([]); setExperiencesLoading(false) } })
    return () => { cancelled = true }
  }, [apartment.id])

  const showExperiencesEntry = EXPERIENCES_ENABLED && (experiencesLoading || (experiences?.length ?? 0) > 0 || !!gygCityLink)

  const card = 'bg-[#fffdf9] border border-[#e9e4d9] rounded-2xl'
  const accentCard = `${card} overflow-hidden shadow-[0_1px_5px_rgba(0,0,0,0.04)]`
  const eyebrow = 'text-[10px] tracking-widest uppercase font-semibold'

  return (
    <div className="min-h-screen bg-[#fbfaf7] text-[#1c1c1a] font-['Inter']">

      {activeTab === 'home' && (
        <div className="pb-28 bg-[#fbfaf7]">
          {/* 1 — Photo hero */}
          <div className="relative h-[68vh] min-h-[460px] max-h-[560px]">
            <img src={heroSrc} alt="" className="absolute inset-0 w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).src = FALLBACK_HERO }} />
            <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(18,16,13,0.86)_0%,rgba(18,16,13,0.55)_22%,rgba(18,16,13,0.12)_46%,transparent_80%)]" />
            {heroCredit && (
              <div className="absolute top-2 right-2 text-[9px] text-white/80 bg-black/30 rounded px-1.5 py-0.5">
                Photo by <a href={heroCredit.userLink} target="_blank" rel="noopener noreferrer" className="underline">{heroCredit.name}</a> on <a href={heroCredit.unsplashLink} target="_blank" rel="noopener noreferrer" className="underline">Unsplash</a>
              </div>
            )}
            <div className="absolute left-0 right-0 bottom-0 px-6 pb-12 text-white">
              <p className="text-[11px] tracking-[0.26em] uppercase opacity-80 mb-3">
                {apartment.city}{apartment.country ? `, ${apartment.country}` : ''}
              </p>
              <h1 className="font-['Fraunces'] font-light text-[40px] leading-none tracking-tight">
                {headline}
              </h1>
              <p className="font-['Fraunces'] font-light text-[18px] leading-snug opacity-90 mt-3 max-w-[280px]">
                {claim?.state === 'thankyou'
                  ? `We hope you enjoyed ${apartment.name}.`
                  : `${apartment.name}${area ? ` — ${area}` : ''} is getting ready for you.`}
              </p>
              {countdown && (
                <div className="mt-4 inline-block rounded-full bg-white/15 ring-1 ring-white/40 px-3.5 py-1.5 text-[12px] font-semibold tracking-[0.02em]">
                  {countdown}
                </div>
              )}
              <div className="mt-5 flex items-center gap-2.5">
                {logo ? (
                  <img src={logo} alt={brandName} className="w-[38px] h-[38px] rounded-full object-cover ring-1 ring-white/40" />
                ) : (
                  <span className="w-[38px] h-[38px] rounded-full bg-white/15 ring-1 ring-white/40 flex items-center justify-center text-sm font-semibold">
                    {brandName.charAt(0)}
                  </span>
                )}
                <span className="font-['Fraunces'] italic text-[15px] opacity-90">— {brandName}</span>
              </div>
            </div>
          </div>

          {/* 2 — The letter */}
          <div className="max-w-lg mx-auto px-6 pt-9 pb-4">
            <h2 className="font-['Fraunces'] font-normal text-[27px] tracking-tight text-[#1c1c1a]">
              Dear {claim?.guestName ? claim.guestName : 'guest'},
            </h2>
            {apartment.welcome_note ? (
              <p className="text-[15px] leading-relaxed text-[#36322c] mt-4 whitespace-pre-line">{apartment.welcome_note}</p>
            ) : (
              <p className="text-[15px] leading-relaxed text-[#36322c] mt-4">
                We&apos;re so glad you&apos;re coming to stay at {apartment.name}{area ? ` in ${area}` : ''}. Everything you need for a smooth
                arrival is on its way — for now, here&apos;s a little to help you plan ahead.
              </p>
            )}
            <div className="mt-5 flex justify-end">
              <p className="font-['Fraunces'] italic text-[15px]" style={{ color: accent }}>— {brandName}</p>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <div className="flex-1 h-px bg-[#e9e4d9]" />
              <span className="text-xs" style={{ color: accent }}>✦</span>
              <div className="flex-1 h-px bg-[#e9e4d9]" />
            </div>
          </div>

          {/* 3 — Getting here. This slot is GuestPage's "Right now" card; weather is
              deliberately NOT ported to a page a guest reads weeks before arrival. */}
          <div className="max-w-lg mx-auto px-6 pt-3 pb-2">
            <div className={accentCard}>
              <div className="h-[3px]" style={{ background: accent }} />
              <div className="p-5">
                <p className={eyebrow} style={{ color: accent }}>Getting here</p>
                {hasAddress ? (
                  <>
                    <div className="flex items-start gap-2.5 mt-2.5">
                      <MapPin size={18} className="mt-0.5 shrink-0" style={{ color: accent }} />
                      <div className="text-[15px] text-[#1c1c1a] leading-snug">{fullAddress}</div>
                    </div>
                    {mapLink && (
                      <a
                        href={mapLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white no-underline"
                        style={{ background: accent }}
                      >
                        <Navigation size={15} /> Open in maps
                      </a>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-start gap-2.5 mt-2.5">
                      <MapPin size={18} className="mt-0.5 shrink-0" style={{ color: accent }} />
                      <div className="text-[15px] text-[#1c1c1a] leading-snug">{area || apartment.city || 'Your destination'}</div>
                    </div>
                    <p className="text-[13px] text-[#5b5853] leading-relaxed mt-2.5">
                      Your host will share the exact address closer to your arrival.
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 4 — Message the host */}
          {whatsapp && (
            <div className="max-w-lg mx-auto px-6 pt-3 pb-2">
              <WhatsAppRow whatsapp={whatsapp} brandName={brandName} accent={accent} logo={logo} />
            </div>
          )}

          {/* 5 — Quick access. WiFi and Door are ALWAYS rendered and ALWAYS locked: their
              absence would read as a missing feature, their lock reads as a schedule. */}
          <div className="max-w-lg mx-auto px-6 pt-3 pb-2">
            <p className="text-[10px] tracking-widest uppercase text-[#9a958c] mb-2.5">Quick access</p>
            <div className="grid grid-cols-3 gap-2.5">
              <LockedTile Icon={Wifi} label="WiFi" />
              <LockedTile Icon={KeyRound} label="Door" />
              {hasCoords ? (
                <a
                  href={getDirectionsUrl(apartment.lat!, apartment.lng!)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-[#fffdf9] border border-[#e9e4d9] rounded-xl p-3 flex flex-col items-start gap-2 text-left no-underline"
                >
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: accent + '14', color: accent }}>
                    <Navigation size={15} />
                  </span>
                  <span className="text-[10px] tracking-widest uppercase text-[#9a958c]">Home</span>
                  <span className="text-[13px] font-medium text-[#1c1c1a]">Directions</span>
                </a>
              ) : (
                <LockedTile Icon={Navigation} label="Home" />
              )}
            </div>
            <p className="text-[12.5px] text-[#5b5853] leading-relaxed mt-3">{UNLOCK_EXPLAINER}</p>
          </div>

          {/* 6 — Good to know */}
          {goodToKnow.length > 0 && (
            <div className="max-w-lg mx-auto px-6 pt-3 pb-2">
              <div className={`${card} p-5`}>
                <p className={`${eyebrow} mb-3`} style={{ color: accent }}>Good to know</p>
                <div className="space-y-3">
                  {goodToKnow.map(d => (
                    <div key={d.id}>
                      <div className="text-[12px] font-semibold text-[#1c1c1a] mb-0.5">{d.category}</div>
                      <div className="text-[13.5px] text-[#5b5853] leading-relaxed whitespace-pre-line">{d.content}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 7 — Powered by Bemgu (trial only) */}
          {showFooter && (
            <div className="pt-6 pb-2 text-center">
              <p className="font-['Fraunces'] italic text-[15px] text-[#9a958c]">{brandName}</p>
              <p className="text-[10px] text-[#b3aa9b] mt-5">{ARRIVLY_CONFIG.poweredByText}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'chat' && (
        <div style={{ height: 'calc(100vh - 64px)' }}>
          <WelcomeChat accent={accent} brandName={brandName} code={code} />
        </div>
      )}

      {activeTab === 'explore' && (
        <div className="pb-28 bg-[#fbfaf7]">
          <div className="px-6 pt-8 pb-6 text-white" style={{ background: accent }}>
            <p className="text-[10px] tracking-[0.16em] uppercase opacity-70 mb-1">Host picks &amp; local guide</p>
            <h2 className="font-['Fraunces'] font-light text-2xl tracking-tight">
              Around {apartment.neighborhood || apartment.city || 'the neighbourhood'}
            </h2>
          </div>

          <div className="max-w-lg mx-auto px-6 pt-6 space-y-4">
            {/* Take me home — pinned above everything, live only with real coordinates. */}
            {hasCoords && (
              <a
                href={getDirectionsUrl(apartment.lat!, apartment.lng!)}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3 rounded-2xl border border-[#e9e4d9] bg-[#fffdf9] p-4 no-underline shadow-[0_1px_5px_rgba(0,0,0,0.04)]"
              >
                <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: accent + '14', color: accent }}>
                  <Navigation size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[14px] text-[#1c1c1a]">Take me home</p>
                  <p className="text-[11.5px] text-[#5b5853] leading-snug mt-0.5">Directions to the apartment</p>
                </div>
                <span style={{ color: accent }}>→</span>
              </a>
            )}

            {picks.length > 0 && (
              <div className={`${card} p-5`}>
                <p className={`${eyebrow} mb-1`} style={{ color: accent }}>What we&apos;d do</p>
                <p className="text-[13px] text-[#5b5853] mb-4">{brandName}&apos;s picks for planning your days.</p>
                <div className="space-y-2.5">
                  {picks.map(p => (
                    <a
                      key={p.id}
                      href={mapsSearchUrl(p.address ? `${p.name}, ${p.address}` : p.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-xl border border-[#e9e4d9] bg-[#fbfaf7] p-3.5 no-underline"
                    >
                      <div className="flex items-center gap-1.5">
                        <Star size={13} style={{ color: accent }} />
                        <span className="text-[10px] uppercase tracking-wide text-[#9a958c]">{p.category}</span>
                      </div>
                      <div className="mt-0.5 font-['Fraunces'] text-[15px] text-[#1c1c1a]">{p.name}</div>
                      {p.note && <div className="mt-1 text-[13px] text-[#5b5853] leading-snug">{p.note}</div>}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {guideEntries.length > 0 && (
              <div className={`${card} p-5`}>
                <p className={`${eyebrow} mb-3`} style={{ color: accent }}>The neighbourhood</p>
                <div className="space-y-3">
                  {guideEntries.map(([cat, items]) => (
                    <div key={cat}>
                      <div className="text-[12px] font-semibold text-[#1c1c1a] mb-1.5">{cat}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {items.slice(0, 8).map((i, idx) => (
                          <a
                            key={`${cat}-${idx}`}
                            href={mapsSearchUrl(i.address ? `${i.name}, ${i.address}` : `${i.name} ${apartment.city ?? ''}`)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-full border px-2.5 py-1 text-[12px] no-underline"
                            style={{ borderColor: accent + '55', color: accent, background: accent + '14' }}
                          >
                            {i.name}
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showExperiencesEntry && (
              <button
                type="button"
                onClick={() => setShowExperiences(true)}
                className="w-full flex items-center justify-between gap-3 rounded-2xl border border-[#e9e4d9] bg-[#fffdf9] p-4 text-left cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <Ticket size={18} style={{ color: accent }} />
                  <div>
                    <div className="text-[14px] font-semibold text-[#1c1c1a]">Tours &amp; tickets to book ahead</div>
                    <div className="text-[12px] text-[#9a958c]">Plan the highlights before you arrive</div>
                  </div>
                </div>
                <span style={{ color: accent }}>→</span>
              </button>
            )}

            {picks.length === 0 && guideEntries.length === 0 && !showExperiencesEntry && !hasCoords && (
              <div className={`${card} p-5`}>
                <p className="text-[13.5px] text-[#5b5853] leading-relaxed">
                  {brandName} is still putting their local favourites together. Ask in the Chat tab in the
                  meantime — it knows the area.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'more' && (
        <div className="pb-28 bg-[#fbfaf7]">
          <div className="px-6 pt-8 pb-6 text-white" style={{ background: accent }}>
            {logo && <img src={logo} alt={brandName} className="h-7 mb-2 object-contain" />}
            <p className="text-[10px] tracking-[0.16em] uppercase opacity-70 mb-1">Settings</p>
            <h2 className="font-['Fraunces'] font-light text-2xl tracking-tight">{brandName}</h2>
          </div>

          <div className="max-w-lg mx-auto px-6 pt-6 space-y-3">
            <p className="text-[10px] tracking-widest uppercase text-[#9a958c]">This device</p>

            {/* a) Keep this page. NOTIFICATIONS ARE DELIBERATELY NOT OFFERED HERE: a push
                subscription needs the booking token this page does not have. */}
            <KeepThisPageCard accent={accent} />

            {/* b) On your check-in day — approved copy, verbatim. */}
            <div className={accentCard}>
              <div className="h-[3px]" style={{ background: accent }} />
              <div className="p-5">
                <p className={eyebrow} style={{ color: accent }}>On your check-in day</p>
                <p className="text-[14px] text-[#36322c] leading-relaxed mt-2.5">
                  This page turns into your personal guest page on its own — your WiFi, your door code and
                  your entry instructions appear, and you can message your host directly. Nothing for you to do.
                </p>
                <p className="text-[13px] text-[#5b5853] leading-relaxed mt-2.5">
                  There&apos;s a QR code in the apartment too, if you&apos;d rather open it that way.
                </p>
              </div>
            </div>

            {/* c) WhatsApp */}
            {whatsapp && <WhatsAppRow whatsapp={whatsapp} brandName={brandName} accent={accent} logo={logo} />}

            <div className="pt-6 pb-2 text-center">
              <p className="font-['Fraunces'] italic text-[15px] text-[#9a958c]">{brandName}</p>
              {showFooter && <p className="text-[10px] text-[#b3aa9b] mt-5">{ARRIVLY_CONFIG.poweredByText}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Tab bar — same markup, sizing and active indicator as GuestPage's. */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-[rgba(255,253,249,0.93)] backdrop-blur border-t border-[#e9e4d9] h-16 flex items-stretch">
        {(
          [
            { id: 'home', Icon: Home, label: 'Home' },
            { id: 'chat', Icon: MessageCircle, label: 'Chat' },
            { id: 'explore', Icon: MapPin, label: 'Explore' },
            { id: 'more', Icon: SettingsIcon, label: 'Settings' },
          ] as const
        ).map(({ id, Icon, label }) => {
          const isActive = activeTab === id
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 border-none bg-transparent cursor-pointer relative"
              style={{ color: isActive ? accent : '#a8a399' }}
            >
              {isActive && (
                <div
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-7 h-[3px] rounded-b"
                  style={{ background: accent }}
                />
              )}
              <Icon size={18} />
              <span className="text-[9px] tracking-widest uppercase font-medium">{label}</span>
            </button>
          )
        })}
      </div>

      {showExperiences && (
        <ExperiencesSheet
          apartmentId={apartment.id}
          accentColor={accent}
          brandName={brandName}
          isOnTrial={showFooter}
          experiences={experiences ?? []}
          gygCityLink={gygCityLink}
          loading={experiencesLoading}
          onClose={() => setShowExperiences(false)}
        />
      )}
    </div>
  )
}

// ── Settings card (a): install this page ────────────────────────────────────────
// Uses the SHARED useInstallPrompt hook rather than a local beforeinstallprompt listener.
// Same mechanism GuestPage uses, one layer up: index.html captures the event before React
// mounts, so a listener registered in a component can miss it entirely on a fast load.
function KeepThisPageCard({ accent }: { accent: string }) {
  const { canInstall, isIOSSafari, isChromium, standalone, install, installed } = useInstallPrompt()

  return (
    <div className="bg-[#fffdf9] border border-[#e9e4d9] rounded-2xl p-[17px] shadow-[0_1px_5px_rgba(0,0,0,0.04)]">
      <div className="flex items-start gap-3.5 mb-4">
        <span className="w-[42px] h-[42px] rounded-xl flex items-center justify-center shrink-0" style={{ background: accent + '14', color: accent }}>
          <Home size={19} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[15px] text-[#1c1c1a]">Keep this page</p>
          <p className="text-[13px] text-[#5b5853] leading-snug mt-0.5">
            Add it to your home screen. It remembers you, and becomes your guest page on check-in day.
          </p>
        </div>
      </div>

      {standalone || installed ? (
        <p className="text-[13px] text-[#5b5853]">Added to your home screen ✓</p>
      ) : canInstall ? (
        <button
          onClick={() => { void install() }}
          className="w-full py-3.5 rounded-xl text-white text-[10px] tracking-widest uppercase border-none cursor-pointer font-semibold"
          style={{ background: accent }}
        >
          Add to home screen →
        </button>
      ) : isIOSSafari ? (
        <p className="text-sm text-[#5b5853] leading-relaxed">
          On iPhone: tap the Share button, then &lsquo;Add to Home Screen&rsquo;.
        </p>
      ) : isChromium ? (
        <p className="text-sm text-[#5b5853] leading-relaxed">
          Tap the ⋮ menu, then &lsquo;Install app&rsquo; (or &lsquo;Add to Home Screen&rsquo;).
        </p>
      ) : (
        <p className="text-sm text-[#5b5853] leading-relaxed">
          Open this page in Chrome or Safari to add it to your home screen.
        </p>
      )}
    </div>
  )
}

// ── The public concierge (Turnstile-gated, /api/welcome-chat) ──
// Full-height chat column so the composer sits above the tab bar, matching the guest page's
// chat tab. The transport, history cap and Turnstile handling are unchanged.
function WelcomeChat({ accent, brandName, code }: { accent: string; brandName: string; code: string }) {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  // Turnstile tokens are single-use — after each send we remount the widget (bump the key)
  // to mint a fresh one for the next message, so multi-turn chat isn't stuck after one Q.
  const [turnstileKey, setTurnstileKey] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, sending])

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    if (!TURNSTILE_SITE_KEY) { setError("The assistant isn't available right now."); return }
    if (!turnstileToken) { setError('Please complete the quick human check below first.'); return }
    setError(null)
    setSending(true)
    // Cap history to the last 8 turns — the endpoint rejects more (a UX bound, not security).
    const history = messages.slice(-8).map(m => ({ role: m.role, text: m.text }))
    setMessages(prev => [...prev, { role: 'user', text }])
    setInput('')
    try {
      const r = await fetch('/api/welcome-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, message: text, history, turnstileToken }),
      })
      if (r.ok) {
        const { reply } = await r.json()
        setMessages(prev => [...prev, { role: 'assistant', text: String(reply || '') }])
      } else if (r.status === 429) {
        setError("You're asking a lot quickly — give it a moment and try again.")
      } else if (r.status === 403) {
        setError('That check expired — please tick the box again.')
        setTurnstileToken(null)
      } else {
        setError('The assistant is having a moment. Please try again shortly.')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSending(false)
      // Consumed token is spent — remount the widget to mint a fresh one for the next turn.
      setTurnstileToken(null)
      setTurnstileKey(k => k + 1)
    }
  }

  return (
    <div className="h-full flex flex-col bg-[#fbfaf7]">
      <div className="shrink-0 px-5 pt-5 pb-3 border-b border-[#e9e4d9]">
        <p className="text-[10px] tracking-widest uppercase font-semibold" style={{ color: accent }}>Ask {brandName}</p>
        <p className="text-[12.5px] text-[#5b5853] mt-1">
          Planning ahead? Ask about the neighbourhood, getting around, or what&apos;s worth booking early.
        </p>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-3">
        {messages.length === 0 && !sending && (
          <p className="text-[13px] text-[#9a958c] text-center px-6 pt-6 leading-relaxed">
            Nothing asked yet — try &ldquo;what&apos;s the best way in from the airport?&rdquo;
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-snug ${
                m.role === 'user' ? 'rounded-tr-sm text-white' : 'rounded-tl-sm bg-white text-[#1c1c1a] shadow-sm'
              }`}
              style={m.role === 'user' ? { background: accent } : undefined}
            >
              {m.text}
            </div>
          </div>
        ))}
        {sending && <div className="text-[12px] text-[#9a958c] px-1">Thinking…</div>}
      </div>

      <div className="shrink-0 border-t border-[#e9e4d9] bg-[#fffdf9] px-4 py-3">
        {error && <div className="text-[12px] text-[#8a1a1a] mb-2">{error}</div>}
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void send() } }}
            placeholder="Ask about the area…"
            className="flex-1 bg-[#fbfaf7] border border-[#e9e4d9] rounded-full px-4 py-2 text-sm text-[#1c1c1a] placeholder:text-[#9a958c] outline-none"
          />
          <button
            type="button"
            onClick={() => { void send() }}
            disabled={sending || !input.trim()}
            aria-label="Send"
            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white disabled:opacity-40 border-none cursor-pointer"
            style={{ background: accent }}
          >
            <Send size={15} />
          </button>
        </div>
        {/* Human check — reuse the existing Turnstile widget rather than a new one. */}
        {TURNSTILE_SITE_KEY && (
          <div className="mt-3">
            <TurnstileWidget key={turnstileKey} siteKey={TURNSTILE_SITE_KEY} onToken={setTurnstileToken} />
          </div>
        )}
      </div>
    </div>
  )
}
