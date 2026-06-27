import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useToast } from '../shared/Toast'
import { api } from '../../lib/api'
import Loader from '../shared/Loader'
import { ARRIVLY_CONFIG } from '../../config'

interface Booking {
  id: string
  check_in: string
  check_out: string
  status: string
  reference_number: string | null
  source: string | null
  guests: { first_name: string; last_name: string } | null
}

interface AddForm {
  firstName: string
  checkIn: string
  checkOut: string
}

type View = 'list' | 'cal'
type Filter = 'all' | 'guests' | 'blocks'

// ── Phase H chrome tokens (copied from PropertySetup.tsx) ────────────────────
const INPUT = 'w-full bg-white border border-[#e0dacd] rounded-[10px] px-3.5 py-2.5 text-[13px] text-[#1c1c1a] placeholder:text-[#b3ab9b] focus:outline-none focus:border-[#c8a24e] focus:ring-2 focus:ring-[#c8a24e]/20 transition-colors'
const LABEL = 'block text-[10px] font-medium uppercase tracking-[.12em] text-[#a79e8e] mb-1.5'
const CARD = 'bg-[#fffdf9] border border-[#e4ddd0] rounded-[14px] p-5'
const HEADING = "text-[16px] font-['Fraunces'] font-light text-[#231d17]"
const BTN_SAVE = 'bg-[#c8a24e] text-[#16100d] px-5 py-2.5 rounded-[10px] text-xs font-semibold hover:bg-[#e7d6ad] transition-colors disabled:opacity-40 disabled:hover:bg-[#c8a24e]'
const BTN_OUTLINE = 'bg-transparent border border-[#e4ddd0] text-[#231d17] px-4 py-2 rounded-[10px] text-xs font-medium hover:bg-[#f0ede6] transition-colors disabled:opacity-40'

const PILL_BASE = 'px-3.5 py-1.5 rounded-[9px] text-xs font-medium transition-colors border'
function pill(active: boolean) {
  return `${PILL_BASE} ${active ? 'bg-[#1c1c1a] text-[#f0ede6] border-[#1c1c1a]' : 'bg-transparent border-[#e4ddd0] text-[#8a8276] hover:bg-[#f0ede6]'}`
}

const BLOCK_GREY = '#b8b0a2'

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function isBlockSource(source: string | null): boolean {
  return source?.includes('block') ?? false
}

function sourceColor(source: string | null): string {
  if (!source) return '#c97c14'
  const s = source.toLowerCase()
  if (s.includes('airbnb')) return '#3b6d11'
  if (s.includes('vrbo')) return '#185fa5'
  if (s.includes('booking')) return '#003580'
  if (s.includes('tripadvisor')) return '#00aa6c'
  if (s.includes('guesty') || s.includes('hostaway') || s.includes('lodgify')) return '#7c3aed'
  return '#c97c14'
}

function sourceLabel(source: string | null): string {
  if (!source) return 'Manual'
  const s = source.toLowerCase()
  if (s === 'manual') return 'Manual'
  if (s.includes('airbnb') && s.includes('block')) return 'Airbnb block'
  if (s.includes('airbnb')) return 'Airbnb'
  if (s.includes('vrbo') && s.includes('block')) return 'VRBO block'
  if (s.includes('vrbo')) return 'VRBO'
  if (s.includes('booking') && s.includes('block')) return 'Booking block'
  if (s.includes('booking')) return 'Booking.com'
  if (s.includes('tripadvisor')) return 'TripAdvisor'
  if (s.includes('guesty')) return 'Guesty'
  if (s.includes('hostaway')) return 'Hostaway'
  if (s.includes('lodgify')) return 'Lodgify'
  if (s.includes('block')) return 'Blocked'
  return 'iCal'
}

// Compact legend category for the calendar (groups all reservation channels).
function calLegendLabel(source: string | null): string {
  if (!source) return 'Manual'
  const s = source.toLowerCase()
  if (s === 'manual') return 'Manual'
  if (s.includes('airbnb')) return 'Airbnb'
  if (s.includes('vrbo')) return 'VRBO'
  if (s.includes('booking')) return 'Booking.com'
  return 'Other'
}

function statusPill(status: string) {
  const map: Record<string, string> = {
    confirmed: 'bg-[#e4f0da] text-[#2a5c0a]',
    cancelled: 'bg-[#fde4e4] text-[#8a1a1a]',
    pending: 'bg-[#faeeda] text-[#7a4800]',
  }
  return `text-[10px] px-2 py-0.5 rounded-full font-medium ${map[status] ?? 'bg-[#f0e8ff] text-[#4a0e8f]'}`
}

function CalendarView({ bookings }: { bookings: Booking[] }) {
  const [cursor, setCursor] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

  const now = new Date()
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth()
  const todayDay = now.getDate()

  // Colour for a day: a covering reservation wins over a covering block.
  function dayColor(day: number): string | null {
    // Build the date string from local y/m/d directly — round-tripping through
    // toISOString() would shift the day for positive-UTC hosts (the whole market),
    // and bookings store pure YYYY-MM-DD, matching the list-path comparisons.
    const d = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const covering = bookings.filter(b => d >= b.check_in && d < b.check_out)
    if (covering.length === 0) return null
    const reservation = covering.find(b => !isBlockSource(b.source))
    return reservation ? sourceColor(reservation.source) : BLOCK_GREY
  }

  // Legend: one swatch per category actually present among the bookings.
  const legend = (() => {
    const present = new Map<string, string>()
    for (const b of bookings) {
      if (isBlockSource(b.source)) present.set('Blocked', BLOCK_GREY)
      else present.set(calLegendLabel(b.source), sourceColor(b.source))
    }
    const ORDER = ['Manual', 'Airbnb', 'VRBO', 'Booking.com', 'Other', 'Blocked']
    return ORDER.filter(l => present.has(l)).map(l => ({ label: l, color: present.get(l)! }))
  })()

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
          className="w-7 h-7 flex items-center justify-center rounded-[8px] border border-[#e4ddd0] text-[#231d17] hover:bg-[#f0ede6] transition-colors"
          aria-label="Previous month"
        >‹</button>
        <div className="text-[13px] font-semibold text-[#231d17]">
          {cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        </div>
        <button
          onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
          className="w-7 h-7 flex items-center justify-center rounded-[8px] border border-[#e4ddd0] text-[#231d17] hover:bg-[#f0ede6] transition-colors"
          aria-label="Next month"
        >›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[10px] uppercase tracking-[.05em] text-[#a79e8e]">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={i} className="aspect-square" />
          const color = dayColor(day)
          const isToday = isCurrentMonth && day === todayDay
          return (
            <div
              key={i}
              className={`aspect-square flex items-center justify-center rounded-[5px] text-[11px] ${
                color
                  ? 'text-white font-semibold'
                  : isToday
                    ? 'ring-1 ring-[#1c1c1a] text-[#1c1c1a] font-semibold'
                    : 'text-[#8a8276] hover:bg-[#f0ede6]'
              }`}
              style={color ? { backgroundColor: color } : undefined}
            >
              {day}
            </div>
          )
        })}
      </div>
      {legend.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3 pt-3 border-t border-[#f0ede6]">
          {legend.map(({ label, color }) => (
            <span key={label} className="inline-flex items-center gap-1.5 text-[10px] text-[#8a8276]">
              <span className="w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: color }} />
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function BookingManager() {
  const { toast } = useToast()
  const [apartments, setApartments] = useState<{ id: string; name: string; ical_urls: string | null }[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<View>('list')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [aptId, setAptId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState<AddForm>({ firstName: '', checkIn: '', checkOut: '' })
  const [unreadByBooking, setUnreadByBooking] = useState<Record<string, number>>({})

  // Load all host apartments once on mount; set default selection to first
  useEffect(() => {
    async function loadApartments() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const { data } = await supabase
        .from('apartments')
        .select('id, name, ical_urls')
        .eq('host_id', user.id)
        .order('created_at')
      const list = (data ?? []) as { id: string; name: string; ical_urls: string | null }[]
      setApartments(list)
      if (list.length === 0) { setLoading(false); return }
      setAptId(prev => prev ?? list[0].id)
    }
    loadApartments()
  }, [])

  // Reload bookings whenever the selected apartment changes. Accepts an optional
  // signal so the useEffect cleanup can cancel a stale in-flight request if the
  // user switches apartments quickly (or a messages-read event fires mid-flight).
  const loadBookings = useCallback(async (signal?: { cancelled: boolean }) => {
    if (!aptId) return
    try {
      const { data } = await supabase
        .from('bookings')
        .select('id, check_in, check_out, status, reference_number, source, guests(first_name, last_name)')
        .eq('apartment_id', aptId)
        .neq('status', 'cancelled') // hide soft-cancelled feed ghosts (reconcile sync marks dropped rows 'cancelled')
        .order('check_in', { ascending: false })
      if (signal?.cancelled) return
      const loaded = (data as unknown as Booking[]) ?? []
      setBookings(loaded)
      setLoading(false)

      // Fetch unread counts per booking (respects cancellation signal)
      const ids = loaded.map(b => b.id)
      if (ids.length > 0) {
        const { data: unreadRows } = await supabase
          .from('messages')
          .select('booking_id')
          .eq('sender_role', 'guest')
          .is('read_at', null)
          .in('booking_id', ids)
        if (!signal?.cancelled) {
          const counts: Record<string, number> = {}
          for (const row of (unreadRows ?? []) as { booking_id: string }[]) {
            counts[row.booking_id] = (counts[row.booking_id] ?? 0) + 1
          }
          setUnreadByBooking(counts)
        }
      } else if (!signal?.cancelled) {
        setUnreadByBooking({})
      }
    } catch {
      if (!signal?.cancelled) setLoading(false)
    }
  }, [aptId])

  useEffect(() => {
    const signal = { cancelled: false }
    loadBookings(signal)
    // Pass the same signal so the cleanup below also cancels an in-flight
    // event-triggered reload (fixes the stale-overwrite race on rapid switches).
    const handleRead = () => loadBookings(signal)
    window.addEventListener('arrivly:messages-read', handleRead)
    return () => {
      signal.cancelled = true
      window.removeEventListener('arrivly:messages-read', handleRead)
    }
  }, [loadBookings])

  async function addBooking() {
    if (!aptId || !form.firstName.trim() || !form.checkIn || !form.checkOut) return
    if (form.checkOut <= form.checkIn) {
      toast('Check-out must be after check-in', 'error')
      return
    }
    setSaving(true)
    try {
      // Booking + guest creation runs server-side (api/create-booking) under the
      // service role, so the client no longer reads/inserts the guests table.
      const { reference_number } = await api.post<{ reference_number: string }>('/create-booking', {
        apartment_id: aptId,
        first_name: form.firstName.trim(),
        check_in: form.checkIn,
        check_out: form.checkOut,
      })

      toast(`Booking added · ${reference_number}`, 'success')
      setForm({ firstName: '', checkIn: '', checkOut: '' })
      setShowAddForm(false)
      await loadBookings()
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Could not add booking', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Loader />

  if (!aptId) return (
    <div className="max-w-2xl font-['Inter']">
      <h1 className="text-[22px] font-['Fraunces'] font-light text-[#231d17] mb-4">Bookings</h1>
      <p className="text-[12px] text-[#8a8276]">No properties yet. Set up a property in the Overview first.</p>
    </div>
  )

  // Device-local today as YYYY-MM-DD (NOT toISOString — that's UTC and skews the
  // Upcoming/Past split near midnight for positive-UTC hosts; matches the calendar).
  const n = new Date()
  const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`

  // Connected-calendar count for the selected apartment (https lines in ical_urls).
  const selectedApt = apartments.find(a => a.id === aptId)
  const calCount = (selectedApt?.ical_urls ?? '')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.startsWith('https://'))
    .length

  // List filter + search (applied to the LIST only — the calendar is an occupancy view).
  let listRows = bookings
  if (filter === 'guests') listRows = listRows.filter(b => !isBlockSource(b.source))
  else if (filter === 'blocks') listRows = listRows.filter(b => isBlockSource(b.source))
  const q = search.trim().toLowerCase()
  if (q) listRows = listRows.filter(b => !isBlockSource(b.source) && (b.guests?.first_name ?? '').toLowerCase().includes(q))
  const upcoming = listRows.filter(b => b.check_out >= today)
  const past = listRows.filter(b => b.check_out < today)

  function guestPageUrl(ref: string) {
    return `${ARRIVLY_CONFIG.appUrl}/guest?apt=${aptId}&token=${ref}`
  }

  function isActiveToday(b: Booking) {
    return today >= b.check_in && today < b.check_out && b.status === 'confirmed'
  }

  // Demoted single-line strip for calendar blocks.
  function blockStrip(b: Booking) {
    return (
      <div key={b.id} className="flex items-center gap-2.5 px-3 py-2 text-[11px] text-[#a79e8e]">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: BLOCK_GREY }} />
        <span>{fmt(b.check_in)} → {fmt(b.check_out)}</span>
        <span className="font-medium text-[#8a8276]">Blocked</span>
        <span className="ml-auto text-[10px] text-[#a79e8e] bg-[#f4f1ea] border border-[#e4ddd0] px-2 py-0.5 rounded-full shrink-0">
          {sourceLabel(b.source)}
        </span>
      </div>
    )
  }

  // Reservation card, source-accented on the left border.
  function reservationCard(b: Booking, isPast: boolean) {
    const unread = unreadByBooking[b.id] ?? 0
    return (
      <div
        key={b.id}
        className={`bg-[#fffdf9] border border-[#e4ddd0] rounded-[12px] px-4 py-3 ${isPast ? 'opacity-70' : ''}`}
        style={{ borderLeft: `3px solid ${sourceColor(b.source)}` }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="text-[13px] font-semibold text-[#231d17]">
                {b.guests ? b.guests.first_name : 'Guest'}
              </span>
              {unread > 0 && (
                <span className="bg-[#c8a24e] text-[#16100d] text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                  {unread}
                </span>
              )}
              <span className={statusPill(b.status)}>{b.status}</span>
              <span className="text-[10px] text-[#8a8276] bg-[#f4f1ea] border border-[#e4ddd0] px-2 py-0.5 rounded-full">
                {sourceLabel(b.source)}
              </span>
            </div>
            <div className="text-[11px] text-[#8a8276]">
              {fmt(b.check_in)} → {fmt(b.check_out)}
              {b.reference_number?.startsWith('ARR-') && (
                <span className="ml-2 font-mono text-[#a79e8e]">{b.reference_number}</span>
              )}
              {!b.guests && (
                <Link
                  to={`/dashboard/property/${aptId}?tab=calendars`}
                  title="Upload your Airbnb reservations CSV in the Calendars tab to fill in guest names."
                  className="ml-2 text-[#a8842f] hover:text-[#c8a24e] transition-colors"
                >
                  + add name
                </Link>
              )}
            </div>
          </div>
          {isActiveToday(b) && b.reference_number && (
            <a
              href={guestPageUrl(b.reference_number)}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-[10px] bg-[#eaf0dd] text-[#5d7c34] px-2.5 py-1 rounded-[8px] font-medium no-underline hover:bg-[#dde7c8] transition-colors"
            >
              👁 Guest page
            </a>
          )}
        </div>
      </div>
    )
  }

  const renderRow = (b: Booking, isPast: boolean) =>
    isBlockSource(b.source) ? blockStrip(b) : reservationCard(b, isPast)

  return (
    <div className="max-w-2xl font-['Inter']">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-[22px] font-['Fraunces'] font-light text-[#231d17]">Bookings</h1>
          {apartments.length > 1 && (
            <select
              value={aptId as string}
              onChange={e => setAptId(e.target.value)}
              className="bg-white border border-[#e0dacd] rounded-[10px] px-3 py-2 text-[13px] text-[#1c1c1a] focus:outline-none focus:border-[#c8a24e]"
            >
              {apartments.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setView('list')} className={pill(view === 'list')}>List</button>
          <button onClick={() => setView('cal')} className={pill(view === 'cal')}>Cal</button>
          <button
            onClick={() => setShowAddForm(v => !v)}
            className={showAddForm ? BTN_OUTLINE : BTN_SAVE}
          >
            {showAddForm ? '✕ Cancel' : '+ Add booking'}
          </button>
        </div>
      </div>

      {/* Add booking form */}
      {showAddForm && (
        <div className={`${CARD} mb-4`}>
          <h2 className={`${HEADING} mb-3`}>New manual booking</h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="col-span-2">
              <label className={LABEL}>Guest first name <span className="text-[#8a1a1a] normal-case">*</span></label>
              <input
                value={form.firstName}
                onChange={e => setForm(p => ({ ...p, firstName: e.target.value }))}
                className={INPUT}
                placeholder="Maria"
              />
            </div>
            <div>
              <label className={LABEL}>Check-in <span className="text-[#8a1a1a] normal-case">*</span></label>
              <input
                type="date"
                value={form.checkIn}
                onChange={e => setForm(p => ({ ...p, checkIn: e.target.value }))}
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL}>Check-out <span className="text-[#8a1a1a] normal-case">*</span></label>
              <input
                type="date"
                value={form.checkOut}
                onChange={e => setForm(p => ({ ...p, checkOut: e.target.value }))}
                className={INPUT}
              />
            </div>
          </div>
          <div className="bg-[#eaf0dd] rounded-[10px] px-3.5 py-2.5 text-[11px] text-[#4a6128] mb-3 leading-[1.6]">
            A booking reference (ARR-XXXXXX) is generated automatically and becomes the guest's QR token.
          </div>
          <button
            onClick={addBooking}
            disabled={saving || !form.firstName.trim() || !form.checkIn || !form.checkOut}
            className={BTN_SAVE}
          >
            {saving ? 'Saving…' : 'Save booking'}
          </button>
        </div>
      )}

      {/* Calendars pointer row — iCal management now lives in the property's Calendars tab */}
      <div className="bg-[#fffdf9] border border-[#e4ddd0] rounded-[14px] px-5 py-3.5 mb-4 flex items-center justify-between gap-3">
        <span className="text-[12px] text-[#8a8276]">
          {calCount > 0 ? `${calCount} calendar${calCount === 1 ? '' : 's'} connected` : 'No calendars connected'}
        </span>
        <Link
          to={`/dashboard/property/${aptId}?tab=calendars`}
          className="text-[12px] font-medium text-[#a8842f] hover:text-[#c8a24e] transition-colors shrink-0"
        >
          Manage calendars →
        </Link>
      </div>

      {view === 'cal' && <CalendarView bookings={bookings} />}

      {view === 'list' && (
        <>
          {/* Filter + search */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <button onClick={() => setFilter('all')} className={pill(filter === 'all')}>All</button>
            <button onClick={() => setFilter('guests')} className={pill(filter === 'guests')}>Guests</button>
            <button onClick={() => setFilter('blocks')} className={pill(filter === 'blocks')}>Blocks</button>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search guest name"
              className={`${INPUT} !w-auto flex-1 min-w-[140px]`}
            />
          </div>

          {bookings.length === 0 && !showAddForm && (
            <div className={`${CARD} text-center`}>
              <div className="text-[#cdc6b8] text-3xl mb-2">📅</div>
              <div className="text-[12px] text-[#8a8276]">
                No bookings yet. Add one above, or connect a calendar in the property's Calendars tab.
              </div>
            </div>
          )}

          {bookings.length > 0 && upcoming.length === 0 && past.length === 0 && (
            <div className="text-center py-6 text-[11px] text-[#b3aa9b]">No bookings match this filter.</div>
          )}

          {upcoming.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-[.12em] text-[#a79e8e] mb-2">Upcoming</div>
              <div className="space-y-2">
                {upcoming.map(b => renderRow(b, false))}
              </div>
            </div>
          )}

          {past.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-[.12em] text-[#a79e8e] mb-2">Past</div>
              <div className="space-y-2">
                {past.map(b => renderRow(b, true))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
