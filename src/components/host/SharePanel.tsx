import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Download, Printer, Copy, Check, AlertTriangle, EyeOff } from 'lucide-react'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import { ARRIVLY_CONFIG } from '../../config'
import { useToast } from '../shared/Toast'
import Loader from '../shared/Loader'

// Matches the DB CHECK `apartments_welcome_message_len` (char_length <= 2000). JS
// String.length counts UTF-16 units, which is >= the code-point count Postgres counts,
// so a value passing this guard always passes the CHECK — never the other way round.
const MESSAGE_MAX = 2000
const COUNTER_VISIBLE_FROM = MESSAGE_MAX - 200

interface ApartmentShare {
  id: string
  name: string
  neighborhood: string | null
  is_visible: boolean
  welcome_code: string | null
  welcome_message: string | null
  qr_secret: string | null
  hasPicks: boolean
}

function guestUrl(aptId: string, secret: string | null) {
  // Keyed URL unlocks the tokenless date-lookup in /api/guest-state. If the
  // secret is missing, fall back to the keyless URL so the card still renders.
  return secret
    ? `${ARRIVLY_CONFIG.appUrl}/guest?apt=${aptId}&key=${secret}`
    : `${ARRIVLY_CONFIG.appUrl}/guest?apt=${aptId}`
}

function welcomeUrl(code: string) {
  return `${ARRIVLY_CONFIG.appUrl}/w/${code}`
}

// The default share message. NEVER written to the DB on render — only an explicit
// Save persists anything, so `welcome_message IS NULL` keeps meaning "unedited" and
// a future wording change reaches every host who never edited theirs.
function defaultMessage(url: string) {
  return `Hi — we're really glad you're coming.

Before you travel, here's your guide to the flat and the neighbourhood:
${url}

You'll find our own favourite places to eat and drink nearby, tours and tickets you can book ahead, and a chat that answers questions any time of day.

Worth opening now rather than on arrival — the best tables and tours go early.

See you soon.`
}

// A message without the link is the one failure mode that makes this feature pointless,
// so a save that dropped it gets the link appended rather than rejected.
function ensureUrl(text: string, url: string) {
  return text.includes(url) ? text : `${text.replace(/\s+$/, '')}\n\n${url}`
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'qr'
}

function useCopy() {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(t)
  }, [copied])
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {})
  }
  return { copied, copy }
}

/* ---------------------------------------------------------------- Step 1 */

function SendStep({
  apt,
  hostId,
  onSaved,
}: {
  apt: ApartmentShare
  hostId: string
  onSaved: (aptId: string, message: string) => void
}) {
  const { toast } = useToast()
  const { copied, copy } = useCopy()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  // welcome_code is NULL-checked by the caller; this component only renders with one.
  const url = welcomeUrl(apt.welcome_code as string)
  const message = apt.welcome_message ?? defaultMessage(url)

  function startEdit() {
    setDraft(message)
    setEditing(true)
  }

  async function save() {
    const next = ensureUrl(draft.trim(), url)
    if (!next) { toast('The message can’t be empty.', 'error'); return }
    if (next.length > MESSAGE_MAX) {
      toast(`Too long — ${next.length} of ${MESSAGE_MAX} characters.`, 'error')
      return
    }
    setSaving(true)
    const { error } = await supabase
      .from('apartments')
      .update({ welcome_message: next })
      .eq('id', apt.id)
      .eq('host_id', hostId)
    setSaving(false)
    if (error) {
      // The DB CHECK is the real bound; surface it in the host's language.
      toast(
        error.message.includes('welcome_message_len')
          ? `That message is too long — keep it under ${MESSAGE_MAX} characters.`
          : error.message,
        'error',
      )
      return
    }
    onSaved(apt.id, next)
    setEditing(false)
    toast('Message saved', 'success')
  }

  const overLimit = draft.length > MESSAGE_MAX
  const showCounter = draft.length >= COUNTER_VISIBLE_FROM

  return (
    <div className="flex-1 min-w-0 rounded-[12px] border border-[#d7e2c2] bg-[#f4f7ec] p-4">
      <h3 className="text-[14px] font-['Fraunces'] font-normal text-[#231d17]">Step 1 — send this</h3>
      <p className="mt-0.5 text-[12px] text-[#6b6354]">
        Paste into Airbnb, Booking.com or WhatsApp once the booking is confirmed.
      </p>

      {!apt.is_visible && (
        <div className="mt-3 flex items-start gap-1.5 rounded-[8px] border border-[#e8d5a8] bg-[#faf3e2] px-2.5 py-2 text-[11.5px] text-[#7a5b12]">
          <EyeOff size={13} className="mt-px shrink-0" />
          <span>This link won’t work until the property is visible to guests.</span>
        </div>
      )}

      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={11}
            maxLength={MESSAGE_MAX}
            aria-label={`Share message for ${apt.name}`}
            className="mt-3 w-full resize-y rounded-[9px] border border-[#d7e2c2] bg-white px-3 py-2.5 text-[12.5px] leading-[1.6] text-[#3f3a32] focus:border-[#c8a24e] focus:outline-none"
          />
          {showCounter && (
            <div className={`mt-1 text-right text-[11px] ${overLimit ? 'text-[#8a1a1a]' : 'text-[#8a8276]'}`}>
              {draft.length} / {MESSAGE_MAX}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving || overLimit}
              className="inline-flex items-center justify-center gap-1.5 rounded-[9px] bg-[#c8a24e] px-3.5 py-2 text-[12.5px] font-semibold text-[#16100d] transition-colors hover:bg-[#e7d6ad] disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-[9px] border border-[#d7e2c2] px-3.5 py-2 text-[12.5px] text-[#6b6354] transition-colors hover:bg-white"
            >
              Cancel
            </button>
          </div>
          <p className="mt-2 text-[11px] text-[#8a8276]">
            The link is added back automatically if you remove it.
          </p>
        </>
      ) : (
        <>
          <div className="mt-3 max-h-[236px] overflow-y-auto whitespace-pre-wrap rounded-[9px] border border-[#d7e2c2] bg-white px-3 py-2.5 text-left text-[12.5px] leading-[1.6] text-[#3f3a32]">
            {message}
          </div>

          {!apt.hasPicks && (
            <p className="mt-2.5 flex items-start gap-1.5 text-[11.5px] text-[#7a5b12]">
              <AlertTriangle size={13} className="mt-px shrink-0" />
              <span>
                Add a few of{' '}
                <Link
                  to={`/dashboard/property/${apt.id}?tab=picks`}
                  className="underline underline-offset-2 hover:text-[#231d17]"
                >
                  your favourite places
                </Link>{' '}
                first — the message mentions them.
              </span>
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => copy(message)}
              className="inline-flex items-center justify-center gap-1.5 rounded-[9px] bg-[#c8a24e] px-3.5 py-2 text-[12.5px] font-semibold text-[#16100d] transition-colors hover:bg-[#e7d6ad]"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy message'}
            </button>
            <button
              type="button"
              onClick={startEdit}
              className="rounded-[9px] border border-[#d7e2c2] px-3.5 py-2 text-[12.5px] text-[#6b6354] transition-colors hover:bg-white"
            >
              Edit
            </button>
          </div>
          <p className="mt-2 text-[11px] text-[#8a8276]">Edits are saved for this property only.</p>
        </>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- Step 2 */

function PrintStep({ apt }: { apt: ApartmentShare }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const url = guestUrl(apt.id, apt.qr_secret)

  useEffect(() => {
    if (!canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, url, {
      width: 180,
      margin: 2,
      color: { dark: '#1a1a1a', light: '#ffffff' },
    })
  }, [url])

  function download() {
    if (!canvasRef.current) return
    const link = document.createElement('a')
    link.download = `bemgu-qr-${slugify(apt.name)}.png`
    link.href = canvasRef.current.toDataURL('image/png')
    link.click()
  }

  function printCard() {
    if (!canvasRef.current) return
    const w = window.open('', '_blank')
    if (!w) return
    const img = canvasRef.current.toDataURL('image/png')
    w.document.write(`<html><body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;"><img src="${img}" style="width:300px"/><p style="font-family:monospace;font-size:11px;text-align:center">${url}</p></body></html>`)
    w.document.close()
    w.print()
  }

  return (
    <div className="w-full shrink-0 rounded-[12px] border border-[#e4ddd0] bg-[#fdfbf7] p-4 lg:w-[268px]">
      <h3 className="text-[14px] font-['Fraunces'] font-normal text-[#231d17]">Step 2 — print this</h3>
      <p className="mt-0.5 text-[12px] text-[#6b6354]">
        Put it up inside the flat. Guests scan it once they arrive.
      </p>

      <div className="mt-3 flex justify-center rounded-[10px] border border-[#e4ddd0] bg-white p-3">
        <canvas ref={canvasRef} aria-label={`QR code for ${apt.name}`} style={{ width: 148, height: 148 }} />
      </div>

      <div className="mt-3 flex items-start gap-1.5 rounded-[8px] border border-[#f0c9c9] bg-[#fcebeb] px-2.5 py-2 text-[11.5px] text-[#8a1a1a]">
        <AlertTriangle size={13} className="mt-px shrink-0" />
        <span>Don’t send this one to guests — it’s for the wall.</span>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={download}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-[9px] bg-[#c8a24e] px-3 py-2 text-[12.5px] font-semibold text-[#16100d] transition-colors hover:bg-[#e7d6ad]"
        >
          <Download size={14} /> Download
        </button>
        <button
          type="button"
          onClick={printCard}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-[9px] border border-[#e4ddd0] px-3 py-2 text-[12.5px] text-[#6b6354] transition-colors hover:bg-[#f0ede6]"
        >
          <Printer size={14} /> Print
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------- demoted fallback */

function GuestUrlFallback({ apt }: { apt: ApartmentShare }) {
  const [open, setOpen] = useState(false)
  const { copied, copy } = useCopy()
  const url = guestUrl(apt.id, apt.qr_secret)

  return (
    <div className="mt-3 flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="text-[11.5px] text-[#8a8276] underline underline-offset-2 transition-colors hover:text-[#231d17]"
      >
        Guest can’t scan the code?
      </button>
      {open && (
        <div className="flex w-full items-center gap-2 rounded-[9px] border border-[#e4ddd0] bg-[#f7f3ec] px-2.5 py-2">
          <span className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-[#6b6354]">{url}</span>
          <button
            type="button"
            onClick={() => copy(url)}
            aria-label={copied ? 'Copied' : 'Copy guest page URL'}
            className="shrink-0 text-[#8a8276] transition-colors hover:text-[#231d17]"
          >
            {copied ? <Check size={15} className="text-[#5d7c34]" /> : <Copy size={15} />}
          </button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ card */

function PropertyShareCard({
  apt,
  hostId,
  onSaved,
}: {
  apt: ApartmentShare
  hostId: string
  onSaved: (aptId: string, message: string) => void
}) {
  return (
    <div className="rounded-[14px] border border-[#e4ddd0] bg-[#fffdf9] p-5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[15px] font-semibold text-[#231d17]">{apt.name}</span>
        {apt.neighborhood && (
          <span className="inline-flex items-center gap-1 text-[12px] text-[#8a8276]">
            <MapPin size={12} className="shrink-0" />
            {apt.neighborhood}
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3.5 lg:flex-row">
        {apt.welcome_code ? (
          <SendStep apt={apt} hostId={hostId} onSaved={onSaved} />
        ) : (
          <div className="flex-1 min-w-0 rounded-[12px] border border-[#e4ddd0] bg-[#f7f3ec] p-4">
            <h3 className="text-[14px] font-['Fraunces'] font-normal text-[#231d17]">Step 1 — send this</h3>
            <p className="mt-1.5 text-[12px] text-[#8a8276]">
              The welcome link isn’t available for this property yet. The QR code below works as usual.
            </p>
          </div>
        )}
        <PrintStep apt={apt} />
      </div>

      <GuestUrlFallback apt={apt} />
    </div>
  )
}

/* ----------------------------------------------------------------- panel */

type RawApt = {
  id: string
  name: string
  neighborhood: string | null
  is_visible: boolean
  welcome_code: string | null
  welcome_message: string | null
}

export default function SharePanel() {
  const [apts, setApts] = useState<ApartmentShare[]>([])
  const [hostId, setHostId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { if (alive) setLoading(false); return }
      const { data } = await supabase
        .from('apartments')
        .select('id, name, neighborhood, is_visible, welcome_code, welcome_message')
        .eq('host_id', user.id)
        .order('created_at')
      const rows = (data ?? []) as RawApt[]
      const mapped: ApartmentShare[] = rows.map(a => ({ ...a, qr_secret: null, hasPicks: false }))

      // Fetch per-apartment QR secrets (host-authenticated, own apartments only)
      // and merge each onto its apartment. Best-effort: if it fails, cards render
      // with the keyless fallback URL rather than crashing.
      try {
        const { secrets } = await api.post<{ secrets: Record<string, string> }>('/qr-secrets', {})
        for (const a of mapped) a.qr_secret = secrets[a.id] ?? null
      } catch { /* keep keyless fallback URLs */ }

      // ONE batched query for the picks warning, not one per card. Only presence
      // matters, so the ids are folded into a Set rather than counted.
      if (mapped.length) {
        const { data: picks } = await supabase
          .from('host_picks')
          .select('apartment_id')
          .in('apartment_id', mapped.map(a => a.id))
        const withPicks = new Set((picks ?? []).map(p => (p as { apartment_id: string }).apartment_id))
        for (const a of mapped) a.hasPicks = withPicks.has(a.id)
      }

      if (!alive) return
      setHostId(user.id)
      setApts(mapped)
      setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [])

  function handleSaved(aptId: string, message: string) {
    setApts(prev => prev.map(a => (a.id === aptId ? { ...a, welcome_message: message } : a)))
  }

  const cards = useMemo(
    () =>
      apts.map(apt => (
        <PropertyShareCard key={apt.id} apt={apt} hostId={hostId as string} onSaved={handleSaved} />
      )),
    [apts, hostId],
  )

  if (loading) return <Loader />

  return (
    <div className="font-['Inter'] max-w-5xl">
      <header className="mb-7">
        <h1 className="text-[25px] font-['Fraunces'] font-light text-[#231d17]">Share</h1>
        <p className="text-[13px] text-[#8a8276] mt-1">
          Two things per property: a link you send before the trip, and a code you print for the wall.
        </p>
      </header>

      {apts.length === 0 ? (
        <div className="text-center py-16 text-[#b3aa9b] text-[13px]">No properties yet.</div>
      ) : (
        <div className="flex flex-col gap-3.5">{cards}</div>
      )}
    </div>
  )
}
