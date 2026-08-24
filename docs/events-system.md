# Events / city-events system — the argument behind the open items

WHAT THIS IS: the reasoning, measurements and accepted trade-offs behind the events and
city-events open items. Moved VERBATIM out of CLAUDE.md on 24 Aug 2026 during the restructure —
nothing here was edited, summarised or reordered within a block.

WHAT STAYED IN CLAUDE.md: every one-line statement, and every RULE these paragraphs contain —
specifically that the `fresh_city` copy must never read as a refusal, that the card decision is
re-derived at >= 10 paying hosts, and that PILOT STEP 2's rule (b) now binds on TPM as well as
on the day pool. **No rule was moved here.** If you are about to change events behaviour, read
CLAUDE.md's one-liners first; this file tells you WHY each is shaped that way.

---

## Block 1 — events recall is corpus-limited, not window-limited

- **EVENTS RECALL IS CORPUS-LIMITED, NOT WINDOW-LIMITED — the untouched lever is SEARCH.** Measured
  10 Aug: the first 30-day run returned **TWO** events where `874c26d` predicted 5-8, and candidate
  counts across runs were **8, 10, 7 — FLAT regardless of window width**. The binding constraint is
  the **Tavily corpus** (4 searches, 14 snippets, ~13k chars), so every past round that tuned the
  extraction prompt was working downstream of the real limit. **The lever is query design, results
  per search, and number of searches** — none of which has been touched. **Read `874c26d`'s message
  with this correction beside it**: its stated premise (the 7-day window was throttling recall) is
  FALSIFIED, though the widening was still right for the different reason it also gives.
  **Sequence it AFTER Commit B** — the staleness gate cuts run frequency, which is what buys the
  Tavily headroom any recall work would spend.

## Block 2 — city compression, and the lean-context constraint

- **OPEN — CITY COMPRESSION: THE MEASUREMENT IS SUPERSEDED BY UNPUBLISHING, NOT RE-DERIVED.** The
  Aug 8 figure — 9 visible apartments across 8 cities, Helsinki the only city with more than one,
  giving **8 units for 9 apartments ≈ 1.1x compression** — rested on a fleet that no longer
  exists at the visible surface. **Since 23 Aug 2026 the visible fleet is THREE apartments, ALL
  Helsinki** (the nine test apartments are `is_visible = false`, republishable per-experiment).
  A compression number computed on three same-city rows would be arithmetic, not evidence, so it
  is **deliberately NOT re-derived here.** **The caveat was always the point and now applies
  doubly: this is a TEST fleet whose geography was CHOSEN, and it is now a chosen SUBSET of that.
  Re-derive at >= 10 paying hosts** — that is when the card decision should be taken, not at the
  50-host milestone.
- **OPEN — THE LEAN-CONTEXT RULE IS NOW A MEASURED CONSTRAINT, not a design preference.** The
  Aug 8 measured **`corpusChars` 15,102**; the Aug 9 run BILLED **7,079 tok** (prompt 5,031 +
  maxTokens 2,048 RESERVED) — which was HALF of the then-12K TPM ceiling. **THAT HEADROOM IS GONE:
  the ceiling is 8,000 TPM (VERIFIED 17-18 Aug 2026), so the same run would have been 88% of it.**
  The events corpus is now bounded by a derived token budget rather than a snippet count
  (`CORPUS_TOKEN_BUDGET`, `8fbb`-era commit `8619c5f`), which is what brought it back inside.
  PILOT STEP 2's rule (b) — the router's ungrounded leg must not embed the guide — still binds,
  and now binds on TPM as well as on the day pool.

## Block 3 — the city-events cache: legacy row, fallback, writers, freshness, edges

- **OPEN (new, 12 Aug 2026) — `city_events_cache` holds ONE row, last generated 7 Aug,** while
  `city_events_by_city` refreshes daily (2 rows, 11 and 12 Aug). Either a dead legacy row or a
  per-apartment path nothing feeds any more. **One look, not a build** — decide whether to delete
  the row or the fallback path.
- **OPEN (residual) — the per-apartment events-cache fallback has no `last_attempted_at`,** so a consistently-failing apartment can pin the head of the LRU queue. The city-keyed path was fixed by `73587d3`; this shrinks as apartments gain canonical keys.
- **OPEN — `demo-create.ts` is a FOURTH writer bypassing the `eventsCacheRef` helper.** Safe today
  ONLY because a demo apartment has no canonical key, and it **breaks QUIETLY** if that changes —
  the seeded row stops being the one the guest page reads. **`backfill-canonical-city.ts` selects
  on `is_visible` without excluding demos, so it could grant one.** Commented at the call site.
- **OPEN — the shared 20h freshness gate is cross-tenant.** One host's write suppresses another
  host's manual refresh for up to 20h. **Accepted** (correct and cheaper), but the `fresh_city`
  copy must NEVER read as a refusal — same class as the B3.2 toast.
- **OPEN — an empty first-fill from the PUBLIC lazy-fill is now visible CITY-WIDE** until
  something non-empty replaces it. This is the B3.1 asymmetry (that path is deliberately exempt
  from the empty-extraction guard, because its write is reachable only on a MISS so it can create
  an empty row but never destroy a good one) — **widened by sharing.** Self-heals via the cron or
  a host refresh, both of which overwrite an empty row with a non-empty extraction.
- **OPEN — REMAINING EDGE, unchanged and accepted:** a host can move their REAL coordinates into
  another city and be resolved there by the server. Key and content then AGREE, so the row gets a
  **CORRECT** generation for the city claimed — **spend at someone else's credit, not content
  poisoning.**
