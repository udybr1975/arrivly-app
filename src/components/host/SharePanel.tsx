import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Download, Printer, Copy, Check, AlertTriangle, EyeOff, RefreshCw } from 'lucide-react'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import { ARRIVLY_CONFIG } from '../../config'
import { useToast } from '../shared/Toast'
import { DEFAULT_PLATFORM, PLATFORMS, platformById, type PlatformId, type PlatformRecord } from './sharePlatforms'
import Loader from '../shared/Loader'

// Matches the DB CHECK `apartments_welcome_message_len` (char_length <= 2000). JS
// String.length counts UTF-16 units, which is >= the code-point count Postgres counts,
// so a value passing this guard always passes the CHECK — never the other way round.
// The CHECK is the real bound; everything below it is defence-in-depth.
const MESSAGE_MAX = 2000

interface ApartmentShare {
  id: string
  name: string
  neighborhood: string | null
  is_visible: boolean
  welcome_code: string | null
  welcome_message: string | null
  qr_secret: string | null
  // Tri-state on purpose. `null` = the picks query FAILED, which must render exactly
  // like "has picks" — the nag says the host's work is missing, so guessing loudly on a
  // transient error is the one direction that must never happen.
  hasPicks: boolean | null
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

// The default share message, now per-platform (see ./sharePlatforms). NEVER written to the
// DB on render — only an explicit Save persists anything, so `welcome_message IS NULL` keeps
// meaning "unedited" and a future wording change reaches every host who never edited theirs.
//
// ONE COLUMN, TWO SHAPES: `apartments.welcome_message` is a single value, while the guided
// default deliberately omits the link and the paste-all default carries it. So the DEFAULT
// is chosen by the platform currently selected, and a SAVED message is shown as the host
// wrote it, on every platform.
//
// THAT LEAVES TWO CROSSINGS, NOT ONE, AND THEY ARE HANDLED DIFFERENTLY — see `copyText` and
// `messageHasUrl` in SendStep. A guided-saved message copied on paste-all is COMPLETED with
// the link (the stored value is untouched, and the result is what a save there would have
// produced). A paste-all-saved message viewed on guided gets a NOTE instead, because
// removing a line from a host's own prose is a rewrite rather than a completion. Never
// mutate a host's saved prose for display.
function defaultMessage(url: string, platform: PlatformRecord) {
  return platform.message(url)
}

// A message without the link is the one failure mode that makes this feature pointless,
// so a save that dropped it gets the link appended rather than rejected. Callers MUST
// reject empty input before calling this — on `''` it would return a bare link under two
// blank lines, which is a truthy value and would sail past an emptiness check placed after.
//
// APPLIES ON 'paste-all' ONLY, and deleting it instead would have been wrong in the other
// direction. On a paste-all platform a message without the link genuinely IS broken, which
// is what this exists for. On a GUIDED platform the message ends before the link ON PURPOSE
// — the host builds the link afterwards from the platform's own tags — so appending here
// would staple a plain, HINT-FREE url onto the end and silently undo the whole design: the
// guest would land on the generic welcome page and never be recognised.
function ensureUrl(text: string, url: string) {
  return text.includes(url) ? text : `${text.replace(/\s+$/, '')}\n\n${url}`
}

// The reduced bound for a draft that is MISSING the link. `ensureUrl` adds it plus two
// newlines AFTER the textarea's own limit has been enforced, so budgeting for the append
// is what stops such a draft becoming an over-length rejection the counter never saw
// coming. Callers pick between this and MESSAGE_MAX per draft — see `limit` in SendStep.
//
// THE RESERVATION FOLLOWS THE APPEND. A guided draft is never appended to, so it must not
// pay for one: charging it would show a host `1958` as their ceiling while the database
// accepts 2000, which is the same class of lying counter the comment above describes.
function effectiveMax(url: string) {
  return MESSAGE_MAX - (url.length + 2)
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'qr'
}

// A copy state keyed by WHICH thing was copied, for a card with more than one copy button.
// `useCopy` cannot be called per step (the step count is data-driven, and hooks are not),
// and one shared flag would tick every button at once — telling a host they copied something
// they did not, on a card whose whole job is getting one exact string into another app.
function useKeyedCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  useEffect(() => {
    if (copiedKey === null) return
    const t = window.setTimeout(() => setCopiedKey(null), 1600)
    return () => window.clearTimeout(t)
  }, [copiedKey])
  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => setCopiedKey(key)).catch(() => {})
  }
  return { copiedKey, copy }
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

function PlatformTabs({
  value,
  onChange,
  disabled,
}: {
  value: PlatformId
  onChange: (id: PlatformId) => void
  disabled: boolean
}) {
  // HORIZONTAL premium tabs, charcoal active pill — the confirmed in-page switcher pattern.
  // A vertical rail was tried elsewhere in this dashboard and rejected: it reads as a second
  // competing menu. `aria-pressed` buttons rather than a full tablist, because these swap
  // instructions in place and do not need roving-tabindex arrow navigation to be usable.
  return (
    <div role="group" aria-label="Where you are sending this" className="mt-3 flex flex-wrap gap-1.5">
      {PLATFORMS.map(pl => {
        const active = pl.id === value
        return (
          <button
            key={pl.id}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(pl.id)}
            className={
              active
                ? 'rounded-full bg-[#1c1c1a] px-3 py-1.5 text-[11.5px] font-semibold text-[#f0ede6] disabled:opacity-60'
                : 'rounded-full border border-[#d7e2c2] px-3 py-1.5 text-[11.5px] text-[#6b6354] transition-colors hover:bg-white disabled:opacity-60'
            }
          >
            {pl.label}
          </button>
        )
      })}
    </div>
  )
}

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
  // TWO independent copy states. One `useCopy` shared between the message button and the
  // step-1 button would tick both at once, telling the host they copied something they did
  // not — on a card whose whole job is getting one exact string into another app.
  const messageCopy = useCopy()
  const stepCopy = useKeyedCopy()
  const [platformId, setPlatformId] = useState<PlatformId>(DEFAULT_PLATFORM)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const platform = platformById(platformId)

  // welcome_code is NULL-checked by the caller; this component only renders with one.
  const url = welcomeUrl(apt.welcome_code as string)
  const message = apt.welcome_message ?? defaultMessage(url, platform)

  // Only a paste-all message is completed by an append, so only it budgets for one.
  const appendsUrl = platform.mode === 'paste-all'
  // The bound that applies to THIS draft. Only a draft missing the link gets the append,
  // so only that draft has to budget for it. Deriving it from the draft rather than
  // pinning it is what stops the counter lying: a stored message saved at the reduced
  // bound comes back ~39 chars longer than that bound, and a pinned limit would then
  // display `1995 / 1958` while silently refusing every keystroke.
  const limit = !appendsUrl || draft.includes(url) ? MESSAGE_MAX : effectiveMax(url)
  const counterFrom = Math.max(0, limit - 200)
  const overLimit = draft.length > limit

  // ONE STORED MESSAGE, TWO PLATFORM SHAPES — and BOTH crossings have to be handled. The
  // save path is not enough on its own, because `ensureUrl` runs only on save while the host
  // can switch platforms afterwards and copy whatever is on screen.
  //
  // GUIDED-SAVED, VIEWED ON paste-all: the stored prose ends before the link by design, and
  // this card has no steps to supply one — so Copy would hand over a paragraph promising a
  // guide with no link in it, which is the one failure mode that makes the whole feature
  // pointless. The COPIED text is completed here. This is a completion, not a rewrite: the
  // stored value is untouched, and it is exactly what a save on this platform would produce.
  // PRECONDITION NOTE: ensureUrl's contract is that callers reject empty input first, and
  // this line does not — on the unverified record, whose message() returns '', it would
  // yield a bare link under two blank lines. Unreachable today because that record renders
  // the honest panel with NO copy button, so nothing consumes copyText there. If a copy
  // button is ever added to that branch, guard this first.
  const copyText = appendsUrl ? ensureUrl(message, url) : message
  // PASTE-ALL-SAVED, VIEWED ON guided: the stored prose already carries a plain link, and
  // following the steps as well would leave the guest a hint-free link beside a personalised
  // one — the plain one wins if they tap it. This direction CANNOT be fixed by completion,
  // because removing a line from a host's own prose is a rewrite, so it gets a visible note.
  const messageHasUrl = !appendsUrl && message.includes(url)

  const steps = platform.steps(url)
  const targetLine = platform.targetLine(url)
  // GATED ON THE MODE, never on `steps.length`. A guided record that shipped with an empty
  // steps array would otherwise degrade into a paste-all-looking card that still never
  // appends the URL — a silent failure in the wrong direction. Mode is the single fact that
  // decides both what renders and whether the link is appended.
  const guided = platform.mode === 'guided'

  function startEdit() {
    setDraft(message)
    setEditing(true)
  }

  async function save() {
    // Emptiness is tested on the RAW draft, BEFORE ensureUrl — which would otherwise turn
    // '' into a bare link and make this guard unreachable. Rejecting rather than silently
    // restoring the default: a blank box is as likely to be a mistake as an intent, and a
    // silent restore would also be indistinguishable from a save that did nothing.
    const raw = draft.trim()
    if (!raw) {
      toast('The message can’t be empty. Write something, or press Cancel to keep the current one.', 'error')
      return
    }
    // GUIDED SAVES ARE NOT APPENDED TO. See ensureUrl — on this path the message ends
    // before the link deliberately, and an append would replace a personalised link with a
    // plain one without the host ever seeing it happen.
    const next = appendsUrl ? ensureUrl(raw, url) : raw
    if (next.length > MESSAGE_MAX) {
      toast(`Too long — ${next.length} of ${MESSAGE_MAX} characters.`, 'error')
      return
    }
    setSaving(true)
    // `.select('id')` IS NOT DECORATION. PostgREST reports NO ERROR on a zero-row write, so
    // an RLS-denied or mis-scoped update is indistinguishable from an applied one — the host
    // would see "Message saved", the panel would show prose that is not in the database, and
    // they would paste a template believing it was stored. Rows returned is the only proof.
    // Same class as the import consent control (aea7a84) and applyImport's delete.
    const { data: written, error } = await supabase
      .from('apartments')
      .update({ welcome_message: next })
      .eq('id', apt.id)
      .eq('host_id', hostId)
      .select('id')
    setSaving(false)
    if (!error && (written?.length ?? 0) !== 1) {
      toast('We couldn’t save that — please reload and try again.', 'error')
      return
    }
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

  return (
    <div className="flex-1 min-w-0 rounded-[12px] border border-[#d7e2c2] bg-[#f4f7ec] p-4">
      <h3 className="text-[14px] font-['Fraunces'] font-normal text-[#231d17]">Send this before they travel</h3>
      <p className="mt-0.5 text-[12px] text-[#6b6354]">
        Set it up once and your booking platform sends it for every guest. Optional — the QR code works
        on its own.
      </p>

      <PlatformTabs value={platformId} onChange={setPlatformId} disabled={editing} />
      {/* #6b6354 not the muted #8a8276: on this card's #f4f7ec that token computes 3.50:1
          against a 4.5:1 floor, and these lines carry the card's structure rather than
          decorating it. #6b6354 computes 5.47:1 and is already used here. */}
      <p className="mt-2 text-[11.5px] text-[#6b6354]">{platform.blurb}</p>

      {!apt.is_visible && (
        <div className="mt-3 flex items-start gap-1.5 rounded-[8px] border border-[#e8d5a8] bg-[#faf3e2] px-2.5 py-2 text-[11.5px] text-[#7a5b12]">
          <EyeOff size={13} className="mt-px shrink-0" />
          <span>This link won’t work until the property is visible to guests.</span>
        </div>
      )}

      {/* NOT VERIFIED — the honest panel, and nothing else. No steps, no target line, no
          message, no copy button. `verified` is a property of the record, so a caller
          cannot render an untested platform as if it were tested. */}
      {!platform.verified ? (
        <div className="mt-3 rounded-[9px] border border-[#e4ddd0] bg-white px-3 py-2.5 text-[12px] leading-[1.65] text-[#6b6354]">
          {platform.unavailableNote}
        </div>
      ) : editing ? (
        <>
          {/* maxLength is pinned to the DB ceiling, never to `limit`. A maxLength below the
              length of an already-saved message swallows keystrokes with no explanation;
              going over the applicable bound is shown instead, and blocks Save. */}
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={11}
            maxLength={MESSAGE_MAX}
            aria-label={`Share message for ${apt.name}`}
            className="mt-3 w-full resize-y rounded-[9px] border border-[#d7e2c2] bg-white px-3 py-2.5 text-[12.5px] leading-[1.6] text-[#3f3a32] focus:border-[#c8a24e] focus:outline-none"
          />
          {(draft.length >= counterFrom || overLimit) && (
            <div className={`mt-1 text-right text-[11px] ${overLimit ? 'text-[#8a1a1a]' : 'text-[#8a8276]'}`}>
              {draft.length} / {limit}
              {overLimit && <span className="ml-1.5">— too long to save</span>}
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
            {appendsUrl
              ? 'The link is added back automatically if you remove it.'
              : 'This message ends just before the link — you add the link itself afterwards.'}
          </p>
        </>
      ) : (
        <>
          {/* PART 1 — the message. Nine tenths of the work, and one click. */}
          {guided && (
            <div className="mt-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6b6354]">
              1 — the message
            </div>
          )}
          <div className="mt-2 max-h-[236px] overflow-y-auto whitespace-pre-wrap rounded-[9px] border border-[#d7e2c2] bg-white px-3 py-2.5 text-left text-[12.5px] leading-[1.6] text-[#3f3a32]">
            {message}
          </div>

          {messageHasUrl && (
            <p className="mt-2.5 flex items-start gap-1.5 text-[11.5px] text-[#7a5b12]">
              <AlertTriangle size={13} className="mt-px shrink-0" />
              <span>
                Your saved message already contains the plain link. On {platform.label}, delete that line
                before you follow the steps below — otherwise the guest gets both, and the plain one
                doesn’t know who they are.
              </span>
            </p>
          )}

          {apt.hasPicks === false && (
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
              onClick={() => messageCopy.copy(copyText)}
              className="inline-flex items-center justify-center gap-1.5 rounded-[9px] bg-[#c8a24e] px-3.5 py-2 text-[12.5px] font-semibold text-[#16100d] transition-colors hover:bg-[#e7d6ad]"
            >
              {messageCopy.copied ? <Check size={14} /> : <Copy size={14} />}
              {messageCopy.copied ? 'Copied' : 'Copy message'}
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

          {/* PART 2 — the link. Separate from the message ON PURPOSE: the message ends where
              the link goes, so the paste leaves the cursor in exactly the right place. */}
          {guided && (
            <div className="mt-5 border-t border-[#d7e2c2] pt-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6b6354]">
                2 — the link
              </div>
              {platform.stepsIntro && (
                <p className="mt-1.5 text-[11.5px] text-[#6b6354]">{platform.stepsIntro}</p>
              )}

              <ol className="mt-3 space-y-2.5">
                {steps.map((step, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span
                      aria-hidden="true"
                      className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#e7d6ad] text-[10px] font-bold text-[#16100d]"
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] leading-[1.55] text-[#3f3a32]">{step.text}</p>
                      {step.copy && (
                        <div className="mt-1.5 flex items-center gap-2 rounded-[9px] border border-[#d7e2c2] bg-white px-2.5 py-1.5">
                          <span className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-[#6b6354]">
                            {step.copy}
                          </span>
                          <button
                            type="button"
                            onClick={() => stepCopy.copy(`step-${i}`, step.copy as string)}
                            aria-label={stepCopy.copiedKey === `step-${i}` ? 'Copied' : 'Copy the start of the address'}
                            className="shrink-0 text-[#6b6354] transition-colors hover:text-[#231d17]"
                          >
                            {stepCopy.copiedKey === `step-${i}` ? (
                              <Check size={15} className="text-[#5d7c34]" />
                            ) : (
                              <Copy size={15} />
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>

              {/* THE SELF-CHECK. This line is what carries the card: the host compares their
                  own work against it without having to send a test booking. */}
              {targetLine && (
                <div className="mt-3.5 rounded-[10px] border border-[#e7d6ad] bg-[#faf6ea] px-3 py-2.5">
                  <div className="text-[11px] font-semibold text-[#7a5b12]">It should end up looking like this</div>
                  <p className="mt-1.5 break-all font-mono text-[11.5px] leading-[1.5] text-[#3f3a32]">
                    {targetLine}
                  </p>
                  {platform.targetNote && (
                    <p className="mt-1.5 text-[11px] leading-[1.5] text-[#6b6354]">{platform.targetNote}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- Step 2 */

function PrintStep({ apt }: { apt: ApartmentShare }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [renderFailed, setRenderFailed] = useState(false)
  const url = guestUrl(apt.id, apt.qr_secret)

  // A missing secret yields the KEYLESS fallback URL. It renders and prints identically
  // to a keyed one, and a printed code is permanent — so the card refuses to hand over a
  // downloadable or printable artefact rather than let a host paper a flat with a code
  // that will never unlock the tokenless date-lookup. The URL logic itself is untouched.
  const secretMissing = !apt.qr_secret
  const canPrint = !secretMissing && !renderFailed

  useEffect(() => {
    if (!canvasRef.current) return
    let alive = true
    setRenderFailed(false)
    QRCode.toCanvas(canvasRef.current, url, {
      width: 180,
      margin: 2,
      color: { dark: '#1a1a1a', light: '#ffffff' },
    }).catch((err: unknown) => {
      // Unlike the demo card, there is no "Open" link here to fall back on — the code IS
      // the deliverable — so the failure has to be visible rather than swallowed.
      console.error('[share] QR render failed', err)
      if (alive) setRenderFailed(true)
    })
    return () => { alive = false }
  }, [url])

  function download() {
    if (!canvasRef.current || !canPrint) return
    const link = document.createElement('a')
    link.download = `bemgu-qr-${slugify(apt.name)}.png`
    link.href = canvasRef.current.toDataURL('image/png')
    link.click()
  }

  function printCard() {
    if (!canvasRef.current || !canPrint) return
    const w = window.open('', '_blank')
    if (!w) return
    const img = canvasRef.current.toDataURL('image/png')
    w.document.write(`<html><body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;"><img src="${img}" style="width:300px"/><p style="font-family:monospace;font-size:11px;text-align:center">${url}</p></body></html>`)
    w.document.close()
    w.print()
  }

  return (
    <div className="w-full shrink-0 rounded-[12px] border border-[#e4ddd0] bg-[#fdfbf7] p-4 lg:w-[268px]">
      <h3 className="text-[14px] font-['Fraunces'] font-normal text-[#231d17]">Print this for the wall</h3>
      <p className="mt-0.5 text-[12px] text-[#6b6354]">
        Put it up inside the flat. Guests scan it once they arrive — it works whether or not you ever
        set the message up, and being in the room is what proves they’re really your guest.
      </p>

      <div className="mt-3 flex justify-center rounded-[10px] border border-[#e4ddd0] bg-white p-3">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`QR code for ${apt.name}`}
          style={{ width: 148, height: 148 }}
        />
      </div>

      {renderFailed ? (
        <div className="mt-3 flex items-start gap-1.5 rounded-[8px] border border-[#f0c9c9] bg-[#fcebeb] px-2.5 py-2 text-[11.5px] text-[#8a1a1a]">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>Couldn’t render the code. Reload the page to try again.</span>
        </div>
      ) : secretMissing ? (
        <div className="mt-3 flex items-start gap-1.5 rounded-[8px] border border-[#e8d5a8] bg-[#faf3e2] px-2.5 py-2 text-[11.5px] text-[#7a5b12]">
          <RefreshCw size={13} className="mt-px shrink-0" />
          <span>This code isn’t ready yet — reload before printing, so you don’t put up a code that stops working.</span>
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-1.5 rounded-[8px] border border-[#f0c9c9] bg-[#fcebeb] px-2.5 py-2 text-[11.5px] text-[#8a1a1a]">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>Don’t send this one to guests — it’s for the wall.</span>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={download}
          disabled={!canPrint}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-[9px] bg-[#c8a24e] px-3 py-2 text-[12.5px] font-semibold text-[#16100d] transition-colors hover:bg-[#e7d6ad] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-[#c8a24e]"
        >
          <Download size={14} /> Download
        </button>
        <button
          type="button"
          onClick={printCard}
          disabled={!canPrint}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-[9px] border border-[#e4ddd0] px-3 py-2 text-[12.5px] text-[#6b6354] transition-colors hover:bg-[#f0ede6] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
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
  const panelId = useId()
  const url = guestUrl(apt.id, apt.qr_secret)

  return (
    <div className="mt-3 flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="text-[11.5px] text-[#8a8276] underline underline-offset-2 transition-colors hover:text-[#231d17]"
      >
        Guest can’t scan the code?
      </button>
      {open && (
        <div
          id={panelId}
          className="flex w-full items-center gap-2 rounded-[9px] border border-[#e4ddd0] bg-[#f7f3ec] px-2.5 py-2"
        >
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
    <section aria-label={apt.name} className="rounded-[14px] border border-[#e4ddd0] bg-[#fffdf9] p-5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        {/* A real heading, so a screen-reader heading list distinguishes the cards
            instead of reading "Step 1 / Step 2" once per property. */}
        <h2 className="text-[15px] font-semibold text-[#231d17]">{apt.name}</h2>
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
            <h3 className="text-[14px] font-['Fraunces'] font-normal text-[#231d17]">Send this before they travel</h3>
            <p className="mt-1.5 text-[12px] text-[#8a8276]">
              The welcome link isn’t available for this property yet. The QR code works as usual — nothing
              is blocked by this.
            </p>
          </div>
        )}
        <PrintStep apt={apt} />
      </div>

      <GuestUrlFallback apt={apt} />
    </section>
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
  const [loadError, setLoadError] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    async function load() {
      // A failed/expired session is a FAILURE, not "this host owns nothing" — falling
      // through to the empty state here would recreate, via an expired token, exactly the
      // collapse the apartments-error branch below exists to prevent.
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) {
        console.error('[share] session lookup failed', userError)
        if (alive) { setLoadError(true); setLoading(false) }
        return
      }

      // "The query failed" and "this host has no properties" are different conditions
      // and must not collapse into the same empty state.
      const { data, error } = await supabase
        .from('apartments')
        .select('id, name, neighborhood, is_visible, welcome_code, welcome_message')
        .eq('host_id', user.id)
        .order('created_at')
      if (error) {
        console.error('[share] apartments load failed', error)
        if (alive) { setLoadError(true); setLoading(false) }
        return
      }

      const rows = (data ?? []) as RawApt[]
      const mapped: ApartmentShare[] = rows.map(a => ({ ...a, qr_secret: null, hasPicks: null }))

      // Fetch per-apartment QR secrets (host-authenticated, own apartments only) and
      // merge each onto its apartment. On failure the secret stays null, which PrintStep
      // treats as "not printable yet" rather than silently offering a keyless code.
      try {
        const { secrets } = await api.post<{ secrets: Record<string, string> }>('/qr-secrets', {})
        for (const a of mapped) a.qr_secret = secrets[a.id] ?? null
      } catch (err) {
        console.error('[share] qr-secrets fetch failed', err)
      }

      // ONE batched query for the picks warning, not one per card. Only presence matters,
      // so the ids fold into a Set. On error every hasPicks stays null and the nag is
      // suppressed everywhere — never tell a host their picks are missing on a guess.
      if (mapped.length) {
        const { data: picks, error: picksError } = await supabase
          .from('host_picks')
          .select('apartment_id')
          .in('apartment_id', mapped.map(a => a.id))
        if (picksError) {
          console.error('[share] picks count failed', picksError)
        } else {
          const withPicks = new Set((picks ?? []).map(p => (p as { apartment_id: string }).apartment_id))
          for (const a of mapped) a.hasPicks = withPicks.has(a.id)
        }
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
          Two things per property: a message you send before the trip, and a code you print for the wall.
          The code alone is enough — the message is an upgrade.
        </p>
      </header>

      {loadError ? (
        <div className="flex flex-col items-center gap-3 rounded-[14px] border border-[#f0c9c9] bg-[#fcebeb] px-5 py-12 text-center">
          <AlertTriangle size={20} className="text-[#8a1a1a]" />
          <p className="text-[13px] text-[#8a1a1a]">
            We couldn’t load your properties. This is us, not you — please try again.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#e0b3b3] bg-white px-3.5 py-2 text-[12.5px] text-[#8a1a1a] transition-colors hover:bg-[#fff5f5]"
          >
            <RefreshCw size={13} /> Reload
          </button>
        </div>
      ) : apts.length === 0 ? (
        <div className="text-center py-16 text-[#b3aa9b] text-[13px]">No properties yet.</div>
      ) : (
        <div className="flex flex-col gap-3.5">{cards}</div>
      )}
    </div>
  )
}
