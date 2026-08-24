import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Resolution core for the PRE-ARRIVAL PERSONAL GUEST LINK (`/w/:code#c=…&g=…`).
 *
 * CODE FIRST, NAME SECOND, deliberately: a first name can contain a space, which terminates
 * an auto-linked URL, so name-first loses the CODE and the claim silently never fires.
 * Parsing here is order-free (URLSearchParams), so this is about what the HOST pastes.
 *
 * Split out of the HTTP handler so the decisions that carry the security weight — what
 * counts as a match, which state a booking is in, and exactly which fields are allowed
 * into a response — are unit-testable without a network or a database. The handler owns
 * transport concerns only: method, rate limiting, the failed-attempt brake, and the push.
 *
 * THE HINTS NEVER TOUCH A URL. They arrive in a POST body because the browser sends a
 * fragment nowhere: not to the server, not in a Referer. vercel.json rewrites /(.*) to
 * index.html, so anything in a QUERY STRING is written into Vercel's edge access log
 * before a line of our code runs, and stripping it client-side afterwards would be
 * theatre. Never move `g` or `c` into a query string, a GET, a fetched URL, or a redirect
 * target.
 *
 * THIS ENDPOINT NEVER MINTS A TOKEN. Every feed booking already carries an `ARR-`
 * reference_number (reconcile_ical_bookings assigns new_ref at sync time). Claiming
 * REVEALS that existing token to someone who proved they hold the confirmation code. If a
 * future edit finds itself generating one here, that is the signal something is wrong.
 */

// Same alphabet and length as api/welcome.ts — the welcome code is one public identifier
// with one validator, and a second, looser copy here would be a way past the first.
const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/

// The platform confirmation code, matched CASE-SENSITIVELY and never normalised: a
// lowercase variant is a MISS, not a match. Mirrors the shape api/_lib/ical.ts extracts
// (uppercase alphanumerics, floor 8) — see that file for why the floor is 8 and why
// lowering it would be a privacy change rather than a collision-strength one.
const PLATFORM_REF_RE = /^[A-Z0-9]{8,20}$/

// WHAT ACTUALLY MAKES GUESSING INFEASIBLE IS THE ENTROPY OF platform_ref, NOT THE BRAKE.
// Today api/_lib/ical.ts is its ONLY writer, and it yields Airbnb's 10-character [A-Z0-9]
// code — about 3.7e15 values, which no online attack reaches. The 8-character FLOOR this
// pattern allows is only 1e8 if a future writer ever emits one, which is brute-forceable.
// THEREFORE: no second writer of platform_ref (a CSV import, a host typing one by hand, a
// numeric Booking.com reference) may be added without redoing this analysis. The brake
// below is a speed bump against naive scanning; the entropy is the control.

// A first name: letters and combining marks in any script, plus the separators real names
// use. Excludes newlines, bidi/format controls, braces, angle brackets and the colon — the
// structural pieces of an injected instruction. See the doc block above for what that does
// and does not buy. `u` flag required for the property escapes.
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} '\u2019.-]*$/u

const NAME_MAX = 40

/**
 * The brake bucket label for a request, derived from the SAME normalised code the matcher
 * uses — never from the raw field.
 *
 * THIS IS WHY: the first version labelled the bucket with the raw `code` while
 * validateClaimInput compared the TRIMMED one, so `"AAAA1111 "`, `" AAAA1111"` and every
 * one of the ~25 Unicode whitespace variants trim() removes resolved to the same apartment
 * while landing in a DIFFERENT bucket with a fresh count. The brake capped nothing, and no
 * IP rotation or header forging was needed to walk past it.
 *
 * GENERAL FORM, worth keeping: any bucket label computed from raw input while the
 * comparison uses normalised input is a free bypass.
 */
export function brakeLabel(raw: unknown): string {
  const code = typeof (raw as { code?: unknown })?.code === 'string'
    ? ((raw as { code: string }).code).trim()
    : ''
  return CODE_RE.test(code) ? code : 'invalid'
}

// A syntactically valid uuid that is not an apartment id, used only to keep the miss path
// shaped like the hit path. Never written, never returned.
const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000'

/**
 * THE SINGLE MISS BODY. Every failure — malformed body, bad welcome code, unknown code,
 * hidden apartment, wrong confirmation code, a lowercase one, a cancelled booking, a past
 * booking, a booking with no reference — returns THIS OBJECT AND THIS STATUS. Do not add a
 * field, a message, a count, or a "not found for this property". Any branch in the shape
 * is an existence oracle for someone else's booking.
 */
export const CLAIM_MISS = Object.freeze({ state: 'miss' as const })
export const CLAIM_MISS_STATUS = 200

export type ClaimState = 'preview' | 'active' | 'thankyou'

export interface ClaimInput {
  code: string
  g: string
  c: string
}

export interface ClaimOutcome {
  status: number
  body: unknown
  /** Whether this attempt counts toward the failed-attempt brake. Never true for a hit. */
  failed: boolean
  /** Present only on the FIRST claim of a booking, so the handler pushes exactly once. */
  firstClaim?: { hostId: string; apartmentName: string }
  /**
   * The host whose PROPERTY was addressed, when the welcome code resolved to a visible one.
   * VICTIM-KEYED, NOT CALLER-KEYED: this endpoint is public, so the named host is the target
   * of a guessing run, never its author. Any alarm built on this must say INVESTIGATE and
   * must never say "block this host". Absent on an unknown code, so a sweep across random
   * codes is deliberately uncounted rather than being dumped into one shared bucket.
   */
  victimHostId?: string
  /** Operator heartbeat metadata. Set ONLY on a hit; never reaches a guest-facing body. */
  heartbeat?: {
    apartmentName: string
    neighborhood: string | null
    city: string | null
    country: string | null
    state: ClaimState
    isTest: boolean
  }
}

const miss = (): ClaimOutcome => ({ status: CLAIM_MISS_STATUS, body: CLAIM_MISS, failed: true })

/**
 * Validate the three inputs. Returns null on ANY problem — the caller turns that into the
 * same miss as a wrong code, so validation is not an oracle either.
 *
 * `g` is a FIRST NAME ONLY. There is deliberately no surname field, here or in the body
 * shape: a field that does not exist cannot be filled in by a later edit that "just adds
 * the rest of the name".
 *
 * THE CHARACTER SET IS AN ALLOWLIST BECAUSE THIS VALUE REACHES AN LLM SYSTEM INSTRUCTION.
 * `guests.first_name` is interpolated raw into the guest-chat system prompt
 * (api/_lib/guest-access.ts — "The guest's name is ${name}."), OUTSIDE the per-request
 * nonce fence that guards host content. Until now only an AUTHENTICATED HOST could set that
 * string; this endpoint lets anyone holding a confirmation code set it, on exactly the
 * booking class that has no name yet (iCal carries none). The trust boundary moved, so the
 * validation moved with it: letters, marks, spaces, apostrophes, hyphens and full stops,
 * which keeps accents and non-Latin scripts.
 *
 * BE PRECISE ABOUT WHAT THIS BUYS, because the next editor will rely on it. It removes the
 * STRUCTURAL half of prompt injection — no newline, no bidi or zero-width format control, no
 * braces, angle brackets or colon — and that is the half that lets injected text impersonate
 * a new instruction block. It does NOT make the field instruction-proof: forty characters of
 * letters, spaces and full stops can still read as a sentence. What bounds the residue is
 * WHO can reach it — setting the name requires a valid (welcome_code, platform_ref) pair for
 * an unnamed booking, i.e. that booking's own guest, who already holds the verified tier and
 * everything it discloses. The injection is self-scoped, not a route to someone else's flat.
 *
 * Do NOT relax this back to "strip control characters" — that was the first version, and it
 * left the structural half wide open.
 */
export function validateClaimInput(raw: unknown): ClaimInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const body = raw as Record<string, unknown>

  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (!CODE_RE.test(code)) return null

  const c = typeof body.c === 'string' ? body.c.trim() : ''
  if (!PLATFORM_REF_RE.test(c)) return null

  if (typeof body.g !== 'string') return null
  const g = body.g.normalize('NFC').trim().slice(0, NAME_MAX).trim()
  if (!g || !NAME_RE.test(g)) return null

  return { code, g, c }
}

/**
 * Which state a booking is in, in Helsinki time. `helsinkiNow` is "YYYY-MM-DD HH:MM:SS"
 * and `helsinkiToday` its date part — the SAME two values api/guest-state.ts computes,
 * deliberately passed in rather than recomputed, so there is exactly one definition of
 * "now" behind both surfaces and string comparison stays valid (sortable format).
 *
 * THE 11:00 CUTOFF ON ARRIVAL IS THE TOM-PROTECTION INVARIANT and it lives here: the date
 * alone is NEVER enough to unlock a stay. A link that transformed at midnight would open
 * the flat's details while the previous guest is still in it.
 */
export function decideState(
  booking: { check_in: string; check_out: string },
  helsinkiNow: string,
  helsinkiToday: string
): ClaimState {
  if (helsinkiNow >= `${booking.check_out} 11:00:00`) return 'thankyou'
  if (helsinkiToday >= booking.check_in && helsinkiNow >= `${booking.check_in} 11:00:00`) {
    return 'active'
  }
  return 'preview'
}

/**
 * Build the response body for a hit. This function is the ALLOWLIST: it names every field
 * that may reach a guest, and it is handed primitives rather than a booking row, so a
 * column added to `bookings` later cannot ride out through a spread.
 *
 * NEVER add platform_ref here under any name. It is the credential this endpoint accepts;
 * echoing it back would publish it to anyone who already guessed it and to every proxy in
 * between. Likewise: no surname, email, phone, address, door code, wifi, welcome_code,
 * host_id, is_visible or subscription state. The guest page (reached with `token`) is
 * where private content lives, behind its own checks.
 */
export function buildClaimBody(
  state: ClaimState,
  fields: { guestName: string | null; token: string; apartmentId: string; checkIn: string }
): Record<string, unknown> {
  if (state === 'thankyou') return { state, guestName: fields.guestName }
  if (state === 'active') {
    return {
      state,
      guestName: fields.guestName,
      token: fields.token,
      apartmentId: fields.apartmentId,
    }
  }
  return { state, guestName: fields.guestName, checkIn: fields.checkIn }
}

/**
 * Attach the name hint to the booking, and return the name that should be DISPLAYED.
 *
 * A STORED NAME ALWAYS WINS. A host who typed a guest's name outranks a hint carried in a
 * URL that anyone holding the link can edit; the hint fills a BLANK, it never corrects.
 * That is also what stops the endpoint being a rename primitive for whoever guesses a
 * confirmation code.
 *
 * The write is guarded `.is('guest_id', null)` and checked by rows returned, so two
 * devices claiming at once cannot both win — PostgREST reports no error on a zero-row
 * write, and treating that as success is how a "saved" that saved nothing gets shipped.
 */
export async function attachGuestName(
  db: SupabaseClient,
  booking: { id: string; guest_id: string | null },
  hint: string
): Promise<string | null> {
  if (booking.guest_id) {
    const { data } = await db.from('guests').select('first_name').eq('id', booking.guest_id).maybeSingle()
    return data?.first_name ?? null
  }

  const { data: created, error: insertErr } = await db
    .from('guests')
    .insert({ first_name: hint, last_name: '', email: '' })
    .select('id')
    .single()
  if (insertErr || !created) return null

  const { data: linked } = await db
    .from('bookings')
    .update({ guest_id: created.id })
    .eq('id', booking.id)
    .is('guest_id', null)
    .select('id')

  if (linked && linked.length > 0) return hint

  // Lost the race: another claim attached a name first. Read back whoever won, and show
  // that. RESIDUAL: the guest row inserted just above is now an orphan — harmless (it is
  // referenced by nothing and falls under the 30-day guest-identity retention sweep) but
  // real, and preferable to writing over a name that is already attached.
  const { data: reread } = await db
    .from('bookings')
    .select('guest_id')
    .eq('id', booking.id)
    .maybeSingle()
  if (!reread?.guest_id) return null
  const { data: winner } = await db
    .from('guests')
    .select('first_name')
    .eq('id', reread.guest_id)
    .maybeSingle()
  return winner?.first_name ?? null
}

/**
 * Full resolution. Returns an outcome; performs no I/O the handler cannot see and sends no
 * push (the handler does that, so tests never need a push transport).
 *
 * ON A DB ERROR this returns a 500 rather than a miss. That is deliberate and is NOT an
 * oracle: an infrastructure failure is uncorrelated with whether the code was right, and
 * silently mapping errors to "miss" would hide a broken deploy behind a normal-looking page.
 */
export async function resolveClaim(
  db: SupabaseClient,
  raw: unknown,
  helsinkiNow: string,
  helsinkiToday: string
): Promise<ClaimOutcome> {
  const input = validateClaimInput(raw)
  if (!input) return miss()

  const { data: apt, error: aptErr } = await db
    .from('apartments')
    .select('id, name, neighborhood, city, country, host_id, is_visible, is_test')
    .eq('welcome_code', input.code)
    .maybeSingle()
  if (aptErr) return { status: 500, body: { error: 'query_failed' }, failed: false }

  // THE BILLING GATE, WHICH THE FRAME THIS FILE COPIED ALSO HAS. api/welcome.ts refuses to
  // render a lapsed host's page; cloning its shape without its gate would have made this a
  // NEW way to obtain a guest token — and to write a new guest identity row — on an account
  // that stopped paying. Queried unconditionally (with a sentinel when the apartment did not
  // resolve) so the round-trip count does not depend on whether the code was real.
  const { data: hostRow, error: hostErr } = await db
    .from('hosts')
    .select('subscription_status')
    .eq('id', apt?.host_id ?? NO_MATCH_ID)
    .maybeSingle()
  if (hostErr) return { status: 500, body: { error: 'query_failed' }, failed: false }

  // An unknown or hidden apartment still issues the booking query, against an id that
  // cannot match. Both paths therefore make the same number of round trips, so the
  // response TIME does not become the oracle the response BODY refuses to be. Best-effort,
  // not constant-time: query planning still differs, and this is not claimed as a defence
  // against a patient attacker with a clean network path.
  const lookupId = apt && apt.is_visible === true ? (apt.id as string) : NO_MATCH_ID

  const { data: booking, error: bookErr } = await db
    .from('bookings')
    .select('id, reference_number, check_in, check_out, guest_id, link_claimed_at')
    .eq('apartment_id', lookupId)
    .eq('platform_ref', input.c)
    // The SAME status set api/guest-state.ts and api/_lib/guest-access.ts accept. A narrower
    // allowlist here would mean one booking resolving through the QR flow and missing through
    // the link flow, for the same guest, on the same day.
    //
    // NOTE THE WINDOW BELOW DECIDES WHERE 'thankyou' LIVES: `check_out >= today` means the
    // thank-you state is reachable only between 11:00 and midnight Helsinki on checkout day.
    // From the next morning a returning guest's own link is a MISS — which also means their
    // visit feeds the victim-keyed detector as a failure. One or two such visits against a
    // 20/hour floor is noise, not a false alarm, but widening the window is the lever if that
    // ever stops being true.
    //
    // THAT ESTIMATE'S PREMISE CHANGED when the welcome page learned to remember a verified
    // claim on the device (src/lib/welcomeClaimStore.ts): the claim now fires AUTOMATICALLY
    // on every launch of an installed page, not only when a guest deliberately re-opens the
    // original link. It stays bounded because a 'miss' CLEARS the stored entry, so it is one
    // post-checkout failure per device rather than a loop — three co-travellers behind one IP
    // is 3 of the brake's 5 and 3 of the detector's 20. Re-derive from THIS model, not the
    // deliberate-revisit one above, before changing FAILED_CLAIM_LIMIT.
    .in('status', ['confirmed', 'completed'])
    .gte('check_out', helsinkiToday)
    .order('check_in', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (bookErr) return { status: 500, body: { error: 'query_failed' }, failed: false }

  if (!apt || apt.is_visible !== true) return miss()
  // An expired or missing host resolves to the SAME miss as a wrong code — never a distinct
  // state, which would tell a stranger which properties have lapsed accounts.
  if (!hostRow || hostRow.subscription_status === 'expired') return miss()
  const victim = { victimHostId: apt.host_id as string }
  if (!booking) return { ...miss(), ...victim }
  // No reference_number = nothing to reveal. This endpoint does not mint one; a feed
  // booking without a token is a broken row, not a guest-facing state.
  if (!booking.reference_number) return { ...miss(), ...victim }

  const state = decideState(
    { check_in: booking.check_in as string, check_out: booking.check_out as string },
    helsinkiNow,
    helsinkiToday
  )

  const guestName = await attachGuestName(
    db,
    { id: booking.id as string, guest_id: (booking.guest_id as string | null) ?? null },
    input.g
  )

  const body = buildClaimBody(state, {
    guestName,
    token: booking.reference_number as string,
    apartmentId: apt.id as string,
    checkIn: booking.check_in as string,
  })

  // FIRST CLAIM — a PING MARKER, DELIBERATELY NOT A LOCKOUT. Co-travellers share one
  // confirmation code and open the link on their own phones; refusing the second device
  // would break an ordinary stay to defend a token the first device already holds. The
  // marker exists so the HOST is told once that their pasted template worked. The
  // conditional update is what makes "once" true under concurrency — rows-returned, not
  // absence-of-error, decides.
  let firstClaim: ClaimOutcome['firstClaim']
  if (state === 'active' && !booking.link_claimed_at) {
    const { data: claimed } = await db
      .from('bookings')
      .update({ link_claimed_at: new Date().toISOString() })
      .eq('id', booking.id)
      .is('link_claimed_at', null)
      .select('id')
    if (claimed && claimed.length > 0) {
      firstClaim = { hostId: apt.host_id as string, apartmentName: (apt.name as string | null) ?? '' }
    }
  }

  // OPERATOR HEARTBEAT METADATA — attached HERE and nowhere else, which is what makes
  // "never on a miss" true by construction rather than by the handler remembering: every
  // miss returns through `miss()`, which cannot carry this field. Read off the `apt` row
  // already in hand, so it costs no extra query. Property facts only — see the content
  // rule at the handler that consumes it.
  const heartbeat: ClaimOutcome['heartbeat'] = {
    apartmentName: (apt.name as string | null) ?? '',
    neighborhood: (apt.neighborhood as string | null) ?? null,
    city: (apt.city as string | null) ?? null,
    country: (apt.country as string | null) ?? null,
    state,
    isTest: apt.is_test === true,
  }

  return { status: 200, body, failed: false, ...victim, ...(firstClaim ? { firstClaim } : {}), heartbeat }
}

