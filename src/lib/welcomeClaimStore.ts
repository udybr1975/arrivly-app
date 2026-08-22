// Device-local memory of a pre-arrival claim, keyed per welcome code.
//
// WHY THIS EXISTS: WelcomePage strips the #c=…&g=… fragment during its first render, and the
// `preview` claim response carries no token. So a guest who bookmarks the page, or installs it
// from the Settings tab, comes back to a bare /w/CODE and lands on the generic page — including
// on their check-in day, which is exactly the visit that matters. Remembering the hints on the
// device lets the page re-claim itself with no URL change.
//
// THE VALUE STORED IS A CREDENTIAL — it is the booking's confirmation code, the same secret
// api/welcome-claim.ts accepts. Three rules follow, and none of them is optional:
//   1. NEVER PERSIST AN UNVERIFIED VALUE. Only a claim the server actually resolved is written.
//      A wrong code that were stored would re-POST on every single visit, forever, turning one
//      mistyped link into a permanent low-rate guessing loop against someone else's booking.
//   2. FORGET WHEN THE STAY IS OVER ('thankyou') or the value proved wrong ('miss'). A device
//      must not keep a working key to a flat somebody else is now staying in.
//   3. EXPIRE AGAINST THE STAY, not against first use: an entry is dropped once today is more
//      than 30 days past its check-in date. The bound is DERIVED FROM THE BOOKING the server
//      already told us about, so it survives an abandoned device with no further visit, and it
//      keeps the shared-device window (a family tablet on which someone else's booking was
//      claimed) to the stay plus a month rather than months from first open.
//
// This is deliberately localStorage and NOT a cookie: a cookie would be transmitted to the
// server on every request to this origin, which is the precise property the fragment design
// exists to avoid. Nothing here is ever sent anywhere except in the claim POST body.

// KEEPS THE INTERNAL CODENAME, like every other storage key in this app (arrivly_installed,
// arrivly_last_guest, arrivly_guest_blurb_seen_*). The public brand is Bemgu; storage keys,
// event names and env var NAMES are deliberately 'arrivly'. Renaming this after it ships would
// strand live entries on guests' devices, so it has to be right the first time.
const PREFIX = 'arrivly:wc:'
/** Days after CHECK-IN at which an entry stops being honoured. */
const KEEP_DAYS_AFTER_CHECKIN = 30

// The welcome-code alphabet, mirroring CODE_RE in api/welcome.ts. Anything else never becomes
// a storage key — a junk route param cannot litter the origin's storage.
const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/

export interface StoredHints { c: string; g: string }
/** `checkIn` is 'YYYY-MM-DD' and is what bounds the entry's life. */
interface StoredEntry extends StoredHints { checkIn: string }
export interface StoredClaim extends StoredHints { checkIn: string }

/** Today as local y/m/d, never via toISOString — that shifts the day for every positive-UTC
 *  viewer, which is the whole market these dates describe. */
function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/** True for an unparseable date too: a value we cannot bound is treated as already expired. */
function pastKeepWindow(checkIn: string): boolean {
  const parts = checkIn.split('-').map(Number)
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return true
  // Day overflow normalises (e.g. 2026-08-25 + 30 -> 2026-09-24), so no month arithmetic.
  const limit = new Date(parts[0], parts[1] - 1, parts[2] + KEEP_DAYS_AFTER_CHECKIN)
  return startOfToday().getTime() > limit.getTime()
}

function todayIso(): string {
  const d = startOfToday()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

const keyFor = (code: string) => PREFIX + code

/** Every access is try/caught: Safari private mode THROWS on write, and reads can throw too. */
export function forgetHints(code: string): void {
  if (!CODE_RE.test(code)) return
  try { localStorage.removeItem(keyFor(code)) } catch { /* storage unavailable — nothing to do */ }
}

/**
 * The hints previously verified for THIS code, or null. Self-cleaning: a malformed or expired
 * entry is removed as it is read, so a bad value cannot sit there being re-parsed.
 *
 * THERE IS NO UPPER BOUND ON `checkIn` AND NO RANGE CHECK ON ITS PARTS — said plainly because an
 * earlier draft of this comment claimed a future-date guard that the code never had. A tampered
 * '9999-01-01', or a '2026-99-01' that normalises years out, would be honoured. Only same-origin
 * tampering can write one, and anyone who can do that already holds the credential, so this is
 * recorded rather than defended. Do not size anything else against a bound that is not here.
 */
export function readStoredHints(code: string): StoredClaim | null {
  if (!CODE_RE.test(code)) return null
  let raw: string | null = null
  try { raw = localStorage.getItem(keyFor(code)) } catch { return null }
  if (!raw) return null

  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { forgetHints(code); return null }

  const entry = parsed as StoredEntry | null
  if (
    !entry || typeof entry !== 'object' ||
    typeof entry.c !== 'string' || !entry.c ||
    typeof entry.g !== 'string' || !entry.g ||
    // AN ENTRY WITHOUT A checkIn IS EXPIRED BY DEFINITION. That is also the migration path for
    // anything written by the storedAt-based version this replaced: unbounded, so dropped.
    typeof entry.checkIn !== 'string' || !entry.checkIn
  ) {
    forgetHints(code)
    return null
  }

  if (pastKeepWindow(entry.checkIn)) {
    forgetHints(code)
    return null
  }
  return { c: entry.c, g: entry.g, checkIn: entry.checkIn }
}

/**
 * Remember hints the SERVER HAS ALREADY RESOLVED. Call this only on a verified state — never on
 * 'miss' (wrong), and never on 'braked' (unknown, because the brake answers before the lookup).
 *
 * `checkIn` comes straight from a 'preview' body. An 'active' body carries no date — by design,
 * since it hands over a token instead — so it passes null, and the bound is then either the date
 * ALREADY STORED from an earlier preview on this device, or today. Today is not an invented
 * number: 'active' means the server placed today INSIDE the stay, so today is a real
 * check-in-or-later date for this booking and anchors the window to the same stay.
 */
export function rememberHints(code: string, hints: StoredHints, checkIn: string | null): void {
  if (!CODE_RE.test(code)) return
  const bound = checkIn || readStoredHints(code)?.checkIn || todayIso()
  const entry: StoredEntry = { c: hints.c, g: hints.g, checkIn: bound }
  try { localStorage.setItem(keyFor(code), JSON.stringify(entry)) } catch { /* private mode */ }
}
