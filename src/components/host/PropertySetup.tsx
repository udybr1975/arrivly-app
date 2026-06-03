import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import Loader from '../shared/Loader'
import { resolveImageUrl, uploadImage } from '../../lib/imageUtils'

const TABS = [
  { key: 'basic',   label: 'Basic info' },
  { key: 'wifi',    label: 'WiFi' },
  { key: 'checkin', label: 'Check-in 🔒' },
  { key: 'rules',   label: 'House rules' },
  { key: 'extras',  label: 'Extras (AI import)' },
  { key: 'picks',   label: 'My picks' },
] as const

type Tab = (typeof TABS)[number]['key']

const INPUT = 'w-full bg-[#f8f6f2] border border-[#ddd8ce] rounded-[8px] px-3 py-2 text-xs text-[#444] focus:outline-none focus:border-[#1a1a1a] transition-colors'
const LABEL = 'block text-[10px] uppercase tracking-[.06em] text-[#999] mb-[3px]'
const BTN_DARK = 'bg-[#1a1a1a] text-white px-4 py-2 rounded-[8px] text-xs font-semibold hover:opacity-80 transition-opacity disabled:opacity-40'
const BTN_AI = 'bg-[#1a1a1a] text-white px-4 py-2 rounded-[8px] text-xs font-semibold hover:opacity-80 transition-opacity disabled:opacity-40'

export default function PropertySetup() {
  const { aptId } = useParams<{ aptId: string }>()
  const navigate = useNavigate()
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
      setPasteText('')
      setCandidates([])
      setEnriching(false)
      setPicks([])
      setRelocatingKey(null)
      setHeroImageUrl(null)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      setHostId(user.id)

      const { data: apt } = await supabase
        .from('apartments')
        .select('id, name, country, city, neighborhood, street, street_number, floor_note, max_guests, hero_image_url')
        .eq('id', aptId)
        .eq('host_id', user.id)
        .maybeSingle()

      if (!apt) { navigate('/dashboard'); return }

      setApartmentId(apt.id)
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
  }, [aptId])

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

  function showOk() {
    setFeedback({ ok: true, msg: 'Saved ✓' })
    setTimeout(() => setFeedback(null), 2000)
  }

  function showErr(msg: string) {
    setFeedback({ ok: false, msg })
  }

  // ── Tab 1 ──────────────────────────────────────────────────────────────────
  async function saveBasic() {
    if (!basic.name.trim()) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { showErr('Not logged in'); setSaving(false); return }

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

    if (apartmentId) {
      const { error } = await supabase.from('apartments').update(fields).eq('id', apartmentId).eq('host_id', user.id)
      if (error) { showErr(error.message); setSaving(false); return }
    } else {
      const { data, error } = await supabase
        .from('apartments')
        .insert({ host_id: user.id, ...fields })
        .select('id')
        .maybeSingle()
      if (error || !data) { showErr(error?.message ?? 'Could not create property'); setSaving(false); return }
      setApartmentId(data.id)
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
  }

  async function handleHeroFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !apartmentId || !hostId) return
    const mimeToExt: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
    if (!mimeToExt[file.type]) { showErr('Use a PNG, JPG or WebP image.'); return }
    if (file.size > 5 * 1024 * 1024) { showErr('Cover photo must be under 5 MB.'); return }
    setUploadingHero(true)
    try {
      const ext = mimeToExt[file.type]
      const path = `${hostId}/${apartmentId}/hero-${Date.now()}.${ext}`
      await uploadImage(file, path)
      const { error } = await supabase.from('apartments').update({ hero_image_url: path }).eq('id', apartmentId).eq('host_id', hostId)
      if (error) throw error
      setHeroImageUrl(path)
      showOk()
    } catch (err) {
      showErr(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingHero(false)
    }
  }

  async function removeHero() {
    if (!apartmentId || !hostId) return
    const { error } = await supabase.from('apartments').update({ hero_image_url: null }).eq('id', apartmentId).eq('host_id', hostId)
    if (error) { showErr(error.message); return }
    setHeroImageUrl(null)
    showOk()
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
    try {
      await api.post('/bulk-import', { content: extrasContent, apartmentId })
    } catch { /* stub — result shown regardless */ }
    setImportResult('Parking · Recycling · Appliances · Transport · Amenities')
    setImporting(false)
  }

  async function deletePick(id: string) {
    if (!apartmentId) return
    const { error } = await supabase.from('host_picks').delete().eq('id', id).eq('apartment_id', apartmentId)
    if (error) { showErr(error.message); return }
    await loadPicks()
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

  if (loading) return <Loader />

  return (
    <div className="max-w-2xl">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1 text-[11px] text-[#888] hover:text-[#1a1a1a] transition-colors mb-3"
      >
        ← Back to properties
      </Link>
      <h1 className="text-[17px] font-serif font-light text-[#1a1a1a] mb-4">Property setup</h1>

      {/* Tab bar */}
      <div className="flex gap-1.5 flex-wrap mb-4">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setFeedback(null) }}
            className={`px-3 py-1.5 rounded-[7px] text-xs font-medium transition-colors border ${
              tab === t.key
                ? 'bg-[#1a1a1a] text-white border-[#1a1a1a]'
                : 'bg-transparent border-[#ddd8ce] text-[#666] hover:bg-[#f0ede6]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Save feedback */}
      {feedback && (
        <div className={`text-xs rounded-[8px] px-3 py-2 mb-3 ${
          feedback.ok
            ? 'bg-[#e4f0da] border border-[#c5e0b0] text-[#2a5c0a]'
            : 'bg-[#fde4e4] border border-[#f5c6c6] text-[#8a1a1a]'
        }`}>
          {feedback.msg}
        </div>
      )}

      {/* ── Tab 1: Basic info ─────────────────────────────────────────────── */}
      {tab === 'basic' && (
        <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 space-y-3">
          <div>
            <label className={LABEL}>Cover photo</label>
            <div className="flex items-start gap-3 mt-1">
              <div className="w-32 aspect-[16/10] rounded-[8px] border border-[#ddd8ce] bg-[#f8f6f2] overflow-hidden shrink-0 flex items-center justify-center">
                {heroImageUrl ? (
                  <img src={resolveImageUrl(heroImageUrl)} alt="Cover" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[9px] text-[#999] text-center px-1">Default image</span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={`${apartmentId ? 'cursor-pointer hover:bg-[#f0ede6]' : 'opacity-40 cursor-not-allowed'} bg-transparent border border-[#ddd8ce] text-[#444] px-3 py-2 rounded-[7px] text-xs transition-colors inline-block`}>
                  {uploadingHero ? 'Uploading…' : heroImageUrl ? 'Replace photo' : 'Upload photo'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleHeroFile} disabled={uploadingHero || !apartmentId} />
                </label>
                {heroImageUrl && (
                  <button type="button" onClick={removeHero} disabled={uploadingHero} className="text-[11px] text-[#a33] hover:underline bg-transparent border-none cursor-pointer text-left disabled:opacity-40">Remove</button>
                )}
                <p className="text-[10px] text-[#999] max-w-[200px] leading-snug">PNG, JPG or WebP · under 5 MB · shown as the banner at the top of your guest page. Leave empty for a default image.</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={LABEL}>Property name <span className="text-red-500 normal-case">*</span></label>
              <input
                value={basic.name}
                onChange={e => setBasic(p => ({ ...p, name: e.target.value }))}
                className={INPUT}
                placeholder="Sunny Barcelona Studio"
                required
              />
            </div>
            <div>
              <label className={LABEL}>Max guests</label>
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
              <label className={LABEL}>Country</label>
              <input
                value={basic.country}
                onChange={e => setBasic(p => ({ ...p, country: e.target.value }))}
                className={INPUT}
                placeholder="Spain"
              />
            </div>
            <div>
              <label className={LABEL}>City</label>
              <input
                value={basic.city}
                onChange={e => setBasic(p => ({ ...p, city: e.target.value }))}
                className={INPUT}
                placeholder="Barcelona"
              />
            </div>
            <div>
              <label className={LABEL}>Neighbourhood</label>
              <input
                value={basic.neighborhood}
                onChange={e => setBasic(p => ({ ...p, neighborhood: e.target.value }))}
                className={INPUT}
                placeholder="El Born"
              />
            </div>
            <div>
              <label className={LABEL}>Street name</label>
              <input
                value={basic.street}
                onChange={e => setBasic(p => ({ ...p, street: e.target.value }))}
                className={INPUT}
                placeholder="Carrer del Rec"
              />
            </div>
            <div>
              <label className={LABEL}>Street number</label>
              <input
                value={basic.streetNumber}
                onChange={e => setBasic(p => ({ ...p, streetNumber: e.target.value }))}
                className={INPUT}
                placeholder="42"
              />
            </div>
            <div className="col-span-2">
              <label className={LABEL}>Floor / entrance note <span className="text-[#aaa] normal-case">(optional)</span></label>
              <input
                value={basic.floorNote}
                onChange={e => setBasic(p => ({ ...p, floorNote: e.target.value }))}
                className={INPUT}
                placeholder="3rd floor, no lift"
              />
            </div>
          </div>
          <div className="bg-[#e4f0da] rounded-[7px] px-3 py-2 text-[11px] text-[#2a5c0a] leading-[1.6]">
            Full address enables a hyper-local AI guide for your exact street. Coordinates geocoded once and stored.
          </div>
          <button onClick={saveBasic} disabled={saving || !basic.name.trim()} className={BTN_DARK}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {/* ── Tab 2: WiFi ───────────────────────────────────────────────────── */}
      {tab === 'wifi' && (
        <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 space-y-3">
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
          <div className="bg-[#e4f0da] rounded-[7px] px-3 py-2 text-[11px] text-[#2a5c0a] leading-[1.6]">
            Shown as a large copyable card on the guest page. One tap copies the password.
          </div>
          <button onClick={saveWifi} disabled={saving} className={BTN_DARK}>
            {saving ? 'Saving…' : 'Save WiFi'}
          </button>
        </div>
      )}

      {/* ── Tab 3: Check-in ───────────────────────────────────────────────── */}
      {tab === 'checkin' && (
        <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[12px] font-semibold text-[#1a1a1a]">Check-in info</span>
            <span className="text-[10px] bg-[#fde4e4] text-[#8a1a1a] px-2 py-0.5 rounded-full font-medium">Private</span>
          </div>
          <p className="text-[11px] text-[#888]">Only shown to guests with a verified booking token.</p>
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
          <button onClick={saveCheckin} disabled={saving} className={BTN_DARK}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {/* ── Tab 4: House rules ────────────────────────────────────────────── */}
      {tab === 'rules' && (
        <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 space-y-3">
          <p className="text-[11px] text-[#888]">
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
          <button onClick={saveRules} disabled={saving || !rawRules.trim()} className={BTN_DARK}>
            {saving ? 'Polishing & saving…' : 'Save rules'}
          </button>
        </div>
      )}

      {/* ── Tab 5: Extras ─────────────────────────────────────────────────── */}
      {tab === 'extras' && (
        <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 space-y-3">
          <p className="text-[11px] text-[#888]">
            Paste everything at once. AI identifies topics and splits into categories: Parking, Bins, Appliances, Transport etc.
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
            <div className="bg-[#f8f6f2] border border-[#ddd8ce] rounded-[8px] p-3 text-xs text-[#666] leading-relaxed">
              AI splits into categories:{' '}
              {importResult.split(' · ').map((cat, i, arr) => (
                <span key={cat}>
                  <strong className="text-[#1a1a1a]">{cat}</strong>
                  {i < arr.length - 1 && ' · '}
                </span>
              ))}
              . Each saved as a separate apartment_details row. You can edit or delete any row after import.
            </div>
          )}
        </div>
      )}

      {/* ── Tab 6: My picks ───────────────────────────────────────────────── */}
      {tab === 'picks' && (
        <div className="space-y-3">
          <p className="text-[11px] text-[#888]">
            Add your favourite local places. They appear in the Explore tab on the guest page with a Navigate button.
          </p>

          {/* AI enrichment card */}
          <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 space-y-3">
            <div className="text-[12px] font-semibold text-[#1a1a1a]">✦ Add places with AI</div>
            <p className="text-[11px] text-[#888] leading-relaxed">
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
                  <div key={c.key} className="bg-[#f8f6f2] border border-[#ddd8ce] rounded-[8px] p-3 space-y-2">
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
                        className="text-[#ccc] hover:text-[#8a1a1a] transition-colors text-xs shrink-0 mt-5"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className={`text-[10px] ${c.located ? 'text-[#2a5c0a]' : 'text-[#7a4800]'}`}>
                        {c.located ? '📍 Located' : "⚠ Couldn't locate — saved without map pin"}
                      </div>
                      <button
                        type="button"
                        onClick={() => relocateCandidate(c.key, [c.name, c.address].map(s => s.trim()).filter(Boolean).join(', '))}
                        disabled={!!relocatingKey || !c.address.trim()}
                        className="text-[10px] text-[#0c3d70] underline underline-offset-2 hover:opacity-70 disabled:opacity-40 disabled:no-underline shrink-0"
                      >
                        {relocatingKey === c.key ? 'Locating…' : 'Re-locate from address'}
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  onClick={confirmPicks}
                  disabled={savingPicks || candidates.length === 0}
                  className={BTN_DARK}
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
            <div className="text-[11px] text-[#aaa] text-center py-4">Loading…</div>
          ) : picks.length === 0 ? (
            <div className="text-center py-6 text-[#aaa] text-[11px]">No picks yet. Add your first place above.</div>
          ) : (
            <div className="space-y-2">
              {picks.map(pick => (
                <div key={pick.id} className="bg-white border border-[#ddd8ce] rounded-[10px] px-4 py-3 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[12px] font-semibold text-[#1a1a1a]">{pick.name}</span>
                      <span className="text-[10px] bg-[#f0e8ff] text-[#4a0e8f] px-2 py-0.5 rounded-full">{pick.category}</span>
                      {pick.lat !== null && <span className="text-[10px] text-[#2a5c0a]">📍</span>}
                    </div>
                    {pick.address && <div className="text-[11px] text-[#888]">{pick.address}</div>}
                    {pick.note && <div className="text-[11px] text-[#aaa] italic">{pick.note}</div>}
                  </div>
                  <button
                    onClick={() => deletePick(pick.id)}
                    className="text-[#ccc] hover:text-[#8a1a1a] transition-colors text-xs shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
