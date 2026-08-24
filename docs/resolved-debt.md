# Resolved debt — closed items, kept as evidence

WHAT THIS IS: debt and open items from CLAUDE.md that have since been closed, each with what
closed it. Kept rather than deleted, because a resolved item is evidence — it records that a
question was asked and answered, which is what stops it being re-opened from scratch.

WHAT THIS IS NOT: live work. Anything still open, or that could not be CONFIRMED resolved,
stayed in CLAUDE.md. Verified at source on 22 Aug 2026 during the restructure; the verification
method is named on each entry.

---

## - **`cron-refresh-events` schedule vs Gemini quota-day — CLOSED (`dbfc034`, Jul 28 2026).** Both Gemini crons reschedule

**HOW IT WAS VERIFIED:** Marked CLOSED in the text with its commit SHA (`dbfc034`); the schedules were re-read in `vercel.json` at restructure time.

- **`cron-refresh-events` schedule vs Gemini quota-day — CLOSED (`dbfc034`, Jul 28 2026).** Both Gemini crons rescheduled off the tail of the free-tier quota day: `cron-refresh-events` `0 4 * * *` → **`0 9 * * *`**; `cron-refresh-guides` `0 3 1 * *` → **`0 10 1 * *`** (verified via source that it calls Gemini through `generateGuideForApartment` → `api/_lib/guide.ts`). Key isolation confirmed at the same time: events reads `GEMINI_API_KEY_EVENTS || GEMINI_API_KEY`, guides reads `GEMINI_API_KEY_GUIDES || GEMINI_API_KEY` — each a separate AI Studio project with its own daily quota, so neither reschedule is neutralised by key-sharing. **HONEST FRAMING:** the Jun 25 incident was already mitigated a month earlier by the dedicated events key (`acd16f4`); this reschedule is defence-in-depth for events, and the FIRST timing protection for guides. code-reviewer PASS (0 must-fix); vercel.json only, 2 changed lines, both schedule strings. Original entry follows for history: The events cron runs `0 4 * * *` (04:00 UTC ≈ 21:00 Pacific) — the TAIL of Gemini's free-tier quota-day (free-tier daily limits reset ~midnight Pacific ≈ 07:00–08:00 UTC). On 2026-06-25 this run 429'd every candidate apartment and fired the ntfy "all event refreshes failed" alert because city-events was still on the SHARED `GEMINI_API_KEY`, whose daily quota was exhausted. Mitigated by the dedicated `GEMINI_API_KEY_EVENTS` (`acd16f4`) giving the events surface its own daily quota. **Not yet done (Udy deferred):** reschedule `cron-refresh-events` from `0 4 * * *` → `0 9 * * *` in `vercel.json` so the run lands just AFTER the Pacific reset — the dedicated key lowers recurrence risk, the reschedule mostly removes it. NOTE: the cron itself behaved correctly that day (returned 200, left cache rows intact / stale-safe; the alert only fires when `refreshed === 0`). VERIFICATION PENDING: the next 04:00 UTC run is the passive test — no ntfy alert = the dedicated key worked.

## - **npm vulnerabilities — SUPERSEDED COUNT, kept only as history: 8 (2 moderate, 6 high). The CURRENT figure is GitHub's

**HOW IT WAS VERIFIED:** Superseded by the queue's current figure; the item itself declares the count historical.

- **npm vulnerabilities — SUPERSEDED COUNT, kept only as history: 8 (2 moderate, 6 high). The CURRENT figure is GitHub's 16 (8 high, 8 moderate), 18 Aug 2026 — see the queue.** `npm audit fix` NOT run, because it touches the lockfile and every commit it could have ridden on was scoped elsewhere. **Triage before the pentest gate.** (Supersedes the earlier 7-total measurement; the counting difference between `npm audit` and GitHub's alert list is already recorded under DEPENDENCY VULNS.)

## - **~~SANDBOX SUBSCRIPTIONS MAIL REAL PEOPLE~~ — CLOSED 18 Aug 2026. THE DATES WERE RIGHT AND THE

**HOW IT WAS VERIFIED:** Explicitly CLOSED in the text on 18 Aug 2026 after Udy confirmed no address belongs to a real person.

- **~~SANDBOX SUBSCRIPTIONS MAIL REAL PEOPLE~~ — CLOSED 18 Aug 2026. THE DATES WERE RIGHT AND THE
  EXPOSURE NEVER EXISTED.** Udy confirmed **none of the five addresses belongs to a real person**,
  so nothing here can reach anyone. The item is closed on that ground, not on the dates.
  **THE DATES ARE KEPT AS MEASURED FACT** (live `hosts`, 18 Aug 2026, `cancel_at_period_end` FALSE
  on all five) because they are the only accurate record and the earlier "6-9 Sept" was both wrong
  and eleven days late on the first pair:
  | `current_period_end` | Host |
  |---|---|
  | **24 Aug 2026** | udy.bar.yosef@sterlights.com AND anna.humalainen@gmail.com |
  | 5 Sept 2026 | yiftach@xn--gnai-8qa.com |
  | 7 Sept 2026 | udy@1234.com |
  | 9 Sept 2026 | udy.baryosef@jchelsinki.fi |
  **WHY THIS WAS CARRIED FOR WEEKS AS THE FILE'S ONLY REAL DEADLINE — AN ADDRESS IS NOT EVIDENCE OF
  A HUMAN.** `anna.humalainen@gmail.com` READS like a person, so it was treated as one and nobody
  asked. The whole entry rested on that inference. **Before recording an exposure that turns on who
  is on the other end, ask who is on the other end.**
  Still true and still unverified, but now academic: whether the trigger would be the RENEWAL or
  the Stripe sandbox 90-day auto-cancel was never established against Stripe. It stops mattering
  when no recipient is real — and it would need re-answering only if a real address is ever
  introduced as a fixture.

## - `BookingManager.tsx` `arrivly:messages-read` handler calls `loadBookings()` without a cancellation signal — tiny stale

**HOW IT WAS VERIFIED:** RESOLVED — VERIFIED AT SOURCE 22 Aug 2026. `src/components/host/BookingManager.tsx` now declares `const handleRead = () => loadBookings(signal)` and sets `signal.cancelled = true` in the effect cleanup, so the stale-overwrite race on rapid apartment switching is closed.

- `BookingManager.tsx` `arrivly:messages-read` handler calls `loadBookings()` without a cancellation signal — tiny stale-overwrite race on rapid apartment switching; fold into next BookingManager change.

## - **`PropertySetup.tsx`'s load effect has no cancellation guard** — same class as the recorded

**HOW IT WAS VERIFIED:** RESOLVED — VERIFIED AT SOURCE 22 Aug 2026. `src/components/host/PropertySetup.tsx` declares `let cancelled = false` in the load effect and guards every await-return with `if (cancelled) return`.

- **`PropertySetup.tsx`'s load effect has no cancellation guard** — same class as the recorded
  `BookingManager.tsx` `arrivly:messages-read` note: a tiny stale-overwrite race on rapid
  apartment switching. Fold into the next change to that file.

## - **`bulk-import` HAS NO CREDENTIAL SCRUB** — CLOSED (`20609c1`, 23 Aug 2026)

**HOW IT WAS VERIFIED:** RESOLVED — VERIFIED AT SOURCE AND LIVE 23 Aug 2026. `api/bulk-import.ts` now carries one real import (`./_lib/import-listing.js`) and one real call inside the exported pure `buildRows`, which scrubs each row's content, DROPS any row that collapses to empty, and derives the response `categories` from the rows actually inserted. Confirmed live with a paste containing a FABRICATED code sentence: the row reached the DB scrubbed. The queue entry's measurement ("matches twice and both matches are COMMENTS — zero real calls") was true when written on 22 Aug and is false as of this commit.

- **The gap:** the endpoint wrote `is_private: false` on EVERY row — anon-readable on the guest page — with only prompt sentences defending it, while `api/_lib/import-listing.ts` called the scrub three times. `993fa3d` exists because a door code leaked into public extras on a live run, and the belt written in response was wired into ONE door. A PROMPT SENTENCE IS A HINT, NOT A MECHANISM.
- **Deliberately NOT changed, and argued in-code at the delete site:** the wholesale delete of all eight extras categories stays. security-auditor raised narrowing it to the surviving categories as a must-fix and WITHDREW it on re-derivation — narrowing would leave standing a row that may hold a PREVIOUS run's leaked code, and a re-paste is the host's only self-service remediation on this path.
- **Residual, still open:** the host is never told content was removed. `redacted` reaches the operator log only; `PropertySetup.tsx` renders nothing for an empty `categories` list AND clears the paste box, so an all-scrubbed run is indistinguishable from success. Closing it needs a response field plus one component line. Now in the pentest-gate list.

## - **ALL DATABASE CONTENT IS TEST DATA — decide whether to wipe or flag before the Stripe flip** — CLOSED (23 Aug 2026)

**HOW IT WAS VERIFIED:** RESOLVED — the decision was taken and BUILT, not merely made. The answer was FLAG, never wipe: `hosts.is_test` + `apartments.is_test` (three migrations plus `e5b87e2`) mark every fixture, trigger-maintained, server-only for WRITE. Crons filter `.eq('is_test', false)`, host-facing email is gated `!is_test`, and admin-overview metrics exclude test hosts. The live DB is launch-clean — 1 real host, 2 real properties — with NOTHING DELETED: the fixtures stay, flagged. The invariant lives in CLAUDE.md's DB TRAPS; this entry records only that the open question is answered.

- **Why "wipe" was the wrong half of the question:** the fixtures are the only regression corpus this project has, and several are load-bearing (the C8 cancelled-conversation fixture, the deliberate Vantaa geocode, the three pre-arrival claim fixtures). Deleting them to clean the launch surface would have destroyed the evidence that past defects stay fixed.
- **Closed with it:** the `subscription_status` DECOUPLED-from-the-access-gate item. Its workaround — `is_exempt = true` on host `1d5a3b9c` — is now the SANCTIONED resting state for a test host (active + exempt, NULL Stripe refs), not a workaround awaiting reconciliation.

## STILL-OPEN residuals from `60a4c2b` (the four UI items) — moved verbatim, 24 Aug 2026

NOTE THE EXCEPTION: this file otherwise holds CLOSED debt. These six are OPEN, and they are
here only because they are residual DETAIL — CLAUDE.md keeps a one-line statement for each
plus a single pointer. Moved VERBATIM during the 24 Aug restructure; nothing edited.

- **RESIDUALS FROM `60a4c2b` (the four UI items) — recorded here so they outlive the commit message:**
  - **`Messages.tsx` still carries its own `isBlockSource` / `sourceColor` / `sourceLabel`** now
    that `bookingChrome.ts` exists, and its `sourceLabel` DIVERGES (no `*_block` variants, so it
    would render `airbnb_block` as "Airbnb"). Unreachable today because Messages filters blocks out
    before building conversations — **one import from fixed, and a latent trap until it is.**
  - **The `ARR-` token now renders VISIBLY on hover** in the availability picker. It previously sat
    only in the accessibility tree, because a disabled button swallows its own `title`. Same trust
    boundary and the same data the list view shows openly; the added risk is shoulder-surfing or
    screen-sharing only.
  - **Neither calendar has `role="grid"` / roving tabindex / arrow-key movement.** Every cell is a
    real button with a visible focus ring and a full `aria-label`, so the accessibility floor is
    met — grid semantics would be an improvement, not a fix.
  - **`fmt()` parses `new Date('YYYY-MM-DD')` as UTC and formats locally** — correct for the
    positive-UTC market, off by one day for a negative-UTC viewer. Pre-existing and shared by three
    surfaces; changing a formatter's parse semantics inside a UI commit is the coupling that
    produces a defect nobody attributes to that diff.
  - **The picker's `nightMap` caps each booking's expansion at 800 nights**, so a genuine
    multi-year block is truncated exactly like a malformed iCal `check_out` and its later nights
    draw free. Degrades to a 409, never to a double booking — the server range-tests
    `check_in`/`check_out` directly and never re-walks days. **There is NO server-side maximum stay
    length, which is what makes the cap reachable at all.**
  - **`void loadBookings()` on the 409 is unsignalled**, so a host who hits it and immediately
    switches apartments could see A's rows land after B's. Same shape as the existing `await` calls
    in the success and cancel paths.
