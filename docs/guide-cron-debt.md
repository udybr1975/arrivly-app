# Guide cron — the debt, with enough detail to fix in ONE pass

WHAT THIS IS: the residual detail behind the `cron-refresh-guides` open items, plus two
non-cron residuals that sat in the same block. Moved VERBATIM out of CLAUDE.md's
"RESIDUALS FROM 14 Aug 2026" on 24 Aug 2026 during the restructure. Nothing was edited,
summarised or reordered.

WHAT DID NOT COME HERE: the `.claude/agent-memory/` rule, which was HOISTED into CLAUDE.md's
Agent policy before this block moved — it existed at exactly one site and would otherwise have
left the always-loaded file with it. CLAUDE.md also keeps a one-line statement for every item
below.

---

- **STARVATION IN `cron-refresh-guides` — BOTH GATES FOUND IT INDEPENDENTLY, and it is NOT a
  one-line migration.** `guide_recommendations.generated_at` advances **only on a successful
  upsert**, and `_lib/guide.ts` deliberately skips the upsert on `placeCount === 0`, on
  `no centre`, and on the `described === 0 && matchable > 0` keep-existing guard. So a
  consistently-failing apartment never advances its ordering key, is always stale, **sorts first
  every run** and pins one of ~2 daily slots forever. `refreshed++` also counts the keep-existing
  path, which wrote nothing — so the response reports a refresh that did not happen. The events
  cron solved the identical defect with `last_attempted_at`. **WHY THE OBVIOUS FIX IS WRONG HERE:**
  a never-generated apartment has **NO `guide_recommendations` row to stamp**, and a stub row
  would be read by the guest page's `.maybeSingle()` — so the column probably belongs on
  `apartments`, not on `guide_recommendations`. **Deferred deliberately: no apartment is currently
  failing.** Decide the column's home before writing the migration.
- **STILL OPEN from the guide-cron bounding (`ec66829`): skip EXPIRED HOSTS, and LOG
  OUTCOMES.** Neither shipped with the deadline/freshness/oldest-first work, and the second
  is the same gap as the missing failure alarm below — a run that does nothing is currently
  indistinguishable from a run that did everything.
- **The guide cron bypasses `generate-guide.ts`'s 6h atomic claim and its `bump_api_counter`**, so
  cron guide spend is invisible to `cron-spend-audit` and a cron run can race a host's manual
  regenerate on the same apartment. Pre-existing and documented at `generate-guide.ts:114` — but
  the monthly→daily move multiplies its weight **~30x**.
- **`cron-refresh-guides` has NO failure alarm and NO `console.*` at all** — an all-failed run, or
  one whose pre-loop queries eat the budget so `processed === 0`, is completely silent.
  `cron-refresh-events` has the ntfy shape to copy, including its argued
  `attempted = units - deferred` denominator so a deadline-bounded run cannot claim wholesale
  failure. This is also the one detector that would reveal the "never ran" condition this file
  records as undetectable.
- **Guide-cron capacity implied by the two constants: ~2 apartments/run x 25 days ≈ 50 apartments**
  before the freshness gate can never be satisfied and the fleet enters permanent backlog.
  Comfortable at 3 visible (23 Aug 2026), and it was comfortable at 9 — **but note the headroom
  came from UNPUBLISHING, not from any change to the cron: republishing the nine test apartments
  restores the old load in one step.** **Re-derive BOTH constants beyond ~50**, not one of them.
- **The commission disclosure in `ExperiencesSheet.tsx` is unconditional BY DESIGN, and nothing in
  the code says so.** Every neighbouring earnings surface IS tier-qualified (`EarningsPanel`,
  `Landing`), so the pattern a future editor pattern-matches against is the conditional one —
  and making this one conditional would reintroduce the exact defect `736a715` fixed. A one-line
  comment above it would make a regression visible in a diff.
- **The `code-reviewer` subagent wrote `.claude/agent-memory/` files on its own initiative
  (14 Aug 2026), and they are NOT adopted.** They are gitignored, so they are invisible to
  everyone but the machine that wrote them, which is precisely why they must not become a second
  source of truth. **Project memory lives in CLAUDE.md + docs/history.md, nowhere else.** Do not
  read from, cite, or maintain those files.

