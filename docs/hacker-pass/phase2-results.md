# Bemgu Hacker-Agent Pass — Phase 2 Results (ACTIVE PROBING)

Probed against production `https://bemgu.app` on 31 Aug 2026. Freeze re-confirmed before
probing (`git diff 47bb840 origin/master` excl. docs/CLAUDE.md = empty). No code edits, no
commits, no writes to any tenant's data, no emails/messages/AI spend, no env values printed.

Throwaway "host A": `udy.bar.yosef+pentest@gmail.com`, host_id `5d6d6fcd…685e`, apartment
`02532a18…d791` ("Jony London home", is_test). Fixtures used: Sweet home (public demo)
`d9614d11…c2bd` / token `ARR-EVT777` / code `XJ8SSKFH`. No real host or real apartment was
touched.

Anon publishable key: the browser-shipped public key, extracted into a shell variable from
the site bundle and used for the one anon RPC probe. Its value was never printed.

---

## Batch A — anon / read-only (RUN)

| Target | Probe | Result | Verdict |
|---|---|---|---|
| **T-01** guest-details | no token / random valid-shape token / malformed token vs throwaway apt | no token → **400**; random `ARR-ZZ9Q7X` → **403 forbidden**, no rows; malformed → **400**. Private rows never returned. | **CONFIRMED-SAFE** |
| **T-02** guest-bootstrap coord gate | no token vs random token on throwaway apt | Both return lat/lng — **but this apt has `welcome_show_address=true` (the NOT NULL DEFAULT true default)**, so coords are expected. The random token grants nothing MORE than no token (identical bodies). Gate not falsified; correctly falsifying it needs an apt with the toggle OFF. → moved to Batch C (T-02b). | **INCONCLUSIVE** (needs toggle-off apt) |
| **T-03** host_id disclosure | inspect anon guest-bootstrap body | `"host_id":"5d6d6fcd…685e"` **is present** in the anon apartment object. Confirmed live: any anon caller with a visible apt UUID learns the owner's host UUID. (Also derivable from `logo_url` path prefix — Sweet home's host id `abf47595…` appears in T-DB1's logo path.) | **FINDING** (info-disclosure, low) |
| **T-04** guest-state neutral | no token / random token / wrong key / token+wrong key | All four → byte-identical `{"state":"neutral","token":null,"guestName":null}` **200**. No oracle. | **CONFIRMED-SAFE** |
| **T-05** welcome-claim miss body | malformed body / valid-shape nonexistent code / bad-alphabet `c` (non-resolving classes only) | All → identical `{"state":"miss"}` **200**. Timing: malformed ~0.2–0.37s (returns before any DB query), well-formed-but-wrong ~0.38–0.74s (full DB round-trips vs NO_MATCH sentinel). The only separation is malformed-vs-well-formed (input validity), NOT booking existence — matches the resolver's documented parity (welcome-code existence isn't the secret; the confirmation code is). Real-code + wrong-ref variant writes a counter row → Batch C. | **CONFIRMED-SAFE** (documented residual) |
| **T-07** guest-chat demo branch | POST demo apt, no token | Scripted reply, **200** in 0.39s (no grounded-Gemini latency → no model call, no spend). Returns before verify gate. | **CONFIRMED-SAFE** |
| **T-08** guest-chat verify gate | POST real apt, no token / random token | Both → **403 verify_required**, fast (no model latency). Malformed apt → **404 not_found**. Public tier never reaches Gemini. | **CONFIRMED-SAFE** |
| **T-10** demo messaging off | guest-message list + guest-subscribe vs demo apt (with published demo token) | Both → **403 demo_messaging_off**, before any write. | **CONFIRMED-SAFE** |
| **T-13** guest-availability | live apt / unknown id | live → `{"status":"live"}`; unknown → `{"status":"unknown"}`. No brand leaked on either. | **CONFIRMED-SAFE** |
| **T-21** XFF handling | 3 requests to guest-state rotating `X-Forwarded-For` | All **200**. Per-instance limiters read `xff[0]` and thresholds are 30–60/min, so a header-rotating bypass is **architecturally certain** but a live threshold-crossing demo would need a flood (out of scope, correctly not run). welcome-claim reads `x-vercel-forwarded-for` first (the one place it matters). | **FINDING (architectural, low)** — best-effort limiter, as the code already states |
| **T-29** city-events input | non-UUID `apartmentId` | `{"error":true}` **200** — graceful miss. Harmless (PostgREST returns no row); inconsistent with siblings that UUID-validate, but not exploitable. | **CONFIRMED-SAFE** (cosmetic) |
| **T-DB1** guest_host_card | anon RPC `POST /rest/v1/rpc/guest_host_card`, no token, throwaway + Sweet home | **200** both. Returns `subscription_status` to anon with **no token**: throwaway → `"trial"`, Sweet home → `"active"`. `whatsapp` null in both (throwaway has none; demo masked). Also returns `brand_name`, `logo_url` (path exposes host_id), `accent_color`. | **FINDING** (anon learns per-host trial-vs-active by enumerating apt UUIDs) |

### Batch A confirmed findings (not "safe")

> **UPDATE 2026-08-31 — T-DB1 and T-DB2 both CLOSED (DB migration `hacker_pass_fix_tdb1_tdb2`,
> DB-only, no frozen application code touched). VERIFIED LIVE:** anon `guest_host_card` no
> longer returns `subscription_status` (both throwaway + Sweet home return
> `{brand_name, logo_url, whatsapp, accent_color}` only); anon direct SELECT on
> `apartment_qr_secrets` now returns **401 permission denied** (dangling grant revoked). The two
> findings below are retained for the record; they no longer describe live behaviour.

1. **T-DB1 — `guest_host_card` leaks `subscription_status` to anonymous callers.** Pri 4.
   **CLOSED 2026-08-31 (verified live).**
   No guest-facing reason to expose billing state; it lets an attacker map which hosts are
   trial vs active by walking public apartment UUIDs. Fix: drop `subscription_status` from
   the RPC's return (the guest page does not need it), or gate it. Same anon-host-data family
   as T-03. **whatsapp** exposure is arguably an intended contact channel — a product call,
   not a bug.
2. **T-03 — `host_id` returned to anon in guest-bootstrap.** Pri 3 (info-disclosure).
   `welcome.ts` documents host_id as derivable-and-accepted (image paths), so blast radius is
   low — but bootstrap ships it as an explicit field. Decide: strip it, or accept and delete
   the note's ambiguity. Not a credential; no authority attaches to the UUID.
3. **T-21 — per-IP limiters bypassable by X-Forwarded-For rotation.** Pri 2 (architectural).
   Already documented in-code as best-effort/per-instance; the real spend controls are the
   verify-gate + per-host `bump_api_counter` cross-instance caps, which are NOT IP-keyed.
   Recorded, not a launch blocker on its own.

---

## Batch B — cron guard (ONE probe only)

| Target | Probe | Result | Verdict |
|---|---|---|---|
| **T-14** cron auth | unauth GET `cron-refresh-events`; then wrong-bearer GET | Both → **401 Unauthorized**, fast, no side effect. Shared guard `cron.ts:6` confirmed for the family. **Did not fan out to other crons** (per instruction). | **CONFIRMED-SAFE** |

---

## Batch C — PROPOSE-FIRST (written, NOT sent — awaiting per-probe approval)

All require either a write, a cross-tenant attempt, AI/quota spend, a server-side fetch, or
a browser session. Grouped for a single approval pass. **Nothing below was executed.**

### Group 1 — cross-tenant ownership (need throwaway host A's JWT; read-only 403 probes)
Obtain a Bearer for host A by signing in as `udy.bar.yosef+pentest@gmail.com`. Then, from
host A, target a FIXTURE apartment id (Sweet home `d9614d11…`) or leave apartment_id as host
A's own where the endpoint mutates:

- **T-15** admin routes with a NON-admin (host A) JWT — expect **403 forbidden**:
  - `GET  /api/admin-overview`            headers: Authorization: Bearer <A>
  - `GET  /api/admin-audit`               headers: Authorization: Bearer <A>
  - `GET  /api/admin-impersonate?host_id=<A's own id>`  Authorization: Bearer <A>
  - `POST /api/admin-plans`               Authorization: Bearer <A>, body `{}`
  - `POST /api/admin-update-host`         Authorization: Bearer <A>, body `{}`
  - Safe iff every one returns 403 (no token → 401). A 200 = privilege-escalation HOLE.
- **T-12** qr-secrets scoping — `POST /api/qr-secrets` Authorization: Bearer <A>, body `{}`.
  Expect only host A's own apartment secrets; body must not accept an apt-id list. A fixture
  apt's secret appearing = cross-tenant leak. (Read-only, but needs A's JWT → propose.)
- **T-17** the 9 host endpoints, cross-tenant, with host A's JWT supplying a FIXTURE
  apartment_id (`d9614d11…`) — each must **403 Forbidden** at the ownership check:
  - `POST /api/generate-guide`        body `{"apartment_id":"d9614d11…"}`   (would spend AI if it passed → propose)
  - `POST /api/generate-host-picks`   body `{"apartmentId":"d9614d11…","text":"x"}`
  - `POST /api/host-message`          body `{"bookingId":"<fixture booking>","body":"x"}`
  - `POST /api/refresh-events`        body `{"apartment_id":"d9614d11…"}`
  - `POST /api/sync-ical`             body `{"apartment_id":"d9614d11…"}`   (triggers server fetch if it passed)
  - `POST /api/cancel-booking`        body `{"bookingId":"<fixture booking>"}`  (state-change if it passed)
  - `POST /api/city-image`            body `{"apartmentId":"d9614d11…", …}`
  - `POST /api/create-booking`        body `{"apartmentId":"d9614d11…", …}`  (write if it passed)
  - `POST /api/create-upload-url`     body `{"apartmentId":"d9614d11…","kind":"hero"}` (= T-18)
  Run order: send each ONCE and stop at the ownership check. Expected-safe = 403; a 200/side
  effect against the fixture = cross-tenant write hole.

### Group 2 — write / mutation on the throwaway host only
- **T-02b** coordinate gate (proper falsification): as host A, set
  `apartments.welcome_show_address=false` on apt `02532a18…` (host A's own), then re-run the
  anon Batch-A T-02 probe. Expected-safe: lat/lng now ABSENT for no-token and random-token;
  present with a VERIFIED token only. (One column write on host A's own apt.)
- **T-06** welcome-claim NAME_RE + no-overwrite (needs an UNNAMED fixture booking with a known
  confirmation code; **none is currently in scope** — Sweet home is the demo with invented
  data; the three ARR-*501/401/901 pre-arrival fixtures live on "charming 1908 studio", not a
  scope target). PROPOSE the specific booking to use, then:
  - `POST /api/welcome-claim` body `{"code":"<code>","c":"<real ref>","g":"A‮evil"}` → NAME_RE must reject bidi.
  - Then a plain `g`, then a second claim with a different `g` → must NOT overwrite the stored name.
- **T-22** bulk-import is_private:false leak (writes rows on host A): as host A, bulk-import a
  manual whose text hides a door-code-shaped token in a non-credential sentence, then GET the
  PUBLIC guest-bootstrap for host A's apt and check whether it surfaces in `details`
  (is_private=false). Spends AI + writes rows → propose.
- **T-16** demo self-grant: analysis-first. A live test would set host A's
  `user_metadata.is_demo=true` then call `/api/demo-create` — mutates host A's row (flips it to
  a 48h demo). Recommend NOT running live; the code path is clear enough to reason about
  (downside is self-demotion of one's own account, cap-1). Propose only if you want it proven.

### Group 3 — SSRF (server-side fetch; throwaway host)
- **T-20**: as host A, set `apartments.ical_urls` on apt `02532a18…` to
  `https://169.254.169.254/latest/meta-data/` and `https://127.0.0.1/`, then
  `POST /api/sync-ical` body `{"apartment_id":"02532a18…"}`. Expected-safe: generic
  error/`0 events`, NEVER metadata content. A DNS-rebind test domain would strengthen it.
  Triggers a real outbound fetch → propose.

### Group 4 — browser, throwaway host
- **T-27** the four bulk-import box-clear branches (PG-23/24/27): drive the dashboard bulk-import
  UI as host A and confirm each box-clear branch renders. Needs an authenticated browser
  session → propose.

### Latent / code-only (no live probe — recorded, not proposed)
- **T-DB2** dangling anon grants incl. `apartment_qr_secrets` anon:SELECT — REVOKE recommended.
- **T-19** stripe-webhook `sub.id` equality — verify in code + Vercel logs, no live probe.
- **T-23** scrubCredentialSentences after parse-fail early-return — latent, inserts nothing.
- **T-24 / T-25** stale carry-in residuals — already CLEARED in Phase 1 (bulk-import DOES
  counter+register; parse-fail log carries no content).
- **T-28** city-events unbounded limiter map — minor DoS-on-self, latent.
- **T-26** PG-41 focus-ring — accessibility, AA-sweep not this pass.

---

## One-line summary

- T-01 SAFE · T-02 INCONCLUSIVE(→T-02b) · T-03 FINDING(host_id to anon) · T-04 SAFE ·
  T-05 SAFE · T-07 SAFE · T-08 SAFE · T-10 SAFE · T-13 SAFE · T-14 SAFE · T-21 FINDING(arch) ·
  T-29 SAFE · **T-DB1 FINDING(subscription_status to anon)** · Batch C written, not sent.
