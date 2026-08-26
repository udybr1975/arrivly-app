// Unit tests for the public-peek demo helpers (node:test + node:assert only).
// Run with:  npm run test:public-demo
//
// WHAT THESE PIN:
//  - decideDemoTokenState: the demo apartment resolves 'active' for a matching booking on
//    BOTH sides of the date window (before check-in, and after the 11:00 checkout cutoff),
//    while a REAL apartment's three-way date rule is completely unchanged. Those two
//    branches are the whole of change 1b, and a regression in the second one would silently
//    make every real guest page permanently active.
//  - A null booking is 'neutral' even for the demo — the token still has to match.
//  - scriptedReply answers each of the four wire strings and falls back on everything else,
//    including a near-miss, a non-string and the empty string.
//  - DEMO_QUESTIONS and the script map cannot drift: every wire question has an answer.
//  - THE CLIENT AND SERVER WIRE STRINGS ARE EQUAL AS A WHOLE BLOCK. This is the assertion
//    that actually earns its place: the four questions are maintained in TWO files, the
//    drift is SILENT (a mismatched chip falls through to the fallback line instead of
//    erroring), and sampling one string is blind to "changed on one side only".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEMO_FALLBACK_REPLY,
  DEMO_QUESTIONS,
  decideDemoTokenState,
  scriptedReply,
} from './public-demo.ts'
import { DEMO_STARTERS } from '../../src/components/guest/demoStarters.ts'

// The public demo booking's real shape (invented dates are unnecessary here — these are the
// fixture's own published dates, which carry no personal data).
const BOOKING = { check_in: '2026-08-25', check_out: '2026-09-30' }

test('demo apartment: active BEFORE check-in', () => {
  assert.equal(decideDemoTokenState(true, BOOKING, '2026-08-01 09:00:00'), 'active')
})

test('demo apartment: active LONG AFTER the checkout cutoff', () => {
  assert.equal(decideDemoTokenState(true, BOOKING, '2027-03-14 18:30:00'), 'active')
})

test('demo apartment: no matching booking is still neutral', () => {
  assert.equal(decideDemoTokenState(true, null, '2026-08-26 09:00:00'), 'neutral')
})

test('real apartment: in dates -> active', () => {
  assert.equal(decideDemoTokenState(false, BOOKING, '2026-08-26 09:00:00'), 'active')
})

test('real apartment: after 11:00 on checkout day -> thankyou', () => {
  assert.equal(decideDemoTokenState(false, BOOKING, '2026-09-30 11:00:00'), 'thankyou')
})

test('real apartment: checkout day BEFORE 11:00 is still active', () => {
  assert.equal(decideDemoTokenState(false, BOOKING, '2026-09-30 10:59:59'), 'active')
})

test('real apartment: before check-in -> neutral (never active)', () => {
  assert.equal(decideDemoTokenState(false, BOOKING, '2026-08-01 09:00:00'), 'neutral')
})

test('every scripted question has a real answer, and none is the fallback', () => {
  for (const q of DEMO_QUESTIONS) {
    const reply = scriptedReply(q)
    assert.notEqual(reply, DEMO_FALLBACK_REPLY, `no scripted answer for: ${q}`)
    assert.ok(reply.length > 40)
  }
})

test('surrounding whitespace still matches', () => {
  assert.equal(scriptedReply('  ' + DEMO_QUESTIONS[0] + ' '), scriptedReply(DEMO_QUESTIONS[0]))
})

test('anything else falls back', () => {
  assert.equal(scriptedReply('whats the wifi password'), DEMO_FALLBACK_REPLY)
  assert.equal(scriptedReply(''), DEMO_FALLBACK_REPLY)
  assert.equal(scriptedReply(undefined), DEMO_FALLBACK_REPLY)
  assert.equal(scriptedReply({ toString: () => DEMO_QUESTIONS[0] }), DEMO_FALLBACK_REPLY)
})

test('prototype keys do not leak an answer', () => {
  assert.equal(scriptedReply('constructor'), DEMO_FALLBACK_REPLY)
  assert.equal(scriptedReply('__proto__'), DEMO_FALLBACK_REPLY)
  assert.equal(scriptedReply('toString'), DEMO_FALLBACK_REPLY)
})

test('client and server wire strings are IDENTICAL, as a whole block', () => {
  // deepEqual on the arrays, not a per-item loop and not a length check — order, count and
  // content all have to match, and a diff prints the whole block rather than one entry.
  assert.deepEqual(
    DEMO_STARTERS.map(c => c.send),
    [...DEMO_QUESTIONS],
    'src/components/guest/demoStarters.ts and api/_lib/public-demo.ts have drifted',
  )
})

test('every chip label is non-empty and shorter than its wire string or equal to it', () => {
  // Labels are allowed to differ from the wire string — that is the point of the split — but
  // an empty one would render a blank chip that still sends a real question.
  for (const c of DEMO_STARTERS) {
    assert.ok(c.label.trim().length > 0, `empty label for: ${c.send}`)
    assert.ok(c.label.length <= c.send.length)
  }
})
