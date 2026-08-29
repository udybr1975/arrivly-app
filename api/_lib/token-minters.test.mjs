// PINS THE TOKEN MINTERS TO ONE CSPRNG DRAW (PG-28). Run with:
//   npm run test:token-minters
//
// WHY THIS TEST EXISTS. `d67d214` (PG-21) moved every guest-token minter off
// `Math.random()` and onto `node:crypto`'s `randomInt`. Afterwards the three minters agreed
// BY CONVENTION ONLY: each file carries a comment saying a fourth minter must not repeat the
// drift, and NOTHING ENFORCED IT. That is the comment-standing-in-for-a-mechanism shape this
// project records elsewhere as the thing that gets deprioritised — and the drift had already
// happened once. This file is the mechanism.
//
// IT IS A SOURCE-SHAPE ASSERTION, NOT A RUNTIME ONE, AND THAT IS DELIBERATE. A runtime test
// can only observe output, and the output of a weak PRNG is indistinguishable from a strong
// one in any feasible unit test — you cannot tell `Math.random()` from `randomInt()` by
// looking at six characters. The defect was SOURCE DRIFT (a new minter written the old way),
// so the source is the right level to assert at. A runtime formulation would also require
// EXPORTING three module-private functions purely to test them, widening the surface of the
// thing being protected.
//
// TWO LAYERS, BECAUSE THE LIST CANNOT POLICE ITSELF.
//   1. THE LISTED MINTERS are checked individually and re-resolved by name, so a RENAME, a
//      MOVE or a REMOVAL fails loudly instead of silently reducing coverage to two.
//   2. THE TREE SCAN is what catches A MINTER NOBODY LISTED. This is the half that earns the
//      word "mechanism": `MINTERS.length === 3` compares a constant to a constant in this
//      file and can never see a fourth minter in a file it was never told about. The scan
//      reads every api/**/*.ts and flags any line using Math.random that is not itself a
//      comment line — so a fourth token minter written the old way fails even though this
//      file has never heard of it.
//
// THE EXCUSE RULE IS LINE-ORIENTED ON PURPOSE, AND ITS FAILURE DIRECTION IS ONE-WAY.
// An earlier draft stripped comments with a small string/comment state machine. It was
// rejected at the gate for a reason worth keeping written down: with no regex-literal state,
// a regex containing a quote (`api/_lib/welcome-claim.ts:50`, `api/_lib/prompt-scalar.ts:92`)
// flips literal parity for the REST OF THE FILE, after which a `//` inside a genuine string
// — and api/ is full of URLs — opens comment state over REAL CODE and deletes it. That
// direction HIDES an executable Math.random, which is the one outcome a security mechanism
// must not have.
// The rule below excuses only a line that literally BEGINS with a comment marker, so it
// cannot be blinded for the REST OF A FILE the way the state machine could — its failure is
// per-line and bounded. It is a heuristic, not a parser, and it is NOT one-way in the strict
// sense: three line shapes begin with a marker and still execute — an operator continuation
// starting with `*`, a `/* ... */` prefix followed by code, and a `${...}` substitution on a
// template-literal line starting with `//`. None exists in api/ today. If one is ever
// written, the thing to fix is THIS REGEX, never an allowlist entry.
// MEASURED at the time of writing: Math.random appears in api/ at exactly TEN occurrences,
// ALL of them on `//` comment lines in create-booking.ts and demo-create.ts explaining why it
// was wrong. Zero executable uses, so the allowlist is EMPTY and must stay that way.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const API = join(HERE, '..')

// The guest-facing token minters, by file and function name. A fourth entry here is a
// deliberate act — which is exactly the friction PG-28 asks for.
const MINTERS = [
  { file: '_lib/ical.ts', fn: 'generateRef' },
  { file: 'create-booking.ts', fn: 'randomRef' },
  { file: 'demo-create.ts', fn: 'randomRef' },
]

// Extract one function's BODY from source text, brace-balanced from its declaration.
//
// SCOPING TO THE BODY IS NOT A DETAIL — IT IS WHY THIS TEST IS NOT A FALSE ALARM.
// `create-booking.ts` and `demo-create.ts` both carry a long comment block explaining, at
// length, why `Math.random()` was wrong. A whole-file search for `Math.random` therefore
// matches the EXPLANATION and would fail on correct code. Read the body only.
//
// The scanner is brace-counting, not a parser, and its failure direction is safe: a brace
// before the body (an object return type) yields an extract with no `randomInt(` and fails
// LOUDLY; a stray unbalanced brace inside a body truncates or over-runs and also fails. No
// silent mis-extract is reachable from any realistic shape of a six-character token minter.
function functionBody(source, fnName) {
  const decl = source.indexOf(`function ${fnName}(`)
  assert.notEqual(
    decl,
    -1,
    `function ${fnName} not found in this file. If a minter was RENAMED or MOVED, update ` +
      `MINTERS above. If it was converted to an arrow function or a const, this brace-scanner ` +
      `no longer matches it — either keep the "function NAME(" form or teach this helper the ` +
      `new shape. Do NOT delete the entry to make the test pass.`,
  )
  const open = source.indexOf('{', decl)
  assert.notEqual(open, -1, `no body for ${fnName}`)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  throw new Error(`unbalanced braces in ${fnName}`)
}

for (const { file, fn } of MINTERS) {
  test(`${file} :: ${fn} draws from node:crypto, never Math.random`, () => {
    const source = readFileSync(join(API, file), 'utf8')

    // The import has to be the real one. A local shadow named `randomInt` would satisfy the
    // body check while drawing from anywhere, so pin the module too. Both quote styles are
    // accepted so a formatter change cannot red-line all three tests on correct code.
    assert.match(
      source,
      /import\s*\{[^}]*\brandomInt\b[^}]*\}\s*from\s*['"]node:crypto['"]/,
      `${file} must import randomInt from node:crypto`,
    )

    const body = functionBody(source, fn)
    assert.match(body, /\brandomInt\s*\(/, `${fn} must draw with randomInt()`)
    assert.doesNotMatch(body, /\bMath\.random\b/, `${fn} must not use Math.random`)
  })
}

test('the MINTERS list is pinned and every entry still resolves', () => {
  // THIS PINS THE LIST, NOT THE REPO. It catches a renamed, moved or removed minter (via the
  // re-resolution loop below), and it makes adding a fourth entry a deliberate act. It CANNOT
  // see a fourth minter in a file it was never told about — that is the tree scan's job, in
  // the test below. If this fails, do not delete the assertion: decide whether the new minter
  // belongs in MINTERS and whether it draws from randomInt.
  assert.equal(MINTERS.length, 3)

  for (const { file, fn } of MINTERS) {
    const source = readFileSync(join(API, file), 'utf8')
    assert.ok(source.includes(`function ${fn}(`), `${file} no longer declares ${fn}`)
  }
})

// A line that BEGINS with a comment marker is excused; anything else counts. Deliberately
// not a parser — see the header for why a cleverer scanner was rejected.
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/

function allApiTsFiles(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...allApiTsFiles(full))
    else if (entry.name.endsWith('.ts')) found.push(full)
  }
  return found
}

test('NO executable Math.random anywhere under api/ — catches a minter nobody listed', () => {
  // THE HALF THAT MAKES THIS A MECHANISM RATHER THAN A LIST. The per-minter checks above only
  // see the three files they were told about; this one sees the tree. A fourth token minter
  // written the old way fails here even though MINTERS has never heard of it, and so does any
  // other weak-randomness use on a server path.
  //
  // THE ALLOWLIST IS EMPTY AND MUST STAY THAT WAY. If this ever fails, the answer is to use
  // node:crypto — not to add an exception. There is no legitimate Math.random on a path that
  // mints or protects a credential, and a "just this once" entry here is how the convention
  // this test replaced decayed in the first place.
  const offenders = []
  for (const file of allApiTsFiles(API)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((line, i) => {
      if (/\bMath\.random\b/.test(line) && !COMMENT_LINE.test(line)) {
        offenders.push(`${file.slice(API.length + 1)}:${i + 1}`)
      }
    })
  }
  assert.deepEqual(offenders, [], `Math.random on an executable line: ${offenders.join(', ')}`)
})
