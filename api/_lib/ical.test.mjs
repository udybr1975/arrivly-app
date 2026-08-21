// Unit tests for the iCal parser (no test framework — node:test + node:assert only).
// Run with:  npm run test:ical
//
// WHY THIS FILE EXISTS: iCal producers FOLD long content lines (RFC 5545 — wrap at 75
// octets, continue with one leading space). parseIcal matches line-by-line with
// /^KEY:(.+)$/m, so before unfolding it read only a folded value's FIRST fragment.
// Airbnb's DESCRIPTION folds mid-URL on every real reservation, which silently swallowed
// the confirmation code — while a hand-written short fixture, which does NOT fold, passed.
// That is the whole point of the fixtures below: the folds are load-bearing and must not
// be "tidied" out of them.
//
// EVERY FIXTURE HERE IS FABRICATED, AND THAT IS A RULE, NOT AN ACCIDENT. This repo is
// public. A verbatim capture from a live feed would publish a real guest's confirmation
// code, their last-4 phone digits and their stay dates — permanently, in git objects that
// outlive the 30-day guest-identity retention promise, and it would publish exactly the
// credential the future claim endpoint will accept from a public URL. The tests need the
// fold GEOMETRY, never real values: synthetic codes and an obviously fake 0000 digit run
// prove the same properties. The digit run stays because the negative assertion needs it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIcal } from './ical.ts'

// Shaped exactly like a live Airbnb VEVENT — same field order, same 56-character UID
// length, same fold position — with every value replaced by a synthetic one. The code
// TESTCODE01 is SPLIT across the fold: the first line ends "…/reservations/de" and the
// continuation supplies "tails/TESTCODE01".
const AIRBNB_FOLDED = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'DTSTAMP:20260821T174444Z',
  'DTSTART;VALUE=DATE:20260821',
  'DTEND;VALUE=DATE:20260822',
  'SUMMARY:Reserved',
  'UID:0123456789ab-fedcba98765432100123456789abcdef@airbnb.com',
  'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/de',
  ' tails/TESTCODE01\\nPhone Number (Last 4 Digits): 0000',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

test('a folded DESCRIPTION yields the whole confirmation code', () => {
  const [event] = parseIcal(AIRBNB_FOLDED)
  assert.equal(event.platformRef, 'TESTCODE01')
})

test('the phone digits on that same line are never returned', () => {
  const [event] = parseIcal(AIRBNB_FOLDED)
  // Nothing but uid/start/end/summary/platformRef leaves the parser, and none of them
  // may carry the last-4 digits that sit beside the code in DESCRIPTION.
  assert.deepEqual(Object.keys(event).sort(), [
    'end',
    'platformRef',
    'start',
    'summary',
    'uid',
  ])
  assert.equal(JSON.stringify(event).includes('0000'), false)
  assert.equal(JSON.stringify(event).includes('Phone Number'), false)
})

test('unfolding does not disturb uid, dates or summary', () => {
  const [event] = parseIcal(AIRBNB_FOLDED)
  assert.equal(event.uid, '0123456789ab-fedcba98765432100123456789abcdef@airbnb.com')
  assert.equal(event.start, '2026-08-21')
  assert.equal(event.end, '2026-08-22')
  assert.equal(event.summary, 'Reserved')
})

test('a DESCRIPTION folded MORE THAN ONCE still yields the code', () => {
  // A real description folds repeatedly; a single-fold fixture would not prove the
  // unfold is a global pass rather than a one-shot fix.
  const feed = [
    'BEGIN:VEVENT',
    'UID:multi-fold@airbnb.com',
    'DTSTART;VALUE=DATE:20260821',
    'DTEND;VALUE=DATE:20260822',
    'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/de',
    ' tails/MULTIFOLD1\\nPhone Number (Last 4 Digits): 0000\\nCheck-in instructions we',
    ' re sent separately to the guest before arrival',
    'END:VEVENT',
  ].join('\r\n')
  const [event] = parseIcal(feed)
  assert.equal(event.platformRef, 'MULTIFOLD1')
})

test('a folded UID is read whole — it is the reconcile key, so a fragment would collide', () => {
  const feed = [
    'BEGIN:VEVENT',
    'UID:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde',
    ' f0123456789@guesty.com',
    'DTSTART;VALUE=DATE:20260821',
    'DTEND;VALUE=DATE:20260822',
    'END:VEVENT',
  ].join('\r\n')
  const [event] = parseIcal(feed)
  assert.equal(
    event.uid,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789@guesty.com'
  )
})

test('a UID at the cap is kept; one over it is rejected outright, not sliced', () => {
  const atCap = [
    'BEGIN:VEVENT',
    `UID:${'a'.repeat(512)}`,
    'DTSTART;VALUE=DATE:20260821',
    'DTEND;VALUE=DATE:20260822',
    'END:VEVENT',
  ].join('\r\n')
  assert.equal(parseIcal(atCap)[0].uid.length, 512)
})

test('an absurd UID is rejected outright, not sliced into a colliding key', () => {
  const feed = [
    'BEGIN:VEVENT',
    `UID:${'a'.repeat(600)}@example.com`,
    'DTSTART;VALUE=DATE:20260821',
    'DTEND;VALUE=DATE:20260822',
    'END:VEVENT',
  ].join('\r\n')
  assert.deepEqual(parseIcal(feed), [])
})

test('a folded SUMMARY survives intact — the same bug, a different field', () => {
  const feed = [
    'BEGIN:VEVENT',
    'UID:folded-summary@example.com',
    'DTSTART;VALUE=DATE:20260901',
    'DTEND;VALUE=DATE:20260903',
    // Folded MID-WORD, exactly as the real Airbnb DESCRIPTION above folds mid-URL: the
    // break carries no space of its own, so the halves must rejoin with nothing between.
    'SUMMARY:Blocked for maintenance while the boiler is replaced and the kitchen is repain',
    ' ted',
    'END:VEVENT',
  ].join('\r\n')
  const [event] = parseIcal(feed)
  assert.equal(
    event.summary,
    'Blocked for maintenance while the boiler is replaced and the kitchen is repainted'
  )
})

test('a feed with no DESCRIPTION yields null and still parses its dates', () => {
  const feed = [
    'BEGIN:VEVENT',
    'UID:no-description@booking.com',
    'DTSTART;VALUE=DATE:20260905',
    'DTEND;VALUE=DATE:20260908',
    'SUMMARY:CLOSED - Not available',
    'END:VEVENT',
  ].join('\r\n')
  const [event] = parseIcal(feed)
  assert.equal(event.platformRef, null)
  assert.equal(event.start, '2026-09-05')
  assert.equal(event.end, '2026-09-08')
  assert.equal(event.summary, 'CLOSED - Not available')
})

test('a DESCRIPTION with no reservation URL yields null, not a fragment of it', () => {
  const feed = [
    'BEGIN:VEVENT',
    'UID:plain-description@vrbo.com',
    'DTSTART;VALUE=DATE:20260910',
    'DTEND;VALUE=DATE:20260912',
    'SUMMARY:Reserved',
    'DESCRIPTION:Guest arriving late. Phone Number (Last 4 Digits): 0000',
    'END:VEVENT',
  ].join('\r\n')
  const [event] = parseIcal(feed)
  assert.equal(event.platformRef, null)
})

// --- the boundary cases. Each of these is a value that must NEVER reach the column. ---

const withDescription = (description) =>
  parseIcal(
    [
      'BEGIN:VEVENT',
      'UID:boundary@airbnb.com',
      'DTSTART;VALUE=DATE:20260915',
      'DTEND;VALUE=DATE:20260916',
      `DESCRIPTION:${description}`,
      'END:VEVENT',
    ].join('\r\n')
  )[0]

test('an over-long code is REJECTED, never truncated into a plausible wrong value', () => {
  const event = withDescription(
    `Reservation URL: https://www.airbnb.com/hosting/reservations/details/${'A'.repeat(64)}`
  )
  assert.equal(event.platformRef, null)
})

test('a code that continues in lower case is REJECTED, not returned as its prefix', () => {
  // Without the trailing (?![A-Za-z0-9]) this returns "ABCDEFGH12" — a colliding,
  // plausible-looking wrong value. This is the assertion that pins that boundary.
  const event = withDescription(
    'Reservation URL: https://www.airbnb.com/hosting/reservations/details/ABCDEFGH12ab'
  )
  assert.equal(event.platformRef, null)
})

test('a code followed by more characters is REJECTED, not sliced at the cap', () => {
  const event = withDescription(
    `Reservation URL: https://www.airbnb.com/hosting/reservations/details/${'A'.repeat(20)}9x`
  )
  assert.equal(event.platformRef, null)
})

test('the same path on a NON-Airbnb host yields null — origin is anchored', () => {
  // A host controls their own ical_urls, so an unanchored match would let them write any
  // value they chose onto their own bookings — and the RPC's coalesce makes it permanent.
  const event = withDescription(
    'Reservation URL: https://evil.example.com/hosting/reservations/details/CHOSENVAL1'
  )
  assert.equal(event.platformRef, null)
})

test('a lookalike domain does not satisfy the anchor', () => {
  // This one caught a real defect: a shape-based anchor (airbnb.<tld>[.<tld>]) accepts
  // airbnb.evil.com, which is precisely what an origin anchor exists to exclude. Only a
  // literal airbnb.com will do.
  const event = withDescription(
    'Reservation URL: https://airbnb.evil.com/hosting/reservations/details/CHOSENVAL1'
  )
  assert.equal(event.platformRef, null)
})

test('a subdomain of airbnb.com IS accepted', () => {
  const event = withDescription(
    'Reservation URL: https://www.airbnb.com/hosting/reservations/details/SUBDOMAIN1'
  )
  assert.equal(event.platformRef, 'SUBDOMAIN1')
})

test('a regional Airbnb domain yields null — the fail-safe direction', () => {
  // Deliberate: null is the normal, harmless outcome, and excluding lookalikes is worth
  // more than accepting a regional domain we have never actually seen in a feed.
  const event = withDescription(
    'Reservation URL: https://www.airbnb.co.uk/hosting/reservations/details/REGIONAL01'
  )
  assert.equal(event.platformRef, null)
})

test('a 7-character code is rejected and an 8-character one accepted — the floor is 8', () => {
  // Pins the floor exactly. It is not merely a collision-strength number: the same
  // DESCRIPTION line carries a 4-digit phone run, which a floor of 8 can never admit.
  const short = withDescription(
    'Reservation URL: https://www.airbnb.com/hosting/reservations/details/ABC1234'
  )
  assert.equal(short.platformRef, null)
  const atFloor = withDescription(
    'Reservation URL: https://www.airbnb.com/hosting/reservations/details/ABC12345'
  )
  assert.equal(atFloor.platformRef, 'ABC12345')
})

test('a 20-character code is accepted — the ceiling is inclusive', () => {
  const event = withDescription(
    `Reservation URL: https://www.airbnb.com/hosting/reservations/details/${'A'.repeat(20)}`
  )
  assert.equal(event.platformRef, 'A'.repeat(20))
})

test('an uppercase host yields null — the anchor is case-sensitive, the safe direction', () => {
  const event = withDescription(
    'Reservation URL: https://WWW.AIRBNB.COM/hosting/reservations/details/UPPERHOST1'
  )
  assert.equal(event.platformRef, null)
})

test('an unfolded feed parses exactly as before — no widened blast radius', () => {
  const feed = [
    'BEGIN:VEVENT',
    'UID:short-1@airbnb.com',
    'DTSTART;VALUE=DATE:20260801',
    'DTEND;VALUE=DATE:20260802',
    'SUMMARY:Reserved',
    'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/ABCDE12345',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:short-2@airbnb.com',
    'DTSTART:20260810T140000Z',
    'DTEND:20260812T100000Z',
    'SUMMARY:Blocked',
    'END:VEVENT',
  ].join('\r\n')
  const events = parseIcal(feed)
  assert.equal(events.length, 2)
  assert.deepEqual(events[0], {
    uid: 'short-1@airbnb.com',
    start: '2026-08-01',
    end: '2026-08-02',
    summary: 'Reserved',
    platformRef: 'ABCDE12345',
  })
  assert.deepEqual(events[1], {
    uid: 'short-2@airbnb.com',
    start: '2026-08-10',
    end: '2026-08-12',
    summary: 'Blocked',
    platformRef: null,
  })
})

test('unfolding removes ONE whitespace character, not a genuine space in the value', () => {
  // The continuation begins with TWO spaces: the first is the fold marker, the second
  // belongs to the value and must survive, so the words do not run together.
  const feed = [
    'BEGIN:VEVENT',
    'UID:double-space@example.com',
    'DTSTART;VALUE=DATE:20260920',
    'DTEND;VALUE=DATE:20260921',
    'SUMMARY:Reserved for',
    '  two nights',
    'END:VEVENT',
  ].join('\r\n')
  const [event] = parseIcal(feed)
  assert.equal(event.summary, 'Reserved for two nights')
})

test('LF-only feeds fold the same way as CRLF ones', () => {
  const feed = [
    'BEGIN:VEVENT',
    'UID:lf-only@airbnb.com',
    'DTSTART;VALUE=DATE:20260925',
    'DTEND;VALUE=DATE:20260926',
    'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/de',
    ' tails/LFONLY1234',
    'END:VEVENT',
  ].join('\n')
  const [event] = parseIcal(feed)
  assert.equal(event.platformRef, 'LFONLY1234')
})
