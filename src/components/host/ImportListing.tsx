import { useCallback, useMemo, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { api } from '../../lib/api'
import {
  MIN_EXTRACTED_CHARS,
  looksLikeCredentialText,
  stripWhatsAppStamps,
  truncateForImport,
} from '../../lib/listingText'
import { EXTRAS_CATEGORIES } from '../../lib/detailCategories'

// ── LISTING IMPORTER — "Have it all in one file?" ─────────────────────────────────────────
//
// Three stages: an entry card, an extract-and-confirm screen, and a field-by-field review.
//
// THE FILE NEVER LEAVES THE DEVICE. Text is extracted in the browser (mammoth for .docx,
// pdfjs-dist for .pdf) and only the extracted TEXT is POSTed. There is no create-upload-url
// call, no storage write and no multipart body anywhere in this file — that is a design
// guarantee the privacy line in Stage 2 states to the host, not an implementation detail.
//
// Both extractors are loaded with dynamic import() INSIDE the handlers, so neither lands in the
// property editor's initial bundle: a host who never imports never downloads them.
//
// PROPOSE-ONLY: nothing here writes to the database. Accepted fields are handed to onApply,
// which is implemented in PropertySetup against its OWN existing save functions.

// ── shapes (mirror api/_lib/import-listing.ts) ────────────────────────────────────────────

export interface ImportProposal {
  basics: {
    description?: string; street?: string; street_number?: string; floor_note?: string
    max_guests?: number; city?: string; neighborhood?: string; country?: string
  }
  wifi: { ssid?: string; password?: string }
  checkin: { check_in_from?: string; check_out_by?: string; door_code?: string; entry_instructions?: string }
  rules?: string
  extras: { category: string; content: string }[]
  picks_text?: string
}

export interface AcceptedImport {
  basics: ImportProposal['basics']
  wifi: { ssid?: string; password?: string } | null
  checkin: ImportProposal['checkin'] | null
  rules: string | null
  extras: { category: string; content: string }[]
  picksText: string | null
  /** The host's original document, for the guest chat to answer from. `null` means "do not keep
   *  one" — which must DELETE any existing row, not merely skip the write, or a re-import with
   *  the tick off would leave a stale document answering questions. */
  sourceDoc: string | null
}

export interface ApplySectionResult { section: string; ok: boolean; message?: string }

/** The property's current values, taken from PropertySetup's OWN loaded state — this component
 *  never queries the database for them. */
export interface CurrentValues {
  basic: {
    description?: string; street: string; streetNumber: string; floorNote: string
    maxGuests: number; city: string; neighborhood: string; country: string
  }
  wifi: { ssid: string; password: string }
  checkin: { checkInFrom: string; checkOutBy: string; doorCode: string; entryInstructions: string }
  rawRules: string
  extrasRows: { id: string; category: string; content: string }[]
  /** Count only — the picks row is not a value diff, and claiming "empty" without checking
   *  would be a statement about current state this component never verified. */
  picksCount: number
}

interface Props {
  apartmentId: string
  propertyName: string
  current: CurrentValues
  /** How many of the content tabs already hold something. The entry card is a shortcut for an
   *  EMPTY property, so it hides itself once the property is furnished. */
  filledTabCount: number
  /** PropertySetup's existing loadExtras / loadPicks — called once before review so the
   *  "in your tab now" column is populated without this component issuing its own query.
   *  BOTH are needed: each is lazily loaded by its own tab, so a host who never opened that tab
   *  would otherwise have the review screen assert "empty" about state nobody read. */
  onLoadExtras: () => Promise<void> | void
  onLoadPicks: () => Promise<void> | void
  onApply: (accepted: AcceptedImport) => Promise<ApplySectionResult[]>
}

type Stage = 'entry' | 'extract' | 'review'
type TabKey = 'basic' | 'wifi' | 'checkin' | 'rules' | 'extras' | 'picks'

const TAB_LABEL: Record<TabKey, string> = {
  basic: 'Basics', wifi: 'WiFi', checkin: 'Check-in', rules: 'House rules',
  extras: 'Extras', picks: 'My picks',
}
// Check-in and WiFi are the private tabs — same lock marker the editor's own tab bar uses.
const TAB_PRIVATE: Record<TabKey, boolean> = {
  basic: false, wifi: true, checkin: true, rules: false, extras: false, picks: false,
}
const TAB_ORDER: TabKey[] = ['basic', 'wifi', 'checkin', 'rules', 'extras', 'picks']

// Design tokens — same values as PropertySetup's, kept in sync by eye because this component
// renders inside it.
const CARD = 'bg-[#fffdf9] border border-[#e4ddd0] rounded-[14px] p-5'
const HEADING = "text-[16px] font-['Fraunces'] font-light text-[#231d17]"
const BTN_AI = 'bg-[#1c1c1a] text-[#f0ede6] px-5 py-2.5 rounded-[10px] text-xs font-semibold hover:bg-[#2a2a28] transition-colors disabled:opacity-40 disabled:hover:bg-[#1c1c1a]'
const BTN_SAVE = 'bg-[#c8a24e] text-[#16100d] px-5 py-2.5 rounded-[10px] text-xs font-semibold hover:bg-[#e7d6ad] transition-colors disabled:opacity-40 disabled:hover:bg-[#c8a24e]'
const BTN_OUTLINE = 'bg-transparent border border-[#e4ddd0] text-[#231d17] px-4 py-2 rounded-[10px] text-xs font-medium hover:bg-[#f0ede6] transition-colors disabled:opacity-40'

// ── one reviewable row ────────────────────────────────────────────────────────────────────

interface Row {
  key: string
  tab: TabKey
  label: string
  /** Rendered in the "Found in your file" column. */
  proposed: string
  /** Rendered in the "In your tab now" column. Empty string = nothing there yet. */
  currentText: string
  isPrivate: boolean
  note?: string
  conflictValues?: string[]
}

// Row keys contain category names with spaces and '&' ('Recycling & Bins'), which are not
// valid in an HTML id — label association would then rely on browser leniency.
function domId(key: string): string {
  return 'imp-' + key.replace(/[^a-zA-Z0-9_-]+/g, '-')
}

// Rows whose value is number-bearing BY CONSTRUCTION — a Helsinki postcode (00100), a Barcelona
// one (08001), a street number, a guest count. The language-agnostic digit run fires on these
// constantly, and a badge that cries wolf on an address line teaches the host to ignore it, which
// is the same argument that removed the bare `pass` alternative. Only the DIGIT half is
// suppressed for them; the word list still applies everywhere.
//
// ENUMERATED, not a `basics.` prefix test. The prefix version also caught `description` and
// `floor_note`, which are FREE PROSE and public — exactly where a stray "…, 5567" belongs to the
// heuristic rather than to the exemption. That over-reach shipped in a57102e as a recorded
// residual; this is the one-line fix it asked for.
const NUMERIC_BY_CONSTRUCTION = new Set([
  'basics.street',
  'basics.street_number',
  'basics.city',
  'basics.neighborhood',
  'basics.country',
  'basics.max_guests',
])

// A PUBLIC row whose text reads like a credential is almost always a mis-sort — and it is
// precisely what a hostile or sloppy document would produce, because public rows default to
// TICKED while the WiFi/Check-in tabs are protected by "needs your tick". The server-side scrub
// (api/_lib/import-listing.ts) removes the clear cases before they ever arrive; this is what
// catches what the scrub's language-scoped noun list missed.
// Deliberately over-broad: it only ever UNTICKS and warns, and the host can tick it straight
// back. Under-ticking is the safe direction; a false positive costs one click.
function looksLikeCredential(r: Row): boolean {
  if (r.isPrivate) return false
  return NUMERIC_BY_CONSTRUCTION.has(r.key)
    ? looksLikeCredentialText(r.proposed, { digitRun: false })
    : looksLikeCredentialText(r.proposed)
}

function tabPill(tab: TabKey) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-[9px] text-xs font-medium bg-[#1c1c1a] text-[#f0ede6]">
      {TAB_LABEL[tab]}
      {TAB_PRIVATE[tab] && <Lock size={11} />}
    </span>
  )
}

export default function ImportListing({
  apartmentId, propertyName, current, filledTabCount, onLoadExtras, onLoadPicks, onApply,
}: Props) {
  const dismissKey = `arrivly_import_dismissed_${apartmentId}`
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(dismissKey) === '1' } catch { return false }
  })
  const [stage, setStage] = useState<Stage>('entry')
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [sorting, setSorting] = useState(false)
  const [sortError, setSortError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<ImportProposal | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])
  const [conflicts, setConflicts] = useState<{ field: string; values: string[] }[]>([])
  const [redacted, setRedacted] = useState(0)
  const [accepted, setAccepted] = useState<Record<string, boolean>>({})
  const [applying, setApplying] = useState(false)
  const [results, setResults] = useState<ApplySectionResult[] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function dismiss() {
    try { localStorage.setItem(dismissKey, '1') } catch { /* private mode — dismiss for this view only */ }
    setDismissed(true)
  }

  // ── extraction ──────────────────────────────────────────────────────────────────────────

  const acceptText = useCallback((raw: string, name: string | null) => {
    const stripped = stripWhatsAppStamps(raw).trim()
    if (stripped.length < MIN_EXTRACTED_CHARS) {
      setExtractError(
        "There's almost no text in that file — it looks like a scan or a photo. " +
        'Open it, copy the text, and paste it below instead.',
      )
      return
    }
    const { text: capped, truncated: wasCut } = truncateForImport(stripped)
    setText(capped)
    setTruncated(wasCut)
    setFileName(name)
    setExtractError(null)
  }, [])

  async function handleFile(file: File) {
    setExtracting(true)
    setExtractError(null)
    try {
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.docx')) {
        // Dynamic import: mammoth stays out of the editor's initial bundle.
        const mammoth = (await import('mammoth')).default
        const buf = await file.arrayBuffer()
        const { value } = await mammoth.extractRawText({ arrayBuffer: buf })
        acceptText(value ?? '', file.name)
      } else if (lower.endsWith('.pdf')) {
        const pdfjs = await import('pdfjs-dist')
        // Worker from the installed package via Vite's ?url — never a CDN, so the import works
        // offline and cannot be swapped by a third party.
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
        const buf = await file.arrayBuffer()
        // PDF.js parses a file the host may have been SENT, inside the logged-in dashboard
        // origin, so the eval-backed font path (CVE-2024-4367) is the thing to worry about.
        // `isEvalSupported: false` is NOT passed because the option NO LONGER EXISTS in
        // pdfjs-dist v6 — verified at source: it is absent from types/src/display/api.d.ts and
        // appears 0 times in build/pdf.mjs, i.e. upstream removed eval entirely. Recorded so a
        // future reader does not "restore" a flag whose absence is the fix, and so a version
        // DOWNGRADE is understood to reopen this. THE GUARANTEE IS ALSO SCOPED to never loading
        // pdfjs-dist's `pdf.sandbox` bundle — enabling PDF form/JS scripting reopens the same
        // mechanism without any downgrade.
        const doc = await pdfjs.getDocument({ data: buf }).promise
        // Bounded: a crafted PDF with a huge page count would otherwise wedge the tab. Self-DoS
        // only, but the cap costs nothing and 200 pages is far beyond any house manual.
        const maxPages = Math.min(doc.numPages, 200)
        const pages: string[] = []
        for (let i = 1; i <= maxPages; i++) {
          const page = await doc.getPage(i)
          const content = await page.getTextContent()
          pages.push(content.items.map(it => ('str' in it ? it.str : '')).join(' '))
        }
        acceptText(pages.join('\n'), file.name)
      } else if (lower.endsWith('.txt') || lower.endsWith('.md')) {
        acceptText(await file.text(), file.name)
      } else {
        setExtractError('That file type is not supported. Upload a .docx or .pdf, or paste the text below.')
      }
    } catch {
      setExtractError("We couldn't read that file. Open it, copy the text, and paste it below instead.")
    } finally {
      setExtracting(false)
      // Allow re-picking the same file after an error.
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // ── sort ────────────────────────────────────────────────────────────────────────────────

  async function sortIt() {
    // Applies to PASTED text too, not just extracted files: acceptText only guards the file
    // path, so without this a two-word paste spends a full model call.
    if (text.trim().length < MIN_EXTRACTED_CHARS) {
      setSortError("That's too short to sort — paste your guest guide, or choose a file above.")
      return
    }
    setSorting(true)
    setSortError(null)
    setAccepted({})
    setResults(null)
    setRedacted(0)
    setKeepSourceDoc(true)
    try {
      const data = await api.post<{
        proposal: ImportProposal
        truncated: boolean
        skipped: string[]
        conflicts: { field: string; values: string[] }[]
        redacted: number
      }>('/import-listing', { apartmentId, content: text })
      // Populate the "in your tab now" columns from PropertySetup's own loaders rather than
      // querying here. Both are lazily loaded by their tabs, so both must be pulled.
      await Promise.all([onLoadExtras(), onLoadPicks()])
      setProposal(data.proposal)
      setSkipped(data.skipped ?? [])
      setConflicts(data.conflicts ?? [])
      setRedacted(data.redacted ?? 0)
      if (data.truncated) setTruncated(true)
      setStage('review')
    } catch {
      setSortError("We couldn't sort that just now. Nothing was changed — try again.")
    } finally {
      setSorting(false)
    }
  }

  // ── rows ────────────────────────────────────────────────────────────────────────────────

  const conflictFor = useCallback(
    (field: string) => conflicts.find(c => c.field === field)?.values,
    [conflicts],
  )

  const rows = useMemo<Row[]>(() => {
    if (!proposal) return []
    const out: Row[] = []
    const push = (r: Row) => { if (r.proposed.trim()) out.push(r) }

    const b = proposal.basics
    const cb = current.basic
    const basicField = (key: string, label: string, proposed: string | undefined, currentText: string) =>
      push({ key: `basics.${key}`, tab: 'basic', label, proposed: proposed ?? '', currentText, isPrivate: false, conflictValues: conflictFor(key) })
    basicField('description', 'Description', b.description, cb.description ?? '')
    basicField('street', 'Street', b.street, cb.street)
    basicField('street_number', 'Street number', b.street_number, cb.streetNumber)
    basicField('floor_note', 'Floor / entrance note', b.floor_note, cb.floorNote)
    basicField('city', 'City', b.city, cb.city)
    basicField('neighborhood', 'Neighbourhood', b.neighborhood, cb.neighborhood)
    basicField('country', 'Country', b.country, cb.country)
    basicField('max_guests', 'Max guests', b.max_guests != null ? String(b.max_guests) : '', String(cb.maxGuests || ''))

    push({ key: 'wifi.ssid', tab: 'wifi', label: 'Network name', proposed: proposal.wifi.ssid ?? '', currentText: current.wifi.ssid, isPrivate: true, conflictValues: conflictFor('ssid') })
    push({ key: 'wifi.password', tab: 'wifi', label: 'Password', proposed: proposal.wifi.password ?? '', currentText: current.wifi.password, isPrivate: true, conflictValues: conflictFor('password') })

    const c = proposal.checkin
    push({ key: 'checkin.check_in_from', tab: 'checkin', label: 'Check-in from', proposed: c.check_in_from ?? '', currentText: current.checkin.checkInFrom, isPrivate: true, conflictValues: conflictFor('check_in_from') })
    push({ key: 'checkin.check_out_by', tab: 'checkin', label: 'Check-out by', proposed: c.check_out_by ?? '', currentText: current.checkin.checkOutBy, isPrivate: true, conflictValues: conflictFor('check_out_by') })
    push({ key: 'checkin.door_code', tab: 'checkin', label: 'Door code', proposed: c.door_code ?? '', currentText: current.checkin.doorCode, isPrivate: true, conflictValues: conflictFor('door_code') })
    push({ key: 'checkin.entry_instructions', tab: 'checkin', label: 'Entry instructions', proposed: c.entry_instructions ?? '', currentText: current.checkin.entryInstructions, isPrivate: true, conflictValues: conflictFor('entry_instructions') })

    push({
      key: 'rules', tab: 'rules', label: 'House rules', proposed: proposal.rules ?? '',
      currentText: current.rawRules, isPrivate: false,
      note: "Bemgu rewrites house rules in a warm, friendly tone when you save, so the wording will change a little.",
      conflictValues: conflictFor('rules'),
    })

    for (const cat of EXTRAS_CATEGORIES) {
      const found = proposal.extras.filter(e => e.category === cat).map(e => e.content).join('\n')
      const existing = current.extrasRows.filter(r => r.category === cat).map(r => r.content).join('\n')
      push({ key: `extras.${cat}`, tab: 'extras', label: cat, proposed: found, currentText: existing, isPrivate: false })
    }

    push({
      key: 'picks', tab: 'picks', label: 'Places you recommend', proposed: proposal.picks_text ?? '',
      currentText: current.picksCount > 0
        ? `${current.picksCount} place${current.picksCount === 1 ? '' : 's'} already saved — importing adds to them`
        : '',
      isPrivate: false,
      note: "These recommendations will be identified and placed on the map next — you'll confirm each one.",
    })

    return out
  }, [proposal, current, conflictFor])

  const isSame = useCallback((r: Row) => r.proposed.trim() === r.currentText.trim(), [])

  // Defaults, computed once per proposal: public fields ON, credentials OFF (an explicit tick),
  // and anything identical to what is already stored OFF because applying it is a no-op.
  const defaults = useMemo(() => {
    const d: Record<string, boolean> = {}
    for (const r of rows) d[r.key] = !r.isPrivate && !isSame(r) && !looksLikeCredential(r)
    return d
  }, [rows, isSame])

  const isAccepted = useCallback(
    (key: string) => (key in accepted ? accepted[key] : (defaults[key] ?? false)),
    [accepted, defaults],
  )
  // Derives the next value from `a`, the updater's own state — NOT from the render-time
  // `accepted`. Two toggles batched into one render would otherwise lose one.
  const toggle = (key: string) =>
    setAccepted(a => ({ ...a, [key]: key in a ? !a[key] : !(defaults[key] ?? false) }))

  // Its own state, NOT a Row: it is not a field diff, has no "in your tab now" side, and belongs
  // after the tab groups rather than inside one. Defaults ON — the whole point of the import is
  // that the host already wrote this document.
  const [keepSourceDoc, setKeepSourceDoc] = useState(true)

  const acceptedRows = rows.filter(r => isAccepted(r.key))
  const credentialRows = rows.filter(r => r.isPrivate)
  const uncheckedCredentials = credentialRows.filter(r => !isAccepted(r.key)).length

  // ── apply ───────────────────────────────────────────────────────────────────────────────

  // NOTE Apply is reachable with NOTHING ticked, deliberately: the source-doc decision is itself
  // actionable in both states — ticked stores the document, unticked deletes any stored one.
  // Gating on acceptedRows alone meant a host wanting to REVOKE had to re-import AND accept some
  // unrelated field, which made "untick deletes" true only as a side effect of another write.
  // There is no condition to test here: this component never queries whether a row already
  // exists, so only `applying` disables the button.

  async function apply() {
    if (!proposal) return
    setApplying(true)
    setResults(null)

    const basics: AcceptedImport['basics'] = {}
    for (const r of acceptedRows.filter(r => r.tab === 'basic')) {
      const key = r.key.slice('basics.'.length) as keyof ImportProposal['basics']
      if (key === 'max_guests') basics.max_guests = Number(r.proposed)
      else (basics as Record<string, string>)[key] = r.proposed
    }

    const wifiSsid = acceptedRows.find(r => r.key === 'wifi.ssid')?.proposed
    const wifiPass = acceptedRows.find(r => r.key === 'wifi.password')?.proposed
    // The payload carries `undefined` for any half the host did not accept, and applyImport
    // treats `undefined` as "keep what is already stored" — it does NOT write an empty string.
    // That matters because a field the document never mentioned produces no review row at all,
    // so the host was never shown it and never chose to clear it.
    const wifi = wifiSsid != null || wifiPass != null ? { ssid: wifiSsid, password: wifiPass } : null

    const ci = acceptedRows.filter(r => r.tab === 'checkin')
    const checkin = ci.length
      ? {
          check_in_from: ci.find(r => r.key.endsWith('check_in_from'))?.proposed,
          check_out_by: ci.find(r => r.key.endsWith('check_out_by'))?.proposed,
          door_code: ci.find(r => r.key.endsWith('door_code'))?.proposed,
          entry_instructions: ci.find(r => r.key.endsWith('entry_instructions'))?.proposed,
        }
      : null

    const extras = acceptedRows
      .filter(r => r.tab === 'extras')
      .map(r => ({ category: r.label, content: r.proposed }))

    try {
      const res = await onApply({
        basics,
        wifi,
        checkin,
        rules: acceptedRows.find(r => r.key === 'rules')?.proposed ?? null,
        extras,
        picksText: acceptedRows.find(r => r.key === 'picks')?.proposed ?? null,
        // EXACTLY the text the server sorted from, computed with the SAME transform the endpoint
        // applies (truncateForImport over the trimmed text). This is not belt-and-braces: only the
        // FILE path runs acceptText, so a PASTED document arrives untruncated and the server cuts
        // it — storing raw `text` would have made the chat answer from more than was ever sorted.
        // (WhatsApp stamp stripping is file-path only and the server does not re-apply it, so a
        // pasted chat log keeps its stamps here exactly as the model saw them.)
        sourceDoc: keepSourceDoc ? truncateForImport(text.trim()).text : null,
      })
      setResults(res)
      // The extracted text, the proposal and the conflict list all hold door codes and WiFi
      // passwords — `conflicts` is precisely where a SECOND candidate door code lives. Once
      // applied there is no reason to keep any of them in memory. Safe because the `results`
      // early return above precedes every reader of `proposal`, and `rows` degrades to [].
      if (res.some(r => r.ok)) {
        setText('')
        setFileName(null)
        setProposal(null)
        setConflicts([])
        setSkipped([])
        setRedacted(0)
      }
    } catch {
      setResults([{ section: 'Import', ok: false, message: 'Something went wrong — nothing further was applied.' }])
    } finally {
      // finally, not a trailing call: onApply awaits network work, and a throw would otherwise
      // leave both buttons disabled with no message.
      setApplying(false)
    }
  }

  // ── render ──────────────────────────────────────────────────────────────────────────────

  // The card is a shortcut for an empty property, not permanent furniture.
  if (stage === 'entry' && (dismissed || filledTabCount >= 3)) return null

  if (stage === 'entry') {
    return (
      <div className={`${CARD} mb-5`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className={HEADING}>Have it all in one file?</h2>
            <p className="text-[13px] text-[#6b6459] mt-1.5 max-w-[60ch]">
              If you already have a guest guide or house manual, upload it and we'll sort it into
              the right tabs for you. You review every field before anything is saved.
            </p>
            <p className="text-[12px] text-[#6b6354] mt-2">
              Importing for <span className="font-medium text-[#231d17]">{propertyName}</span> — one
              file, one property. A guest guide works best; a booking-platform export will fill in less.
            </p>
          </div>
          <button onClick={dismiss} className="text-[11px] text-[#6b6354] hover:text-[#231d17] shrink-0">
            No thanks
          </button>
        </div>
        <button onClick={() => setStage('extract')} className={`${BTN_AI} mt-4`}>
          Import from a file
        </button>
      </div>
    )
  }

  if (stage === 'extract') {
    return (
      <div className={`${CARD} mb-5`}>
        <h2 className={HEADING}>Import into {propertyName}</h2>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".docx,.pdf,.txt,.md"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
          />
          <button onClick={() => fileRef.current?.click()} disabled={extracting} className={BTN_OUTLINE}>
            {extracting ? 'Reading…' : 'Choose a file'}
          </button>
          {fileName && (
            <span className="text-[12px] text-[#231d17] bg-[#f0ede6] border border-[#e4ddd0] rounded-[8px] px-2.5 py-1">
              {fileName}
            </span>
          )}
          <span className="text-[11px] text-[#6b6354]">.docx or .pdf</span>
        </div>

        <p className="text-[11px] text-[#6b6354] mt-2.5 max-w-[70ch]">
          Your file is read on your device and never uploaded — only the text below is sent to
          Bemgu, to sort it into your tabs. You choose at the end whether we also keep it for your
          guest chat. Nothing is saved until you review it.
        </p>

        {extractError && (
          <p className="text-[12px] text-[#8a1a1a] bg-[#fde4e4] border border-[#f2caca] rounded-[10px] px-3 py-2 mt-3">
            {extractError}
          </p>
        )}

        <label className="block text-[10px] font-medium uppercase tracking-[.12em] text-[#a79e8e] mt-4 mb-1.5">
          Text to sort — edit or delete anything you don't want to send
        </label>
        <textarea
          value={text}
          onChange={e => { setText(e.target.value); setTruncated(false) }}
          rows={12}
          placeholder="Paste your guest guide here, or choose a file above."
          className="w-full bg-white border border-[#e0dacd] rounded-[10px] px-3.5 py-2.5 text-[13px] text-[#1c1c1a] placeholder:text-[#b3ab9b] focus:outline-none focus:border-[#c8a24e] focus:ring-2 focus:ring-[#c8a24e]/20 transition-colors font-mono"
        />
        {truncated && (
          <p className="text-[12px] text-[#7a4800] bg-[#faeeda] border border-[#eddcc0] rounded-[10px] px-3 py-2 mt-2">
            That's a long document, so we've kept the first part of it. Everything below the cut
            isn't included — you can import the rest separately.
          </p>
        )}
        {sortError && (
          <p className="text-[12px] text-[#8a1a1a] bg-[#fde4e4] border border-[#f2caca] rounded-[10px] px-3 py-2 mt-2">
            {sortError}{' '}
            <button onClick={() => void sortIt()} disabled={sorting} className="underline font-medium disabled:opacity-40">
              {sorting ? 'Sorting…' : 'Try again'}
            </button>
          </p>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button onClick={() => void sortIt()} disabled={sorting || !text.trim()} className={BTN_AI}>
            {sorting ? 'Sorting…' : 'Sort it into my tabs'}
          </button>
          <button onClick={() => setStage('entry')} className={BTN_OUTLINE}>Cancel</button>
        </div>
      </div>
    )
  }

  // ── Stage 3: review ────────────────────────────────────────────────────────────────────

  // Results render ALONE — the review rows are gone by now. That is what lets apply() drop
  // `proposal` as well as `text`: both hold the door code and the WiFi password, and keeping the
  // rows on screen "so the host can see what was applied" would have kept the credentials in
  // state to no purpose. The per-section list below IS the record of what was applied.
  if (results) {
    return (
      <div className={`${CARD} mb-5`}>
        <h2 className={HEADING}>What we applied</h2>
        <div className="mt-3 space-y-1.5">
          {results.map(r => (
            <p key={r.section} className={`text-[12px] ${r.ok ? 'text-[#2a5c0a]' : 'text-[#8a1a1a]'}`}>
              {r.ok ? '✓' : '✕'} {r.section}{r.message ? ` — ${r.message}` : ''}
            </p>
          ))}
        </div>
        <button
          onClick={() => { if (results.some(r => r.ok)) dismiss(); setStage('entry') }}
          className={`${BTN_OUTLINE} mt-4`}
        >
          Done
        </button>
      </div>
    )
  }

  const nothingFound = rows.length === 0

  return (
    <div className={`${CARD} mb-5`}>
      <h2 className={HEADING}>What we found in your file</h2>

      {/* ABOVE the nothingFound ternary on purpose. If every proposed field was code-bearing,
          rows.length === 0 and the empty-state branch below explains the file as "a booking
          confirmation rather than a guest guide" — actively wrong, and it is exactly the case
          where the scrub did the most work. The count must be reachable in both branches. */}
      {redacted > 0 && (
        <p className="text-[12px] text-[#6b6459] bg-[#f8f6f2] border border-[#e4ddd0] rounded-[10px] px-3 py-2 mt-3">
          We left {redacted} sentence{redacted === 1 ? '' : 's'} out of the public sections —
          {redacted === 1 ? ' it looked like it contained' : ' they looked like they contained'} an
          access code, and codes belong only in WiFi and Check-in.
        </p>
      )}

      {nothingFound ? (
        <>
          <p className="text-[13px] text-[#6b6459] mt-1.5 max-w-[60ch]">
            We couldn't find anything that maps onto your tabs. That usually means the file is a
            booking confirmation or a policy document rather than a guest guide. You can paste a
            different document, or fill the tabs in yourself — it doesn't take long.
          </p>
          <div className="flex gap-2 mt-4">
            <button onClick={() => setStage('extract')} className={BTN_OUTLINE}>Try another file</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[13px] text-[#6b6459] mt-1.5 max-w-[62ch]">
            Nothing is saved yet. Tick what you want, untick what you don't — Apply writes only
            the ticked rows into your tabs.
          </p>


          {TAB_ORDER.map(tab => {
            const group = rows.filter(r => r.tab === tab)
            // Per-tab explainer for the two tabs a platform export never contains — and only
            // when the import found something else, so a wholly empty result gets the single
            // global message above instead of six separate apologies.
            if (group.length === 0) {
              if (tab !== 'wifi' && tab !== 'checkin') return null
              return (
                <div key={tab} className="mt-5">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px] text-[#6b6354]">goes into →</span>
                    {tabPill(tab)}
                  </div>
                  <p className="text-[12px] text-[#6b6354] pl-1">
                    {tab === 'wifi'
                      ? "No WiFi details in this file. Booking-platform exports never include them — add yours in the WiFi tab."
                      : "No check-in times or door code in this file. These are usually sent to guests separately — add yours in the Check-in tab."}
                  </p>
                </div>
              )
            }
            return (
              <div key={tab} className="mt-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] text-[#6b6354]">goes into →</span>
                  {tabPill(tab)}
                </div>
                <div className="space-y-2">
                  {group.map(r => {
                    const same = isSame(r)
                    const on = isAccepted(r.key)
                    return (
                      <div key={r.key} className="border border-[#e4ddd0] rounded-[10px] p-3 bg-white">
                        <div className="flex items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(r.key)}
                            id={domId(r.key)}
                            className="mt-0.5 accent-[#c8a24e]"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <label htmlFor={domId(r.key)} className="text-[13px] font-medium text-[#231d17]">
                                {r.label}
                              </label>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                                r.isPrivate ? 'bg-[#fde4e4] text-[#8a1a1a]' : 'bg-[#e4f0da] text-[#2a5c0a]'
                              }`}>
                                {r.isPrivate ? 'guests with a booking only' : 'visible to all guests'}
                              </span>
                              {r.isPrivate && !on && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#faeeda] text-[#7a4800]">
                                  needs your tick — will be private
                                </span>
                              )}
                              {/* TWO SEPARATE controls, not one heuristic split two ways — the
                                  badge above is driven by `isPrivate && !on` and fires on every
                                  unticked private row, while this one is the credential heuristic,
                                  which returns false for private rows entirely. A credential
                                  heading for WiFi/Check-in only needs a tick; the same text
                                  heading for a PUBLIC tab is the leak, and says so in the
                                  strongest colour on the screen. */}
                              {looksLikeCredential(r) && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#8a1a1a] text-[#fff5f5] font-medium">
                                  careful — this would be visible to ALL guests
                                </span>
                              )}
                              {same && <span className="text-[11px] text-[#6b6354]">same as you have</span>}
                            </div>

                            <div className="grid sm:grid-cols-2 gap-2.5 mt-2">
                              <div>
                                {/* The caption carries the CONSEQUENCE, not just the label: the
                                    tester who approved the mockup did not know what ticking did,
                                    and this column is where the answer belongs. */}
                                <div className="text-[10px] uppercase tracking-[.1em] text-[#a79e8e] mb-1">
                                  {r.currentText.trim() ? 'In your tab now — replaced if you tick' : 'In your tab now'}
                                </div>
                                <div className="text-[12px] text-[#6b6459] whitespace-pre-wrap break-words">
                                  {r.currentText.trim() || <span className="text-[#b3ab9b]">empty</span>}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] uppercase tracking-[.1em] text-[#a79e8e] mb-1">Found in your file</div>
                                <div className="text-[12px] text-[#231d17] whitespace-pre-wrap break-words">{r.proposed}</div>
                              </div>
                            </div>

                            {r.conflictValues && r.conflictValues.length > 1 && (
                              <p className="text-[11px] text-[#7a4800] bg-[#faeeda] border border-[#eddcc0] rounded-[8px] px-2.5 py-1.5 mt-2">
                                Your file says this more than once: {r.conflictValues.join(' · ')}. We've
                                put the likelier one above — check it's the right one.
                              </p>
                            )}
                            {looksLikeCredential(r) && (
                              <p className="text-[11px] text-[#8a1a1a] mt-2">
                                This is going somewhere every guest can see, and it looks like it
                                might contain a password, a door code or a number sequence. If it
                                does, leave it unticked and put it in the WiFi or Check-in tab
                                instead.
                              </p>
                            )}
                            {r.note && <p className="text-[11px] text-[#6b6354] mt-2">{r.note}</p>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {skipped.length > 0 && (
            <div className="mt-5 border border-[#e4ddd0] rounded-[10px] p-3.5 bg-[#f8f6f2]">
              <div className="text-[12px] font-medium text-[#231d17] mb-1.5">Left out on purpose</div>
              <div className="flex flex-wrap gap-1.5">
                {skipped.map((s, i) => (
                  <span key={i} className="text-[11px] bg-white border border-[#e4ddd0] rounded-full px-2.5 py-0.5 text-[#6b6459]">
                    {s}
                  </span>
                ))}
              </div>
              {skipped.some(s => s.toLowerCase().includes('host contact')) && (
                <p className="text-[11px] text-[#6b6354] mt-2">
                  We haven't put your phone number or email into your tabs, so they won't appear on
                  your guest page. If you keep your document for the guest chat below, note it is
                  stored as you wrote it — anything in it can be quoted to a guest with a booking.
                </p>
              )}
            </div>
          )}

          {/* A final card AFTER the tab groups, deliberately not a Row: this is not a field diff,
              it has no "in your tab now" side, and it decides what the CHAT can read rather than
              what a tab will show. Placed last so it reads as the final decision before Apply. */}
          <div className="mt-5 border border-[#e4ddd0] rounded-[10px] p-3.5 bg-[#f8f6f2]">
            <label htmlFor="imp-source-doc" className="flex items-start gap-2.5 cursor-pointer">
              <input
                id="imp-source-doc"
                type="checkbox"
                checked={keepSourceDoc}
                onChange={() => setKeepSourceDoc(v => !v)}
                className="mt-0.5 accent-[#c8a24e]"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-[#231d17]">
                  Let the guest chat use this document
                </span>
                <span className="block text-[12px] text-[#6b6459] mt-1 max-w-[62ch]">
                  Guests can ask the chat anything — "where do I find picnic bags?" — and it will
                  answer from your document, not just from the tabs. Your document is stored with
                  this property and read only by guests with a confirmed booking. Untick and Apply
                  at any time to remove it.
                </span>
              </span>
            </label>
          </div>

          <div className="sticky bottom-0 -mx-5 -mb-5 mt-5 px-5 py-3.5 bg-[#fffdf9] border-t border-[#e4ddd0] rounded-b-[14px]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[12px] text-[#6b6459]">
                  {acceptedRows.length} of {rows.length} selected
                  {uncheckedCredentials > 0 && (
                    <span className="text-[#7a4800]">
                      {' '}· {uncheckedCredentials} WiFi/check-in {uncheckedCredentials === 1 ? 'field needs' : 'fields need'} your tick
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setStage('extract')} className={BTN_OUTLINE} disabled={applying}>Back</button>
                  <button onClick={() => void apply()} disabled={applying} className={BTN_SAVE}>
                    {applying
                      ? 'Applying…'
                      : acceptedRows.length > 0
                        ? `Apply ${acceptedRows.length} field${acceptedRows.length === 1 ? '' : 's'}`
                        : keepSourceDoc
                          ? 'Save chat knowledge'
                          : 'Remove chat knowledge'}
                  </button>
                </div>
              </div>
            </div>
        </>
      )}
    </div>
  )
}
