import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import { useToast } from '../shared/Toast'
import Loader from '../shared/Loader'

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
  apartment_id: string
  guests: { first_name: string } | null
}

interface Conversation {
  bookingId: string
  aptName: string
  guestName: string
  checkIn: string
  checkOut: string
  status: string
  reference: string
  lastBody: string | null
  lastAt: string | null
  unread: number
}

const BTN_DARK = 'bg-[#1a1a1a] text-white px-3 py-1.5 rounded-[7px] text-xs font-semibold hover:opacity-80 transition-opacity disabled:opacity-40'

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
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
  const threadBottomRef = useRef<HTMLDivElement>(null)
  // Tracks the most recent openThread call so stale in-flight fetches discard their results
  const openThreadIdRef = useRef<string | null>(null)

  const loadConversations = useCallback(async () => {
    const todayHel = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' })

    // 1. Load messageable bookings (RLS scopes to host's own apartments)
    const { data: bookingRows, error: bookingsError } = await supabase
      .from('bookings')
      .select('id, reference_number, check_in, check_out, status, apartment_id, guests(first_name)')
      .not('reference_number', 'is', null)
      .order('check_in', { ascending: false })
      .limit(200)

    if (bookingsError) {
      toast('Could not load bookings', 'error')
      setLoading(false)
      return
    }

    const bookings = (bookingRows ?? []) as unknown as BookingRow[]

    // 2. Load messages, newest first; build a map booking_id -> { latestMsg, unread }
    const { data: msgRows } = await supabase
      .from('messages')
      .select('id, booking_id, sender_role, body, created_at, read_at')
      .order('created_at', { ascending: false })
      .limit(500)

    const messages = (msgRows ?? []) as unknown as RawMessage[]
    const msgMap = new Map<string, { latestMsg: RawMessage; unread: number }>()
    for (const m of messages) {
      const existing = msgMap.get(m.booking_id)
      if (!existing) {
        msgMap.set(m.booking_id, {
          latestMsg: m,
          unread: m.sender_role === 'guest' && !m.read_at ? 1 : 0,
        })
      } else {
        if (m.sender_role === 'guest' && !m.read_at) existing.unread++
      }
    }

    // 3. Load apartment names
    const aptIds = [...new Set(bookings.map(b => b.apartment_id))]
    const { data: aptRows } = aptIds.length > 0
      ? await supabase.from('apartments').select('id, name').in('id', aptIds)
      : { data: [] as { id: string; name: string }[] }
    const aptMap = new Map(((aptRows ?? []) as { id: string; name: string }[]).map(a => [a.id, a.name]))

    // 4. Build conversations from bookings — hide long-past empty bookings
    const convs: Conversation[] = []
    for (const booking of bookings) {
      const g = msgMap.get(booking.id)
      const checkoutOk = booking.check_out >= todayHel
      if (!g && !checkoutOk) continue

      convs.push({
        bookingId: booking.id,
        aptName: aptMap.get(booking.apartment_id) ?? 'Property',
        guestName: booking.guests?.first_name ?? 'Guest',
        checkIn: booking.check_in,
        checkOut: booking.check_out,
        status: booking.status,
        reference: booking.reference_number ?? '',
        lastBody: g ? g.latestMsg.body : null,
        lastAt: g ? g.latestMsg.created_at : null,
        unread: g ? g.unread : 0,
      })
    }

    // 5. Two-tier sort: messaged conversations newest-first, then unmessaged by checkIn asc
    const withMsgs = convs.filter(c => c.lastAt !== null)
      .sort((a, b) => b.lastAt!.localeCompare(a.lastAt!))
    const withoutMsgs = convs.filter(c => c.lastAt === null)
      .sort((a, b) => a.checkIn.localeCompare(b.checkIn))

    setConversations([...withMsgs, ...withoutMsgs])
    setLoading(false)
  }, [toast])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  // Scroll to bottom whenever thread updates
  useEffect(() => {
    if (thread.length > 0) {
      threadBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [thread])

  async function openThread(bookingId: string) {
    openThreadIdRef.current = bookingId
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

    setThread((data ?? []) as unknown as ThreadMessage[])
    setThreadLoading(false)

    // Mark unread guest messages as read
    const { error: markErr } = await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('booking_id', bookingId)
      .eq('sender_role', 'guest')
      .is('read_at', null)

    if (markErr) console.error('[Messages] mark-read failed —', markErr.message)

    if (openThreadIdRef.current !== bookingId) return

    setConversations(prev =>
      prev.map(c => c.bookingId === bookingId ? { ...c, unread: 0 } : c)
    )
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
      setThread(result.messages)
      setReply('')
      const last = result.messages[result.messages.length - 1]
      if (last) {
        setConversations(prev =>
          prev.map(c =>
            c.bookingId === id
              ? { ...c, lastBody: last.body, lastAt: last.created_at }
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

  const selected = conversations.find(c => c.bookingId === selectedId)

  return (
    <div className="flex gap-4 max-w-5xl">

      {/* Conversation list — hidden on mobile when thread is open */}
      <div className={`${mobileView === 'thread' ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[260px] md:shrink-0`}>
        <h1 className="text-[17px] font-serif font-light text-[#1a1a1a] mb-3">Messages</h1>

        {conversations.length === 0 ? (
          <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-8 text-center">
            <div className="text-[#ccc] text-3xl mb-2">💬</div>
            <div className="text-[12px] text-[#aaa]">No current or upcoming guests yet.</div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {conversations.map(c => (
              <button
                key={c.bookingId}
                onClick={() => openThread(c.bookingId)}
                className={`w-full text-left bg-white border rounded-[10px] px-4 py-3 transition-colors ${
                  selectedId === c.bookingId
                    ? 'border-[#1a1a1a] shadow-[0_1px_3px_rgba(0,0,0,.08)]'
                    : 'border-[#ddd8ce] hover:border-[#bbb8b0]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[12px] font-semibold text-[#1a1a1a] truncate">{c.guestName}</span>
                      {c.unread > 0 && (
                        <span className="shrink-0 bg-[#1a1a1a] text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                          {c.unread}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-[#999] mb-1 truncate">
                      {c.aptName} · {fmtDate(c.checkIn)} – {fmtDate(c.checkOut)}
                    </div>
                    {c.lastBody !== null ? (
                      <div className="text-[11px] text-[#888] truncate leading-snug">{c.lastBody}</div>
                    ) : (
                      <div className="text-[11px] text-[#bbb] italic leading-snug">No messages yet — tap to start</div>
                    )}
                  </div>
                  {c.lastAt !== null && (
                    <div className="text-[9px] text-[#bbb] whitespace-nowrap shrink-0 mt-0.5">
                      {fmtTime(c.lastAt)}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Thread panel — hidden on mobile when list is shown */}
      <div className={`${mobileView === 'list' ? 'hidden md:flex' : 'flex'} flex-col flex-1 min-w-0`}>
        {!selectedId ? (
          <div className="flex items-center justify-center bg-white border border-[#ddd8ce] rounded-[10px] p-8 min-h-[300px]">
            <div className="text-[12px] text-[#aaa]">Select a conversation</div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="flex items-center gap-3 mb-3">
              <button
                onClick={() => setMobileView('list')}
                className="md:hidden text-[11px] text-[#888] hover:text-[#1a1a1a] transition-colors shrink-0"
              >
                ← Back
              </button>
              {selected && (
                <div className="min-w-0">
                  <div className="text-[15px] font-serif font-light text-[#1a1a1a] truncate">{selected.guestName}</div>
                  <div className="text-[10px] text-[#999] truncate">
                    {selected.aptName} · {fmtDate(selected.checkIn)} – {fmtDate(selected.checkOut)}
                  </div>
                  <div className="text-[10px] text-[#bbb] truncate capitalize">
                    {selected.status} · {selected.reference}
                  </div>
                </div>
              )}
            </div>

            {/* Bubble area */}
            <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 overflow-y-auto flex flex-col gap-2 min-h-[280px] max-h-[55vh] mb-3">
              {threadLoading ? (
                <div className="flex-1 flex items-center justify-center text-[12px] text-[#aaa]">Loading…</div>
              ) : thread.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-[12px] text-[#aaa]">No messages yet — send the first message below.</div>
              ) : (
                <>
                  {thread.map(m => (
                    <div key={m.id} className={`flex ${m.sender_role === 'host' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-[8px] px-3 py-2 ${
                        m.sender_role === 'host'
                          ? 'bg-[#1a1a1a] text-white'
                          : 'bg-[#f8f6f2] border border-[#ddd8ce] text-[#1a1a1a]'
                      }`}>
                        <div className="text-[12px] leading-relaxed whitespace-pre-wrap">{m.body}</div>
                        <div className={`text-[9px] mt-1 ${m.sender_role === 'host' ? 'text-white/50' : 'text-[#bbb]'}`}>
                          {fmtTime(m.created_at)}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={threadBottomRef} />
                </>
              )}
            </div>

            {/* Reply box */}
            <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-3 flex gap-2 items-end">
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
                className="flex-1 bg-[#f8f6f2] border border-[#ddd8ce] rounded-[8px] px-3 py-2 text-xs text-[#444] focus:outline-none focus:border-[#1a1a1a] transition-colors resize-none"
              />
              <button
                onClick={sendReply}
                disabled={sending || !reply.trim()}
                className={BTN_DARK}
              >
                {sending ? '…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
