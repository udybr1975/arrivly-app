import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { useLocation } from 'react-router-dom'
import { X, ChevronLeft, ChevronUp, ChevronDown, Send } from 'lucide-react'
import {
  GUIDE_CATEGORIES,
  GUIDE_MODULES,
  moduleForPath,
  type GuideModule,
} from '../../guide/content'
import { api } from '../../lib/api'

type Props = {
  open: boolean
  onClose: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
  requestedModuleId?: string | null
}

// ── tiny inline markdown renderer ────────────────────────────────────────────
// Handles the subset the Guide content uses: ### headings, > blockquotes,
// - bullet lists (one nesting level), paragraphs, and inline **bold** / *italic* /
// `code`. Deliberately small — no markdown dependency added.

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let buf = ''
  let i = 0
  let k = 0
  const flush = () => {
    if (buf) {
      nodes.push(buf)
      buf = ''
    }
  }
  while (i < text.length) {
    const c = text[i]
    if (c === '`') {
      const end = text.indexOf('`', i + 1)
      if (end !== -1) {
        flush()
        nodes.push(
          <code
            key={`${keyPrefix}-c${k++}`}
            className="px-1 py-0.5 rounded bg-[#f0ece3] text-[#231d17] text-[12px] font-mono"
          >
            {text.slice(i + 1, end)}
          </code>,
        )
        i = end + 1
        continue
      }
    }
    if (c === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2)
      if (end !== -1) {
        flush()
        nodes.push(
          <strong key={`${keyPrefix}-b${k++}`} className="font-semibold text-[#231d17]">
            {text.slice(i + 2, end)}
          </strong>,
        )
        i = end + 2
        continue
      }
    }
    if (c === '*') {
      const end = text.indexOf('*', i + 1)
      if (end !== -1) {
        flush()
        nodes.push(
          <em key={`${keyPrefix}-i${k++}`} className="italic text-[#5b5853]">
            {text.slice(i + 1, end)}
          </em>,
        )
        i = end + 1
        continue
      }
    }
    buf += c
    i++
  }
  flush()
  return nodes
}

function renderMarkdown(md: string): ReactNode {
  const lines = md.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i++
      continue
    }
    if (line.startsWith('### ')) {
      blocks.push(
        <h4
          key={`blk${key++}`}
          className="font-['Fraunces'] text-[15px] text-[#231d17] mt-4 mb-1.5"
        >
          {renderInline(line.slice(4), `h${key}`)}
        </h4>,
      )
      i++
      continue
    }
    if (line.startsWith('> ')) {
      const quote: string[] = []
      while (i < lines.length && lines[i].startsWith('> ')) {
        quote.push(lines[i].slice(2))
        i++
      }
      blocks.push(
        <blockquote
          key={`blk${key++}`}
          className="my-2.5 border-l-[3px] border-[#c8a24e] bg-[rgba(200,162,78,0.08)] rounded-r-[8px] px-3 py-2 text-[13px] text-[#5b5853]"
        >
          {renderInline(quote.join(' '), `q${key}`)}
        </blockquote>,
      )
      continue
    }
    if (/^\s*-\s/.test(line)) {
      const items: { indent: number; text: string }[] = []
      while (i < lines.length && /^\s*-\s/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)-\s(.*)$/)
        if (m) items.push({ indent: m[1].length, text: m[2] })
        i++
      }
      blocks.push(
        <ul key={`blk${key++}`} className="my-2 space-y-1.5">
          {items.map((it, idx) => (
            <li
              key={idx}
              className={`relative pl-4 text-[13px] leading-[1.5] text-[#3f3b34] ${
                it.indent > 0 ? 'ml-4' : ''
              }`}
            >
              <span className="absolute left-0 top-[2px] text-[#c8a24e]">•</span>
              {renderInline(it.text, `li${key}-${idx}`)}
            </li>
          ))}
        </ul>,
      )
      continue
    }
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('### ') &&
      !lines[i].startsWith('> ') &&
      !/^\s*-\s/.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    blocks.push(
      <p key={`blk${key++}`} className="my-2 text-[13px] leading-[1.55] text-[#3f3b34]">
        {renderInline(para.join(' '), `p${key}`)}
      </p>,
    )
  }
  return <>{blocks}</>
}

// ── shared inner content (Browse only this stage) ────────────────────────────

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]'

function ComingSoonCard({ m }: { m: GuideModule }) {
  return (
    <div className="rounded-[10px] border border-dashed border-[#e0d8c8] bg-[#faf8f3] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="font-['Fraunces'] text-[13.5px] text-[#231d17]">{m.title}</span>
        <span className="text-[9px] font-semibold uppercase tracking-[.08em] text-[#a8842f] bg-[rgba(200,162,78,0.14)] rounded-full px-1.5 py-0.5">
          Coming soon
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-[1.45] text-[#8a8276]">{m.summary}</p>
    </div>
  )
}

function GuideBody({
  selected,
  onSelect,
  onBack,
}: {
  selected: GuideModule | null
  onSelect: (id: string) => void
  onBack: () => void
}) {
  const location = useLocation()
  const current = moduleForPath(location.pathname)

  if (selected) {
    const related = (selected.related ?? [])
      .map((id) => GUIDE_MODULES.find((m) => m.id === id))
      .filter((m): m is GuideModule => !!m && m.status === 'live')
    return (
      <div>
        <button
          onClick={onBack}
          className={`inline-flex items-center gap-1 text-[12px] font-medium text-[#8a8276] hover:text-[#231d17] transition-colors ${focusRing} rounded`}
        >
          <ChevronLeft size={14} />
          Back
        </button>
        <h3 className="font-['Fraunces'] text-[20px] text-[#231d17] mt-3 mb-1">{selected.title}</h3>
        <p className="text-[13px] text-[#8a8276] mb-3">{selected.summary}</p>
        <div className="border-t border-[#e9e4d9] pt-2">{renderMarkdown(selected.body)}</div>
        {related.length > 0 && (
          <div className="mt-5 pt-3 border-t border-[#e9e4d9]">
            <div className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#a79e8e] mb-2">
              Related
            </div>
            <div className="flex flex-col gap-1.5">
              {related.map((m) => (
                <button
                  key={m.id}
                  onClick={() => onSelect(m.id)}
                  className={`text-left text-[13px] text-[#a8842f] hover:text-[#231d17] transition-colors ${focusRing} rounded`}
                >
                  {m.title} →
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {current && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#a79e8e] mb-2">
            For this page
          </div>
          <button
            onClick={() => onSelect(current.id)}
            className={`w-full text-left rounded-[10px] border border-[#e4ddd0] bg-[#fffdf9] px-3 py-3 hover:border-[#c8a24e] transition-colors ${focusRing}`}
          >
            <div className="font-['Fraunces'] text-[15px] text-[#231d17]">{current.title}</div>
            <p className="mt-0.5 text-[12.5px] leading-[1.45] text-[#8a8276]">{current.summary}</p>
          </button>
        </div>
      )}

      {GUIDE_CATEGORIES.slice()
        .sort((a, b) => a.order - b.order)
        .map((cat) => {
          const mods = GUIDE_MODULES.filter((m) => m.category === cat.id)
          if (mods.length === 0) return null
          return (
            <div key={cat.id}>
              <div className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#a79e8e] mb-2">
                {cat.label}
              </div>
              <div className="flex flex-col gap-1.5">
                {mods.map((m) =>
                  m.status === 'coming-soon' ? (
                    <ComingSoonCard key={m.id} m={m} />
                  ) : (
                    <button
                      key={m.id}
                      onClick={() => onSelect(m.id)}
                      className={`w-full text-left rounded-[10px] border border-[#e9e4d9] bg-[#fffdf9] px-3 py-2.5 hover:border-[#c8a24e] transition-colors ${focusRing}`}
                    >
                      <div className="text-[13.5px] font-medium text-[#231d17]">{m.title}</div>
                      <p className="mt-0.5 text-[12px] leading-[1.4] text-[#8a8276] line-clamp-2">
                        {m.summary}
                      </p>
                    </button>
                  ),
                )}
              </div>
            </div>
          )
        })}
    </div>
  )
}

type TabId = 'browse' | 'ask'

function Tabs({ tab, onTab }: { tab: TabId; onTab: (t: TabId) => void }) {
  const tabClass = (active: boolean) =>
    `pb-2 border-b-2 text-[13px] ${focusRing} rounded-t transition-colors ${
      active
        ? 'border-[#c8a24e] font-semibold text-[#231d17]'
        : 'border-transparent font-medium text-[#8a8276] hover:text-[#231d17]'
    }`
  return (
    <div role="tablist" aria-label="Guide sections" className="flex items-end gap-4 border-b border-[#e9e4d9] px-4">
      <button role="tab" aria-selected={tab === 'browse'} onClick={() => onTab('browse')} className={tabClass(tab === 'browse')}>
        Browse
      </button>
      <button role="tab" aria-selected={tab === 'ask'} onClick={() => onTab('ask')} className={tabClass(tab === 'ask')}>
        Ask Bemgu
      </button>
    </div>
  )
}

const ASK_SUGGESTIONS = [
  'How do I add my first property?',
  'What do guests see when they scan the QR?',
  'How do I connect my Airbnb calendar?',
]

type AskMsg = { role: 'user' | 'assistant'; text: string }

// "Ask Bemgu" — corpus-grounded help via /api/guide-assistant. State is local, so it
// resets each time the drawer reopens (the drawer unmounts when closed). reportFocus
// lets the mobile bottom sheet grow to fit the keyboard while the input is focused.
function AskPanel({ reportFocus }: { reportFocus?: (focused: boolean) => void }) {
  const [thread, setThread] = useState<AskMsg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [errored, setErrored] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [thread, loading])

  const send = async (raw: string) => {
    const q = raw.trim()
    if (!q || loading) return
    setErrored(false)
    const priorHistory = thread.slice(-8)
    setThread((t) => [...t, { role: 'user', text: q }])
    setInput('')
    setLoading(true)
    try {
      const data = await api.post<{ reply?: string; error?: string }>('/guide-assistant', {
        message: q.slice(0, 600),
        history: priorHistory,
      })
      if (data.reply) setThread((t) => [...t, { role: 'assistant', text: data.reply! }])
      else setErrored(true)
    } catch {
      setErrored(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      role="tabpanel"
      aria-label="Ask Bemgu"
      tabIndex={0}
      className="flex-1 min-h-0 flex flex-col focus:outline-none"
    >
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        <p className="text-[12.5px] leading-[1.5] text-[#8a8276] mb-3">
          Ask anything about Bemgu — I answer only from the guide, so I won't invent features or give general advice.
        </p>

        {thread.length === 0 ? (
          <div className="flex flex-col gap-1.5">
            {ASK_SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className={`text-left rounded-[10px] border border-[#e9e4d9] bg-[#fffdf9] px-3 py-2 text-[12.5px] text-[#231d17] hover:border-[#c8a24e] transition-colors ${focusRing}`}
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {thread.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'self-end max-w-[85%]' : 'self-start max-w-[92%]'}>
                <div
                  className={
                    m.role === 'user'
                      ? 'rounded-[12px] rounded-br-[4px] bg-[rgba(200,162,78,0.16)] text-[#231d17] px-3 py-2 text-[13px] leading-[1.5] whitespace-pre-wrap'
                      : 'rounded-[12px] rounded-bl-[4px] bg-[#fffdf9] border border-[#e9e4d9] text-[#3f3b34] px-3 py-2 text-[13px] leading-[1.5] whitespace-pre-wrap'
                  }
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>
        )}

        {loading && <div className="self-start mt-2 text-[12px] text-[#8a8276] px-1">Thinking…</div>}
        {errored && (
          <div className="mt-2 text-[12px] text-[#8a1a1a] px-1">
            Something went wrong — please try again in a moment.
          </div>
        )}
      </div>

      <div className="border-t border-[#e9e4d9] p-3">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => reportFocus?.(true)}
            onBlur={() => reportFocus?.(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
            }}
            maxLength={600}
            placeholder="Ask about Bemgu…"
            aria-label="Ask Bemgu a question"
            className="flex-1 rounded-[10px] border border-[#e9e4d9] bg-white px-3 py-2 text-[13px] text-[#231d17] placeholder:text-[#b3aa9b] focus:outline-none focus:border-[#c8a24e]"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            aria-label="Send question"
            className={`shrink-0 rounded-[10px] bg-[#c8a24e] hover:bg-[#a8842f] disabled:opacity-40 disabled:cursor-not-allowed text-[#16100d] p-2 transition-colors ${focusRing}`}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

// Tabs + the active panel. Tab state is local so it resets to Browse each open.
function DrawerContent({
  selected,
  onSelect,
  onBack,
  reportAskFocus,
}: {
  selected: GuideModule | null
  onSelect: (id: string) => void
  onBack: () => void
  reportAskFocus?: (focused: boolean) => void
}) {
  const [tab, setTab] = useState<TabId>('browse')
  return (
    <>
      <Tabs tab={tab} onTab={setTab} />
      <div className="flex-1 min-h-0 flex flex-col">
        {tab === 'browse' ? (
          <div role="tabpanel" aria-label="Browse" className="flex-1 overflow-y-auto px-4 py-4">
            <GuideBody selected={selected} onSelect={onSelect} onBack={onBack} />
          </div>
        ) : (
          <AskPanel reportFocus={reportAskFocus} />
        )}
      </div>
    </>
  )
}

// ── drawer ───────────────────────────────────────────────────────────────────

export default function GuideDrawer({ open, onClose, triggerRef, requestedModuleId = null }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [minimized, setMinimized] = useState(false)
  const [entered, setEntered] = useState(false)
  const [sheetExpanded, setSheetExpanded] = useState(false)

  const desktopRef = useRef<HTMLElement>(null)
  const sheetRef = useRef<HTMLElement>(null)
  const pillRef = useRef<HTMLDivElement>(null)
  const desktopHeadingRef = useRef<HTMLHeadingElement>(null)
  const sheetHeadingRef = useRef<HTMLHeadingElement>(null)
  const prevOpen = useRef(open)

  const selected = selectedId ? GUIDE_MODULES.find((m) => m.id === selectedId) ?? null : null

  // On open, show the requested article if one was asked for, else reset to the route
  // section. requestedModuleId is in the deps so a plain sidebar toggle (which clears it
  // to null) opens to the route section, not the last requested article.
  useEffect(() => {
    if (!open) return
    setSelectedId(requestedModuleId ?? null)
    setMinimized(false)
    setSheetExpanded(false)
  }, [open, requestedModuleId])

  // Slide-in: flip translate on the frame after mount (motion-reduce disables the transition).
  useEffect(() => {
    if (!open) {
      setEntered(false)
      return
    }
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [open])

  // Escape closes the drawer (non-modal — no focus trap, no page dimming).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Move initial focus to the drawer HEADING of whichever surface is visible (not the
  // Close button). When minimized to the pill, focus the pill button instead.
  useEffect(() => {
    if (!open) return
    const heading = [desktopHeadingRef.current, sheetHeadingRef.current].find(
      (el) => el && el.offsetParent !== null,
    )
    if (heading) {
      heading.focus()
      return
    }
    pillRef.current?.querySelector<HTMLElement>('button')?.focus()
  }, [open, minimized])

  // Return focus to the trigger when the drawer fully closes.
  useEffect(() => {
    if (prevOpen.current && !open) triggerRef.current?.focus()
    prevOpen.current = open
  }, [open, triggerRef])

  if (!open) return null

  const onSelect = (id: string) => setSelectedId(id)
  const onBack = () => setSelectedId(null)

  return (
    <>
      {/* Desktop — right-side overlay, no scrim, page stays interactive */}
      <aside
        ref={desktopRef}
        role="complementary"
        aria-label="Guide and help"
        className={`hidden md:flex fixed top-0 right-0 bottom-0 z-40 w-[392px] flex-col bg-[#fffdf9] border-l border-[#e4ddd0] shadow-[-12px_0_40px_rgba(0,0,0,0.12)] transition-transform duration-200 motion-reduce:transition-none ${
          entered ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <h2
            ref={desktopHeadingRef}
            tabIndex={-1}
            className="font-['Fraunces'] text-[17px] text-[#231d17] focus:outline-none"
          >
            Guide &amp; help
          </h2>
          <button
            onClick={onClose}
            aria-label="Close guide"
            className={`p-1 rounded-[8px] text-[#8a8276] hover:text-[#231d17] hover:bg-[#f0ece3] transition-colors ${focusRing}`}
          >
            <X size={18} />
          </button>
        </div>
        <DrawerContent selected={selected} onSelect={onSelect} onBack={onBack} />
      </aside>

      {/* Mobile — bottom sheet at 40% height, app usable above */}
      {!minimized && (
        <aside
          ref={sheetRef}
          role="complementary"
          aria-label="Guide and help"
          className={`md:hidden fixed inset-x-0 bottom-0 z-40 flex flex-col bg-[#fffdf9] border-t border-[#e4ddd0] rounded-t-[18px] shadow-[0_-12px_40px_rgba(0,0,0,0.18)] transition-[transform,height] duration-200 motion-reduce:transition-none ${
            sheetExpanded ? 'h-[85vh]' : 'h-[40vh]'
          } ${entered ? 'translate-y-0' : 'translate-y-full'}`}
        >
          <div className="flex items-center justify-between px-4 pt-2 pb-2">
            <button
              onClick={() => setMinimized(true)}
              aria-label="Minimize guide"
              className={`flex items-center gap-1 text-[12px] font-medium text-[#8a8276] hover:text-[#231d17] transition-colors ${focusRing} rounded`}
            >
              <ChevronDown size={16} />
              <span className="w-9 h-1 rounded-full bg-[#e0d8c8] block" aria-hidden="true" />
            </button>
            <h2
              ref={sheetHeadingRef}
              tabIndex={-1}
              className="font-['Fraunces'] text-[15px] text-[#231d17] focus:outline-none"
            >
              Guide &amp; help
            </h2>
            <button
              onClick={onClose}
              aria-label="Close guide"
              className={`p-1 rounded-[8px] text-[#8a8276] hover:text-[#231d17] hover:bg-[#f0ece3] transition-colors ${focusRing}`}
            >
              <X size={18} />
            </button>
          </div>
          <DrawerContent
            selected={selected}
            onSelect={onSelect}
            onBack={onBack}
            reportAskFocus={setSheetExpanded}
          />
        </aside>
      )}

      {/* Mobile — docked pill when minimized */}
      {minimized && (
        <div
          ref={pillRef}
          className="md:hidden fixed inset-x-0 bottom-0 z-40 flex justify-center pb-3 pointer-events-none"
        >
          <button
            onClick={() => setMinimized(false)}
            className={`pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-[#1c1c1a] text-[#f4ecdb] text-[12.5px] font-medium pl-4 pr-3.5 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.3)] ${focusRing}`}
          >
            Guide
            <ChevronUp size={15} className="text-[#c8a24e]" />
          </button>
        </div>
      )}
    </>
  )
}
