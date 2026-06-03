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
    { role: 'assistant', text: `Hi${guestName ? ' ' + guestName : ''} — I'm your assistant for this stay. Ask me about the apartment, ${city}, or anything you need.` },
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const reply = (data.reply || '').trim()
      if (!reply) throw new Error('empty')
      setMsgs(p => [...p, { role: 'assistant', text: reply }])
    } catch {
      setMsgs(p => [...p, { role: 'assistant', text: 'Sorry — I had a connection hiccup. Could you try that again?' }])
    } finally {
      setLoading(false)
    }
  }

  const showStarters = !loading

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3">
        {msgs.map((m, i) => (
          <div
            key={i}
            className={m.role === 'user'
              ? 'ml-auto max-w-[80%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm text-white'
              : 'mr-auto max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm bg-[#faf9f6] border border-gray-100 text-[#1c1c1a]'}
            style={m.role === 'user' ? { background: accentColor } : undefined}
          >
            <p className="whitespace-pre-line leading-relaxed break-words">{m.text}</p>
          </div>
        ))}
        {loading && (
          <div className="mr-auto flex items-center gap-2 text-gray-400 text-xs italic px-1">
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

      <div className="border-t border-gray-100 px-4 py-3 flex items-center gap-2 bg-white">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') sendMessage(input) }}
          placeholder={`Ask ${brandName}…`}
          className="flex-1 bg-[#faf9f6] border border-gray-200 rounded-full px-4 py-2.5 text-sm outline-none focus:border-gray-400"
        />
        <button onClick={() => sendMessage(input)} disabled={loading || !input.trim()} aria-label="Send" className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white border-none cursor-pointer disabled:opacity-40" style={{ background: accentColor }}>
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}
