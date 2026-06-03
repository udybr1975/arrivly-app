import { useState, useEffect } from 'react'
import { ARRIVLY_CONFIG } from '../../config'

interface Props {
  apartmentId: string
  city: string
  accentColor: string
  brandName: string
  isOnTrial: boolean
  onClose: () => void
}
interface EventItem { title: string; venue: string; date: string; desc: string; price: string }
interface EventCategory { name: string; events: EventItem[] }
interface EventsData { week: string; categories: EventCategory[] }

export default function EventsPage({ apartmentId, city, accentColor, brandName, isOnTrial, onClose }: Props) {
  const [events, setEvents] = useState<EventsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const loadEvents = async () => {
    setLoading(true); setError(false); setEvents(null)
    const MAX_RETRIES = 3
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 1) await new Promise(r => setTimeout(r, attempt * 3000))
        const res = await fetch('/api/city-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apartmentId }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (data.error) throw new Error('api error')
        setEvents(data as EventsData); setLoading(false); return
      } catch { /* retry */ }
    }
    setError(true); setLoading(false)
  }

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true); setError(false); setEvents(null)
      const MAX_RETRIES = 3
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          if (attempt > 1) await new Promise(r => setTimeout(r, attempt * 3000))
          if (cancelled) return
          const res = await fetch('/api/city-events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apartmentId }),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = await res.json()
          if (data.error) throw new Error('api error')
          if (!cancelled) { setEvents(data as EventsData); setLoading(false) }
          return
        } catch { /* retry */ }
      }
      if (!cancelled) { setError(true); setLoading(false) }
    }
    run()
    return () => { cancelled = true }
  }, [apartmentId])

  const hasEvents = events?.categories?.some(c => (c.events?.length ?? 0) > 0)

  return (
    <div className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl shadow-2xl relative p-7 md:p-9" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-5 right-5 text-gray-300 hover:text-[#1c1c1a] text-2xl leading-none bg-transparent border-none cursor-pointer">✕</button>

        <header className="mb-8">
          <p className="text-[10px] tracking-[0.2em] uppercase font-semibold mb-1.5" style={{ color: accentColor }}>What's on</p>
          <h2 className="text-2xl font-light text-[#1c1c1a]">This week in {city}</h2>
        </header>

        {loading && (
          <div className="py-16 text-center flex flex-col items-center">
            <div className="w-9 h-9 border-2 border-gray-100 rounded-full animate-spin mb-4" style={{ borderTopColor: accentColor }} />
            <p className="text-sm text-gray-500 italic">Finding what's on in {city}…</p>
          </div>
        )}

        {error && (
          <div className="py-14 text-center flex flex-col items-center gap-5">
            <div className="w-14 h-14 rounded-full bg-[#faf9f6] flex items-center justify-center text-2xl">🗓</div>
            <div>
              <p className="text-lg font-medium text-[#1c1c1a] mb-1">Back soon</p>
              <p className="text-sm text-gray-500 leading-relaxed max-w-xs mx-auto">This week's events couldn't load right now. Try again in a little while.</p>
            </div>
            <button onClick={loadEvents} className="text-[10px] tracking-widest uppercase px-5 py-2.5 bg-transparent cursor-pointer" style={{ border: `1px solid ${accentColor}`, color: accentColor }}>Try again</button>
          </div>
        )}

        {!loading && !error && events && (
          <div className="space-y-8">
            <p className="text-xs text-gray-400 border-b border-gray-100 pb-4">{events.week}</p>
            {!hasEvents && (
              <p className="text-sm text-gray-500 italic py-6 text-center">No major events found for this week — a good time to explore the neighbourhood picks.</p>
            )}
            {events.categories?.map((cat, i) => (
              cat.events && cat.events.length > 0 ? (
                <section key={i}>
                  {cat.name && cat.name !== 'This week' && (
                    <h3 className="text-base font-medium text-[#1c1c1a] mb-4 flex items-center gap-3">{cat.name}<span className="h-px flex-1 bg-gray-100" /></h3>
                  )}
                  <div className="space-y-3">
                    {cat.events.map((ev, j) => (
                      <div key={j} className="bg-[#faf9f6] border border-gray-100 rounded-lg p-4">
                        <div className="flex justify-between items-start gap-3 mb-1.5">
                          <h4 className="font-medium text-[#1c1c1a]">{ev.title}</h4>
                          {ev.price && <span className="text-[10px] text-white px-2 py-0.5 rounded uppercase tracking-wide shrink-0" style={{ background: accentColor }}>{ev.price}</span>}
                        </div>
                        {(ev.venue || ev.date) && (
                          <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: accentColor }}>{[ev.venue, ev.date].filter(Boolean).join(' — ')}</p>
                        )}
                        {ev.desc && <p className="text-sm text-gray-600 leading-relaxed">{ev.desc}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null
            ))}
            <footer className="pt-6 text-center">
              <p className="text-[10px] text-gray-300 uppercase tracking-widest">{isOnTrial ? ARRIVLY_CONFIG.poweredByText : `Curated for ${brandName}`}</p>
            </footer>
          </div>
        )}
      </div>
    </div>
  )
}
