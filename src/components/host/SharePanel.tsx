import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Download, Printer, Copy, Check, AlertTriangle, EyeOff, RefreshCw } from 'lucide-react'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import { ARRIVLY_CONFIG } from '../../config'
import { resolveImageUrl } from '../../lib/imageUtils'
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
  city: string | null
  accent_color: string | null
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

/* ------------------------------------------------ the printed A5 guest card */

// The host's brand row, loaded once by the panel. NULL is a first-class state: the extra
// fetch must NEVER block printing, so a null host degrades to the property name + default
// accent rather than a disabled button.
export type HostBrand = { brand_name: string | null; accent_color: string | null; logo_url: string | null }

const DEFAULT_ACCENT = ARRIVLY_CONFIG.colourPresets[0].hex
const HEX_RE = /^#[0-9a-fA-F]{6}$/

// Host-controlled text goes into generated markup, so it is escaped rather than trusted.
// The window is the host's own, but a brand name is still free text they typed, and
// "it's their own browser" is not a reason to interpolate raw.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// WCAG relative luminance of an sRGB hex.
function relativeLuminance(hex: string): number {
  const channel = (h: string) => {
    const c = parseInt(h, 16) / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return (
    0.2126 * channel(hex.slice(1, 3)) +
    0.7152 * channel(hex.slice(3, 5)) +
    0.0722 * channel(hex.slice(5, 7))
  )
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// CONTRAST IS COMPUTED, NEVER EYEBALLED — and it is computed for EVERY ROLE, not just the
// biggest one. Two rounds of this got it wrong in two different ways, so both are recorded:
//
//   (1) A "luminance > 0.5" threshold looks right and is wrong. For this cream/ink pair the
//       ratios cross at L ≈ 0.2022, so every mid-tone accent in 0.2022–0.5 was handed cream
//       text below the floor — measured: #8a8276 at 3.73:1, brass #c8a24e at 2.37:1.
//   (2) Scoring only the HEADLINE then hid a failure in a SHIPPED preset. Amber (#7a5c00,
//       colourPresets[4]) passed on the 22.5pt headline at 6.15:1 while the 8.8pt sub sat at
//       3.53:1 and the 7.6pt eyebrow at 4.35:1. A big-text pass says nothing about small text.
//
// So: each role carries its own WCAG floor (22.5pt headline and the em inside it are large
// text at 3:1; the 8.8pt sub and 7.6pt eyebrow are normal text at 4.5:1), the set is scored by
// its WORST role's HEADROOM (ratio ÷ floor), and the better set wins. A future token edit
// cannot silently reintroduce (2), because the weakest role is what decides.
//
// `sub` and `eyebrow` were lightened from #c9c2b4 / #e7d6ad to clear Amber; `em` stays
// #e7d6ad because it sits inside the headline at the 3:1 large-text floor. Every preset now
// passes every role — verify with the table in the commit message before changing a token.
// RESIDUAL, and it belongs here rather than only in a commit message: with TWO sets the
// 4.5:1 roles cannot be served for accent luminance 0.1377-0.7056, worst 2.24:1 at L≈0.3266.
// All six shipped presets sit at L <= 0.1179, below that band — but that is a MEASURED fact
// about today's colourPresets, not a structural guarantee, so re-measure if a preset is ever
// added. Closing the band needs a third mid-tone set, which alters the approved comp.
const HERO_DARK_ACCENT = { headline: '#fffdf9', em: '#e7d6ad', sub: '#efe8da', eyebrow: '#f0e6cc' }
const HERO_LIGHT_ACCENT = { headline: '#1c1c1a', em: '#7a5c00', sub: '#4a463d', eyebrow: '#7a5c00' }

// Large text (>= 18pt, or >= 14pt bold) is 3:1; normal text is 4.5:1. These floors are tied to
// the FONT SIZES in the template below — change a size, revisit the floor.
const HERO_ROLE_FLOORS: Record<keyof typeof HERO_DARK_ACCENT, number> = {
  headline: 3,
  em: 3,
  sub: 4.5,
  eyebrow: 4.5,
}

function heroTextSet(accent: string) {
  const headroom = (set: typeof HERO_DARK_ACCENT) =>
    Math.min(
      ...(Object.keys(HERO_ROLE_FLOORS) as (keyof typeof HERO_DARK_ACCENT)[]).map(
        role => contrastRatio(set[role], accent) / HERO_ROLE_FLOORS[role],
      ),
    )
  return headroom(HERO_DARK_ACCENT) >= headroom(HERO_LIGHT_ACCENT) ? HERO_DARK_ACCENT : HERO_LIGHT_ACCENT
}

// Drawn, not an emoji: a ticket emoji renders differently on every OS and prints
// inconsistently, which is exactly the kind of thing a printed artefact cannot recover from.
const TICKET_SVG =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="#a8842f" ' +
  'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M3 8.5V6.5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a2.2 2.2 0 0 0 0 4.4v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a2.2 2.2 0 0 0 0-4.4Z"/>' +
  '<path d="M15 6.2v1.9M15 11.1v1.9M15 15.9v1.4"/>' +
  '</svg>'

type PrintCardInput = {
  brandLine: string
  accent: string
  qrDataUrl: string
  logoUrl: string | null
  title: string
}

// The approved A5 comp (24 Aug 2026), reproduced as a standalone document. Every dimension
// below is tuned so the content fits ONE A5 page — do not add elements or grow sizes
// without re-checking the fit.
//
// KNOWN CONTRAST RESIDUAL, ACCENT-INDEPENDENT — measured, deferred to its own commit rather
// than folded into the hero fix, because these are fixed brand-palette pairs identical on all
// six presets and unchanged by it: .bd 8.4pt #8a8276 on #f4f0e8 = 3.34:1 · .foot-2 7.2pt
// same pair = 3.34:1 · .noapp 7.8pt #8a8276 on #fffdf9 = 3.72:1 · .promo-d 8.2pt #3d2f10 on
// the dark end of the promo gradient #a8842f = 3.73:1. All four are below the 4.5:1 normal-text
// floor. Recorded with the numbers so the next pass does not re-derive them by eye.
//
// CSP DEPENDENCY: this document relies on an inline script and an inline onerror, and the repo
// has no Content-Security-Policy today. Adding one WITHOUT allowing these would stop the card
// printing SILENTLY — nothing outside the document calls print() any more.
function buildPrintCardHtml({ brandLine, accent, qrDataUrl, logoUrl, title }: PrintCardInput): string {
  const t = heroTextSet(accent)
  // A broken bucket path must hide the chip, not print a broken-image icon.
  // ESCAPED like every other interpolation. resolveImageUrl returns an https:// value
  // VERBATIM and hosts.logo_url is client-writable, so a crafted value could otherwise
  // close the attribute — and this document is same-origin with a live window.opener, so
  // that is script execution on our own domain, not in a sandbox.
  const logoChip = logoUrl
    ? '<div class="logo"><img src="' + escapeHtml(logoUrl) + '" alt="" onerror="this.parentElement.style.display=&#39;none&#39;"/></div>'
    : ''

  const benefits: [string, string][] = [
    ['WiFi in one tap', 'Network name and password, ready to copy.'],
    ['Check-in, exactly when you need it', 'Door details and arrival info appear for your stay.'],
    ['Our favourite places nearby', 'Hand-picked spots with walking directions — one tap always leads back home.'],
    ['Ask anything, any hour', 'A guide that knows this home and the city, day and night.'],
  ]
  const benefitRows = benefits
    .map(([h, d]) => `<div class="b"><span class="dot"></span><div><div class="bh">${h}</div><div class="bd">${d}</div></div></div>`)
    .join('')

  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;1,9..144,300&family=Inter:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
  @page { size: A5; margin: 0 }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  html, body { width: 148mm; height: 210mm }
  body {
    background: #f4f0e8; color: #1c1c1a; overflow: hidden;
    display: flex; flex-direction: column;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .hero {
    background: ${accent}; text-align: center; padding: 7mm 12mm 0;
    display: flex; flex-direction: column; align-items: center;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .logo {
    width: 10mm; height: 10mm; border-radius: 50%; background: #fffdf9;
    box-shadow: 0 .8mm 2.4mm rgba(0,0,0,.25); margin-bottom: 2.5mm;
    display: flex; align-items: center; justify-content: center;
  }
  .logo img { width: 7mm; height: 7mm; object-fit: contain }
  .rule { width: 16mm; height: .6mm; background: #c8a24e; margin-bottom: 3.2mm;
          -webkit-print-color-adjust: exact; print-color-adjust: exact }
  .eyebrow {
    font-size: 7.6pt; font-weight: 500; letter-spacing: .32em; text-transform: uppercase;
    color: ${t.eyebrow}; margin-bottom: 3.2mm;
  }
  .headline {
    font-family: 'Fraunces', Georgia, serif; font-weight: 300; font-size: 22.5pt;
    line-height: 1.07; color: ${t.headline}; margin-bottom: 2.2mm;
  }
  .headline em { font-style: italic; color: ${t.em} }
  .sub { font-size: 8.8pt; color: ${t.sub}; line-height: 1.45; max-width: 96mm; margin-bottom: 5mm }
  .arch {
    width: 60mm; padding: 2mm; border: .35mm solid #c8a24e;
    border-radius: 30mm 30mm 3mm 3mm; margin-bottom: -30mm;
    background: linear-gradient(180deg, rgba(200,162,78,.14), rgba(200,162,78,.03));
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .qrcard {
    background: #fffdf9; border-radius: 28mm 28mm 2mm 2mm; padding: 6.5mm 5mm 4mm;
    box-shadow: 0 2mm 6mm rgba(28,28,26,.28); text-align: center;
  }
  .qrcard img { width: 44mm; height: 44mm; display: block; margin: 0 auto 3mm }
  .scan { font-size: 8.6pt; font-weight: 600; color: #231d17 }
  .noapp { font-size: 7.8pt; color: #8a8276; margin-top: .8mm }
  .body { flex: 1; padding: 33mm 14mm 0; display: flex; flex-direction: column }
  .benefits { display: flex; flex-direction: column; gap: 2.6mm }
  .b { display: flex; gap: 2.4mm; align-items: flex-start }
  .dot { width: 2mm; height: 2mm; border-radius: 50%; background: #c8a24e; margin-top: 1.4mm;
         flex: 0 0 auto; -webkit-print-color-adjust: exact; print-color-adjust: exact }
  .bh { font-size: 9.6pt; font-weight: 600; color: #231d17 }
  .bd { font-size: 8.4pt; color: #8a8276; line-height: 1.4 }
  .promo {
    margin-top: 3.6mm; background: linear-gradient(135deg, #c8a24e, #a8842f);
    border-radius: 3mm; padding: 3mm 4mm; box-shadow: 0 1.2mm 3mm rgba(168,132,47,.30);
    display: flex; gap: 3.6mm; align-items: center;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .ticket {
    width: 9mm; height: 9mm; border-radius: 50%; background: #fffdf9; flex: 0 0 auto;
    display: flex; align-items: center; justify-content: center; padding: 2mm;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .promo-h { font-family: 'Fraunces', Georgia, serif; font-weight: 400; font-size: 11.6pt; color: #16100d }
  .promo-d { font-size: 8.2pt; color: #3d2f10; line-height: 1.4 }
  .footer { margin-top: auto; border-top: .25mm solid #e4ddd0; padding: 3mm 14mm 4.5mm; text-align: center }
  .foot-1 { font-size: 8pt; font-weight: 500; color: #231d17 }
  .foot-1 b { color: #a8842f; font-weight: 500 }
  .foot-2 { font-size: 7.2pt; color: #8a8276; margin-top: 1.6mm }
</style></head><body>
  <div class="hero">
    ${logoChip}
    <div class="rule"></div>
    <div class="eyebrow">${brandLine}</div>
    <div class="headline">Consider this<br/>your <em>key.</em></div>
    <div class="sub">WiFi, check-in, and our favourite corners of the neighbourhood — everything for your stay, one scan away.</div>
    <div class="arch"><div class="qrcard">
      <img src="${qrDataUrl}" alt=""/>
      <div class="scan">Scan with your phone camera</div>
      <div class="noapp">No app. No login. It just opens.</div>
    </div></div>
  </div>
  <div class="body">
    <div class="benefits">${benefitRows}</div>
    <div class="promo">
      <div class="ticket">${TICKET_SVG}</div>
      <div>
        <div class="promo-h">Book the best of the city — right here.</div>
        <div class="promo-d">Tours, tickets and experiences, bookable straight from your guide. The good ones sell out — yours are one scan away.</div>
      </div>
    </div>
  </div>
  <div class="footer">
    <div class="foot-1">Free for guests <b>&middot;</b> Works on any phone <b>&middot;</b> Save it to your home screen</div>
    <div class="foot-2">Powered by Bemgu</div>
  </div>
  <script>
    // Print from INSIDE the document, never synchronously after write(): the webfonts, the
    // QR data URL and the logo all resolve async, and a synchronous print() captures the
    // page before they land — which is why the old bare print looked unstyled.
    // LATCHED so print() can only ever fire once: .then(go, go) would still double-fire if
    // go itself threw, and the timeout below can race the load event.
    var printed = false;
    var go = function () {
      if (printed) return;
      printed = true;
      try { window.focus() } catch (e) {}
      window.print();
    };
    // A hung subresource (the Google Fonts link on a captive-portal network) never fires
    // the load event, and nothing outside this document calls print() any more — so without
    // this latch the host gets a blank-looking tab and no dialog at all. Printing with
    // fallback fonts beats not printing.
    setTimeout(go, 4000);
    window.addEventListener('load', function () {
      if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
        document.fonts.ready.then(go, go);
      } else { go() }
    });
  <\/script>
</body></html>`
}

function PrintStep({ apt, host }: { apt: ApartmentShare; host: HostBrand | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [renderFailed, setRenderFailed] = useState(false)
  const { toast } = useToast()
  // The button is not disabled during the await, so without this a double-click opens two
  // windows and raises two print dialogs.
  const printingRef = useRef(false)
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

  async function printCard() {
    if (!canPrint || printingRef.current) return
    printingRef.current = true
    try {
      await openPrintWindow()
    } finally {
      printingRef.current = false
    }
  }

  async function openPrintWindow() {
    // OPEN FIRST, AWAIT SECOND. window.open() must run inside the click's transient
    // activation — a popup opened after an await is blocked outright in the stricter
    // browsers. The existing `if (!w) return` guard stays the safety net.
    const w = window.open('', '_blank')
    if (!w) {
      // Previously a silent return. The button is the only route to this artefact, so a
      // blocked popup has to say so rather than look like a dead button.
      toast('Your browser blocked the print window. Allow pop-ups for this site and try again.', 'error')
      return
    }

    // NOT the on-screen 180px canvas — that upscales to a soft, unscannable 44mm print.
    // margin 0 because the template's cream QR card supplies the quiet zone itself.
    let qrDataUrl: string
    try {
      qrDataUrl = await QRCode.toDataURL(url, {
        width: 720,
        margin: 0,
        color: { dark: '#1c1c1a', light: '#ffffff' },
      })
    } catch (err) {
      // Close the window we already opened rather than leaving a blank tab behind.
      // DELIBERATELY NOT setRenderFailed: that flag gates canPrint, the Download button and
      // the on-screen banner, and it is only ever reset by the effect keyed on `url` — so a
      // transient failure HERE would permanently disable a canvas that is rendering fine.
      // The print path reports its own failure instead.
      console.error('[share] print QR render failed', err)
      w.close()
      toast('We couldn’t prepare the card for printing. Please try again.', 'error')
      return
    }

    // The 720px encode is the one slow step, and a host who closes the popup during it would
    // otherwise reach document.write on a closed window — a silent no-op in Chrome, i.e. the
    // same dead-button symptom the blocked-popup toast exists to prevent.
    if (w.closed) return

    // Same coalesce the guest page uses: per-property override, then the account default,
    // then the first preset. A host can type any hex in the Look tab, so it is validated
    // before it reaches a CSS declaration rather than trusted.
    const rawAccent = apt.accent_color ?? host?.accent_color ?? DEFAULT_ACCENT
    const accent = HEX_RE.test(rawAccent) ? rawAccent : DEFAULT_ACCENT

    // Brand line: brand name, then neighbourhood or city when either exists. A host with no
    // brand_name yet gets the property name alone rather than an empty eyebrow.
    const place = apt.neighborhood ?? apt.city
    const brand = host?.brand_name?.trim() || apt.name
    const brandLine = place ? `${brand} · ${place}` : brand

    // resolveImageUrl returns the FALLBACK_HERO photo for a null input, so it is only
    // called when a logo actually exists — otherwise the chip would print a stock interior.
    const logoUrl = host?.logo_url ? resolveImageUrl(host.logo_url) : null

    w.document.write(
      buildPrintCardHtml({
        brandLine: escapeHtml(brandLine),
        accent,
        qrDataUrl,
        logoUrl,
        title: escapeHtml(`${brand} — guest card`),
      }),
    )
    w.document.close()
    // No w.print() here — the document prints itself on load, once fonts and images resolve.
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

      {/* PRINT IS THE PRIMARY PATH TO A FILE, and deliberately so: the browser's own
          "Save as PDF" destination renders the SAME document the printer gets, so the saved
          file cannot drift from the printed card, it stays vector, and it costs no new
          dependency. An HTML-to-image renderer was explicitly rejected. The bare-PNG
          download stays for hosts who want the raw code for their own artwork — demoted,
          not removed. */}
      <div className="mt-3">
        <button
          type="button"
          onClick={printCard}
          disabled={!canPrint}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-[9px] bg-[#c8a24e] px-3 py-2 text-[12.5px] font-semibold text-[#16100d] transition-colors hover:bg-[#e7d6ad] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-[#c8a24e]"
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      {/* #6b6354, NOT the #8a8276 muted token used elsewhere in this file: measured on this
          card's #fdfbf7, #8a8276 is 3.67:1 and fails the 4.5:1 floor, while #6b6354 is 5.74:1.
          This sentence is what teaches the Save-as-PDF route, so an unreadable version costs
          the change its whole point. */}
      <p className="mt-2 text-[11px] text-[#6b6354]">
        To save the card as a file, choose “Save as PDF” in the print window.
      </p>

      <button
        type="button"
        onClick={download}
        disabled={!canPrint}
        className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] text-[#6b6354] transition-colors hover:text-[#231d17] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:text-[#6b6354]"
      >
        {/* The icon is kept (not dropped) because removing it would orphan the `Download`
            lucide import, and `noUnusedLocals` would then force an edit outside this render
            region. Only the TEXT carries the underline, so the rule does not run under the
            glyph. */}
        <Download size={12} />
        <span className="underline underline-offset-2">Download QR only (PNG)</span>
      </button>
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
  host,
  onSaved,
}: {
  apt: ApartmentShare
  hostId: string
  host: HostBrand | null
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
        <PrintStep apt={apt} host={host} />
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
  city: string | null
  accent_color: string | null
  is_visible: boolean
  welcome_code: string | null
  welcome_message: string | null
}

export default function SharePanel() {
  const [apts, setApts] = useState<ApartmentShare[]>([])
  const [hostId, setHostId] = useState<string | null>(null)
  const [host, setHost] = useState<HostBrand | null>(null)
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
        .select('id, name, neighborhood, city, accent_color, is_visible, welcome_code, welcome_message')
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

      // Brand row for the printed card. Deliberately NON-FATAL and deliberately last: a
      // failure here must never block printing or collapse the panel — printCard() falls
      // back to the property name and the default accent when this stays null.
      let brand: HostBrand | null = null
      const { data: hostRow, error: hostError } = await supabase
        .from('hosts')
        .select('brand_name, accent_color, logo_url')
        .eq('id', user.id)
        .maybeSingle()
      if (hostError) {
        console.error('[share] host brand load failed', hostError)
      } else if (hostRow) {
        brand = hostRow as HostBrand
      }

      if (!alive) return
      setHostId(user.id)
      setHost(brand)
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
        <PropertyShareCard key={apt.id} apt={apt} hostId={hostId as string} host={host} onSaved={handleSaved} />
      )),
    [apts, hostId, host],
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
