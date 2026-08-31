# Bemgu Hacker-Agent Pass — Phase 1 Recon (READ-ONLY)

Frozen surface: `47bb840`. Working tree HEAD `e8675b9` (two docs-only commits above the
freeze). All line numbers below are stable against `47bb840`'s code tree, which is
byte-identical to HEAD for every non-docs file. **No probing, no requests, no DB writes,
no commits were performed. This is a reading only.**

---

## 1. Freeze proof (raw)

```
$ git rev-parse origin/master
e8675b918183df63dd3f31bd3b6290412955e1e5

$ git diff --stat 47bb84055df699bf4e50a61ffbb89b707ab5db91 origin/master \
    -- . ':(exclude)docs/**' ':(exclude)CLAUDE.md'
(empty)

$ git diff --stat 47bb840 origin/master        # all paths
 CLAUDE.md             | 34 ++++++++++++++++++++-
 docs/pentest-queue.md | 82 +++++++++++++++++++++++++++++++++++++++++++++++++++
 2 files changed, 115 insertions(+), 1 deletion(-)

$ git log --oneline 47bb840..origin/master
e8675b9 docs: declare the Tiers 1-3 surface FROZEN at 47bb840 (Udy, in chat)
7237a4e docs: record a418f98 + 47bb840 as the pre-freeze feature commits; ...
```

**VERDICT: FREEZE HOLDS.** Zero non-docs movement above `47bb840`. The two commits above
it touch only `CLAUDE.md` and `docs/pentest-queue.md`.

---

## 2. Surface inventory

67 `api/*.ts` route files + 29 `api/_lib/*.ts`. `vercel.json`: region `fra1`, all
functions `maxDuration:150`, rewrite `/(.*) -> /index.html` (load-bearing: any query
string reaches Vercel's edge access log before our code runs — the reason the pre-arrival
hint rides a fragment+POST). 12 crons registered.

### 2a. Trust-boundary primitives (`api/_lib/`)

| File | Role | Notes for Phase 2 |
|---|---|---|
| `cron.ts` | `isCronAuthorized(req)` = `req.headers.authorization === Bearer ${CRON_SECRET}`; **fail-closed** if `CRON_SECRET` unset. | Plain `===` string compare, not constant-time. Network timing side-channel on a 32+ char secret is not realistically exploitable, but noted. Every cron route calls this first. |
| `guest-access.ts` | `resolveGuestAccess` (token → confirmed/completed booking AND in-dates → `verified`, else `public`); `resolveMessagingAccess` (wider window, no lower date bound, until checkout+1); `authorizePreview` (owner-or-admin); `buildGuestSystemInstruction` (private rows + source doc gated on `tier !== 'public'`). | Single choke point for guest tiering. `is_public_demo` skips the date bound (published token). Source-doc + address + guest-name fenced through `asPromptScalar`; source doc additionally nonce-fenced. |
| `prompt-scalar.ts` | `asPromptScalar` — read-boundary prompt fence (C0/C1/DEL → space, folds `"` → `'`, collapses `\s` incl. U+2028/9, caps len, drops lone surrogate). | **Does NOT strip U+200B / bidi U+202A-E / U+2066-9** (documented PG-32). For the welcome-claim writer, `NAME_RE` is the only control keeping those out of the column. Semantic injection explicitly NOT closed. |
| `turnstile.ts` | `verifyTurnstile` — fail-closed, never logs secret/token. | Hostname-allowlisted widget. |
| `scrub.ts` | `scrubErr` — redacts AIza/gsk_/tvly-/sk_/whsec_/key= before truncate. | Used on logged provider errors. |
| `safe-fetch.ts` | `safeFetchIcal` — **SSRF-hardened**: custom DNS `lookup` validates every resolved address (blocks 10/8, 127/8, 169.254/16 incl. metadata, CGNAT, ULA, link-local v6, IPv4-mapped), pins connect to validated address (no TOCTOU/rebind), https-only, 5 MB cap, 3-redirect cap re-validated per hop, never logs URL. | **CLAUDE.md's "mild SSRF (no private-IP/metadata blocklist)" note is STALE** — this closes it. Callers sync-ical + cron-sync-ical route through here. |

### 2b. Auth classification across all 67 routes

- **CRON-guarded (13):** backfill-canonical-city + all `cron-*`. Each calls
  `isCronAuthorized` first; caller without the secret expected 401/403 (verify per file — T-14).
- **JWT host (34):** all `admin-*`, billing-portal, bulk-import, cancel-booking,
  cancel-subscription, change-plan, city-image, create-booking, create-subscription,
  create-upload-url, delete-upload, demo-claim, demo-convert, demo-create,
  dismiss-billing-notice, generate-guide, generate-host-picks, geocode, guest-preview,
  guide-assistant, host-message, import-airbnb-csv, import-listing, qr-secrets,
  refresh-events, resolve-canonical-city, rewrite-rules, send-push, send-welcome,
  set-tier, sync-ical. Pattern: `auth.getUser(Bearer)` via anon client, then ownership
  check `apt.host_id === userId` before privileged read/write.
- **Admin, server-side proof (5+):** admin-audit/impersonate/overview/plans/update-host
  gate `user.email === 'udy.bar.yosef@gmail.com'` AFTER verifying the JWT server-side.
  Proof is server-side, never client-passed. cancel-subscription/change-plan use
  ADMIN_EMAIL only as an email recipient, not a gate.
- **Stripe-sig (1):** stripe-webhook (`constructEvent`, bodyParser off).
- **Token/guest, unauthenticated (18):** see §3.
- **Inert stubs:** `send-email.ts` (returns `{message:'send-email stub'}`),
  `generate-vapid-keys.ts` (returns a do-not-expose message). No DB, no secrets. Benign.

---

## 3. Guest-reachable data map (unauthenticated set)

18 routes reachable with no JWT. What an anonymous caller can obtain:

| Endpoint | Method | Anon can reach | Private-data gate | Token verified where |
|---|---|---|---|---|
| guest-state | GET | booking STATE + guestName + token echo | flat NEUTRAL for every non-active outcome; token path needs confirmed/completed booking; keyed-date path needs `apartment_qr_secrets.qr_secret` in `?key=` | server-side match on reference_number+apt+status; demo skips date bound |
| guest-bootstrap | GET | apartment public fields incl. **`host_id`**, public details, picks, guide; lat/lng gated | private `apartment_details` NEVER returned; lat/lng only if `welcome_show_address` OR verified token | `resolveGuestAccess` for coord gate |
| guest-details | GET | **PRIVATE apartment_details (door codes, WiFi, check-in)** | 403 unless `resolveGuestAccess`=verified | canonical gate; RL 30/min |
| guest-availability | GET | live/draft/unknown; brand fields on hidden apt only | only brand (name/logo/accent) on hidden | none (public probe) |
| guest-chat | POST | AI reply (verified) or scripted (demo) | 403 verify_required for public tier BEFORE model call | `resolveGuestAccess`; per-instance RL + counter guest-chat 40/h |
| guest-message | POST | list/send messages | 404 hidden, 403 demo, 403 not_verified | `resolveMessagingAccess`; apt authoritative from DB |
| guest-subscribe | POST | register push sub (writes push_subscriptions) | 403 demo, 403 not_verified; host_id/apt/booking server-derived | `resolveMessagingAccess` |
| guest-preview | GET | full private preview incl. host whatsapp | owner-or-admin only | JWT (this one IS authed) |
| welcome | GET | public welcome page by 8-char code | private rows never returned; address gated on `welcome_show_address` | code lookup; RL 30/min |
| welcome-claim | POST | pre-arrival token reveal by (code, confirmation-ref) | single frozen MISS body; billing gate; victim-keyed detector | `platform_ref` case-sensitive match; brake 5/10 min, detector 20/h |
| welcome-chat | POST | public pre-arrival AI (ungrounded, own key) | address in prompt only if `welcome_show_address`; uniform 403 for miss/hidden/expired | Turnstile + RL 5/min per code+IP |
| daily-greeting | POST | greeting suggestion (verified) | `suggestion:null` unless verified; demo → null | `resolveGuestAccess`; counter 50/h |
| city-events | POST | cached city events by apt UUID | authoritative city from DB, never client | RL 5/min, counter city-events-public 7/h |
| experiences | POST | marketplace cards by apt UUID | public data only | RL 5/min |
| experience-click | POST | analytics beacon (204) | demo excluded; no PII stored | RL 30/min; UUID+provider allowlist |
| demo-precheck | POST | email → can-start-demo signal | 3 reason codes only, LIKE-escaped ilike | RL 10/min |
| public-pricing | GET | marketing-safe plan fields | service-role, marketing fields only | none |
| send-email / generate-vapid-keys | POST/ANY | stub responses | n/a | n/a |

**Structural facts confirmed in source:**
- The four demo-messaging doors (guest-message, guest-subscribe, host-message, guest-chat
  script) all refuse `is_public_demo`. The peek is one-sided by construction.
- `resolveGuestAccess` is the ONE gate; guest-details/bootstrap/chat/daily-greeting all
  reuse it — no looser re-implementation found.
- The real credential is `ARR-` + 6 chars from a 32-symbol alphabet (~1.07e9, ~30 bits) —
  `TOKEN_RE {4,32}` is a length bound, NOT the entropy. Brake prices guessing; entropy is
  the control. For welcome-claim the control is `platform_ref` entropy (Airbnb 10-char
  ~3.7e15); floor accepted at 8 (~1e8) — no second writer allowed.

---

## 4. Target list (ranked — primary deliverable)

Priority = consequence-if-false × reachability. **Read-only probes = "safe to run".
State-changing / money-spending = "PROPOSE FIRST".**

| id | file:line | Claim under test | Falsifying probe | Blast radius | Run | Prio |
|---|---|---|---|---|---|---|
| T-01 | guest-details.ts:88 | 403 unless verified; private rows never leak to public/wrong/expired token | GET `/api/guest-details?apt=<uuid>&token=<random ARR-XXXXXX>`, plus future-dated (ARR-PRE901) and past-dated fixtures → expect 403, no `details`; any 200 with rows = HOLE | read-only | 5 |
| T-02 | guest-bootstrap.ts:120-148 | lat/lng omitted unless welcome_show_address OR verified token | GET bootstrap no token / wrong token / future-dated token on apt with `welcome_show_address=false` → lat/lng must be ABSENT; present = coord/address leak | read-only | 5 |
| T-03 | guest-bootstrap.ts:102 | **(NEW)** `host_id` is SELECTed and returned to anon in the apartment object; only is_visible/welcome_show_address/is_public_demo are deleted | GET bootstrap on any visible apt → inspect body for `host_id`. welcome.ts treats host_id as derivable-and-accepted; assess whether bootstrap returning it as a FIELD is intended or an oversight (owner-UUID disclosure) | read-only (info) | 3 |
| T-04 | guest-state.ts:228/:287 | every non-active outcome returns identical NEUTRAL; keyed-date path needs qr_secret | GET state random token / out-of-dates token / wrong-or-absent `?key=` → body must be exactly NEUTRAL 200; any distinguishable body/status = oracle | read-only | 4 |
| T-05 | _lib/welcome-claim.ts resolveClaim | single frozen MISS body for all 9 failure classes; no existence oracle | POST valid code + wrong `c`; unknown code; hidden apt; lowercase `c`; cancelled/past booking → all `{state:'miss'}` 200, indistinguishable. Compare response TIMES (file admits best-effort, not constant-time) | read-only | 4 |
| T-06 | _lib/welcome-claim.ts NAME_RE / attachGuestName | name hint fills a blank only, never overwrites; allowlist blocks structural injection | On UNNAMED fixture (ARR-PRE901, guest_id null): POST claim with `g` containing bidi/zero-width (U+200B, U+202E) → NAME_RE must reject; then plain name; confirm a SECOND claim with different `g` does NOT overwrite | STATE-CHANGING (writes guests + booking.guest_id) — PROPOSE FIRST, fixture only | 4 |
| T-07 | guest-chat.ts:103-112 | demo branch returns BEFORE any spend; no model call, no counter | POST guest-chat demo apt id → scripted reply shape; spend unobservable externally | read-only (demo) | 2 |
| T-08 | guest-chat.ts:123 | public tier gets 403 verify_required before any Gemini call | POST guest-chat real apt, no/invalid token → 403 verify_required, never a model reply | read-only | 5 |
| T-09 | guest-chat + buildGuestSystemInstruction | private source doc + door codes never reach a public caller; nonce fence blocks forged markers | Verify a PUBLIC caller (T-08 path) can never trigger the source-doc fetch. Semantic-injection attempt via chat message tests the DOCUMENTED residual, not a regression | read-only; injection attempts (spend Gemini) — PROPOSE FIRST | 3 |
| T-10 | guest-message.ts:32 / guest-subscribe.ts:43 / host-message.ts:53 | messaging off on the public peek in ALL directions | POST each with the demo apt id → all 403 demo_messaging_off | read-only (return before write) | 3 |
| T-11 | guest-subscribe.ts:43-47 | no anon push-sub write against a real host/booking | POST guest-subscribe real apt + guessed/leaked token → 403 not_verified unless truly verified; a 200 writes a push_subscriptions row | STATE-CHANGING (upsert) — PROPOSE FIRST | 3 |
| T-12 | qr-secrets.ts:31-47 | returns qr_secret for ONLY caller's own apartments; no client-supplied list | Auth throwaway host A, POST qr-secrets → only A's apts; body apt-id ignored | JWT read on throwaway — safe | 4 |
| T-13 | guest-availability.ts:60-61 | a LIVE apartment or unknown id reveals NO brand | GET availability live apt → `{status:'live'}`; unknown → `{status:'unknown'}`; brand only on draft | read-only | 2 |
| T-14 | cron.ts:6-9 (all 13 cron routes) | caller without CRON_SECRET gets nothing; check present on every path, no early side-effect | GET each `/api/cron-*` with no Authorization → expect 401/403, no side effect. Enumerate all 13 | read-only (guard rejects) | 5 |
| T-15 | admin-*.ts (5) | admin proof is server-side email check, not client-passed | GET/POST each admin route with a NON-admin host JWT → 403; no token → 401; no client email/role trusted | read-only w/ throwaway JWT | 5 |
| T-16 | demo-create.ts:298 | `user_metadata.is_demo` gates demo eligibility — but Supabase user_metadata is CLIENT-WRITABLE | **(LATENT)** Assess whether a user setting their own `user_metadata.is_demo=true` + trial + no-sub + 0-apts lets a non-/demo signup obtain a demo (cap-1, 48 h). Downside limited (demo-ifies own real account) but flag the trust of client-writable metadata; confirm /demo OTP is the only intended setter | analysis; live test mutates a host row — PROPOSE FIRST | 3 |
| T-17 | ownership checks (generate-guide:50, generate-host-picks:41, host-message:47, refresh-events:79, sync-ical:101, cancel-booking:67, city-image, create-booking, create-upload-url) | every apartmentId/bookingId from client is re-checked `host_id === userId` before privileged action | Auth throwaway host A, call each with host B's apartment_id → 403 Forbidden. One miss = cross-tenant write | read-only 403-probe first; some STATE-CHANGING — PROPOSE FIRST | 5 |
| T-18 | create-upload-url.ts / city-image.ts | signed upload URL is scoped `{hostId}/...` and ownership-checked | Auth host A, request upload URL for host B's apt → 403; confirm path prefix is A's uid | PROPOSE FIRST (mints signed URL) | 4 |
| T-19 | stripe-webhook.ts (~272, carry-in) | no `sub.id === stripe_subscription_id` check; last-writer-wins from any arrivly-metadata sub | LATENT (CLAUDE.md tracked). Verify in code the equality check is still absent; cannot probe without Stripe test events; do NOT attempt live | code-only + Vercel logs | 2 |
| T-20 | safe-fetch.ts (sync-ical / cron-sync-ical) | SSRF closed: host-pasted iCal to 169.254.169.254 / 127.0.0.1 / 10.x is blocked | Auth throwaway host, set ical_urls to `https://169.254.169.254/latest/meta-data/` and `https://127.0.0.1/`, POST sync-ical → generic error, never fetches metadata; test DNS-rebind domain if available | STATE-CHANGING (sets ical_urls + fetch) — PROPOSE FIRST | 4 |
| T-21 | welcome-claim.ts clientIp / sibling clientIp | x-forwarded-for is attacker-controllable; sibling limiters read xff[0] first | Rotate spoofed `X-Forwarded-For` against guest-state / guest-details / welcome-claim → confirm per-instance limiter/brake bypass. welcome-claim reads x-vercel-forwarded-for FIRST; confirm that ordering and whether Vercel appends vs overwrites inbound xff (file admits UNVERIFIED) | read-only (rate-limit bypass) | 3 |
| T-22 | bulk-import.ts:139 (carry-in residual) | `is_private:false` on EVERY row; a credential the model echoes back lands public | On throwaway host, bulk-import a manual whose text hides a door code in a sentence scrubCredentialSentences misses → check whether it surfaces on the PUBLIC guest page | STATE-CHANGING — PROPOSE FIRST | 3 |
| T-23 | bulk-import.ts:135 (carry-in) | scrubCredentialSentences is a real mechanism, not a prompt hint | Confirmed WIRED at :135 (runs in buildRows before insert). Residual: it runs AFTER the parse-failure early-return (:298), but that path inserts nothing. **Latent-only** | code-only | 2 |
| T-24 | bulk-import.ts (carry-in) | "no rate limiter / bump_api_counter / ROLLING_LIMITS entry" | **FALSE as stated:** bulk-import DOES call bump_api_counter (:192) and IS registered in ROLLING_LIMITS (`'bulk-import':30`, cron-spend-audit.ts:58). Prior residual is STALE — record as CLEARED | code-only | 1 |
| T-25 | bulk-import.ts:298 (carry-in) | "raw.slice(0,200) can write a door code to Vercel logs on parse failure" | **FALSE as stated:** the parse-fail log (:298-301) logs ONLY `raw.length` and `startsWithFence`, never raw content, with a comment saying exactly that. Record as CLEARED (already fixed) | code-only | 1 |
| T-26 | PG-41 (carry-in) | Focus-ring on Share `<select>` + chat offramp button | **Accessibility, NOT an attack. Tag: AA-sweep, not this pass.** Recorded so not lost | n/a | — |
| T-27 | PRE-FREEZE SMOKE (carry-in) | Four bulk-import box-clear branches (PG-23/24/27, 5958fae) shipped logic-verified, never browser-verified | Live browser check on the throwaway host: run bulk-import through the UI, confirm each box-clear branch renders | STATE-CHANGING (UI) — PROPOSE FIRST | 2 |
| T-28 | city-events.ts:31 | per-instance limiter map is bounded | city-events `rlHits` has NO RL_MAX_KEYS sweep (unlike guest-chat/experiences/demo-precheck). A flood of distinct apt+IP keys grows the map until instance recycle. Minor DoS-on-self. **Latent** | code-only | 2 |
| T-29 | city-events.ts:158 | apartmentId validated | city-events checks only `typeof === string`, not UUID_RE, before the DB lookup (experiences DOES validate). Harmless (lookup misses) but inconsistent | read-only | 1 |
| T-30 | welcome-chat.ts:207 + Turnstile | public pre-arrival AI is captcha + rate gated; own isolated key | POST welcome-chat without a valid turnstileToken → 403 captcha_failed before any model call; confirm GEMINI_API_KEY_PUBLIC isolation (no fallback) | read-only | 2 |
| T-DB1 | DB fn `guest_host_card(uuid)` | SECURITY DEFINER, anon EXECUTE, **no token**; returns brand/logo/whatsapp/**subscription_status**/accent for any visible apt, bypassing RLS. whatsapp nulled only for demo. | anon `POST /rest/v1/rpc/guest_host_card` with a FIXTURE apt id → observe `subscription_status` returned with no token. **subscription_status has no guest-facing reason to exist** (reveals trial-vs-active per host); whatsapp is arguably intended (product call). Same anon-host-data family as T-03. | read-only (safe) | 4 |
| T-DB2 | tables apartment_qr_secrets / admin_audit / app_settings / daily_greetings | RLS-on / ZERO-policies (deny-all today) but still carry dangling anon/authenticated grants; **apartment_qr_secrets has anon:SELECT**. | **LATENT config risk, no live probe** — nothing to prove today. One `DISABLE RLS` or one permissive policy turns anon:SELECT on the QR-secret table into a full leak. Fix = REVOKE the dangling grants so protection isn't single-layered. Record only. | code/config only | 3 |

---

## 5. Open questions for DB-side recon — ANSWERED (chat-side Supabase pull, 31 Aug 2026)

**All 11 resolved from the live catalog. Summary of verdicts:**

- **Q1 (service-role tables RLS):** CONFIRMED SAFE — RLS ON, zero policies, no anon/auth
  grants on api_call_counters, demo_open_counts, city_events_cache, city_events_by_city,
  experiences_cache.
- **Q2 (`guest_host_card`):** anon-callable CONFIRMED; whatsapp masked for demo CONFIRMED —
  **but it also returns `subscription_status` to anon with no token → new finding T-DB1.**
- **Q3 (column grants):** CONFIRMED SAFE — server-only columns not granted to anon/auth;
  host-owned tables `auth.uid()`-scoped.
- **Q4 (push_subscriptions):** CONFIRMED — auth.uid()-scoped policy; guest-subscribe
  (service-role) is the only anon writer, gated on resolveMessagingAccess.
- **Q5 (guests):** CONFIRMED — auth.uid()-scoped, no `USING(true)`.
- **Q6 (bookings anon policy):** CONFIRMED — host-scoped only; no anon `bookings_guest_read`.
- **Q7 (`hosts` DELETE grant):** covered by the RLS auth.uid() scoping; dangling-grant class
  is now tracked as **T-DB2** (revoke dangling grants as defence-in-depth).
- **Q8 (triggers):** CONFIRMED — SECURITY DEFINER functions all pin search_path; enforce_*
  and auth_owns_apartment deny anon/auth EXECUTE.
- **Q9 (bump RPCs):** CONFIRMED SAFE — `bump_api_counter` / `bump_demo_open` EXECUTE =
  service_role only, SECURITY DEFINER, search_path pinned; `bump_demo_open` zero-arg.
- **Q10 (apartment_details anon RLS):** CONFIRMED — predicate holds; anon cannot read private.
- **Q11 (welcome_show_address):** CONFIRMED default NOT NULL DEFAULT true.

**Two NEW targets folded into §4: T-DB1 (guest_host_card leaks subscription_status to anon,
PROVABLE, Pri 4) and T-DB2 (dangling anon grants incl. apartment_qr_secrets anon:SELECT,
LATENT, Pri 3).** De-escalated: `assign_welcome_code` anon EXECUTE is a `RETURNS trigger`
function PostgREST will not expose as an RPC — Supabase default-grant residue, not reachable.
Do not chase.

**DB-layer cross-tenant isolation is correct:** every host-owned table's policy gates on
`auth.uid()`, so an anon PostgREST read returns zero rows despite the `{public}` role grant.
Phase 2 still proves it live (T-12 / T-17), but the policy layer holds.

---

### Original open questions (now answered above — kept for traceability)

Assertions the code relied on that only a live Supabase pull could confirm:

1. **RLS on service-role-only tables** (`admin_audit`, `apartment_qr_secrets`,
   `app_settings`, `city_events_cache`, `daily_greetings`, `experiences_cache`,
   `api_call_counters`): confirm RLS ON + ZERO policies live, anon/authenticated cannot read.
2. **`guest_host_card` RPC**: anon-callable by design; confirm it MASKS `whatsapp` for
   `is_public_demo` apartments (the enforcing fix) and the anon EXECUTE grant is intended.
3. **Column-level UPDATE grants**: confirm server-only columns on `hosts`
   (`tier`, `subscription_status`, `stripe_*`, `is_test`, `is_demo`, `demo_expires_at`,
   `property_cap_override`, notice/pending/cancel) and `apartments` (`is_test`,
   `is_public_demo`) are NOT granted to authenticated/anon. **Verify `is_public_demo` is
   NOT in the apartments client allowlist** (CLAUDE.md says never re-add it). Relevant to T-16.
4. **`push_subscriptions` write path**: confirm anon/authenticated cannot INSERT directly;
   guest-subscribe (service-role) is the only anon writer and gates on resolveMessagingAccess.
5. **`guests` table**: confirm server-write-only, host-scoped SELECT, no `USING(true)`.
6. **`bookings` anon policy**: confirm the old `bookings_guest_read` anon policy is GONE —
   an anon SELECT on bookings would bypass every token gate.
7. **`DELETE` grant on `hosts`** to anon/authenticated (CLAUDE.md tracked): confirm still
   present-but-RLS-blocked, and whether to revoke before launch (cascades to apartments/
   bookings/picks).
8. **`enforce_property_address_swap` / `enforce_property_cap` triggers**: confirm INVOKER
   rights (NOT security-definer) — a caller-keyed exemption must judge the real caller.
9. **`bump_api_counter`, `bump_demo_open`** RPCs: confirm EXECUTE grants; `bump_demo_open`
   takes zero arguments (structural no-PII guarantee).
10. **`apartment_details` anon RLS** `USING (is_private = false)`: confirm the predicate.
11. **`welcome_show_address`** default NOT NULL DEFAULT true — the coordinate gate depends on it.

---

## 6. Priority-5 shortlist (attack these first in Phase 2)

T-01 (private-detail leak via bad token), T-02 (coordinate/address leak), T-08 (public
AI-spend gate), T-14 (cron auth on all 13), T-15 (admin server-side proof), T-17
(cross-tenant host-endpoint ownership). All six have read-only falsification probes that
reach production without spending money or changing state.
