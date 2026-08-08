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

test('eventDateInWindow — a CROSS-MONTH range is now JUDGED, and still never clamped', () => {
  // CHANGED (8 Aug 2026): these three asserted `null` because a cross-month range was unjudgeable.
  // They are now judged. The GUEST OUTCOME of the first two is IDENTICAL — they intersect, so they
  // were kept before and are kept now; only the reason changed from "cannot judge" to "verified
  // inside". The third is a REAL behaviour change and the whole point of the exercise.
  //
  // THE ORIGINAL REGRESSION MUST STILL NEVER RETURN: first-match-wins over a chronological month
  // dict picked the EARLIER month and clamped the days into it, so an event running THROUGH the
  // window was dropped. Systematic for long exhibitions/markets/festivals. The first two lines are
  // exactly that regression's fingerprint — if either ever flips to false, it is back.
  assert.equal(eventDateInWindow('26 July - 9 August', START, END), true, 'live through the stay')
  assert.equal(eventDateInWindow('1 June - 31 August', START, END), true, 'summer exhibition')
  assert.equal(
    eventDateInWindow('31 August - 2 September', START, END),
    false,
    'entirely AFTER the window — previously kept because it could not be judged',
  )
})

test('eventDateInWindow — the two real leaks from the 8 Aug 2026 cron run', () => {
  // Window 8-15 Aug 2026, fi:helsinki. Both reached the SHARED city row, so they were served to
  // every Helsinki host's guests, not one apartment. That is what promoted this fix.
  const s = Date.UTC(2026, 7, 8)
  const e = Date.UTC(2026, 7, 15) + 86_399_999
  assert.equal(
    eventDateInWindow('18 August - 5 September 2026', s, e),
    false,
    'Helsinki Festival — starts TEN DAYS after the window ends',
  )
  // "Poets of the Fall" carried date "". The DROP for this one happens at the CALL SITE
  // (eventsDroppedNoDate), NOT here: absent is not "outside the window", and conflating the two
  // would destroy the eventsDroppedOutOfWindow diagnostic.
  assert.equal(eventDateInWindow('', s, e), null, 'absent date stays UNJUDGED here by contract')
})

test('eventDateInWindow — the two survivors CLAUDE.md recorded', () => {
  // Recorded window 7-14 Aug 2026. Both are ENGLISH CROSS-MONTH RANGES, not Finnish dates — the
  // OPEN-1 note misdiagnosed them as needing a d.m.yyyy branch, which would have caught neither.
  const s = Date.UTC(2026, 7, 7)
  const e = Date.UTC(2026, 7, 14) + 86_399_999
  assert.equal(eventDateInWindow('20 August - 1 November', s, e), false)
  assert.equal(eventDateInWindow('28 August - 6 September', s, e), false)
})

test('eventDateInWindow — cross-month ranges that must still be KEPT', () => {
  assert.equal(eventDateInWindow('30 July - 8 August', START, END), true, 'starts before, ends inside')
  assert.equal(eventDateInWindow('1 July - 30 September', START, END), true, 'spans the window entirely')
  // Ambiguity => null, never a guess.
  assert.equal(
    eventDateInWindow('July - 9 August', START, END),
    null,
    'one month has no adjacent day number',
  )
  assert.equal(
    eventDateInWindow('July - August - September', START, END),
    null,
    'three distinct months stay unjudgeable',
  )
  // A leading DAY RANGE makes the start ambiguous, so the whole string resolves to null (KEEP)
  // rather than being placed on the later day and possibly wrongly dropped.
  assert.equal(
    eventDateInWindow('10-12 August - 3 September', START, END),
    null,
    'a day range before the month is ambiguous — keep, do not place on the 12th',
  )
})

test('eventDateInWindow — a cross-month range across New Year tries both years', () => {
  const s = Date.UTC(2026, 11, 29) // 29 Dec 2026
  const e = Date.UTC(2027, 0, 5) + 86_399_999 // 5 Jan 2027
  assert.equal(
    eventDateInWindow('28 December - 3 January', s, e),
    true,
    'December -> January is a rollover, not a backwards span',
  )
  assert.equal(eventDateInWindow('15 January - 20 January', s, e), false, 'single month, after the window')
})

test('eventDateInWindow — a rollover range is anchored in the year BEFORE the window too', () => {
  // MUST-FIX from review, and a deterministic wrong-drop rather than an edge case: a rollover
  // range has its two ends in different calendar years, so anchoring the start at a WINDOW year is
  // wrong whenever the window sits on the later side of the boundary. Every 7-day window from ~1
  // January onward is fully inside the new year, and Christmas markets, ice rinks and winter-light
  // festivals are all written as a December -> January range.
  const s = Date.UTC(2027, 0, 5) // 5 Jan 2027
  const e = Date.UTC(2027, 0, 12) + 86_399_999 // 12 Jan 2027
  assert.equal(
    eventDateInWindow('26 December - 9 January', s, e),
    true,
    'runs 26 Dec 2026 - 9 Jan 2027 and covers the whole window',
  )
  // The same shape without a New Year: a long exhibition whose end month precedes its start month.
  assert.equal(
    eventDateInWindow('15 October - 30 September', START, END),
    true,
    'a year-long exhibition spanning the August window',
  )
  // Still dropped when it genuinely does not reach the window.
  assert.equal(eventDateInWindow('26 December - 3 January', Date.UTC(2027, 1, 2), Date.UTC(2027, 1, 9) + 86_399_999), false)
})

test('eventDateInWindow — an INCOMPLETE dotted range is unjudgeable, never judged on its end', () => {
  // MUST-FIX from review. The standard Finnish/European convention carries the year ONCE, on the
  // end date. Requiring \d{4} on every date sees only the END, which places a month-long event on
  // its final day — the clamping regression re-created on a new branch, hitting the same long
  // exhibition/festival content.
  assert.equal(eventDateInWindow('8.8.-15.8.2026', START, END), null, 'year only on the end date')
  assert.equal(eventDateInWindow('1.8.-31.8.2026', START, END), null, 'live through the whole stay')
  assert.equal(eventDateInWindow('26.7.-9.8.2026', START, END), null)
  // A month NAME beats a dotted date: the dotted one is incidental (a purchase deadline), and
  // judging on it would drop a real in-window event.
  assert.equal(
    eventDateInWindow('10 August, tickets from 1.7.2026', START, END),
    true,
    'judged on the month name, not the incidental dotted date',
  )
})

test('eventDateInWindow — d.m.yyyy, with ambiguity resolved by WIDENING', () => {
  assert.equal(eventDateInWindow('8.8.2026', START, END), true, 'inside')
  assert.equal(eventDateInWindow('5.8.2026', START, END), false, 'before the window')
  assert.equal(eventDateInWindow('20.8.2026', START, END), false, 'after the window')
  assert.equal(eventDateInWindow('7.8.2026 - 15.8.2026', START, END), true, 'range intersects')
  // Entirely after, and UNAMBIGUOUS: both days exceed 12, so only the d.m reading is valid and the
  // union cannot widen beyond September.
  assert.equal(eventDateInWindow('20.9.2026 - 25.9.2026', START, END), false, 'range entirely after')
  // KNOWN AND ACCEPTED CONSEQUENCE of widening: when every part of a RANGE is ambiguous the union
  // of both readings can span most of a year, so such a range is kept almost unconditionally.
  // "1.9.2026 - 5.9.2026" reads as 1-5 September but ALSO as 9 January / 9 May, and that union
  // covers an August window. Keeping a wrong event is the safe direction; the alternative is
  // assuming European order, which would wrongly DROP a genuine m.d date.
  assert.equal(
    eventDateInWindow('1.9.2026 - 5.9.2026', START, END),
    true,
    'fully ambiguous range widens to a union that intersects — keep, do not guess the order',
  )
  // Both readings are valid (12 August or 8 December), so BOTH are tried and the span is their
  // union — a union can only ever KEEP, which is the safe direction.
  assert.equal(eventDateInWindow('12.8.2026', START, END), true, 'd.m reading intersects')
  assert.equal(eventDateInWindow('8.12.2026', START, END), true, 'm.d reading intersects')
  // Two-digit years are out of scope and fall through to the month-name logic, which finds none.
  assert.equal(eventDateInWindow('8.8.26', START, END), null, '2-digit year is not judged')
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
  //
  // CHANGED (8 Aug 2026): '' was REMOVED from this list only — not because its return value moved
  // (eventDateInWindow('') is still null, asserted in the 8-Aug-leaks test above) but because an
  // undated event is now dropped at the CALL SITE via eventsDroppedNoDate. Listing it here would
  // read as "an undated event survives", which is no longer true of the pipeline.
  for (const d of ['Saturday', 'August 2026', 'all week', 'Ongoing', '8 elokuuta', '8 augusti']) {
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
