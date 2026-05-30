import { useEffect, useState, useCallback } from 'react'
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

const INPUT = 'w-full bg-[#f8f6f2] border border-[#ddd8ce] rounded-[8px] px-3 py-2 text-xs text-[#444] focus:outline-none focus:border-[#1a1a1a] transition-colors'
const LABEL = 'block text-[10px] uppercase tracking-[.06em] text-[#999] mb-[3px]'
const BTN_DARK = 'bg-[#1a1a1a] text-white px-3 py-1.5 rounded-[7px] text-xs font-semibold hover:opacity-80 transition-opacity disabled:opacity-40'
const BTN_OUT = 'bg-transparent border border-[#ddd8ce] text-[#444] px-3 py-1.5 rounded-[7px] text-xs hover:bg-[#f0ede6] transition-colors'

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
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

function statusPill(status: string) {
  const map: Record<string, string> = {
    confirmed: 'bg-[#e4f0da] text-[#2a5c0a]',
    cancelled: 'bg-[#fde4e4] text-[#8a1a1a]',
    pending: 'bg-[#faeeda] text-[#7a4800]',
  }
  return `text-[10px] px-2 py-0.5 rounded-full font-medium ${map[status] ?? 'bg-[#f0e8ff] text-[#4a0e8f]'}`
}

function randomRef(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let r = 'ARR-'
  for (let i = 0; i < 6; i++) r += chars[Math.floor(Math.random() * chars.length)]
  return r
}

function CalendarView({ bookings }: { bookings: Booking[] }) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

  function isBooked(day: number) {
    const d = new Date(year, month, day).toISOString().slice(0, 10)
    return bookings.some(b => d >= b.check_in && d < b.check_out)
  }

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4">
      <div className="text-[12px] font-semibold text-[#1a1a1a] mb-3">
        {now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[10px] uppercase tracking-[.05em] text-[#999]">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => (
          <div
            key={i}
            className={`aspect-square flex items-center justify-center rounded-[5px] text-[11px] ${
              day === null
                ? ''
                : isBooked(day)
                  ? 'bg-[#1a1a1a] text-white font-semibold'
                  : 'text-[#444] hover:bg-[#f0ede6]'
            }`}
          >
            {day ?? ''}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function BookingManager() {
  const { toast } = useToast()
  const [apartments, setApartments] = useState<{ id: string; name: string; ical_urls: string | null }[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [savingIcal, setSavingIcal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<View>('list')
  const [aptId, setAptId] = useState<string | null>(null)
  const [icalText, setIcalText] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState<AddForm>({ firstName: '', checkIn: '', checkOut: '' })

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

  // Reload bookings and iCal text whenever the selected apartment changes.
  // Accepts an optional signal so the useEffect cleanup can cancel a stale
  // in-flight request if the user switches apartments quickly.
  const loadBookings = useCallback(async (signal?: { cancelled: boolean }) => {
    if (!aptId) return
    try {
      const apt = apartments.find(a => a.id === aptId)
      setIcalText(apt?.ical_urls ?? '')   // synchronous lookup — immediate update
      const { data } = await supabase
        .from('bookings')
        .select('id, check_in, check_out, status, reference_number, source, guests(first_name, last_name)')
        .eq('apartment_id', aptId)
        .order('check_in', { ascending: false })
      if (signal?.cancelled) return
      setBookings((data as unknown as Booking[]) ?? [])
      setLoading(false)
    } catch {
      if (!signal?.cancelled) setLoading(false)
    }
  }, [aptId, apartments])

  useEffect(() => {
    const signal = { cancelled: false }
    loadBookings(signal)
    return () => { signal.cancelled = true }
  }, [loadBookings])

  async function saveIcalUrls() {
    if (!aptId) return
    setSavingIcal(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSavingIcal(false); return }
    const { error } = await supabase
      .from('apartments')
      .update({ ical_urls: icalText.trim() || null } as Record<string, unknown>)
      .eq('id', aptId)
      .eq('host_id', user.id)
    if (error) toast('Could not save URLs', 'error')
    else toast('Calendar URLs saved', 'success')
    setSavingIcal(false)
  }

  async function syncICal() {
    if (!aptId) return
    setSyncing(true)
    try {
      const result = await api.post('/sync-ical', { apartment_id: aptId }) as {
        imported: number
        skipped: number
        errors: string[]
      }
      const msg = `Synced — ${result.imported} new, ${result.skipped} already known`
      toast(
        result.errors.length > 0 ? `${msg} (${result.errors.length} error(s))` : msg,
        result.errors.length > 0 ? 'error' : 'success'
      )
      await loadBookings()
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Sync failed', 'error')
    } finally {
      setSyncing(false)
    }
  }

  async function addBooking() {
    if (!aptId || !form.firstName.trim() || !form.checkIn || !form.checkOut) return
    if (form.checkOut <= form.checkIn) {
      toast('Check-out must be after check-in', 'error')
      return
    }
    setSaving(true)
    try {
      const { data: existingGuest } = await supabase
        .from('guests')
        .select('id')
        .eq('first_name', form.firstName.trim())
        .maybeSingle()

      let guestId: string
      if (existingGuest?.id) {
        guestId = existingGuest.id
      } else {
        const { data: newGuest, error: guestErr } = await supabase
          .from('guests')
          .insert({ first_name: form.firstName.trim(), last_name: '', email: '' })
          .select('id')
          .single()
        if (guestErr || !newGuest) throw new Error(guestErr?.message ?? 'Could not create guest')
        guestId = newGuest.id
      }

      let ref = randomRef()
      const { data: collision } = await supabase
        .from('bookings')
        .select('id')
        .eq('reference_number', ref)
        .maybeSingle()
      if (collision) ref = randomRef()

      const { error: bookErr } = await supabase.from('bookings').insert({
        apartment_id: aptId,
        guest_id: guestId,
        check_in: form.checkIn,
        check_out: form.checkOut,
        status: 'confirmed',
        reference_number: ref,
        source: 'manual',
      })
      if (bookErr) throw new Error(bookErr.message)

      toast(`Booking added · ${ref}`, 'success')
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
    <div className="max-w-2xl">
      <h1 className="text-[17px] font-serif font-light text-[#1a1a1a] mb-4">Bookings</h1>
      <p className="text-[12px] text-[#aaa]">No properties yet. Set up a property in the Overview first.</p>
    </div>
  )

  const today = new Date().toISOString().slice(0, 10)
  const upcoming = bookings.filter(b => b.check_out >= today)
  const past = bookings.filter(b => b.check_out < today)
  const isBlock = (source: string | null) => source?.includes('block') ?? false

  function guestPageUrl(ref: string) {
    return `${ARRIVLY_CONFIG.appUrl}/guest?apt=${aptId}&token=${ref}`
  }

  function isActiveToday(b: Booking) {
    return today >= b.check_in && today < b.check_out && b.status === 'confirmed'
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-[17px] font-serif font-light text-[#1a1a1a]">Bookings</h1>
          {apartments.length > 1 && (
            <select
              value={aptId as string}
              onChange={e => setAptId(e.target.value)}
              className="bg-[#f8f6f2] border border-[#ddd8ce] rounded-[8px] px-3 py-2 text-xs text-[#444] focus:outline-none focus:border-[#1a1a1a]"
            >
              {apartments.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setView('list')} className={view === 'list' ? BTN_DARK : BTN_OUT}>List</button>
          <button onClick={() => setView('cal')} className={view === 'cal' ? BTN_DARK : BTN_OUT}>Cal</button>
          <button
            onClick={() => setShowAddForm(v => !v)}
            className="bg-[#1a1a1a] text-white px-3 py-1.5 rounded-[7px] text-xs font-semibold hover:opacity-80 transition-opacity"
          >
            {showAddForm ? '✕ Cancel' : '+ Add booking'}
          </button>
        </div>
      </div>

      {/* Add booking form */}
      {showAddForm && (
        <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 mb-4">
          <div className="text-[12px] font-semibold text-[#1a1a1a] mb-3">New manual booking</div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="col-span-2">
              <label className={LABEL}>Guest first name <span className="text-red-500 normal-case">*</span></label>
              <input
                value={form.firstName}
                onChange={e => setForm(p => ({ ...p, firstName: e.target.value }))}
                className={INPUT}
                placeholder="Maria"
              />
            </div>
            <div>
              <label className={LABEL}>Check-in <span className="text-red-500 normal-case">*</span></label>
              <input
                type="date"
                value={form.checkIn}
                onChange={e => setForm(p => ({ ...p, checkIn: e.target.value }))}
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL}>Check-out <span className="text-red-500 normal-case">*</span></label>
              <input
                type="date"
                value={form.checkOut}
                onChange={e => setForm(p => ({ ...p, checkOut: e.target.value }))}
                className={INPUT}
              />
            </div>
          </div>
          <div className="bg-[#f8f6f2] rounded-[7px] px-3 py-2 text-[11px] text-[#888] mb-3 leading-relaxed">
            A booking reference (ARR-XXXXXX) is generated automatically and becomes the guest's QR token.
          </div>
          <button
            onClick={addBooking}
            disabled={saving || !form.firstName.trim() || !form.checkIn || !form.checkOut}
            className={BTN_DARK}
          >
            {saving ? 'Saving…' : 'Save booking'}
          </button>
        </div>
      )}

      {view === 'cal' && <CalendarView bookings={bookings} />}

      {view === 'list' && (
        <>
          {bookings.length === 0 && !showAddForm && (
            <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-8 text-center">
              <div className="text-[#ccc] text-3xl mb-2">📅</div>
              <div className="text-[12px] text-[#aaa]">No bookings yet. Add one above or sync a calendar below.</div>
            </div>
          )}

          {upcoming.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-[.06em] text-[#999] mb-2">Upcoming</div>
              <div className="space-y-2">
                {upcoming.map(b => (
                  <div
                    key={b.id}
                    className={`bg-white border border-[#ddd8ce] rounded-[10px] px-4 py-3 ${isBlock(b.source) ? 'opacity-50' : ''}`}
                    style={{ borderLeft: `3px solid ${sourceColor(b.source)}` }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span className="text-[12px] font-semibold text-[#1a1a1a]">
                            {isBlock(b.source) ? 'Blocked' : (b.guests ? b.guests.first_name : 'Guest')}
                          </span>
                          {!isBlock(b.source) && <span className={statusPill(b.status)}>{b.status}</span>}
                          <span className="text-[10px] text-[#888] bg-[#f8f6f2] border border-[#ddd8ce] px-2 py-0.5 rounded-full">
                            {sourceLabel(b.source)}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#888]">
                          {fmt(b.check_in)} → {fmt(b.check_out)}
                          {!isBlock(b.source) && b.reference_number && (
                            <span className="ml-2 font-mono">{b.reference_number}</span>
                          )}
                        </div>
                      </div>
                      {isActiveToday(b) && !isBlock(b.source) && b.reference_number && (
                        <a
                          href={guestPageUrl(b.reference_number)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-[10px] bg-[#e4f0da] text-[#2a5c0a] px-2 py-1 rounded-[5px] font-medium no-underline hover:bg-[#d4e8c8] transition-colors"
                        >
                          👁 Guest page
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {past.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-[.06em] text-[#999] mb-2">Past</div>
              <div className="space-y-2">
                {past.map(b => (
                  <div
                    key={b.id}
                    className="bg-white border border-[#ddd8ce] rounded-[10px] px-4 py-3 opacity-50"
                    style={{ borderLeft: `3px solid ${sourceColor(b.source)}` }}
                  >
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-[12px] font-semibold text-[#1a1a1a]">
                        {isBlock(b.source) ? 'Blocked' : (b.guests ? b.guests.first_name : 'Guest')}
                      </span>
                      <span className="text-[10px] text-[#888] bg-[#f8f6f2] border border-[#ddd8ce] px-2 py-0.5 rounded-full">
                        {sourceLabel(b.source)}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#888]">
                      {fmt(b.check_in)} → {fmt(b.check_out)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Calendar sync card */}
      <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 mt-4">
        <div className="text-[12px] font-semibold text-[#1a1a1a] mb-1">Calendar sync</div>
        <div className="text-[11px] text-[#888] mb-3 leading-relaxed">
          Paste one iCal URL per line — Airbnb, VRBO, Booking.com, Guesty, Hostaway, or any platform. No limit.
        </div>
        <textarea
          value={icalText}
          onChange={e => setIcalText(e.target.value)}
          rows={4}
          className={`${INPUT} resize-none font-mono text-[11px] mb-3`}
          placeholder={`https://www.airbnb.com/calendar/ical/…\nhttps://www.vrbo.com/icalendar/…\nhttps://booking.com/…`}
        />
        <div className="flex gap-2">
          <button onClick={saveIcalUrls} disabled={savingIcal} className={BTN_OUT}>
            {savingIcal ? 'Saving…' : 'Save URLs'}
          </button>
          <button
            onClick={syncICal}
            disabled={syncing || !aptId || !icalText.trim()}
            className={BTN_DARK}
          >
            {syncing ? '↻ Syncing…' : '↻ Sync now'}
          </button>
        </div>
      </div>
    </div>
  )
}
