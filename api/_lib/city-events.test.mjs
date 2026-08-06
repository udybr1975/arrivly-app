// Regression suite for the two B3.4 SERVER-SIDE VALIDATORS in city-events.ts.
//
// WHY THIS FILE EXISTS: both validators are SAFETY PREDICATES — one decides whether a link goes
// out under a host's brand, the other decides whether an out-of-window event reaches a guest — and
// both were added precisely because prompt wording had already failed at the same job. A predicate
// that silently loosens is the worst failure mode available here, so the assertions are the
// contract. KEEP THEM GREEN.
//
// It also exists because of how the hostname bug was found: the first version of these checks was
// validated against a HAND-COPIED transcription of the logic, which introduced a phantom failure
// (a template literal turned `\b` into a backspace) AND hid a real one. Import the real module.
//
// Run: npm run test:city-events
import test from 'node:test'
import assert from 'node:assert/strict'
import { urlIsEventSpecific, eventDateInWindow } from './city-events.ts'

const PLACE = 'Helsinki, Finland'

test('urlIsEventSpecific — rejects the exact urls the B3.3 smoke run shipped', () => {
  // Every one of these passed the provenance allowlist legitimately and still pointed at the wrong
  // place. This is the regression that motivated the whole check.
  assert.equal(
    urlIsEventSpecific(
      'https://www.jambase.com/festival/flow-festival-2026',
      'Hellsinki Metal Festival',
      PLACE,
    ),
    false,
    'a DIFFERENT festival must not be linked under this event name',
  )
  assert.equal(urlIsEventSpecific('https://www.livenation.fi/en', 'Haloo Helsinki!', PLACE), false)
  assert.equal(
    urlIsEventSpecific('https://concerts50.com/finland/helsinki', 'Haloo Helsinki!', PLACE),
    false,
    'a city listing contains the city name by construction — it must not count as evidence',
  )
})

test('urlIsEventSpecific — keeps urls that genuinely identify the event', () => {
  // Name in the HOSTNAME, not the path: the real festival site. A path-only check blanked this.
  assert.equal(
    urlIsEventSpecific(
      'https://hellsinkimetalfestival.fi/en/tickets',
      'Hellsinki Metal Festival',
      PLACE,
    ),
    true,
  )
  // Name in the path.
  assert.equal(
    urlIsEventSpecific('https://www.allaslive.fi/tapahtumat/pete-parkkonen', 'Pete Parkkonen', PLACE),
    true,
  )
  assert.equal(
    urlIsEventSpecific('https://ham.fi/en/exhibitions/tove-jansson-birthday', 'Tove Jansson birthday', PLACE),
    true,
  )
  assert.equal(
    urlIsEventSpecific('https://ticketmaster.fi/event/bbno-house-of-culture', 'bbno$ at House of Culture', PLACE),
    true,
  )
})

test('urlIsEventSpecific — shallow paths are rejected before the hostname can rescue them', () => {
  // Load-bearing ordering: the hostname is in the haystack, so without the shallow-path guard a
  // title token like "Live Nation" would match livenation.fi and keep a language landing page.
  assert.equal(urlIsEventSpecific('https://www.livenation.fi/en', 'Live Nation Presents', PLACE), false)
  assert.equal(urlIsEventSpecific('https://www.livenation.fi/', 'Live Nation Presents', PLACE), false)
  assert.equal(urlIsEventSpecific('https://kiasma.fi/fi_FI', 'Kiasma Kokoelma', PLACE), false)
})

test('urlIsEventSpecific — nothing matchable means BLANK, not unchecked', () => {
  // Short title: every token is under the 4-char floor.
  assert.equal(urlIsEventSpecific('https://example.fi/gigs/the-ark', 'The Ark', PLACE), false)
  // Non-Latin script: normalises to no usable ASCII token.
  assert.equal(urlIsEventSpecific('https://example.jp/events/12345', '東京の祭り', PLACE), false)
  // Title made entirely of generic listing vocabulary plus the city.
  assert.equal(urlIsEventSpecific('https://example.fi/events/summer', 'Helsinki Festival', PLACE), false)
  // Opaque numeric id carries no aboutness.
  assert.equal(urlIsEventSpecific('https://ticketmaster.fi/event/12345', 'Bbno$ at House of Culture', PLACE), false)
})

test('urlIsEventSpecific — a YEAR in the title is not evidence of aboutness', () => {
  // REGRESSION: "2026" is 4 chars, not generic and not a place token, so without the numeric-token
  // exclusion it matches the year in an aggregator slug and re-links the WRONG festival.
  assert.equal(
    urlIsEventSpecific(
      'https://www.jambase.com/festival/flow-festival-2026',
      'Hellsinki Metal Festival 2026',
      PLACE,
    ),
    false,
  )
  assert.equal(
    urlIsEventSpecific('https://concerts50.com/finland/helsinki/2026', 'Helsinki Pride 2026', PLACE),
    false,
  )
  // The real site still matches on its name, year or no year.
  assert.equal(
    urlIsEventSpecific('https://hellsinkimetalfestival.fi/2026/tickets', 'Hellsinki Metal Festival 2026', PLACE),
    true,
  )
})

test('urlIsEventSpecific — tokens must not match across path-segment boundaries', () => {
  // Joining tokens without a separator would let "artek" match "/art/ekstra".
  assert.equal(urlIsEventSpecific('https://example.fi/art/ekstra', 'Artek Exhibition', PLACE), false)
})

test('urlIsEventSpecific — never throws on malformed input', () => {
  for (const u of ['', 'not a url', 'https://', '://x', 'https://[bad']) {
    assert.equal(urlIsEventSpecific(u, 'Some Event Name', PLACE), false)
  }
})

test('urlIsEventSpecific — a lone % does not throw (decodeURIComponent guard)', () => {
  // The WHATWG URL parser does NOT encode a stray `%`, so it reaches decodeURIComponent verbatim.
  // An escaping URIError would break the module's never-throws contract and 500 the PUBLIC guest
  // endpoint, because three of the four callers have no try/catch.
  assert.doesNotThrow(() => urlIsEventSpecific('https://x.fi/100%off', 'Some Event Name', PLACE))
  assert.doesNotThrow(() => urlIsEventSpecific('https://x.fi/e?d=50%', 'Some Event Name', PLACE))
  assert.doesNotThrow(() => urlIsEventSpecific('https://x.fi/%%%', 'Some Event Name', PLACE))
  // And it still decides correctly on the raw fallback.
  assert.equal(urlIsEventSpecific('https://x.fi/gigs/parkkonen-100%off', 'Pete Parkkonen', PLACE), true)
})

// Window used across the date tests: 6 Aug 2026 → 13 Aug 2026 inclusive (the real B3.3 window).
const START = Date.UTC(2026, 7, 6)
const END = Date.UTC(2026, 7, 13) + 86_399_999

test('eventDateInWindow — drops the exact leak B3.3 shipped', () => {
  // "The Ark, 5 August" against a window starting 6 August. Prompt wording failed at this twice.
  assert.equal(eventDateInWindow('5 August', START, END), false)
})

test('eventDateInWindow — single dates, inclusive at both edges', () => {
  assert.equal(eventDateInWindow('6 August', START, END), true, 'first day is INSIDE')
  assert.equal(eventDateInWindow('13 August', START, END), true, 'last day is INSIDE')
  assert.equal(eventDateInWindow('14 August', START, END), false)
  assert.equal(eventDateInWindow('1 September', START, END), false)
  assert.equal(eventDateInWindow('August 8', START, END), true, 'month-first order')
  assert.equal(eventDateInWindow('8 Aug', START, END), true, 'abbreviated month')
})

test('eventDateInWindow — a range is kept when ANY day intersects', () => {
  assert.equal(eventDateInWindow('7-8 August', START, END), true)
  assert.equal(eventDateInWindow('12-15 August', START, END), true, 'straddles the end edge')
  assert.equal(eventDateInWindow('4-5 August', START, END), false, 'entirely before')
  assert.equal(eventDateInWindow('4-7 August', START, END), true, 'straddles the start edge')
})

test('eventDateInWindow — a CROSS-MONTH range is kept, never clamped into one month', () => {
  // REGRESSION, and the worst class available here: first-match-wins over a chronological month
  // dict picked the EARLIER month and clamped the days into it, so an event running THROUGH the
  // window was dropped. Systematic for long exhibitions/markets/festivals.
  assert.equal(eventDateInWindow('26 July - 9 August', START, END), null, 'live through the stay')
  assert.equal(eventDateInWindow('1 June - 31 August', START, END), null, 'summer exhibition')
  assert.equal(eventDateInWindow('31 August - 2 September', START, END), null)
})

test('eventDateInWindow — a month word in prose does not become a date', () => {
  // "may" is also an English modal; two distinct months also resolve to null.
  assert.equal(eventDateInWindow('8 August (may sell out)', START, END), null)
  assert.equal(eventDateInWindow('may sell out on the 8th', START, END), null)
  // A month name with no adjacent day number is not a date reference.
  assert.equal(eventDateInWindow('all week in August', START, END), null)
})

test('eventDateInWindow — ISO dates need no year inference', () => {
  assert.equal(eventDateInWindow('2026-08-08', START, END), true)
  assert.equal(eventDateInWindow('2026-08-05', START, END), false)
  assert.equal(eventDateInWindow('2026-08-07 - 2026-08-08', START, END), true)
  assert.equal(eventDateInWindow('2025-08-08', START, END), false, 'right day, wrong YEAR')
})

test('eventDateInWindow — unjudgeable strings KEEP the event (null), never drop it', () => {
  // This is the load-bearing safety direction: an unhandled shape must degrade to the prompt-only
  // behaviour, not silently empty a city.
  for (const d of ['', 'Saturday', 'August 2026', 'all week', 'Ongoing', '8 elokuuta', '8 augusti']) {
    assert.equal(eventDateInWindow(d, START, END), null, `"${d}" must be unjudged`)
  }
})

test('eventDateInWindow — a stray time widens the range and can only KEEP', () => {
  assert.equal(eventDateInWindow('8 August 19:00', START, END), true)
  // Worth stating: a time on an out-of-window date can pull it back in. Accepted — the safe
  // direction is keeping a wrong event, never dropping a right one.
  assert.equal(eventDateInWindow('2 August 20:00', START, END), true)
})

test('eventDateInWindow — a window crossing New Year tries both years', () => {
  const s = Date.UTC(2026, 11, 29) // 29 Dec 2026
  const e = Date.UTC(2027, 0, 5) + 86_399_999 // 5 Jan 2027
  assert.equal(eventDateInWindow('31 December', s, e), true)
  assert.equal(eventDateInWindow('2 January', s, e), true, 'must resolve to 2027, not 2026')
  assert.equal(eventDateInWindow('20 January', s, e), false)
  assert.equal(eventDateInWindow('15 December', s, e), false)
})
