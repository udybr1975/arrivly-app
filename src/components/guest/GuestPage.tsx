import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Home, MessageCircle, MapPin, MoreHorizontal,
  Copy, Check, RefreshCw, Navigation, Calendar, Star,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getDirectionsUrl } from '../../lib/maps'
import { resolveImageUrl, FALLBACK_HERO } from '../../lib/imageUtils'
import InstallPrompt from './InstallPrompt'
import EventsPage from './EventsPage'
import ChatBot from './ChatBot'
import { ARRIVLY_CONFIG } from '../../config'

interface Host {
  brand_name: string | null
  logo_url: string | null
  whatsapp: string | null
  subscription_status: string
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
}

interface Detail {
  id: string
  category: string
  content: string
  is_private: boolean
}

interface Booking {
  reference_number: string
  check_in: string
  check_out: string
  guest_id: string | null
  status: string
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

type PageState = 'loading' | 'active' | 'thankyou' | 'neutral' | 'expired'
type ActiveTab = 'home' | 'chat' | 'explore' | 'more'

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

const CATEGORY_COLORS: Record<string, string> = {
  Restaurant: '#c0392b',
  Bar: '#8e44ad',
  Coffee: '#e67e22',
  Sight: '#2980b9',
  Essential: '#27ae60',
  Nightlife: '#2c3e50',
}

function categoryColor(cat: string): string {
  return CATEGORY_COLORS[cat] ?? '#555'
}

export default function GuestPage() {
  const [searchParams] = useSearchParams()
  const aptId = searchParams.get('apt')
  const tokenParam = searchParams.get('token')

  const [apartment, setApartment] = useState<Apartment | null>(null)
  const [host, setHost] = useState<Host | null>(null)
  const [details, setDetails] = useState<Detail[]>([])
  const [hostPicks, setHostPicks] = useState<HostPick[]>([])
  const [guideCategories, setGuideCategories] = useState<GuideCategories | null>(null)

  const [loading, setLoading] = useState(true)
  const [pageState, setPageState] = useState<PageState>('loading')
  const [activeTab, setActiveTab] = useState<ActiveTab>('home')
  const [showEvents, setShowEvents] = useState(false)

  const [guestName, setGuestName] = useState<string | null>(null)
  const [thankYouName, setThankYouName] = useState<string | null>(null)

  const [weather, setWeather] = useState<Weather | null>(null)
  const [guideLoading, setGuideLoading] = useState(false)

  const [copiedWifi, setCopiedWifi] = useState(false)
  const [copiedDoor, setCopiedDoor] = useState(false)
  const [expandedGuideCategory, setExpandedGuideCategory] = useState<string | null>(null)

  useEffect(() => {
    if (!aptId) { setLoading(false); setPageState('neutral'); return }

    async function fetchData() {
      const tzNow = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Helsinki' })
      const [helsinkiDate] = tzNow.split(' ')

      const storageKey = `arrivly_guest_token_${aptId}`
      const storedToken = localStorage.getItem(storageKey)
      const cleanedStored = storedToken && storedToken !== 'null' ? storedToken : null
      const activeToken = tokenParam && tokenParam !== 'null' ? tokenParam : cleanedStored ?? null

      const [aptRes, detRes] = await Promise.all([
        supabase
          .from('apartments')
          .select('id,host_id,name,neighborhood,city,country,lat,lng,accent_color,max_guests,hero_image_url')
          .eq('id', aptId!)
          .maybeSingle(),
        supabase
          .from('apartment_details')
          .select('id,category,content,is_private')
          .eq('apartment_id', aptId!),
      ])

      if (!aptRes.data) { setPageState('neutral'); setLoading(false); return }
      const apt = aptRes.data as Apartment
      setApartment(apt)
      setDetails(((detRes.data ?? []) as Detail[]).filter(d => !d.is_private))

      const { data: hostData } = await supabase
        .from('hosts')
        .select('brand_name,logo_url,whatsapp,subscription_status')
        .eq('id', apt.host_id)
        .maybeSingle()
      if (hostData) setHost(hostData as Host)

      if (hostData?.subscription_status === 'expired') {
        setPageState('expired')
        setLoading(false)
        return
      }

      if (activeToken) {
        const { data: tokenBooking } = await supabase
          .from('bookings')
          .select('reference_number,check_in,check_out,guest_id,status')
          .eq('reference_number', activeToken)
          .eq('apartment_id', aptId!)
          .in('status', ['confirmed', 'completed'])
          .limit(1)
          .maybeSingle()

        if (tokenBooking) {
          const bk = tokenBooking as Booking
          const checkoutCutoff = bk.check_out + ' 11:00:00'

          if (tzNow >= checkoutCutoff) {
            if (bk.guest_id) {
              const { data: gd } = await supabase
                .from('guests')
                .select('first_name')
                .eq('id', bk.guest_id)
                .single()
              if (gd?.first_name) setThankYouName(gd.first_name)
            }
            setPageState('thankyou')
            setLoading(false)
            return
          }

          if (helsinkiDate >= bk.check_in && helsinkiDate <= bk.check_out) {
            localStorage.setItem(storageKey, activeToken)

            if (!tokenParam) {
              window.location.replace(`/guest?apt=${aptId}&token=${activeToken}`)
              return
            }

            setDetails((detRes.data ?? []) as Detail[])

            if (bk.guest_id) {
              const { data: gd } = await supabase
                .from('guests')
                .select('first_name')
                .eq('id', bk.guest_id)
                .single()
              if (gd?.first_name) setGuestName(gd.first_name)
            }

            const loc = encodeURIComponent(`${apt.neighborhood}, ${apt.city}`)
            fetch(`https://wttr.in/${loc}?format=j1`)
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
        }
      }

      const { data: dateBooking } = await supabase
        .from('bookings')
        .select('reference_number,guest_id')
        .eq('apartment_id', aptId!)
        .eq('status', 'confirmed')
        .lte('check_in', helsinkiDate)
        .gt('check_out', helsinkiDate)
        .not('reference_number', 'is', null)
        .order('source', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (dateBooking?.reference_number) {
        const existing = localStorage.getItem(storageKey)
        const hadDifferentToken = existing && existing !== 'null' && existing !== dateBooking.reference_number
        if (hadDifferentToken) {
          setPageState('neutral')
          setLoading(false)
          return
        }
        localStorage.setItem(storageKey, dateBooking.reference_number)
        window.location.replace(`/guest?apt=${aptId}&token=${dateBooking.reference_number}`)
        return
      }

      setPageState('neutral')
      setLoading(false)
    }

    fetchData()
  }, [aptId, tokenParam])

  useEffect(() => {
    if (activeTab !== 'explore' || !aptId) return
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
  }, [activeTab, aptId, hostPicks.length, guideCategories])

  const rulesRaw = useMemo(() =>
    details
      .filter(d => /rule|house|policy|policies|guidelines/i.test(d.category ?? ''))
      .map(d => d.content)
      .join('\n'),
    [details]
  )


  const accentColor = apartment?.accent_color ?? ARRIVLY_CONFIG.colourPresets[0].hex
  const brandName = host?.brand_name ?? 'Your Host'
  const isOnTrial = host?.subscription_status === 'trial'

  const wifiDetails = details.filter(d => /wifi|wi-fi|internet|wireless/i.test(d.category ?? ''))
  const wifiParsed = wifiDetails.length > 0
    ? parseWifi(wifiDetails.map(d => d.content).join('\n'))
    : null

  const checkinDetails = details.filter(
    d => /check.?in|check.?out|timing|door|code|entry/i.test(d.category ?? '') && d.is_private
  )

  const copyText = useCallback((text: string, setDone: (v: boolean) => void) => {
    navigator.clipboard.writeText(text).then(() => {
      setDone(true)
      setTimeout(() => setDone(false), 2000)
    })
  }, [])

  const shareUrl = typeof window !== 'undefined' ? window.location.href : ''
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

  const weatherSentence: string | null = weather
    ? weather.isOutdoorWeather
      ? 'A great day to explore — check the guide below for ideas. '
      : /rain|storm/.test(weather.condition.toLowerCase())
        ? 'A perfect day for a cosy café or museum. '
        : null
    : null

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white">
        <RefreshCw className="animate-spin" size={32} style={{ color: accentColor }} />
      </div>
    )
  }

  if (pageState === 'expired') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f5f5f3] px-6 py-16 text-center">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center mb-6 text-white font-bold text-xl"
          style={{ background: accentColor }}
        >
          {brandName.charAt(0)}
        </div>
        <h1 className="text-xl font-semibold text-[#1c1c1a] mb-2">{brandName}</h1>
        <p className="text-sm text-gray-500 max-w-xs leading-relaxed">
          This guest page is temporarily unavailable. Please contact your host directly.
        </p>
      </div>
    )
  }

  if (pageState === 'neutral') {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6 py-16 text-center"
        style={{ background: `linear-gradient(160deg, ${accentColor}22 0%, #fff 60%)` }}
      >
        {host?.logo_url ? (
          <img src={resolveImageUrl(host.logo_url)} alt={brandName} className="h-12 mb-6 object-contain" />
        ) : (
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mb-6 text-white font-bold text-xl"
            style={{ background: accentColor }}
          >
            {brandName.charAt(0)}
          </div>
        )}
        <h1 className="text-2xl font-semibold text-[#1c1c1a] mb-2">{brandName}</h1>
        <p className="text-sm text-gray-500 max-w-xs leading-relaxed mb-8">
          Welcome. There is no active booking for today — scan your check-in QR code to access your guest page.
        </p>
        {isOnTrial && (
          <p className="text-[10px] text-gray-400 mt-8">{ARRIVLY_CONFIG.poweredByText}</p>
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
          <p className="text-white/70 text-xs tracking-widest uppercase mb-3">{brandName}</p>
          <h1 className="text-3xl font-light text-white leading-tight mb-4">
            Until next time{thankYouName ? `, ${thankYouName}` : ''}.
          </h1>
          <p className="text-white/70 text-base leading-relaxed max-w-xs">
            Thank you for your stay. We hope you had a wonderful time.
          </p>
        </div>
        {isOnTrial && (
          <p className="text-white/30 text-[10px] text-center pb-6">{ARRIVLY_CONFIG.poweredByText}</p>
        )}
      </div>
    )
  }

  // pageState === 'active'
  const apt = apartment!

  return (
    <div className="min-h-screen bg-[#fbfaf7] font-sans">

      {activeTab === 'home' && (
        <div className="pb-28" style={{ background: `linear-gradient(to bottom, ${accentColor}1a, #fbfaf7 360px)` }}>
          <div className="relative h-64">
            <img src={resolveImageUrl(apt.hero_image_url)} alt="" className="absolute inset-0 w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).src = FALLBACK_HERO }} />
            <div className="absolute inset-0" style={{ background: `linear-gradient(to top, ${accentColor} 4%, ${accentColor}8c 34%, transparent 82%)` }} />
            <div className="absolute left-0 right-0 bottom-0 px-6 pb-6 text-white">
              {host?.logo_url ? (
                <img src={resolveImageUrl(host.logo_url)} alt={brandName} className="h-7 mb-4 object-contain" />
              ) : (
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-6 h-6 rounded-full bg-white/25 flex items-center justify-center text-xs font-bold">{brandName.charAt(0)}</span>
                  <span className="text-sm font-medium opacity-90">{brandName}</span>
                </div>
              )}
              <h1 className="text-3xl font-light leading-tight" style={{ fontFamily: 'Georgia, serif' }}>
                {guestName ? `Welcome, ${guestName}.` : 'Welcome.'}
              </h1>
              <p className="text-white/80 text-sm mt-1.5">{apt.name} · {apt.neighborhood}</p>
              {weather && (
                <div className="mt-3 inline-flex items-center gap-2 bg-white/20 rounded-full px-3 py-1.5">
                  <span className="text-base">{weather.icon}</span>
                  <span className="text-sm">{weather.temp}°C</span>
                  <span className="text-white/70 text-xs">{weather.condition}</span>
                </div>
              )}
            </div>
          </div>

          <div className="max-w-lg mx-auto px-6 pt-8 pb-4">
            <p className="text-[#1c1c1a] text-base leading-relaxed">
              {guestName ? `Dear ${guestName},` : 'Dear guest,'}
            </p>
            <p className="text-[#1c1c1a] text-base leading-relaxed mt-3">
              {'Your apartment is ready and we hope you feel right at home. '}
              {weather && `Outside it's ${weather.temp}°C and ${weather.condition} ${weather.icon}. `}
              {weatherSentence}
            </p>
            <p className="text-[#1c1c1a] text-base leading-relaxed mt-3">
              If you need anything during your stay, open the Chat tab and ask.
            </p>
            <div className="mt-5 flex justify-end">
              <p className="text-sm italic" style={{ color: accentColor }}>— {brandName}</p>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-100" />
              <span className="text-xs" style={{ color: accentColor }}>✦</span>
              <div className="flex-1 h-px bg-gray-100" />
            </div>
          </div>

          {apt.lat !== null && apt.lng !== null && (
            <div className="max-w-lg mx-auto px-6 pt-4 pb-1">
              <a
                href={getDirectionsUrl(apt.lat, apt.lng)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 w-full p-4 rounded-xl text-white no-underline shadow-[0_4px_14px_rgba(0,0,0,0.12)]"
                style={{ background: accentColor }}
              >
                <Home size={18} />
                <div className="flex-1">
                  <p className="text-sm font-semibold">Take me home</p>
                  <p className="text-xs opacity-75">Walking directions to {apt.name}</p>
                </div>
                <Navigation size={16} className="opacity-80" />
              </a>
            </div>
          )}

          {wifiParsed && (wifiParsed.network || wifiParsed.password) && (
            <div className="max-w-lg mx-auto px-6 py-6">
              <div className="bg-[#faf9f6] border-l-4 p-5 shadow-[0_1px_5px_rgba(0,0,0,0.05)]" style={{ borderLeftColor: accentColor }}>
                <p className="text-[10px] tracking-widest uppercase text-gray-400 mb-4">WiFi</p>
                {wifiParsed.network && (
                  <div className="mb-3">
                    <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">Network</p>
                    <p className="text-[#1c1c1a] font-medium">{wifiParsed.network}</p>
                  </div>
                )}
                {wifiParsed.network && wifiParsed.password && (
                  <div className="border-t border-gray-100 my-3" />
                )}
                {wifiParsed.password && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-2">Password</p>
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-mono text-xl text-[#1c1c1a] tracking-widest break-all">
                        {wifiParsed.password}
                      </span>
                      <button
                        onClick={() => copyText(wifiParsed!.password, setCopiedWifi)}
                        className="flex items-center gap-1.5 text-white text-[10px] tracking-widest uppercase px-3 py-2 shrink-0 border-none cursor-pointer"
                        style={{ background: accentColor }}
                      >
                        {copiedWifi ? <Check size={12} /> : <Copy size={12} />}
                        {copiedWifi ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {checkinDetails.length > 0 && (
            <div className="max-w-lg mx-auto px-6 py-4">
              <div className="bg-[#faf9f6] border border-gray-100 rounded-lg p-5 shadow-[0_1px_5px_rgba(0,0,0,0.05)]">
                <p className="text-[10px] tracking-widest uppercase text-gray-400 mb-4">Check-in info</p>
                <div className="space-y-3">
                  {checkinDetails.map(d => {
                    const doorCodeMatch = d.content.match(/(?:code|door|entry)[:\s]+([^\n\r]+)/i)
                    const doorCode = doorCodeMatch ? doorCodeMatch[1].trim() : null
                    return (
                      <div key={d.id}>
                        <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">{d.category}</p>
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-[#1c1c1a] text-sm leading-relaxed">{d.content}</p>
                          {doorCode && (
                            <button
                              onClick={() => copyText(doorCode, setCopiedDoor)}
                              className="shrink-0 flex items-center gap-1 text-[10px] tracking-widest uppercase px-2 py-1 border cursor-pointer bg-transparent"
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

          {rulesRaw && (
            <div className="max-w-lg mx-auto px-6 py-6 border-t border-gray-100">
              <h2 className="text-lg font-medium text-[#1c1c1a] mb-1">Before you settle in</h2>
              <p className="text-sm text-gray-500 italic mb-5 leading-relaxed">
                A few small things that keep everything running smoothly.
              </p>
              <p className="text-[#1c1c1a] text-sm leading-relaxed whitespace-pre-line">
                {rulesRaw}
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'chat' && (
        <div style={{ height: 'calc(100vh - 56px)' }}>
          <ChatBot
            apartmentId={apt.id}
            token={tokenParam ?? ''}
            accentColor={accentColor}
            brandName={brandName}
            guestName={guestName}
            city={apt.city}
          />
        </div>
      )}

      {activeTab === 'explore' && (
        <div className="pb-28" style={{ background: `linear-gradient(to bottom, ${accentColor}1a, #fbfaf7 360px)` }}>
          <div className="px-6 pt-8 pb-6 text-white" style={{ background: accentColor }}>
            <p className="text-[10px] tracking-[0.16em] uppercase opacity-70 mb-1">Host picks & local guide</p>
            <h2 className="text-2xl font-light" style={{ fontFamily: 'Georgia, serif' }}>Around {apt.neighborhood}</h2>
          </div>
          <div className="max-w-lg mx-auto px-6 pt-6 pb-8">
            <button
              onClick={() => setShowEvents(true)}
              className="flex items-center justify-between w-full p-4 rounded-xl mb-6 cursor-pointer bg-[#faf9f6] border border-gray-100 text-left"
            >
              <div className="flex items-center gap-3">
                <Calendar size={18} style={{ color: accentColor }} />
                <div>
                  <p className="text-sm font-medium text-[#1c1c1a]">This week in {apt.city}</p>
                  <p className="text-xs text-gray-400">Live local events, updated each time you open</p>
                </div>
              </div>
              <span style={{ color: accentColor }}>→</span>
            </button>

            {guideLoading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-gray-400">
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
                        <div key={pick.id} className="bg-[#faf9f6] border border-gray-100 rounded-lg p-4 shadow-[0_1px_5px_rgba(0,0,0,0.05)]">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <p className="text-sm font-medium text-[#1c1c1a]">{pick.name}</p>
                                <span
                                  className="text-[10px] px-1.5 py-0.5 rounded-full text-white shrink-0"
                                  style={{ background: categoryColor(pick.category) }}
                                >
                                  {pick.category}
                                </span>
                              </div>
                              {pick.address && (
                                <p className="text-xs text-gray-400">{pick.address}</p>
                              )}
                              {pick.note && (
                                <p className="text-xs text-gray-500 italic mt-1 leading-relaxed">{pick.note}</p>
                              )}
                            </div>
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
                      ))}
                    </div>
                  </div>
                )}

                {guideCategories && Object.entries(guideCategories).length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-3">
                      Neighbourhood guide
                    </p>
                    <div className="space-y-2">
                      {Object.entries(guideCategories).map(([cat, places]) => {
                        if (!Array.isArray(places) || places.length === 0) return null
                        const isExpanded = expandedGuideCategory === cat
                        return (
                          <div key={cat} className="bg-[#faf9f6] border border-gray-100 rounded-lg overflow-hidden shadow-[0_1px_5px_rgba(0,0,0,0.05)]">
                            <button
                              onClick={() => setExpandedGuideCategory(isExpanded ? null : cat)}
                              className="w-full flex items-center justify-between px-4 py-3.5 border-none bg-transparent cursor-pointer text-left"
                            >
                              <span className="text-sm font-medium text-[#1c1c1a]">{cat}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-400">{places.length} places</span>
                                <span
                                  className="text-sm transition-transform"
                                  style={{ transform: isExpanded ? 'rotate(45deg)' : 'none', color: accentColor }}
                                >
                                  +
                                </span>
                              </div>
                            </button>
                            {isExpanded && (
                              <div className="border-t border-gray-100 divide-y divide-gray-50">
                                {places.map((place, i) => (
                                  <div key={i} className="px-4 py-3">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-[#1c1c1a]">{place.name}</p>
                                        {place.address && (
                                          <p className="text-xs text-gray-400 mt-0.5">{place.address}</p>
                                        )}
                                        {place.description && (
                                          <p className="text-xs text-gray-500 italic mt-1 leading-relaxed">
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
                    <MapPin size={32} className="mx-auto mb-3 text-gray-200" />
                    <p className="text-sm text-gray-400">Guide is being prepared by your host.</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'more' && (
        <div className="pb-28" style={{ background: `linear-gradient(to bottom, ${accentColor}1a, #fbfaf7 360px)` }}>
          <div className="px-6 pt-8 pb-6 text-white" style={{ background: accentColor }}>
            {host?.logo_url && (
              <img src={resolveImageUrl(host.logo_url)} alt={brandName} className="h-7 mb-2 object-contain" />
            )}
            <p className="text-[10px] tracking-[0.16em] uppercase opacity-70 mb-1">More</p>
            <h2 className="text-2xl font-light" style={{ fontFamily: 'Georgia, serif' }}>{brandName}</h2>
          </div>
          <div className="max-w-lg mx-auto px-6 py-10 border-b border-gray-100">
            <h2 className="text-xl font-medium text-[#1c1c1a] mb-1">Save this page</h2>
            <p className="text-sm text-gray-500 leading-relaxed mb-6">
              Send yourself this link so you can open it without scanning the QR code again.
            </p>
            <button
              onClick={handleShare}
              className="w-full py-4 text-white text-[10px] tracking-widest uppercase border-none cursor-pointer font-semibold"
              style={{ background: accentColor }}
            >
              Share via WhatsApp or Save →
            </button>
          </div>

          {host?.whatsapp && (
            <div className="max-w-lg mx-auto px-6 py-8 border-b border-gray-100">
              <h2 className="text-xl font-medium text-[#1c1c1a] mb-4">Contact host</h2>
              <a
                href={`https://wa.me/${host.whatsapp.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 no-underline"
              >
                <div className="w-8 h-8 bg-[#25D366] rounded-full flex items-center justify-center">
                  <MessageCircle size={14} className="text-white" />
                </div>
                <span className="text-sm text-[#1c1c1a]">Message on WhatsApp</span>
              </a>
            </div>
          )}

          <div className="max-w-lg mx-auto px-6 py-10 text-center">
            <p className="text-sm font-medium text-gray-400 mb-2">{brandName}</p>
            {isOnTrial && (
              <p className="text-[10px] text-gray-300 mt-6">{ARRIVLY_CONFIG.poweredByText}</p>
            )}
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100 h-14 flex items-stretch">
        {(
          [
            { id: 'home', Icon: Home, label: 'Home' },
            { id: 'chat', Icon: MessageCircle, label: 'Chat' },
            { id: 'explore', Icon: MapPin, label: 'Explore' },
            { id: 'more', Icon: MoreHorizontal, label: 'More' },
          ] as const
        ).map(({ id, Icon, label }) => {
          const isActive = activeTab === id
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 border-none bg-transparent cursor-pointer relative"
              style={{ color: isActive ? accentColor : '#9ca3af' }}
            >
              {isActive && (
                <div
                  className="absolute top-0 left-4 right-4 h-0.5 rounded-full"
                  style={{ background: accentColor }}
                />
              )}
              <Icon size={18} />
              <span className="text-[9px] tracking-widest uppercase font-medium">{label}</span>
            </button>
          )
        })}
      </div>

      {activeTab === 'home' && (
        <div
          className="fixed bottom-14 left-0 right-0 z-30 px-5 py-2.5 flex items-center justify-between shadow-lg"
          style={{ background: accentColor }}
        >
          <p className="text-white text-xs">Take this page with you</p>
          <button
            onClick={handleShare}
            className="bg-white text-[10px] tracking-widest uppercase px-4 py-1.5 font-semibold border-none cursor-pointer"
            style={{ color: accentColor }}
          >
            Save →
          </button>
        </div>
      )}

      {showEvents && (
        <EventsPage
          apartmentId={apt.id}
          city={apt.city}
          accentColor={accentColor}
          brandName={brandName}
          isOnTrial={isOnTrial}
          onClose={() => setShowEvents(false)}
        />
      )}

      <InstallPrompt accentColor={accentColor} />

    </div>
  )
}
