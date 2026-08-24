import { useState, useRef, useEffect } from 'react'
import { Send, RefreshCw } from 'lucide-react'

interface Msg { role: 'user' | 'assistant'; text: string }
interface Props {
  apartmentId: string
  token: string
  accentColor: string
  brandName: string
  guestName: string | null
  city: string
}

const STARTERS = ['How does check-in work?', "What's the Wi-Fi?", 'Good food nearby', 'Getting around']

export default function ChatBot({ apartmentId, token, accentColor, brandName, guestName, city }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([
    // Says plainly what it is, in the guest's first line of contact. The header label is the
    // PERSISTENT disclosure; this is the plain-language one. Both are required, not either/or.
    { role: 'assistant', text: `Hi${guestName ? ' ' + guestName : ''} — I'm an AI assistant for this stay. I know this apartment${city ? ' and ' + city : ''}, so ask me anything. To reach a person, use Message host.` },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, loading])

  const sendMessage = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return
    setInput('')
    const history = msgs
      .filter((m, i) => !(i === 0 && m.role === 'assistant')) // drop the seeded greeting
      .map(m => ({ role: m.role, text: m.text }))
    setMsgs(p => [...p, { role: 'user', text: trimmed }])
    setLoading(true)
    try {
      const res = await fetch('/api/guest-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apartmentId, token, message: trimmed, history }),
      })
      if (res.status === 429) { setMsgs(p => [...p, { role: 'assistant', text: "You're sending messages quickly — give it a moment, then try again." }]); return }
      if (res.status === 403) { setMsgs(p => [...p, { role: 'assistant', text: "I can help once your stay is confirmed — please scan your check-in QR code to start." }]); return }
      if (res.status === 500) { setMsgs(p => [...p, { role: 'assistant', text: "I'm getting a lot of questions right now — please try again in a moment." }]); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const reply = (data.reply || '').trim()
      if (!reply) throw new Error('empty')
      setMsgs(p => [...p, { role: 'assistant', text: reply }])
    } catch {
      setMsgs(p => [...p, { role: 'assistant', text: 'Something went wrong on my end — please try again in a moment.' }])
    } finally {
      setLoading(false)
    }
  }

  const showStarters = !loading

  return (
    <div className="flex flex-col h-full bg-[#fbfaf7]">
      <div className="shrink-0 px-5 py-3.5 text-white flex items-center gap-3" style={{ background: accentColor }}>
        <span className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">{brandName.charAt(0)}</span>
        <div>
          {/* EU AI ACT ART. 50 TRANSPARENCY. Persistent, always visible while chatting, not
              dismissible, and NOT delegated to a first chat message — a message scrolls away and
              a returning guest never sees it. It also REPLACES the old "Ask your host" eyebrow,
              which was the real problem: it told the guest they were talking to a person.
              THE BOUNDARY: this label lives in ChatBot.tsx and nowhere else. MessageHost.tsx is
              HUMAN messaging and renders its OWN separate header — the two surfaces do not share
              a header component, so there is no prop to mis-set and no path by which this label
              can reach the human thread. If the headers are ever unified, this MUST become an
              explicit prop defaulting to OFF.
              INCOMPLETE, AND SAID HERE RATHER THAN ONLY IN A COMMIT MESSAGE: this is ONE of TWO
              guest-facing AI chats. WelcomePage's pre-arrival concierge (/api/welcome-chat) is
              the other, and its eyebrow still reads "Ask {brandName}" — the exact construction
              removed here for implying a human. It is the surface a guest holds for WEEKS before
              arrival. Deferred to its own commit only because that file was outside this change's
              scope; the obligation attaches to every AI surface, so the fix is a site
              ENUMERATION, not an edit to whichever surface you happen to be in. */}
          {/* INK ON CREAM, NOT white-on-accent at 70% opacity. `accentColor` is any host-typed
              hex (PropertySetup validates only /^#[0-9a-fA-F]{6}$/), so white-on-accent has NO
              verifiable ratio — MessageHost's close control in this same change measures white
              on a pale accent at 1.44:1. A DISCLOSURE WHOSE VISIBILITY DEPENDS ON A COLOUR
              PICKER IS NOT "PERSISTENT, ALWAYS VISIBLE", which is the whole obligation. Ink
              #231d17 on cream #fffdf9 is 16.41:1 whatever the host picks. The brand line below
              stays white-on-accent — it is decoration, not the obligation. */}
          <span className="inline-block mb-1 px-1.5 py-0.5 rounded bg-[#fffdf9] text-[#231d17] text-[10px] tracking-[0.16em] uppercase font-semibold leading-none">AI assistant</span>
          <p className="text-sm font-medium leading-none">{brandName}</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3">
        {msgs.map((m, i) => (
          <div
            key={i}
            className={m.role === 'user'
              ? 'ml-auto max-w-[80%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm text-white'
              : 'mr-auto max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm bg-[#fffdf9] border border-[#e9e4d9] text-[#1c1c1a]'}
            style={m.role === 'user' ? { background: accentColor } : undefined}
          >
            <p className="whitespace-pre-line leading-relaxed break-words">{m.text}</p>
          </div>
        ))}
        {loading && (
          <div className="mr-auto flex items-center gap-2 text-[#9a958c] text-xs italic px-1">
            <RefreshCw size={12} className="animate-spin" /> Thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {showStarters && (
        <div className="px-5 pb-2 flex flex-wrap gap-2">
          {STARTERS.map(s => (
            <button key={s} onClick={() => sendMessage(s)} className="text-xs px-3 py-1.5 rounded-full border bg-transparent cursor-pointer" style={{ borderColor: `${accentColor}55`, color: accentColor }}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="border-t border-[#e9e4d9] px-4 py-3 flex items-center gap-2 bg-[#fffdf9]">
        {/* Placeholder is NOT `Ask ${brandName}…` — that is the same implies-a-human
            construction the header eyebrow was changed away from; leaving it would have made
            the file contradict its own Art. 50 comment. */}
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') sendMessage(input) }}
          placeholder="Ask about your stay…"
          className="flex-1 bg-[#fbfaf7] border border-[#e9e4d9] rounded-full px-4 py-2.5 text-sm outline-none focus:border-[#9a958c]"
        />
        <button onClick={() => sendMessage(input)} disabled={loading || !input.trim()} aria-label="Send" className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white border-none cursor-pointer disabled:opacity-40" style={{ background: accentColor }}>
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}
