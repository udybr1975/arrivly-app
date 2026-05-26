import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Wifi, Clock, ShieldCheck, MapPin, Utensils, Coffee, Trees, Camera, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ARRIVLY_CONFIG } from '../../config'
import Loader from '../shared/Loader'

interface Apartment {
  id: string
  name: string
  neighborhood: string
  description: string
  size: string
  guests: number
  images: string[]
  brand_color: string
}

interface Detail {
  id: string
  category: string
  content: string
  is_private: boolean
}

interface GuideSummary {
  neighborhood: string
  categories: Record<string, GuideCategoryItem[]>
}

interface GuideCategoryItem {
  name: string
  description?: string
  address?: string
  type?: string
  distance?: string
}

const CATEGORY_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  restaurants: Utensils,
  restaurant: Utensils,
  cafes: Coffee,
  cafe: Coffee,
  coffee: Coffee,
  parks: Trees,
  park: Trees,
  attractions: Camera,
  attraction: Camera,
  sights: Camera,
}

function categoryIcon(key: string) {
  const Icon = CATEGORY_ICONS[key.toLowerCase()] ?? MapPin
  return <Icon size={16} />
}

function lightenColor(hex: string, amount = 0.15): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * amount))
  const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * amount))
  const b = Math.min(255, (num & 0xff) + Math.round(255 * amount))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function Section({ title, icon, children, defaultOpen = true }: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-white/10 last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-white/70">{icon}</span>
          <span className="font-semibold text-sm">{title}</span>
        </div>
        {open ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
      </button>
      {open && <div className="pb-4">{children}</div>}
    </div>
  )
}

export default function GuestPage() {
  const [params] = useSearchParams()
  const apartmentId = params.get('apt')

  const [apt, setApt] = useState<Apartment | null>(null)
  const [details, setDetails] = useState<Detail[]>([])
  const [guide, setGuide] = useState<GuideSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!apartmentId) { setNotFound(true); setLoading(false); return }

    async function load() {
      const [{ data: aptData }, { data: detsData }, { data: guideData }] = await Promise.all([
        supabase.from('apartments').select('id,name,neighborhood,description,size,guests,images,brand_color').eq('id', apartmentId).maybeSingle(),
        supabase.from('apartment_details').select('id,category,content,is_private').eq('apartment_id', apartmentId).order('category'),
        supabase.from('guide_recommendations').select('neighborhood,categories').eq('apartment_id', apartmentId).order('generated_at', { ascending: false }).limit(1).maybeSingle(),
      ])

      if (!aptData) { setNotFound(true); setLoading(false); return }

      setApt(aptData)
      setDetails(detsData ?? [])
      if (guideData) setGuide(guideData as GuideSummary)
      setLoading(false)
    }
    load()
  }, [apartmentId])

  if (loading) return <Loader />

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1c1c1a] text-white text-center p-4">
        <div>
          <p className="text-4xl mb-4">🏠</p>
          <h1 className="text-xl font-semibold mb-2">Page not found</h1>
          <p className="text-gray-400 text-sm">This guest page doesn't exist or has been removed.</p>
        </div>
      </div>
    )
  }

  const bg = apt!.brand_color ?? '#1c1c1a'
  const bgLight = lightenColor(bg, 0.08)

  const detailsByCategory = details.reduce<Record<string, Detail[]>>((acc, d) => {
    if (!acc[d.category]) acc[d.category] = []
    acc[d.category].push(d)
    return acc
  }, {})

  const wifiDetails = detailsByCategory['WiFi'] ?? detailsByCategory['Internet'] ?? []
  const checkinDetails = [...(detailsByCategory['Check-in'] ?? []), ...(detailsByCategory['Timing'] ?? [])]
  const checkoutDetails = detailsByCategory['Check-out'] ?? []
  const houseRules = [...(detailsByCategory['House Rules'] ?? []), ...(detailsByCategory['Policies'] ?? [])]
  const otherCategories = Object.entries(detailsByCategory).filter(
    ([cat]) => !['WiFi', 'Internet', 'Check-in', 'Check-out', 'Timing', 'House Rules', 'Policies'].includes(cat)
  )

  const guideCategories = guide?.categories ? Object.entries(guide.categories) : []

  return (
    <div className="min-h-screen" style={{ backgroundColor: bg }}>
      {/* Hero */}
      <div className="relative" style={{ backgroundColor: bgLight }}>
        {apt!.images?.[0] ? (
          <img src={apt!.images[0]} alt={apt!.name} className="w-full h-56 object-cover opacity-60" />
        ) : (
          <div className="h-32" />
        )}
        <div className="px-5 py-6">
          <h1 className="text-2xl font-bold text-white">{apt!.name}</h1>
          <p className="text-white/70 text-sm mt-1 flex items-center gap-1.5">
            <MapPin size={13} />
            {apt!.neighborhood}
          </p>
          {apt!.description && (
            <p className="text-white/60 text-sm mt-3 leading-relaxed">{apt!.description}</p>
          )}
          <div className="flex gap-3 mt-4 text-white/50 text-xs">
            {apt!.size && <span>{apt!.size}</span>}
            {apt!.guests && <span>Up to {apt!.guests} guests</span>}
          </div>
        </div>
      </div>

      {/* Info sections */}
      <div className="px-5 py-2">
        {/* WiFi */}
        {wifiDetails.length > 0 && (
          <Section title="WiFi" icon={<Wifi size={16} />}>
            <div className="space-y-2">
              {wifiDetails.map(d => (
                <div key={d.id} className="bg-white/10 rounded-lg px-4 py-2.5">
                  <p className="text-white text-sm font-mono">{d.content}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Check-in / check-out */}
        {(checkinDetails.length > 0 || checkoutDetails.length > 0) && (
          <Section title="Check-in & Check-out" icon={<Clock size={16} />}>
            <div className="space-y-2">
              {[...checkinDetails, ...checkoutDetails].map(d => (
                <div key={d.id} className="flex items-start gap-2">
                  <span className="text-white/40 mt-0.5">·</span>
                  <p className="text-white/80 text-sm">{d.content}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* House Rules */}
        {houseRules.length > 0 && (
          <Section title="House Rules" icon={<ShieldCheck size={16} />} defaultOpen={false}>
            <div className="space-y-2">
              {houseRules.map(d => (
                <div key={d.id} className="flex items-start gap-2">
                  <span className="text-white/40 mt-0.5">·</span>
                  <p className="text-white/80 text-sm">{d.content}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Other detail categories */}
        {otherCategories.map(([cat, items]) => (
          <Section key={cat} title={cat} icon={<MapPin size={16} />} defaultOpen={false}>
            <div className="space-y-2">
              {items.map(d => (
                <div key={d.id} className="flex items-start gap-2">
                  <span className="text-white/40 mt-0.5">·</span>
                  <p className="text-white/80 text-sm">{d.content}</p>
                </div>
              ))}
            </div>
          </Section>
        ))}
      </div>

      {/* Neighbourhood guide */}
      {guideCategories.length > 0 && (
        <div className="px-5 pt-4 pb-2" style={{ backgroundColor: bgLight }}>
          <h2 className="text-lg font-bold text-white mb-4">
            Explore {apt!.neighborhood}
          </h2>
          <div className="space-y-4">
            {guideCategories.map(([key, places]) => (
              Array.isArray(places) && places.length > 0 && (
                <div key={key}>
                  <div className="flex items-center gap-2 text-white/60 text-xs uppercase tracking-wider mb-2">
                    {categoryIcon(key)}
                    <span>{key}</span>
                  </div>
                  <div className="space-y-2">
                    {places.slice(0, 5).map((place, i) => (
                      <div key={i} className="bg-white/10 rounded-xl p-3">
                        <p className="text-white font-medium text-sm">{place.name}</p>
                        {place.description && (
                          <p className="text-white/60 text-xs mt-0.5 leading-relaxed">{place.description}</p>
                        )}
                        {place.address && (
                          <p className="text-white/40 text-xs mt-1 flex items-center gap-1">
                            <MapPin size={10} />
                            {place.address}
                          </p>
                        )}
                        {place.distance && (
                          <p className="text-white/40 text-xs mt-0.5">{place.distance}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      {ARRIVLY_CONFIG.poweredByOnTrial && (
        <div className="px-5 py-6 text-center">
          <p className="text-white/30 text-xs">{ARRIVLY_CONFIG.poweredByText}</p>
        </div>
      )}
    </div>
  )
}
