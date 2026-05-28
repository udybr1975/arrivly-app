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

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function sourceColor(source: string | null): string {
  if (!source) return '#c97c14'
  const s = source.toLowerCase()
  if (s.includes('airbnb')) return '#3b6d11'
  if (s.includes('vrbo')) return '#185fa5'
  return '#c97c14'
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
  let result = 'ARR-'
  for (let i = 0; i < 6; i++) result += chars[Math.floor(Math.random() * chars.length)]
  return result
}

function guestPageUrl(aptId: string, ref: string): string {
  return `${ARRIVLY_CONFIG.appUrl}/guest?apt=${aptId}&token=${ref}`
}

function isActiveToday(b: Booking): boolean {
  const today = new Date().toISOString().slice(0, 10)
  return b.check_in <= today && b.check_out > today
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
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [view, setView] = useState<View>('list')
  const [aptId, setAptId] = useState<string | null>(null)
  const [icalUrl, setIcalUrl] = useState('')
  const [form, setForm] = useState<AddForm>({ firstName: '', checkIn: '', checkOut: '' })

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const { data: apt } = await supabase
      .from('apartments')
      .select('id, airbnb_ical_url')
      .eq('host_id', user.id)
      .order('created_at')
      .limit(1)
      .maybeSingle()

    if (!apt) { setLoading(false); return }
    setAptId(apt.id)
    setIcalUrl(apt.airbnb_ical_url ?? '')

    const { data } = await supabase
      .from('bookings')
      .select('id, check_in, check_out, status, reference_number, source, guests(first_name, last_name)')
      .eq('apartment_id', apt.id)
      .order('check_in', { ascending: false })

    setBookings((data as unknown as Booking[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function syncICal() {
    if (!aptId) return
    setSyncing(true)
    try {
      await api.post('/sync-ical', { apartment_id: aptId })
      toast('Bookings synced from iCal', 'success')
      await load()
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Sync failed', 'error')
    } finally {
      setSyncing(false)
    }
  }

  async function addBooking() {
    if (!aptId || !form.firstName.trim() || !form.checkIn || !form.checkOut) return
    setAdding(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not logged in')

      // Find or create guest row
      const nameParts = form.firstName.trim().split(' ')
      const firstName = nameParts[0]
      const lastName = nameParts.slice(1).join(' ') || '—'

      let guestId: string
      const { data: existing } = await supabase
        .from('guests')
        .select('id')
        .eq('first_name', firstName)
        .eq('last_name', lastName)
        .maybeSingle()

      if (existing) {
        guestId = existing.id
      } else {
        const { data: newGuest, error: gErr } = await supabase
          .from('guests')
          .insert({ first_name: firstName, last_name: lastName })
          .select('id')
          .single()
        if (gErr || !newGuest) throw gErr ?? new Error('Failed to create guest')
        guestId = newGuest.id
      }

      // Generate unique reference number
      let ref = randomRef()
      for (let i = 0; i < 5; i++) {
        const { data: clash } = await supabase
          .from('bookings')
          .select('id')
          .eq('reference_number', ref)
          .maybeSingle()
        if (!clash) break
        ref = randomRef()
      }

      const { error: bErr } = await supabase.from('bookings').insert({
        apartment_id: aptId,
        guest_id: guestId,
        check_in: form.checkIn,
        check_out: form.checkOut,
        status: 'confirmed',
        source: 'manual',
        reference_number: ref,
        guest_count: 1,
      })
      if (bErr) throw bErr

      toast('Booking added', 'success')
      setShowForm(false)
      setForm({ firstName: '', checkIn: '', checkOut: '' })
      await load()
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to add booking', 'error')
    } finally {
      setAdding(false)
    }
  }

  if (loading) return <Loader />

  const today = new Date().toISOString().slice(0, 10)
  const upcoming = bookings.filter(b => b.check_out >= today)
  const past = bookings.filter(b => b.check_out < today)

  const BTN_DARK = 'bg-[#1a1a1a] text-white px-3 py-1.5 rounded-[7px] text-xs font-semibold hover:opacity-80 transition-opacity disabled:opacity-40'
  const BTN_OUT = 'bg-transparent border border-[#ddd8ce] text-[#444] px-3 py-1.5 rounded-[7px] text-xs hover:bg-[#f0ede6] transition-colors'
  const INPUT = 'w-full bg-[#f8f6f2] border border-[#ddd8ce] rounded-[8px] px-3 py-2 text-xs text-[#444] focus:outline-none focus:border-[#1a1a1a] transition-colors'
  const LABEL = 'block text-[10px] uppercase tracking-[.06em] text-[#999] mb-[3px]'

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-[17px] font-serif font-light text-[#1a1a1a]">Bookings</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setView('list')} className={view === 'list' ? BTN_DARK : BTN_OUT}>List</button>
          <button onClick={() => setView('cal')} className={view === 'cal' ? BTN_DARK : BTN_OUT}>Cal</button>
          <button onClick={() => setShowForm(v => !v)} className={BTN_DARK}>+ Add</button>
        </div>
      </div>

      {/* Manual add form */}
      {showForm && (
        <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 mb-4">
          <div className="text-[12px] font-semibold text-[#1a1a1a] mb-3">Add booking manually</div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div>
              <label className={LABEL}>Guest name</label>
              <input
                value={form.firstName}
                onChange={e => setForm(p => ({ ...p, firstName: e.target.value }))}
                className={INPUT}
                placeholder="Ana García"
              />
            </div>
            <div>
              <label className={LABEL}>Check-in</label>
              <input
                type="date"
                value={form.checkIn}
                onChange={e => setForm(p => ({ ...p, checkIn: e.target.value }))}
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL}>Check-out</label>
              <input
                type="date"
                value={form.checkOut}
                onChange={e => setForm(p => ({ ...p, checkOut: e.target.value }))}
                className={INPUT}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className={BTN_OUT}>Cancel</button>
            <button
              onClick={addBooking}
              disabled={adding || !form.firstName.trim() || !form.checkIn || !form.checkOut}
              className={BTN_DARK}
            >
              {adding ? 'Adding…' : 'Add booking'}
            </button>
          </div>
        </div>
      )}

      {view === 'cal' && <CalendarView bookings={bookings} />}

      {view === 'list' && (
        <>
          {bookings.length === 0 && (
            <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-8 text-center">
              <div className="text-[#ccc] text-3xl mb-2">📅</div>
              <div className="text-[12px] text-[#aaa]">No bookings yet. Add one manually or sync from iCal below.</div>
            </div>
          )}

          {upcoming.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-[.06em] text-[#999] mb-2">Upcoming</div>
              <div className="space-y-2">
                {upcoming.map(b => (
                  <div
                    key={b.id}
                    className="bg-white border border-[#ddd8ce] rounded-[10px] px-4 py-3 flex items-center gap-3"
                    style={{ borderLeft: `3px solid ${sourceColor(b.source)}` }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-[12px] font-semibold text-[#1a1a1a]">
                          {b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : 'Guest'}
                        </span>
                        <span className={statusPill(b.status)}>{b.status}</span>
                        {b.source && (
                          <span className="text-[10px] text-[#888] bg-[#f8f6f2] border border-[#ddd8ce] px-2 py-0.5 rounded-full">
                            {b.source}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#888]">
                        {fmt(b.check_in)} → {fmt(b.check_out)}
                        {b.reference_number && <span className="ml-2 font-mono">· {b.reference_number}</span>}
                      </div>
                    </div>
                    {isActiveToday(b) && b.reference_number && aptId && (
                      <a
                        href={guestPageUrl(aptId, b.reference_number)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-[10px] bg-[#e4f0da] text-[#2a5c0a] px-2 py-1 rounded-[5px] font-medium no-underline hover:bg-[#d4e8c8] transition-colors"
                      >
                        👁 Guest page
                      </a>
                    )}
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
                    className="bg-white border border-[#ddd8ce] rounded-[10px] px-4 py-3 flex items-center gap-3 opacity-60"
                    style={{ borderLeft: `3px solid ${sourceColor(b.source)}` }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-[12px] font-semibold text-[#1a1a1a]">
                          {b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : 'Guest'}
                        </span>
                        {b.source && (
                          <span className="text-[10px] text-[#888] bg-[#f8f6f2] border border-[#ddd8ce] px-2 py-0.5 rounded-full">
                            {b.source}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#888]">
                        {fmt(b.check_in)} → {fmt(b.check_out)}
                        {b.reference_number && <span className="ml-2 font-mono">· {b.reference_number}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* iCal card */}
      <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 mt-4">
        <div className="text-[12px] font-semibold text-[#1a1a1a] mb-1">iCal sync</div>
        <div className="text-[11px] text-[#888] mb-3">Paste your Airbnb / VRBO iCal URL to auto-import bookings.</div>
        <input
          value={icalUrl}
          onChange={e => setIcalUrl(e.target.value)}
          className={INPUT}
          placeholder="https://www.airbnb.com/calendar/ical/…"
        />
        <button
          onClick={syncICal}
          disabled={syncing || !aptId}
          className="mt-3 bg-[#1a1a1a] text-white px-4 py-2 rounded-[8px] text-xs font-semibold hover:opacity-80 transition-opacity disabled:opacity-40"
        >
          {syncing ? '↻ Syncing…' : '↻ Sync now'}
        </button>
      </div>
    </div>
  )
}
