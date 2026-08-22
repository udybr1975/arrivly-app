import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MapPin, Navigation, Star, Wifi, KeyRound, Ticket, Send } from 'lucide-react'
import { resolveImageUrl } from '../../lib/imageUtils'
import { getDirectionsUrl } from '../../lib/maps'
import { ARRIVLY_CONFIG } from '../../config'
import ExperiencesSheet, { type ExperienceItem } from './ExperiencesSheet'
import TurnstileWidget from '../demo/TurnstileWidget'

// PUBLIC per-apartment welcome page (/w/:code). A host pastes this link into their booking
// platform's automated message; the guest opens it after booking, before travelling. No
// booking, no token, no login, no guest data collected. Visual language mirrors GuestPage
// (accent-led on cream/charcoal neutrals, Fraunces display) — accent comes from the brand.

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

// Public detail categories that live behind the guest page, surfaced here as a nudge only.
const PRIVATE_HINT = 'WiFi and entry details are waiting inside your guest page — scan the QR in the apartment on arrival.'

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
  const hintsRef = useRef<ClaimHints | null | undefined>(undefined)
  if (hintsRef.current === undefined) hintsRef.current = readAndStripHash()

  const [claim, setClaim] = useState<ClaimResult | null>(null)
  // Only true when there is actually something to claim, so a plain link never waits.
  const [claiming, setClaiming] = useState(hintsRef.current !== null)

  useEffect(() => {
    const hints = hintsRef.current
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
      .then((data: (ClaimResult & { token?: string; apartmentId?: string }) | null) => {
        if (cancelled) return
        // ACTIVE — hand off to the existing guest page with the token that already existed
        // on the booking. This feature does not rebuild that page and does not change how
        // its token works.
        if (data && (data as { state?: string }).state === 'active' && data.apartmentId && data.token) {
          navigate(
            `/guest?apt=${encodeURIComponent(data.apartmentId)}&token=${encodeURIComponent(data.token)}`,
            { replace: true }
          )
          return
        }
        if (data && (data.state === 'preview' || data.state === 'thankyou')) setClaim(data)
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
        setPayload(data && (data as any).state ? data : { state: 'unavailable', brand: null })
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
  const countdown = claim?.state === 'preview' ? countdownLabel(claim.checkIn) : null
  const area = [apartment.neighborhood, apartment.city].filter(Boolean).join(', ')
  const hasAddress = !!(apartment.street && apartment.street_number)
  const fullAddress = hasAddress
    ? [`${apartment.street} ${apartment.street_number}`, apartment.neighborhood, apartment.city, apartment.country].filter(Boolean).join(', ')
    : ''
  const mapLink = hasAddress
    ? (apartment.lat != null && apartment.lng != null ? getDirectionsUrl(apartment.lat, apartment.lng) : mapsSearchUrl(fullAddress))
    : null

  const guideEntries = guide ? Object.entries(guide).filter(([, items]) => Array.isArray(items) && items.length) : []
  // "Good to know" = public details EXCEPT any that would be WiFi/check-in (those are private
  // now and never arrive here, but filter defensively so the card only shows real extras).
  const goodToKnow = details.filter(d => d.category !== 'WiFi' && d.category !== 'Check-in')

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
  const eyebrow = 'text-[11px] uppercase tracking-[0.18em] font-semibold'

  return (
    <div className="min-h-screen bg-[#fbfaf7] text-[#1c1c1a] font-['Inter'] pb-16">
      {/* 1 — Hero */}
      <header className="max-w-xl mx-auto px-5 pt-12 pb-8 text-center">
        {logo && <img src={logo} alt="" className="h-14 w-auto mx-auto mb-5 object-contain" />}
        {area && <div className={`${eyebrow} mb-2`} style={{ color: accent }}>{area}</div>}
        <h1 className="font-['Fraunces'] font-light text-[32px] leading-tight text-[#1c1c1a]">
          {claim?.state === 'thankyou'
            ? (claim.guestName ? `Thank you for staying, ${claim.guestName}.` : 'Thank you for staying.')
            : claim?.state === 'preview' && claim.guestName
              ? `See you soon, ${claim.guestName}.`
              : 'Your stay is almost here.'}
        </h1>
        {claim?.state === 'preview' && countdown && (
          <div className="mt-3 inline-block rounded-full border border-[#e9e4d9] bg-[#fffdf9] px-3.5 py-1.5 text-[12px] font-semibold tracking-[0.02em]" style={{ color: accent }}>
            {countdown}
          </div>
        )}
        <p className="mt-3 text-[14px] text-[#5b5853]">
          {claim?.state === 'thankyou'
            ? `We hope you enjoyed ${apartment.name}.`
            : `A little welcome from ${brandName}.`}
        </p>
      </header>

      <main className="max-w-xl mx-auto px-5 space-y-4">
        {/* 2 — Host welcome note */}
        <section className={`${card} p-6`}>
          <div className={`${eyebrow} mb-3`} style={{ color: accent }}>A note from your host</div>
          {apartment.welcome_note ? (
            <p className="text-[15px] leading-relaxed text-[#3a352e] whitespace-pre-line">{apartment.welcome_note}</p>
          ) : (
            <p className="text-[15px] leading-relaxed text-[#3a352e]">
              We're so glad you're coming to stay at {apartment.name}{area ? ` in ${area}` : ''}. Everything you need for a smooth
              arrival is on its way — for now, here's a little to help you plan ahead.
            </p>
          )}
        </section>

        {/* 3 — Getting here */}
        <section className={`${card} p-6`}>
          <div className={`${eyebrow} mb-3`} style={{ color: accent }}>Getting here</div>
          {hasAddress ? (
            <>
              <div className="flex items-start gap-2.5">
                <MapPin size={18} className="mt-0.5 shrink-0" style={{ color: accent }} />
                <div className="text-[15px] text-[#1c1c1a] leading-snug">{fullAddress}</div>
              </div>
              {mapLink && (
                <a
                  href={mapLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white"
                  style={{ background: accent }}
                >
                  <Navigation size={15} /> Open in maps
                </a>
              )}
            </>
          ) : (
            <div className="flex items-start gap-2.5">
              <MapPin size={18} className="mt-0.5 shrink-0" style={{ color: accent }} />
              <div className="text-[15px] text-[#1c1c1a] leading-snug">
                {area || apartment.city || 'Your host will share the exact address closer to your arrival.'}
              </div>
            </div>
          )}
        </section>

        {/* 4 — What we'd do */}
        {(picks.length > 0 || guideEntries.length > 0 || showExperiencesEntry) && (
          <section className={`${card} p-6`}>
            <div className={`${eyebrow} mb-1`} style={{ color: accent }}>What we'd do</div>
            <p className="text-[13px] text-[#5b5853] mb-4">{brandName}'s picks for planning your days.</p>

            {picks.length > 0 && (
              <div className="space-y-2.5 mb-4">
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
            )}

            {guideEntries.length > 0 && (
              <div className="space-y-3 mb-4">
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
            )}

            {showExperiencesEntry && (
              <button
                type="button"
                onClick={() => setShowExperiences(true)}
                className="w-full flex items-center justify-between gap-3 rounded-xl border border-[#e9e4d9] bg-[#fbfaf7] p-4 text-left"
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
          </section>
        )}

        {/* 5 — Ask <brand> */}
        <WelcomeChat accent={accent} brandName={brandName} code={code} />

        {/* 6 — Good to know */}
        <section className={`${card} p-6`}>
          <div className={`${eyebrow} mb-3`} style={{ color: accent }}>Good to know</div>
          {goodToKnow.length > 0 ? (
            <div className="space-y-3 mb-4">
              {goodToKnow.map(d => (
                <div key={d.id}>
                  <div className="text-[12px] font-semibold text-[#1c1c1a] mb-0.5">{d.category}</div>
                  <div className="text-[13.5px] text-[#5b5853] leading-relaxed whitespace-pre-line">{d.content}</div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex items-start gap-2.5 rounded-xl border border-[#e9e4d9] bg-[#fbfaf7] p-3.5">
            <div className="flex gap-1.5 mt-0.5 shrink-0" style={{ color: accent }}>
              <Wifi size={16} /><KeyRound size={16} />
            </div>
            <div className="text-[13px] text-[#5b5853] leading-relaxed">{PRIVATE_HINT}</div>
          </div>
        </section>

        {/* 7 — WhatsApp */}
        {whatsapp && (
          <a
            href={whatsappHref(whatsapp)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-[14px] font-semibold text-white"
            style={{ background: accent }}
          >
            Message {brandName} on WhatsApp
          </a>
        )}

        {/* 8 — Powered by Bemgu (trial only) */}
        {showFooter && (
          <div className="text-center text-[11px] uppercase tracking-widest text-[#9a958c] pt-2">
            {ARRIVLY_CONFIG.poweredByText}
          </div>
        )}
      </main>

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

// ── Section 5: the public concierge (Turnstile-gated, /api/welcome-chat) ──
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
        setError("The assistant is having a moment. Please try again shortly.")
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
    <section className="bg-[#fffdf9] border border-[#e9e4d9] rounded-2xl p-6">
      <div className="text-[11px] uppercase tracking-[0.18em] font-semibold mb-1" style={{ color: accent }}>
        Ask {brandName}
      </div>
      <p className="text-[13px] text-[#5b5853] mb-4">
        Planning ahead? Ask about the neighbourhood, getting around, or what's worth booking early.
      </p>

      {messages.length > 0 && (
        <div ref={scrollRef} className="max-h-64 overflow-y-auto space-y-2 mb-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-snug ${
                m.role === 'user' ? 'ml-auto text-white rounded-br-sm' : 'mr-auto border border-[#e9e4d9] bg-[#fbfaf7] text-[#3a352e] rounded-bl-sm'
              }`}
              style={m.role === 'user' ? { background: accent } : undefined}
            >
              {m.text}
            </div>
          ))}
          {sending && <div className="mr-auto text-[12px] text-[#9a958c] px-1">Thinking…</div>}
        </div>
      )}

      {error && <div className="text-[12px] text-[#8a1a1a] mb-2">{error}</div>}

      <div className="flex items-center gap-2 rounded-full border border-[#e9e4d9] bg-[#fbfaf7] pl-4 pr-1.5 py-1.5">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send() } }}
          placeholder="Ask about the area…"
          className="flex-1 bg-transparent text-[14px] text-[#1c1c1a] placeholder:text-[#9a958c] focus:outline-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !input.trim()}
          aria-label="Send"
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white disabled:opacity-40"
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
    </section>
  )
}
