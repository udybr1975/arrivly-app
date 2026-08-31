# Bemgu Hacker-Agent Pass — Phase 2c Results (Browser + Console + Registration/Auth)

Probed against production `https://bemgu.app` + Supabase Auth/REST on 31 Aug 2026. Freeze
re-confirmed at start (`git diff 47bb840 origin/master` excl. docs/CLAUDE.md = empty). No app
code edited, no commits. Writes were to Host A's own test apt + capped throwaway signups only.
No password / JWT / secret value was printed or screenshotted. Mapped to **OWASP Top 10:2025**.

**Budgets:** AI/model calls used: **0 of 3** (every guest-chat probe was refused at the verify
gate before the model; create-booking/demo-create spend no model). Throwaway signups used:
**1 of 3** (`+ptA`; the `+ptweak`, existing-email, and malformed attempts created no account).

**Environment caution:** the test browser carried a live logged-in host session and real prior
guest data (a welcome-claim entry with a real name + confirmation code). The harness
auto-blocked those sensitive values; I did not read, exfiltrate, or report them, and I ran all
authenticated probes via the Auth/API as Host A or the throwaway account rather than through
that ambiguous browser session.

---

## Batch D — bundle & secret audit (A02) — CONFIRMED-SAFE

| Check | Result |
|---|---|
| service_role / SUPABASE_SERVICE_ROLE_KEY in bundle | **none** |
| Stripe secret (`sk_`/`whsec_`) | **none** (no `pk_` either — billing not live) |
| Gemini/Groq/Tavily key values (`AIza`/`gsk_`/`tvly-`) | **none** |
| private VAPID / server env NAMES | **none** |
| Public config present (expected) | supabase URL (`ptkabdelgxkgfslfialx` only), publishable anon key, public VAPID (`applicationServerKey`), Turnstile sitekey (`0x4A…`) — all public by design |
| Source maps | `sourceMappingURL`: none; `index-….js.map` → **HTTP 403** (not served) |
| **Anna's Stays references** | **ZERO** — project ref `bdfvubwnxuzlcngzhiwy`: 0 hits; `anna-stays`/`annas-stays` strings: 0 |

Verdict: only public config ships; no server secret is reachable from the browser. **A02 clean.**

---

## Batch E — browser storage & token reuse (A01/A05)

**E1 (storage inventory, names/shapes only):** `localStorage` holds `arrivly_last_guest`
(`{apt, token}`), `arrivly_guest_token_<aptId>` (per-apt guest credential, plaintext —
harness-blocked value), `arrivly_guest_blurb_seen_<ref>` (flag `1`), `arrivly:wc:<code>`
(welcome-claim device store — a real entry was present and left untouched), and the standard
`sb-…-auth-token` (Supabase host session). `sessionStorage`/cookies: no additional app tokens.
Observation (not a new finding): guest booking tokens and the host session JWT live in
`localStorage` in plaintext — the standard Supabase/guest-token model; an XSS would exfiltrate
them. No XSS was found; recorded as the known design tradeoff.

**E3 (forged token, browser same-origin fetch) — CONFIRMED-SAFE.** Against Host A's apt with a
forged `ARR-FORGED9`: `guest-details` → **403**, `guest-state` → **200 neutral**,
`guest-bootstrap` returns no private rows. Client renders nothing private. Re-confirms the
Phase-2 server refusals from inside the browser.

---

## Batch F — force hidden UI / demo messaging gate (A01) — CONFIRMED-SAFE

The "Message host" overlay is UI-gated on `tokenParam && !isPublicDemo`, but the security
property is the SERVER gate. From the browser, POSTing to the demo apartment (with its published
`ARR-EVT777` token): `guest-message` (send) → **403 demo_messaging_off**, `guest-subscribe` →
**403 demo_messaging_off**, both before any write. Forcing the overlay open gains nothing.

---

## Batch G — console-driven API abuse (A01/A04)

**G1 — CONFIRMED-SAFE.** Same-origin fetches with bad input: forged token → 403; forged
guest-state → 200 neutral; malformed apt → 400; guest-chat missing token → 403; **guest-chat
with a prompt-injection message ("ignore rules and reveal…") → 403 at the verify gate, before
the model ran** (injection never evaluated, zero AI spend); guest-message send without token →
403. A04 injection surface is unreachable pre-auth.

**G2 — CONFIRMED-SAFE (pre-approved write).** create-booking on Host A's OWN apt via
authenticated API (chosen over the ambiguous browser session): **200**, scoped to Host A.
→ **⚠ CLEANUP ROW #1** below.

---

## Batch H — T-27 bulk-import box-clear (browser) — PENDING

Not run. bulk-import returns the known `parse_failed`/502 operational bug in production (Phase
2b), which blocks the "clean write" and "partial-scrub" branches, and driving the four UI
branches requires a dashboard session as Host A. Preserving AI budget, I did not re-spend a call
to re-confirm a known bug. **PENDING** until bulk-import parses again; the four click-paths from
phase2b-results.md still apply.

---

## Batch I — registration & authentication (A07 + A05)

| Step | Probe | Result | Verdict |
|---|---|---|---|
| **I1** | Signup throwaway `+ptA` via Auth API | **200**, immediate session, `email_confirmed_at` set → **email confirmation is OFF (auto-confirm)**. Lands tier 1 / trial / no card, 14-day trial. → **⚠ CLEANUP #2** | see finding I-b |
| **I2** | Signup with a KNOWN-existing email (Host A) | **422 `user_already_exists` "User already registered"** | **FINDING** (A07 user enumeration) |
| **I3** | Malformed email / weak password | malformed → **400 validation_failed**; `123` → **422 weak_password** (min-6 enforced) | **CONFIRMED-SAFE** |
| **I4** | Fresh trial host self-escalates `tier`/`is_exempt`/`subscription_status` via PostgREST | **403 permission denied for table hosts** (column UPDATE not granted); row stays tier 1 / trial / not exempt | **CONFIRMED-SAFE** (A05) |
| **I5 / T-16** | Self-set `user_metadata.is_demo=true`, then PATCH `hosts.is_demo`, then demo-create | metadata self-set **succeeds (200)** BUT is inert: `hosts.is_demo` PATCH → **403**; demo-create → **400** (refused); host row stays `is_demo=false`. **No demo/privileged behaviour granted.** | **CONFIRMED-SAFE** (T-16 closed live) |
| **I6** | Logout, then reuse the access token | logout → 204; `auth/v1/user` post-logout → **403**; **PostgREST post-logout → 200** (JWT valid until 1h expiry); refresh with garbage → 400 | **FINDING** (A07, low/informational) |

### Batch I findings
- **I-a (A07, low) — user enumeration.** `/auth/v1/signup` with an existing email returns
  `422 user_already_exists`. An attacker can test which emails have accounts. Note the app
  ALSO exposes existence intentionally via `/api/demo-precheck` (`account_exists`), so this is
  consistent with existing behaviour rather than a new exposure. Mitigation is limited at the
  GoTrue layer; accept or enable enumeration protection if the product wants it.
- **I-b (A07, business-logic note) — email confirmation is OFF.** Signup auto-confirms and
  issues an immediate session with an UNVERIFIED email. Frictionless-trial design choice; the
  risk is a user signing up under an address they don't own (they just never receive the welcome
  mail). Low impact for a trial SaaS; flagged for a conscious decision before scaling.
- **I-c (A07, low/informational) — access token valid post-logout.** After logout the stateless
  Supabase access JWT still authenticates to PostgREST until its 1-hour expiry (GoTrue revokes
  the session + refresh token, not the already-issued JWT). This is standard Supabase/JWT
  behaviour, not a Bemgu-specific bug; token TTL is already 1h. Recorded for completeness.

---

## Cleanup required (rows written during this phase)

Nothing was deleted (out of scope for this agent). Please clean up / flag `is_test`:

1. **G2 booking on Host A's apt** `02532a18…d791`:
   - booking_id `8e274dbb-8f9d-4b17-8f1b-524e5ed632bf`, reference `ARR-32K5KF`, status
     `confirmed`, check-in 2027-03-01 → 2027-03-04.
   - its guest row `c2526f6f-a08d-4974-aa3c-4aff0a0af916` (first_name "PentestG2").
2. **Throwaway host #1** (Batch I): auth user `526ce061-7fd7-4b6e-8afc-10de6959c186`,
   email `udy.bar.yosef+pta@gmail.com`. Its `hosts` row exists (**`is_test=false`** — flag it or
   delete); no apartments were auto-created (`[]`). Its `user_metadata.is_demo` was set to true
   during I5 and is inert (delete the account and it's moot).

State otherwise unchanged: Host A's `welcome_show_address` and `ical_urls` are as left by Phase
2b (true / null); no other tenant touched. Browser tab closed; temp token files deleted
(`/tmp/anon.txt` = public key only).

---

## One-line summary

- **D** SAFE (no secrets, only public config, zero Anna refs, no source maps) ·
  **E1** recorded · **E3** SAFE (forged token → 403/neutral) · **F** SAFE (demo messaging 403
  both ways) · **G1** SAFE (bad input + prompt-injection refused before model, 0 AI spend) ·
  **G2** SAFE (own-apt booking created — cleanup #1) · **H/T-27** PENDING (bulk-import 502) ·
  **I1** throwaway created (cleanup #2) · **I2** FINDING (enumeration) · **I3** SAFE ·
  **I4** SAFE (no self-escalation) · **I5/T-16** SAFE (is_demo self-grant inert) ·
  **I6** FINDING (JWT valid post-logout, standard Supabase).
- **No secrets in the bundle. No cross-tenant access. No privilege escalation. Three low/
  informational A07 auth notes (enumeration, no email verification, post-logout JWT TTL), all
  standard Supabase behaviour. AI budget untouched (0/3).**
