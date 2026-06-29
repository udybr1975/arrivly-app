import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { useLocation } from 'react-router-dom'
import { X, ChevronLeft, ChevronUp, ChevronDown } from 'lucide-react'
import {
  GUIDE_CATEGORIES,
  GUIDE_MODULES,
  moduleForPath,
  type GuideModule,
} from '../../guide/content'

type Props = {
  open: boolean
  onClose: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
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

function Tabs() {
  return (
    <div className="flex items-end gap-4 border-b border-[#e9e4d9] px-4">
      <div className="pb-2 border-b-2 border-[#c8a24e] text-[13px] font-semibold text-[#231d17]">
        Browse
      </div>
      <button
        disabled
        aria-disabled="true"
        title="Available shortly"
        className="pb-2 border-b-2 border-transparent text-[13px] font-medium text-[#b3aa9b] cursor-not-allowed"
      >
        Ask Arrivly
        <span className="ml-1.5 text-[10px] font-normal text-[#b3aa9b]">available shortly</span>
      </button>
    </div>
  )
}

// ── drawer ───────────────────────────────────────────────────────────────────

export default function GuideDrawer({ open, onClose, triggerRef }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [minimized, setMinimized] = useState(false)
  const [entered, setEntered] = useState(false)

  const desktopRef = useRef<HTMLElement>(null)
  const sheetRef = useRef<HTMLElement>(null)
  const pillRef = useRef<HTMLDivElement>(null)
  const prevOpen = useRef(open)

  const selected = selectedId ? GUIDE_MODULES.find((m) => m.id === selectedId) ?? null : null

  // Reset to the route section each time the drawer opens.
  useEffect(() => {
    if (open) {
      setSelectedId(null)
      setMinimized(false)
    }
  }, [open])

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

  // Move focus into whichever surface is visible (desktop panel / mobile sheet / pill).
  useEffect(() => {
    if (!open) return
    const target = [desktopRef.current, sheetRef.current, pillRef.current].find(
      (el) => el && el.offsetParent !== null,
    )
    target?.querySelector<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')?.focus()
  }, [open, minimized, selectedId])

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
          <span className="font-['Fraunces'] text-[17px] text-[#231d17]">Guide &amp; help</span>
          <button
            onClick={onClose}
            aria-label="Close guide"
            className={`p-1 rounded-[8px] text-[#8a8276] hover:text-[#231d17] hover:bg-[#f0ece3] transition-colors ${focusRing}`}
          >
            <X size={18} />
          </button>
        </div>
        <Tabs />
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <GuideBody selected={selected} onSelect={onSelect} onBack={onBack} />
        </div>
      </aside>

      {/* Mobile — bottom sheet at 40% height, app usable above */}
      {!minimized && (
        <aside
          ref={sheetRef}
          role="complementary"
          aria-label="Guide and help"
          className={`md:hidden fixed inset-x-0 bottom-0 z-40 h-[40vh] flex flex-col bg-[#fffdf9] border-t border-[#e4ddd0] rounded-t-[18px] shadow-[0_-12px_40px_rgba(0,0,0,0.18)] transition-transform duration-200 motion-reduce:transition-none ${
            entered ? 'translate-y-0' : 'translate-y-full'
          }`}
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
            <span className="font-['Fraunces'] text-[15px] text-[#231d17]">Guide &amp; help</span>
            <button
              onClick={onClose}
              aria-label="Close guide"
              className={`p-1 rounded-[8px] text-[#8a8276] hover:text-[#231d17] hover:bg-[#f0ece3] transition-colors ${focusRing}`}
            >
              <X size={18} />
            </button>
          </div>
          <Tabs />
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <GuideBody selected={selected} onSelect={onSelect} onBack={onBack} />
          </div>
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
