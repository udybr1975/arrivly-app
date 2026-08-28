import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import { ARRIVLY_CONFIG } from '../../config'
import Loader from '../shared/Loader'
import { resolveImageUrl, uploadImage, deleteImage } from '../../lib/imageUtils'
import { useToast } from '../shared/Toast'
import PolicyBlockToast from '../shared/PolicyBlockToast'
import ImportListing, { type AcceptedImport, type ApplySectionResult } from './ImportListing'
import { SOURCE_DOC_MAX_CHARS } from '../../lib/listingText'
import {
  EXTRAS_CATEGORIES,
  DETAIL_CATEGORY,
  isRulesCategory,
  isWifiCategory,
  isCheckinCategory,
} from '../../lib/detailCategories'

// The move distance that counts as "a different place". THE DATABASE OWNS THE OTHER COPY of
// this number: `public.enforce_property_address_swap()` blocks a move beyond it for a host at
// their property cap. There is no migration file in this repo, so this comment is the only
// signpost that changing either half is a two-sided change.
const MOVED_KM_THRESHOLD = 1

// Great-circle distance in km. Unrounded — callers round only where they display it, so the
// MOVED_KM_THRESHOLD is compared against the real value rather than a rounded one.
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

// The DB trigger sends `cap=N;km=X` in the error HINT. Parsed DEFENSIVELY: the hint is a
// diagnostic channel, not a contract — PostgREST may drop it, a future trigger edit may reword
// it, and a malformed value must never turn a blocked save into a thrown exception. Anything
// unparseable comes back null and the panel falls back to copy that needs no numbers.
function parseSwapHint(hint: unknown): { capText: string | null; kmText: string | null } {
  if (typeof hint !== 'string') return { capText: null, kmText: null }
  const cap = /(?:^|;)\s*cap=(\d{1,4})(?:;|$)/.exec(hint)
  const km = /(?:^|;)\s*km=(\d{1,6}(?:\.\d{1,3})?)(?:;|$)/.exec(hint)
  const capNum = cap ? Number(cap[1]) : NaN
  const kmNum = km ? Number(km[1]) : NaN
  return {
    capText: Number.isFinite(capNum) && capNum > 0 ? String(capNum) : null,
    kmText: Number.isFinite(kmNum) && kmNum > 0 ? formatKm(kmNum) : null,
  }
}

// dd.mm.yyyy — the format the rest of this dashboard uses. Falls back to the raw value rather
// than rendering "Invalid Date" if the column ever holds something unexpected.
function fmtImportedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

// One decimal under 10 km, whole numbers above — "1.4 km" and "37 km" both read naturally.
function formatKm(km: number) {
  return km < 10 ? km.toFixed(1) : String(Math.round(km))
}

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

// Shape of the Basics tab's form state, named so a ref can hold a restorable snapshot of it.
type BasicFields = {
  name: string
  maxGuests: number
  country: string
  city: string
  neighborhood: string
  street: string
  streetNumber: string
  floorNote: string
}

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
  // Last coordinates known to be STORED for this apartment. Used only to decide whether a save
  // actually moved the pin, so canonical-city resolution runs once per real address change
  // rather than on every save (that is what keeps us inside LocationIQ's 5,000/day free tier).
  const savedCoordsRef = useRef<{ lat: number | null; lng: number | null }>({ lat: null, lng: null })
  // The last Basics values known to be STORED. A blocked address swap rejects the WHOLE row
  // write, so "Keep the current address" restores every field, not just the address — otherwise
  // the form would keep showing values the DB refused and the host would believe they saved.
  const savedBasicRef = useRef<BasicFields | null>(null)
  const [hostId, setHostId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  // Address-swap panels. `swapBlocked` = the DB trigger refused the write (host at their cap,
  // move beyond MOVED_KM_THRESHOLD) — the stored address is unchanged. `moveNotice` = the write
  // SUCCEEDED and moved
  // the property far enough that its generated content now describes somewhere else.
  const [swapBlocked, setSwapBlocked] = useState<{ capText: string | null; kmText: string | null } | null>(null)
  const [moveNotice, setMoveNotice] = useState<{ kmText: string } | null>(null)

  // Tab 1
  const [basic, setBasic] = useState({
    name: '', maxGuests: 2, country: '', city: '',
    neighborhood: '', street: '', streetNumber: '', floorNote: '',
  })
  // NOT edited by any tab — held only so the listing importer's review screen can show the
  // TRUE current value beside a proposed description. Without it that row would read "empty"
  // over a real description and the host would overwrite it unknowingly.
  const [aptDescription, setAptDescription] = useState('')
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
  // How many content tabs already hold something, derived in the load effect from `dets` —
  // data that load ALREADY fetched, so the importer's auto-hide costs no extra query.
  const [filledTabCount, setFilledTabCount] = useState(0)
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
    // CANCELLATION GUARD. Recorded debt until now, and the listing importer is what made it able
    // to move a CREDENTIAL: applying an import falls back to the stored `wifi`/`checkin` state
    // for any field the document did not mention, so a late response from the PREVIOUS apartment
    // landing after the switch could write apartment A's password into apartment B's row.
    // Both rows are is_private:true, so this was never an anon exposure — but it was a real
    // cross-property write, and the fix is the same three lines it always was.
    let cancelled = false
    async function load() {
      if (!aptId) { navigate('/dashboard'); return }

      setLoading(true)
      setFeedback(null)
      // Both address panels describe THIS apartment, and the route renders the same element for
      // every :aptId — without this, a panel survives a switch and asserts something about a
      // property that is no longer open.
      clearAddressPanels()
      setBasic({ name: '', maxGuests: 2, country: '', city: '', neighborhood: '', street: '', streetNumber: '', floorNote: '' })
      setWifi({ ssid: '', password: '' })
      setCheckin({ checkInFrom: '', checkOutBy: '', doorCode: '', entryInstructions: '' })
      setRawRules('')
      setExtrasContent('')
      setImportResult('')
      setExtrasRows([])
      setPasteText('')
      setCandidates([])
      setFilledTabCount(0)
      setEnriching(false)
      setPicks([])
      setRelocatingKey(null)
      setHeroImageUrl(null)
      setAptDescription('')
      // Reset UNCONDITIONALLY, before the 'new' early-return below. Leaving the previous
      // apartment's coordinates here would break the change-check for a second unit at the SAME
      // address (same street+number geocodes to identical coordinates), so that apartment would
      // never resolve a canonical city. Routine for a multi-property host.
      savedCoordsRef.current = { lat: null, lng: null }
      savedBasicRef.current = null
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
      // Guard after EVERY await, including this first one. The three below cover the
      // credential-bearing state; this one covers `hostId` and the `/new` branch, whose stale
      // resolution would reset apartmentId to null after a switch.
      if (cancelled) return
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
        .select('id, name, country, city, neighborhood, street, street_number, floor_note, max_guests, hero_image_url, lat, lng, description')
        .eq('id', aptId)
        .eq('host_id', user.id)
        .maybeSingle()

      // Guard AFTER every await and BEFORE any setState: a late response must neither write
      // another apartment's values into state nor navigate away from the one now open.
      if (cancelled) return
      if (!apt) { navigate('/dashboard'); return }

      setApartmentId(apt.id)
      // Remember the stored coordinates so a save can tell whether they actually CHANGED.
      // A ref, not state: nothing renders from it and it must not trigger a re-render.
      savedCoordsRef.current = {
        lat: typeof apt.lat === 'number' ? apt.lat : null,
        lng: typeof apt.lng === 'number' ? apt.lng : null,
      }
      savedBasicRef.current = {
        name: apt.name ?? '',
        maxGuests: apt.max_guests ?? 2,
        country: apt.country ?? '',
        city: apt.city ?? '',
        neighborhood: apt.neighborhood ?? '',
        street: apt.street ?? '',
        streetNumber: apt.street_number ?? '',
        floorNote: apt.floor_note ?? '',
      }
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
      setAptDescription(apt.description ?? '')

      const { data: dets } = await supabase
        .from('apartment_details')
        .select('category, content, is_private')
        .eq('apartment_id', apt.id)
        // Deterministic order: without it PostgREST row order is unspecified, so which
        // row wins a single-valued field below could vary between loads.
        .order('id')

      if (cancelled) return
      if (dets) {
        // Read EVERY matching row, not just the first: saveWifi now DELETES every row
        // isWifiCategory matches, so anything not loaded here would be destroyed without
        // the host ever seeing it. Prefix search across the joined text, falling back to
        // the old positional read for a legacy row that carries no prefix.
        const wifiRows = dets.filter(d => isWifiCategory(d.category))
        if (wifiRows.length > 0) {
          const lines = wifiRows.map(d => d.content).join('\n').split('\n')
          const prefixed = (p: string) => lines.find(l => l.startsWith(p))?.slice(p.length)
          setWifi({
            ssid: prefixed('Network: ') ?? (lines[0] ?? '').replace('Network: ', ''),
            password: prefixed('Password: ') ?? (lines[1] ?? '').replace('Password: ', ''),
          })
        }

        const ciRows = dets.filter(d => isCheckinCategory(d.category))
        setCheckin({
          checkInFrom:        ciRows.find(d => d.content.startsWith('Check-in from: '))?.content.replace('Check-in from: ', '') ?? '',
          checkOutBy:         ciRows.find(d => d.content.startsWith('Check-out by: '))?.content.replace('Check-out by: ', '') ?? '',
          doorCode:           ciRows.find(d => d.content.startsWith('Door code: '))?.content.replace('Door code: ', '') ?? '',
          // JOIN every non-prefixed row — saveCheckin now deletes them all, so a second
          // free-text row would otherwise be destroyed unseen. The three prefixed fields
          // above stay first-wins: they are single-valued, and two rows sharing a prefix
          // are contradictory data where one must win either way.
          entryInstructions:  ciRows.filter(d =>
            !d.content.startsWith('Check-in from: ') &&
            !d.content.startsWith('Check-out by: ') &&
            !d.content.startsWith('Door code: ')
          ).map(d => d.content).join('\n'),
        })

        // Join every matching PUBLIC row. This is deliberately NOT the guest page's
        // filter — GuestPage's rulesRaw has no is_private conjunct, so a verified guest
        // can be shown a private rules-matching row the host is not. At most one row
        // matches today. `!d.is_private` is a PRIVACY guard, not a display choice:
        // saveRules re-inserts this joined text as is_private:false, which anon can read. The matchers are
        // deliberately permissive and NOT disjoint in general — 'House entry rules' matches
        // both isRulesCategory and isCheckinCategory — so without this a private door-code
        // row could be republished as public. Unreachable today (no writer produces a
        // private rules-matching row); nothing else enforces it.
        const rulesRows = dets.filter(d => isRulesCategory(d.category) && !d.is_private)
        if (rulesRows.length > 0) setRawRules(rulesRows.map(d => d.content).join('\n'))

        // Derived from rows ALREADY fetched above — no extra query. Drives only the
        // importer entry card's auto-hide, so an approximate count is fine: it decides
        // whether to OFFER a shortcut, never what is saved.
        setFilledTabCount(
          [
            !!apt.name && !!apt.city,
            wifiRows.length > 0,
            ciRows.length > 0,
            rulesRows.length > 0,
            dets.some(d => EXTRAS_CATEGORIES.includes(d.category)),
          ].filter(Boolean).length,
        )
      }

      if (cancelled) return
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
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
    // SORTED BY THE SHARED ARRAY, because this list did NOT honour it: the query has no ORDER BY,
    // so the editor rendered extras in unspecified DB order while the guest page mapped over
    // EXTRAS_CATEGORIES and rendered them in array order. The two disagreed. Now both put
    // 'During your stay' first, which is the whole point of adding it at index 0 — hospitality
    // before utilities, in the editor the host reviews AND on the page the guest reads.
    // NOT ALL THREE, and the claim is scoped deliberately: WelcomePage renders the same rows
    // filtered by EXCLUSION, in DB order, and still does. Cosmetic there, but "every consumer
    // agrees" would be false — recorded as a residual rather than widened silently.
    setExtrasRows(
      [...(data ?? [])].sort(
        (a, b) => EXTRAS_CATEGORIES.indexOf(a.category) - EXTRAS_CATEGORIES.indexOf(b.category),
      ),
    )
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

  // WHAT THE SERVER ACTUALLY SAID, instead of guessing. Three call sites used to collapse
  // every failure into "could not identify places" / "import failed", so a host stopped by
  // an HOURLY SPEND CAP was told their text could not be parsed — and invited to retry.
  // Each retry re-bumps the counter and holds them over the cap until the UTC hour rolls,
  // so the wrong message actively made the situation worse.
  //
  // PARSE DEFENSIVELY. api.post throws `new Error(rawResponseText)` and that text is NOT
  // guaranteed to be JSON — a network failure, an abort, or a Vercel 5xx HTML page all reach
  // here too. A throw inside an error handler would replace a bad message with a blank
  // screen, so everything is inside the try and anything unrecognised falls back verbatim.
  //
  // 429 and 503 are DIFFERENT and are told apart because the right action differs: the cap
  // needs waiting, a fail-closed counter error clears on its own. Neither promises a
  // duration — the counter resets on the UTC hour, so the real wait is anywhere from
  // seconds to an hour and any specific number would be a lie some of the time.
  function serverMessage(err: unknown, fallback: string): string {
    try {
      const code = JSON.parse((err as Error)?.message ?? '')?.error
      if (code === 'rate_limited') {
        return "You've hit this hour's limit for this tool. Nothing was saved — this resets on the hour."
      }
      if (code === 'busy') {
        return 'The service is busy right now. Nothing was saved — please try again in a moment.'
      }
    } catch {
      // not JSON — fall through to the caller's own wording
    }
    return fallback
  }

  // ── Tab 1 ──────────────────────────────────────────────────────────────────
  // Both address panels are transient: a new save supersedes them, and switching tabs means the
  // host has moved on. Cleared in one place so neither can outlive the state it describes.
  function clearAddressPanels() {
    setSwapBlocked(null)
    setMoveNotice(null)
  }

  async function saveBasic() {
    clearAddressPanels()
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
      if (error) {
        // The BEFORE UPDATE trigger `apartments_enforce_address_swap` raises this when a host who
        // is AT their property cap moves an address beyond the trigger's own threshold (the DB
        // half of MOVED_KM_THRESHOLD). The stored row is unchanged,
        // so this is an upgrade prompt rather than a failure: a panel, not a red toast, because
        // it needs two actions and a contact route that a toast cannot carry.
        if (error.message?.includes('property_address_swap_blocked')) {
          setSwapBlocked(parseSwapHint(error.hint))
          setFeedback(null)
          setSaving(false)
          return
        }
        showErr(error.message); setSaving(false); return
      }
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

    // Staleness notice. MUST run BEFORE the enrichment block below, which advances
    // savedCoordsRef. That ref is the only record of where this property used to be; once it
    // moves, the previous coordinates are gone and the distance can no longer be computed.
    // Deliberately does NOT regenerate anything — the host chooses, because an automatic
    // refresh here would spend a per-host cooldown they never asked to spend, on a property
    // they may still be mid-edit on.
    if (
      savedId &&
      typeof fields.lat === 'number' &&
      typeof fields.lng === 'number' &&
      typeof savedCoordsRef.current.lat === 'number' &&
      typeof savedCoordsRef.current.lng === 'number'
    ) {
      const movedKm = haversineKm(
        savedCoordsRef.current.lat,
        savedCoordsRef.current.lng,
        fields.lat,
        fields.lng,
      )
      setMoveNotice(movedKm > MOVED_KM_THRESHOLD ? { kmText: formatKm(movedKm) } : null)
    }

    // Silent enrichment: resolve the coordinates into a canonical city identity for the
    // (commit 2) city-level events cache. Fire-and-forget — never awaited, never toasts, never
    // fails the save, never blocks navigation. A failure just leaves the columns NULL, which
    // every commit-2 caller must already handle via its per-apartment fallback.
    //
    // ONLY when the coordinates actually CHANGED. Re-resolving on every save would spend a
    // LocationIQ request per keystroke-save for no new information, and the daily free tier is
    // the budget being protected. The client deliberately sends ONLY an apartment id — the key
    // itself is derived server-side, because it becomes a spend vector in commit 2.
    if (savedId && typeof fields.lat === 'number' && typeof fields.lng === 'number') {
      const prev = savedCoordsRef.current
      if (prev.lat !== fields.lat || prev.lng !== fields.lng) {
        // The ref advances BEFORE the request, so a transient failure (500, dropped network) is
        // NOT retried by re-saving the same address — deliberate, to keep this off the save's
        // critical path. RECOVERY PATH IS /api/backfill-canonical-city, which picks up any row
        // whose canonical_resolved_at is still NULL. The columns simply stay NULL until then,
        // which every commit-2 caller must already handle via its per-apartment fallback.
        savedCoordsRef.current = { lat: fields.lat, lng: fields.lng }
        void api.post('/resolve-canonical-city', { apartmentId: savedId }).catch(() => {})
      }
    }

    // The save succeeded, so this is now the stored state — a later blocked save must restore
    // THIS, not whatever was loaded when the page opened.
    savedBasicRef.current = { ...basic }

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
      // KNOWN, ACCEPTED: the server cooldown is per-HOST, so if this host refreshed any guide in
      // the last 6h this call returns 429 and the swallow below hides it — the new property gets
      // no guide and no greeting_blurb until they refresh manually from the Guide & events tab.
      // The swallow is deliberate (a failed background call must never block navigation).
      // Do NOT "fix" this with a per-apartment first-generation exemption: keying the gate to
      // anything that cascades from apartments is what made the previous attempt bypassable via
      // delete/recreate. A bound keyed on server-side apartments.created_at would be the safe shape.
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

  // Delete every apartment_details row the GUEST PAGE would render under `match`,
  // not just the ones stored under the canonical label. Select-then-delete-by-id so
  // the delete predicate is literally the same test as the read — a category-equality
  // delete could not remove a divergently-labelled row, which is how a saved section
  // ended up rendered twice on the guest page.
  // Returns an error message on failure; the caller MUST abort the save rather than
  // fall through to the insert, or it creates the duplicate this exists to prevent.
  // `match` takes the whole row, not just the category, so a caller can scope the delete
  // to exactly the rows it scoped its LOAD to — saveRules relies on that to leave private
  // rules-matching rows alone rather than delete content it never displayed.
  async function deleteMatchingDetails(
    aptId: string,
    match: (row: { category: string | null; is_private: boolean | null }) => boolean,
  ): Promise<string | null> {
    const { data, error } = await supabase
      .from('apartment_details')
      .select('id, category, is_private')
      .eq('apartment_id', aptId)
    if (error) return error.message

    const ids = (data ?? []).filter(d => match(d)).map(d => d.id)
    if (ids.length === 0) return null

    // apartment_id equality kept as defence in depth even though the ids came from
    // that apartment — RLS is the boundary, this is a second lock.
    const { error: delError } = await supabase
      .from('apartment_details')
      .delete()
      .in('id', ids)
      .eq('apartment_id', aptId)
    return delError ? delError.message : null
  }

  // ── Tab 2 ──────────────────────────────────────────────────────────────────
  async function saveWifi() {
    if (!apartmentId) { showErr('Save Basic info first'); return }
    setSaving(true)
    const delErr = await deleteMatchingDetails(apartmentId, d => isWifiCategory(d.category))
    if (delErr) { showErr(delErr); setSaving(false); return }
    const { error } = await supabase.from('apartment_details').insert({
      apartment_id: apartmentId,
      category: DETAIL_CATEGORY.WIFI,
      content: `Network: ${wifi.ssid}\nPassword: ${wifi.password}`,
      is_private: true,
    })
    if (error) showErr(error.message)
    else showOk()
    setSaving(false)
  }

  // ── Tab 3 ──────────────────────────────────────────────────────────────────
  async function saveCheckin() {
    if (!apartmentId) { showErr('Save Basic info first'); return }
    setSaving(true)
    const delErr = await deleteMatchingDetails(apartmentId, d => isCheckinCategory(d.category))
    if (delErr) { showErr(delErr); setSaving(false); return }
    const CI = DETAIL_CATEGORY.CHECKIN
    const rows = [
      checkin.checkInFrom       && { apartment_id: apartmentId, category: CI,            content: `Check-in from: ${checkin.checkInFrom}`,    is_private: true },
      checkin.checkOutBy        && { apartment_id: apartmentId, category: CI,            content: `Check-out by: ${checkin.checkOutBy}`,       is_private: true },
      checkin.doorCode          && { apartment_id: apartmentId, category: CI,            content: `Door code: ${checkin.doorCode}`,            is_private: true },
      checkin.entryInstructions && { apartment_id: apartmentId, category: CI,            content: checkin.entryInstructions,                   is_private: true },
    ].filter(Boolean) as { apartment_id: string; category: string; content: string; is_private: boolean }[]

    if (rows.length > 0) {
      const { error } = await supabase.from('apartment_details').insert(rows)
      if (error) { showErr(error.message); setSaving(false); return }
    }
    showOk()
    setSaving(false)
  }

  // ── Tab 4 ──────────────────────────────────────────────────────────────────
  // `overrideText` exists ONLY so the listing importer can drive this exact flow with text the
  // host has just approved, without waiting a render for setRawRules to land. Behaviour with no
  // argument is unchanged. The `typeof` guard is load-bearing: this function is also a click
  // handler, and React would otherwise hand it a MouseEvent as the first argument.
  async function saveRules(overrideText?: string): Promise<boolean> {
    if (!apartmentId) { showErr('Save Basic info first'); return false }
    const sourceRules = typeof overrideText === 'string' ? overrideText : rawRules
    if (!sourceRules.trim()) return false
    setSaving(true)

    // Polish via Gemini on save. On any failure, fall back to the raw text so
    // the host never loses their input.
    let finalRules = sourceRules
    try {
      const data = await api.post<{ result: string }>('/rewrite-rules', { rawRules: sourceRules })
      if (data?.result && data.result.trim()) finalRules = data.result
    } catch {
      finalRules = sourceRules
    }

    // Same predicate as the load above — see the privacy note there.
    const delErr = await deleteMatchingDetails(apartmentId, d => isRulesCategory(d.category) && !d.is_private)
    if (delErr) { showErr(delErr); setSaving(false); return false }
    const { error } = await supabase.from('apartment_details').insert({
      apartment_id: apartmentId,
      category: DETAIL_CATEGORY.RULES,
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
    return !error
  }

  // ── Stored source document (the guest chat's knowledge) ────────────────────────────────
  //
  // THE CONSENT COUNTERPART of the import-review tick. Recorded as a gap at aea7a84: a host could
  // switch the document on during an import but could only switch it off by RE-IMPORTING — which
  // meant re-supplying the very document they were trying to revoke. A host who had deleted the
  // file could not reach the control at all.
  //
  // DELIBERATELY INDEPENDENT of the import card's dismissal and 3-tab auto-hide. That card is an
  // empty-property shortcut and is meant to disappear; this is a live setting on stored data, and
  // a host with a document must always be able to see and remove it.
  const [sourceDoc, setSourceDoc] = useState<{ chat_enabled: boolean; imported_at: string } | null>(null)
  const [sourceDocBusy, setSourceDocBusy] = useState(false)
  const [confirmRemoveDoc, setConfirmRemoveDoc] = useState(false)

  const loadSourceDoc = useCallback(async (signal?: { cancelled: boolean }) => {
    if (!apartmentId) { setSourceDoc(null); return }
    // Host's own client: apartment_source_docs is RLS'd to `apartment_id IN (host's apartments)`
    // and anon holds no grants, so this needs no serverless hop.
    const { data } = await supabase
      .from('apartment_source_docs')
      .select('chat_enabled, imported_at')
      .eq('apartment_id', apartmentId)
      .maybeSingle()
    if (signal?.cancelled) return
    setSourceDoc(data ?? null)
  }, [apartmentId])

  // The guard matters here for the same reason it does on the main load: on a fast apartment
  // switch A's response can land after B's and paint A's date beside B's controls.
  //
  // AND THE CONFIRM IS DISARMED ON EVERY APARTMENT CHANGE. This component is reused across
  // :aptId (apartmentId is state set inside the load effect, not a remount), so without this an
  // open confirm on property A renders ALREADY ARMED over property B's document — one click from
  // deleting the wrong property's document. State that guards a destructive act must not outlive
  // the thing it guarded.
  useEffect(() => {
    const signal = { cancelled: false }
    setConfirmRemoveDoc(false)
    void loadSourceDoc(signal)
    return () => { signal.cancelled = true }
  }, [loadSourceDoc])

  async function toggleSourceDocChat() {
    if (!apartmentId || !sourceDoc || sourceDocBusy) return
    const next = !sourceDoc.chat_enabled
    setSourceDocBusy(true)
    // Optimistic: the switch is the feedback. Reverted below if the write fails, so the UI can
    // never claim a state the database refused.
    setSourceDoc({ ...sourceDoc, chat_enabled: next })
    // .select() because PostgREST returns NO ERROR when zero rows match, so an RLS-denied or
    // already-deleted row is otherwise indistinguishable from success. This is the CONSENT
    // control and its protective state is "off": a switch that renders off while the row still
    // says on is a false assurance, which is worse here than anywhere else in this file.
    // applyImport's delete already works this way; this is the site that did not.
    const { data, error } = await supabase
      .from('apartment_source_docs')
      .update({ chat_enabled: next })
      .eq('apartment_id', apartmentId)
      .select('chat_enabled')
      .maybeSingle()
    if (error || !data) {
      setSourceDoc({ ...sourceDoc, chat_enabled: !next })
      showErr(error?.message ?? 'Could not update — nothing was changed')
    }
    setSourceDocBusy(false)
  }

  async function removeSourceDoc() {
    if (!apartmentId || sourceDocBusy) return
    setSourceDocBusy(true)
    // Same reason as the toggle: zero rows deleted is not success.
    const { data, error } = await supabase
      .from('apartment_source_docs')
      .delete()
      .eq('apartment_id', apartmentId)
      .select('apartment_id')
    if (error || (data?.length ?? 0) === 0) {
      showErr(error?.message ?? 'Could not remove — nothing was changed')
    } else {
      setSourceDoc(null)
      setConfirmRemoveDoc(false)
      showOk()
    }
    setSourceDocBusy(false)
  }

  // ── LISTING IMPORTER — apply ───────────────────────────────────────────────
  //
  // The importer PROPOSES; this function is the only place its proposal becomes a write, and it
  // writes through the SAME paths the tabs use — deleteMatchingDetails with the shared matchers
  // for WiFi and Check-in, the canonical DETAIL_CATEGORY labels, saveRules for the rules flow,
  // and /generate-host-picks for picks. No second write path exists for imported content, so
  // nothing can drift from what a manual save does. TWO EXCEPTIONS, both direct table writes with
  // no tab equivalent: extras uses a category-scoped .in() delete (see that section) because it
  // must touch ONLY the accepted categories, and chat knowledge writes apartment_source_docs,
  // which no tab edits at all.
  //
  // ORDER IS LOAD-BEARING: basics first, because a blocked address swap must abort the rest and
  // hand the host the policy panel. Sections after that are INDEPENDENT and are never rolled
  // back on a later failure — each is idempotent to re-apply, so a partial success is strictly
  // better than undoing writes that worked.
  async function applyImport(accepted: AcceptedImport): Promise<ApplySectionResult[]> {
    const out: ApplySectionResult[] = []
    if (!apartmentId || !hostId) {
      return [{ section: 'Import', ok: false, message: 'Save your basic info first' }]
    }

    // 1. Basics — one UPDATE carrying only the accepted keys.
    const basics = accepted.basics
    const fields: Record<string, string | number> = {}
    if (basics.street !== undefined) fields.street = basics.street
    if (basics.street_number !== undefined) fields.street_number = basics.street_number
    if (basics.floor_note !== undefined) fields.floor_note = basics.floor_note
    if (basics.city !== undefined) fields.city = basics.city
    if (basics.neighborhood !== undefined) fields.neighborhood = basics.neighborhood
    if (basics.country !== undefined) fields.country = basics.country
    if (basics.description !== undefined) fields.description = basics.description
    if (typeof basics.max_guests === 'number') fields.max_guests = basics.max_guests

    if (Object.keys(fields).length > 0) {
      const { error } = await supabase.from('apartments').update(fields).eq('id', apartmentId).eq('host_id', hostId)
      if (error) {
        // THE SAME handler saveBasic uses. The address-swap trigger refuses the whole row write,
        // so this is an upgrade prompt with a panel, not a red toast. Reusing the exact path is
        // what stops the importer presenting a policy block differently from the Basics tab.
        if (error.message?.includes('property_address_swap_blocked')) {
          setSwapBlocked(parseSwapHint(error.hint))
          return [{ section: 'Basics', ok: false, message: 'That address change needs a bigger plan — see the panel above. Nothing else was applied.' }]
        }
        return [{ section: 'Basics', ok: false, message: error.message }]
      }
      if (basics.description !== undefined) setAptDescription(basics.description)
      // Computed OUTSIDE the updater. A state updater must be pure — React 19 StrictMode
      // double-invokes it in dev — and while assigning the ref in there was idempotent, it is not
      // a pattern to leave for the next editor to copy into a case where it is not.
      const nextBasic = {
        ...basic,
        street: basics.street ?? basic.street,
        streetNumber: basics.street_number ?? basic.streetNumber,
        floorNote: basics.floor_note ?? basic.floorNote,
        city: basics.city ?? basic.city,
        neighborhood: basics.neighborhood ?? basic.neighborhood,
        country: basics.country ?? basic.country,
        maxGuests: basics.max_guests ?? basic.maxGuests,
      }
      setBasic(nextBasic)
      // "The last Basics values known to be STORED" — this write just changed them. Without this,
      // a later BLOCKED address save would restore the PRE-IMPORT values into the form, which is
      // exactly the mismatch this ref exists to prevent.
      savedBasicRef.current = nextBasic
      out.push({ section: 'Basics', ok: true })
    }

    // 2. WiFi — saveWifi's exact shape and format.
    // FALLS BACK TO THE STORED VALUE for a half the document did not contain. A field that was
    // never proposed produces NO review row, so the host was never shown it and never chose to
    // clear it — writing '' there would destroy a saved password they did not know was at risk.
    // (An explicitly UNTICKED field is different: that one had a row, and it keeps its old value
    // for the same reason.)
    if (accepted.wifi) {
      const ssid = accepted.wifi.ssid ?? wifi.ssid
      const password = accepted.wifi.password ?? wifi.password
      const delErr = await deleteMatchingDetails(apartmentId, d => isWifiCategory(d.category))
      if (delErr) {
        out.push({ section: 'WiFi', ok: false, message: delErr })
      } else {
        const { error } = await supabase.from('apartment_details').insert({
          apartment_id: apartmentId,
          category: DETAIL_CATEGORY.WIFI,
          content: `Network: ${ssid}\nPassword: ${password}`,
          is_private: true,
        })
        if (error) out.push({ section: 'WiFi', ok: false, message: error.message })
        else { setWifi({ ssid, password }); out.push({ section: 'WiFi', ok: true }) }
      }
    }

    // 3. Check-in — saveCheckin's four-row content-prefix shape, is_private: true.
    if (accepted.checkin) {
      // Same preservation rule as WiFi above — an absent field keeps what is already stored.
      const ci = {
        check_in_from: accepted.checkin.check_in_from ?? checkin.checkInFrom,
        check_out_by: accepted.checkin.check_out_by ?? checkin.checkOutBy,
        door_code: accepted.checkin.door_code ?? checkin.doorCode,
        entry_instructions: accepted.checkin.entry_instructions ?? checkin.entryInstructions,
      }
      const delErr = await deleteMatchingDetails(apartmentId, d => isCheckinCategory(d.category))
      if (delErr) {
        out.push({ section: 'Check-in', ok: false, message: delErr })
      } else {
        const rows = [
          ci.check_in_from && { apartment_id: apartmentId, category: DETAIL_CATEGORY.CHECKIN, content: 'Check-in from: ' + ci.check_in_from, is_private: true },
          ci.check_out_by && { apartment_id: apartmentId, category: DETAIL_CATEGORY.CHECKIN, content: 'Check-out by: ' + ci.check_out_by, is_private: true },
          ci.door_code && { apartment_id: apartmentId, category: DETAIL_CATEGORY.CHECKIN, content: 'Door code: ' + ci.door_code, is_private: true },
          ci.entry_instructions && { apartment_id: apartmentId, category: DETAIL_CATEGORY.CHECKIN, content: ci.entry_instructions, is_private: true },
        ].filter(Boolean) as { apartment_id: string; category: string; content: string; is_private: boolean }[]
        const { error } = rows.length > 0
          ? await supabase.from('apartment_details').insert(rows)
          : { error: null }
        if (error) out.push({ section: 'Check-in', ok: false, message: error.message })
        else {
          setCheckin({
            checkInFrom: ci.check_in_from,
            checkOutBy: ci.check_out_by,
            doorCode: ci.door_code,
            entryInstructions: ci.entry_instructions,
          })
          out.push({ section: 'Check-in', ok: true })
        }
      }
    }

    // 4. House rules — through saveRules, NOT straight to the DB, so the tone rewrite and its
    // fall-back-to-raw-text apply exactly as they do on the tab. The review row warns the host
    // that the wording will change.
    if (accepted.rules) {
      const ok = await saveRules(accepted.rules)
      out.push({ section: 'House rules', ok, message: ok ? undefined : 'Could not save' })
    }

    // 5. Extras — delete ONLY the accepted categories. Deliberately narrower than bulk-import's
    // delete-every-extras-category, so a category the host did not import is left untouched.
    if (accepted.extras.length > 0) {
      const cats = [...new Set(accepted.extras.map(e => e.category))]
      const { error: delError } = await supabase
        .from('apartment_details')
        .delete()
        .eq('apartment_id', apartmentId)
        .in('category', cats)
        // is_private:false, MATCHING the precedent saveRules sets above: the rows re-inserted
        // below are public, so a private row a host stored under an accepted category must not be
        // destroyed by an import that cannot replace it.
        .eq('is_private', false)
      if (delError) {
        out.push({ section: 'Extras', ok: false, message: delError.message })
      } else {
        const { error } = await supabase.from('apartment_details').insert(
          accepted.extras.map(e => ({
            apartment_id: apartmentId,
            category: e.category,
            content: e.content,
            is_private: false,
          })),
        )
        if (error) out.push({ section: 'Extras', ok: false, message: error.message })
        else { await loadExtras(); out.push({ section: 'Extras', ok: true }) }
      }
    }

    // 6. Chat knowledge — the host's ORIGINAL document, so the guest chat can answer the
    // specifics the structured tabs compress away. Written with the host's OWN authenticated
    // client: apartment_source_docs is RLS'd to `apartment_id IN (host's apartments)` and anon
    // holds zero grants, so this needs no serverless hop — the host is writing their own row.
    //
    // UNTICKED MUST DELETE, NOT SKIP. A re-import with the box off has to remove an existing
    // document, or a stale snapshot keeps answering questions the host thought they had revoked.
    if (accepted.sourceDoc !== null) {
      // Sliced to the DB CHECK (length <= 20000). Unreachable TODAY, for a measured reason:
      // the caller applies truncateForImport, whose token budget bounds any stored document at
      // 9,900 chars of ASCII (3,300 tokens x 3 chars/token) and fewer in any other script. The
      // slice exists so a future rise in that budget cannot turn this write into a constraint
      // violation — the two limits answer to different owners.
      const content = accepted.sourceDoc.slice(0, SOURCE_DOC_MAX_CHARS)
      const { error } = await supabase
        .from('apartment_source_docs')
        // imported_at is set explicitly: the column defaults on INSERT only, so without this a
        // re-import would keep the ORIGINAL timestamp and any future "stored on <date>" UI would
        // describe the wrong document.
        .upsert(
          { apartment_id: apartmentId, content, chat_enabled: true, imported_at: new Date().toISOString() },
          { onConflict: 'apartment_id' },
        )
      if (error) out.push({ section: 'Chat knowledge', ok: false, message: error.message })
      else {
        // Refresh so the revocation row appears immediately — otherwise a host who has just
        // stored a document cannot see or remove it until the next load.
        await loadSourceDoc()
        out.push({ section: 'Chat knowledge', ok: true, message: 'saved' })
      }
    } else {
      // .select() so the result distinguishes "removed one" from "there was none" — reporting
      // "removed" to a host who never stored a document is a claim the code cannot support.
      const { data: deleted, error } = await supabase
        .from('apartment_source_docs')
        .delete()
        .eq('apartment_id', apartmentId)
        .select('apartment_id')
      if (error) out.push({ section: 'Chat knowledge', ok: false, message: error.message })
      else {
        await loadSourceDoc()
        out.push({
          section: 'Chat knowledge',
          ok: true,
          message: (deleted?.length ?? 0) > 0 ? 'removed' : 'none stored',
        })
      }
    }

    // 7. Picks LAST — hands the text to the EXISTING /generate-host-picks and drops the host into
    // the EXISTING candidates review. Zero new picks code, and the host still confirms every
    // place before anything is written to host_picks.
    if (accepted.picksText) {
      const picksText = accepted.picksText
      try {
        const data = await api.post<{
          picks: Array<{ name: string; category: string; address: string; lat: number | null; lng: number | null; located: boolean }>
        }>('/generate-host-picks', { apartmentId, text: picksText })
        if (data.picks?.length) {
          setCandidates(data.picks.map(pk => ({ ...pk, key: crypto.randomUUID(), note: '' })))
          setPasteText(picksText)
          setTab('picks')
          out.push({ section: 'My picks', ok: true, message: data.picks.length + ' to confirm in the My picks tab' })
        } else {
          out.push({ section: 'My picks', ok: false, message: "Couldn't identify any places — add them manually in My picks" })
        }
      } catch (err) {
        out.push({
          section: 'My picks',
          ok: false,
          message: serverMessage(err, 'Could not identify places'),
        })
      }
    }

    return out
  }

  // ── Tab 5 ──────────────────────────────────────────────────────────────────
  async function bulkImport() {
    if (!extrasContent.trim()) return
    if (!apartmentId) { showErr('Save Basic info first'); return }
    setImporting(true)
    setImportResult('')
    try {
      const data = await api.post<{ categories: string[]; redacted?: number }>('/bulk-import', { apartmentId, content: extrasContent })
      const removed = data.redacted ?? 0

      // THE ALL-SCRUBBED PASTE. The scrub emptied every row, so nothing was written and the
      // host's existing extras are untouched. Before this, `categories` was [] and the join
      // produced '' — the success box rendered nothing, the paste box was cleared anyway, and
      // the host concluded it worked while their text existed nowhere. Two things matter here
      // and they are different messages: N sentences were REMOVED, and NOTHING WAS SAVED.
      if (data.categories.length === 0 && removed > 0) {
        showErr(
          `Nothing was saved. We removed ${removed} sentence${removed === 1 ? '' : 's'} that looked like ` +
          `${removed === 1 ? 'it contained' : 'they contained'} an access code — codes belong only in WiFi ` +
          'and Check-in. Your text is still in the box: edit it and try again.',
        )
        return
      }

      // NOTHING SAVED, NO SCRUB RAN (PG-23). The model returned no usable categories and
      // no sentence was removed, so `removed` is 0 and the all-scrubbed branch above does
      // not fire. Without this branch the code falls through to setImportResult('') and
      // setExtrasContent('') clears the box, so the host loses their text and concludes it
      // worked — the same silent-loss outcome PG-14 closed, one branch over. Keep the box.
      if (data.categories.length === 0 && removed === 0) {
        showErr(
          "Nothing was saved — we couldn't sort that text into categories. " +
          'Your text is still in the box: check it and try again.',
        )
        return
      }

      setImportResult(data.categories.join(' · '))

      // PARTIAL scrub (PG-24): rows were saved AND a sentence was dropped. KEEP THE BOX —
      // a host told a code was removed still needs their original text to copy that code
      // into Check-in, where the scrub says it belongs. Clearing it stranded exactly the
      // text they were sent to re-file.
      if (removed > 0) {
        toast(
          `Saved. We left ${removed} sentence${removed === 1 ? '' : 's'} out — ` +
          `${removed === 1 ? 'it looked like it contained' : 'they looked like they contained'} an access code. ` +
          'Copy any code into Check-in, then clear this box.',
          'info',
        )
        await loadExtras()
        return
      }

      // FULLY CLEAN WRITE — categories saved, nothing removed. Only now is it safe to clear
      // the box: this is the one outcome where nothing the host typed is discarded unseen.
      setExtrasContent('')
      await loadExtras()
    } catch (err) {
      showErr(serverMessage(err, 'Import failed — please try again'))
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
    } catch (err) {
      showErr(serverMessage(err, 'Could not identify places'))
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
        // The server consumes its 6h cooldown claim before generating, so a failed run has
        // already spent the window — an immediate retry would return 429, not a new guide.
        setGuideMsg('No places were generated this time — you can try again in a few hours.')
      } else if (code === 'cooldown') {
        // Server-side 6h floor in api/generate-guide.ts, separate from GUIDE_FRESH_HOURS.
        // It is per-HOST, so refreshing any one property's guide gates the others too.
        setGuideMsg('Guide was refreshed recently — try again in a few hours.')
      } else {
        // Deliberately "later", not "try again": a 500 means the server already consumed the 6h
        // claim, so an immediate retry returns 429. This branch also catches network errors
        // (where no claim was spent), so the wording has to be true for both.
        setGuideMsg('Could not refresh the guide. Please try again later.')
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
      // 'fresh_city' is the same "already current" outcome, but the events are now cached per
      // CITY, so another property in this city may have warmed them — a host can click Refresh
      // for the first time and still get this. It is NOT a refusal, so the copy states that the
      // list IS current rather than that the refresh was declined (same class as 'no_events').
      else if (data.reason === 'fresh_city') toast('Events for this city are already up to date', 'info')
      // 'no_events' is a DELIBERATE keep-stale, not a failure: the extraction came back empty and
      // the server chose to preserve the existing list rather than erase it. It used to fall
      // through to the red error below, which invited a retry that costs another
      // city-events-host unit (only 3/hour) and 3 more Tavily credits from a fleet-wide monthly
      // pool — for the identical outcome. The catch-all below still covers 'generation_failed'
      // and 'busy', which ARE genuine failures.
      else if (data.reason === 'no_events') toast('No new events found — keeping the current list', 'info')
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
        className="inline-flex items-center gap-1 text-[12px] text-[#6b6354] hover:text-[#231d17] transition-colors mb-3"
      >
        ← Back to properties
      </Link>
      {/* "Property setup" stays the page title; the NAME is the subject, so it leads and
          the title drops to an eyebrow above it. A host with several properties needs to
          know which one is open before they read anything else.

          The name tracks the Basics field on every keystroke, and that is DELIBERATE — it
          is live feedback on a rename, and the alternative (snapshotting the loaded name)
          would leave the header contradicting the field the host is typing in until they
          save. No second state variable, so no way for the two to diverge.

          `truncate` keeps a long name on ONE line, so it cannot wrap and push the tab bar
          down. Its width bound comes from the page wrapper's `max-w-3xl`; no `min-w-0` is
          needed because this is a flex-free block, where that class would do nothing. */}
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-[.08em] text-[#a79e8e]">Property setup</div>
        <h1 className="mt-0.5 text-[22px] font-['Fraunces'] font-light text-[#231d17] truncate">
          {basic.name.trim() || (apartmentId === null ? 'New property' : 'Untitled property')}
        </h1>
      </div>

      {/* Stored source document. Rendered whenever one EXISTS, regardless of the import card's
          dismissal or the 3-tab auto-hide — see the note on loadSourceDoc. A compact row, not a
          card: it is a setting on existing data, not an offer. */}
      {apartmentId && sourceDoc && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border border-[#e4ddd0] bg-[#f8f6f2] px-3.5 py-2.5 text-[12px] text-[#6b6459]">
          <span className="text-[#231d17]">
            Imported document ({fmtImportedAt(sourceDoc.imported_at)})
          </span>
          <span className="text-[#c9c2b4]">·</span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={sourceDoc.chat_enabled}
              onChange={() => void toggleSourceDocChat()}
              disabled={sourceDocBusy}
              className="accent-[#c8a24e]"
            />
            <span>chat answers from it</span>
          </label>
          <span className="text-[#c9c2b4]">·</span>
          <button
            onClick={() => setConfirmRemoveDoc(true)}
            disabled={sourceDocBusy}
            className="text-[#8a1a1a] hover:underline disabled:opacity-40"
          >
            Remove document
          </button>
          {confirmRemoveDoc && (
            <div className="w-full mt-1.5 rounded-[8px] border border-[#eddcc0] bg-[#faeeda] px-3 py-2 text-[11px] text-[#7a4800]">
              {/* SAYS ONLY WHAT DELETING DOES. It removes the stored document, so the chat stops
                  answering from it and the tabs keep everything already applied. It does NOT
                  un-send what was already sent to the AI provider on past turns, and no copy
                  anywhere may imply otherwise. */}
              The guest chat will no longer answer from your document. Your tabs keep everything
              already applied. Text already sent to the AI in past chats can't be taken back.
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => void removeSourceDoc()}
                  disabled={sourceDocBusy}
                  className="rounded-[8px] bg-[#8a1a1a] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                >
                  {sourceDocBusy ? 'Removing…' : 'Remove it'}
                </button>
                <button
                  onClick={() => setConfirmRemoveDoc(false)}
                  disabled={sourceDocBusy}
                  className="rounded-[8px] border border-[#e4ddd0] bg-white px-3 py-1.5 text-[11px] disabled:opacity-40"
                >
                  Keep it
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Listing importer — EXISTING properties only. A brand-new property has no id yet, so
          there is nothing to import into and no per-property dismissal key to write. */}
      {apartmentId && (
        <ImportListing
          key={apartmentId}
          apartmentId={apartmentId}
          propertyName={basic.name.trim() || 'this property'}
          filledTabCount={filledTabCount}
          current={{
            basic: {
              street: basic.street, streetNumber: basic.streetNumber, floorNote: basic.floorNote,
              maxGuests: basic.maxGuests, city: basic.city, neighborhood: basic.neighborhood,
              country: basic.country,
              description: aptDescription,
            },
            wifi,
            checkin,
            rawRules,
            extrasRows,
            picksCount: picks.length,
          }}
          onLoadExtras={loadExtras}
          onLoadPicks={loadPicks}
          onApply={applyImport}
        />
      )}

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
                clearAddressPanels()
              }}
              className={`px-3.5 py-1.5 rounded-[9px] text-xs font-medium transition-colors border ${
                tab === t.key
                  ? 'bg-[#1c1c1a] text-[#f0ede6] border-[#1c1c1a]'
                  : 'bg-transparent border-[#e4ddd0] text-[#6b6354] hover:bg-[#f0ede6]'
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
      {/* Address swap REFUSED by the DB trigger. Deliberately an upgrade prompt, not an error:
          nothing the host did was invalid, they simply have no room for another property. No
          tier NAME or PRICE appears here — neither is loaded on this page, so any figure would
          be a hardcoded number free to go stale. The cap comes from the trigger's hint or is
          omitted entirely. */}
      {/* ITEM 2 — THE TOAST AND THIS PANEL ARE ONE STATE (`swapBlocked`), which is what makes
          "both dismiss together" true by construction rather than by two handlers agreeing. The
          toast is the acknowledgement that Save was pressed and refused; the panel is the answer,
          and it can sit below the fold on a long form, which is the gap the toast closes.
          PolicyBlockToast is deliberately generic — it takes a message and a panel id and knows
          nothing about addresses, so a tier cap can reuse it unchanged. */}
      <PolicyBlockToast
        open={!!swapBlocked}
        message="We couldn't save that address change."
        panelId="policy-block-panel"
        onDismiss={() => {
          // Same restore as the panel's own dismiss: the trigger rejected the WHOLE row write, so
          // leaving the edited fields on screen would show values that were never stored.
          if (savedBasicRef.current) setBasic(savedBasicRef.current)
          setSwapBlocked(null)
        }}
      />
      {/* NO role="alert" on the panel below: PolicyBlockToast above already announces
          assertively on the same state flip, and two live regions firing together make a screen
          reader read the refusal twice. The toast is the announcement; the panel is where it
          sends you. */}
      {swapBlocked && (
        <div id="policy-block-panel" tabIndex={-1} className="mb-3 rounded-[12px] border border-[#e8d5a8] bg-[#faf3e2] px-4 py-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]">
          <h2 className="text-[14px] font-['Fraunces'] font-normal text-[#231d17]">
            That looks like a different property
          </h2>
          <p className="mt-1 text-[12.5px] leading-[1.55] text-[#6b6354]">
            {swapBlocked.kmText
              ? `The address you entered is ${swapBlocked.kmText} km from the one saved here, so we've kept the original.`
              : "The address you entered is a long way from the one saved here, so we've kept the original."}{' '}
            {swapBlocked.capText
              ? `Your plan covers ${swapBlocked.capText} properties and you're using all of them.`
              : "You're using every property your plan covers."}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              to="/dashboard/billing"
              className="inline-flex items-center rounded-[9px] bg-[#c8a24e] px-3.5 py-2 text-[12.5px] font-semibold text-[#16100d] transition-colors hover:bg-[#e7d6ad]"
            >
              View plans
            </Link>
            <button
              type="button"
              onClick={() => {
                // The trigger rejected the WHOLE row write, so restoring only the address would
                // leave the other Basics fields showing values that were never saved. Restores
                // the last known-stored snapshot; falls back to dismissing if there is none.
                if (savedBasicRef.current) setBasic(savedBasicRef.current)
                setSwapBlocked(null)
              }}
              className="rounded-[9px] border border-[#e8d5a8] px-3.5 py-2 text-[12.5px] text-[#6b6354] transition-colors hover:bg-white"
            >
              Keep the current address
            </button>
          </div>
          <p className="mt-2.5 text-[11.5px] text-[#6b6354]">
            Moved this property for good?{' '}
            <a
              href="mailto:hello@bemgu.app?subject=Moved%20property%20address"
              className="underline underline-offset-2 hover:text-[#231d17]"
            >
              Get in touch
            </a>{' '}
            and we'll sort it.
          </p>
        </div>
      )}

      {/* Save SUCCEEDED and the pin moved far enough that the generated content now describes
          somewhere else. A persistent card rather than a toast, because it has to survive long
          enough to act on. Nothing is regenerated here — both buttons just switch tabs. */}
      {moveNotice && (
        <div role="status" className="mb-3 rounded-[12px] border border-[#d4dcc0] bg-[#eaf0dd] px-4 py-3.5">
          <h2 className="text-[14px] font-['Fraunces'] font-normal text-[#231d17]">
            This property moved {moveNotice.kmText} km
          </h2>
          <p className="mt-1 text-[12.5px] leading-[1.55] text-[#6b6354]">
            Weather, directions and the cover photo already follow the new address. The city guide
            and your saved picks still describe the old one.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { setTab('guide'); clearAddressPanels() }}
              className="rounded-[9px] bg-[#c8a24e] px-3.5 py-2 text-[12.5px] font-semibold text-[#16100d] transition-colors hover:bg-[#e7d6ad]"
            >
              Update the guide
            </button>
            <button
              type="button"
              onClick={() => { setTab('picks'); clearAddressPanels() }}
              className="rounded-[9px] border border-[#d4dcc0] px-3.5 py-2 text-[12.5px] text-[#4a6128] transition-colors hover:bg-white"
            >
              Review my picks
            </button>
          </div>
        </div>
      )}

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
                <p className="text-[10.5px] text-[#6b6354] max-w-[200px] leading-snug">PNG, JPG or WebP · under 5 MB · shown as the banner at the top of your guest page. Leave empty and we'll use a photo of your city.</p>
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
          <p className="text-[11px] text-[#6b6354]">Only shown to guests with a verified booking token.</p>
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
          <p className="text-[11px] text-[#6b6354]">
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
          <button onClick={() => void saveRules()} disabled={saving || !rawRules.trim()} className={BTN_SAVE}>
            {saving ? 'Polishing & saving…' : 'Save rules'}
          </button>
        </div>
      )}

      {/* ── Tab 5: Extras ─────────────────────────────────────────────────── */}
      {tab === 'extras' && (
        <div className="space-y-3.5">
          <div className={`${CARD} space-y-3.5`}>
            <h2 className={HEADING}>Extras</h2>
            <p className="text-[11px] text-[#6b6354]">
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
          <p className="text-[11px] text-[#6b6354]">
            Add your favourite local places. They appear in the Explore tab on the guest page with a Navigate button.
          </p>

          {/* AI enrichment card */}
          <div className={`${CARD} space-y-3.5`}>
            <h2 className={HEADING}>✦ Add places with AI</h2>
            <p className="text-[11px] text-[#6b6354] leading-relaxed">
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
                    {pick.address && <div className="text-[11px] text-[#6b6354]">{pick.address}</div>}
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
                <p className="text-[11px] text-[#6b6354] mt-0.5">Refreshes automatically every month.</p>
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
                <p className="text-[11px] text-[#6b6354] mt-0.5">Refreshes automatically while guests are staying.</p>
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
            <p className="text-[11px] text-[#6b6354]">
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
              <p className={`text-[11px] ${syncMsg === SYNC_ERR ? 'text-[#8a1a1a]' : 'text-[#6b6354]'}`}>
                {syncMsg}
              </p>
            )}
          </div>

          {/* Guest names from Airbnb */}
          <div className={`${CARD} space-y-3.5`}>
            <h2 className={HEADING}>Guest names from Airbnb</h2>
            <p className="text-[11px] text-[#6b6354]">
              Airbnb calendars don't include guest names. Download your reservations CSV from Airbnb and upload it here — we'll add each guest's first name to the matching booking. Names then stay put through every future sync.
            </p>
            <div>
              <label className={`${(csvImporting || !apartmentId) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-[#f0ede6]'} bg-transparent border border-[#e4ddd0] text-[#231d17] px-3.5 py-2 rounded-[9px] text-xs font-medium transition-colors inline-block`}>
                {csvImporting ? 'Importing…' : 'Upload Airbnb CSV'}
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvFile} disabled={csvImporting || !apartmentId} />
              </label>
            </div>
            {csvMsg && (
              <p className={`text-[11px] ${csvMsg === CSV_ERR ? 'text-[#8a1a1a]' : 'text-[#6b6354]'}`}>
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
                          <div className="text-[11px] text-[#6b6354] font-mono">{brandDefaultColor}</div>
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
                        <p className="text-[11px] text-[#6b6354] -mt-1">
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

                  <p className="text-[10.5px] text-[#6b6354] pt-1 border-t border-[#f0ede6]">
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
