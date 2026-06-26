import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { MapPin, QrCode, Plus, MoreHorizontal, ArrowRight, Building2, CalendarDays, MessageCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { resolveImageUrl } from '../../lib/imageUtils'
import Loader from '../shared/Loader'

interface Apartment {
  id: string
  name: string
  neighborhood: string | null
  is_visible: boolean | null
  hero_image_url: string | null
  accent_color: string | null
  created_at: string
}

interface HostData {
  trial_ends_at: string | null
  name: string | null
  brand_name: string | null
  welcome_seen_at: string | null
  tier: number | null
  is_exempt: boolean | null
  property_cap_override: number | null
  accent_color: string | null
}

const ESSENTIAL_DEFS = [
  { label: 'WiFi', cat: 'WiFi' },
  { label: 'House Rules', cat: 'House Rules' },
  { label: 'city guide', cat: '__guide__' },
  { label: 'Check-in', cat: 'Check-in' },
] as const

// Accessible per-card overflow menu: Escape + click-outside to close.
function CardMenu({ apt, toggling, onToggle }: { apt: Apartment; toggling: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        onClick={() => setOpen(o => !o)}
        className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border border-[#e4ddd0] text-[#8a8276] hover:bg-[#f0ede6] transition-colors"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 bottom-full mb-1.5 z-20 w-[164px] rounded-[10px] border border-[#e4ddd0] bg-[#fffdf9] py-1 shadow-[0_8px_24px_rgba(35,29,23,0.12)]"
        >
          <Link
            role="menuitem"
            to={`/dashboard/property/${apt.id}`}
            className="block px-3 py-2 text-[12.5px] text-[#231d17] hover:bg-[#f0ede6] transition-colors"
          >
            Edit property
          </Link>
          <button
            type="button"
            role="menuitem"
            disabled={toggling}
            onClick={() => { setOpen(false); onToggle() }}
            className="block w-full text-left px-3 py-2 text-[12.5px] text-[#231d17] hover:bg-[#f0ede6] transition-colors disabled:opacity-50"
          >
            {toggling ? 'Saving…' : apt.is_visible ? 'Unpublish' : 'Publish'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [list, setList] = useState<Apartment[]>([])
  const [hostData, setHostData] = useState<HostData | null>(null)
  const [planMaxProperties, setPlanMaxProperties] = useState<number | null>(null)
  const [bookingTotal, setBookingTotal] = useState(0)
  const [unread, setUnread] = useState(0)
  const [completenessByApt, setCompletenessByApt] = useState<Map<string, Set<string>>>(new Map())
  const [bookingCountByApt, setBookingCountByApt] = useState<Map<string, number>>(new Map())
  const [guideByApt, setGuideByApt] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [showWelcome, setShowWelcome] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const welcomeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: hd } = await supabase
        .from('hosts')
        .select('trial_ends_at, name, brand_name, welcome_seen_at, tier, is_exempt, property_cap_override, accent_color')
        .eq('id', user.id)
        .maybeSingle()

      const { data: apts } = await supabase
        .from('apartments')
        .select('id, name, neighborhood, is_visible, hero_image_url, accent_color, created_at')
        .eq('host_id', user.id)
        .order('created_at')

      const aList = apts ?? []
      setHostData(hd as HostData | null)
      setList(aList)
      setShowWelcome(!(hd as HostData | null)?.welcome_seen_at)

      // Fetch the plan's property cap (exempt hosts are always unlimited; skip if tier unset)
      const hdTyped = hd as HostData | null
      if (hdTyped && !hdTyped.is_exempt && hdTyped.tier !== null) {
        const { data: planRow } = await supabase
          .from('plans')
          .select('max_properties')
          .eq('tier', hdTyped.tier)
          .maybeSingle()
        setPlanMaxProperties(
          (planRow as { max_properties: number | null } | null)?.max_properties ?? null
        )
      }

      // Unread guest messages — best-effort metric (same query the sidebar uses).
      const { count: unreadCount } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('sender_role', 'guest')
        .is('read_at', null)
      setUnread(unreadCount ?? 0)

      if (aList.length > 0) {
        const aptIds = aList.map((a: Apartment) => a.id)
        const [{ data: dets }, { data: bk }, { data: guides }] = await Promise.all([
          supabase.from('apartment_details').select('apartment_id, category').in('apartment_id', aptIds),
          supabase.from('bookings').select('apartment_id').in('apartment_id', aptIds),
          supabase.from('guide_recommendations').select('apartment_id').in('apartment_id', aptIds),
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

        setGuideByApt(new Set(((guides ?? []) as Array<{ apartment_id: string }>).map(g => g.apartment_id)))
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
    if (!user) return
    try {
      await supabase.from('hosts')
        .update({ welcome_seen_at: new Date().toISOString() })
        .eq('id', user.id)
    } catch {
      // non-blocking: the modal is already closed; a failed flag write is harmless
    }
  }

  function createProperty() {
    navigate('/dashboard/property/new')
  }

  async function handleToggleVisibility(apt: Apartment) {
    const makeVisible = !apt.is_visible
    if (!makeVisible) {
      const ok = window.confirm(
        'Unpublish this property?\n\nThis hides your guest page from anyone who scans the QR code, including any guest currently staying. You can publish it again at any time.'
      )
      if (!ok) return
    }
    setTogglingId(apt.id)
    // optimistic update
    setList(prev => prev.map(a => (a.id === apt.id ? { ...a, is_visible: makeVisible } : a)))
    const { error } = await supabase
      .from('apartments')
      .update({ is_visible: makeVisible })
      .eq('id', apt.id)
    setTogglingId(null)
    if (error) {
      // revert on failure
      setList(prev => prev.map(a => (a.id === apt.id ? { ...a, is_visible: !makeVisible } : a)))
      window.alert("Couldn't update the property's status — please try again.")
    }
  }

  if (loading) return <Loader />

  const firstName = hostData?.name?.split(' ')[0] ?? ''
  const greeting = firstName ? `Welcome back, ${firstName}` : 'Welcome back'

  const trialEndsAt = hostData?.trial_ends_at ?? null
  const trialRemaining = trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : 0

  // Mirrors the DB trigger logic exactly:
  // effectiveCap = is_exempt ? unlimited : (property_cap_override ?? plans.max_properties)
  const effectiveCap: number | null = hostData?.is_exempt
    ? null
    : (hostData?.property_cap_override ?? planMaxProperties)

  const atCap = effectiveCap !== null && list.length >= effectiveCap

  // Per-apartment readiness against the 4 essentials.
  function essentials(apt: Apartment) {
    const cats = completenessByApt.get(apt.id) ?? new Set<string>()
    const items = ESSENTIAL_DEFS.map(d => ({
      label: d.label,
      ok: d.cat === '__guide__' ? guideByApt.has(apt.id) : cats.has(d.cat),
    }))
    const met = items.filter(i => i.ok).length
    const missing = items.filter(i => !i.ok).map(i => i.label)
    return { met, total: ESSENTIAL_DEFS.length, missing }
  }

  // Adaptive next-step: first property still missing an essential.
  const nextStep = (() => {
    for (const apt of list) {
      const e = essentials(apt)
      if (e.missing.length > 0) return { apt, ...e }
    }
    return null
  })()

  const TRIAL_FOOTER = trialRemaining > 0 && (
    <p className="text-[11px] text-[#b3aa9b] mt-6">
      Trial ends in {trialRemaining} {trialRemaining === 1 ? 'day' : 'days'} ·{' '}
      <Link to="/dashboard/billing" className="text-[#a8842f] underline underline-offset-2 hover:text-[#c8a24e]">Upgrade</Link>
    </p>
  )

  return (
    <div className="font-['Inter']">
      {/* One-time welcome modal — shown when welcome_seen_at is null */}
      {showWelcome && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => void dismissWelcome()}
        >
          <div
            ref={welcomeRef}
            role="dialog"
            aria-modal="true"
            aria-label="Welcome to Arrivly"
            tabIndex={-1}
            className="bg-[#fffdf9] rounded-[14px] border border-[#e4ddd0] p-6 max-w-sm w-full shadow-xl outline-none"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <h2 className="text-[20px] font-['Fraunces'] font-light text-[#231d17]">{greeting}</h2>
              <button
                onClick={() => void dismissWelcome()}
                aria-label="Close welcome"
                className="text-[#b3aa9b] hover:text-[#231d17] text-xl leading-none bg-transparent border-none cursor-pointer ml-3 shrink-0"
              >
                &times;
              </button>
            </div>
            <p className="text-[12.5px] text-[#6b6354] leading-relaxed mb-5">
              Every guest who scans your QR code lands on a personal page with WiFi details,
              house rules, a live city guide, and a chatbot that knows your apartment.
              Add your first property to generate it.
            </p>
            <button
              onClick={async () => { await dismissWelcome(); createProperty() }}
              className="w-full bg-[#c8a24e] text-[#16100d] rounded-[10px] py-2.5 text-[13px] font-semibold hover:bg-[#e7d6ad] transition-colors mb-2"
            >
              Add my first property →
            </button>
            <button
              onClick={() => void dismissWelcome()}
              className="w-full text-[12px] text-center text-[#8a8276] hover:text-[#231d17] py-1.5 bg-transparent border-none cursor-pointer transition-colors"
            >
              Maybe later
            </button>
          </div>
        </div>
      )}

      <div className="max-w-5xl">
        {/* Header */}
        <header className="mb-7">
          <h1 className="text-[25px] font-['Fraunces'] font-light text-[#231d17]">{greeting}</h1>
          <p className="text-[13px] text-[#8a8276] mt-1">Here's your guest experience at a glance.</p>
        </header>

        {list.length === 0 ? (
          /* ── Empty state (0 apartments) ── */
          <>
            <div className="bg-[#fffdf9] border border-[#e4ddd0] rounded-[14px] p-9 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[12px] bg-[rgba(200,162,78,0.14)] text-[#a8842f]">
                <Building2 size={22} />
              </div>
              <div className="text-[21px] font-['Fraunces'] font-light text-[#231d17] mb-2">{greeting}</div>
              <p className="text-[13px] text-[#6b6354] leading-relaxed mb-6 max-w-[320px] mx-auto">
                Your guest page is one step away. Add your first property and Arrivly will
                generate a personalised page for every scan.
              </p>
              <button
                onClick={createProperty}
                className="inline-flex items-center gap-2 bg-[#c8a24e] text-[#16100d] px-5 py-2.5 rounded-[10px] text-[13px] font-semibold hover:bg-[#e7d6ad] transition-colors"
              >
                Add my first property
                <ArrowRight size={15} />
              </button>
            </div>
            {TRIAL_FOOTER}
          </>
        ) : (
          /* ── Normal state (≥1 apartment) ── */
          <>
            {/* Adaptive next-step banner */}
            {nextStep && (
              <div className="mb-6 flex items-center gap-4 rounded-[13px] border border-[rgba(200,162,78,0.4)] bg-gradient-to-r from-[#fffaf0] to-[#fffdf9] p-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-[#c8a24e] text-[13px] font-['Fraunces'] font-medium text-[#a8842f]">
                  {nextStep.met}/{nextStep.total}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-[#231d17]">{nextStep.apt.name} is almost ready</div>
                  <div className="text-[12px] text-[#8a8276] mt-0.5 truncate">
                    Still to add: {nextStep.missing.join(', ')}
                  </div>
                </div>
                <Link
                  to={`/dashboard/property/${nextStep.apt.id}`}
                  className="shrink-0 inline-flex items-center gap-1.5 bg-[#c8a24e] text-[#16100d] px-3.5 py-2 rounded-[9px] text-[12.5px] font-semibold hover:bg-[#e7d6ad] transition-colors"
                >
                  Continue setup
                  <ArrowRight size={14} />
                </Link>
              </div>
            )}

            {/* Metrics */}
            <div className="grid grid-cols-3 gap-3.5 mb-8">
              {[
                { label: 'Properties', value: list.length, Icon: Building2 },
                { label: 'Bookings', value: bookingTotal, Icon: CalendarDays },
                { label: 'New messages', value: unread, Icon: MessageCircle },
              ].map(m => (
                <div key={m.label} className="bg-[#fffdf9] border border-[#e4ddd0] rounded-[13px] p-4">
                  <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-[9px] bg-[rgba(200,162,78,0.14)] text-[#a8842f]">
                    <m.Icon size={16} />
                  </div>
                  <div className="text-[26px] font-['Fraunces'] font-light text-[#231d17] leading-none">{m.value}</div>
                  <div className="text-[10px] uppercase tracking-[.08em] text-[#a79e8e] mt-1.5">{m.label}</div>
                </div>
              ))}
            </div>

            {/* Section label */}
            <div className="mb-3.5">
              <h2 className="text-[13px] font-semibold uppercase tracking-[.08em] text-[#a79e8e]">Your properties</h2>
              <p className="text-[12px] italic text-[#b3aa9b] mt-0.5">Each one gets its own branded guest page.</p>
            </div>

            {/* Property grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
              {list.map(apt => {
                const e = essentials(apt)
                const ready = e.met === e.total
                const accent = apt.accent_color || hostData?.accent_color || '#1c1c1a'
                const aptBookings = bookingCountByApt.get(apt.id) ?? 0
                return (
                  <div key={apt.id} className="flex flex-col bg-[#fffdf9] border border-[#e4ddd0] rounded-[14px] overflow-hidden">
                    {/* hero */}
                    <div className="relative h-24" style={apt.hero_image_url ? undefined : { backgroundColor: accent }}>
                      {apt.hero_image_url && (
                        <img src={resolveImageUrl(apt.hero_image_url)} alt="" className="h-full w-full object-cover" loading="lazy" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent" />
                      <span className="absolute top-2.5 left-2.5 flex h-7 w-7 items-center justify-center rounded-[8px] bg-black/35 text-white backdrop-blur-sm">
                        <QrCode size={14} />
                      </span>
                      <span className={`absolute top-2.5 right-2.5 text-[10px] font-medium px-2 py-0.5 rounded-full ${
                        apt.is_visible ? 'bg-[#eaf0dd] text-[#5d7c34]' : 'bg-[#ece7dc] text-[#8a8276]'
                      }`}>
                        {apt.is_visible ? 'Live' : 'Draft'}
                      </span>
                    </div>

                    {/* body */}
                    <div className="flex flex-1 flex-col p-4">
                      <div className="text-[14px] font-semibold text-[#231d17] truncate">{apt.name}</div>
                      {apt.neighborhood && (
                        <div className="mt-0.5 flex items-center gap-1 text-[12px] text-[#8a8276]">
                          <MapPin size={12} className="shrink-0" />
                          <span className="truncate">{apt.neighborhood}</span>
                        </div>
                      )}
                      {aptBookings > 0 && (
                        <div className="mt-1 text-[11px] text-[#b3aa9b]">{aptBookings} booking{aptBookings === 1 ? '' : 's'}</div>
                      )}

                      {/* readiness */}
                      <div className="mt-3.5">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className={ready ? 'font-medium text-[#5d7c34]' : 'text-[#8a8276]'}>
                            {ready ? 'Ready' : 'Setup'}
                          </span>
                          <span className={ready ? 'font-medium text-[#5d7c34]' : 'text-[#a79e8e]'}>{e.met}/{e.total}</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#ece7dc]">
                          <div
                            className={`h-full rounded-full ${ready ? 'bg-[#7c9d4a]' : 'bg-[#c8a24e]'}`}
                            style={{ width: `${(e.met / e.total) * 100}%` }}
                          />
                        </div>
                        {!apt.is_visible && e.missing.length > 0 && (
                          <div className="mt-1.5 text-[11px] text-[#b3aa9b] truncate">Needs {e.missing.join(', ')}</div>
                        )}
                      </div>

                      {/* actions pinned bottom */}
                      <div className="mt-auto pt-4 flex items-center gap-2">
                        {apt.is_visible ? (
                          <Link
                            to="/dashboard/qr"
                            className="flex-1 inline-flex items-center justify-center gap-1.5 bg-[#c8a24e] text-[#16100d] px-3 py-2 rounded-[9px] text-[12.5px] font-semibold hover:bg-[#e7d6ad] transition-colors"
                          >
                            <QrCode size={14} /> QR &amp; share
                          </Link>
                        ) : (
                          <Link
                            to={`/dashboard/property/${apt.id}`}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 bg-[#c8a24e] text-[#16100d] px-3 py-2 rounded-[9px] text-[12.5px] font-semibold hover:bg-[#e7d6ad] transition-colors"
                          >
                            Continue setup
                          </Link>
                        )}
                        <a
                          href={`/guest?apt=${apt.id}&preview=1`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center px-3 py-2 rounded-[9px] text-[12.5px] border border-[#e4ddd0] text-[#6b6354] hover:bg-[#f0ede6] transition-colors"
                        >
                          Preview
                        </a>
                        <CardMenu apt={apt} toggling={togglingId === apt.id} onToggle={() => void handleToggleVisibility(apt)} />
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Add property tile — or at-cap upgrade card */}
              {atCap ? (
                <div className="flex flex-col justify-center bg-[#fffdf9] border border-[#e4ddd0] rounded-[14px] p-5">
                  <div className="text-[13.5px] font-semibold text-[#231d17] mb-1.5">
                    You've reached your plan's limit{effectiveCap !== null ? ` (${list.length} of ${effectiveCap})` : ''}.
                  </div>
                  <p className="text-[12px] text-[#6b6354] leading-relaxed mb-3.5">
                    Want to bring the same guest experience to more of your properties? Upgrading takes
                    less than a minute.
                  </p>
                  <Link
                    to="/dashboard/billing"
                    className="inline-flex items-center gap-1.5 self-start bg-[#c8a24e] text-[#16100d] rounded-[10px] px-4 py-2.5 text-[12.5px] font-semibold hover:bg-[#e7d6ad] transition-colors"
                  >
                    Upgrade plan
                    <ArrowRight size={14} />
                  </Link>
                </div>
              ) : (
                <button
                  onClick={createProperty}
                  className="flex min-h-[232px] flex-col items-center justify-center gap-3 rounded-[14px] border border-dashed border-[#cfc7b6] text-center hover:bg-[#fffdf9] transition-colors cursor-pointer"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(200,162,78,0.14)] text-[#a8842f]">
                    <Plus size={20} />
                  </span>
                  <span className="text-[13px] font-medium text-[#8a8276]">Add another property</span>
                  {effectiveCap !== null && (
                    <span className="text-[11px] text-[#b3aa9b]">{list.length} of {effectiveCap} used</span>
                  )}
                </button>
              )}
            </div>

            {/* Coming soon */}
            <div className="mt-3.5 bg-[#fffdf9] border border-[#e4ddd0] rounded-[14px] p-4">
              <div className="text-[12.5px] font-semibold text-[#231d17] mb-0.5">Guest reviews · coming soon</div>
              <div className="text-[12px] text-[#8a8276] leading-relaxed">Collect UGC screenshots from guests and display them on your guest page.</div>
            </div>

            {TRIAL_FOOTER}
          </>
        )}
      </div>
    </div>
  )
}
