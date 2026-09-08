/**
 * Minimal, zero-dependency Markdown renderer.
 *
 * SCOPE IS DELIBERATE, NOT AN OVERSIGHT. It covers exactly the constructs the four
 * published legal documents under docs/ use — headings, paragraphs, bold, italics,
 * lists, tables, horizontal rules, blockquotes and links — and nothing else. The
 * documents ARE the source of truth (imported with Vite's `?raw`), so this file exists
 * only to display them; it is not a general-purpose Markdown implementation and must
 * not grow into one. If a document ever needs a construct that is missing here, add it
 * here rather than pasting rendered copy into a component.
 *
 * SECURITY: every value reaches the DOM as a React child or a validated href, never
 * through dangerouslySetInnerHTML, so raw HTML in the source renders as literal text.
 * Link hrefs are allowlisted to http(s) and site-relative paths — `javascript:` and
 * `data:` are dropped and the label renders as plain text.
 */
import type { ReactNode } from 'react'

/** Link · bold · italic · bare URL, tried left-to-right at each position. */
const INLINE_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|(https?:\/\/[^\s)<>]+)/g

function safeHref(raw: string): string | null {
  const href = raw.trim()
  if (/^https?:\/\//i.test(href)) return href
  if (/^\//.test(href) && !/^\/\//.test(href)) return href
  return null
}

function link(href: string, label: ReactNode, key: string): ReactNode {
  const safe = safeHref(href)
  if (!safe) return <span key={key}>{label}</span>
  const external = /^https?:\/\//i.test(safe)
  return (
    <a
      key={key}
      href={safe}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="text-[#7a5c00] underline underline-offset-2 hover:text-[#1c1c1a]"
    >
      {label}
    </a>
  )
}

/** Render the inline span of one line. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  // Keys are namespaced by `keyBase`, NOT by a bare counter. `paragraph()` calls this
  // once per soft-wrapped line and spreads every result into ONE element list, so a
  // per-call counter collides across calls — two `<strong>` children both keyed "0" in
  // any paragraph with two bold-label lines, which several documents have.
  let k = 0
  INLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const linkLabel = m[1], linkHref = m[2], bold = m[3], italic = m[4], bareUrl = m[5]
    if (linkLabel !== undefined && linkHref !== undefined) {
      out.push(link(linkHref, linkLabel, keyBase + '-e' + k++))
    } else if (bold !== undefined) {
      out.push(<strong key={keyBase + '-e' + k++} className="font-semibold text-[#1c1c1a]">{bold}</strong>)
    } else if (italic !== undefined) {
      out.push(<em key={keyBase + '-e' + k++}>{italic}</em>)
    } else if (bareUrl !== undefined) {
      out.push(link(bareUrl, bareUrl, keyBase + '-e' + k++))
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out.map((node, idx) => (typeof node === 'string' ? <span key={keyBase + '-t' + idx}>{node}</span> : node))
}

/**
 * A line that OPENS A NEW VISUAL LINE inside a paragraph: a bold LABEL, i.e. bold text
 * ending in a colon — "**Email:**", "**Effective date:**", "**Postal address:**".
 *
 * THE COLON IS LOAD-BEARING, not decoration. An earlier version broke on any leading
 * "**" and split a sentence whose soft-wrap happened to continue with a bolded word
 * (legal-tos.md's closing "Questions: **hello@bemgu.app**"), inserting a line break
 * mid-sentence in a published legal document.
 */
const isLabelLine = (l: string) => /^\*\*[^*]+:\*\*/.test(l)

/**
 * Join the soft-wrapped lines of one paragraph.
 *
 * These documents mix two shapes inside a single block: prose wrapped mid-sentence at
 * ~95 columns (which must join with a SPACE), and one-per-line fields that must keep
 * their line break. Two things start a new visual line: a bold label (above), and a
 * CommonMark hard break — two or more trailing spaces on the PRECEDING line, which is
 * the portable way for a document to ask for a break that carries no bold label (the
 * supervisory-authority and controller address blocks use it).
 */
function paragraph(lines: string[], key: string): ReactNode {
  const parts: ReactNode[] = []
  let buffer: string[] = []
  const flush = (idx: number) => {
    if (!buffer.length) return
    if (parts.length) parts.push(<br key={key + '-br' + idx} />)
    parts.push(...inline(buffer.join(' '), key + '-p' + idx))
    buffer = []
  }
  lines.forEach((line, idx) => {
    const hardBreakBefore = idx > 0 && /\s{2,}$/.test(lines[idx - 1])
    if (idx > 0 && (isLabelLine(line) || hardBreakBefore)) flush(idx)
    buffer.push(line.trim())
  })
  flush(lines.length)
  return <p key={key} className="text-[15px] leading-[1.75] text-[#36322c] my-4">{parts}</p>
}

const isTableRow = (l: string) => /^\|/.test(l)
const isTableRule = (l: string) => /^\|[\s:|-]+\|?\s*$/.test(l) && l.includes('-')
const splitRow = (l: string) => l.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim())

/**
 * Absorb a list item's soft-wrapped continuation lines — indented, non-blank, and not
 * themselves the start of a new block — appending them to the item just pushed.
 *
 * WITHOUT THIS, a wrapped bullet SILENTLY BREAKS THE LIST: the loop stops at the
 * continuation line, the list closes, the fragment renders as an un-bulleted paragraph
 * and a new list opens after it. The ToS §7 prohibitions wrap three times and rendered
 * as three lists with two orphan fragments — in a live Terms of Service.
 */
function absorbContinuations(lines: string[], from: number, items: string[]): number {
  let i = from
  while (
    i < lines.length &&
    /^\s+\S/.test(lines[i]) &&
    !isBullet(lines[i].trim()) &&
    !isNumbered(lines[i].trim()) &&
    !isTableRow(lines[i].trim())
  ) {
    items[items.length - 1] += ' ' + lines[i].trim()
    i++
  }
  return i
}

const isHr = (l: string) => /^(---+|\*\*\*+|___+)\s*$/.test(l)
const isHeading = (l: string) => /^#{1,6}\s/.test(l)
const isBullet = (l: string) => /^[-*]\s+/.test(l)
const isNumbered = (l: string) => /^\d+\.\s+/.test(l)
const isQuote = (l: string) => /^>\s?/.test(l)

/**
 * A table starts only at a `|` row FOLLOWED BY a delimiter row. A `|` line without one
 * is malformed, and must fall through to the paragraph branch rather than vanish — a
 * silently dropped row in a published legal document is the worst failure this renderer
 * could have, and "editing a document is the whole job" makes it a live risk.
 */
function startsTable(lines: string[], i: number): boolean {
  return isTableRow(lines[i]) && i + 1 < lines.length && isTableRule(lines[i + 1])
}

/** Render a whole document. */
export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) { i++; continue }

    if (isHr(line)) {
      blocks.push(<hr key={key++} className="my-9 border-0 border-t border-[#e4ddd0]" />)
      i++
      continue
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1].length
      const content = inline(h[2], 'h' + key)
      if (level === 1) {
        blocks.push(<h1 key={key++} className="font-['Fraunces'] font-light text-[30px] leading-tight tracking-tight text-[#1c1c1a] mt-2 mb-5">{content}</h1>)
      } else if (level === 2) {
        blocks.push(<h2 key={key++} className="font-['Fraunces'] font-normal text-[21px] leading-snug tracking-tight text-[#1c1c1a] mt-10 mb-3">{content}</h2>)
      } else {
        blocks.push(<h3 key={key++} className="font-semibold text-[16px] text-[#1c1c1a] mt-7 mb-2">{content}</h3>)
      }
      i++
      continue
    }

    if (startsTable(lines, i)) {
      const head = splitRow(line)
      const tableKey = key++
      i += 2
      const body: string[][] = []
      while (i < lines.length && isTableRow(lines[i])) { body.push(splitRow(lines[i])); i++ }
      blocks.push(
        <div key={tableKey} className="my-5 overflow-x-auto">
          <table className="w-full min-w-[440px] border-collapse text-[14px]">
            <thead>
              <tr>
                {head.map((c, ci) => (
                  <th key={ci} className="border-b border-[#d8d0c0] bg-[#f5f1e8] px-3 py-2.5 text-left align-top font-semibold text-[#1c1c1a]">
                    {inline(c, 'th' + tableKey + '-' + ci)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri}>
                  {row.map((c, ci) => (
                    <td key={ci} className="border-b border-[#e9e4d9] px-3 py-2.5 align-top leading-relaxed text-[#36322c]">
                      {inline(c, 'td' + tableKey + '-' + ri + '-' + ci)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    if (isBullet(line)) {
      const listKey = key++
      const items: string[] = []
      while (i < lines.length && isBullet(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''))
        i++
        i = absorbContinuations(lines, i, items)
      }
      blocks.push(
        <ul key={listKey} className="my-4 list-disc pl-6 space-y-2 text-[15px] leading-[1.7] text-[#36322c] marker:text-[#a79e8e]">
          {items.map((it, ii) => <li key={ii}>{inline(it, 'li' + listKey + '-' + ii)}</li>)}
        </ul>
      )
      continue
    }

    if (isNumbered(line)) {
      const listKey = key++
      const items: string[] = []
      while (i < lines.length && isNumbered(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''))
        i++
        i = absorbContinuations(lines, i, items)
      }
      blocks.push(
        <ol key={listKey} className="my-4 list-decimal pl-6 space-y-2 text-[15px] leading-[1.7] text-[#36322c] marker:text-[#a79e8e]">
          {items.map((it, ii) => <li key={ii}>{inline(it, 'ol' + listKey + '-' + ii)}</li>)}
        </ol>
      )
      continue
    }

    if (isQuote(line)) {
      const quoteKey = key++
      const quoted: string[] = []
      while (i < lines.length && isQuote(lines[i])) { quoted.push(lines[i].replace(/^>\s?/, '')); i++ }
      blocks.push(
        <blockquote key={quoteKey} className="my-5 border-l-[3px] border-[#c8a24e] pl-4 text-[15px] leading-[1.7] text-[#5b5853]">
          {inline(quoted.join(' '), 'bq' + quoteKey)}
        </blockquote>
      )
      continue
    }

    // Paragraph — consume until a blank line or the start of another block.
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isHeading(lines[i]) &&
      !isHr(lines[i]) &&
      !isBullet(lines[i]) &&
      !isNumbered(lines[i]) &&
      !isQuote(lines[i]) &&
      !startsTable(lines, i)
    ) { para.push(lines[i]); i++ }
    // `para` cannot be empty here: `line` is non-blank and failed every block test above,
    // so the loop consumes at least it. The guard stays as a belt-and-braces against an
    // infinite loop if a future block test is added to the loop but not to the dispatch.
    if (para.length) blocks.push(paragraph(para, 'pa' + key++))
    else i++
  }

  return <>{blocks}</>
}
