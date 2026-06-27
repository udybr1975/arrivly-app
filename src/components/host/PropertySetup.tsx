import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import { ARRIVLY_CONFIG } from '../../config'
import Loader from '../shared/Loader'
import { resolveImageUrl, uploadImage, deleteImage } from '../../lib/imageUtils'
import { useToast } from '../shared/Toast'

type Tab = 'basic' | 'wifi' | 'checkin' | 'rules' | 'extras' | 'picks' | 'guide' | 'calendars' | 'look'

const TABS: { key: Tab; label: string; privateLock?: boolean }[] = [
  { key: 'basic',   label: 'Basics' },
  { key: 'wifi',    label: 'WiFi' },
  { key: 'checkin', label: 'Check-in', privateLock: true },
  { key: 'rules',   label: 'House rules' },
  { key: 'extras',  label: 'Extras' },
  { key: 'picks',   label: 'My picks' },
  { key: 'guide',   label: 'Guide & events' },
  { key: 'calendars', label: 'Calendars' },
  { key: 'look',    label: 'Look' },
]

const EXTRAS_CATEGORIES = ['Parking', 'Recycling & Bins', 'Appliances', 'Transport', 'Amenities', 'Safety', 'Good to know']

const DEFAULT_COLOR = '#1c1c1a'
const GUIDE_FRESH_HOURS = 24

// ── New-chrome design tokens (cream workspace + brass accent) ────────────────
const INPUT = 'w-full bg-white border border-[#e0dacd] rounded-[10px] px-3.5 py-2.5 text-[13px] text-[#1c1c1a] placeholder:text-[#b3ab9b] focus:outline-none focus:border-[#c8a24e] focus:ring-2 focus:ring-[#c8a24e]/20 transition-colors'
const LABEL = 'block text-[10px] font-medium uppercase tracking-[.12em] text-[#a79e8e] mb-1.5'
const CARD = 'bg-[#fffdf9] border border-[#e4ddd0] rounded-[14px] p-5'
const HEADING = "text-[16px] font-['Fraunces'] font-light text-[#231d17]"
const BTN_SAVE = 'bg-[#c8a24e] text-[#16100d] px-5 py-2.5 rounded-[10px] text-xs font-semibold hover:bg-[#e7d6ad] transition-colors disabled:opacity-40 disabled:hover:bg-[#c8a24e]'
const BTN_AI = 'bg-[#1c1c1a] text-[#f0ede6] px-5 py-2.5 rounded-[10px] text-xs font-semibold hover:bg-[#2a2a28] transition-colors disabled:opacity-40 disabled:hover:bg-[#1c1c1a]'
const BTN_OUTLINE = 'bg-transparent border border-[#e4ddd0] text-[#231d17] px-4 py-2 rounded-[10px] text-xs font-medium hover:bg-[#f0ede6] transition-colors disabled:opacity-40'

// Relative-time helper for the Guide & events status lines.
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  return `${months} month${months === 1 ? '' : 's'} ago`
}

export default function PropertySetup() {
  const { aptId } = useParams<{ aptId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const [tab, setTab] = useState<Tab>('basic')
  const [apartmentId, setApartmentId] = useState<string | null>(null)
  const [hostId, setHostId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  // Tab 1
  const [basic, setBasic] = useState({
    name: '', maxGuests: 2, country: '', city: '',
    neighborhood: '', street: '', streetNumber: '', floorNote: '',
  })
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null)
  const [uploadingHero, setUploadingHero] = useState(false)
  // Tab 2
  const [wifi, setWifi] = useState({ ssid: '', password: '' })
  // Tab 3
  const [checkin, setCheckin] = useState({ checkInFrom: '', checkOutBy: '', doorCode: '', entryInstructions: '' })
  // Tab 4
  const [rawRules, setRawRules] = useState('')
  // Tab 5
  const [extrasContent, setExtrasContent] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState('')
  const [extrasRows, setExtrasRows] = useState<Array<{ id: string; category: string; content: string }>>([])
  const [extrasLoading, setExtrasLoading] = useState(false)

  // Tab 6 — picks
  const [picks, setPicks] = useState<Array<{
    id: string
    name: string
    category: string
    address: string
    note: string
    display_order: number
    lat: number | null
    lng: number | null
  }>>([])
  const [picksLoading, setPicksLoading] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [relocatingKey, setRelocatingKey] = useState<string | null>(null)
  const [enriching, setEnriching] = useState(false)
  const [candidates, setCandidates] = useState<Array<{
    key: string
    name: string
    category: string
    address: string
    note: string
    lat: number | null
    lng: number | null
    located: boolean
  }>>([])
  const [savingPicks, setSavingPicks] = useState(false)

  // Tab 7 — Guide & events
  const [guideGeneratedAt, setGuideGeneratedAt] = useState<string | null>(null)
  const [guideStatusLoading, setGuideStatusLoading] = useState(false)
  const [refreshingGuide, setRefreshingGuide] = useState(false)
  const [guideMsg, setGuideMsg] = useState<string | null>(null)
  const [eventsStatus, setEventsStatus] = useState<{ refreshed: boolean; generated_at?: string; reason?: string } | null>(null)
  const [refreshingEvents, setRefreshingEvents] = useState(false)

  // Tab 8 — Look (per-property colour)
  const [aptAccent, setAptAccent] = useState<string | null>(null)
  const [hostAccent, setHostAccent] = useState<string | null>(null)
  const [lookLoading, setLookLoading] = useState(false)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [lookSelected, setLookSelected] = useState(DEFAULT_COLOR)
  const [lookCustomHex, setLookCustomHex] = useState('')
  const [savingLook, setSavingLook] = useState(false)

  // Tab 9 — Calendars (iCal feeds + Airbnb CSV guest-name import)
  const [icalUrls, setIcalUrls] = useState('')
  const [savingIcal, setSavingIcal] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [csvImporting, setCsvImporting] = useState(false)
  const [csvMsg, setCsvMsg] = useState<string | null>(null)

  const basicComplete =
    !!basic.name.trim() && !!basic.country.trim() && !!basic.city.trim() &&
    !!basic.neighborhood.trim() && !!basic.street.trim() &&
    !!basic.streetNumber.trim() && Number(basic.maxGuests) >= 1

  useEffect(() => {
    async function load() {
      if (!aptId) { navigate('/dashboard'); return }

      setLoading(true)
      setFeedback(null)
      setBasic({ name: '', maxGuests: 2, country: '', city: '', neighborhood: '', street: '', streetNumber: '', floorNote: '' })
      setWifi({ ssid: '', password: '' })
      setCheckin({ checkInFrom: '', checkOutBy: '', doorCode: '', entryInstructions: '' })
      setRawRules('')
      setExtrasContent('')
      setImportResult('')
      setExtrasRows([])
      setPasteText('')
      setCandidates([])
      setEnriching(false)
      setPicks([])
      setRelocatingKey(null)
      setHeroImageUrl(null)
      // new-tab state reset on apartment switch
      setGuideGeneratedAt(null)
      setGuideMsg(null)
      setEventsStatus(null)
      setAptAccent(null)
      setHostAccent(null)
      setOverrideOpen(false)
      setLookSelected(DEFAULT_COLOR)
      setLookCustomHex('')
      setIcalUrls('')
      setSyncMsg(null)
      setCsvMsg(null)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      setHostId(user.id)

      if (aptId === 'new') {
        setApartmentId(null)
        setTab('basic')
        setLoading(false)
        return
      }

      const { data: apt } = await supabase
        .from('apartments')
        .select('id, name, country, city, neighborhood, street, street_number, floor_note, max_guests, hero_image_url')
        .eq('id', aptId)
        .eq('host_id', user.id)
        .maybeSingle()

      if (!apt) { navigate('/dashboard'); return }

      setApartmentId(apt.id)
      // Honour a ?tab= deep-link (e.g. Bookings → "Manage calendars"). For an existing
      // property every tab is unlocked, so no lock check is needed; the 'new' branch above
      // ignores the param by forcing 'basic'.
      const requestedTab = searchParams.get('tab')
      if (requestedTab && TABS.some(t => t.key === requestedTab)) setTab(requestedTab as Tab)
      setHeroImageUrl(apt.hero_image_url ?? null)
      setBasic({
        name: apt.name ?? '',
        maxGuests: apt.max_guests ?? 2,
        country: apt.country ?? '',
        city: apt.city ?? '',
        neighborhood: apt.neighborhood ?? '',
        street: apt.street ?? '',
        streetNumber: apt.street_number ?? '',
        floorNote: apt.floor_note ?? '',
      })

      const { data: dets } = await supabase
        .from('apartment_details')
        .select('category, content, is_private')
        .eq('apartment_id', apt.id)

      if (dets) {
        const wifiRow = dets.find(d => d.category === 'WiFi')
        if (wifiRow) {
          const lines = wifiRow.content.split('\n')
          setWifi({
            ssid: (lines[0] ?? '').replace('Network: ', ''),
            password: (lines[1] ?? '').replace('Password: ', ''),
          })
        }

        const ciRows = dets.filter(d => d.category === 'Check-in')
        setCheckin({
          checkInFrom:        ciRows.find(d => d.content.startsWith('Check-in from: '))?.content.replace('Check-in from: ', '') ?? '',
          checkOutBy:         ciRows.find(d => d.content.startsWith('Check-out by: '))?.content.replace('Check-out by: ', '') ?? '',
          doorCode:           ciRows.find(d => d.content.startsWith('Door code: '))?.content.replace('Door code: ', '') ?? '',
          entryInstructions:  ciRows.find(d =>
            !d.content.startsWith('Check-in from: ') &&
            !d.content.startsWith('Check-out by: ') &&
            !d.content.startsWith('Door code: ')
          )?.content ?? '',
        })

        const rulesRow = dets.find(d => d.category === 'House Rules')
        if (rulesRow) setRawRules(rulesRow.content)
      }

      setLoading(false)
    }
    load()
  }, [aptId, searchParams])

  const loadPicks = useCallback(async () => {
    if (!apartmentId) return
    setPicksLoading(true)
    const { data } = await supabase
      .from('host_picks')
      .select('id, name, category, address, lat, lng, note, display_order')
      .eq('apartment_id', apartmentId)
      .order('display_order')
    setPicks(data ?? [])
    setPicksLoading(false)
  }, [apartmentId])

  useEffect(() => {
    if (tab !== 'picks' || !apartmentId) return
    loadPicks()
  }, [tab, apartmentId, loadPicks])

  const loadExtras = useCallback(async () => {
    if (!apartmentId) return
    setExtrasLoading(true)
    const { data } = await supabase
      .from('apartment_details')
      .select('id, category, content')
      .eq('apartment_id', apartmentId)
      .in('category', EXTRAS_CATEGORIES)
    setExtrasRows(data ?? [])
    setExtrasLoading(false)
  }, [apartmentId])

  useEffect(() => {
    if (tab !== 'extras' || !apartmentId) return
    loadExtras()
  }, [tab, apartmentId, loadExtras])

  // ── Tab 7: Guide & events — lazy status load ──────────────────────────────
  const loadGuideStatus = useCallback(async () => {
    if (!apartmentId) return
    setGuideStatusLoading(true)
    const { data } = await supabase
      .from('guide_recommendations')
      .select('generated_at')
      .eq('apartment_id', apartmentId)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setGuideGeneratedAt(data?.generated_at ?? null)
    setGuideStatusLoading(false)
  }, [apartmentId])

  useEffect(() => {
    if (tab !== 'guide' || !apartmentId) return
    loadGuideStatus()
  }, [tab, apartmentId, loadGuideStatus])

  // ── Tab 8: Look — lazy colour load ────────────────────────────────────────
  const loadLook = useCallback(async () => {
    if (!apartmentId || !hostId) return
    setLookLoading(true)
    const [{ data: aptRow }, { data: hostRow }] = await Promise.all([
      supabase.from('apartments').select('accent_color').eq('id', apartmentId).eq('host_id', hostId).maybeSingle(),
      supabase.from('hosts').select('accent_color').eq('id', hostId).maybeSingle(),
    ])
    const apartColor = aptRow?.accent_color ?? null
    const brandColor = hostRow?.accent_color ?? null
    setAptAccent(apartColor)
    setHostAccent(brandColor)
    const eff = apartColor ?? brandColor ?? DEFAULT_COLOR
    setLookSelected(eff)
    setOverrideOpen(apartColor != null)
    setLookCustomHex(ARRIVLY_CONFIG.colourPresets.some(p => p.hex === eff) ? '' : eff)
    setLookLoading(false)
  }, [apartmentId, hostId])

  useEffect(() => {
    if (tab !== 'look' || !apartmentId) return
    loadLook()
  }, [tab, apartmentId, loadLook])

  // ── Tab 9: Calendars — lazy iCal-URL load ─────────────────────────────────
  const loadCalendars = useCallback(async () => {
    if (!apartmentId || !hostId) return
    const { data } = await supabase
      .from('apartments')
      .select('ical_urls')
      .eq('id', apartmentId)
      .eq('host_id', hostId)
      .maybeSingle()
    setIcalUrls(data?.ical_urls ?? '')
  }, [apartmentId, hostId])

  useEffect(() => {
    if (tab !== 'calendars' || !apartmentId) return
    loadCalendars()
  }, [tab, apartmentId, loadCalendars])

  function showOk() {
    setFeedback({ ok: true, msg: 'Saved ✓' })
    setTimeout(() => setFeedback(null), 2000)
  }

  function showErr(msg: string) {
    setFeedback({ ok: false, msg })
  }

  // ── Tab 1 ──────────────────────────────────────────────────────────────────
  async function saveBasic() {
    if (!basicComplete) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { showErr('Not logged in'); setSaving(false); return }
    const wasNew = !apartmentId

    const fields: {
      name: string
      max_guests: number
      country: string | null
      city: string | null
      neighborhood: string | null
      street: string | null
      street_number: string | null
      floor_note: string | null
      lat?: number
      lng?: number
    } = {
      name: basic.name,
      max_guests: basic.maxGuests,
      country: basic.country || null,
      city: basic.city || null,
      neighborhood: basic.neighborhood || null,
      street: basic.street || null,
      street_number: basic.streetNumber || null,
      floor_note: basic.floorNote || null,
    }

    // Best-effort geocoding: address -> coordinates, stored once on save.
    // Never blocks the save; on failure, existing coordinates are left untouched.
    const streetLine = [basic.street, basic.streetNumber].filter(Boolean).join(' ').trim()
    const address = [streetLine, basic.neighborhood, basic.city, basic.country]
      .map(s => (s || '').trim())
      .filter(Boolean)
      .join(', ')
    let geoMissed = false
    if (address) {
      try {
        const geo = await api.post<{ lat?: number; lng?: number; error?: string }>(
          '/geocode',
          { address }
        )
        if (typeof geo.lat === 'number' && typeof geo.lng === 'number') {
          fields.lat = geo.lat
          fields.lng = geo.lng
        } else {
          geoMissed = true
        }
      } catch {
        geoMissed = true
      }
    }

    let savedId: string | null = apartmentId
    if (apartmentId) {
      const { error } = await supabase.from('apartments').update(fields).eq('id', apartmentId).eq('host_id', user.id)
      if (error) { showErr(error.message); setSaving(false); return }
    } else {
      const { data, error } = await supabase
        .from('apartments')
        .insert({ host_id: user.id, is_visible: true, ...fields })
        .select('id')
        .maybeSingle()
      if (error || !data) {
        if (error?.message?.includes('property_cap_reached')) {
          showErr("You've reached your plan's property limit. Upgrade your plan to add more properties.")
        } else {
          showErr(error?.message ?? 'Could not create property')
        }
        setSaving(false)
        return
      }
      setApartmentId(data.id)
      savedId = data.id
    }

    // Refresh the cached by-city hero (shown only when no host upload). Fire-and-forget.
    if (savedId && basic.city.trim()) {
      api.post('/city-image', { apartmentId: savedId }).catch(() => {})
    }

    if (geoMissed) {
      setFeedback({
        ok: true,
        msg: "Saved — but we couldn't pin this address on the map, so guest weather and directions may be approximate. Check the street and number.",
      })
    } else {
      showOk()
    }
    setSaving(false)
    if (wasNew && savedId) {
      // Fire-and-forget: generate guide + greeting_blurb for the brand-new property.
      // Navigation is not blocked — the host lands on the edit page while generation runs in the background.
      void api.post('/generate-guide', { apartment_id: savedId }).catch(() => {})
      navigate(`/dashboard/property/${savedId}`, { replace: true })
    }
  }

  async function handleHeroFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !apartmentId || !hostId) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { showErr('Use a PNG, JPG or WebP image.'); return }
    if (file.size > 5 * 1024 * 1024) { showErr('Cover photo must be under 5 MB.'); return }
    const previous = heroImageUrl
    setUploadingHero(true)
    try {
      const path = await uploadImage(file, 'hero', apartmentId)
      const { error } = await supabase.from('apartments').update({ hero_image_url: path }).eq('id', apartmentId).eq('host_id', hostId)
      if (error) throw error
      setHeroImageUrl(path)
      showOk()
      if (previous && previous !== path) void deleteImage(previous)
    } catch (err) {
      showErr(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingHero(false)
    }
  }

  async function removeHero() {
    if (!apartmentId || !hostId) return
    const previous = heroImageUrl
    const { error } = await supabase.from('apartments').update({ hero_image_url: null }).eq('id', apartmentId).eq('host_id', hostId)
    if (error) { showErr(error.message); return }
    setHeroImageUrl(null)
    showOk()
    void deleteImage(previous)
  }

  // ── Tab 2 ──────────────────────────────────────────────────────────────────
  async function saveWifi() {
    if (!apartmentId) { showErr('Save Basic info first'); return }
    setSaving(true)
    await supabase.from('apartment_details').delete().eq('apartment_id', apartmentId).eq('category', 'WiFi')
    const { error } = await supabase.from('apartment_details').insert({
      apartment_id: apartmentId,
      category: 'WiFi',
      content: `Network: ${wifi.ssid}\nPassword: ${wifi.password}`,
      is_private: false,
    })
    if (error) showErr(error.message)
    else showOk()
    setSaving(false)
  }

  // ── Tab 3 ──────────────────────────────────────────────────────────────────
  async function saveCheckin() {
    if (!apartmentId) { showErr('Save Basic info first'); return }
    setSaving(true)
    await supabase.from('apartment_details').delete().eq('apartment_id', apartmentId).eq('category', 'Check-in')
    const rows = [
      checkin.checkInFrom       && { apartment_id: apartmentId, category: 'Check-in', content: `Check-in from: ${checkin.checkInFrom}`,    is_private: true },
      checkin.checkOutBy        && { apartment_id: apartmentId, category: 'Check-in', content: `Check-out by: ${checkin.checkOutBy}`,       is_private: true },
      checkin.doorCode          && { apartment_id: apartmentId, category: 'Check-in', content: `Door code: ${checkin.doorCode}`,            is_private: true },
      checkin.entryInstructions && { apartment_id: apartmentId, category: 'Check-in', content: checkin.entryInstructions,                   is_private: true },
    ].filter(Boolean) as { apartment_id: string; category: string; content: string; is_private: boolean }[]

    if (rows.length > 0) {
      const { error } = await supabase.from('apartment_details').insert(rows)
      if (error) { showErr(error.message); setSaving(false); return }
    }
    showOk()
    setSaving(false)
  }

  // ── Tab 4 ──────────────────────────────────────────────────────────────────
  async function saveRules() {
    if (!apartmentId) { showErr('Save Basic info first'); return }
    if (!rawRules.trim()) return
    setSaving(true)

    // Polish via Gemini on save. On any failure, fall back to the raw text so
    // the host never loses their input.
    let finalRules = rawRules
    try {
      const data = await api.post<{ result: string }>('/rewrite-rules', { rawRules })
      if (data?.result && data.result.trim()) finalRules = data.result
    } catch {
      finalRules = rawRules
    }

    await supabase.from('apartment_details').delete().eq('apartment_id', apartmentId).eq('category', 'House Rules')
    const { error } = await supabase.from('apartment_details').insert({
      apartment_id: apartmentId,
      category: 'House Rules',
      content: finalRules,
      is_private: false,
    })
    if (error) {
      showErr(error.message)
    } else {
      setRawRules(finalRules)
      showOk()
    }
    setSaving(false)
  }

  // ── Tab 5 ──────────────────────────────────────────────────────────────────
  async function bulkImport() {
    if (!extrasContent.trim()) return
    if (!apartmentId) { showErr('Save Basic info first'); return }
    setImporting(true)
    setImportResult('')
    try {
      const data = await api.post<{ categories: string[] }>('/bulk-import', { apartmentId, content: extrasContent })
      setImportResult(data.categories.join(' · '))
      setExtrasContent('')
      await loadExtras()
    } catch {
      showErr('Import failed — please try again')
    } finally {
      setImporting(false)
    }
  }

  async function deletePick(id: string) {
    if (!apartmentId) return
    const { error } = await supabase.from('host_picks').delete().eq('id', id).eq('apartment_id', apartmentId)
    if (error) { showErr(error.message); return }
    await loadPicks()
  }

  async function deleteExtrasRow(id: string) {
    if (!apartmentId) return
    const { error } = await supabase.from('apartment_details').delete().eq('id', id).eq('apartment_id', apartmentId)
    if (error) { showErr(error.message); return }
    await loadExtras()
  }

  async function enrichPicks() {
    if (!apartmentId || !pasteText.trim()) return
    setEnriching(true)
    try {
      const data = await api.post<{
        picks: Array<{ name: string; category: string; address: string; lat: number | null; lng: number | null; located: boolean }>
      }>('/generate-host-picks', { apartmentId, text: pasteText })
      if (!data.picks || data.picks.length === 0) {
        setFeedback({ ok: false, msg: "Couldn't identify any places — add them manually below." })
      } else {
        setCandidates(data.picks.map(p => ({ ...p, key: crypto.randomUUID(), note: '' })))
      }
    } catch {
      showErr('Could not identify places')
    }
    setEnriching(false)
  }

  function updateCandidate(key: string, field: 'name' | 'category' | 'address' | 'note', value: string) {
    setCandidates(cs => cs.map(c => c.key === key ? { ...c, [field]: value } : c))
  }

  function removeCandidate(key: string) {
    setCandidates(cs => cs.filter(c => c.key !== key))
  }

  async function relocateCandidate(key: string, query: string) {
    if (!query) return
    setRelocatingKey(key)
    try {
      const geo = await api.post<{ lat?: number; lng?: number; error?: string }>('/geocode', { address: query })
      const lat = geo.lat
      const lng = geo.lng
      if (typeof lat === 'number' && typeof lng === 'number') {
        setCandidates(cs => cs.map(c => c.key === key ? { ...c, lat, lng, located: true } : c))
      } else {
        setCandidates(cs => cs.map(c => c.key === key ? { ...c, lat: null, lng: null, located: false } : c))
      }
    } catch {
      // leave coordinates unchanged on failure
    }
    setRelocatingKey(null)
  }

  async function confirmPicks() {
    if (!candidates.length || !apartmentId) return
    setSavingPicks(true)
    const nextOrder = (picks.length ? Math.max(...picks.map(p => p.display_order)) : 0) + 1
    const rows = candidates.map((c, i) => ({
      apartment_id: apartmentId,
      name: c.name.trim(),
      category: c.category,
      address: c.address.trim() || null,
      note: c.note.trim() || null,
      lat: c.lat,
      lng: c.lng,
      display_order: nextOrder + i,
    }))
    const { error } = await supabase.from('host_picks').insert(rows)
    if (error) {
      showErr(error.message)
    } else {
      setPasteText('')
      setCandidates([])
      showOk()
      await loadPicks()
    }
    setSavingPicks(false)
  }

  // ── Tab 7: Guide & events refresh actions ─────────────────────────────────
  async function refreshGuide() {
    if (!apartmentId) return
    setRefreshingGuide(true)
    setGuideMsg(null)
    try {
      await api.post('/generate-guide', { apartment_id: apartmentId })
      await loadGuideStatus()
      toast('City guide refreshed', 'success')
    } catch (err) {
      let code = ''
      try { code = JSON.parse(err instanceof Error ? err.message : '')?.error ?? '' } catch { /* response not JSON */ }
      if (code === 'guide_empty') {
        setGuideMsg('No places were generated this time. Please try again.')
      } else {
        setGuideMsg('Could not refresh the guide. Please try again.')
      }
    } finally {
      setRefreshingGuide(false)
    }
  }

  async function refreshEvents() {
    if (!apartmentId) return
    setRefreshingEvents(true)
    try {
      const data = await api.post<{ refreshed: boolean; generated_at?: string; reason?: string }>(
        '/refresh-events',
        { apartment_id: apartmentId }
      )
      setEventsStatus(data)
      if (data.refreshed) toast('Events refreshed', 'success')
      else if (data.reason === 'fresh') toast('Events are already up to date', 'info')
      else toast('Could not refresh events. Please try again.', 'error')
    } catch {
      toast('Could not refresh events. Please try again.', 'error')
    } finally {
      setRefreshingEvents(false)
    }
  }

  // ── Tab 8: Look save / reset ──────────────────────────────────────────────
  function applyLookHex() {
    const hex = lookCustomHex.trim()
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) setLookSelected(hex)
  }

  async function saveLook(chosen: string) {
    if (!apartmentId || !hostId) return
    setSavingLook(true)
    const { error } = await supabase
      .from('apartments')
      .update({ accent_color: chosen })
      .eq('id', apartmentId)
      .eq('host_id', hostId)
    setSavingLook(false)
    if (error) { toast(error.message, 'error'); return }
    setAptAccent(chosen)
    setOverrideOpen(true)
    toast('Property colour saved', 'success')
  }

  async function resetLook() {
    if (!apartmentId || !hostId) return
    setSavingLook(true)
    const { error } = await supabase
      .from('apartments')
      .update({ accent_color: null })
      .eq('id', apartmentId)
      .eq('host_id', hostId)
    setSavingLook(false)
    if (error) { toast(error.message, 'error'); return }
    setAptAccent(null)
    setOverrideOpen(false)
    const eff = hostAccent ?? DEFAULT_COLOR
    setLookSelected(eff)
    setLookCustomHex(ARRIVLY_CONFIG.colourPresets.some(p => p.hex === eff) ? '' : eff)
    toast('Reset to brand default', 'success')
  }

  // ── Tab 9: Calendars — save links, manual sync, CSV guest-name import ──────
  const SYNC_ERR = 'Could not sync right now. Please try again.'
  const CSV_ERR = "Could not read that CSV. Make sure it's the reservations export from Airbnb."

  async function saveIcal() {
    if (!apartmentId || !hostId) return
    setSavingIcal(true)
    const { error } = await supabase
      .from('apartments')
      .update({ ical_urls: icalUrls.trim() || null })
      .eq('id', apartmentId)
      .eq('host_id', hostId)
    setSavingIcal(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Calendar links saved', 'success')
  }

  async function syncNow() {
    if (!apartmentId) return
    setSyncing(true)
    setSyncMsg(null)
    try {
      const r = await api.post<{ imported: number; skipped: number; errors: string[] }>(
        '/sync-ical',
        { apartment_id: apartmentId }
      )
      let msg = `Synced — ${r.imported} new · ${r.skipped} already known`
      if (r.errors.length > 0) {
        msg += ` · ${r.errors.length} link${r.errors.length === 1 ? '' : 's'} couldn't be read`
      }
      setSyncMsg(msg)
      toast('Calendar synced', 'success')
    } catch {
      setSyncMsg(SYNC_ERR)
      toast(SYNC_ERR, 'error')
    } finally {
      setSyncing(false)
    }
  }

  async function handleCsvFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file || !apartmentId) return
    if (file.size > 1_000_000) { toast('That CSV is too large.', 'error'); return }
    setCsvImporting(true)
    setCsvMsg(null)
    try {
      const text = await file.text()
      const r = await api.post<{ matched: number; named: number; skipped: number; ambiguous: number }>(
        '/import-airbnb-csv',
        { apartment_id: apartmentId, csv: text }
      )
      let msg = `Added ${r.named} guest name${r.named === 1 ? '' : 's'} · ${r.matched} matched · ${r.skipped} with no match`
      if (r.ambiguous > 0) {
        msg += ` · ${r.ambiguous} extra same-date booking${r.ambiguous === 1 ? '' : 's'} to check`
      }
      setCsvMsg(msg)
      toast('Guest names imported', 'success')
    } catch {
      setCsvMsg(CSV_ERR)
      toast(CSV_ERR, 'error')
    } finally {
      setCsvImporting(false)
    }
  }

  if (loading) return <Loader />

  const guideFresh = guideGeneratedAt != null && (Date.now() - new Date(guideGeneratedAt).getTime()) < GUIDE_FRESH_HOURS * 3600_000
  const brandDefaultColor = hostAccent ?? DEFAULT_COLOR
  const isOverriding = aptAccent !== null
  const previewColor = (isOverriding || overrideOpen) ? lookSelected : brandDefaultColor

  return (
    <div className="max-w-3xl font-['Inter']">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1 text-[12px] text-[#8a8276] hover:text-[#231d17] transition-colors mb-3"
      >
        ← Back to properties
      </Link>
      <h1 className="text-[22px] font-['Fraunces'] font-light text-[#231d17] mb-4">Property setup</h1>

      {/* Tab bar — horizontal premium tabs */}
      <div className="flex gap-2 flex-wrap mb-5">
        {TABS.map(t => {
          const locked = apartmentId === null && t.key !== 'basic'
          const showLock = locked || !!t.privateLock
          return (
            <button
              key={t.key}
              onClick={() => {
                if (locked) { toast('Save your basic info first to unlock this tab', 'info'); return }
                setTab(t.key)
                setFeedback(null)
              }}
              className={`px-3.5 py-1.5 rounded-[9px] text-xs font-medium transition-colors border ${
                tab === t.key
                  ? 'bg-[#1c1c1a] text-[#f0ede6] border-[#1c1c1a]'
                  : 'bg-transparent border-[#e4ddd0] text-[#8a8276] hover:bg-[#f0ede6]'
              }${locked ? ' opacity-40 cursor-not-allowed' : ''}`}
            >
              <span className="inline-flex items-center gap-1.5">
                {t.label}
                {showLock && <Lock size={11} />}
              </span>
            </button>
          )
        })}
      </div>

      {/* Save feedback */}
      {feedback && (
        <div className={`text-xs rounded-[10px] px-3.5 py-2.5 mb-3 ${
          feedback.ok
            ? 'bg-[#eaf0dd] border border-[#d4dcc0] text-[#4a6128]'
            : 'bg-[#fbe9e9] border border-[#f0cccc] text-[#8a1a1a]'
        }`}>
          {feedback.msg}
        </div>
      )}

      {/* ── Tab 1: Basic info ─────────────────────────────────────────────── */}
      {tab === 'basic' && (
        <div className={`${CARD} space-y-4`}>
          <h2 className={HEADING}>Basics</h2>
          <div>
            <label className={LABEL}>Cover photo</label>
            <div className="flex items-start gap-3 mt-1">
              <div className="w-32 aspect-[16/10] rounded-[10px] border border-[#e4ddd0] bg-[#f0ede6] overflow-hidden shrink-0 flex items-center justify-center">
                {heroImageUrl ? (
                  <img src={resolveImageUrl(heroImageUrl)} alt="Cover" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[9px] text-[#a79e8e] text-center px-1">Default image</span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={`${apartmentId ? 'cursor-pointer hover:bg-[#f0ede6]' : 'opacity-40 cursor-not-allowed'} bg-transparent border border-[#e4ddd0] text-[#231d17] px-3.5 py-2 rounded-[9px] text-xs font-medium transition-colors inline-block`}>
                  {uploadingHero ? 'Uploading…' : heroImageUrl ? 'Replace photo' : 'Upload photo'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleHeroFile} disabled={uploadingHero || !apartmentId} />
                </label>
                {heroImageUrl && (
                  <button type="button" onClick={removeHero} disabled={uploadingHero} className="text-[11px] text-[#8a1a1a] hover:underline bg-transparent border-none cursor-pointer text-left disabled:opacity-40">Remove</button>
                )}
                <p className="text-[10.5px] text-[#8a8276] max-w-[200px] leading-snug">PNG, JPG or WebP · under 5 MB · shown as the banner at the top of your guest page. Leave empty and we'll use a photo of your city.</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={LABEL}>Property name <span className="text-[#8a1a1a] normal-case">*</span></label>
              <input
                value={basic.name}
                onChange={e => setBasic(p => ({ ...p, name: e.target.value }))}
                className={INPUT}
                placeholder="Sunny Barcelona Studio"
                required
              />
            </div>
            <div>
              <label className={LABEL}>Max guests <span className="text-[#8a1a1a] normal-case">*</span></label>
              <input
                type="number"
                min={1}
                max={20}
                value={basic.maxGuests}
                onChange={e => setBasic(p => ({ ...p, maxGuests: Number(e.target.value) }))}
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL}>Country <span className="text-[#8a1a1a] normal-case">*</span></label>
              <input
                value={basic.country}
                onChange={e => setBasic(p => ({ ...p, country: e.target.value }))}
                className={INPUT}
                placeholder="Spain"
              />
            </div>
            <div>
              <label className={LABEL}>City <span className="text-[#8a1a1a] normal-case">*</span></label>
              <input
                value={basic.city}
                onChange={e => setBasic(p => ({ ...p, city: e.target.value }))}
                className={INPUT}
                placeholder="Barcelona"
              />
            </div>
            <div>
              <label className={LABEL}>Neighbourhood <span className="text-[#8a1a1a] normal-case">*</span></label>
              <input
                value={basic.neighborhood}
                onChange={e => setBasic(p => ({ ...p, neighborhood: e.target.value }))}
                className={INPUT}
                placeholder="El Born"
              />
            </div>
            <div>
              <label className={LABEL}>Street name <span className="text-[#8a1a1a] normal-case">*</span></label>
              <input
                value={basic.street}
                onChange={e => setBasic(p => ({ ...p, street: e.target.value }))}
                className={INPUT}
                placeholder="Carrer del Rec"
              />
            </div>
            <div>
              <label className={LABEL}>Street number <span className="text-[#8a1a1a] normal-case">*</span></label>
              <input
                value={basic.streetNumber}
                onChange={e => setBasic(p => ({ ...p, streetNumber: e.target.value }))}
                className={INPUT}
                placeholder="42"
              />
            </div>
            <div className="col-span-2">
              <label className={LABEL}>Floor / entrance note <span className="text-[#b3aa9b] normal-case">(optional)</span></label>
              <input
                value={basic.floorNote}
                onChange={e => setBasic(p => ({ ...p, floorNote: e.target.value }))}
                className={INPUT}
                placeholder="3rd floor, no lift"
              />
            </div>
          </div>
          <div className="bg-[#eaf0dd] rounded-[10px] px-3.5 py-2.5 text-[11px] text-[#4a6128] leading-[1.6]">
            Full address enables a hyper-local AI guide for your exact street. Coordinates geocoded once and stored.
          </div>
          <button onClick={saveBasic} disabled={saving || !basicComplete} className={BTN_SAVE}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {/* ── Tab 2: WiFi ───────────────────────────────────────────────────── */}
      {tab === 'wifi' && (
        <div className={`${CARD} space-y-4`}>
          <h2 className={HEADING}>WiFi</h2>
          <div>
            <label className={LABEL}>Network name (SSID)</label>
            <input
              value={wifi.ssid}
              onChange={e => setWifi(p => ({ ...p, ssid: e.target.value }))}
              className={INPUT}
              placeholder="SunnyBCN_WiFi"
            />
          </div>
          <div>
            <label className={LABEL}>Password</label>
            <input
              value={wifi.password}
              onChange={e => setWifi(p => ({ ...p, password: e.target.value }))}
              className={INPUT}
              placeholder="SunnyBCN99!"
            />
          </div>
          <div className="bg-[#eaf0dd] rounded-[10px] px-3.5 py-2.5 text-[11px] text-[#4a6128] leading-[1.6]">
            Shown as a large copyable card on the guest page. One tap copies the password.
          </div>
          <button onClick={saveWifi} disabled={saving} className={BTN_SAVE}>
            {saving ? 'Saving…' : 'Save WiFi'}
          </button>
        </div>
      )}

      {/* ── Tab 3: Check-in ───────────────────────────────────────────────── */}
      {tab === 'checkin' && (
        <div className={`${CARD} space-y-4`}>
          <div className="flex items-center gap-2">
            <h2 className={HEADING}>Check-in info</h2>
            <span className="text-[10px] bg-[#f7e3e3] text-[#8a1a1a] px-2 py-0.5 rounded-full font-medium">Private</span>
          </div>
          <p className="text-[11px] text-[#8a8276]">Only shown to guests with a verified booking token.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Check-in from</label>
              <input
                value={checkin.checkInFrom}
                onChange={e => setCheckin(p => ({ ...p, checkInFrom: e.target.value }))}
                className={INPUT}
                placeholder="15:00"
              />
            </div>
            <div>
              <label className={LABEL}>Check-out by</label>
              <input
                value={checkin.checkOutBy}
                onChange={e => setCheckin(p => ({ ...p, checkOutBy: e.target.value }))}
                className={INPUT}
                placeholder="11:00"
              />
            </div>
          </div>
          <div>
            <label className={LABEL}>Door code</label>
            <input
              value={checkin.doorCode}
              onChange={e => setCheckin(p => ({ ...p, doorCode: e.target.value }))}
              className={INPUT}
              placeholder="1234#"
            />
          </div>
          <div>
            <label className={LABEL}>Entry instructions</label>
            <textarea
              value={checkin.entryInstructions}
              onChange={e => setCheckin(p => ({ ...p, entryInstructions: e.target.value }))}
              className={`${INPUT} resize-none`}
              rows={4}
              placeholder="Key safe on left of main door. Enter code 1234# and press button. Take both keys inside."
            />
          </div>
          <button onClick={saveCheckin} disabled={saving} className={BTN_SAVE}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {/* ── Tab 4: House rules ────────────────────────────────────────────── */}
      {tab === 'rules' && (
        <div className={`${CARD} space-y-4`}>
          <h2 className={HEADING}>House rules</h2>
          <p className="text-[11px] text-[#8a8276]">
            Paste your house rules. When you save, they're automatically rewritten in a warm, friendly tone (no bullet points) and stored.
          </p>
          <div>
            <label className={LABEL}>Your raw rules</label>
            <textarea
              value={rawRules}
              onChange={e => setRawRules(e.target.value)}
              className={`${INPUT} resize-none`}
              rows={5}
              placeholder="No smoking inside. No parties. Keep quiet after 10pm. Check out by 11am. No pets."
            />
          </div>
          <button onClick={saveRules} disabled={saving || !rawRules.trim()} className={BTN_SAVE}>
            {saving ? 'Polishing & saving…' : 'Save rules'}
          </button>
        </div>
      )}

      {/* ── Tab 5: Extras ─────────────────────────────────────────────────── */}
      {tab === 'extras' && (
        <div className="space-y-3.5">
          <div className={`${CARD} space-y-3.5`}>
            <h2 className={HEADING}>Extras</h2>
            <p className="text-[11px] text-[#8a8276]">
              Paste everything at once — AI identifies topics and splits into categories.{' '}
              <strong className="text-[#6b6354]">Importing replaces your current extras.</strong>
            </p>
            <div>
              <label className={LABEL}>Paste all your property info here</label>
              <textarea
                value={extrasContent}
                onChange={e => setExtrasContent(e.target.value)}
                className={`${INPUT} resize-none`}
                rows={6}
                placeholder="Parking: Blue zone on Carrer del Rec, max 2h. Bins: grey for general, blue for recycling, yellow for plastic. Washing machine: press button 3 for quick wash…"
              />
            </div>
            <button onClick={bulkImport} disabled={importing || !extrasContent.trim()} className={BTN_AI}>
              {importing ? 'Importing…' : '✦ AI bulk import'}
            </button>
            {importResult && (
              <div className="bg-[#eaf0dd] border border-[#d4dcc0] rounded-[10px] p-3 text-xs text-[#4a6128] leading-relaxed">
                Imported:{' '}
                {importResult.split(' · ').map((cat, i, arr) => (
                  <span key={cat}>
                    <strong>{cat}</strong>
                    {i < arr.length - 1 && ' · '}
                  </span>
                ))}
              </div>
            )}
          </div>

          {extrasLoading ? (
            <div className="text-[11px] text-[#b3aa9b] text-center py-4">Loading…</div>
          ) : extrasRows.length === 0 ? (
            <div className="text-center py-6 text-[#b3aa9b] text-[11px]">No extras yet — paste your property info above to import.</div>
          ) : (
            <div className="space-y-2">
              {extrasRows.map(row => (
                <div key={row.id} className="bg-[#fffdf9] border border-[#e4ddd0] rounded-[12px] px-4 py-3 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-[#a79e8e] uppercase tracking-[.06em] mb-0.5">{row.category}</div>
                    <div className="text-[12px] text-[#231d17] whitespace-pre-line leading-relaxed">{row.content}</div>
                  </div>
                  <button
                    onClick={() => deleteExtrasRow(row.id)}
                    className="text-[#cabfa9] hover:text-[#8a1a1a] transition-colors text-xs shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab 6: My picks ───────────────────────────────────────────────── */}
      {tab === 'picks' && (
        <div className="space-y-3.5">
          <p className="text-[11px] text-[#8a8276]">
            Add your favourite local places. They appear in the Explore tab on the guest page with a Navigate button.
          </p>

          {/* AI enrichment card */}
          <div className={`${CARD} space-y-3.5`}>
            <h2 className={HEADING}>✦ Add places with AI</h2>
            <p className="text-[11px] text-[#8a8276] leading-relaxed">
              Paste your favourites in free text — AI identifies each place, locates it on the map, and categorises it for you.
            </p>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              className={`${INPUT} resize-none`}
              rows={4}
              placeholder="Mercadona on Carrer del Rec, Bar Marsella, Cafe Regatta…"
            />
            <button
              onClick={enrichPicks}
              disabled={enriching || !apartmentId || !pasteText.trim()}
              className={BTN_AI}
            >
              {enriching ? 'Identifying…' : '✦ Identify places'}
            </button>

            {candidates.length > 0 && (
              <div className="space-y-3 pt-1">
                <div className={LABEL}>Review & edit before saving</div>
                {candidates.map(c => (
                  <div key={c.key} className="bg-[#f7f3ec] border border-[#e4ddd0] rounded-[10px] p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0 grid grid-cols-2 gap-2">
                        <div className="col-span-2">
                          <label className={LABEL}>Name</label>
                          <input
                            value={c.name}
                            onChange={e => updateCandidate(c.key, 'name', e.target.value)}
                            className={INPUT}
                          />
                        </div>
                        <div>
                          <label className={LABEL}>Category</label>
                          <select
                            value={c.category}
                            onChange={e => updateCandidate(c.key, 'category', e.target.value)}
                            className={INPUT}
                          >
                            {['Restaurant', 'Bar', 'Coffee', 'Sight', 'Essential', 'Nightlife'].map(cat => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={LABEL}>Address</label>
                          <input
                            value={c.address}
                            onChange={e => updateCandidate(c.key, 'address', e.target.value)}
                            className={INPUT}
                          />
                        </div>
                        <div className="col-span-2">
                          <label className={LABEL}>Your note (optional)</label>
                          <input
                            value={c.note}
                            onChange={e => updateCandidate(c.key, 'note', e.target.value)}
                            className={INPUT}
                            placeholder="Why you love it"
                          />
                        </div>
                      </div>
                      <button
                        onClick={() => removeCandidate(c.key)}
                        className="text-[#cabfa9] hover:text-[#8a1a1a] transition-colors text-xs shrink-0 mt-5"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className={`text-[10px] ${c.located ? 'text-[#4a6128]' : 'text-[#7a4800]'}`}>
                        {c.located ? '📍 Located' : "⚠ Couldn't locate — saved without map pin"}
                      </div>
                      <button
                        type="button"
                        onClick={() => relocateCandidate(c.key, [c.name, c.address].map(s => s.trim()).filter(Boolean).join(', '))}
                        disabled={!!relocatingKey || !c.address.trim()}
                        className="text-[10px] text-[#a8842f] underline underline-offset-2 hover:opacity-70 disabled:opacity-40 disabled:no-underline shrink-0"
                      >
                        {relocatingKey === c.key ? 'Locating…' : 'Re-locate from address'}
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  onClick={confirmPicks}
                  disabled={savingPicks || candidates.length === 0}
                  className={BTN_SAVE}
                >
                  {savingPicks
                    ? 'Saving…'
                    : `Confirm & add ${candidates.length} place${candidates.length === 1 ? '' : 's'}`}
                </button>
              </div>
            )}
          </div>

          {/* Picks list */}
          {picksLoading ? (
            <div className="text-[11px] text-[#b3aa9b] text-center py-4">Loading…</div>
          ) : picks.length === 0 ? (
            <div className="text-center py-6 text-[#b3aa9b] text-[11px]">No picks yet. Add your first place above.</div>
          ) : (
            <div className="space-y-2">
              {picks.map(pick => (
                <div key={pick.id} className="bg-[#fffdf9] border border-[#e4ddd0] rounded-[12px] px-4 py-3 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[12px] font-semibold text-[#231d17]">{pick.name}</span>
                      <span className="text-[10px] bg-[#f0e8ff] text-[#4a0e8f] px-2 py-0.5 rounded-full">{pick.category}</span>
                      {pick.lat !== null && <span className="text-[10px] text-[#4a6128]">📍</span>}
                    </div>
                    {pick.address && <div className="text-[11px] text-[#8a8276]">{pick.address}</div>}
                    {pick.note && <div className="text-[11px] text-[#b3aa9b] italic">{pick.note}</div>}
                  </div>
                  <button
                    onClick={() => deletePick(pick.id)}
                    className="text-[#cabfa9] hover:text-[#8a1a1a] transition-colors text-xs shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab 7: Guide & events ─────────────────────────────────────────── */}
      {tab === 'guide' && (
        <div className="space-y-3.5">
          {/* City guide */}
          <div className={`${CARD} space-y-3`}>
            <h2 className={HEADING}>City guide</h2>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12.5px] text-[#231d17]">
                  {guideStatusLoading
                    ? 'Checking…'
                    : guideGeneratedAt
                      ? `Updated ${timeAgo(guideGeneratedAt)}`
                      : 'Not generated yet'}
                </div>
                <p className="text-[11px] text-[#8a8276] mt-0.5">Refreshes automatically every month.</p>
              </div>
              <button
                onClick={refreshGuide}
                disabled={refreshingGuide || guideStatusLoading || guideFresh}
                className={`${BTN_OUTLINE} shrink-0`}
              >
                {refreshingGuide ? 'Refreshing…' : guideFresh ? 'Up to date' : '↻ Refresh guide'}
              </button>
            </div>
            {guideMsg && (
              <div className="bg-[#fbe9e9] border border-[#f0cccc] rounded-[10px] px-3.5 py-2.5 text-[11px] text-[#8a1a1a]">
                {guideMsg}
              </div>
            )}
          </div>

          {/* Local events */}
          <div className={`${CARD} space-y-3`}>
            <h2 className={HEADING}>Local events</h2>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12.5px] text-[#231d17]">
                  {eventsStatus
                    ? eventsStatus.generated_at
                      ? eventsStatus.refreshed
                        ? 'Refreshed just now'
                        : `Up to date · refreshed ${timeAgo(eventsStatus.generated_at)}`
                      : 'Could not refresh — please try again'
                    : 'This week’s events for your city'}
                </div>
                <p className="text-[11px] text-[#8a8276] mt-0.5">Refreshes automatically while guests are staying.</p>
              </div>
              <button
                onClick={refreshEvents}
                disabled={refreshingEvents}
                className={`${BTN_OUTLINE} shrink-0`}
              >
                {refreshingEvents ? 'Refreshing…' : '↻ Refresh events'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab 9: Calendars ──────────────────────────────────────────────── */}
      {tab === 'calendars' && (
        <div className="space-y-3.5">
          {/* Calendar sync */}
          <div className={`${CARD} space-y-3.5`}>
            <h2 className={HEADING}>Calendar sync</h2>
            <p className="text-[11px] text-[#8a8276]">
              Paste your Airbnb or Vrbo calendar links, one per line. We check them daily and block those dates automatically.
            </p>
            <textarea
              value={icalUrls}
              onChange={e => setIcalUrls(e.target.value)}
              className={`${INPUT} resize-none`}
              rows={3}
              placeholder="https://www.airbnb.com/calendar/ical/12345.ics?s=…"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={saveIcal} disabled={savingIcal} className={BTN_SAVE}>
                {savingIcal ? 'Saving…' : 'Save'}
              </button>
              <button onClick={syncNow} disabled={syncing || icalUrls.trim() === ''} className={BTN_OUTLINE}>
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            </div>
            {syncMsg && (
              <p className={`text-[11px] ${syncMsg === SYNC_ERR ? 'text-[#8a1a1a]' : 'text-[#8a8276]'}`}>
                {syncMsg}
              </p>
            )}
          </div>

          {/* Guest names from Airbnb */}
          <div className={`${CARD} space-y-3.5`}>
            <h2 className={HEADING}>Guest names from Airbnb</h2>
            <p className="text-[11px] text-[#8a8276]">
              Airbnb calendars don't include guest names. Download your reservations CSV from Airbnb and upload it here — we'll add each guest's first name to the matching booking. Names then stay put through every future sync.
            </p>
            <div>
              <label className={`${(csvImporting || !apartmentId) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-[#f0ede6]'} bg-transparent border border-[#e4ddd0] text-[#231d17] px-3.5 py-2 rounded-[9px] text-xs font-medium transition-colors inline-block`}>
                {csvImporting ? 'Importing…' : 'Upload Airbnb CSV'}
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvFile} disabled={csvImporting || !apartmentId} />
              </label>
            </div>
            {csvMsg && (
              <p className={`text-[11px] ${csvMsg === CSV_ERR ? 'text-[#8a1a1a]' : 'text-[#8a8276]'}`}>
                {csvMsg}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Tab 8: Look ───────────────────────────────────────────────────── */}
      {tab === 'look' && (
        <div className="space-y-3.5">
          {lookLoading ? (
            <div className="text-[11px] text-[#b3aa9b] text-center py-6">Loading…</div>
          ) : (
            <div className="flex flex-col md:flex-row gap-5 items-start">
              {/* Left: controls */}
              <div className="flex-1 w-full space-y-3.5">
                <div className={`${CARD} space-y-4`}>
                  <h2 className={HEADING}>Look</h2>

                  {!isOverriding && !overrideOpen ? (
                    /* INHERIT state */
                    <>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-[8px] border border-[#e4ddd0] shrink-0" style={{ backgroundColor: brandDefaultColor }} />
                        <div className="min-w-0">
                          <div className="text-[13px] text-[#231d17] font-medium">Using your brand default</div>
                          <div className="text-[11px] text-[#8a8276] font-mono">{brandDefaultColor}</div>
                        </div>
                      </div>
                      <button onClick={() => setOverrideOpen(true)} className={BTN_OUTLINE}>
                        Override for this property
                      </button>
                    </>
                  ) : (
                    /* OVERRIDE editor (either an existing override, or just revealed from inherit) */
                    <>
                      {!isOverriding && (
                        <p className="text-[11px] text-[#8a8276] -mt-1">
                          Pick a colour just for this property. It won't change your brand default.
                        </p>
                      )}
                      <div>
                        <label className={LABEL}>Property colour</label>
                        <div className="grid grid-cols-3 gap-2 mt-1">
                          {ARRIVLY_CONFIG.colourPresets.map(preset => {
                            const active = lookSelected === preset.hex && !lookCustomHex
                            return (
                              <button
                                key={preset.hex}
                                onClick={() => { setLookSelected(preset.hex); setLookCustomHex('') }}
                                className={`flex items-center gap-2 rounded-[10px] p-2.5 border transition-colors text-left ${
                                  active
                                    ? 'border-[#c8a24e] bg-[rgba(200,162,78,0.08)] shadow-sm'
                                    : 'border-[#e4ddd0] hover:border-[#a8842f]'
                                }`}
                              >
                                <div className="w-6 h-6 rounded-[6px] shrink-0" style={{ backgroundColor: preset.hex }} />
                                <span className="text-[11px] text-[#231d17]">{preset.name}</span>
                                {active && <span className="ml-auto text-[11px] text-[#a8842f]">✓</span>}
                              </button>
                            )
                          })}
                        </div>

                        <div className="mt-3.5">
                          <label className={LABEL}>Custom hex</label>
                          <div className="flex gap-2 items-center">
                            <div className="w-8 h-8 rounded-[7px] border border-[#e4ddd0] shrink-0" style={{ backgroundColor: lookCustomHex || lookSelected }} />
                            <input
                              value={lookCustomHex}
                              onChange={e => setLookCustomHex(e.target.value)}
                              onBlur={applyLookHex}
                              className="flex-1 bg-white border border-[#e0dacd] rounded-[10px] px-3.5 py-2.5 text-xs text-[#1c1c1a] font-mono focus:outline-none focus:border-[#c8a24e] focus:ring-2 focus:ring-[#c8a24e]/20 transition-colors"
                              placeholder="#2c4a8a"
                              maxLength={7}
                            />
                            <button onClick={applyLookHex} className={BTN_OUTLINE}>Apply</button>
                          </div>
                          {lookCustomHex.trim() && !/^#[0-9a-fA-F]{6}$/.test(lookCustomHex.trim()) && (
                            <p className="text-[10.5px] text-[#8a1a1a] mt-1.5">Enter a 6-digit hex like #2c4a8a.</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => {
                            // Read the latest typed hex at click-time so an un-"Applied" custom
                            // value isn't lost to a stale closure; fall back to the selected colour.
                            const typed = lookCustomHex.trim()
                            saveLook(/^#[0-9a-fA-F]{6}$/.test(typed) ? typed : lookSelected)
                          }}
                          disabled={savingLook}
                          className={BTN_SAVE}
                        >
                          {savingLook ? 'Saving…' : 'Save colour'}
                        </button>
                        {isOverriding ? (
                          <button onClick={resetLook} disabled={savingLook} className={BTN_OUTLINE}>
                            Reset to brand default
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setOverrideOpen(false)
                              const eff = hostAccent ?? DEFAULT_COLOR
                              setLookSelected(eff)
                              setLookCustomHex(ARRIVLY_CONFIG.colourPresets.some(p => p.hex === eff) ? '' : eff)
                            }}
                            disabled={savingLook}
                            className={BTN_OUTLINE}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </>
                  )}

                  <p className="text-[10.5px] text-[#8a8276] pt-1 border-t border-[#f0ede6]">
                    Logo, brand name and your default colour live in{' '}
                    <Link to="/dashboard/branding" className="text-[#a8842f] underline underline-offset-2 hover:text-[#c8a24e]">Branding</Link>.
                  </p>
                </div>
              </div>

              {/* Right: phone preview */}
              <div className="shrink-0 mx-auto md:mx-0">
                <div className="text-[10px] font-medium uppercase tracking-[.12em] text-[#a79e8e] mb-2 text-center">Preview</div>
                <div
                  className="relative rounded-[28px] overflow-hidden border-[3px]"
                  style={{ width: 180, borderColor: '#2a2a2a' }}
                >
                  {/* Status bar */}
                  <div className="h-5 flex items-center justify-center" style={{ backgroundColor: previewColor }}>
                    <div className="w-10 h-1.5 bg-black/30 rounded-full" />
                  </div>
                  {/* Hero */}
                  <div className="px-3 py-3" style={{ backgroundColor: previewColor }}>
                    <div className="text-[10px] text-white/60 mb-0.5">Welcome</div>
                    <div className="text-[14px] font-['Fraunces'] font-light text-white leading-tight">
                      {basic.name.trim() || 'Your property'}
                    </div>
                  </div>
                  {/* WiFi card with accent left border */}
                  <div className="bg-white px-3 py-2.5 border-b border-[#f0ede6] border-l-[3px]" style={{ borderLeftColor: previewColor }}>
                    <div className="text-[9px] uppercase tracking-[.06em] text-[#999] mb-0.5">WiFi</div>
                    <div className="text-[10px] font-semibold text-[#1a1a1a]">{wifi.ssid || 'SunnyBCN_WiFi'}</div>
                    <div className="text-[10px] text-[#888]">{wifi.password || 'SunnyBCN99!'}</div>
                  </div>
                  {/* Tabbar */}
                  <div className="bg-white px-3 py-2 flex gap-2">
                    {['Home', 'Explore', 'Chat'].map((t, i) => (
                      <div
                        key={t}
                        className={`text-[9px] px-2 py-0.5 rounded-full ${i === 0 ? 'text-white font-semibold' : 'text-[#888]'}`}
                        style={i === 0 ? { backgroundColor: previewColor } : {}}
                      >
                        {t}
                      </div>
                    ))}
                  </div>
                  {/* Take me home button */}
                  <div className="bg-white px-3 py-2.5">
                    <div className="rounded-[6px] py-1.5 text-center text-[9px] font-semibold text-white" style={{ backgroundColor: previewColor }}>
                      Take me home
                    </div>
                  </div>
                  {/* Home bar */}
                  <div className="bg-white h-4 flex items-center justify-center">
                    <div className="w-8 h-1 bg-[#ddd] rounded-full" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
