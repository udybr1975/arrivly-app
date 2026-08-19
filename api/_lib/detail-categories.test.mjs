// Unit tests for the shared apartment_details taxonomy (no test framework — node:test +
// node:assert only). Run with:  npm run test:detail-categories
//
// WHY: the host editor now DELETES rows using the same permissive regex matchers the
// guest page READS with. If two matchers both claimed the same category, one save would
// delete a row another save had just written under a different label. These matchers are
// NOT disjoint in general ('House entry rules' matches both rules and check-in) — they
// are only proven mutually exclusive across the ten categories that actually exist. This
// test is what makes that a checked property rather than an assumption.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EXTRAS_CATEGORIES,
  DETAIL_CATEGORY,
  isRulesCategory,
  isWifiCategory,
  isCheckinCategory,
  isExtrasCategory,
} from '../../src/lib/detailCategories.ts'

const MATCHERS = [
  ['rules', isRulesCategory],
  ['wifi', isWifiCategory],
  ['checkin', isCheckinCategory],
]

const LIVE_CATEGORIES = [
  DETAIL_CATEGORY.WIFI,
  DETAIL_CATEGORY.CHECKIN,
  DETAIL_CATEGORY.RULES,
  ...EXTRAS_CATEGORIES,
]

test('the ten live categories are the three canonical labels plus the seven extras', () => {
  assert.equal(EXTRAS_CATEGORIES.length, 7)
  assert.equal(LIVE_CATEGORIES.length, 10)
  assert.equal(new Set(LIVE_CATEGORIES).size, 10)
})

test('no live category is matched by more than one regex matcher', () => {
  for (const category of LIVE_CATEGORIES) {
    const hits = MATCHERS.filter(([, fn]) => fn(category)).map(([name]) => name)
    assert.ok(
      hits.length <= 1,
      `"${category}" is matched by more than one matcher: ${hits.join(', ')}`,
    )
  }
})

test('each canonical DETAIL_CATEGORY value is matched by its own matcher', () => {
  assert.ok(isWifiCategory(DETAIL_CATEGORY.WIFI))
  assert.ok(isCheckinCategory(DETAIL_CATEGORY.CHECKIN))
  assert.ok(isRulesCategory(DETAIL_CATEGORY.RULES))
})

test('no extras category is matched by any of the three regex matchers', () => {
  for (const category of EXTRAS_CATEGORIES) {
    for (const [name, fn] of MATCHERS) {
      assert.ok(!fn(category), `extras category "${category}" was matched by ${name}`)
    }
  }
})

test('matchers tolerate null/undefined exactly as the guest page did (d.category ?? "")', () => {
  for (const [, fn] of MATCHERS) {
    assert.equal(fn(null), false)
    assert.equal(fn(undefined), false)
    assert.equal(fn(''), false)
  }
})

test('matchers are case-insensitive, which is why the host side had to widen', () => {
  assert.ok(isRulesCategory('house rules'))
  assert.ok(isRulesCategory('HOUSE RULES'))
  assert.ok(isWifiCategory('wifi'))
  assert.ok(isCheckinCategory('Check In'))
})

test('isExtrasCategory stays exact and case-sensitive — it gates AI output', () => {
  for (const category of EXTRAS_CATEGORIES) assert.ok(isExtrasCategory(category))
  assert.equal(isExtrasCategory('parking'), false)
  assert.equal(isExtrasCategory('Parking '), false)
  assert.equal(isExtrasCategory('Hallucinated'), false)
  assert.equal(isExtrasCategory(null), false)
  assert.equal(isExtrasCategory(undefined), false)
})

// The matchers are NOT disjoint in general, and that is exactly why saveRules scopes both
// its load and its delete with `&& !d.is_private`: it re-inserts as is_private:false, which
// anon can read. This pins the collision the guard exists for, so a future editor deleting
// the guard has to delete a failing test too.
test('a rules/check-in colliding label exists — the reason saveRules carries a privacy guard', () => {
  const colliding = 'House entry rules'
  assert.ok(isRulesCategory(colliding))
  assert.ok(isCheckinCategory(colliding))
  assert.ok(
    !LIVE_CATEGORIES.includes(colliding),
    'the colliding label must NOT be a live category — if it becomes one, the non-collision sweep above is what should fail',
  )
})
