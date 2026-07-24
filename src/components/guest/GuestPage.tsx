import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Home, MessageCircle, MapPin, Settings,
  Copy, Check, RefreshCw, Navigation, Calendar, Star,
  Wifi, KeyRound, Ticket,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getDirectionsUrl } from '../../lib/maps'
import { resolveImageUrl, FALLBACK_HERO } from '../../lib/imageUtils'
import InstallPrompt from './InstallPrompt'
import EventsPage from './EventsPage'
import ExperiencesSheet, { type ExperienceItem } from './ExperiencesSheet'
import ChatBot from './ChatBot'
import MessageHost from './MessageHost'
import { ARRIVLY_CONFIG } from '../../config'
import { iosNeedsHomeScreen, isStandalone, subscribeGuestToPush, checkPermission, isSubscribed } from '../../lib/webpush'
import { api } from '../../lib/api'

interface Host {
  brand_name: string | null
  logo_url: string | null
  whatsapp: string | null
  subscription_status: string
  accent_color: string | null
}

interface Apartment {
  id: string
  host_id: string
  name: string
  neighborhood: string
  city: string
  country: string
  lat: number | null
  lng: number | null
  accent_color: string | null
  max_guests: number | null
  hero_image_url: string | null
  city_image_url: string | null
  city_image_credit: string | null
  greeting_blurb: string | null
}

interface Detail {
  id: string
  category: string
  content: string
  is_private: boolean
}

interface HostPick {
  id: string
  name: string
  category: string
  address: string | null
  lat: number | null
  lng: number | null
  note: string | null
  display_order: number
}

interface GuideCategoryItem {
  name: string
  description?: string
  address?: string
  lat?: number
  lng?: number
}

interface GuideCategories {
  [category: string]: GuideCategoryItem[]
}

interface Weather {
  temp: number
  condition: string
  isOutdoorWeather: boolean
  icon: string
}

type PageState = 'loading' | 'active' | 'thankyou' | 'neutral' | 'expired' | 'unavailable'
type ActiveTab = 'home' | 'chat' | 'explore' | 'more'
type PushNotifState = 'loading' | 'off' | 'on' | 'blocked' | 'ios' | 'unsupported' | 'needs-install'

function parseWifi(content: string): { network: string; password: string } {
  const netMatch = content.match(/(?:network|wifi\s*name|wi-fi\s*name|ssid|wifi)[:\s]+([^\n\r\/,|]+)/i)
  const passMatch = content.match(/(?:password|pass(?:word)?|pwd|key\b)[:\s]+([^\n\r\/,|]+)/i)
  if (netMatch || passMatch) {
    return {
      network: netMatch ? netMatch[1].trim() : '',
      password: passMatch ? passMatch[1].trim() : '',
    }
  }
  const parts = content.split(/\s*[\/|]\s*/)
  if (parts.length >= 2) {
    return {
      network: parts[0].replace(/^[^:]+:\s*/, '').trim(),
      password: parts[1].replace(/^[^:]+:\s*/, '').trim(),
    }
  }
  return { network: content.trim(), password: '' }
}

function mapsSearchUrl(name: string, address?: string | null): string {
  const q = address ? `${name}, ${address}` : name
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

const EXTRAS_CATEGORIES = ['Parking', 'Recycling & Bins', 'Appliances', 'Transport', 'Amenities', 'Safety', 'Good to know']
const PREVIEW_SAMPLE_NAME = 'Alex'

// Phase I — bookable experiences (Viator + Tiqets APIs, GetYourGuide links). The
// Explore-tab "Tours & tickets" entry + sheet are wired to VITE_EXPERIENCES_ENABLED;
// OFF unless exactly 'true' (VITE_ vars need a redeploy to take effect). When on, the
// entry card only appears once /api/experiences returns content for the apartment.
const EXPERIENCES_ENABLED = import.meta.env.VITE_EXPERIENCES_ENABLED === 'true'

// SLOT 2 — restaurant "Reserve" (TheFork/OpenTable) is a separate later Phase-I surface,
// still inert + flag-gated OFF. Flipping it wires a different (table-booking) endpoint.
const SHOW_RESERVE_SLOT = false

function getDayPart(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const h = new Date().getHours()
  if (h >= 5 && h <= 10) return 'morning'
  if (h >= 11 && h <= 16) return 'afternoon'
  if (h >= 17 && h <= 21) return 'evening'
  return 'night'
}

function getTimeSalutation(): string {
  const h = new Date().getHours()
  if (h >= 5 && h <= 10) return 'Good morning'
  if (h >= 11 && h <= 16) return 'Good afternoon'
  if (h >= 17 && h <= 21) return 'Good evening'
  return 'Welcome'
}

export default function GuestPage() {
  const [searchParams] = useSearchParams()
  const aptId = searchParams.get('apt')
  const tokenParam = searchParams.get('token')
  const keyParam = searchParams.get('key')
  const msgParam = searchParams.get('msg')
  const preview = searchParams.get('preview') === '1'

  const [apartment, setApartment] = useState<Apartment | null>(null)
  const [host, setHost] = useState<Host | null>(null)
  const [details, setDetails] = useState<Detail[]>([])
  const [hostPicks, setHostPicks] = useState<HostPick[]>([])
  const [guideCategories, setGuideCategories] = useState<GuideCategories | null>(null)

  const [loading, setLoading] = useState(true)
  const [pageState, setPageState] = useState<PageState>('loading')
  const [activeTab, setActiveTab] = useState<ActiveTab>('home')
  const [showEvents, setShowEvents] = useState(false)
  const [showExperiences, setShowExperiences] = useState(false)
  const [experiences, setExperiences] = useState<ExperienceItem[] | null>(null)
  const [gygCityLink, setGygCityLink] = useState<string | null>(null)
  const [experiencesLoading, setExperiencesLoading] = useState(false)
  const [showMessages, setShowMessages] = useState(false)

  const [guestName, setGuestName] = useState<string | null>(null)
  const [thankYouName, setThankYouName] = useState<string | null>(null)
  const [unavailableBrand, setUnavailableBrand] = useState<{ brand_name: string | null; logo_url: string | null; accent_color: string | null } | null>(null)

  const [weather, setWeather] = useState<Weather | null>(null)
  const [dailySuggestion, setDailySuggestion] = useState<string | null>(null)
  const [guideLoading, setGuideLoading] = useState(false)

  const [copiedWifi, setCopiedWifi] = useState(false)
  const [copiedDoor, setCopiedDoor] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [expandedGuideCategory, setExpandedGuideCategory] = useState<string | null>(null)

  const [pushNotifState, setPushNotifState] = useState<PushNotifState>('loading')
  const [pushNotifBusy, setPushNotifBusy] = useState(false)
  const [pushNotifError, setPushNotifError] = useState('')
  const [canInstall, setCanInstall] = useState(false)
  const msgOpenedRef = useRef(false)
  const deferredInstallRef = useRef<any>(null)
  const autopromptFiredRef = useRef(false)
  // First-open-only neighbourhood blurb, per booking. Initialised synchronously to avoid a
  // flash of the blurb on returning opens. (No setter — the value is decided once at mount.)
  const [showBlurb] = useState<boolean>(() => {
    if (preview || !tokenParam) return true            // preview / no-token: always show
    try { return localStorage.getItem(`arrivly_guest_blurb_seen_${tokenParam}`) !== '1' }
    catch { return true }
  })
  const blurbFlagRef = useRef(false)

  // SEO — the guest page must NOT be indexed (Viator licence requires marketplace
  // content not be crawled/indexed). Injected only while GuestPage is mounted, and
  // removed on unmount so the landing page and dashboard are never noindexed.
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => { meta.remove() }
  }, [])

  // Bookable experiences — fetched once when the Explore tab is first opened (only when
  // the feature flag is on). The entry card renders only if this returns content.
  useEffect(() => {
    if (!EXPERIENCES_ENABLED) return
    if (activeTab !== 'explore') return
    if (experiences !== null || experiencesLoading) return
    const targetApt = apartment?.id
    if (!targetApt) return
    let cancelled = false
    setExperiencesLoading(true)
    fetch('/api/experiences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apartmentId: targetApt }),
    })
      .then(r => r.ok ? r.json() : { experiences: [], gygCityLink: null })
      .then((data: { experiences?: ExperienceItem[]; gygCityLink?: string | null }) => {
        if (cancelled) return
        setExperiences(Array.isArray(data.experiences) ? data.experiences : [])
        setGygCityLink(typeof data.gygCityLink === 'string' ? data.gygCityLink : null)
      })
      .catch(() => { if (!cancelled) { setExperiences([]); setGygCityLink(null) } })
      .finally(() => { if (!cancelled) setExperiencesLoading(false) })
    return () => { cancelled = true }
    // NOTE: experiencesLoading is intentionally NOT a dep — it is set inside this
    // effect; listing it would re-run (and cancel) the in-flight fetch, leaving the
    // spinner stuck forever. The `experiences` data guard alone blocks a re-fetch
    // once it populates (mirrors the guide effect's guideLoading handling).
  }, [activeTab, apartment?.id, experiences])

  useEffect(() => {
    if (!aptId) { setLoading(false); setPageState('neutral'); return }

    if (preview) {
      let cancelled = false
      api.get<{ apartment: Apartment; host: Host; details: Detail[]; hostPicks: HostPick[]; guide: Record<string, unknown> }>(`/guest-preview?apt=${aptId}`)
        .then(payload => {
          if (cancelled) return
          setApartment(payload.apartment)
          setHost(payload.host)
          setDetails(payload.details)
          setHostPicks(payload.hostPicks)
          const cats = payload.guide as GuideCategories
          if (cats && Object.keys(cats).length > 0) setGuideCategories(cats)
          setGuestName(PREVIEW_SAMPLE_NAME)
          setPageState('active')
          setLoading(false)
        })
        .catch(() => {
          if (cancelled) return
          setPageState('neutral')
          setLoading(false)
        })
      return () => { cancelled = true }
    }

    async function fetchData() {
      const storageKey = `arrivly_guest_token_${aptId}`
      const storedToken = localStorage.getItem(storageKey)
      const cleanedStored = storedToken && storedToken !== 'null' ? storedToken : null
      const activeToken = tokenParam && tokenParam !== 'null' ? tokenParam : cleanedStored ?? null

      const [aptRes, detRes] = await Promise.all([
        supabase
          .from('apartments')
          .select('id,host_id,name,neighborhood,city,country,lat,lng,accent_color,max_guests,hero_image_url,city_image_url,city_image_credit,greeting_blurb')
          .eq('id', aptId!)
          .maybeSingle(),
        supabase
          .from('apartment_details')
          .select('id,category,content,is_private')
          .eq('apartment_id', aptId!),
      ])

      if (!aptRes.data) {
        // The anon read returns nothing for a hidden (unpublished) apartment because
        // RLS apartments_guest_read gates on is_visible. Ask the server whether this
        // apt exists-but-is-hidden so we can show a branded "temporarily unavailable"
        // screen instead of the booking-oriented neutral page. Any failure → neutral.
        try {
          const r = await fetch(`/api/guest-availability?apt=${encodeURIComponent(aptId!)}`)
          if (r.ok) {
            const a = await r.json()
            if (a.status === 'draft' && a.brand) {
              setUnavailableBrand(a.brand)
              setPageState('unavailable')
              setLoading(false)
              return
            }
          }
        } catch {
          // network/parse error → fall through to neutral
        }
        setPageState('neutral'); setLoading(false); return
      }
      const apt = aptRes.data as Apartment
      setApartment(apt)
      setDetails(((detRes.data ?? []) as Detail[]).filter(d => !d.is_private))

      const { data: hostRows } = await supabase
        .rpc('guest_host_card', { p_apartment_id: aptId! })
      const hostData = (hostRows as Host[] | null)?.[0] ?? null
      if (hostData) setHost(hostData)

      if (hostData?.subscription_status === 'expired') {
        setPageState('expired')
        setLoading(false)
        return
      }

      // STAGE A — token path, resolved server-side by /api/guest-state.
      // Guests have no auth session, so use plain fetch (not the api helper).
      if (activeToken) {
        let aState: { state: string; token: string | null; guestName: string | null } =
          { state: 'neutral', token: null, guestName: null }
        try {
          const r = await fetch(`/api/guest-state?apt=${encodeURIComponent(aptId!)}&token=${encodeURIComponent(activeToken)}`)
          if (r.ok) aState = await r.json()
        } catch {
          // network/parse error → treat as neutral and fall through to Stage B
        }

        if (aState.state === 'thankyou') {
          if (aState.guestName) setThankYouName(aState.guestName)
          setPageState('thankyou')
          setLoading(false)
          return
        }

        if (aState.state === 'active') {
          localStorage.setItem(storageKey, activeToken)

          if (!tokenParam) {
            window.location.replace(`/guest?apt=${aptId}&token=${activeToken}`)
            return
          }

          const publicRows = ((detRes.data ?? []) as Detail[]).filter(d => !d.is_private)
          try {
            const r = await fetch(`/api/guest-details?apt=${encodeURIComponent(aptId!)}&token=${encodeURIComponent(activeToken)}`)
            if (r.ok) {
              const { details: priv } = await r.json()
              setDetails([...publicRows, ...(Array.isArray(priv) ? priv as Detail[] : [])])
            } else {
              setDetails(publicRows)
            }
          } catch {
            setDetails(publicRows)
          }

          if (aState.guestName) setGuestName(aState.guestName)

          const weatherUrl = apt.lat != null && apt.lng != null
            ? `https://wttr.in/${apt.lat},${apt.lng}?format=j1`
            : `https://wttr.in/${encodeURIComponent(`${apt.neighborhood}, ${apt.city}`)}?format=j1`
          fetch(weatherUrl)
            .then(r => r.json())
            .then(data => {
              const cur = data.current_condition?.[0]
              if (!cur) return
              const temp = Math.round(Number(cur.temp_C))
              const desc = (cur.weatherDesc?.[0]?.value ?? '').toLowerCase()
              let icon = '🌤'
              let isOutdoor = false
              if (desc.includes('sunny') || desc.includes('clear')) { icon = '☀️'; isOutdoor = true }
              else if (desc.includes('partly')) { icon = '⛅'; isOutdoor = true }
              else if (desc.includes('overcast') || desc.includes('cloudy')) { icon = '☁️' }
              else if (desc.includes('snow') || desc.includes('blizzard')) { icon = '❄️'; isOutdoor = true }
              else if (desc.includes('thunder') || desc.includes('storm')) { icon = '⛈' }
              else if (desc.includes('rain') || desc.includes('drizzle') || desc.includes('shower')) { icon = '🌧' }
              else if (desc.includes('mist') || desc.includes('fog')) { icon = '🌫' }
              const condition = desc.charAt(0).toUpperCase() + desc.slice(1)
              setWeather({ temp, condition, isOutdoorWeather: isOutdoor, icon })
            })
            .catch(() => {})

          setPageState('active')
          setLoading(false)
          return
        }
        // 'neutral' → fall through to Stage B
      }

      // STAGE B — keyed date path. The tokenless date-lookup only resolves with a
      // valid per-apartment key; without one /api/guest-state returns neutral.
      let bState: { state: string; token: string | null } = { state: 'neutral', token: null }
      try {
        const url = keyParam
          ? `/api/guest-state?apt=${encodeURIComponent(aptId!)}&key=${encodeURIComponent(keyParam)}`
          : `/api/guest-state?apt=${encodeURIComponent(aptId!)}`
        const r = await fetch(url)
        if (r.ok) bState = await r.json()
      } catch {
        // network/parse error → neutral
      }

      if (bState.state === 'active' && bState.token) {
        const resolvedToken = bState.token
        const existing = localStorage.getItem(storageKey)
        if (existing && existing !== 'null' && existing !== resolvedToken) {
          setPageState('neutral')
          setLoading(false)
          return
        }
        localStorage.setItem(storageKey, resolvedToken)
        window.location.replace(`/guest?apt=${aptId}&token=${resolvedToken}`)
        return
      }

      setPageState('neutral')
      setLoading(false)
    }

    fetchData()
  }, [aptId, tokenParam, keyParam, preview])

  useEffect(() => {
    if (activeTab !== 'explore' || !aptId) return
    if (preview) return
    if (guideCategories) return

    let cancelled = false

    async function fetchExplore() {
      setGuideLoading(true)
      const [picksRes, guideRes] = await Promise.all([
        supabase
          .from('host_picks')
          .select('id,name,category,address,lat,lng,note,display_order')
          .eq('apartment_id', aptId!)
          .order('display_order'),
        supabase
          .from('guide_recommendations')
          .select('categories')
          .eq('apartment_id', aptId!)
          .maybeSingle(),
      ])
      if (cancelled) return
      if (picksRes.data) setHostPicks(picksRes.data as HostPick[])
      const cats = guideRes.data?.categories as GuideCategories | undefined
      if (cats && Object.keys(cats).length > 0) setGuideCategories(cats)
      setGuideLoading(false)
    }
    fetchExplore()

    return () => { cancelled = true }
  }, [activeTab, aptId, hostPicks.length, guideCategories, preview])

  // Keep the launch pointer alive exactly while the booking is active; prune it once
  // the booking ends so a stale pointer can't hijack a later host install.
  useEffect(() => {
    if (pageState === 'loading') return
    if (pageState === 'active' && aptId && tokenParam) {
      try {
        localStorage.setItem('arrivly_last_guest', JSON.stringify({ apt: aptId, token: tokenParam }))
      } catch {}
    } else if (pageState === 'thankyou' || pageState === 'neutral' || pageState === 'expired') {
      try {
        localStorage.removeItem('arrivly_last_guest')
      } catch {}
    }
  }, [pageState, aptId, tokenParam])

  // Clear guest app-icon badge as soon as the guest page is active.
  useEffect(() => {
    if (pageState !== 'active') return
    if (!('clearAppBadge' in navigator)) return
    void (navigator as any).clearAppBadge()
  }, [pageState])

  // &msg=1 deep-link: auto-open the messages thread when arriving from a host push notification.
  useEffect(() => {
    if (msgOpenedRef.current) return
    if (pageState !== 'active' || !tokenParam || msgParam !== '1') return
    msgOpenedRef.current = true
    setActiveTab('more')
    setShowMessages(true)
    if ('clearAppBadge' in navigator) void (navigator as any).clearAppBadge()
  }, [pageState, tokenParam, msgParam])

  // Capture beforeinstallprompt for the More-tab 'needs-install' CTA.
  // Both this and InstallPrompt capture the event — a deferred prompt can only be
  // .prompt()-ed once; whichever surface the guest taps first consumes it.
  useEffect(() => {
    function handleInstall(e: Event) {
      e.preventDefault()
      deferredInstallRef.current = e
      setCanInstall(true)
    }
    window.addEventListener('beforeinstallprompt', handleInstall)
    return () => window.removeEventListener('beforeinstallprompt', handleInstall)
  }, [])

  // Permanent push notification state for the More tab.
  // Order: ios → unsupported → tab(needs-install) → blocked/on/off
  useEffect(() => {
    if (activeTab !== 'more' || !tokenParam || pageState !== 'active') return
    let cancelled = false
    setPushNotifState('loading')
    async function computePushState() {
      if (iosNeedsHomeScreen()) {
        if (!cancelled) setPushNotifState('ios')
        return
      }
      if (!('PushManager' in window)) {
        if (!cancelled) setPushNotifState('unsupported')
        return
      }
      if (!isStandalone()) {
        if (!cancelled) setPushNotifState('needs-install')
        return
      }
      const perm = await checkPermission()
      if (cancelled) return
      if (perm === 'denied') { setPushNotifState('blocked'); return }
      const subscribed = await isSubscribed()
      if (!cancelled) setPushNotifState(subscribed ? 'on' : 'off')
    }
    computePushState()
    return () => { cancelled = true }
  }, [activeTab, tokenParam, pageState])

  // First-launch auto-enable when running as the installed PWA.
  // Fires once per mount (ref guard) and once per booking across relaunches (localStorage flag).
  useEffect(() => {
    if (!isStandalone() || !aptId || !tokenParam || pageState !== 'active') return
    if (autopromptFiredRef.current) return
    autopromptFiredRef.current = true
    const flagKey = `arrivly_guest_push_autoprompt_${tokenParam}`
    let flagSet = false
    try { flagSet = localStorage.getItem(flagKey) === '1' } catch {}
    if (flagSet) return
    async function tryAutoEnable() {
      const perm = await checkPermission()
      const subscribed = await isSubscribed()
      try { localStorage.setItem(flagKey, '1') } catch {}
      if (perm === 'default' && !subscribed) {
        handleMoreTabPushEnable()
      }
    }
    tryAutoEnable()
  }, [pageState, aptId, tokenParam])

  // Mark this booking's blurb as seen once the active page mounts, so the NEXT launch's
  // initialiser returns false. Gated exactly like the autoprompt effect — a neutral/non-active
  // visit must NOT consume the first-open blurb. (Do not setShowBlurb here.)
  useEffect(() => {
    if (pageState !== 'active' || preview || !tokenParam) return
    if (blurbFlagRef.current) return
    blurbFlagRef.current = true
    try { localStorage.setItem(`arrivly_guest_blurb_seen_${tokenParam}`, '1') } catch {}
  }, [pageState, tokenParam, preview])

  const rulesRaw = useMemo(() =>
    details
      .filter(d => /rule|house|policy|policies|guidelines/i.test(d.category ?? ''))
      .map(d => d.content)
      .join('\n'),
    [details]
  )


  const accentColor = apartment?.accent_color ?? host?.accent_color ?? ARRIVLY_CONFIG.colourPresets[0].hex
  const brandName = host?.brand_name ?? 'Your Host'
  const showPoweredBy = host?.subscription_status === 'trial' || host?.subscription_status === 'grace'
  // Show the "Tours & tickets" entry only once the experiences fetch has content (or is loading).
  const showExperiencesEntry =
    EXPERIENCES_ENABLED && (experiencesLoading || (experiences?.length ?? 0) > 0 || !!gygCityLink)

  const wifiDetails = details.filter(d => /wifi|wi-fi|internet|wireless/i.test(d.category ?? ''))
  const wifiParsed = wifiDetails.length > 0
    ? parseWifi(wifiDetails.map(d => d.content).join('\n'))
    : null

  const previewWifiReply: string = (() => {
    if (!wifiParsed) return "Your WiFi details are on the Home tab — tap over there to see them."
    const parts: string[] = []
    if (wifiParsed.network) parts.push(`network ${wifiParsed.network}`)
    if (wifiParsed.password) parts.push(`password ${wifiParsed.password}`)
    return parts.length
      ? `Of course — ${parts.join(', ')}. It's also on your Home tab.`
      : "Your WiFi details are on the Home tab — tap over there to see them."
  })()

  const checkinDetails = details.filter(
    d => /check.?in|check.?out|timing|door|code|entry/i.test(d.category ?? '') && d.is_private
  )

  const extras = details.filter(d => EXTRAS_CATEGORIES.includes(d.category))

  const copyText = useCallback((text: string, setDone: (v: boolean) => void) => {
    navigator.clipboard.writeText(text).then(() => {
      setDone(true)
      setTimeout(() => setDone(false), 2000)
    })
  }, [])

  const shareUrl = (() => {
    if (typeof window === 'undefined') return ''
    if (!preview) return window.location.href
    const u = new URL(window.location.href)
    u.searchParams.delete('preview')
    return u.toString()
  })()
  const handleShare = () => {
    if (navigator.share) {
      navigator.share({ title: brandName, url: shareUrl }).catch(() => {})
    } else {
      const wa = host?.whatsapp?.replace(/\D/g, '') ?? ''
      const target = wa
        ? `https://wa.me/${wa}?text=${encodeURIComponent('My guest page: ' + shareUrl)}`
        : `https://wa.me/?text=${encodeURIComponent('My guest page: ' + shareUrl)}`
      window.open(target, '_blank')
    }
  }

  async function handleMoreTabPushEnable() {
    if (!apartment || !tokenParam) return
    setPushNotifBusy(true)
    setPushNotifError('')
    const result = await subscribeGuestToPush(apartment.id, tokenParam)
    setPushNotifBusy(false)
    if (result.ok) {
      setPushNotifState('on')
    } else if (result.reason === 'denied') {
      setPushNotifState('blocked')
    } else {
      setPushNotifError(
        "Your phone couldn't enable notifications — you'll still see replies when you open this page."
      )
    }
  }

  // Progressive enhancement: fetch a personalised time/weather-aware suggestion for the hero.
  // Keyed on weather so the call includes current conditions if available; server caches by
  // (apartment, date, day_part) so a second call after weather loads returns the cached row.
  // Skip in preview mode (no verified token → server always returns null anyway).
  useEffect(() => {
    if (preview) return
    if (pageState !== 'active') return
    if (!aptId || !tokenParam) return
    // Plain fetch — guests have no auth session; api.post would attach a null Bearer header
    // which is harmless but violates the guest-page convention (see CLAUDE.md lessons).
    fetch('/api/daily-greeting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apt: aptId,
        token: tokenParam,
        day_part: getDayPart(),
        temp: weather?.temp ?? null,
        condition: weather?.condition ?? null,
      }),
    })
      .then(r => r.json())
      .then((r: { suggestion: string | null }) => setDailySuggestion(r.suggestion))
      .catch(() => {})
  }, [aptId, tokenParam, weather, preview, pageState])

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white">
        <RefreshCw className="animate-spin" size={32} style={{ color: accentColor }} />
      </div>
    )
  }

  if (pageState === 'expired') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#fbfaf7] px-6 py-16 text-center">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mb-6 text-white font-semibold text-xl"
          style={{ background: accentColor }}
        >
          {brandName.charAt(0)}
        </div>
        <h1 className="font-['Fraunces'] font-light text-2xl tracking-tight text-[#1c1c1a] mb-2">{brandName}</h1>
        <p className="text-sm text-[#9a958c] max-w-xs leading-relaxed">
          This guest page is temporarily unavailable. Please contact your host directly.
        </p>
      </div>
    )
  }

  if (pageState === 'unavailable') {
    const uAccent = unavailableBrand?.accent_color ?? ARRIVLY_CONFIG.colourPresets[0].hex
    const uBrand = unavailableBrand?.brand_name ?? 'Your Host'
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#fbfaf7] px-6 py-16 text-center">
        {unavailableBrand?.logo_url ? (
          <img src={resolveImageUrl(unavailableBrand.logo_url)} alt={uBrand} className="h-12 mb-6 object-contain" />
        ) : (
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mb-6 text-white font-semibold text-xl"
            style={{ background: uAccent }}
          >
            {uBrand.charAt(0)}
          </div>
        )}
        <h1 className="font-['Fraunces'] font-light text-2xl tracking-tight text-[#1c1c1a] mb-2">{uBrand}</h1>
        <p className="text-sm text-[#9a958c] max-w-xs leading-relaxed">
          This guest page is temporarily unavailable. Please contact your host directly.
        </p>
      </div>
    )
  }

  if (pageState === 'neutral') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#fbfaf7] px-6 py-16 text-center">
        {host?.logo_url ? (
          <img src={resolveImageUrl(host.logo_url)} alt={brandName} className="h-12 mb-6 object-contain" />
        ) : (
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mb-6 text-white font-semibold text-xl"
            style={{ background: accentColor }}
          >
            {brandName.charAt(0)}
          </div>
        )}
        <h1 className="font-['Fraunces'] font-light text-[28px] tracking-tight text-[#1c1c1a] mb-2">{brandName}</h1>
        <p className="text-sm text-[#5b5853] max-w-xs leading-relaxed mb-8">
          Welcome. There is no active booking for today — scan your check-in QR code to access your guest page.
        </p>
        {showPoweredBy && (
          <p className="text-[10px] text-[#9a958c] mt-8">{ARRIVLY_CONFIG.poweredByText}</p>
        )}
      </div>
    )
  }

  if (pageState === 'thankyou') {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: accentColor }}>
        <div className="flex-1 flex flex-col items-center justify-center px-8 py-16 text-center">
          {host?.logo_url && (
            <img src={resolveImageUrl(host.logo_url)} alt={brandName} className="h-10 mb-8 object-contain opacity-90" />
          )}
          <p className="text-white/70 text-[11px] tracking-[0.22em] uppercase mb-4">{brandName}</p>
          <h1 className="font-['Fraunces'] font-light text-[34px] leading-tight tracking-tight text-white mb-4">
            Until next time{thankYouName ? `, ${thankYouName}` : ''}.
          </h1>
          <p className="text-white/70 text-base leading-relaxed max-w-xs">
            Thank you for your stay. We hope you had a wonderful time.
          </p>
        </div>
        {showPoweredBy && (
          <p className="text-white/30 text-[10px] text-center pb-6">{ARRIVLY_CONFIG.poweredByText}</p>
        )}
      </div>
    )
  }

  // pageState === 'active'
  const apt = apartment!

  const salutation = getTimeSalutation()
  const dp = getDayPart()
  const dayPartLabel = dp[0].toUpperCase() + dp.slice(1)
  const blurb = apt.greeting_blurb?.trim()
    || `You're in ${apt.neighborhood} — a wonderful part of ${apt.city} to explore.`
  const staticWeatherLine: string | null = weather
    ? weather.isOutdoorWeather
      ? 'A lovely day to be out and about — the guide below has ideas.'
      : /rain|storm|drizzle|shower/.test(weather.condition.toLowerCase())
        ? "A cosy day to explore the neighbourhood's indoor gems."
        : 'A fine day to wander and see where the streets take you.'
    : null

  // Hero precedence: host upload → cached by-city image (with credit) → static fallback.
  const heroSrc = apt.hero_image_url
    ? resolveImageUrl(apt.hero_image_url)
    : (apt.city_image_url || FALLBACK_HERO)
  let heroCredit: { name: string; userLink: string; unsplashLink: string } | null = null
  if (!apt.hero_image_url && apt.city_image_url && apt.city_image_credit) {
    try { heroCredit = JSON.parse(apt.city_image_credit) } catch { heroCredit = null }
  }

  // First door/entry code found in the private check-in rows — surfaced as a one-tap
  // copy cell in the home quick-access strip (same regex the check-in card uses).
  const quickDoorCode: string | null = (() => {
    for (const d of checkinDetails) {
      const m = d.content.match(/(?:code|door|entry)[:\s]+([^\n\r]+)/i)
      if (m) return m[1].trim()
    }
    return null
  })()

  return (
    <div className="min-h-screen bg-[#fbfaf7] font-sans">

      {preview && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-[#1a1a1a] text-white text-[11px] py-2 px-4 flex items-center justify-center gap-3">
          <span className="tracking-wide">Preview — what your guests see</span>
          <button
            onClick={() => { try { window.close() } catch { history.back() } }}
            className="text-white/60 hover:text-white text-[10px] uppercase tracking-widest bg-white/10 px-2 py-0.5 rounded border border-white/20 cursor-pointer"
          >
            Exit
          </button>
        </div>
      )}

      {activeTab === 'home' && (
        <div className="pb-28 bg-[#fbfaf7]">
          {/* Immersive, photo-forward hero with a neutral dark scrim */}
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
                {apt.city}{apt.country ? `, ${apt.country}` : ''}
              </p>
              <h1 className="font-['Fraunces'] font-light text-[40px] leading-none tracking-tight">
                Welcome to {apt.neighborhood}.
              </h1>
              <p className="font-['Fraunces'] font-light text-[18px] leading-snug opacity-90 mt-3 max-w-[280px]">
                Your apartment is ready — and so is one of {apt.city}&apos;s most memorable corners.
              </p>
              <div className="mt-5 flex items-center gap-2.5">
                {host?.logo_url ? (
                  <img src={resolveImageUrl(host.logo_url)} alt={brandName} className="w-[38px] h-[38px] rounded-full object-cover ring-1 ring-white/40" />
                ) : (
                  <span className="w-[38px] h-[38px] rounded-full bg-white/15 ring-1 ring-white/40 flex items-center justify-center text-sm font-semibold">
                    {brandName.charAt(0)}
                  </span>
                )}
                <span className="font-['Fraunces'] italic text-[15px] opacity-90">— {brandName}</span>
              </div>
            </div>
            <div className="absolute bottom-3 left-0 right-0 flex flex-col items-center gap-1.5 pointer-events-none">
              <div className="w-px h-[22px] bg-white/50" />
              <span className="text-[9.5px] tracking-[0.24em] uppercase text-white/60">Scroll</span>
            </div>
          </div>

          {/* The letter */}
          <div className="max-w-lg mx-auto px-6 pt-9 pb-4">
            <h2 className="font-['Fraunces'] font-normal text-[27px] tracking-tight text-[#1c1c1a]">
              Dear {guestName ? guestName : 'guest'},
            </h2>
            <p className="text-[15px] leading-relaxed text-[#36322c] mt-4">
              {salutation}.{showBlurb ? ` ${blurb}` : ''}
            </p>
            <p className="text-[15px] leading-relaxed text-[#36322c] mt-3">
              Need a quick answer? The assistant in the Chat tab knows the apartment and the city. Want to reach me directly? Message me just below — I&apos;ll get a notification and reply right here.
            </p>
            <div className="mt-5 flex justify-end">
              <p className="font-['Fraunces'] italic text-[15px]" style={{ color: accentColor }}>— {brandName}</p>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <div className="flex-1 h-px bg-[#e9e4d9]" />
              <span className="text-xs" style={{ color: accentColor }}>✦</span>
              <div className="flex-1 h-px bg-[#e9e4d9]" />
            </div>
          </div>

          {/* Right now — the visibly-fresh time/weather/suggestion element (moved out of the letter) */}
          {(dailySuggestion || staticWeatherLine) && (
            <div className="max-w-lg mx-auto px-6 pt-3 pb-2">
              <div className="bg-[#fffdf9] border border-[#e9e4d9] rounded-2xl overflow-hidden shadow-[0_1px_5px_rgba(0,0,0,0.04)]">
                <div className="h-[3px]" style={{ background: accentColor }} />
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-2.5">
                    <div>
                      <p className="text-[10px] tracking-widest uppercase font-semibold" style={{ color: accentColor }}>Right now</p>
                      <p className="text-[11px] text-[#9a958c] mt-0.5">{dayPartLabel}</p>
                    </div>
                    {weather && (
                      <span className="shrink-0 text-[11px] text-[#9a958c] bg-[#fbfaf7] border border-[#e9e4d9] rounded-full px-2.5 py-1">
                        {weather.temp}°C · {weather.condition} {weather.icon}
                      </span>
                    )}
                  </div>
                  <p className="text-[15px] leading-relaxed text-[#36322c]">
                    {dailySuggestion ? dailySuggestion : staticWeatherLine}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Message host directly — same trigger as the More-tab messages button */}
          {tokenParam && (
            <div className="max-w-lg mx-auto px-6 pb-2">
              <button
                onClick={() => {
                  setShowMessages(true)
                  if ('clearAppBadge' in navigator) void (navigator as any).clearAppBadge()
                }}
                className="w-full flex items-center gap-3.5 bg-[#fffdf9] border border-[#e9e4d9] rounded-2xl p-4 shadow-[0_1px_5px_rgba(0,0,0,0.04)] text-left cursor-pointer"
              >
                {host?.logo_url ? (
                  <img src={resolveImageUrl(host.logo_url)} alt={brandName} className="w-11 h-11 rounded-full object-cover shrink-0" />
                ) : (
                  <span className="w-11 h-11 rounded-full flex items-center justify-center text-white text-base font-semibold shrink-0" style={{ background: accentColor }}>
                    {brandName.charAt(0)}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[14px] text-[#1c1c1a]">Message {brandName} directly</p>
                  <p className="text-[11.5px] text-[#5b5853] leading-snug mt-0.5">A question, a request, or a local tip — I&apos;ll reply right here.</p>
                </div>
                <span className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center" style={{ background: accentColor + '14', color: accentColor }}>
                  <MessageCircle size={16} />
                </span>
              </button>
            </div>
          )}

          {/* Quick access — only cells whose data exists */}
          {((wifiParsed?.password) || quickDoorCode || (apt.lat != null && apt.lng != null)) && (
            <div className="max-w-lg mx-auto px-6 pt-3 pb-2">
              <p className="text-[10px] tracking-widest uppercase text-[#9a958c] mb-2.5">Quick access</p>
              <div className="grid grid-cols-3 gap-2.5">
                {wifiParsed?.password && (
                  <button
                    onClick={() => copyText(wifiParsed!.password, setCopiedWifi)}
                    className="bg-[#fffdf9] border border-[#e9e4d9] rounded-xl p-3 flex flex-col items-start gap-2 text-left cursor-pointer"
                  >
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: accentColor + '14', color: accentColor }}>
                      <Wifi size={15} />
                    </span>
                    <span className="text-[10px] tracking-widest uppercase text-[#9a958c]">WiFi</span>
                    <span className="text-[13px] font-medium text-[#1c1c1a]">{copiedWifi ? 'Copied' : 'Copy'}</span>
                  </button>
                )}
                {quickDoorCode && (
                  <button
                    onClick={() => copyText(quickDoorCode, setCopiedDoor)}
                    className="bg-[#fffdf9] border border-[#e9e4d9] rounded-xl p-3 flex flex-col items-start gap-2 text-left cursor-pointer"
                  >
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: accentColor + '14', color: accentColor }}>
                      <KeyRound size={15} />
                    </span>
                    <span className="text-[10px] tracking-widest uppercase text-[#9a958c]">Door</span>
                    <span className="text-[13px] font-medium text-[#1c1c1a] truncate w-full">{copiedDoor ? 'Copied' : quickDoorCode}</span>
                  </button>
                )}
                {apt.lat != null && apt.lng != null && (
                  <a
                    href={getDirectionsUrl(apt.lat, apt.lng)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-[#fffdf9] border border-[#e9e4d9] rounded-xl p-3 flex flex-col items-start gap-2 text-left no-underline"
                  >
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: accentColor + '14', color: accentColor }}>
                      <Navigation size={15} />
                    </span>
                    <span className="text-[10px] tracking-widest uppercase text-[#9a958c]">Home</span>
                    <span className="text-[13px] font-medium text-[#1c1c1a]">Directions</span>
                  </a>
                )}
              </div>
            </div>
          )}

          {/* WiFi — the primary card */}
          {wifiParsed && (wifiParsed.network || wifiParsed.password) && (
            <div className="max-w-lg mx-auto px-6 pt-3 pb-2">
              <div className="bg-[#fffdf9] border border-[#e9e4d9] rounded-2xl overflow-hidden shadow-[0_1px_5px_rgba(0,0,0,0.04)]">
                <div className="h-[3px]" style={{ background: accentColor }} />
                <div className="p-5">
                  <p className="text-[10px] tracking-widest uppercase text-[#9a958c] mb-4">WiFi</p>
                  {wifiParsed.network && (
                    <div className="mb-3">
                      <p className="text-[10px] uppercase tracking-widest text-[#9a958c] mb-1">Network</p>
                      <p className="text-[#1c1c1a] font-medium">{wifiParsed.network}</p>
                    </div>
                  )}
                  {wifiParsed.network && wifiParsed.password && (
                    <div className="border-t border-[#e9e4d9] my-3" />
                  )}
                  {wifiParsed.password && (
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-[#9a958c] mb-2">Password</p>
                      <div className="flex items-center justify-between gap-4">
                        <span className="font-mono text-[20px] text-[#1c1c1a] tracking-widest break-all">
                          {wifiParsed.password}
                        </span>
                        <button
                          onClick={() => copyText(wifiParsed!.password, setCopiedWifi)}
                          className="flex items-center gap-1.5 text-[10px] tracking-widest uppercase px-3 py-2 rounded-lg shrink-0 border-none cursor-pointer"
                          style={{ background: accentColor + '14', color: accentColor }}
                        >
                          {copiedWifi ? <Check size={12} /> : <Copy size={12} />}
                          {copiedWifi ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Check-in info */}
          {checkinDetails.length > 0 && (
            <div className="max-w-lg mx-auto px-6 pt-3 pb-2">
              <div className="bg-[#fffdf9] border border-[#e9e4d9] rounded-[14px] p-5 shadow-[0_1px_5px_rgba(0,0,0,0.04)]">
                <p className="text-[10px] tracking-widest uppercase text-[#9a958c] mb-4">Check-in info</p>
                <div className="space-y-3">
                  {checkinDetails.map(d => {
                    const doorCodeMatch = d.content.match(/(?:code|door|entry)[:\s]+([^\n\r]+)/i)
                    const doorCode = doorCodeMatch ? doorCodeMatch[1].trim() : null
                    return (
                      <div key={d.id}>
                        <p className="text-[10px] uppercase tracking-widest text-[#9a958c] mb-1">{d.category}</p>
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-[#1c1c1a] text-sm leading-relaxed">{d.content}</p>
                          {doorCode && (
                            <button
                              onClick={() => copyText(doorCode, setCopiedDoor)}
                              className="shrink-0 flex items-center gap-1 text-[10px] tracking-widest uppercase px-2 py-1 rounded-md border cursor-pointer bg-transparent"
                              style={{ borderColor: accentColor, color: accentColor }}
                            >
                              {copiedDoor ? <Check size={10} /> : <Copy size={10} />}
                              {copiedDoor ? 'Copied' : 'Copy'}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* House rules */}
          {rulesRaw && (
            <div className="max-w-lg mx-auto px-6 pt-3 pb-2">
              <div className="bg-[#fffdf9] border border-[#e9e4d9] rounded-[14px] p-5 shadow-[0_1px_5px_rgba(0,0,0,0.04)]">
                <p className="text-[10px] tracking-widest uppercase text-[#9a958c] mb-2">House rules</p>
                <h2 className="font-['Fraunces'] font-normal text-[19px] tracking-tight text-[#1c1c1a]">Before you settle in</h2>
                <p className="text-sm text-[#9a958c] italic mt-1 mb-4 leading-relaxed">
                  A few small things that keep everything running smoothly.
                </p>
                <p className="text-[#36322c] text-sm leading-relaxed whitespace-pre-line">
                  {rulesRaw}
                </p>
              </div>
            </div>
          )}

          {/* Good to know */}
          {extras.length > 0 && (
            <div className="max-w-lg mx-auto px-6 pt-3 pb-2">
              <h2 className="font-['Fraunces'] font-normal text-[19px] tracking-tight text-[#1c1c1a] mb-4 px-1">Good to know</h2>
              <div className="space-y-3">
                {EXTRAS_CATEGORIES
                  .map(cat => extras.find(d => d.category === cat))
                  .filter((d): d is Detail => d !== undefined)
                  .map(d => (
                    <div key={d.id} className="bg-[#fffdf9] border border-[#e9e4d9] rounded-[14px] p-4 shadow-[0_1px_5px_rgba(0,0,0,0.04)]">
                      <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: accentColor }}>
                        {d.category}
                      </p>
                      <p className="text-sm text-[#36322c] leading-relaxed whitespace-pre-line">{d.content}</p>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'chat' && (
        <div style={{ height: 'calc(100vh - 64px)' }}>
          {preview ? (
            <div className="h-full flex flex-col bg-[#fbfaf7]">
              <div className="shrink-0 px-5 pt-5 pb-3 border-b border-gray-100">
                <p className="text-[10px] uppercase tracking-widest text-gray-400 text-center">Sample conversation</p>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3">
                <div className="flex justify-end">
                  <div
                    className="max-w-[75%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm text-white"
                    style={{ background: accentColor }}
                  >
                    Hi! What&apos;s the WiFi password?
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="max-w-[75%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm bg-white text-[#1c1c1a] shadow-sm">
                    {previewWifiReply}
                  </div>
                </div>
                <div className="flex justify-end">
                  <div
                    className="max-w-[75%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm text-white"
                    style={{ background: accentColor }}
                  >
                    Any good coffee nearby?
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="max-w-[75%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm bg-white text-[#1c1c1a] shadow-sm">
                    Happy to help — I know the neighbourhood well and your host&apos;s picks are in Explore.
                  </div>
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-gray-100 bg-white">
                <input
                  disabled
                  placeholder="Guests can type here…"
                  className="flex-1 bg-[#f8f6f2] border border-[#ddd8ce] rounded-full px-4 py-2 text-sm text-gray-400 outline-none cursor-default"
                />
                <button
                  disabled
                  className="shrink-0 px-4 py-2 rounded-full text-white text-xs font-semibold border-none opacity-50 cursor-default"
                  style={{ background: accentColor }}
                >
                  Send
                </button>
              </div>
            </div>
          ) : (
            <ChatBot
              apartmentId={apt.id}
              token={tokenParam ?? ''}
              accentColor={accentColor}
              brandName={brandName}
              guestName={guestName}
              city={apt.city}
            />
          )}
        </div>
      )}

      {activeTab === 'explore' && (
        <div className="pb-28 bg-[#fbfaf7]">
          <div className="px-6 pt-8 pb-6 text-white" style={{ background: accentColor }}>
            <p className="text-[10px] tracking-[0.16em] uppercase opacity-70 mb-1">Host picks & local guide</p>
            <h2 className="font-['Fraunces'] font-light text-2xl tracking-tight">Around {apt.neighborhood}</h2>
          </div>
          <div className="max-w-lg mx-auto px-6 pt-6 pb-8">
            {/* "Plan your time" eyebrow only appears once the experiences entry is shown */}
            {showExperiencesEntry && (
              <p className="text-[10px] tracking-widest uppercase text-[#9a958c] mb-2.5">Plan your time</p>
            )}

            {/* Events entry card */}
            <button
              onClick={() => setShowEvents(true)}
              className="flex items-center justify-between w-full p-4 rounded-[14px] cursor-pointer bg-[#fffdf9] border border-[#e9e4d9] text-left shadow-[0_1px_5px_rgba(0,0,0,0.04)]"
            >
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: accentColor + '14', color: accentColor }}>
                  <Calendar size={17} />
                </span>
                <div>
                  <p className="text-sm font-medium text-[#1c1c1a]">This week in {apt.city}</p>
                  <p className="text-xs text-[#9a958c]">Live local events, updated each time you open</p>
                </div>
              </div>
              <span style={{ color: accentColor }}>→</span>
            </button>

            {/* SLOT 1 — Tours & tickets (Phase I, live behind VITE_EXPERIENCES_ENABLED) */}
            {showExperiencesEntry && (
              <button
                onClick={() => setShowExperiences(true)}
                className="flex items-center justify-between w-full p-4 rounded-[14px] mt-2.5 bg-[#fffdf9] border border-[#e9e4d9] text-left shadow-[0_1px_5px_rgba(0,0,0,0.04)] cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: accentColor + '14', color: accentColor }}>
                    <Ticket size={17} />
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-[#1c1c1a]">Tours & tickets</p>
                      <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full" style={{ background: accentColor + '14', color: accentColor }}>Bookable</span>
                    </div>
                    <p className="text-xs text-[#9a958c]">Tours, tickets & experiences — book ahead</p>
                  </div>
                </div>
                <span style={{ color: accentColor }}>→</span>
              </button>
            )}

            <div className="mt-6">
              {guideLoading ? (
                <div className="flex items-center justify-center py-16 gap-2 text-[#9a958c]">
                  <RefreshCw size={18} className="animate-spin" />
                  <span className="text-sm">Loading guide…</span>
                </div>
              ) : (
                <>
                  {hostPicks.length > 0 && (
                    <div className="mb-8">
                      <div className="flex items-center gap-1.5 mb-3">
                        <Star size={12} style={{ color: accentColor }} />
                        <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: accentColor }}>
                          {brandName}'s picks
                        </p>
                      </div>
                      <div className="space-y-2">
                        {hostPicks.map(pick => (
                          <div key={pick.id} className="bg-[#fffdf9] border border-[#e9e4d9] rounded-[14px] p-4 shadow-[0_1px_5px_rgba(0,0,0,0.04)]">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <p className="text-sm font-medium text-[#1c1c1a]">{pick.name}</p>
                                  <span
                                    className="text-[10px] px-2 py-0.5 rounded-full shrink-0 font-medium"
                                    style={{ background: accentColor + '14', color: accentColor }}
                                  >
                                    {pick.category}
                                  </span>
                                </div>
                                {pick.address && (
                                  <p className="text-xs text-[#9a958c]">{pick.address}</p>
                                )}
                                {pick.note && (
                                  <p className="text-xs text-[#5b5853] italic mt-1 leading-relaxed">{pick.note}</p>
                                )}
                              </div>
                              <div className="shrink-0 flex items-center gap-1.5">
                                {/* SLOT 2 — Reserve (Phase I, inert + flag-gated; only on restaurant picks once SHOW_RESERVE_SLOT) */}
                                {SHOW_RESERVE_SLOT && pick.category === 'Restaurant' && (
                                  <span
                                    className="flex items-center gap-1 text-[10px] uppercase tracking-widest px-2.5 py-1.5 rounded text-white cursor-default"
                                    style={{ background: accentColor }}
                                  >
                                    Reserve
                                  </span>
                                )}
                                <a
                                  href={
                                    pick.lat !== null && pick.lng !== null
                                      ? getDirectionsUrl(pick.lat, pick.lng)
                                      : mapsSearchUrl(pick.name, pick.address)
                                  }
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0 flex items-center gap-1 text-[10px] uppercase tracking-widest px-2.5 py-1.5 rounded no-underline bg-transparent"
                                  style={{ color: accentColor, border: `1px solid ${accentColor}` }}
                                >
                                  <Navigation size={10} />
                                  Go
                                </a>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {guideCategories && Object.entries(guideCategories).length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-[#9a958c] mb-3">
                        Neighbourhood guide
                      </p>
                      <div className="space-y-2">
                        {Object.entries(guideCategories).map(([cat, places]) => {
                          if (!Array.isArray(places) || places.length === 0) return null
                          const isExpanded = expandedGuideCategory === cat
                          return (
                            <div key={cat} className="bg-[#fffdf9] border border-[#e9e4d9] rounded-[14px] overflow-hidden shadow-[0_1px_5px_rgba(0,0,0,0.04)]">
                              <button
                                onClick={() => setExpandedGuideCategory(isExpanded ? null : cat)}
                                className="w-full flex items-center justify-between px-4 py-3.5 border-none bg-transparent cursor-pointer text-left"
                              >
                                <span className="text-sm font-medium text-[#1c1c1a]">{cat}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-[#9a958c]">{places.length} places</span>
                                  <span
                                    className="text-sm transition-transform"
                                    style={{ transform: isExpanded ? 'rotate(45deg)' : 'none', color: accentColor }}
                                  >
                                    +
                                  </span>
                                </div>
                              </button>
                              {isExpanded && (
                                <div className="border-t border-[#e9e4d9] divide-y divide-[#f0ebe1]">
                                  {places.map((place, i) => (
                                    <div key={i} className="px-4 py-3">
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-medium text-[#1c1c1a]">{place.name}</p>
                                          {place.address && (
                                            <p className="text-xs text-[#9a958c] mt-0.5">{place.address}</p>
                                          )}
                                          {place.description && (
                                            <p className="text-xs text-[#5b5853] italic mt-1 leading-relaxed">
                                              {place.description}
                                            </p>
                                          )}
                                        </div>
                                        <a
                                          href={
                                            place.lat !== undefined && place.lng !== undefined
                                              ? getDirectionsUrl(place.lat, place.lng)
                                              : mapsSearchUrl(place.name, place.address)
                                          }
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="shrink-0 flex items-center gap-1 text-[10px] uppercase tracking-widest px-2.5 py-1.5 rounded no-underline bg-transparent"
                                          style={{ color: accentColor, border: `1px solid ${accentColor}` }}
                                        >
                                          <Navigation size={10} />
                                          Go
                                        </a>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {hostPicks.length === 0 && (!guideCategories || Object.keys(guideCategories).length === 0) && (
                    <div className="text-center py-16">
                      <MapPin size={32} className="mx-auto mb-3 text-[#d8d2c5]" />
                      <p className="text-sm text-[#9a958c]">Guide is being prepared by your host.</p>
                    </div>
                  )}
                </>
              )}
              <p className="text-[10px] text-[#9a958c] text-center mt-8">
                Location data ©{' '}
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  OpenStreetMap contributors
                </a>{' '}
                · Geocoding by{' '}
                <a
                  href="https://locationiq.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  LocationIQ
                </a>
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'more' && (
        <div className="pb-28 bg-[#fbfaf7]">
          <div className="px-6 pt-8 pb-6 text-white" style={{ background: accentColor }}>
            {host?.logo_url && (
              <img src={resolveImageUrl(host.logo_url)} alt={brandName} className="h-7 mb-2 object-contain" />
            )}
            <p className="text-[10px] tracking-[0.16em] uppercase opacity-70 mb-1">Settings</p>
            <h2 className="font-['Fraunces'] font-light text-2xl tracking-tight">{brandName}</h2>
          </div>

          <div className="max-w-lg mx-auto px-6 pt-6 space-y-3">

            {/* SECTION — This device: Install + Notifications as the two hero items */}
            {tokenParam && pushNotifState !== 'unsupported' && pushNotifState !== 'loading' && (
              <>
                <p className="text-[10px] tracking-widest uppercase text-[#9a958c]">This device</p>

                {/* INSTALL — only on needs-install (mutually exclusive with the Notifications card) */}
                {pushNotifState === 'needs-install' && (
                  <div className="bg-[#fffdf9] border border-[#e9e4d9] rounded-2xl p-[17px] shadow-[0_1px_5px_rgba(0,0,0,0.04)]">
                    <div className="flex items-start gap-3.5 mb-4">
                      <span className="w-[42px] h-[42px] rounded-xl flex items-center justify-center shrink-0" style={{ background: accentColor + '14', color: accentColor }}>
                        <Home size={19} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[15px] text-[#1c1c1a]">Install this page as an app</p>
                        <p className="text-[13px] text-[#5b5853] leading-snug mt-0.5">Open it from your home screen — even offline.</p>
                      </div>
                    </div>
                    {canInstall ? (
                      <button
                        onClick={async () => {
                          const prompt = deferredInstallRef.current
                          if (!prompt) return
                          deferredInstallRef.current = null
                          setCanInstall(false)
                          prompt.prompt()
                          await prompt.userChoice
                        }}
                        className="w-full py-3.5 rounded-xl text-white text-[10px] tracking-widest uppercase border-none cursor-pointer font-semibold"
                        style={{ background: accentColor }}
                      >
                        Install app →
                      </button>
                    ) : (
                      <div>
                        <button
                          onClick={() => copyText(shareUrl, setCopiedLink)}
                          className="w-full py-3.5 rounded-xl text-white text-[10px] tracking-widest uppercase border-none cursor-pointer font-semibold"
                          style={{ background: accentColor }}
                        >
                          {copiedLink ? 'Link copied ✓' : 'Copy link →'}
                        </button>
                        <p className="text-sm text-[#5b5853] mt-4 leading-relaxed">
                          Best on Chrome: paste this link in Chrome, then tap Install for one-tap notifications.
                        </p>
                        <p className="text-xs text-[#9a958c] mt-2">
                          In Firefox: tap the ⋮ menu, then 'Install' (or 'Add to Home Screen').
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* NOTIFICATIONS — off / on / blocked / ios */}
                {pushNotifState !== 'needs-install' && (
                  <div className="bg-[#fffdf9] border border-[#e9e4d9] rounded-2xl p-[17px] shadow-[0_1px_5px_rgba(0,0,0,0.04)]">
                    <div className="flex items-start gap-3.5 mb-4">
                      <span className="w-[42px] h-[42px] rounded-xl flex items-center justify-center shrink-0" style={{ background: accentColor + '14', color: accentColor }}>
                        <MessageCircle size={19} />
                      </span>
                      <div className="flex-1 min-w-0">
                        {pushNotifState === 'off' && (
                          <>
                            <p className="font-semibold text-[15px] text-[#1c1c1a]">Allow notifications</p>
                            <p className="text-[13px] text-[#5b5853] leading-snug mt-0.5">Get notified the moment {brandName} replies.</p>
                          </>
                        )}
                        {pushNotifState === 'on' && (
                          <>
                            <p className="font-semibold text-[15px] text-[#1c1c1a]">Notifications on</p>
                            <p className="text-[13px] text-[#5b5853] leading-snug mt-0.5">Notifications are on — you'll get your host's replies here and as a phone notification.</p>
                          </>
                        )}
                        {pushNotifState === 'blocked' && (
                          <>
                            <p className="font-semibold text-[15px] text-[#1c1c1a]">Notifications</p>
                            <p className="text-[13px] text-[#5b5853] leading-snug mt-0.5">Notifications are blocked in your browser settings.</p>
                          </>
                        )}
                        {pushNotifState === 'ios' && (
                          <>
                            <p className="font-semibold text-[15px] text-[#1c1c1a]">Notifications</p>
                            <p className="text-[13px] text-[#5b5853] leading-snug mt-0.5">Add this page to your Home Screen (Share → Add to Home Screen) to get notifications.</p>
                          </>
                        )}
                      </div>
                    </div>
                    {pushNotifState === 'off' && (
                      <>
                        {pushNotifError && (
                          <p className="text-xs text-red-500 mb-3">{pushNotifError}</p>
                        )}
                        <button
                          onClick={handleMoreTabPushEnable}
                          disabled={pushNotifBusy}
                          className="w-full py-3.5 rounded-xl text-white text-[10px] tracking-widest uppercase border-none cursor-pointer font-semibold disabled:opacity-50"
                          style={{ background: accentColor }}
                        >
                          {pushNotifBusy ? 'Enabling…' : 'Turn on notifications →'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}

            {/* PREVIEW — inert demo cards (preview has no token, so the real device section above doesn't render) */}
            {preview && (
              <>
                <p className="text-[10px] tracking-widest uppercase text-[#9a958c]">This device</p>
                <div className="bg-[#fffdf9] border border-[#e9e4d9] rounded-2xl p-[17px] shadow-[0_1px_5px_rgba(0,0,0,0.04)]">
                  <div className="flex items-start gap-3.5 mb-4">
                    <span className="w-[42px] h-[42px] rounded-xl flex items-center justify-center shrink-0" style={{ background: accentColor + '14', color: accentColor }}>
                      <MessageCircle size={19} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[15px] text-[#1c1c1a]">Message your host</p>
                      <p className="text-[13px] text-[#5b5853] leading-snug mt-0.5">Have a question or need something? Send a message — {brandName} will be notified and reply here.</p>
                    </div>
                  </div>
                  <button
                    disabled
                    className="w-full py-3.5 rounded-xl text-white text-[10px] tracking-widest uppercase border-none cursor-default font-semibold opacity-50"
                    style={{ background: accentColor }}
                  >
                    Open messages →
                  </button>
                  <p className="text-[11px] text-[#9a958c] mt-3 text-center">Available to your guests during their stay.</p>
                </div>
                <div className="bg-[#fffdf9] border border-[#e9e4d9] rounded-2xl p-[17px] shadow-[0_1px_5px_rgba(0,0,0,0.04)]">
                  <div className="flex items-start gap-3.5 mb-4">
                    <span className="w-[42px] h-[42px] rounded-xl flex items-center justify-center shrink-0" style={{ background: accentColor + '14', color: accentColor }}>
                      <Home size={19} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[15px] text-[#1c1c1a]">Allow notifications</p>
                      <p className="text-[13px] text-[#5b5853] leading-snug mt-0.5">Turn on notifications so you don&apos;t miss your host&apos;s reply.</p>
                    </div>
                  </div>
                  <button
                    disabled
                    className="w-full py-3.5 rounded-xl text-white text-[10px] tracking-widest uppercase border-none cursor-default font-semibold opacity-50"
                    style={{ background: accentColor }}
                  >
                    Turn on notifications →
                  </button>
                  <p className="text-[11px] text-[#9a958c] mt-3 text-center">Available to your guests during their stay.</p>
                </div>
              </>
            )}

            {/* SECTION — This page: Save + WhatsApp */}
            <p className="text-[10px] tracking-widest uppercase text-[#9a958c] pt-3">This page</p>

            <button
              onClick={handleShare}
              className="w-full flex items-center gap-3.5 bg-[#fffdf9] border border-[#e9e4d9] rounded-2xl p-4 shadow-[0_1px_5px_rgba(0,0,0,0.04)] text-left cursor-pointer"
            >
              <span className="w-[42px] h-[42px] rounded-xl flex items-center justify-center shrink-0" style={{ background: accentColor + '14', color: accentColor }}>
                <Copy size={18} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[14px] text-[#1c1c1a]">Save this page</p>
                <p className="text-[11.5px] text-[#5b5853] leading-snug mt-0.5">Send yourself the link to reopen it any time</p>
              </div>
              <span style={{ color: accentColor }}>→</span>
            </button>

            {host?.whatsapp && (
              <a
                href={`https://wa.me/${host.whatsapp.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3.5 bg-[#fffdf9] border border-[#e9e4d9] rounded-2xl p-4 shadow-[0_1px_5px_rgba(0,0,0,0.04)] no-underline"
              >
                <span className="w-[42px] h-[42px] rounded-xl bg-[#25D366] flex items-center justify-center shrink-0">
                  <MessageCircle size={18} className="text-white" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[14px] text-[#1c1c1a]">Message on WhatsApp</p>
                  <p className="text-[11.5px] text-[#5b5853] leading-snug mt-0.5">Prefer WhatsApp? Reach {brandName} there</p>
                </div>
                <span style={{ color: accentColor }}>→</span>
              </a>
            )}

            <div className="pt-6 pb-2 text-center">
              <p className="font-['Fraunces'] italic text-[15px] text-[#9a958c]">{brandName}</p>
              {showPoweredBy && (
                <p className="text-[10px] text-[#b3aa9b] mt-5">{ARRIVLY_CONFIG.poweredByText}</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 z-40 bg-[rgba(255,253,249,0.93)] backdrop-blur border-t border-[#e9e4d9] h-16 flex items-stretch">
        {(
          [
            { id: 'home', Icon: Home, label: 'Home' },
            { id: 'chat', Icon: MessageCircle, label: 'Chat' },
            { id: 'explore', Icon: MapPin, label: 'Explore' },
            { id: 'more', Icon: Settings, label: 'Settings' },
          ] as const
        ).map(({ id, Icon, label }) => {
          const isActive = activeTab === id
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 border-none bg-transparent cursor-pointer relative"
              style={{ color: isActive ? accentColor : '#a8a399' }}
            >
              {isActive && (
                <div
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-7 h-[3px] rounded-b"
                  style={{ background: accentColor }}
                />
              )}
              <Icon size={18} />
              <span className="text-[9px] tracking-widest uppercase font-medium">{label}</span>
            </button>
          )
        })}
      </div>

      {showEvents && (
        <EventsPage
          apartmentId={apt.id}
          city={apt.city}
          accentColor={accentColor}
          brandName={brandName}
          isOnTrial={showPoweredBy}
          onClose={() => setShowEvents(false)}
        />
      )}

      {showExperiences && (
        <ExperiencesSheet
          apartmentId={apt.id}
          accentColor={accentColor}
          brandName={brandName}
          isOnTrial={showPoweredBy}
          experiences={experiences ?? []}
          gygCityLink={gygCityLink}
          loading={experiencesLoading}
          onClose={() => setShowExperiences(false)}
        />
      )}

      {showMessages && (
        <MessageHost
          apartmentId={apt.id}
          token={tokenParam ?? ''}
          accentColor={accentColor}
          brandName={brandName}
          guestName={guestName}
          onClose={() => { setShowMessages(false); setActiveTab('more') }}
        />
      )}

      {!preview && <InstallPrompt accentColor={accentColor} />}

    </div>
  )
}
