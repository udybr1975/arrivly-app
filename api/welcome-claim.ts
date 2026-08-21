import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { sendPushToHost } from './_lib/push.js'
import { sendNtfy } from './_lib/ntfy.js'
import { brakeLabel, resolveClaim } from './_lib/welcome-claim.js'

// PUBLIC, UNAUTHENTICATED claim endpoint for the pre-arrival personal guest link.
//
// The guest opens /w/:code#g=<first name>&c=<confirmation code>. The page reads the
// FRAGMENT, strips it from the address bar, and POSTs the two hints here. The hints are in
// a fragment and then a POST BODY on purpose: vercel.json rewrites /(.*) to index.html, so
// a query string would already be in Vercel's edge access log before any of our code runs.
// Browsers never transmit a fragment to a server and never put it in a Referer, which is
// what makes "the hint is never logged" structurally true instead of merely intended.
// NEVER move these values into a query string, a GET, a fetched URL, or a redirect target.
//
// Frame copied from api/welcome.ts deliberately (svc() client, per-instance IP limiter,
// the same CODE_RE via _lib/welcome-claim.ts, truncated secret-free logging, and the
// identical-body-for-missing-or-hidden no-oracle rule). Resolution logic lives in
// _lib/welcome-claim.ts so it can be tested without a database.
//
// NOTHING DERIVED FROM THE INPUT IS EVER LOGGED. No console.* call in this file may carry
// the name hint, the confirmation code, the token, the guest name, or the request body.
//
// THE ONE PLACE THAT NEEDS CARE is a CAUGHT ERROR'S MESSAGE, because a supabase-js
// client/URL error can embed the request URL — and the booking lookup's URL carries
// `platform_ref=eq.<confirmation code>`. So the handler's own catch logs a FIXED CLASS
// STRING and nothing else. The counter path below does log its error message, and that is a
// deliberate, narrow exception: its only request is an RPC whose arguments are a host id and
// the literal endpoint name, so its URL cannot carry the code. Keep that distinction if you
// add a log — it is the difference between diagnosable and safe, not a style choice.

const svc = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// --- Best-effort in-memory rate limiter (per-instance only; not shared across Lambdas) ---
// Same shape and budget as api/welcome.ts. Per-instance means this caps abuse from a single
// warm instance, not globally — do not oversell it as a hard cap.
const RL_MAX = 30
const RL_WINDOW_MS = 60_000
const rlHits = new Map<string, { count: number; windowStart: number }>()

// NEITHER MAP IN THIS FILE MAY GROW WITHOUT BOUND. The sibling endpoints key only on IP and
// never evict, which is survivable there; the brake below adds a SECOND, caller-supplied
// dimension to its key, so a single caller could otherwise mint entries until the warm
// instance OOMs and takes every request on it down. Sweeping on write is enough: expired
// entries are dropped, and a hard cap clears the map if it is ever exceeded anyway.
const MAP_MAX_KEYS = 5_000

function sweep(map: Map<string, { count: number; windowStart: number }>, now: number, windowMs: number): void {
  if (map.size < MAP_MAX_KEYS) {
    if (map.size % 64 !== 0) return
    for (const [k, v] of map) if (now - v.windowStart >= windowMs) map.delete(k)
    return
  }
  for (const [k, v] of map) if (now - v.windowStart >= windowMs) map.delete(k)
  // Still over the cap after dropping every expired entry: this is an attack, not traffic.
  // Clear outright rather than carry an unbounded map — the cost is that live windows reset,
  // which is a fail-open the entropy of platform_ref (see _lib/welcome-claim.ts) can carry.
  if (map.size >= MAP_MAX_KEYS) map.clear()
}

function rateLimited(ip: string, now: number): boolean {
  sweep(rlHits, now, RL_WINDOW_MS)
  const entry = rlHits.get(ip)
  if (!entry || now - entry.windowStart >= RL_WINDOW_MS) {
    rlHits.set(ip, { count: 1, windowStart: now })
    return false
  }
  entry.count += 1
  return entry.count > RL_MAX
}

// --- The brake: FAILED claims only, keyed on the welcome code + client IP ---------------
// Guessing a confirmation code is the attack this endpoint has to survive, and the IP
// limiter above counts every request rather than every failure — a guest reloading a valid
// link is not the thing to slow down. Five failures in ten minutes and this IP is sent to
// the QR code instead, which is the fallback that always works and needs no guessing.
//
// Keyed on the CODE rather than the resolved apartment id on purpose: the welcome code is
// the apartment's public identifier, one per apartment, and it is available even when the
// apartment does not resolve — so an attacker sweeping unknown codes is still partitioned
// the same way, instead of falling into one shared bucket keyed on "unresolved".
const BRAKE_MAX = 5
const BRAKE_WINDOW_MS = 10 * 60_000
const brakeHits = new Map<string, { count: number; windowStart: number }>()

function brakeKey(raw: unknown, ip: string): string {
  // brakeLabel normalises EXACTLY as the matcher does and returns a fixed 'invalid' for
  // anything that is not a well-formed welcome code. Deriving the label here from the raw
  // field instead was a complete bypass: trailing whitespace changed the bucket without
  // changing which apartment resolved, so every guess got a fresh count of five.
  return `${brakeLabel(raw)}|${ip}`
}

function brakeTripped(key: string, now: number): boolean {
  const entry = brakeHits.get(key)
  if (!entry || now - entry.windowStart >= BRAKE_WINDOW_MS) return false
  return entry.count >= BRAKE_MAX
}

function recordFailure(key: string, now: number): void {
  sweep(brakeHits, now, BRAKE_WINDOW_MS)
  const entry = brakeHits.get(key)
  if (!entry || now - entry.windowStart >= BRAKE_WINDOW_MS) {
    brakeHits.set(key, { count: 1, windowStart: now })
    return
  }
  entry.count += 1
}

/**
 * DELIBERATELY NOT the house helper, and this is the one place in the repo where the
 * difference matters. Every sibling reads the first entry of `x-forwarded-for`; on those
 * endpoints a forged header costs a bypassed best-effort SPEND limiter. Here the IP is the
 * only key of both anti-enumeration controls, so it is read from the PLATFORM-SET headers
 * first and falls back to `x-forwarded-for` only if neither is present.
 *
 * STATED AS A MEASUREMENT NOT YET TAKEN: whether Vercel's edge overwrites or merely appends
 * an inbound `x-forwarded-for` on this project has not been verified. Until it is, do not
 * treat the fallback branch as trustworthy — and note that the real control here is the
 * entropy of platform_ref, with the counter below as the detector.
 */
function clientIp(req: VercelRequest): string {
  const pick = (name: string): string | null => {
    const v = req.headers[name]
    const first = Array.isArray(v) ? v[0] : v
    const value = typeof first === 'string' ? first.split(',')[0].trim() : ''
    return value.length > 0 && value.length <= 64 ? value : null
  }
  return (
    pick('x-vercel-forwarded-for') ??
    pick('x-real-ip') ??
    pick('x-forwarded-for') ??
    req.socket?.remoteAddress ??
    'unknown'
  )
}

// PERSISTENT DETECTION, because both brakes above live in one Lambda's memory and leave no
// artefact at all: after an attack there would be no counter row, no alert and nothing to
// count forensically. A brake in this repo is UNFINISHED until its key is in
// cron-spend-audit.ts's ROLLING_LIMITS — registered there in this same commit.
//
// VICTIM-KEYED. The counter is keyed on the host whose PROPERTY was addressed, and that host
// is the target of a guessing run, never its author — so the alert says INVESTIGATE and must
// never be reworded to "block this host". Only counted when the welcome code resolved to a
// visible, non-expired property; a sweep across random codes has no victim to name and is
// deliberately left uncounted rather than dumped into one shared bucket.
//
// FAILS OPEN. A counter that cannot be written must not stop a real guest reaching their
// arrival page — the blocked behaviour here is someone's stay, not a free fallback.
const FAILED_CLAIM_LIMIT = 20

async function recordVictimFailure(db: ReturnType<typeof svc>, hostId: string): Promise<void> {
  try {
    const { data, error } = await db.rpc('bump_api_counter', {
      p_host_id: hostId,
      p_endpoint: 'welcome-claim',
    })
    if (error) {
      console.warn('[welcome-claim] counter bump failed (fail-open)', error.message?.slice(0, 120))
      return
    }
    if (typeof data !== 'number') {
      console.error('[welcome-claim] bump_api_counter returned non-numeric - detector inactive', typeof data)
      return
    }
    // ONE alert per window, on the crossing attempt exactly — the same strict equality the
    // other rate alarms use, so a sustained run cannot fire an alert per request.
    if (data === FAILED_CLAIM_LIMIT + 1) {
      await sendNtfy({
        title: 'Bemgu: repeated failed guest-link claims',
        message:
          `${FAILED_CLAIM_LIMIT}+ failed pre-arrival link claims in one hour against host ${hostId}.\n` +
          `This host is the TARGET, not the source: /api/welcome-claim is public and the failures\n` +
          `are someone guessing confirmation codes for their property.\n` +
          `ACTION: INVESTIGATE - do NOT block this host. Check whether one welcome code is being\n` +
          `swept, and whether any claim succeeded (bookings.link_claimed_at).`,
        priority: 'high',
      })
    }
  } catch (e) {
    console.warn('[welcome-claim] detector error (fail-open)', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
  }
}

// The brake's body points at the QR code inside the flat and says nothing about whether
// any attempt was close, which code was wrong, or whether the property exists.
const BRAKED = {
  state: 'braked' as const,
  message:
    "We couldn't match those details. Scan the QR code inside the flat to unlock your WiFi, door code and check-in details.",
}

// --------------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const now = Date.now()
  const ip = clientIp(req)
  if (rateLimited(ip, now)) {
    return res.status(429).json({ error: 'rate_limited' })
  }

  const rawBody: unknown = req.body ?? {}
  const key = brakeKey(rawBody, ip)
  if (brakeTripped(key, now)) {
    return res.status(429).json(BRAKED)
  }

  // Helsinki "now" ("YYYY-MM-DD HH:MM:SS") + its date part — computed exactly as
  // api/guest-state.ts does, and passed down, so there is ONE definition of "now" behind
  // the token flow and this one. Do not introduce a second.
  const helsinkiNow = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Helsinki' })
  const helsinkiToday = helsinkiNow.split(' ')[0]

  const db = svc()
  try {
    const outcome = await resolveClaim(db, rawBody, helsinkiNow, helsinkiToday)

    if (outcome.failed) {
      recordFailure(key, now)
      // The persistent, cross-instance half of the same story. Awaited so the row is written
      // before the response returns — a detector that loses its write when the instance
      // freezes is not a detector.
      // NOTE this await is only reached when the welcome code RESOLVED, so it breaks the
      // round-trip parity the resolver argues for: response time now distinguishes a real
      // welcome code from an unknown one. Accepted, because api/welcome.ts already answers
      // that question outright (live vs unavailable) for anyone who asks — welcome-code
      // existence is not a secret; the CONFIRMATION CODE is. Do not read the resolver's
      // parity comment as covering this line.
      if (outcome.victimHostId) await recordVictimFailure(db, outcome.victimHostId)
      // Re-check AFTER recording so the attempt that crosses the threshold is already
      // braked, rather than granting one free extra try.
      if (brakeTripped(key, now)) return res.status(429).json(BRAKED)
    }

    // FIRST CLAIM ONLY — a ping marker, not a lockout: a second device presenting the same
    // correct code still gets the token (co-travellers share one confirmation code). The
    // push tells the host their pasted template worked. It carries the PROPERTY name and
    // never the guest's name. Host push subscriptions are ACCOUNT-LEVEL, so sendPushToHost
    // is called WITHOUT an apartmentId — passing one filters the lookup to zero rows and
    // delivers nothing silently. urgency/TTL are set inside the helper.
    // AWAITED, not fire-and-forget. link_claimed_at is already committed by the time we get
    // here, so the once-only guard can never be satisfied again: if the instance froze before
    // web-push finished, this host would never learn their template worked, for this booking,
    // ever. That is different from the dropped-notification case guest-message.ts tolerates,
    // where the message itself persists and is counted on next open. One round trip.
    if (outcome.firstClaim) {
      const { hostId, apartmentName } = outcome.firstClaim
      await sendPushToHost(db, hostId, {
        title: apartmentName ? `Guest link opened · ${apartmentName}` : 'Guest link opened',
        body: 'Your pre-arrival link was opened and the guest page unlocked.',
        url: '/dashboard/bookings',
      })
    }

    return res.status(outcome.status).json(outcome.body)
  } catch (e) {
    // FAILURE CLASS ONLY — a FIXED string, with nothing taken from the caught value. The
    // siblings log a truncated error message; here that message can be a supabase-js
    // client/URL error whose text embeds the request URL, and that URL carries
    // `platform_ref=eq.<confirmation code>`. The file's rule is absolute, so the log has to
    // be too: the class is enough to see that this endpoint is throwing.
    void e
    console.error('[welcome-claim] unexpected error')
    // 500, NOT a miss — matching resolveClaim's handling of a query error and the sibling
    // endpoints. An infrastructure failure is uncorrelated with whether the code was right,
    // so it is not an oracle; mapping it to a miss would instead hide a broken deploy
    // behind a page that looks perfectly normal.
    return res.status(500).json({ error: 'internal_error' })
  }
}
