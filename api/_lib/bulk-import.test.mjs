// Tests for api/bulk-import.ts — its SYSTEM_PROMPT and its buildRows scrub (node:test +
// node:assert only).
// Run with:  npm run test:bulk-import
//
// READ THIS BEFORE TRUSTING THESE ASSERTIONS. Everything ABOVE the MECHANISM section near the
// bottom checks the PROMPT'S CONTENT and the two prompts' AGREEMENT WITH EACH OTHER. Nothing
// in that part checks what a model actually does with either — that needs a real generation,
// and this repo holds no AI credentials outside Vercel, so a behavioural test of the MODEL
// cannot run in this environment at all. The live paste is still the real test for the prompt;
// MESSY_FIXTURE at the bottom is the script for it.
//
// THE MECHANISM SECTION IS DIFFERENT and must not be tarred with the paragraph above: buildRows
// is pure, so those tests run the real scrub on real input and ARE behavioural. That section
// was added 23 Aug 2026 and this header was corrected in the same commit — the earlier version
// said "everything here checks the prompt", which would have led a reader to under-credit the
// only tests in the file that pin a security boundary.
//
// The distinction matters because of how the offerings defect was found in the first place:
// five live rounds against real, run-on host prose, after code that had already passed both
// gates twice. A tidy fixture always passes. A prompt-content assertion is not a behavioural
// one and must never be reported as though it were.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SYSTEM_PROMPT, buildRows, normaliseItems } from '../bulk-import.ts'
import { SYSTEM_PROMPT as IMPORTER_PROMPT } from './import-listing.ts'
import { EXTRAS_CATEGORIES } from '../../src/lib/detailCategories.ts'

const SOURCE = readFileSync(new URL('../bulk-import.ts', import.meta.url), 'utf8')

// ---------------------------------------------------------------------------
// the gap this commit closed
// ---------------------------------------------------------------------------

test('the offerings rule reached this prompt, not just the category list', () => {
  // 3417e01 rippled the TAXONOMY here automatically and the RULE not at all: the category
  // appeared in these instructions while nothing said what it was for.
  assert.match(SYSTEM_PROMPT, /OFFERINGS:/)
  assert.match(SYSTEM_PROMPT, /stay as ONE extras item under "During your stay"/)
  assert.match(SYSTEM_PROMPT, /Never reduce an offering to an inventory line/)
  // Note the exact wording: "never a code or utility", matching the importer. The earlier
  // "code or A utility" here was one-day-old drift inside a paragraph documented as copied,
  // and the clause-level test below is what now holds it.
  assert.match(SYSTEM_PROMPT, /"During your stay" is OFFERINGS ONLY, never a code or utility/)
})

test("the host's own voice is protected, not just the routing", () => {
  // Without this half, an offering can land in the right category and still arrive as a
  // noun list — which is the same defect one step further along.
  assert.match(SYSTEM_PROMPT, /keep the host's requests, tips and colour words/)
  assert.match(SYSTEM_PROMPT, /shorten formatting, never meaning/)
})

test('the offerings examples are the shipped ones, not a second invented set', () => {
  for (const example of ['picnic kit', 'sauna', 'bikes', 'welcome treats', 'games']) {
    assert.ok(SYSTEM_PROMPT.includes(example), `missing shipped example: ${example}`)
  }
})

// ---------------------------------------------------------------------------
// the two doors must not drift
// ---------------------------------------------------------------------------

// The paragraph, WHOLE. Sampling four sentences out of it — which this test did first —
// catches a one-sided EDIT to one of the four and nothing else: not a sentence added to one
// prompt only, not one deleted where the excerpt survives, not a reordering. A sentence
// added to one side is the drift that actually happened here (3417e01 added the rule to one
// prompt and not the other), so the sampler was blind to the exact shape of the defect this
// commit exists to close.
const SHARED_OFFERINGS_BLOCK =
  'OFFERINGS: things the host presents as an offering — picnic kit, sauna, bikes, ' +
  'welcome treats, games — stay as ONE extras item under "During your stay". Never reduce an ' +
  "offering to an inventory line. Everywhere in extras, keep the host's requests, tips and " +
  'colour words ("wash the bottles and leave them for the next guest", "tap water is ' +
  'excellent", bike colours): shorten formatting, never meaning.'

test('both prompts carry the SAME offerings paragraph, whole and byte for byte', () => {
  // THE POINT OF THIS TEST: a host pasting the same text into the bulk paste box and into
  // the listing importer must not get two different answers. Comparing the whole block means
  // an addition or a removal inside it fails here, not just an edit to a sampled sentence.
  assert.ok(IMPORTER_PROMPT.includes(SHARED_OFFERINGS_BLOCK), 'the importer prompt no longer matches')
  assert.ok(SYSTEM_PROMPT.includes(SHARED_OFFERINGS_BLOCK), 'the bulk-import prompt no longer matches')
})

test('the clauses unique to this prompt sit AFTER the shared block, not inside it', () => {
  // Anything inserted mid-paragraph would break the comparison above while looking harmless,
  // so the position is pinned rather than left to a convention nobody can see.
  const blockEnd = SYSTEM_PROMPT.indexOf(SHARED_OFFERINGS_BLOCK) + SHARED_OFFERINGS_BLOCK.length
  assert.ok(SYSTEM_PROMPT.indexOf('"During your stay" is OFFERINGS ONLY') > blockEnd)
  assert.ok(SYSTEM_PROMPT.indexOf('CODES:') > blockEnd)
})

test('the offerings-only clause is ADAPTED from the importer, and the delta is exactly one prefix', () => {
  // The importer says 'the public "During your stay" category is OFFERINGS ONLY, never a
  // code or utility' — the prefix names which of TWO same-named things it means, and there
  // is no private twin here. Everything after the prefix must stay identical, or the two
  // doors start teaching the same clause differently. THIS TEST EXISTS BECAUSE THAT ALREADY
  // HAPPENED: the first version of this file wrote "never a code or A utility" and the
  // sampler above could not see it, because the clause was not one of the four it sampled.
  const tail = 'is OFFERINGS ONLY, never a code or utility.'
  assert.ok(IMPORTER_PROMPT.includes(`"During your stay" category ${tail}`))
  assert.ok(SYSTEM_PROMPT.includes(`"During your stay" ${tail}`))
  assert.doesNotMatch(SYSTEM_PROMPT, /never a code or a utility/)
})

test('a codes rule exists here at all, and is general across every category', () => {
  // NOT a copy: the importer's CODES paragraph relocates a stray code into
  // checkin.entry_instructions, a field this endpoint cannot write. The suppression half is
  // kept and the disposition half is replaced with a pointer. It is still a HINT, not a
  // mechanism — but since 23 Aug 2026 the mechanism exists beside it: buildRows runs
  // scrubCredentialSentences over every row before the insert (tested at the bottom of this
  // file). The rule lowers how often a code reaches that scrub; it does not bound anything.
  assert.match(SYSTEM_PROMPT, /CODES: never write an access code, PIN, password or lock combination into ANY category/)
  assert.match(SYSTEM_PROMPT, /say the code is in the guest's check-in info/)
  // The importer's relocation target must NOT appear here: this endpoint writes extras only.
  assert.doesNotMatch(SYSTEM_PROMPT, /belong ONLY in wifi and checkin/)
})

test('the private-block clause is deliberately ABSENT here', () => {
  // The importer writes checkin.entry_instructions, where "During your stay" appears twice
  // with opposite meanings, so it needs the disambiguation. This endpoint never writes that
  // field, so the clause would teach a distinction that does not exist and cost budget.
  assert.match(IMPORTER_PROMPT, /that private block is codes and practicalities only/)
  assert.doesNotMatch(SYSTEM_PROMPT, /private block/)
  assert.doesNotMatch(SYSTEM_PROMPT, /entry_instructions/)
  assert.doesNotMatch(SYSTEM_PROMPT, /Getting in:/)
})

// ---------------------------------------------------------------------------
// ordering: the routing rule has to be read before the catch-all
// ---------------------------------------------------------------------------

test('the offerings rule precedes the "Good to know" fallback', () => {
  // That fallback is exactly what used to catch hospitality content and file it as a
  // utility line, so a catch-all read first is a catch-all that wins.
  const offerings = SYSTEM_PROMPT.indexOf('OFFERINGS:')
  const fallback = SYSTEM_PROMPT.indexOf('anything that does not fit goes under "Good to know"')
  assert.ok(offerings > -1 && fallback > -1)
  assert.ok(offerings < fallback, 'the catch-all must not be read before the routing rule')
})

test('the general "concise" instruction precedes the specific one that qualifies it', () => {
  const concise = SYSTEM_PROMPT.indexOf('Keep content concise and guest-friendly')
  const offerings = SYSTEM_PROMPT.indexOf('OFFERINGS:')
  assert.ok(concise > -1 && concise < offerings, '"concise" must not follow "never meaning"')
})

// ---------------------------------------------------------------------------
// the contract this change must not have touched
// ---------------------------------------------------------------------------

test('the category list is INTERPOLATED from the shared constant, never hand-copied', () => {
  // The prompt-content half: every current category is present, in the shared order.
  assert.ok(SYSTEM_PROMPT.includes(EXTRAS_CATEGORIES.join(', ')))
  // The structural half, which is what actually guarantees a FUTURE category ripples: the
  // source must build that list from the constant. A prompt containing today's categories
  // would satisfy the assertion above even if someone pasted them in as a literal.
  assert.match(SOURCE, /EXTRAS_CATEGORIES\.join\(', '\)/)
  // A third assertion was here — that the source does not contain the joined list as a
  // quoted literal — and it was REMOVED rather than kept for completeness. Every prompt
  // string in this file is split across concatenated chunks, so a realistic hand copy would
  // be split too and would sail straight past it. An assertion that cannot fail on the case
  // it names is worse than no assertion: it reads like cover.
})

test('the output contract requests an items object (json_object mode cannot emit a bare array)', () => {
  // CHANGED by the 31 Aug 2026 freeze-lifted fix: the live default is Groq, whose json_object
  // mode structurally forbids a bare top-level array, so the prompt now asks for
  // {"items":[…]}. The word "JSON" stays present (Groq json mode requires it in the prompt).
  // The MECHANISM is normaliseItems (tested below), not this sentence — a prompt is a hint.
  assert.match(SYSTEM_PROMPT, /Output ONLY a JSON object of the exact shape \{"items":\[\{ "category": string, "content": string \}, \.\.\.\]\}/)
  assert.match(SYSTEM_PROMPT, /Output the raw JSON object only, no other text, no code fences\./)
  assert.match(SYSTEM_PROMPT, /category MUST be exactly one of the listed categories/)
  // The old bare-array wording must be GONE, or json_object mode makes it unsatisfiable again.
  assert.doesNotMatch(SYSTEM_PROMPT, /Output ONLY a JSON array/)
  assert.doesNotMatch(SYSTEM_PROMPT, /Output the raw JSON array only/)
})

test('the WiFi / Check-in / House Rules exclusion is unchanged', () => {
  assert.match(SYSTEM_PROMPT, /Do NOT include WiFi, Check-in, or House Rules content — skip it entirely\./)
})

test('thinking stays disabled on the gemini branch', () => {
  // gemini-2.5-flash has thinking ON by default and it consumes the OUTPUT budget, which
  // returns empty text on JSON generations — a recorded trap in this repo. Nothing in this
  // commit touched it; this pins it so a future prompt edit cannot quietly drop it.
  assert.match(SOURCE, /thinkingConfig: \{ thinkingBudget: 0 \}/)
})

// ---------------------------------------------------------------------------
// THE LIVE ROUND — NOT AN ASSERTION
// ---------------------------------------------------------------------------

/**
 * Paste this into the bulk paste box to exercise the rule for real. It is INVENTED, and
 * deliberately MESSY in the way that has actually caught defects: run-on, unpunctuated, the
 * offering NOT at the start, and interleaved with two utilities that must each end up
 * somewhere else. Note the fixture is UNPUNCTUATED, so "in the same sentence" is trivially
 * true of everything in it — the engineered property is the INTERLEAVING (bins, offering,
 * parking, in that order, with no boundary the model can lean on), not the sentence count.
 *
 * WHAT A PASS LOOKS LIKE:
 *  - the picnic offering is ONE item under 'During your stay', in the host's own phrasing,
 *    with the request about the basket surviving
 *  - the bin day reaches 'Recycling & Bins' and the parking bay reaches 'Parking'
 *  - NO part of the picnic appears under 'Good to know'
 *  - every returned category is an exact member of EXTRAS_CATEGORIES
 *
 * None of that is asserted below. It cannot be: a real generation needs credentials this
 * environment does not have.
 */
export const MESSY_FIXTURE = [
  'the bins go out tuesday morning early ish and theres a picnic basket in the hall cupboard',
  'with a rug and two flasks and proper plates take it to the park at the end of the road its',
  'lovely in the evening just rinse the flasks and put it all back for the next people and the',
  'parking bay is number 14 round the back you need the paper permit off the fridge',
].join(' ')

test('the live fixture is messy in the ways that have caught defects', () => {
  // Pins the FIXTURE's properties, not the model's behaviour — so a future tidy-up of this
  // string is visible rather than silent. A tidy fixture always passes, which is the whole
  // reason this one is shaped like this.
  assert.ok(!/[.!?]/.test(MESSY_FIXTURE), 'the fixture must stay unpunctuated')
  assert.ok(MESSY_FIXTURE.indexOf('picnic') > 40, 'the offering must not start the text')
  assert.ok(MESSY_FIXTURE.includes('bins') && MESSY_FIXTURE.includes('parking'))
  // Invented, and it has to stay that way: this repo is public.
  assert.ok(!/@|\+\d|http/.test(MESSY_FIXTURE), 'no contact details or urls in a fixture')
})

// ---------------------------------------------------------------------------
// the MECHANISM — buildRows runs the scrub (23 Aug 2026)
// ---------------------------------------------------------------------------
//
// Everything above this line tests PROMPT TEXT, which is a hint. These test the belt.
// Unlike the prompt assertions these ARE behavioural: buildRows is pure, so the real
// function runs against real input here — no model, no network, no supabase.
//
// EVERY FIXTURE BELOW IS INVENTED. Never paste real listing text or a real code into this
// repo: it is public, git objects do not expire, and a committed fixture is a permanent
// carve-out from the published 30-day guest-identity retention promise. Shape only.
// Assertion style is deliberately the same as the scrub tests in import-listing.test.mjs,
// so the two doors' tests cannot drift apart either.

const APT = 'aaaaaaaa-0000-0000-0000-000000000001'

// ALL INVENTED — shape only, no entropy from any real feed or listing. Named rather than
// inlined so the pin at the bottom reads the same strings the tests run on, the way
// MESSY_FIXTURE is pinned above; an inline fixture and a source-scanning pin drift apart.
const F = {
  mixed: [
    'The bins go out on Tuesday morning.',
    'The lockbox code is 7742.',
    'Tap water is excellent, no need to buy bottles.',
  ].join('\n'),
  mixedKept: 'The bins go out on Tuesday morning.\nTap water is excellent, no need to buy bottles.',
  codeOnly: 'The gate code is 1125.',
  codeOnly2: 'The keypad combination is 5567.',
  clean: 'Bikes live in the shed.\nThe sauna heats in about 40 minutes.',
  parking: 'There is a free bay behind the building.',
  padded: '  Permit is on the fridge.  ',
  paddedCode: '   The door code is 4432.   ',
}

test('a code sentence is removed and the ordinary lines survive', () => {
  const { rows, redacted } = buildRows(APT, [{ category: 'Good to know', content: F.mixed }])
  assert.equal(redacted, 1)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].content, F.mixedKept)
  // The belt is only meaningful because of where these rows go.
  assert.equal(rows[0].is_private, false)
  assert.equal(rows[0].apartment_id, APT)
  assert.equal(rows[0].category, 'Good to know')
})

test('a row that was ONLY a code sentence is DROPPED, never inserted empty', () => {
  // An empty card is worse than no card — the importer argues the same at its extras loop.
  const { rows, redacted } = buildRows(APT, [{ category: 'Safety', content: F.codeOnly }])
  assert.equal(redacted, 1)
  assert.deepEqual(rows, [])
})

test('a dropped row does not appear in the inserted set while its siblings do', () => {
  // The handler derives its `categories` response from rows, not from `valid`, so this is
  // what stops the response claiming a category it did not save.
  const { rows, redacted } = buildRows(APT, [
    { category: 'Safety', content: F.codeOnly2 },
    { category: 'Parking', content: F.parking },
  ])
  assert.equal(redacted, 1)
  assert.deepEqual(rows.map(r => r.category), ['Parking'])
})

test('clean content is passed through untouched and nothing is counted', () => {
  // The over-scrub direction costs the host real content, so it is asserted, not assumed.
  const { rows, redacted } = buildRows(APT, [{ category: 'During your stay', content: F.clean }])
  assert.equal(redacted, 0)
  assert.equal(rows[0].content, F.clean)
})

test('a row that is whitespace-only after scrubbing is dropped, and survivors are trimmed', () => {
  // NAMED FOR WHAT IT PROVES. An earlier name claimed this pinned scrub-before-trim ordering;
  // it cannot. scrubCredentialSentences returns its input untouched when nothing is redacted
  // and trims its own rejoin when something is, so both orders pass these fixtures. The
  // ordering in buildRows is still the right one to write — it stays correct if the scrub ever
  // stops trimming — but nothing here holds it, and a test whose name overstates its reach is
  // the kind of cover this file argues against elsewhere.
  const { rows } = buildRows(APT, [
    { category: 'Parking', content: F.padded },
    { category: 'Safety', content: F.paddedCode },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].content, 'Permit is on the fridge.')
})

test('an empty input list yields no rows and nothing redacted', () => {
  const { rows, redacted } = buildRows(APT, [])
  assert.deepEqual(rows, [])
  assert.equal(redacted, 0)
})

test('the fixtures are invented, and must stay that way', () => {
  // Same pin as MESSY_FIXTURE above: this repo is public, git objects do not expire, and a
  // committed fixture is a permanent carve-out from the published retention promise.
  for (const [name, value] of Object.entries(F)) {
    // Same expression as the MESSY_FIXTURE pin above — deliberately identical, because the
    // weaker of two guards is the one a future editor trusts. A single @ is an email; \+\d is
    // the start of an international number. Do not 'tighten' either into something narrower.
    assert.ok(!/@|\+\d|http/.test(value), `contact details or url in fixture: ${name}`)
  }
  // The invented codes are short and obviously fake — a value that still looks random beside
  // these is the tell that something real was pasted in. Case-folding is NOT de-identification.
  assert.ok(/7742/.test(F.mixed) && /1125/.test(F.codeOnly))
})

// ---------------------------------------------------------------------------
// the SHAPE LADDER — normaliseItems reads what json_object mode actually returns
// ---------------------------------------------------------------------------
//
// Behavioural, like the buildRows tests: normaliseItems is pure, so the real function runs
// here. It only WIDENS what is readable — the handler's per-item validator is still the sole
// gate on what is writable — so these assert the container is resolved, not that a category is
// accepted. First match wins, so ordering is part of the contract and is pinned.
//
// WHY THIS SECTION EXISTS: Groq's response_format json_object (the live default) forbids a bare
// top-level array, so the model legally returns wrapped/keyed shapes. The single-array unwrap
// this replaced 502'd on a single {category,content} object and on category-keyed maps — the two
// shapes seen in the 31 Aug production logs.

test('a bare array passes through unchanged (the gemini shape)', () => {
  const arr = [{ category: 'Parking', content: 'bay 14' }]
  assert.strictEqual(normaliseItems(arr), arr)
})

test('an {"items":[…]} object is unwrapped (the shape the prompt now requests, branch b)', () => {
  const items = [{ category: 'Parking', content: 'bay 14' }, { category: 'Games', content: 'cards' }]
  assert.deepEqual(normaliseItems({ items }), items)
})

test('a single {category, content} object becomes a one-item array (branch c, today\'s 502 shape)', () => {
  assert.deepEqual(
    normaliseItems({ category: 'Good to know', content: 'Tap water is excellent.' }),
    [{ category: 'Good to know', content: 'Tap water is excellent.' }],
  )
})

test('a category-keyed map with string values is resolved (branch d)', () => {
  assert.deepEqual(
    normaliseItems({ Parking: 'bay 14', 'Good to know': 'Tap water is excellent.' }),
    [
      { category: 'Parking', content: 'bay 14' },
      { category: 'Good to know', content: 'Tap water is excellent.' },
    ],
  )
})

test('a category-keyed map with string-ARRAY values joins on newlines (branch d, the ≥2-array case)', () => {
  // This is exactly the shape the single-array unwrap dropped as ambiguous and then 502'd.
  assert.deepEqual(
    normaliseItems({ 'During your stay': ['picnic kit', 'sauna'], Parking: ['bay 14'] }),
    [
      { category: 'During your stay', content: 'picnic kit\nsauna' },
      { category: 'Parking', content: 'bay 14' },
    ],
  )
})

test('branch b wins over branch d when exactly one array-valued property is present', () => {
  // First match wins: {"items":[…]} plus a scalar sibling resolves via the single-array
  // unwrap, not the keyed map — the pin on the ladder order.
  const items = [{ category: 'Parking', content: 'bay 14' }]
  assert.deepEqual(normaliseItems({ items, note: 'ignored' }), items)
})

test('unresolvable shapes return null (→ the handler 502)', () => {
  assert.strictEqual(normaliseItems(42), null)
  assert.strictEqual(normaliseItems('a string'), null)
  assert.strictEqual(normaliseItems(null), null)
  // an object whose only value is neither a string nor a string-array
  assert.strictEqual(normaliseItems({ meta: { nested: true } }), null)
  // a mixed map where one value disqualifies the whole (a number) — no bare array, no
  // {category,content}, not all string/string-array → null
  assert.strictEqual(normaliseItems({ Parking: 'bay 14', count: 3 }), null)
  // an empty object has no entries to resolve
  assert.strictEqual(normaliseItems({}), null)
})

test('a normalised item still has to pass the handler validator to be written', () => {
  // The ladder surfaced a category name from a keyed map, but a bogus category is dropped by
  // isExtrasCategory downstream — proven here by feeding the normaliser output through the same
  // predicate the handler uses (imported from the shared constant).
  const items = normaliseItems({ 'Not A Real Category': 'x', Parking: 'bay 14' })
  const survivingCategories = items
    .filter(i => EXTRAS_CATEGORIES.includes(i.category) && typeof i.content === 'string' && i.content.trim())
    .map(i => i.category)
  assert.deepEqual(survivingCategories, ['Parking'])
})
