// Unit tests for the listing importer's PURE layer (no test framework — node:test +
// node:assert only). Run with:  npm run test:import-listing
//
// WHAT THIS GUARDS: everything here processes MODEL OUTPUT, which is untrusted input that is
// then shown to a host and applied to their property. The validation layer is the only thing
// standing between a hallucinated field and a write, so its rules are pinned rather than
// assumed. No network, no supabase — every function under test is pure.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateImport,
  isEmptyProposal,
  coerceArray,
  unwrapProposal,
  MAX_FIELD_CHARS,
  MAX_EXTRAS_ITEMS,
  MAX_CONFLICT_VALUES,
  SYSTEM_PROMPT,
} from './import-listing.ts'
import {
  MAX_IMPORT_CHARS,
  MIN_EXTRACTED_CHARS,
  truncateForImport,
  stripWhatsAppStamps,
  looksLikeCredentialText,
  estimateTokens,
  CONTENT_TOKEN_BUDGET,
  OUTPUT_TOKEN_BUDGET,
  TPM_CEILING,
} from '../../src/lib/listingText.ts'

// ── validation: categories ────────────────────────────────────────────────────────────────

test('a hallucinated extras category is DROPPED, not coerced', () => {
  const { proposal } = validateImport({
    extras: [
      { category: 'Parking', content: 'Space 14 in the garage' },
      { category: 'Hallucinated', content: 'should not survive' },
      { category: 'parking', content: 'wrong case — isExtrasCategory is case-sensitive' },
      { category: 'Parking ', content: 'trailing space' },
    ],
  })
  assert.equal(proposal.extras.length, 1)
  assert.deepEqual(proposal.extras[0], { category: 'Parking', content: 'Space 14 in the garage' })
})

test('an extras item with empty or non-string content is dropped', () => {
  const { proposal } = validateImport({
    extras: [
      { category: 'Safety', content: '   ' },
      { category: 'Safety', content: 42 },
      { category: 'Safety' },
      { category: 'Safety', content: 'Fuse box is in the hall cupboard' },
    ],
  })
  assert.equal(proposal.extras.length, 1)
  assert.equal(proposal.extras[0].content, 'Fuse box is in the hall cupboard')
})

test('extras array is capped', () => {
  const many = Array.from({ length: MAX_EXTRAS_ITEMS + 10 }, () => ({ category: 'Amenities', content: 'x' }))
  const { proposal } = validateImport({ extras: many })
  assert.equal(proposal.extras.length, MAX_EXTRAS_ITEMS)
})

// ── validation: max_guests coercion ───────────────────────────────────────────────────────

test('max_guests accepts a number and a numeric string, in range', () => {
  assert.equal(validateImport({ basics: { max_guests: 4 } }).proposal.basics.max_guests, 4)
  assert.equal(validateImport({ basics: { max_guests: '6' } }).proposal.basics.max_guests, 6)
  assert.equal(validateImport({ basics: { max_guests: 1 } }).proposal.basics.max_guests, 1)
  assert.equal(validateImport({ basics: { max_guests: 50 } }).proposal.basics.max_guests, 50)
})

test('max_guests out of range or non-integer is DROPPED, never clamped', () => {
  // Clamping would write a number the document does not support into a real column.
  for (const bad of [0, -3, 51, 9999, 2.5, 'four', null, undefined, NaN, Infinity, {}]) {
    const { proposal } = validateImport({ basics: { max_guests: bad } })
    assert.equal(proposal.basics.max_guests, undefined, `max_guests should be dropped for ${JSON.stringify(bad)}`)
  }
})

// ── validation: unknown keys and caps ─────────────────────────────────────────────────────

test('unknown keys are STRIPPED at every level', () => {
  const { proposal } = validateImport({
    basics: { city: 'Helsinki', host_id: 'attacker', tier: 4, is_exempt: true },
    wifi: { ssid: 'Net', password: 'pw', hidden_field: 'x' },
    checkin: { door_code: '1234', evil: 'y' },
    unknown_root_key: 'z',
  })
  assert.deepEqual(Object.keys(proposal.basics), ['city'])
  assert.deepEqual(Object.keys(proposal.wifi).sort(), ['password', 'ssid'])
  assert.deepEqual(Object.keys(proposal.checkin), ['door_code'])
  assert.ok(!('unknown_root_key' in proposal))
  assert.ok(!('host_id' in proposal.basics))
})

test('per-field character cap is enforced', () => {
  const long = 'a'.repeat(MAX_FIELD_CHARS + 500)
  const { proposal } = validateImport({
    rules: long,
    picks_text: long,
    basics: { description: long },
    checkin: { entry_instructions: long },
    extras: [{ category: 'Good to know', content: long }],
  })
  assert.equal(proposal.rules.length, MAX_FIELD_CHARS)
  assert.equal(proposal.picks_text.length, MAX_FIELD_CHARS)
  assert.equal(proposal.basics.description.length, MAX_FIELD_CHARS)
  assert.equal(proposal.checkin.entry_instructions.length, MAX_FIELD_CHARS)
  assert.equal(proposal.extras[0].content.length, MAX_FIELD_CHARS)
})

test('strings are trimmed and empty ones dropped', () => {
  const { proposal } = validateImport({
    basics: { city: '  Helsinki  ', street: '   ', country: '' },
    rules: '   ',
  })
  assert.equal(proposal.basics.city, 'Helsinki')
  assert.equal(proposal.basics.street, undefined)
  assert.equal(proposal.basics.country, undefined)
  assert.equal(proposal.rules, undefined)
})

// ── validation: wrapped JSON (the Groq json_object workaround) ─────────────────────────────

test('coerceArray unwraps a single array-valued property', () => {
  assert.deepEqual(coerceArray([1, 2]), [1, 2])
  assert.deepEqual(coerceArray({ items: [1, 2] }), [1, 2])
  // Ambiguous (two arrays) degrades to empty rather than guessing which one was meant.
  assert.deepEqual(coerceArray({ a: [1], b: [2] }), [])
  assert.deepEqual(coerceArray('nope'), [])
  assert.deepEqual(coerceArray(null), [])
})

test('a wrapped extras array still validates', () => {
  const { proposal } = validateImport({ extras: { categories: [{ category: 'Transport', content: 'Tram 6' }] } })
  assert.equal(proposal.extras.length, 1)
  assert.equal(proposal.extras[0].category, 'Transport')
})

test('unwrapProposal unwraps a whole wrapped proposal, but never a legitimate one', () => {
  const inner = { basics: { city: 'Paris' } }
  assert.deepEqual(unwrapProposal({ result: inner }), inner)
  // Already correct: must be returned as-is even though it contains object-valued properties.
  assert.deepEqual(unwrapProposal(inner), inner)
  assert.deepEqual(unwrapProposal(null), {})
})

test('a fully wrapped response survives end to end', () => {
  const { proposal } = validateImport({ proposal: { basics: { city: 'Barcelona' }, wifi: { ssid: 'CasaMarco' } } })
  assert.equal(proposal.basics.city, 'Barcelona')
  assert.equal(proposal.wifi.ssid, 'CasaMarco')
})

// ── validation: conflicts and skipped ─────────────────────────────────────────────────────

test('a conflict needs at least two values, and values are capped', () => {
  const { conflicts } = validateImport({
    conflicts: [
      { field: 'check_out_by', values: ['10:00', '11:00'] },
      { field: 'lonely', values: ['only one'] },
      { field: 'empty', values: [] },
      { field: 'many', values: Array.from({ length: MAX_CONFLICT_VALUES + 4 }, (_, i) => `v${i}`) },
      { values: ['no field name', 'x'] },
    ],
  })
  assert.equal(conflicts.length, 2)
  assert.deepEqual(conflicts[0], { field: 'check_out_by', values: ['10:00', '11:00'] })
  assert.equal(conflicts[1].values.length, MAX_CONFLICT_VALUES)
})

test('skipped entries are short strings; non-strings are dropped', () => {
  const { skipped } = validateImport({ skipped: ['cancellation policy', '', 7, null, 'host contact details'] })
  assert.deepEqual(skipped, ['cancellation policy', 'host contact details'])
})

// ── validation: total garbage never throws ────────────────────────────────────────────────

test('garbage input yields an empty proposal rather than throwing', () => {
  for (const junk of [null, undefined, 42, 'a string', [], [1, 2, 3], { basics: 'not an object' }]) {
    const r = validateImport(junk)
    assert.ok(isEmptyProposal(r.proposal), `expected empty proposal for ${JSON.stringify(junk)}`)
    assert.deepEqual(r.skipped, [])
    assert.deepEqual(r.conflicts, [])
  }
})

test('isEmptyProposal is false as soon as any one field is present', () => {
  assert.equal(isEmptyProposal(validateImport({}).proposal), true)
  assert.equal(isEmptyProposal(validateImport({ rules: 'No smoking' }).proposal), false)
  assert.equal(isEmptyProposal(validateImport({ picks_text: 'Try Cafe X' }).proposal), false)
  assert.equal(isEmptyProposal(validateImport({ wifi: { ssid: 'N' } }).proposal), false)
  assert.equal(isEmptyProposal(validateImport({ extras: [{ category: 'Safety', content: 'c' }] }).proposal), false)
  // skipped/conflicts alone do NOT make a proposal non-empty — there is nothing to apply.
  assert.equal(isEmptyProposal(validateImport({ skipped: ['prices'] }).proposal), true)
})

// ── truncation boundary ───────────────────────────────────────────────────────────────────

test('truncation boundary: BOTH caps apply, and the token budget usually binds first', () => {
  // A text inside both caps is returned untouched and not flagged.
  const small = 'Check-in from 15:00. '.repeat(50)
  assert.deepEqual(truncateForImport(small), { text: small, truncated: false })
  assert.deepEqual(truncateForImport(''), { text: '', truncated: false })

  // MAX_IMPORT_CHARS of ASCII is ~4,000 estimated tokens, which is OVER CONTENT_TOKEN_BUDGET —
  // so the token budget, not the character ceiling, is what cuts it. This is the behaviour the
  // char-only cap got wrong, and the assertion that would fail if it were reintroduced.
  const atCharCap = 'x'.repeat(MAX_IMPORT_CHARS)
  const r = truncateForImport(atCharCap)
  assert.equal(r.truncated, true)
  assert.ok(r.text.length < MAX_IMPORT_CHARS)
  assert.ok(estimateTokens(r.text) <= CONTENT_TOKEN_BUDGET)
})

// ── WhatsApp stamp stripping ──────────────────────────────────────────────────────────────

test('WhatsApp export stamps are stripped, message bodies are not', () => {
  const input = '[10:34, 3/7/2026] Anna: The door code is 2049\n[9:05, 12/11/2026] Guest Name: Thanks!'
  assert.equal(stripWhatsAppStamps(input), 'The door code is 2049\nThanks!')
})

test('a message body containing a colon survives — the sender bound cannot cross one', () => {
  const input = '[10:34, 3/7/2026] Anna: Check-in: after 15:00'
  assert.equal(stripWhatsAppStamps(input), 'Check-in: after 15:00')
})

test('text with no stamps is returned unchanged, and stripping is not call-order dependent', () => {
  const plain = 'Check-in from 15:00. WiFi password is hunter2.'
  assert.equal(stripWhatsAppStamps(plain), plain)
  // The exported regex carries /g and is therefore stateful; stripWhatsAppStamps must not share
  // its lastIndex between calls. Same input twice must give the same answer.
  const stamped = '[10:34, 3/7/2026] Anna: one\n[10:35, 3/7/2026] Anna: two'
  assert.equal(stripWhatsAppStamps(stamped), stripWhatsAppStamps(stamped))
  assert.equal(stripWhatsAppStamps(stamped), 'one\ntwo')
})

test('the scan threshold is a small positive number below any real manual', () => {
  assert.ok(MIN_EXTRACTED_CHARS > 0 && MIN_EXTRACTED_CHARS < 200)
})

// ── credential heuristic ──────────────────────────────────────────────────────────────────
//
// This is a SECURITY control, not a nicety: it is the only thing that can catch a door code the
// model sorted into a PUBLIC field, and public fields default to ticked in the review screen.

test('credential-looking text in a public field is detected', () => {
  for (const t of [
    'The WiFi password is hunter2',
    'Door code: 2049#',
    'door  code 1234',
    'Use the keypad by the gate',
    'The key pad code is 9981',
    'Your PIN is 4417',
    'Network SSID: BemguStay',
    'The lockbox is by the door',
    'lock box code 5567',
    'Entry code 8890',
    'wifi: CasaMarco',
    'Wi-Fi name is Anna_5G',
    'passcode 1122',
  ]) {
    assert.ok(looksLikeCredentialText(t), `should flag: ${t}`)
  }
})

test('ordinary house-rules text is NOT flagged', () => {
  for (const t of [
    'No smoking anywhere in the apartment.',
    'Please keep noise down after 22:00.',
    'Recycling goes in the bins in the courtyard.',
    'Tram 6 stops right outside.',
    'Check-in from 15:00.',
    'The nearest supermarket is two streets away.',
  ]) {
    assert.equal(looksLikeCredentialText(t), false, `should NOT flag: ${t}`)
  }
})

test('the heuristic errs toward flagging, and never throws on odd input', () => {
  assert.equal(looksLikeCredentialText(''), false)
  // Word-bounded so it does not fire on every word containing "pin".
  assert.equal(looksLikeCredentialText('The shopping centre is nearby'), false)
  assert.equal(looksLikeCredentialText('spinning class next door'), false)
  assert.ok(looksLikeCredentialText('PIN'))
})

// ── token budget ──────────────────────────────────────────────────────────────────────────
//
// A CHARACTER cap alone cannot be safe: SYSTEM_PROMPT tells the model to preserve the document's
// language, and a dense script blows the TPM reservation at a character count Latin text handles
// comfortably. An unsatisfiable reservation is a PERMANENT failure no retry clears, so this is
// the property that must not regress.

test('estimateTokens counts non-ASCII as far more expensive than ASCII', () => {
  const latin = 'a'.repeat(3000)
  const greek = 'α'.repeat(3000)
  assert.ok(estimateTokens(greek) > estimateTokens(latin) * 2)
  assert.equal(estimateTokens(''), 0)
})

test('estimateTokens is conservative — it must never UNDER-count', () => {
  // 3 chars/token for ASCII against a real ~4: the estimate is deliberately above the truth.
  assert.ok(estimateTokens('a'.repeat(1200)) >= 400)
})

test('a Latin document is truncated by the token budget, and still clears the 9,190-char export', () => {
  const booking = 'Check-in from 15:00. No smoking. Tram 6 stops outside. '.repeat(170).slice(0, 9190)
  const r = truncateForImport(booking)
  assert.equal(r.truncated, false, 'the largest real document measured must pass untruncated')
  assert.equal(r.text.length, 9190)
})

test('a DENSE-SCRIPT document is truncated far earlier than a Latin one — the whole point', () => {
  const greek = 'Η άφιξη είναι μετά τις 15:00. Ο κωδικός είναι στο κουτί. '.repeat(300)
  const latin = 'Check-in is after 15:00. The code is in the box. '.repeat(300)
  const g = truncateForImport(greek)
  const l = truncateForImport(latin)
  assert.equal(g.truncated, true)
  assert.ok(g.text.length < l.text.length, 'dense script must yield a shorter kept prefix')
})

test('whatever comes back is ALWAYS inside both caps — the invariant the reservation depends on', () => {
  for (const sample of [
    'a'.repeat(50_000),
    'α'.repeat(50_000),
    '日'.repeat(50_000),
    'Ω'.repeat(12_000),
    'plain short text',
    '',
  ]) {
    const { text } = truncateForImport(sample)
    assert.ok(text.length <= MAX_IMPORT_CHARS, 'char cap breached')
    assert.ok(
      estimateTokens(text) <= CONTENT_TOKEN_BUDGET,
      `token budget breached: ${estimateTokens(text)} > ${CONTENT_TOKEN_BUDGET}`,
    )
  }
})

test('truncateForImport terminates and never returns more than it was given', () => {
  const src = '日'.repeat(9000)
  const { text, truncated } = truncateForImport(src)
  assert.ok(text.length > 0)
  assert.ok(text.length < src.length)
  assert.equal(truncated, true)
  assert.ok(src.startsWith(text), 'must keep a PREFIX, never reorder or drop from the middle')
})

// ── the reservation invariant ─────────────────────────────────────────────────────────────
//
// THE ONE ASSERTION EVERYTHING ELSE RESTS ON. Groq debits promptTokens + max_tokens as a
// RESERVATION; above the ceiling that is a PERMANENT failure no retry clears. Two of the three
// terms are dynamic — SYSTEM_PROMPT interpolates EXTRAS_CATEGORIES, and the NEXT queued item is
// a category-naming migration — so without this the budget silently degrades until a host's
// import fails forever. Comments cannot enforce arithmetic; this can.

test('system + content + output reservation stays under the TPM ceiling', () => {
  const system = estimateTokens(SYSTEM_PROMPT)
  const reservation = system + CONTENT_TOKEN_BUDGET + OUTPUT_TOKEN_BUDGET
  assert.ok(
    reservation <= TPM_CEILING,
    `reservation ${reservation} (system ${system} + content ${CONTENT_TOKEN_BUDGET} + output ${OUTPUT_TOKEN_BUDGET}) exceeds the ${TPM_CEILING} TPM ceiling — lower a budget or shorten SYSTEM_PROMPT`,
  )
  // Real headroom, not a hairline pass: other tenants share this minute.
  assert.ok(TPM_CEILING - reservation >= 800, `only ${TPM_CEILING - reservation} tokens of headroom left`)
})

test('whitespace-exploded text (a per-glyph PDF) is NOT under-counted', () => {
  // pdfjs joins text items with a space; some PDFs emit one item per glyph. Char-counting alone
  // scores this far too cheaply — the run-count half of estimateTokens is what catches it.
  const exploded = 'T h e   d o o r   c o d e   i s   2 0 4 9 '.repeat(200)
  const runs = exploded.match(/\S+/g).length
  assert.ok(estimateTokens(exploded) >= runs, 'every whitespace-delimited run costs at least one token')
  const { text } = truncateForImport(exploded)
  assert.ok(estimateTokens(text) <= CONTENT_TOKEN_BUDGET)
})

test('the digit-run half can be switched off for number-bearing address fields', () => {
  assert.equal(looksLikeCredentialText('Helsinki 00100'), true)
  assert.equal(looksLikeCredentialText('Helsinki 00100', { digitRun: false }), false)
  // Words still apply with the digit run off — switching it off must not disarm the control.
  assert.equal(looksLikeCredentialText('wifi password hunter2', { digitRun: false }), true)
})
