import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import Loader from '../shared/Loader'

interface Apartment {
  id: string
  name: string
  neighborhood: string | null
  is_visible: boolean | null
  created_at: string
}

interface HostData {
  trial_ends_at: string | null
  name: string | null
  brand_name: string | null
  welcome_seen_at: string | null
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [list, setList] = useState<Apartment[]>([])
  const [hostData, setHostData] = useState<HostData | null>(null)
  const [bookingTotal, setBookingTotal] = useState(0)
  const [completenessByApt, setCompletenessByApt] = useState<Map<string, Set<string>>>(new Map())
  const [bookingCountByApt, setBookingCountByApt] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [showWelcome, setShowWelcome] = useState(false)
  const [creatingApt, setCreatingApt] = useState(false)
  const [createError, setCreateError] = useState('')
  const welcomeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: hd } = await supabase
        .from('hosts')
        .select('trial_ends_at, name, brand_name, welcome_seen_at')
        .eq('id', user.id)
        .maybeSingle()

      const { data: apts } = await supabase
        .from('apartments')
        .select('id, name, neighborhood, is_visible, created_at')
        .eq('host_id', user.id)
        .order('created_at')

      const aList = apts ?? []
      setHostData(hd as HostData | null)
      setList(aList)
      setShowWelcome(!(hd as HostData | null)?.welcome_seen_at)

      if (aList.length > 0) {
        const aptIds = aList.map((a: Apartment) => a.id)
        const [{ data: dets }, { data: bk }] = await Promise.all([
          supabase.from('apartment_details').select('apartment_id, category').in('apartment_id', aptIds),
          supabase.from('bookings').select('apartment_id').in('apartment_id', aptIds),
        ])

        const cbMap = new Map<string, Set<string>>()
        for (const d of (dets ?? []) as Array<{ apartment_id: string; category: string }>) {
          if (!cbMap.has(d.apartment_id)) cbMap.set(d.apartment_id, new Set())
          cbMap.get(d.apartment_id)!.add(d.category)
        }
        setCompletenessByApt(cbMap)

        const bkMap = new Map<string, number>()
        for (const b of (bk ?? []) as Array<{ apartment_id: string }>) {
          bkMap.set(b.apartment_id, (bkMap.get(b.apartment_id) ?? 0) + 1)
        }
        setBookingCountByApt(bkMap)
        setBookingTotal(bk?.length ?? 0)
      }

      setLoading(false)
    }
    load()
  }, [])

  // Focus modal element when welcome is shown.
  useEffect(() => {
    if (showWelcome && welcomeRef.current) welcomeRef.current.focus()
  }, [showWelcome])

  // Escape-to-close.
  useEffect(() => {
    if (!showWelcome) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') void dismissWelcome()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showWelcome]) // eslint-disable-line react-hooks/exhaustive-deps

  async function dismissWelcome() {
    setShowWelcome(false)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      void supabase.from('hosts')
        .update({ welcome_seen_at: new Date().toISOString() })
        .eq('id', user.id)
        .catch(() => {})
    }
  }

  async function createFirstProperty() {
    if (creatingApt) return
    setCreatingApt(true)
    setCreateError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setCreatingApt(false); return }

    const aptName = hostData?.brand_name?.trim() || 'My property'
    const { data: newApt, error: aptErr } = await supabase
      .from('apartments')
      .insert({ host_id: user.id, name: aptName, is_visible: true })
      .select('id')
      .maybeSingle()

    if (aptErr || !(newApt as { id?: string } | null)?.id) {
      setCreateError('Could not create property. Please try again.')
      setCreatingApt(false)
      return
    }

    navigate(`/dashboard/property/${(newApt as { id: string }).id}`)
  }

  if (loading) return <Loader />

  const firstName = hostData?.name?.split(' ')[0] ?? ''
  const greeting = firstName ? `Welcome, ${firstName} 👋` : 'Welcome 👋'

  const trialEndsAt = hostData?.trial_ends_at ?? null
  const trialRemaining = trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : 0

  const check = (ok: boolean) => ok
    ? <span className="text-[#2a5c0a]">✓</span>
    : <span className="text-[#ccc]">–</span>

  return (
    <>
      {/* One-time welcome modal — shown when welcome_seen_at is null */}
      {showWelcome && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30"
          onClick={() => void dismissWelcome()}
        >
          <div
            ref={welcomeRef}
            role="dialog"
            aria-modal="true"
            aria-label="Welcome to Arrivly"
            tabIndex={-1}
            className="bg-[#f8f6f2] rounded-[12px] border border-[#ddd8ce] p-6 max-w-sm w-full shadow-xl outline-none"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <h2 className="text-[17px] font-serif font-light text-[#1a1a1a]">{greeting}</h2>
              <button
                onClick={() => void dismissWelcome()}
                aria-label="Close welcome"
                className="text-[#aaa] hover:text-[#444] text-xl leading-none bg-transparent border-none cursor-pointer ml-3 shrink-0"
              >
                &times;
              </button>
            </div>
            <p className="text-[12px] text-[#555] leading-relaxed mb-4">
              Every guest who scans your QR code lands on a personal page with WiFi details,
              house rules, a live city guide, and a chatbot that knows your apartment.
              Add your first property to generate it.
            </p>
            <button
              onClick={async () => { await dismissWelcome(); void createFirstProperty() }}
              disabled={creatingApt}
              className="w-full bg-[#1a1a1a] text-white rounded-[8px] py-2.5 text-xs font-semibold hover:opacity-80 transition-opacity disabled:opacity-40 mb-2"
            >
              {creatingApt ? 'Creating…' : 'Add my first property →'}
            </button>
            <button
              onClick={() => void dismissWelcome()}
              className="w-full text-[11px] text-center text-[#888] hover:text-[#444] py-1.5 bg-transparent border-none cursor-pointer transition-colors"
            >
              Maybe later
            </button>
          </div>
        </div>
      )}

      <div className="max-w-2xl">
        <h1 className="text-[17px] font-serif font-light text-[#1a1a1a] mb-4">Overview</h1>

        {list.length === 0 ? (
          /* ── Empty state (0 apartments) ── */
          <>
            <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-7 mb-3 text-center">
              <div className="text-[20px] font-serif font-light text-[#1a1a1a] mb-2">{greeting}</div>
              <p className="text-[12px] text-[#666] leading-relaxed mb-5 max-w-[300px] mx-auto">
                Your guest page is one step away. Add your first property and Arrivly will
                generate a personalised page for every scan.
              </p>
              {createError && (
                <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">
                  {createError}
                </p>
              )}
              <button
                onClick={() => void createFirstProperty()}
                disabled={creatingApt}
                className="bg-[#1a1a1a] text-white px-5 py-2.5 rounded-[8px] text-xs font-semibold hover:opacity-80 transition-opacity disabled:opacity-40"
              >
                {creatingApt ? 'Creating…' : 'Add my first property →'}
              </button>
            </div>

            {trialRemaining > 0 && (
              <p className="text-[10px] text-[#aaa] mt-3">
                Trial ends in {trialRemaining} {trialRemaining === 1 ? 'day' : 'days'} ·{' '}
                <Link to="/dashboard/billing" className="underline hover:text-[#666]">Upgrade</Link>
              </p>
            )}
          </>
        ) : (
          /* ── Normal state (≥1 apartment) ── */
          <>
            {/* Metrics */}
            <div className="grid grid-cols-3 gap-2.5 mb-5">
              {[
                { label: 'Properties', value: String(list.length) },
                { label: 'Bookings', value: String(bookingTotal) },
                { label: 'QR scans', value: '—' },
              ].map(m => (
                <div key={m.label} className="bg-white border border-[#ddd8ce] rounded-[10px] p-3">
                  <div className="text-[22px] font-serif font-light text-[#1a1a1a]">{m.value}</div>
                  <div className="text-[10px] uppercase tracking-[.06em] text-[#999] mt-0.5">{m.label}</div>
                </div>
              ))}
            </div>

            {/* Property cards — one per apartment */}
            {list.map(apt => {
              const cats = completenessByApt.get(apt.id) ?? new Set<string>()
              const aptBookings = bookingCountByApt.get(apt.id) ?? 0
              return (
                <div key={apt.id} className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 mb-3">
                  <div className="flex items-start justify-between mb-1">
                    <div>
                      <div className="text-[13px] font-semibold text-[#1a1a1a]">{apt.name}</div>
                      {apt.neighborhood && (
                        <div className="text-[11px] text-[#888] mt-0.5">{apt.neighborhood}</div>
                      )}
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      apt.is_visible
                        ? 'bg-[#e4f0da] text-[#2a5c0a]'
                        : 'bg-[#f0ede6] text-[#888]'
                    }`}>
                      {apt.is_visible ? 'Active' : 'Draft'}
                    </span>
                  </div>

                  {/* Completeness row */}
                  <div className="flex items-center gap-2 text-[11px] text-[#666] mt-3 mb-2 flex-wrap">
                    <span>WiFi {check(cats.has('WiFi'))}</span>
                    <span className="text-[#ddd]">·</span>
                    <span>House rules {check(cats.has('House Rules'))}</span>
                    <span className="text-[#ddd]">·</span>
                    <span>City guide {check(false)}</span>
                    <span className="text-[#ddd]">·</span>
                    <span>Check-in {check(cats.has('Check-in'))}</span>
                  </div>

                  {/* Booking count */}
                  <div className="text-[11px] text-[#aaa] mb-3">
                    {aptBookings} booking{aptBookings === 1 ? '' : 's'}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 flex-wrap">
                    <Link
                      to="/dashboard/qr"
                      className="bg-[#1a1a1a] text-white px-3 py-1.5 rounded-[7px] text-xs font-semibold hover:opacity-80 transition-opacity"
                    >
                      📲 QR code
                    </Link>
                    <a
                      href={`/guest?apt=${apt.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-transparent border border-[#ddd8ce] text-[#444] px-3 py-1.5 rounded-[7px] text-xs hover:bg-[#f0ede6] transition-colors"
                    >
                      👁 Preview guest page
                    </a>
                    <Link
                      to={`/dashboard/property/${apt.id}`}
                      className="bg-transparent border border-[#ddd8ce] text-[#444] px-3 py-1.5 rounded-[7px] text-xs hover:bg-[#f0ede6] transition-colors"
                    >
                      ✏️ Edit property
                    </Link>
                  </div>
                </div>
              )
            })}

            {/* Add property (dashed) */}
            <div className="border border-dashed border-[#ccc] rounded-[10px] p-4 mb-3 flex items-center justify-center cursor-pointer hover:bg-white/60 transition-colors">
              <span className="text-[12px] text-[#aaa]">+ Add another property · coming soon</span>
            </div>

            {/* Coming soon */}
            <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4">
              <div className="text-[11px] font-semibold text-[#1a1a1a] mb-0.5">Guest reviews · coming soon</div>
              <div className="text-[11px] text-[#888] leading-relaxed">Collect UGC screenshots from guests and display them on your guest page.</div>
            </div>

            {trialRemaining > 0 && (
              <p className="text-[10px] text-[#aaa] mt-3">
                Trial ends in {trialRemaining} {trialRemaining === 1 ? 'day' : 'days'} ·{' '}
                <Link to="/dashboard/billing" className="underline hover:text-[#666]">Upgrade</Link>
              </p>
            )}
          </>
        )}
      </div>
    </>
  )
}
