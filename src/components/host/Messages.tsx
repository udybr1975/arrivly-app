import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import { useToast } from '../shared/Toast'
import Loader from '../shared/Loader'
import { ARRIVLY_CONFIG } from '../../config'

interface RawMessage {
  id: string
  booking_id: string
  sender_role: 'guest' | 'host'
  body: string
  created_at: string
  read_at: string | null
}

interface ThreadMessage {
  id: string
  sender_role: 'guest' | 'host'
  body: string
  created_at: string
  read_at: string | null
}

interface BookingRow {
  id: string
  reference_number: string | null
  check_in: string
  check_out: string
  status: string
  source: string | null
  apartment_id: string
  guests: { first_name: string } | null
}

type Temporal = 'in-house' | 'past' | 'upcoming'

interface Conversation {
  bookingId: string
  aptId: string
  aptName: string
  guestName: string
  checkIn: string
  checkOut: string
  status: string
  source: string | null
  reference: string
  temporal: Temporal
  hasMessages: boolean
  lastBody: string | null
  lastAt: string | null
  lastSenderRole: 'guest' | 'host' | null
  unread: number
}

type Tab = 'open' | 'past' | 'all'

// ── Phase H chrome tokens (copied from BookingManager.tsx) ───────────────────
const INPUT = 'w-full bg-white border border-[#e0dacd] rounded-[10px] px-3.5 py-2.5 text-[13px] text-[#1c1c1a] placeholder:text-[#b3ab9b] focus:outline-none focus:border-[#c8a24e] focus:ring-2 focus:ring-[#c8a24e]/20 transition-colors'
const CARD = 'bg-[#fffdf9] border border-[#e4ddd0] rounded-[14px] p-5'
const BTN_SAVE = 'bg-[#c8a24e] text-[#16100d] px-5 py-2.5 rounded-[10px] text-xs font-semibold hover:bg-[#e7d6ad] transition-colors disabled:opacity-40 disabled:hover:bg-[#c8a24e]'

const PILL_BASE = 'px-3.5 py-1.5 rounded-[9px] text-xs font-medium transition-colors border'
function pill(active: boolean) {
  return `${PILL_BASE} ${active ? 'bg-[#1c1c1a] text-[#f0ede6] border-[#1c1c1a]' : 'bg-transparent border-[#e4ddd0] text-[#8a8276] hover:bg-[#f0ede6]'}`
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
  if (s.includes('airbnb')) return 'Airbnb'
  if (s.includes('vrbo')) return 'VRBO'
  if (s.includes('booking')) return 'Booking.com'
  if (s.includes('tripadvisor')) return 'TripAdvisor'
  if (s.includes('guesty')) return 'Guesty'
  if (s.includes('hostaway')) return 'Hostaway'
  if (s.includes('lodgify')) return 'Lodgify'
  return 'iCal'
}

// ── date / time helpers ──────────────────────────────────────────────────────
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function temporalStatus(checkIn: string, checkOut: string, today: string): Temporal {
  if (checkOut < today) return 'past'
  if (checkIn > today) return 'upcoming'
  return 'in-house'
}

function withinDays(iso: string | null, days: number): boolean {
  if (!iso) return false
  return Date.now() - new Date(iso).getTime() <= days * 86400000
}

// Needs the host's attention: an unread guest message, or the last message is from
// the guest (awaiting a reply).
function needsAttention(c: Conversation): boolean {
  return c.unread > 0 || (c.hasMessages && c.lastSenderRole === 'guest')
}

function StatusChip({ temporal }: { temporal: Temporal }) {
  if (temporal === 'in-house') {
    return <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-[#e4f0da] text-[#2a5c0a]">In-house</span>
  }
  if (temporal === 'past') {
    return <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-[#efece5] text-[#8a8276]">Checked out</span>
  }
  return <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-[#efece5] text-[#8a8276]">Upcoming</span>
}

export default function Messages() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [thread, setThread] = useState<ThreadMessage[]>([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list')
  const [tab, setTab] = useState<Tab>('open')
  const [aptFilter, setAptFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const threadBottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Tracks the most recent openThread call so stale in-flight fetches discard their results.
  const openThreadIdRef = useRef<string | null>(null)
  // Whether the next thread render should auto-scroll to the bottom. Set true when the
  // host opens a thread or sends; on a background poll it follows "was the host already
  // near the bottom" so a poll never yanks scroll away from history the host scrolled up to.
  const shouldScrollRef = useRef(true)
  // Signature of the currently-rendered thread (count + last id) so a background poll
  // can skip a no-op setThread (and the smooth-scroll it would trigger) when nothing changed.
  const threadSigRef = useRef('')

  function threadSig(msgs: { id: string }[]) {
    return `${msgs.length}:${msgs[msgs.length - 1]?.id ?? ''}`
  }

  function isNearBottom() {
    const el = scrollRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  const loadConversations = useCallback(async (signal?: { cancelled: boolean }, opts?: { silent?: boolean }) => {
    const todayHel = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' })

    // 1. Load messageable bookings (RLS scopes to host's own apartments). Hide
    //    soft-cancelled feed ghosts the same way BookingManager does.
    const { data: bookingRows, error: bookingsError } = await supabase
      .from('bookings')
      .select('id, reference_number, check_in, check_out, status, source, apartment_id, guests(first_name)')
      .not('reference_number', 'is', null)
      .neq('status', 'cancelled')
      .order('check_in', { ascending: false })
      .limit(200)

    if (signal?.cancelled) return

    if (bookingsError) {
      // Suppress the toast on background polls so a persistent failure can't fire
      // a toast every 25s; the initial/foreground load still surfaces it.
      if (!opts?.silent) toast('Could not load bookings', 'error')
      setLoading(false)
      return
    }

    const bookings = ((bookingRows ?? []) as unknown as BookingRow[])
      .filter(b => !isBlockSource(b.source)) // blocks are not guest conversations

    // 2. Load messages, newest first; build a map booking_id -> { latestMsg, unread }.
    const { data: msgRows } = await supabase
      .from('messages')
      .select('id, booking_id, sender_role, body, created_at, read_at')
      .order('created_at', { ascending: false })
      .limit(500)

    if (signal?.cancelled) return

    const messages = (msgRows ?? []) as unknown as RawMessage[]
    const msgMap = new Map<string, { latestMsg: RawMessage; unread: number }>()
    for (const m of messages) {
      const existing = msgMap.get(m.booking_id)
      if (!existing) {
        msgMap.set(m.booking_id, {
          latestMsg: m, // first seen = newest (rows are created_at desc)
          unread: m.sender_role === 'guest' && !m.read_at ? 1 : 0,
        })
      } else if (m.sender_role === 'guest' && !m.read_at) {
        existing.unread++
      }
    }

    // 3. Load apartment names.
    const aptIds = [...new Set(bookings.map(b => b.apartment_id))]
    const { data: aptRows } = aptIds.length > 0
      ? await supabase.from('apartments').select('id, name').in('id', aptIds)
      : { data: [] as { id: string; name: string }[] }

    if (signal?.cancelled) return
    const aptMap = new Map(((aptRows ?? []) as { id: string; name: string }[]).map(a => [a.id, a.name]))

    // 4. Build conversations from every messageable booking (visibility is decided per
    //    tab at render time; the full set also powers the hidden-upcoming count).
    const convs: Conversation[] = bookings.map(booking => {
      const g = msgMap.get(booking.id)
      return {
        bookingId: booking.id,
        aptId: booking.apartment_id,
        aptName: aptMap.get(booking.apartment_id) ?? 'Property',
        guestName: booking.guests?.first_name ?? 'Guest',
        checkIn: booking.check_in,
        checkOut: booking.check_out,
        status: booking.status,
        source: booking.source,
        reference: booking.reference_number ?? '',
        temporal: temporalStatus(booking.check_in, booking.check_out, todayHel),
        hasMessages: !!g,
        lastBody: g ? g.latestMsg.body : null,
        lastAt: g ? g.latestMsg.created_at : null,
        lastSenderRole: g ? g.latestMsg.sender_role : null,
        unread: g ? g.unread : 0,
      }
    })

    // Sort: attention-needed first, then in-house, then by last-message time descending.
    convs.sort((a, b) => {
      const rank = (c: Conversation) => (needsAttention(c) ? 0 : c.temporal === 'in-house' ? 1 : 2)
      const ra = rank(a), rb = rank(b)
      if (ra !== rb) return ra - rb
      if (a.lastAt && b.lastAt) return b.lastAt.localeCompare(a.lastAt)
      if (a.lastAt) return -1
      if (b.lastAt) return 1
      return 0
    })

    setConversations(convs)
    setLoading(false)
  }, [toast])

  // Light refresh of the currently-open thread for the background poll: re-pulls the
  // messages, marks newly-arrived guest messages read (the host is looking at it), and
  // does NOT touch the reply textarea or yank scroll if the host scrolled up.
  const refreshOpenThread = useCallback(async (bookingId: string, signal?: { cancelled: boolean }) => {
    const { data } = await supabase
      .from('messages')
      .select('id, sender_role, body, created_at, read_at')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: true })

    if (signal?.cancelled || openThreadIdRef.current !== bookingId) return

    const msgs = (data ?? []) as unknown as ThreadMessage[]
    const sig = threadSig(msgs)
    // Nothing new arrived — skip the re-render (and the scroll it would trigger).
    if (sig === threadSigRef.current) return
    threadSigRef.current = sig
    shouldScrollRef.current = isNearBottom()
    setThread(msgs)

    const hasUnread = msgs.some(m => m.sender_role === 'guest' && !m.read_at)
    if (!hasUnread) return

    const { error: markErr } = await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('booking_id', bookingId)
      .eq('sender_role', 'guest')
      .is('read_at', null)

    if (markErr) console.error('[Messages] mark-read failed —', markErr.message)
    if (signal?.cancelled || openThreadIdRef.current !== bookingId) return

    setConversations(prev => prev.map(c => c.bookingId === bookingId ? { ...c, unread: 0 } : c))
    window.dispatchEvent(new CustomEvent('arrivly:messages-read'))
  }, [])

  // Background poll: refresh the list, and if a thread is open, refresh it too. Runs
  // every 25s, plus on window focus and on becoming visible.
  const poll = useCallback(async (signal: { cancelled: boolean }) => {
    await loadConversations(signal, { silent: true })
    if (signal.cancelled) return
    if (openThreadIdRef.current) await refreshOpenThread(openThreadIdRef.current, signal)
  }, [loadConversations, refreshOpenThread])

  // Initial load.
  useEffect(() => {
    const signal = { cancelled: false }
    loadConversations(signal)
    return () => { signal.cancelled = true }
  }, [loadConversations])

  // Live polling — client-only, no realtime/websockets.
  useEffect(() => {
    const signal = { cancelled: false }
    const tick = () => poll(signal)
    const interval = setInterval(tick, 25000)
    const onFocus = () => tick()
    const onVisible = () => { if (document.visibilityState === 'visible') tick() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      signal.cancelled = true
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [poll])

  // Scroll to bottom only when flagged (open / send / poll-while-near-bottom).
  useEffect(() => {
    if (thread.length > 0 && shouldScrollRef.current) {
      threadBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [thread])

  async function openThread(bookingId: string) {
    openThreadIdRef.current = bookingId
    shouldScrollRef.current = true
    setSelectedId(bookingId)
    setMobileView('thread')
    setThreadLoading(true)
    setThread([])

    const { data } = await supabase
      .from('messages')
      .select('id, sender_role, body, created_at, read_at')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: true })

    if (openThreadIdRef.current !== bookingId) return

    const msgs = (data ?? []) as unknown as ThreadMessage[]
    threadSigRef.current = threadSig(msgs)
    setThread(msgs)
    setThreadLoading(false)

    // Only run the mark-read UPDATE + event when there's actually an unread guest
    // message, to avoid a needless write and a redundant BookingManager reload.
    const hasUnread = msgs.some(m => m.sender_role === 'guest' && !m.read_at)
    if (!hasUnread) return

    const { error: markErr } = await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('booking_id', bookingId)
      .eq('sender_role', 'guest')
      .is('read_at', null)

    if (markErr) console.error('[Messages] mark-read failed —', markErr.message)
    if (openThreadIdRef.current !== bookingId) return

    setConversations(prev => prev.map(c => c.bookingId === bookingId ? { ...c, unread: 0 } : c))
    window.dispatchEvent(new CustomEvent('arrivly:messages-read'))
  }

  async function sendReply() {
    const id = selectedId
    if (!id || !reply.trim() || sending) return
    setSending(true)
    try {
      const result = await api.post<{ messages: ThreadMessage[] }>('/host-message', {
        bookingId: id,
        body: reply,
      })
      shouldScrollRef.current = true
      threadSigRef.current = threadSig(result.messages)
      setThread(result.messages)
      setReply('')
      const last = result.messages[result.messages.length - 1]
      if (last) {
        setConversations(prev =>
          prev.map(c =>
            c.bookingId === id
              ? { ...c, hasMessages: true, lastBody: last.body, lastAt: last.created_at, lastSenderRole: last.sender_role }
              : c
          )
        )
      }
    } catch {
      toast('Could not send message', 'error')
    } finally {
      setSending(false)
    }
  }

  if (loading) return <Loader />

  const q = search.trim().toLowerCase()

  // Distinct properties among the loaded conversations (drives the dropdown).
  const propMap = new Map<string, string>()
  for (const c of conversations) propMap.set(c.aptId, c.aptName)
  const properties = [...propMap.entries()]

  function passesScope(c: Conversation): boolean {
    if (aptFilter !== 'all' && c.aptId !== aptFilter) return false
    if (q && !c.guestName.toLowerCase().includes(q)) return false
    return true
  }

  function inTab(c: Conversation, t: Tab): boolean {
    if (t === 'open') return c.temporal === 'in-house' || c.unread > 0 || withinDays(c.lastAt, 14)
    if (t === 'past') return c.temporal === 'past' && c.hasMessages
    return c.hasMessages || c.temporal === 'in-house' // 'all'
  }

  const visible = conversations.filter(c => passesScope(c) && inTab(c, tab))
  const openCount = conversations.filter(c => passesScope(c) && inTab(c, 'open')).length

  // Upcoming bookings with no messages, hidden from every tab (respects property filter).
  const hiddenUpcoming = conversations.filter(c =>
    c.temporal === 'upcoming' && !c.hasMessages && (aptFilter === 'all' || c.aptId === aptFilter)
  ).length

  // Shown on the Open tab (no active search) — incl. when the list is otherwise empty.
  const hiddenNote = tab === 'open' && !q && hiddenUpcoming > 0 ? (
    <div className="border border-dashed border-[#e4ddd0] rounded-[12px] px-4 py-3 text-[11px] text-[#a79e8e] text-center leading-snug">
      {hiddenUpcoming} upcoming bookings with no messages are hidden — they'll appear here once a guest checks in and writes.
    </div>
  ) : null

  const selected = conversations.find(c => c.bookingId === selectedId)

  return (
    <div className="flex gap-4 max-w-5xl font-['Inter']">

      {/* Conversation list — hidden on mobile when thread is open */}
      <div className={`${mobileView === 'thread' ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[300px] md:shrink-0`}>
        <h1 className="text-[22px] font-['Fraunces'] font-light text-[#231d17] mb-3">Messages</h1>

        {/* Tabs */}
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => setTab('open')} className={`${pill(tab === 'open')} inline-flex items-center gap-1.5`}>
            Open
            {openCount > 0 && (
              <span className="bg-[#c8a24e] text-[#16100d] text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 inline-flex items-center justify-center">
                {openCount}
              </span>
            )}
          </button>
          <button onClick={() => setTab('past')} className={pill(tab === 'past')}>Past</button>
          <button onClick={() => setTab('all')} className={pill(tab === 'all')}>All</button>
        </div>

        {/* Property + search filters */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {properties.length > 1 && (
            <select
              value={aptFilter}
              onChange={e => setAptFilter(e.target.value)}
              className="bg-white border border-[#e0dacd] rounded-[10px] px-3 py-2 text-[13px] text-[#1c1c1a] focus:outline-none focus:border-[#c8a24e]"
            >
              <option value="all">All properties</option>
              {properties.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search guest name"
            className={`${INPUT} !w-auto flex-1 min-w-[140px]`}
          />
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col gap-2">
            <div className={`${CARD} text-center`}>
              <div className="text-[#cdc6b8] text-3xl mb-2">💬</div>
              <div className="text-[12px] text-[#8a8276]">
                {tab === 'open'
                  ? 'No open conversations right now.'
                  : tab === 'past'
                    ? 'No past conversations.'
                    : 'No conversations yet.'}
              </div>
            </div>
            {hiddenNote}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map(c => {
              const attention = needsAttention(c)
              return (
                <button
                  key={c.bookingId}
                  onClick={() => openThread(c.bookingId)}
                  className={`w-full text-left border rounded-[12px] px-3.5 py-3 transition-colors ${
                    selectedId === c.bookingId
                      ? 'border-[#1c1c1a]'
                      : 'border-[#e4ddd0] hover:border-[#cdc6b8]'
                  } ${c.unread > 0 ? 'bg-[#fffaf0]' : 'bg-[#fffdf9]'}`}
                  style={{ borderLeft: `3px solid ${sourceColor(c.source)}` }}
                >
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[13px] font-semibold shrink-0"
                      style={{ backgroundColor: sourceColor(c.source) }}
                    >
                      {c.guestName.charAt(0).toUpperCase()}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-[#231d17] truncate">{c.guestName}</span>
                        <div className="ml-auto shrink-0">
                          {c.unread > 0 ? (
                            <span className="bg-[#1c1c1a] text-[#f0ede6] text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 inline-flex items-center justify-center">
                              {c.unread}
                            </span>
                          ) : c.lastAt ? (
                            <span className="text-[10px] text-[#a79e8e] whitespace-nowrap">{fmtDate(c.lastAt)}</span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <StatusChip temporal={c.temporal} />
                        {attention && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-[#f7eccf] text-[#7a5a14]">
                            Awaiting reply
                          </span>
                        )}
                      </div>

                      <div className="text-[10px] text-[#a79e8e] mt-1 truncate">
                        {c.aptName} · {fmtDate(c.checkIn)} – {fmtDate(c.checkOut)} · {sourceLabel(c.source)}
                      </div>

                      <div className="text-[11px] mt-1 truncate leading-snug">
                        {!c.hasMessages ? (
                          <span className="text-[#b3aa9b] italic">No messages yet — start the chat</span>
                        ) : c.lastSenderRole === 'host' ? (
                          <span className="text-[#8a8276]"><span className="font-semibold text-[#a79e8e]">You:</span> {c.lastBody}</span>
                        ) : (
                          <span className="text-[#8a8276]">{c.lastBody}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}

            {/* Hidden-upcoming hint — Open tab, no active search only */}
            {hiddenNote}
          </div>
        )}
      </div>

      {/* Thread panel — hidden on mobile when list is shown */}
      <div className={`${mobileView === 'list' ? 'hidden md:flex' : 'flex'} flex-col flex-1 min-w-0`}>
        {!selectedId ? (
          <div className={`${CARD} flex items-center justify-center min-h-[300px]`}>
            <div className="text-center">
              <div className="text-[#cdc6b8] text-3xl mb-2">✉️</div>
              <div className="text-[12px] text-[#8a8276]">Select a conversation to read and reply.</div>
            </div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="flex items-start gap-3 mb-3">
              <button
                onClick={() => {
                  // Closing the thread on mobile must clear the open-thread pointer, or the
                  // 25s poll keeps marking that booking's new guest messages read while the
                  // host is back on the list — its unread badge would never reappear.
                  openThreadIdRef.current = null
                  threadSigRef.current = ''
                  setSelectedId(null)
                  setThread([])
                  setMobileView('list')
                }}
                className="md:hidden text-[11px] text-[#8a8276] hover:text-[#231d17] transition-colors shrink-0 mt-1"
              >
                ← Back
              </button>
              {selected && (
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[16px] font-['Fraunces'] font-light text-[#231d17] truncate">{selected.guestName}</span>
                    <StatusChip temporal={selected.temporal} />
                  </div>
                  <div className="text-[10px] text-[#a79e8e] truncate mt-0.5">
                    {selected.aptName} · {fmtDate(selected.checkIn)} – {fmtDate(selected.checkOut)}
                    {selected.reference && <span className="ml-1.5 font-mono">{selected.reference}</span>}
                  </div>
                </div>
              )}
              {selected && selected.temporal === 'in-house' && selected.reference && (
                <a
                  href={`${ARRIVLY_CONFIG.appUrl}/guest?apt=${selected.aptId}&token=${selected.reference}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-[10px] bg-[#eaf0dd] text-[#5d7c34] px-2.5 py-1 rounded-[8px] font-medium no-underline hover:bg-[#dde7c8] transition-colors"
                >
                  Open guest page ↗
                </a>
              )}
            </div>

            {/* Bubble area */}
            <div
              ref={scrollRef}
              className="bg-[#fffdf9] border border-[#e4ddd0] rounded-[14px] p-4 overflow-y-auto flex flex-col gap-2 min-h-[280px] max-h-[55vh] mb-3"
            >
              {threadLoading ? (
                <div className="flex-1 flex items-center justify-center text-[12px] text-[#a79e8e]">Loading…</div>
              ) : thread.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-[12px] text-[#a79e8e]">No messages yet — send the first message below.</div>
              ) : (
                <>
                  {thread.map((m, i) => {
                    const prev = thread[i - 1]
                    const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
                    return (
                      <div key={m.id}>
                        {newDay && (
                          <div className="flex justify-center my-2">
                            <span className="text-[9px] uppercase tracking-[.08em] text-[#a79e8e] bg-[#f4f1ea] border border-[#e4ddd0] rounded-full px-2.5 py-0.5">
                              {dayLabel(m.created_at)}
                            </span>
                          </div>
                        )}
                        <div className={`flex ${m.sender_role === 'host' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[75%] rounded-[10px] px-3 py-2 ${
                            m.sender_role === 'host'
                              ? 'bg-[#1c1c1a] text-[#f0ede6]'
                              : 'bg-[#f4f1ea] border border-[#e4ddd0] text-[#231d17]'
                          }`}>
                            <div className="text-[12px] leading-relaxed whitespace-pre-wrap">{m.body}</div>
                            <div className={`text-[9px] mt-1 ${m.sender_role === 'host' ? 'text-[#f0ede6]/50' : 'text-[#a79e8e]'}`}>
                              {fmtTime(m.created_at)}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  <div ref={threadBottomRef} />
                </>
              )}
            </div>

            {/* Reply box */}
            <div>
              <div className="bg-[#fffdf9] border border-[#e4ddd0] rounded-[14px] p-3 flex gap-2 items-end">
                <textarea
                  value={reply}
                  onChange={e => setReply(e.target.value.slice(0, 2000))}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      sendReply()
                    }
                  }}
                  rows={2}
                  placeholder="Type a reply…"
                  className="flex-1 bg-white border border-[#e0dacd] rounded-[10px] px-3 py-2 text-[13px] text-[#1c1c1a] placeholder:text-[#b3ab9b] focus:outline-none focus:border-[#c8a24e] focus:ring-2 focus:ring-[#c8a24e]/20 transition-colors resize-none"
                />
                <button onClick={sendReply} disabled={sending || !reply.trim()} className={BTN_SAVE}>
                  {sending ? '…' : 'Send'}
                </button>
              </div>
              <div className="text-[10px] text-[#a79e8e] mt-1.5 pl-1">⌘ / Ctrl + Enter to send</div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
