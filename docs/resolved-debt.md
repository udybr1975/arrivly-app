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
