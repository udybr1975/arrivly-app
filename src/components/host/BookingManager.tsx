import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, Calendar } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../shared/Toast'
import { api } from '../../lib/api'
import Loader from '../shared/Loader'

interface Booking {
  id: string
  check_in: string
  check_out: string
  status: string
  reference_number: string | null
  source: string | null
  guest_count: number
  guests: { first_name: string; last_name: string; email: string } | null
}

type Filter = 'upcoming' | 'past' | 'all'

function statusBadge(status: string) {
  const map: Record<string, string> = {
    confirmed: 'bg-green-500/20 text-green-300 border-green-500/30',
    cancelled: 'bg-red-500/20 text-red-300 border-red-500/30',
    pending: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  }
  return `text-xs px-2 py-0.5 rounded-full border ${map[status] ?? 'bg-white/10 text-gray-300 border-white/20'}`
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function BookingManager() {
  const { toast } = useToast()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [filter, setFilter] = useState<Filter>('upcoming')
  const [aptId, setAptId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: apt } = await supabase
      .from('apartments')
      .select('id')
      .eq('created_by', user.id)
      .order('created_at')
      .limit(1)
      .maybeSingle()

    if (!apt) { setLoading(false); return }
    setAptId(apt.id)

    const { data } = await supabase
      .from('bookings')
      .select('id, check_in, check_out, status, reference_number, source, guest_count, guests(first_name, last_name, email)')
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

  if (loading) return <Loader />

  const today = new Date().toISOString().slice(0, 10)
  const filtered = bookings.filter(b => {
    if (filter === 'upcoming') return b.check_out >= today
    if (filter === 'past') return b.check_out < today
    return true
  })

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Bookings</h1>
        <button
          onClick={syncICal}
          disabled={syncing || !aptId}
          className="flex items-center gap-2 border border-white/20 px-3 py-2 rounded-lg text-sm hover:bg-white/5 transition-colors disabled:opacity-40"
        >
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          Sync iCal
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-white/5 border border-white/10 rounded-lg p-1 w-fit">
        {(['upcoming', 'past', 'all'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${
              filter === f ? 'bg-white text-[#1c1c1a]' : 'text-gray-400 hover:text-white'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Calendar size={32} className="mx-auto mb-3 opacity-40" />
          <p>No {filter} bookings</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(b => (
            <div key={b.id} className="bg-white/5 border border-white/10 rounded-xl px-4 py-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-medium text-sm">
                    {b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : 'Guest'}
                  </p>
                  <span className={statusBadge(b.status)}>{b.status}</span>
                  {b.source && (
                    <span className="text-xs text-gray-500 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full">
                      {b.source}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400">
                  {fmt(b.check_in)} → {fmt(b.check_out)}
                  {b.guest_count > 1 && <span className="ml-2">· {b.guest_count} guests</span>}
                  {b.reference_number && <span className="ml-2 font-mono">· {b.reference_number}</span>}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
