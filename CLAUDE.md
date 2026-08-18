# Arrivly — CLAUDE.md

Historical session detail lives in docs/history.md. Read it only when past context is
needed. (Deliberately a plain filename, NOT an @import — an imported file is pulled into
context automatically every session, which is exactly what splitting this file avoided.)

> **BRAND vs CODENAME (Jul 12 2026 — rebrand):** the **public brand = Bemgu** (domain **https://bemgu.app**, Resend sender **hello@bemgu.app**, registrar **Porkbun**). The **internal codename = arrivly** — the GitHub repo name (`udybr1975/arrivly-app`), `package.json` name, local folder `C:\dev\arrivly`, the Stripe **`metadata.app === 'arrivly'`** filter (case-sensitive, load-bearing in `api/stripe-webhook.ts`), every `arrivly_*`/`arrivly:*` storage key + window/DOM event, the `arrivly-v*` SW cache name, all env var NAMES, and every code identifier / CSS class deliberately KEEP "arrivly". **Never rename them.** User-facing strings (page titles, meta tags, email copy + sender, push titles, aria-labels, displayed URLs, the "Powered by Bemgu" footer, manifest name) are all "Bemgu".
>
> **Cloudflare Turnstile widgets are HOSTNAME-ALLOWLISTED.** Any domain change must repeat it or the demo money-gate shows "Unable to connect".
> **Supabase auth email routes through Resend Custom SMTP** (`smtp.resend.com:465`, user `resend`, sender `Bemgu <hello@bemgu.app>`) — the built-in mailer is not used.
>
> Domain migration + rebrand narrative (Jul 12-17 2026) and its 8/8 smoke tests: docs/history.md.
> **Repo note (Jun 5 2026):** The canonical repo is now `udybr1975/arrivly-app`. The old `udybr1975/arrivly` is abandoned (server-side corruption: pushes rejected "missing necessary objects", Settings page 500s; GitHub support ticket open). Local working copy: `C:\dev\arrivly`. Vercel project `arrivly` is connected to `arrivly-app`.
> **No secret values live in this repo — it is PUBLIC.** Server-side keys have no `VITE_` prefix and exist only in Vercel env vars. **VERIFIED AT SOURCE 14 Aug 2026** via the GitHub API — `"private": false`, `"visibility": "public"`, `created_at 2026-06-05`, i.e. public since creation, never flipped. `.gitignore` carries five `.env` ignore patterns plus a `!.env.example` negation, and no secret has ever been committed. Do not re-derive or soften this line.
> **Current HEAD (code) — `fc35d69`** (18 Aug 2026), the BookingManager overlap guard + soft cancel. The three commits before it (`c4981b2`, `8619c5f`, `1a2ed59`) are the Groq migration. Docs-only commits land on top of it; a docs tip is not a mismatch. Full commit ancestry is in git — do not restate it here.
>
> **WHERE THE PROJECT IS:** Phases A–E, G, H and Phase I Stages 0/4A/4B/5 are COMPLETE.
> Build order decided: **flip live on Tiers 1–3 FIRST, then build Phase F (Tier-4 booking)**
> — so the pentest gate runs on the Tiers 1–3 surface, and Phase F needs its own second
> security pass before Tier 4 is sold.
>
> **THE FOUR THINGS BLOCKING LAUNCH:** (1) ~~Gemini billing~~ — dissolved by the ZERO-GOOGLE AI PILOT; Google is leaving the stack, there is no billing flip. (2) the legal/compliance workstream — inventory DONE, **eight gaps open**, documents 3/4/5 DRAFTED but unpublished, (the retention crons that gated publication SHIPPED 11 Aug 2026). (3) the `gemini-2.5-flash` **16 Oct 2026** shutdown — **THIS NOW BINDS. It is no longer conditional.** `api/guest-chat.ts:9` is `MODEL = 'gemini-2.5-flash'` on `GEMINI_API_KEY_CHAT` (project `gen-lang-client-0221179352`), VERIFIED IN SOURCE AND CONFIRMED FREE-TIER BY UDY 18 Aug 2026 — no card, so it cannot bill. Guest-chat is the SOLE remaining Google dependency and it has a hard shutdown date. (4) the pentest gate. Also open but smaller: welcome-page Part 2 and the pre-live additions.
>
> Full session-by-session history — including the long HEAD chain this line replaced — is in
> docs/history.md.
>
> **Design system — GROUND TRUTH (verified from shipped `Layout.tsx`, S26):**
> - Host dashboard = **DARK sidebar + CREAM workspace** (NOT all-dark). Sidebar bg `#1c1c1a`, border `#322c25`. Workspace/main bg `#f0ede6`. Cards `#fffdf9`, hairline `#e4ddd0`.
> - Brass `#c8a24e` (active state + primary CTA), brass-deep `#a8842f`, brass-soft `#e7d6ad`. Text `#231d17`, muted `#8a8276`, faint `#b3aa9b`, label `#a79e8e`. Good `#5d7c34` on `#eaf0dd`. Private badge text `#8a1a1a`.
> - Fonts: Fraunces (display) + Inter (body), loaded globally in `index.html`.
> - In-page section nav (e.g. property editor) = **HORIZONTAL premium tabs, NOT a vertical rail**. Active tab = charcoal pill (bg `#1c1c1a`, text `#f0ede6`); inactive = hairline outline, muted text. Brass reserved for Save + accents. (A vertical rail was tried and rejected — read as a competing second menu.)
>
> **Colour model (per-property inherit / account default) — LIVE (shipped S27 2a `981bd5b`):**
> - `apartments.accent_color`: NULL = "inherit the brand default". `hosts.accent_color` = the account-wide brand default.
> - Guest page resolves colour as: `apartment.accent_color ?? host.accent_color ?? colourPresets[0].hex` (`#1c1c1a`) — wired in `GuestPage.tsx` (`accent_color` added to the Host type).
> - SECURITY DEFINER RPC `guest_host_card(p_apartment_id)` now ALSO returns `accent_color` (Migration B); `/api/guest-preview`'s host payload now surfaces `host.accent_color`. The coalesce is live on both the real guest page and the owner/admin preview.
>
> **Branding model — LIVE (shipped S27 2a `981bd5b`):**
> - Branding tab is now **ACCOUNT-WIDE**: logo (`hosts.logo_url`) + brand name (editable → `hosts.brand_name`) + default colour (→ `hosts.accent_color`). The old first-property-only behaviour was removed.
> - Host-contact-to-guests toggle (WhatsApp/phone "show to guests on every page", OFF by default) is still **DEFERRED** to its own later pass — needs guest-page display work; do not ship a dead toggle.
> - Per-property colour override lives in the **"Look" tab** inside the property editor (shipped S27 2b).

## What is Arrivly?
Arrivly is a multi-tenant SaaS platform for short-term rental hosts. Each host sets up their property and gets a personalised branded guest page accessible via QR code. The guest page shows check-in info, WiFi, house rules, host picks, and an AI-generated neighbourhood guide.

**Pricing:** DB-driven tiers (`plans` table) — T1 €10 / T2 €15 / T3 €25 / T4 €49 per month; 14-day free trial (`app_settings.trial_days`). `config.ts` pricing fields are legacy stubs.  
**Stack:** React 19 + Vite + TypeScript + Tailwind CSS · Supabase (auth + DB) · Vercel (host)  
**Repo:** https://github.com/udybr1975/arrivly-app (branch: master)  
**Supabase project:** ptkabdelgxkgfslfialx (eu-central-1)  
**Vercel project:** prj_0QUqUs4RqtLJu68IYGpk5KPTiaG6 · team: team_ez8n9ADnf76POLmcotzlykff  
**Admin email:** udy.bar.yosef@gmail.com  
**App URL:** https://bemgu.app  (old `arrivly.anna-stays.fi` 308-redirects here permanently)

## Routes
| Path | Component | Auth |
|------|-----------|------|
| `/` | Landing | public |
| `/login` | Login | public |
| `/signup` | Signup | public |
| `/guest?apt=UUID` | GuestPage | public |
| `/dashboard` | Dashboard | protected |
| `/dashboard/property/:aptId` | PropertySetup | protected |
| `/dashboard/bookings` | BookingManager | protected |
| `/dashboard/messages` | Messages | protected |
| `/dashboard/share` | SharePanel | protected |
| `/dashboard/qr` | `<Navigate replace>` → `/dashboard/share` (legacy bookmarks) | protected |
| `/dashboard/branding` | BrandingPanel | protected |
| `/dashboard/billing` | BillingPanel | protected |
| `/dashboard/earnings` | EarningsPanel | protected |
| `/dashboard/earnings/connect` | EarningsConnect | protected (tier ≥ 3; T1/2 → redirect to `/dashboard/earnings`) |
| `/dashboard/settings` | Settings | protected |
| `/admin` | SuperAdmin | admin only |

## Database (Supabase)
> Column-by-column table listings moved to docs/schema.md — "Database (Supabase)".
> Moved to docs/schema.md — "DB functions".
### DB TRAPS
Only the things that cause real bugs. Full column listings + reference detail are in
docs/schema.md.
- `apartments.accent_color` — NOT brand_color (common mistake, causes silent save failure)
- **Supabase MCP `execute_sql` returns ONLY the LAST statement's result.** Send one statement per
  call when you need to see each result — a multi-statement batch silently discards every earlier
  result set, so a verification query batched ahead of anything else reports nothing and reads as
  a pass.
- **New tables/functions do NOT default to safe.** Supabase auto-grants EXECUTE to anon +
  authenticated on every new public function, and anon/authenticated hold blanket
  TRUNCATE/TRIGGER/REFERENCES on every new table (**and TRUNCATE BYPASSES RLS**). `REVOKE ... FROM
  PUBLIC` — revoking from anon/authenticated is a **silent no-op** when the grant came via PUBLIC
  (ACL `=X/owner`). Always confirm against the LIVE ACL (`pg_proc.proacl` / `relacl` /
  `has_function_privilege`), never that the statement ran without error.
- **RLS-on / ZERO-policies = service-role only** (a host cannot read them, so never write UI that
  SELECTs one): `admin_audit`, `apartment_qr_secrets`, `app_settings`, `city_events_cache`,
  `daily_greetings`, `experiences_cache`, `api_call_counters`.
- `guide_recommendations` — always query with `.maybeSingle()` never `.single()`
- **`push_subscriptions.apartment_id` is NULL for host account-level subscriptions.**
  Always call `sendPushToHost(db, hostId, payload)` WITHOUT the optional `apartmentId`
  argument when notifying the host — passing one filters the lookup to zero rows and
  delivers nothing silently.
- **`hosts` server-only columns** — `hosts` has 14 client-updatable profile columns only; `tier`, `is_exempt`, `price_override_cents`, `discount_percent`, `discount_until`, `property_cap_override`, `subscription_status`, `billing_notice`, `pending_tier`, `cancel_at_period_end`, `current_period_end`, `last_billing_notice_sig` are server-only for WRITE (column-level UPDATE revoked from authenticated+anon; verified via `role_column_grants` in Task 2 for `pending_tier` and `cancel_at_period_end`; `last_billing_notice_sig` UPDATE confirmed granted to `service_role` + `postgres` only, NOT authenticated/anon — F-05 verified safe S24). `billing_notice`, `pending_tier`, `cancel_at_period_end`, and `current_period_end` ARE SELECT-readable by authenticated (needed for BillingPanel). Never write server-only columns from the client — only via admin endpoints, `change-plan.ts`, `cancel-subscription.ts`, or the stripe-webhook (service-role).
- **`city_events_cache` is service-role-only (RLS ON, ZERO policies)** — hosts CANNOT read it, including its `generated_at` timestamp. The property editor's "Guide & events" tab therefore derives events freshness from the **`/api/refresh-events` JSON response** (`refreshed` / `reason` / `generated_at`), NEVER a direct cache SELECT. (The city-guide row, by contrast, reads `guide_recommendations.generated_at` directly — that table IS host-readable.)
- **`apartments.accent_color` is NULLABLE (S27 2a, Migration A):** the old NOT NULL + default were dropped. NULL = inherit `hosts.accent_color` (account default); non-null = per-property override. The "Look" tab writes a validated hex on override and `NULL` on "reset to brand default", scoped `.eq('id', aptId).eq('host_id', hostId)`. Backfill state after Migration A: 7 inheriting (NULL) / 4 explicit overrides / 11 total.

> Reference-only DB facts moved to docs/schema.md — "Critical DB facts (reference detail)". Bug-causing traps stay above.

### Image system
- **Bucket** `apartment-images` — public read; 3 owner-scoped write RLS policies (insert/update/delete), condition `(storage.foldername(name))[1] = auth.uid()`.
- **Columns:**
  - `apartments.hero_image_url` — host's own uploaded cover photo, stored as a bucket path (e.g. `{hostId}/{aptId}/hero-{ts}.jpg`).
  - `apartments.city_image_url` — cached Unsplash by-city default hero, stored as a full `https://` URL.
  - `apartments.city_image_credit` — JSON string `{ name, userLink, unsplashLink }` for Unsplash attribution caption.
  - `hosts.logo_url` — host logo, stored as a bucket path.
- **Guest hero precedence:** host upload (`hero_image_url`) → city image (`city_image_url`, with attribution caption) → static `FALLBACK_HERO` (hardcoded Unsplash warm interior).
- **Upload flow:** client calls `POST /api/create-upload-url` (Bearer token) → server verifies host via `getUser`, checks apartment ownership with the service-role key, builds path `{hostId}/{aptId}/hero-{ts}.{ext}` or `{hostId}/logo-{ts}.{ext}`, calls `createSignedUploadUrl` → returns `{ path, token }` → client calls `supabase.storage.uploadToSignedUrl(path, token, file)`. File goes direct to Storage; never passes through Vercel (no 4.5 MB body limit).
- **`src/lib/imageUtils.ts`:** `resolveImageUrl(url)` (path → public URL, full URL → as-is, null → fallback) + `uploadImage(file, kind, apartmentId?)` (calls the signed-URL flow).
- **Env var:** `UNSPLASH_ACCESS_KEY` — server-side only (no `VITE_` prefix); used by `api/city-image.ts`.

## Config
Branding settings (colour presets, currency symbol) are in `src/config.ts`. Colour presets for BrandingPanel are in `ARRIVLY_CONFIG.colourPresets`.
Pricing and plan values are DB-driven (`plans` table + `app_settings.trial_days`). `config.ts` no longer contains any pricing fields (legacy fields removed S19 + S23).

## Design System
- Page background: `bg-[#f0ede6]`
- Cards: `bg-white border border-[#ddd8ce] rounded-[10px]`
- Sidebar: `w-[170px] bg-[#f8f6f2] border-r border-[#ddd8ce]`
- Inputs: `bg-[#f8f6f2] border border-[#ddd8ce] rounded-[8px] px-3 py-2 text-xs text-[#444] focus:border-[#1a1a1a]`
- Primary button: `bg-[#1a1a1a] text-white rounded-[8px] px-4 py-[10px] text-xs font-semibold`
- Outline button: `bg-transparent border border-[#ddd8ce] text-[#444] rounded-[8px]`
- Labels: `text-[10px] uppercase tracking-[.06em] text-[#999]`
- Headings: `font-serif font-light` (Georgia)
- Metric number: `font-serif font-light text-[22px]`
- Pills: green `bg-[#e4f0da] text-[#2a5c0a]`, blue `bg-[#dceef8] text-[#0c3d70]`, amber `bg-[#faeeda] text-[#7a4800]`, red `bg-[#fde4e4] text-[#8a1a1a]`, purple `bg-[#f0e8ff] text-[#4a0e8f]`
- Text primary: `text-[#1a1a1a]`
- Text muted: `text-[#888]`

## Test Data (in DB)

**Host: Anna Banana** (udy.bar.yosef@gmail.com) — is_exempt (admin account, hidden from the host list by default, excluded from MRR). Owns:
- **Sweet home** — id: `d9614d11-d573-4ff0-961a-54c5ea37c2bd`, Etu Töölö Helsinki, token: `ARR-SWEET1`. House rules AI-polished. Also has a permanent manual active booking token `ARR-EVT777` (check_in current_date−1 → +3) for testing the live active guest page (Explore/events/chat). Street address Runeberginkatu 17 — now surfaced by the chatbot for verified guests. **`ARR-EVT777` dates were rolled forward this session (Jun 29 2026) to check_in 2026-06-28 → check_out 2026-07-04 (it had lapsed at its 29 Jun cutoff) — KEEP-PERMANENTLY fixture; re-roll the dates if it lapses again.** **Its Airbnb reservations are now NAMED via the CSV import (Jun 27 2026): Carla 26–28 Jun (live) / Max 1–2 Sep / Momone 15–17 Sep / Rachel 29–30 Sep / Nina 2–3 Oct / Hannah 22–23 Nov — KEEP.** **Their references are now `ARR-` tokens, not raw UIDs (token backfill, Jun 27 2026): Carla = `ARR-BB4E3E`; Max/Momone/Rachel/Nina/Hannah likewise re-keyed — guest NAMES preserved, only the reference changed from `…@airbnb.com` to `ARR-`. KEEP.** PAST Airbnb rows were **restored to `status='confirmed'`** by the cancel-guard one-off restore (only the one genuine 26–28 Jun ghost stays `cancelled`) — KEEP, do NOT delete.
- **Test Apartment 1** — id: `aaaaaaaa-0000-0000-0000-000000000001`, Kallio Helsinki, accent #5a1a2a (Wine)
- **Casa Marco** — `d81e4e89-385a-4886-b461-ba952c78e7f8`, El Born Barcelona, token `ARR-BCN777` (booking 1–5 Jun 2026 ended → thank-you state, guest "Marco").
- **Maison Lumiere** — `d7f47672-fde5-4da1-91ae-0f9f774732fd`, Le Marais Paris, token `ARR-PAR777` (booking 3–12 Jun 2026 ongoing → active page, guest "Sophie"; has WiFi + rules + private check-in door code 4521).

**Host: Udyni** (udy.baryosef@jchelsinki.fi) — host id `11b5b459…` (billing-test host). Owns:
- **Penthouse in the sky** — id: `9b03a763-3ca6-4d1f-946c-d4e1f977d614`, is_visible=true; extras + guide + polished rules present. Current test booking `ARR-CHAT01` (2026-06-21→2026-06-25, active, guest_id null). (Earlier `ARR-PHTEST`/3 bookings deleted in S17.)

**Host: Anna** (anna.humalainen@gmail.com) — new test host added S11. Owns:
- **Anna Stays** — id: `eab1e358-…`, Vantaa/Hakunila, is_visible=true.
(Earlier test host `eed9860a` fully deleted from DB in S11.)

**Host: TLV properties** (udy@tlv.capital) — id `1d5a3b9c-0a41-4585-898f-5095ed6f2350`, 2 apartments. Live state (verified S19 cont.): subscription_status `active`, no `stripe_subscription_id`. (NOTE: because the sidebar trial widget only renders for status `trial`, TLV is NOT a valid "Add card"/"Manage plan" test row — use a trial host for that. Clean "Add card" row: Yiftach, trial + no sub.)

**Live plan values (confirmed S12, hard gate CLOSED):** Tier 1 €10/cap 2, Tier 2 €15/cap 7, Tier 3 €25/cap 12, Tier 4 €49/unlimited; `app_settings.trial_days` = 14. These are the official base values — do not change without explicit decision.

**Test guest URL (Test Apartment 1):** `/guest?apt=aaaaaaaa-0000-0000-0000-000000000001&token=ARR-TEST01`

**Pending badge test-data cleanup:**
- 2 seeded unread guest messages — DELETE after badge testing:
  - `7cabced9-4c1e-4607-a00d-3deb755ccdb4` (ARR-TEST01, booking cccccccc-…-0001)
  - `3cfa4dc7-b72c-4a39-976c-669355fc14f0` (ARR-SWEET1, booking f803d95e-…)
- Date reverts pending: ARR-SWEET1 check_out → 2026-06-02; ARR-TEST01 → original 27–31 May (or delete).
- 3 guest push subs on ARR-SWEET1 (booking f803d95e) from push testing — old phone `fxoFeLto…`, new-phone tab `dPjCzkTFG…`, new-phone installed app `emdrm-rTQYM…`; decide whether to prune.

**FIXTURE STATE AS OF 18 Aug 2026 (seeded by the 79-test campaign — dates go stale fast):**
- **Ten `ARR-***001` manual bookings seeded 18 Aug across all ten apartments, dates 17-21 Aug.**
  **STALE AFTER 21 Aug 2026 — refresh the dates before reusing them**, per the standing
  refresh-don't-exempt rule.
- **Sweet home:** Elena `ARR-SWE001` moved to the PAST (13-17 Aug). Noa `ARR-NOA001` 17-21 Aug is
  **CANCELLED** — it is the C8 test subject and the fixture for the cancelled-conversation rule, so
  do not "clean it up". `ARR-BV2CVB` is cancelled; `ARR-3NV432` is the `airbnb_block` 16-21 Aug.
- **Casa Marco:** Futura `ARR-FUT001` 23-26 Aug = the **pre-arrival fixture** (future-dated valid
  token → public tier).
- **Test Apartment 1 is DELIBERATELY geocoded to Vantaa** — a side effect of running D9 from the
  exempt admin account, KEPT AS A FIXTURE. **This is not drift; do not "correct" it.**
- **Roy's `property_cap_override` was set to 2 for D8 and REVERTED to null** — verified reverted.
- **Welcome codes:** Sweet home `XJ8SSKFH`, Casa Marco `962SM37Y`, Penthouse `3RV23Y2C`.

**Billing-test host rows rot fast — VERIFY AGAINST LIVE DB, never trust this list.** Checked
11 Aug 2026: Roy `3b11235b`, Yaron `06eb554e`, Udyn `11b5b459` and Yiftach `6dbfbda4` are ALL
`active` with live subscriptions — four of five prior descriptions were wrong, and Yiftach was
named here as the clean "no subscription / Add card" row when he now has one. Also undocumented:
host **Shay** (`udy.bar.yosef+demo@gmail.com`, demo, trial). **Fixtures survive retention by
DATE-REFRESHING, never by exemption** — an exemption makes the privacy notice false. Refreshed
11 Aug: `ARR-EVT777` and `ARR-PAR777` to current-1/current+3, `ARR-BCN777` to current-6/current-2
(thank-you state).

---

## Known notes / minor debt
- Cron sequential loops in `cron-sync-ical` AND `cron-refresh-events` share the "batch at scale / maxDuration" debt — fine at current apartment counts; batch before many booked apartments. (Phase G cron-batching item.) **⚠ NO LONGER "fine at current counts" FOR `cron-refresh-events` (Aug 6 2026): at B3.3+ prompt sizes its `mapPool` concurrency of 2 EXCEEDS the Groq org TPM ceiling deterministically (2 x ~7.6k debit, measured Aug 10, against what was then 12K TPM — **the ceiling is now 8,000 TPM, VERIFIED 17-18 Aug 2026, so the margin is TIGHTER not looser and concurrency 1 is the only width that fits**), so a multi-candidate run is expected to 429 AND starves guest-chat / guide / daily-greeting across every tenant while it runs. Fix is `concurrency: 1`, and it is the top of this debt — see "SESSION CLOSE Aug 6 2026" open item 1.**
- `city-events` lazy-fill: the FIRST guest to view an uncached apartment waits ~the generation time (one-off); the cron pre-warms apartments with current/upcoming bookings so most are already warm.
- **`cron-refresh-events` schedule vs Gemini quota-day — CLOSED (`dbfc034`, Jul 28 2026).** Both Gemini crons rescheduled off the tail of the free-tier quota day: `cron-refresh-events` `0 4 * * *` → **`0 9 * * *`**; `cron-refresh-guides` `0 3 1 * *` → **`0 10 1 * *`** (verified via source that it calls Gemini through `generateGuideForApartment` → `api/_lib/guide.ts`). Key isolation confirmed at the same time: events reads `GEMINI_API_KEY_EVENTS || GEMINI_API_KEY`, guides reads `GEMINI_API_KEY_GUIDES || GEMINI_API_KEY` — each a separate AI Studio project with its own daily quota, so neither reschedule is neutralised by key-sharing. **HONEST FRAMING:** the Jun 25 incident was already mitigated a month earlier by the dedicated events key (`acd16f4`); this reschedule is defence-in-depth for events, and the FIRST timing protection for guides. code-reviewer PASS (0 must-fix); vercel.json only, 2 changed lines, both schedule strings. Original entry follows for history: The events cron runs `0 4 * * *` (04:00 UTC ≈ 21:00 Pacific) — the TAIL of Gemini's free-tier quota-day (free-tier daily limits reset ~midnight Pacific ≈ 07:00–08:00 UTC). On 2026-06-25 this run 429'd every candidate apartment and fired the ntfy "all event refreshes failed" alert because city-events was still on the SHARED `GEMINI_API_KEY`, whose daily quota was exhausted. Mitigated by the dedicated `GEMINI_API_KEY_EVENTS` (`acd16f4`) giving the events surface its own daily quota. **Not yet done (Udy deferred):** reschedule `cron-refresh-events` from `0 4 * * *` → `0 9 * * *` in `vercel.json` so the run lands just AFTER the Pacific reset — the dedicated key lowers recurrence risk, the reschedule mostly removes it. NOTE: the cron itself behaved correctly that day (returned 200, left cache rows intact / stale-safe; the alert only fires when `refreshed === 0`). VERIFICATION PENDING: the next 04:00 UTC run is the passive test — no ntfy alert = the dedicated key worked.
- Re-saving house rules re-polishes already-polished text (Gemini call on every save). Minor; acceptable for now.
- iCal fetch (`api/_lib/ical.ts`, used by both sync-ical and cron-sync-ical): mild SSRF (no
  private-IP/metadata blocklist on fetched URLs); no per-host rate limit. The monthly cron now
  exercises this unattended. Tidy SSRF + rate limit before public launch.
- `sendPushToHost` url check uses `startsWith('/')`, which also admits protocol-relative `//host` — only ever set from the host's own send-push request (self-targeted), so negligible.
- send-push `apartmentId` is not ownership-checked — latent only (lookup forces `host_id = userId`, so a foreign apartmentId matches zero rows).
- `api/guest-chat.ts` (S21): verify-gated (public tier → `403 verify_required` before any Gemini call) + per-instance rate limiter (15/min, apt+IP) + dedicated `GEMINI_API_KEY_CHAT`. The limiter is per-instance best-effort, not a hard cross-instance cap. `generate-guide` remains host-auth+ownership-gated (no public AI-spend surface).
- **Retention crons SHIPPED (11 Aug 2026)** — `cron-cleanup-messages` (30d) and `cron-retention` (guest identities 30d, greetings 30d, guest push 7d, admin audit 365d). **The periods are a PUBLISHED PROMISE** in the guest notice §6 and in the Art. 30 record: change a constant and the document in the SAME commit, or neither. **No exemptions, ever** — a carve-out makes the notice false for everyone; fixtures survive by refreshing their DATES.
- sw.js `showNotification().then()` — if showNotification rejects, badge is not set and the rejection is swallowed by `event.waitUntil`; low risk, standard SW pattern (W2, `c294bda`).
- `countUnread` in `Layout.tsx` called directly from event listeners with no mounted guard at call site — safe because `mounted` flag is closed over and listeners are removed on cleanup before it matters; no real bug (W3, `c294bda`).
- `BookingManager.tsx` `arrivly:messages-read` handler calls `loadBookings()` without a cancellation signal — tiny stale-overwrite race on rapid apartment switching; fold into next BookingManager change.
- `api/public-pricing.ts` cache is `s-maxage=60` — admin trial/price edits show on the landing within ~1 min.
- **8 npm vulnerabilities (2 moderate, 6 high) — UNTRIAGED; dev-time vs shipped is unknown.** `npm audit fix` NOT run, because it touches the lockfile and every commit it could have ridden on was scoped elsewhere. **Triage before the pentest gate.** (Supersedes the earlier 7-total measurement; the counting difference between `npm audit` and GitHub's alert list is already recorded under DEPENDENCY VULNS.)
- **Redundant root `as any` in `api/stripe-webhook.ts` blunts a compile-error canary.** `types/Subscriptions.d.ts` declares `current_period_end` on the root, so that read compiles uncast; the cast's only effect is to SUPPRESS the error a Basil-typed SDK bump would raise there — the exact migration signal `api/_lib/stripe.ts` preserves and tells you not to cast away. **One-token removal, no runtime effect** — take it on the next non-comment edit to that block.
- **First real `invoice.payment_succeeded` after `7f3dac5` is worth watching in the Vercel logs.** That path has NEVER executed on this endpoint (the pre-Basil field read resolved null and returned 200), so nothing downstream of the id extraction has run here. Specifically check it resolves the CURRENT subscription, not a superseded one — see the `sub.id` item under Tracked security follow-ups.
- **`app_settings.trial_days` is 14; the original project brief says 30.** The brief is STALE — code and UI agree on 14, and 14 is the confirmed live plan value. Recorded so the discrepancy is not "discovered" again and fixed in the wrong direction.

### Tracked security follow-ups (S19; updated S24)
- **STILL OPEN — leaked-password protection disabled** (Auth dashboard HaveIBeenPwned toggle; pending).
- **STILL OPEN — `api/guest-state.ts` rate limiter is per-instance best-effort** (serverless memory not shared) — a shared-store / Vercel-firewall limiter is a later option.
- **STILL OPEN — QR key rotation:** a leaked per-apartment key is revocable only by rotating `apartment_qr_secrets.qr_secret`, which invalidates every printed QR for that apartment (no per-guest revocation).
- **STILL OPEN (by-design, INFO):** the 4 RLS-on/zero-policy service-role tables (`admin_audit`, `apartment_qr_secrets`, `app_settings`, `city_events_cache`) and the intentional anon `guest_host_card` EXECUTE remain as advisor INFO/WARN — accepted by design.
- **STILL OPEN — no `sub.id === hostRow.stripe_subscription_id` check before the `hosts` update** in `api/stripe-webhook.ts` (~line 272). Host state is last-writer-wins from ANY Arrivly-metadata subscription carrying that `host_id`. **THIS IS THE MECHANISM BEHIND THE 9 AUG INCIDENT** (a superseded subscription renewed and flipped a host `expired` → `active`). Currently UNREACHABLE — the duplicate-subscription guard blocks new duplicates and the existing ones are cancelled — so this is latent, not live. Close it with a `sub.id` equality check or an explicit newest-wins rule.
- **STILL OPEN — `DELETE` granted to `anon` and `authenticated` on `hosts` with NO delete policy.** Blocked by RLS, so not exploitable today, but it is **the same shape as the INSERT grant that was revoked on 10 Aug, with a far larger blast radius** — a delete cascades to apartments, bookings and picks. Found 10 Aug 2026 and deliberately left untouched (a table-level revoke on a live billing table, at a session close, is the wrong moment). Same lesson applies: revoke at the level the grant was made.

---

## Lessons / learnings

- **BUDGET PARITY COVERS RETRIES AND TIMEOUTS. IT NEVER COVERS TOKEN COUNTS (Aug 18 2026).**
  `_lib/greeting.ts` passed `maxTokens: 128` to Groq because the Gemini branch beside it used
  `maxOutputTokens: 128` — but that branch also sets `thinkingConfig: { thinkingBudget: 0 }`. **THE
  NUMBER WAS INHERITED AND THE CONDITION WAS NOT.** On gpt-oss, reasoning is billed INSIDE
  `completion_tokens`, so thinking and answering share one allowance; the first production run
  measured **156 reasoning tokens**, which alone exceeds 128. **A token budget is sized per
  provider from that provider's token semantics — parity applies only to attempt count and
  per-attempt timeout, which is what makes one counter unit cost the same on both paths.**
  **AND THE FAILURE IS SILENT:** `groqGenerate` returns `content ?? ''` on a **200**, so a
  reasoning-starved call yields an empty string with **no throw** — `withRetry` never fires and
  retries cannot help. Only the budget can, and only a log can reveal it (which is why the empty
  path had to gain a `console.error` in the same commit).

- **SECURITY DEFINER MAKES `current_user` THE FUNCTION OWNER, SO ANY GATE THAT INSPECTS ITS CALLER
  MUST BE INVOKER RIGHTS (Aug 14 2026).** The first version of `enforce_property_address_swap()`
  was SECURITY DEFINER and carried a `service_role` exemption. Under DEFINER, `current_user` is the
  OWNER on every call, so that exemption matched **EVERY** call and **the gate was completely
  inert** — it looked correct, it ran without error, and it blocked nothing. **READING THE FUNCTION
  DID NOT CATCH IT; only a behaviour test did** — one that tried a blocked swap as an ordinary host
  and observed that it succeeded. **Rule: DEFINER is for functions that need to ACT beyond the
  caller's rights; INVOKER is for functions that need to JUDGE the caller.** A function doing both
  is a design error. Any exemption keyed on `current_user`, `session_user`, `auth.uid()` or a role
  check must be proved by a behaviour test from each side of the boundary — never by inspection.

- **REVOKE ... FROM PUBLIC IS A SILENT NO-OP WHEN THE GRANT IS HELD BY NAME — AND THE CONVERSE IS
  ALSO TRUE. BOTH DIRECTIONS HAVE NOW BITTEN (Aug 14 2026).** This file already recorded that
  `REVOKE ... FROM PUBLIC` cannot remove a grant `anon`/`authenticated` hold BY NAME (the entry
  below), and separately that `REVOKE ... FROM anon, authenticated` cannot remove one inherited via
  PUBLIC. **They are one rule: a REVOKE only removes the grant at the level it was made, and you
  cannot tell which level that was without looking.** Neither the statement succeeding nor the
  wording looking right is evidence. **ALWAYS verify from `pg_proc.proacl` / `relacl` /
  `has_function_privilege` AFTER the revoke**, and diff against a known-good object.

- **TEST FIXTURES THAT COMMIT MID-SESSION INVERT LATER TEST RESULTS (Aug 14 2026).** Behaviour-
  testing the address-swap gate MUTATED the fixtures it was testing with, so a later case ran
  against state an earlier case had written and produced the opposite verdict — the gate looked
  broken when it was the baseline that had moved. **Restore from a known baseline before re-running
  a case, and RE-MEASURE rather than reusing a number from earlier in the same session.** This is
  the same failure as the recorded re-measure rule, one layer down: there the stale thing was a
  count, here it was the fixture the count described.

- **`CRON_SECRET` IS FLAGGED SENSITIVE IN VERCEL, SO MANUAL CRON INVOCATION IS IMPOSSIBLE — STOP
  PLANNING IT (Aug 14 2026).** Its value cannot be read back: not in the dashboard, and
  `vercel env pull` writes `CRON_SECRET=""`. The `Authorization: Bearer <CRON_SECRET>` header a
  cron guard requires therefore **cannot be reconstructed without rotating the secret**, which
  invalidates the running crons until the redeploy lands. **TWO SESSIONS HAVE NOW PLANNED "trigger
  it by hand" AS A VERIFICATION STEP** — for the guide cron and for `api/backfill-canonical-city` —
  and it was never available either time. **Either stop proposing manual invocation and verify
  crons from their RUNTIME LOGS, or take the deliberate decision to unset Sensitive on this one
  variable.** Both are defensible; drifting into planning it a third time is not.

- **THE REPO IS PUBLIC, AND HAS BEEN SINCE IT WAS CREATED ON 5 JUNE 2026 — VERIFIED AT SOURCE,
  NOT BELIEVED (Aug 14 2026).** GitHub API: `"private": false`, `"visibility": "public"`,
  `created_at 2026-06-05`. **Nothing is exposed** — no secret has ever been committed, server-side
  keys have no `VITE_` prefix and live only in Vercel, and `.gitignore` carries five `.env` ignore
  patterns. **The lesson is about the CLASS of claim:** repo visibility is an environment fact that
  no build, test or gate ever checks, so a wrong belief about it can persist indefinitely and
  silently mis-price every decision about what may be written down. **Check it at the API when it
  matters; never carry it forward from a note.** Same class as "the guide cron has never run and is
  structurally unable to" — plausible, load-bearing, and wrong for want of one lookup.

- **A REVOKE MUST NAME THE ROLES THAT HOLD THE GRANT, AND THE CATALOG MUST CONFIRM IT.** Supabase default privileges grant EXECUTE to `anon` and `authenticated` BY NAME on every new function in `public`, so `REVOKE ... FROM PUBLIC` is a SILENT NO-OP against them. Four new SECURITY DEFINER retention functions shipped with `anon` holding EXECUTE — and SECURITY DEFINER bypasses RLS, so any holder of the public anon key could have called `cleanup_guest_identities(0)` and erased every guest name. Caught only by querying `pg_proc.proacl` afterwards. **Same class as the column-vs-table REVOKE trap already recorded here, and that record did not prevent it.** Always revoke from `anon, authenticated` explicitly and diff the ACL against a known-good function.

- **A QUALIFIER BELONGS INSIDE THE CLAIM STRING, NOT IN THE PROSE AROUND IT (Aug 11 2026).** `Landing.tsx` scopes its hero earnings figures with a 15px parent that precedes them in DOM order; `AuthShell`'s DOM order is reversed, so the claim was made **self-qualifying** instead — "and on Portfolio, you earn", qualifier and claim in the SAME text node at the same font size. **Prominence parity then holds by construction and cannot decouple under a later CSS change**, which a parent-prose or caption qualifier can. Prefer this form for any quantified claim. Corollary from the same commit: fixing the shared `AUTH_POINTS` default covered all **five** AuthShell render surfaces (Login, Signup, ResetPassword, Demo, CompleteProfile); a per-caller fix would have left four stale.

- **WHEN A FACT LIVES IN N PLACES, ENUMERATE THE SITES — DO NOT GREP FOR A PHRASING.** Grep finds the copies you wrote and misses the ones you didn't. Failed FOUR times in two sessions: three partial Gemini key maps; "messages 90 days" missed by three search variants; a table row containing neither the number nor the searched phrase; and `RETENTION CRONS` skipped by a `[Rr]etention` search because it was uppercase. **Three of four table rows updated is the signature.** List the assertion sites first, tick each individually.

- **RE-MEASURE AT THE MOMENT YOU STATE A NUMBER, especially about an irreversible delete.** Estimates missed by +234, then -14,500, then quoted "~34 messages" when the true figure was 29 — stale because a fixture date-refresh performed EARLIER IN THE SAME SESSION had moved bookings back inside the window. A figure measured before your own change does not describe the state you are describing.

- **Supabase Storage rejects the host's gotrue user JWT on this project.** Never upload with an anon/host session — mint a server-side signed upload URL via `api/create-upload-url.ts` (service-role) and use `uploadToSignedUrl`. Also lifts the Vercel 4.5 MB body limit. Evidence in docs/learnings.md.

- **Record the RLS policy PREDICATE, never the app's query.** The app's `.eq()` is a convention; the predicate is the boundary. Describing policies by app behaviour is what hid a cross-tenant leak through a full security audit.

- **When a resource becomes SHARED between tenants, re-classify every input that reaches it** — not only the one that selects it. Locking the routing key does nothing if the payload is built from unlocked fields.

- **A spec defect is still a defect.** Four of the last defects the gates caught were in the prompt's own spec, not the code — a bound handed to a parser is part of the parser; a detector suppressed on a bucket correlated with the fault is silenced exactly when it matters. Derive numbers from the concurrency model, and assert that the control you are NOT testing let the write through.

- **anon/authenticated hold blanket TRUNCATE/TRIGGER/REFERENCES on every new table, and
  TRUNCATE BYPASSES RLS (Jul 28 2026).** The `experience_clicks` hardening set this right on
  one table and was never backfilled to the rest. Now revoked everywhere. **Apply to every
  new table** — same class as the PUBLIC-grant trap below: check the live ACL, don't assume
  the default is safe.

- **Supabase default privileges auto-grant EXECUTE to anon+authenticated on every new public
  function.** A SECURITY DEFINER *writer* (e.g. `reconcile_ical_bookings`) MUST
  `REVOKE EXECUTE … FROM anon, authenticated, public` — confirm with `has_function_privilege`
  (anon=false, authenticated=false, service_role=true). Otherwise any anon/authenticated caller
  can invoke a service-role write path.

- **iCal reconcile invariants (`reconcile_ical_bookings`).** Airbnb iCal carries **no guest
  names** and exports **only current+future events** (past events age out of the feed → soft-
  cancelled). On UPDATE the RPC **never writes `guest_id`/`reference_number`** (so CSV-attached
  names survive every sync); the soft-cancel is **empty-feed-guarded** (`cardinality(uids)>0`)
  and **scoped to the `(source, source_block)` family**, and runs **only for a fully-fetched
  feed** (a source with any failed fetch is skipped). New feed rows get a clean `ARR-` token;
  `bookings.ical_uid` holds the raw feed UID as the match key; `BookingManager` shows
  `reference_number` only when it starts with `ARR-` (drops ugly raw `…@airbnb.com` UIDs).

- **`apartments.ical_urls` is a single newline-delimited TEXT column** (one URL per line) — NOT a
  `text[]`, and there is no `airbnb_ical_url` column. iCal management lives in the property
  editor's **Calendars** tab (`?tab=calendars` deep-link); the old BookingManager sync card was
  removed.

- **Calendar/date math must use device-LOCAL `YYYY-MM-DD`, not `toISOString()`.** `new Date(y,m,d)`
  is local midnight; `.toISOString()` then converts to UTC and shifts the day back for every
  positive-UTC host (Helsinki/Barcelona/Paris — the whole market). Build the string from local
  `y/m/d` parts to match how `check_in`/`check_out` are stored and compared.

- **gemini-2.5-flash thinking is ON by default** and consumes the output token budget, returning
  empty text on large/JSON generations. Always set `thinkingConfig: { thinkingBudget: 0 }`.
  Working pattern: `responseMimeType: 'application/json'` + `thinkingBudget: 0` + JSON shape in
  the prompt + defensive parse. Do NOT use `responseJsonSchema` (unreliable with thinking off).

- **`public/sw.js` must NEVER cache cross-origin requests.** Guard at the top of the `fetch`
  handler: `if (url.origin !== self.location.origin) return`. Returning without calling
  `event.respondWith` passes the request to the browser natively — no caching, no interception.
  Bump `CACHE_NAME` on EVERY `sw.js` change so the activate handler purges stale caches. Current value: `'arrivly-v4'` (bumped in `c294bda`).

- **`vercel.json` `functions{}`: never list a specific file pattern alongside the `api/**/*.ts`
  glob** — Vercel rejects overlapping patterns and the build fails. Use one glob, raise its
  `maxDuration`.

- **Guest-facing AI context is gated server-side, never client-side.** `api/guest-chat.ts`
  takes only `{ apartmentId, token }` from the browser; the server resolves the access tier
  (`api/_lib/guest-access.ts`) and filters private `apartment_details` before building the
  prompt, so a public caller can't obtain private rows by tampering with client state. Keep the
  tier/context logic in that one file so the Tier-2 upgrade is additive (new tiers,
  email+reference) with no change to the endpoint or the chatbot UI. Grounded chat (googleSearch)
  cannot use `responseMimeType` — return plain text and strip `**`.


- **api/ relative imports MUST end in `.js`** (e.g. `./_lib/push.js`, `./_lib/ical.js`,
  `./_lib/cron.js`). `package.json` `"type":"module"` makes Vercel run every api/ function as
  native Node ESM; extensionless imports compile fine (`tsc` uses bundler moduleResolution and
  `vite build` only builds the frontend — neither runs api/ through Node's ESM resolver) but
  throw `ERR_MODULE_NOT_FOUND` at Lambda startup. `tsc` maps `.js` specifiers back to `.ts`
  source at build time, so the fix is zero-friction. Imports from node_modules are unaffected.

- **Host push subscriptions are stored account-level (`apartment_id = NULL`).** Always call
  `sendPushToHost(db, hostId, payload)` without the optional `apartmentId` argument when
  notifying the host. Passing one narrows the subscription lookup to zero rows and delivers
  nothing silently.

- **Host app-icon badge is numeric and owned by `Layout.tsx`** (`navigator.setAppBadge(count)`). It updates only while the dashboard app is open — the SW deliberately does NOT badge host (/dashboard) pushes, so a closed dashboard icon lags until reopened. The in-app sidebar count pill is the live indicator.

- **Guest badge is DOT-ONLY** (`setAppBadge()` — no arg), set by SW on /guest push, cleared on page open. Persists until next open if the notification is dismissed without tapping. All Badging API calls are guarded (`'setAppBadge' in navigator / self.navigator`) — silent no-op on unsupported platforms.

- **Guest web push is PER-CONTEXT.** A browser tab and the installed WebAPK each hold their OWN push subscription (separate FCM endpoints — verified in `push_subscriptions`). Enabling notifications in a tab does NOT carry into the installed app, and vice-versa; the guest must enable push in the context they actually use. UX implication: in a tab offer **Install the app**; in the installed app offer **Turn on notifications**.


- **`src/lib/api.ts` already prefixes `BASE = '/api'`** — callers must pass the path **without** a leading `/api` (e.g. `api.post('/send-welcome')`). Passing `/api/send-welcome` produces `/api/api/send-welcome` (404) — silently swallowed by a `.catch(() => {})`. Always check the helper before writing a new call.

- **A Vercel environment-variable change only takes effect after a redeploy.** Adding or rotating a secret in the Vercel dashboard does not hot-reload running functions. Trigger a redeploy (push a commit, or use the Vercel dashboard "Redeploy" button) immediately after any env-var change and confirm the new deployment is READY before testing.

- **Stripe Basil API (2025-03-31) moved `current_period_end` off the subscription root onto `sub.items.data[0]`**. Read item-level with a root fallback: `(sub.items?.data?.[0] as any)?.current_period_end ?? (sub as any).current_period_end ?? null`. Use `as any` casts deliberately — the installed Stripe SDK types and the account's runtime API version differ.

- **Stripe webhooks on Vercel require a raw body stream.** Set `export const config = { api: { bodyParser: false } }` and read the body manually with a stream-to-Buffer collector. `webhooks.constructEvent()` rejects any pre-parsed body.

- **Subscribing via Stripe Checkout starts the subscription in `trialing` status, not `active`.** `subscription_status` stays `'trial'` (not `'active'`) until the trial converts at the trial end date. This is expected — not a webhook bug. The `BillingPanel` trial banner is driven by `trial_ends_at` from the DB, not by `subscription_status`.

- **Gemini throws transient 5xx errors intermittently.** Wrap all `ai.models.generateContent()` calls with `withRetry` (`api/_lib/retry.ts`). Size the per-attempt AbortController timeout and retry count to fit within the function's `maxDuration` (e.g. 3 × 10s for rewrite-rules, 2 × 20s for guide).

- **Stripe subscription schedule `iterations:1` with a historical `start_date` applies the new price immediately.** When creating a deferred switch from an existing schedule (`from_subscription`), the schedule already has `phases[0]` with `start_date` = current period start (historical) and `end_date` = current period end (the real billing boundary). Always rebuild the phase using `schedule.phases[0].start_date` + `schedule.phases[0].end_date` explicitly. Never use `iterations` — it counts forward from `start_date`, which is in the past, so the phase is instantly over. If `p0.end_date` is absent (shouldn't happen on a real schedule), fall back to `sub.items.data[0].current_period_end`, then `now + 30d` with a warn log.

- **`api/cancel-subscription.ts` release-then-cancel (S15, replaces the old 409 guard).** If a subscription schedule is attached, RELEASE it first (`subscriptionSchedules.release`) and clear `pending_tier`, THEN set `cancel_at_period_end`. Releasing before the cancel flag is mandatory — a live schedule and `cancel_at_period_end` on the same period end produce undefined Stripe behaviour. The host no longer has to undo a pending change before cancelling; the cancellation email notes the scheduled change was also cancelled when one existed.

- **`api.post` / `api.get` throw `new Error(rawResponseText)` on non-2xx.** To extract a typed error code in a component: `JSON.parse(err.message)?.error`. This is the only safe pattern — the error body may not be valid JSON (network errors, Vercel 5xx HTML), so always wrap in try/catch with a JSON.parse guard.

- **Guests have no auth session — `src/lib/api.ts` attaches the logged-in Bearer.** Guest-page calls to token-gated endpoints (e.g. `api/guest-details`, `api/guest-message`) must use plain `fetch()`, NOT `api.get()` / `api.post()`. Using `api.get` from a guest page would send a null/empty Bearer header — the endpoint would behave differently from its intended unauthenticated path.

- **Anything the guest page must show from `is_private=true` rows needs a server endpoint with the booking token as the credential.** Anon RLS on `apartment_details` blocks private rows at the DB layer (`apt_details_guest_read USING (is_private = false)`), so client-side filtering after an anon query can never surface them — the rows simply aren't in the HTTP response. The only safe pattern is a token-verified server endpoint (using `resolveGuestAccess`) that calls the service-role client and returns only the private rows for the verified booking.

- **LocationIQ geocoding (S19).** `api/_lib/geo.ts` uses the EU endpoint `eu1.locationiq.com/v1/search?key=…&q=…&format=json&limit=1`. The response is a JSON ARRAY; lat/lon come back as STRINGS and the longitude field is `"lon"` (NOT `"lng"`) — parse with `Number()` + `Number.isFinite` guards on both. The key sits in the URL, so the function must stay SILENT (no logging on any path). Free tier ≈ 2 req/sec; the module-level rate gate spaces request START times ≥550ms so concurrent fan-out callers (guide, host-picks) throttle automatically with no caller changes. Best-effort, never throws, returns null on every failure.

- **Guest booking-state is resolved server-side via `api/guest-state.ts` (S19), never by reading `bookings`/`guests` from the client.** The anon `bookings_guest_read` policy is gone. GuestPage calls `/api/guest-state` (plain fetch — guests have no auth session) in two stages: token path, then a KEYED date path gated by the per-apartment `apartment_qr_secrets.qr_secret` carried in the QR URL as `?key=`. An apt-only URL with no token and no valid key resolves to the neutral page by design. Every non-active outcome returns an identical flat neutral body so the endpoint leaks nothing.

- **Stripe secret key and webhook secret MUST point at the same Stripe environment.** A mismatch passes `constructEvent()` signature verification but fails `subscriptions.retrieve()` → the webhook 500s on every event and the DB never updates (symptom: 500 "subscription retrieve error", not 400). The real env is the sandbox with `cus_UfOVHv9hahCr78` + the Arrivly product's 3 prices. After any Stripe key change, replay one subscription event and confirm webhook 200 AND host-row update.

- **`plans.price_cents` is DISPLAY-ONLY; it does NOT control what Stripe charges.** The charged amount comes from the Stripe Price objects in env `STRIPE_PRICE_TIER_1/2/3` (`api/_lib/stripe.ts`). Editing the DB price only changes what the landing + plan cards SHOW. To change a price for real: (1) create a NEW Stripe Price (immutable), (2) update `STRIPE_PRICE_TIER_n` in Vercel + redeploy, (3) update `plans.price_cents` for display — Stripe first/together. Existing subscribers stay on the old price unless migrated. `app_settings.trial_days` needs NO Stripe action (trial applied per-sub at creation via `trial_end`; new signups only). Tier 4 has no Stripe price env; `create-subscription` returns `booking_tier_unavailable`.

- **Stripe `metadata.app` check is case-sensitive.** The webhook ignores any subscription whose `metadata.app !== 'arrivly'` (exact lowercase) with a silent 200. Test/clock subs need `metadata.app = arrivly` AND `metadata.host_id = <uuid>`.

- **Signup does NOT create a Stripe subscription.** `Signup.tsx` only fires `/send-welcome`. A subscription exists only after a completed Checkout (`create-subscription`). Subscribing during the trial carries the remaining trial via `trial_end` → status stays `'trial'` (no charge) until the trial date, then converts to active.

- **Logged-out landing reads DB values via a service-role endpoint, not RLS.** anon can't read `plans` or `app_settings`; expose only marketing-safe fields through `api/public-pricing.ts` — same pattern as `guest-availability`.

- **Vercel strips `s-maxage`/`stale-while-revalidate` from the browser-facing `Cache-Control`** (edge honours them; client sees only `public`). The authenticated Vercel MCP fetch ALSO bypasses the CDN cache (always MISS) — verify caching from a real browser. A new deploy purges the edge cache. With `s-maxage=60`, admin edits surface on the landing within ~1 min.

- **Public guest-facing AI endpoints are spend-gated by verifying the booking token BEFORE calling the model, not by rate-limiting alone.** `api/guest-chat.ts` (S21) returns `403 verify_required` for the public tier before any Gemini/brand/prompt work, so only a verified in-dates booking can spend tokens — the same gate `daily-greeting` uses. The added per-instance rate limiter (15/60s, keyed apartmentId+IP) is a second layer but BEST-EFFORT: Vercel spreads requests across lambda instances, each with its own in-memory Map, so the 429 can't be observed reliably from outside and is NOT a hard cross-instance cap. Treat verify-gating (not the limiter) as the real spend control.

- **Keep every high-volume or public AI surface on its OWN key/project.** A shared key means one surface exhausting its daily quota takes down the others — this actually happened (25 Jun 2026: the events cron 429'd every apartment on the shared key and fired the "all refreshes failed" alarm; closed by `acd16f4`). The isolation is provider-independent and outlives Gemini. Key table under "ZERO-GOOGLE AI PILOT -> MECHANISM"; the superseded billing-flip and "Groq cannot replace guest-chat" annotations are dropped — both are false under the pilot.

- **Gemini free-tier quota is a DAILY cap; exhausting it surfaces as intermittent guest-facing 500s — not a code bug.** In S21 testing an 18-call burst exhausted the free-tier daily quota; later chats returned Gemini `429 "exceeded your current quota"` (plus transient `503 "high demand"`), surfaced as a 500. The daily cap does NOT reset within a minute, so "wait a moment" is wrong advice for a quota 429. Before blaming app code for guest-chat failures, check the Vercel runtime logs for the upstream Gemini status code; a dedicated/billed key is the fix, not a code change.

- **Windows PowerShell dev-env gotchas (setting Vercel env vars locally).** `npx` can fail with `npx.ps1 cannot be loaded` (unsigned script) — fix once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or call `npx.cmd`. In PowerShell `curl` is an alias for `Invoke-WebRequest` (different flags) — use `curl.exe` for real curl. Inline `-d '{json}'` mangles quotes in PowerShell — write the body to a file and pass `--data "@file"`. A Vercel env-var add needs a redeploy (`npx vercel redeploy <url>`) to take effect. **(Jul 27 2026 addendum)** `npx.ps1` can STILL be blocked under `RemoteSigned` when the file carries the downloaded-from-internet flag — use `npx.cmd` or `Unblock-File`.

- **Vercel "sensitive"-flagged env vars cannot be pulled — `vercel env pull` returns them EMPTY (Jul 27 2026).** So a manual cron trigger that needs `CRON_SECRET` (marked sensitive) is NOT possible from a fresh machine — you cannot reconstruct the `Authorization: Bearer <CRON_SECRET>` header the cron guard requires. **Verify a scheduled cron ran by reading its RUNTIME LOGS (Vercel MCP / dashboard), not by manually curling the endpoint.** Same trap applies to any sensitive secret (Viator/Tiqets keys) — they're write-only once set.

- **When a function's EXECUTE comes from the DEFAULT PUBLIC grant (ACL `=X/owner`), `REVOKE EXECUTE ... FROM anon, authenticated` is a SILENT NO-OP** (S24). Those roles inherit EXECUTE via PUBLIC, not a direct grant, so there is nothing to revoke from them. `REVOKE EXECUTE ... FROM PUBLIC` instead — owner (`postgres`) + `service_role` keep their explicit grants, and trigger functions fire as owner regardless. ALWAYS confirm a function-privilege change against the LIVE ACL (`pg_proc.proacl` / `has_function_privilege`), not just that the statement executed without error. (Same trap applies to table grants via PUBLIC — check `relacl`.)

- **`guests` is server-write-only (`api/create-booking`) with a host-scoped SELECT policy (S24).** Never reintroduce a client-side `guests` insert/read, or a `USING(true)` policy. One guest row per booking; no cross-host first-name dedup. The host-scoped SELECT (`id IN (select b.guest_id from bookings b join apartments a on a.id=b.apartment_id where a.host_id = auth.uid())`) keeps the bookings-list and Messages `guests(...)` embedded joins working because they only ever surface the host's own bookings' guests.

- **`hosts` uses COLUMN-LEVEL UPDATE grants as a defence layer — new columns do NOT inherit them (Stage 4B, Jul 26 2026).** `authenticated` has UPDATE on a specific allowlist of host columns only (brand_name, accent_color, ui_state, …); server-only columns (tier, plan, subscription_status, stripe_*, trial_ends_at, the notice/pending/cancel columns) have UPDATE deliberately withheld. **Any migration adding a host-writable column MUST include an explicit column-scoped `GRANT UPDATE (col) ON public.hosts TO authenticated`** — RLS `hosts_update_own` (`auth.uid()=id`) alone is NOT sufficient because PostgREST also needs the column privilege. Stage 2 missed this for the three `*_partner_id` columns (they were granted SELECT/INSERT but not UPDATE), so the client Connect write silently 403'd; corrective migration **`grant_host_partner_id_column_update`** fixed it (verified: the three partner-id columns writable by `authenticated`; tier/plan/stripe/trial columns still read-only). ALWAYS confirm with `information_schema.column_privileges` after the grant.

- **WORKFLOW — migrations belong to Claude-in-chat via Supabase MCP, NOT to Claude Code mid-build.** In Stage 4B a needed corrective migration was applied by Claude Code during the build. The fix was correct and verified, but the rule is: **if a migration turns out to be needed mid-build, STOP and report back** rather than applying it. Future code prompts must state this explicitly (reader-migration-first sequencing stays a chat-side responsibility).


- **`overflow-auto` DOES NOT MEAN THAT ELEMENT SCROLLS (Aug 12 2026).** An element scrolls only
  if it can be SHORTER than its content. `Layout`'s root is `flex min-h-screen` — a **MINIMUM** —
  so `<main class="flex-1 overflow-auto">` stretches to at least its content height and its
  `scrollTop` is permanently 0. A `<main>`-targeted route scroll-reset SHIPPED and was a silent
  no-op; `window.scrollTo(0, 0)` is correct here. **The tell was in the same file:** a SIBLING
  sidebar with `md:sticky md:top-0` can only pin the way this dashboard actually behaves if the
  DOCUMENT scrolls. Checking that `overflow-auto` is present is not checking who scrolls.

- **`grep -v "^[+-][+-]"` SILENTLY HIDES EVERY CHANGE TO A MARKDOWN BULLET (Aug 10 2026).** That
  filter exists to drop a diff's `---`/`+++` headers. But a removed bullet `- Cron sequential…`
  renders as `-- Cron sequential…` and is swallowed by it. **In a file that is almost entirely
  bullets — this one — that hides almost everything.** Caught only because the RAW `+/-` count was
  16 against a filtered view showing 12. **RAW COUNTS ARE THE RELIABLE CHECK**, and this will
  recur on every future CLAUDE.md edit, so do not re-derive it each time.

> Full narrative evidence for these, and the B3.5 events analysis and greeting-system detail, is in docs/learnings.md.

## Workflow

### CLAUDE.md HOLDS AT MOST ONE SESSION RECORD (standing rule, Aug 7 2026)
At every session close, the PREVIOUS session record moves to `docs/history.md` BEFORE the new one
is written. Never two.

**HOIST RULES, NOT ONLY OPEN ITEMS.** Anything a session invents — a rule, a threshold, a
convention — is born inside that session's record and has no other home unless moved. **Open items
get noticed because they read as unfinished; rules read as settled, which is exactly why they slip
through.** The GATE STOPPING CONDITION was nearly archived one session after adoption.

**This treats the cause, not the symptom.** The file reached **290,660 chars** because session
records were APPEND-ONLY and nothing ever left — the `b9c34d4` split cut it in half, but a split
is a one-off remedy for a process that would simply refill it. Working limit: **150,000 chars.**

`docs/history.md` growing without bound is fine and expected — it is a plain filename, never an
`@import`, so it is read on demand and never loaded into context.

**Move VERBATIM and gate the move on a char-level conservation check** (see `b9c34d4` and
`cca68df` for the shape): hoist any still-live open item or durable lesson OUT first, then move
the rest, leaving a one-line pointer. Check the arithmetic in BOTH directions — a surplus means
duplication, a shortfall means silent loss. That check has already caught a real defect (+5,154,
hoists copied instead of moved).

### Claude in chat vs Claude Code
Claude in chat NEVER pushes to GitHub. All code changes are delivered as Claude Code prompts pasted by Udy (run with `--dangerously-skip-permissions`). Claude uses GitHub/Supabase/Vercel MCPs proactively and reads the current file from GitHub before proposing edits.

### Agent policy
- Append the **code-reviewer** subagent to EVERY code-changing Claude Code prompt — read-only review before commit.
- Run **security-auditor** for any change touching secrets, auth, RLS, or API routes, and before every production deploy.
- **DEPLOY GATE (hard, default = ship):** Claude Code COMMITS AND PUSHES to `origin/master` (which triggers the Vercel deploy) once ALL of: BOTH code-reviewer and security-auditor have completed and PASSED, every must-fix they raise has been applied, AND `npm run build` (tsc -b && vite build) is green. This is a GATE, not a stop — when the gate is satisfied, pushing is the expected default; do not park a clean, reviewed, green change waiting for further permission. Reviewers must complete BEFORE the push (never run them background-non-blocking before pushing). HOLD the push only when: a gate fails / the build is red, OR the prompt EXPLICITLY says "do not deploy" / "hold the push" (used for ordered DB-vs-code changes — e.g. reader-first 2a sequencing where a migration must land before the code that depends on it).
- **Docs-only prompts** (no code, no build) skip build validation and review agents.
- Use **debugger** only when stuck (~20+ min).
- Run **dead-code-cleaner** periodically; it writes a report and waits for approval before removing anything.
- Agents live in `.claude/agents/` and are invoked inside Claude Code by Udy.
- **RE-RUN BOTH GATES ON ANY POST-REVIEW EDIT (Jul 29 2026).** If code is edited AFTER the
  review gates report — including applying a reviewer's own suggestion, and including a
  one-line change — both gates run again before committing. **No exceptions for small
  changes.** A verdict only covers the bytes the reviewer actually read.
- **GATE STOPPING CONDITION (Aug 10 2026).** Once BOTH gates return PASS with zero must-fix, STOP and commit. After a passing verdict the only permitted edits are ones resolving a must-fix; remaining warnings go in the commit message as known residuals. If a gate still returns must-fix after round three, stop and report. **Why:** `90aed01` ran SIX rounds with the code unchanged after round 1 — every later round failed on COMMENT accuracy, two of them on fixes for earlier fixes, and at round 5 the gates DISAGREED about one clause, which is the signal to DELETE it rather than revise again.
- **VERIFY A QUEUE ITEM BEFORE BUILDING FOR IT (Aug 12 2026).** An entry describes the state when it was WRITTEN, not now. On 12 Aug, three of four queued defects were already solved or misdescribed — the guide cron was not overdue, the iCal 504 was already bounded, and the events staleness gate already shipped. Check source and live state first; the cost of checking is a minute and the cost of not checking is a commit that fixes nothing.
- **SWEEP STOPPING CONDITION (Aug 11 2026).** A "find every place X is claimed" sweep runs ONCE, not iteratively. **(1) Enumerate the SURFACE before the first edit — repo-wide, over the VALUE and the VERB, across ALL file types including markdown, JSON and DB-stored copy — and FREEZE the list.** The list does not grow after work starts. **(2) Everything on it ships in ONE commit;** if that is too large, it is a refactor needing a plan, not a sweep. **(3) State the closure test up front** — "when nothing new turns up" is not a test; "every file containing the value or verb has been read and every hit classified" is. **(4) GATE WARNINGS ARE RESIDUALS, NOT WORK ORDERS** — record and batch them; they never start the next commit in the same thread. **(5) Hard cap TWO commits per defect family;** a third needs Udy's explicit approval plus a stated reason the enumeration failed. **(6) If a new site appears after the freeze, STOP AND REPORT — do not patch** — and classify it: INSIDE the set means carelessness, OUTSIDE means the surface was drawn wrong.
  **WHY: gate PASS cannot signal completeness.** A gate inspects only the diff in front of it and is structurally blind to files you did not touch. The Viator copy sweep ran SIX commits because each PASS felt like closure while the next defect sat in an untouched file, and the warnings waved through were the only thread back to it. **Completeness is established BEFORE the work by defining the surface — never after it by asking a reviewer.**
- **COMMENT-ONLY EXEMPTION to the GATE STOPPING CONDITION (Aug 12 2026).** A post-verdict edit that changes ONLY comments or whitespace, with no executable change and a green build, does not re-trigger the gates; record it in the commit message. **Any edit touching an expression, condition, or identifier DOES re-trigger, however small.**
- **A CODE GATE DOES NOT ADJUDICATE PROSE — SPLIT THE COMMIT (Aug 11 2026).** The retention commit passed both gates at round 1, then failed rounds 2 and 3 with **zero executable lines changed**, entirely on documentation accuracy across four files — the `90aed01` failure repeating. When the only remaining must-fix is prose: **commit the gate-verified code, then fix the documents in a separate docs-only commit**, which needs no gates.
- **MATCH THE PROOF TO THE COMMIT TYPE; NEVER CLAIM MORE THAN THE CHECK SUPPORTS.** A **pure move** is provable by EXACT ROUND-TRIP. A **deletion** is NOT — nothing can be substituted back, so the only check is the FORWARD one: locate the durable content in the post-edit file BEFORE removing its source. A **mixed** commit gets neither honestly; split it into a move phase proved against sentinels, then a collapse phase verified forward. State which proof was used, and which was unavailable.
- **PROVIDER REPLIES LIVE IN AN INBOX THIS PROJECT CANNOT SEE.** The connected Gmail is `udy@tlv.capital`; Bemgu correspondence runs through `hello@bemgu.app`, which is NOT connected. **A Gmail search returning nothing means WRONG INBOX, never "no reply."** The Viator ruling sat unread for three sessions because "awaiting reply" was read as current. When a provider answer is pending, ASK UDY — never infer silence from an empty search.
- **STANDING FALSE POSITIVE — `api/welcome.ts` lat/lng.** The security-auditor repeatedly
  reports that `api/welcome.ts` returns `lat`/`lng` even when `welcome_show_address` is
  false. **It does not.** `street`, `street_number`, `lat` and `lng` are all inside the same
  `if (showAddress)` block — verified in source and live. Dismiss it when it recurs.
- **The other standing false positive:** `VITE_`-prefixed env vars read in `api/` routes are
  correct on Vercel (all env vars reach functions regardless of prefix).

### Config rule
Pricing/plan values are DB-driven (`plans` + `app_settings.trial_days`). `config.ts` holds only branding (colour presets) and currency symbol; its pricing fields are legacy stubs — never reintroduce hardcoded tier prices.

### api/ ESM rule (Node runtime)
`package.json` is `"type":"module"`, so Vercel runs every api/ function as native
Node ESM. ALL relative imports inside api/ MUST include the `.js` extension
(e.g. `./_lib/push.js`, `./_lib/ical.js`, `./_lib/cron.js`). Extensionless relative
imports compile fine but throw `ERR_MODULE_NOT_FOUND` at runtime. Imports from
node_modules are unaffected.

---

## PERMANENT PROVIDER CONSTRAINTS (binding — never relax)

Hoisted out of PHASE I so they survive that section being archived. ITEM 2 and ITEM 3 keep their original labels from the PRE-MARKETING terms review; ITEM 3 carries one OPEN action (the Viator name-consent line) — it is not fully closed.

### VIATOR — HOST-OWN-PID IS PROHIBITED (written ruling, 4 Aug 2026)
**Viator Partner Support (Diego) answered the 23 Jul multi-tenant question in writing. Two halves, opposite answers:**
- **PERMITTED, and never questioned: Bemgu's OWN PID (`P00310630`) + `mcid=42383` on Viator links served from `bemgu.app`, on host-BRANDED pages.** Bemgu owns, operates and maintains the domain, so every guest page on it IS Bemgu's "Partner Site". The 31 Jul message states plainly that Viator's affiliate relationship is with Bemgu and payouts issue to Bemgu. **The marketplace and its revenue are unaffected.**
- **PROHIBITED: a HOST's own PID on links served from `bemgu.app`.** Two clauses: **"Partner Site"** is defined in the VPP General Terms as a property *"owned, operated and maintained by you"* (the registered partner); and **Service Terms B-1.5** forbids display of Travel Product Information or Links *"through any website, channel, platform or system other than the Partner Site"*. Hosts do not own bemgu.app, so their PIDs may not ride on links from it.

**CONSEQUENCE — DECIDED BY UDY 11 Aug 2026: Viator is REMOVED from the Tier-3 "connect your own account" feature.** GYG and Tiqets are SEPARATE contracts under separate terms — **do not assume either answer applies to them**; ask both in writing, Tiqets first (it uses the same host-ID substitution path via `partner=`).

**DECIDED 11 Aug 2026 — Viator is a CARVE-OUT, not a tier withdrawal.** GYG and Tiqets keep host-own-ID; Tier 3 keeps its connect-your-own-account promise for those two, and the "Keep 100% of experience commissions" landing claim stays true for them. The Viator clicks column remains in the host Earnings panel with a plain-language line stating Viator commissions go to Bemgu — disclosed, not hidden, because the host can see Viator cards on their own guest page and an unexplained omission reads as concealment.

**Diego's reply is INCOMPLETE:** it promises "the permissible pathways to launch this feature compliantly" and then omits that section entirely. A one-line follow-up asking for it is outstanding and cheap — an agency or partner-network structure could restore the feature later, which is why `hosts.viator_partner_id` is left in place rather than dropped.

### Tiqets licence obligations (permanent — confirmed by email Jul 26 2026)
- **Image credits (clause 9.1c):** image access is **ENABLED + VERIFIED LIVE (Jul 27 2026)** for partner `bemgu-188668`. Confirmed shape from the (now-removed) `[experiences:tiqets:imgdebug]` one-shot log: each `images[]` object carries `{ small, medium, large, extra_large, credits, alt_text }` — the credit field is **`credits`** (string or null; null is valid — a caption renders only when Tiqets provides one, e.g. "Stromma Finland" / "Helsinki Dreamdays Tours" on Sweet home cards). `540d57f` maps `imageCredit` from the selected image's `credits`; `ExperiencesSheet` renders it as a caption — **never strip it.**
- **Cache-freshness floor:** images/product data must refresh at least every **14 days** (Tiqets disclaims liability for stale images). The current 7-day `expires_at` + daily cron satisfies it — **NEVER extend `experiences_cache` TTL beyond 14 days.**
- **Viator constraints still stand (unchanged):** guest pages carrying marketplace content are **noindex**; per-host custom domains would breach Viator's own-domain clause (do NOT offer custom host domains while experiences render on the guest page).

**ITEM 2 (LOCKED ARCHITECTURAL CONSTRAINT — applies now, no action needed).**
**GYG Partner TCs 4.2.2(v)** prohibits the Partner from *"edit, modify, filter, change
the order of, suppress, or replace any part of the GYG Platform Content, including
intermixing data from sources other than GetYourGuide"*.
**Bemgu is COMPLIANT today** only because GYG is link-out ONLY (a city-level link, no
product cards) — the blended Explore list contains Viator + Tiqets content exclusively,
so no GYG content is intermixed.
**PERMANENT RULE: GYG product cards must NEVER be added to the blended Explore list.**
If GYG content is ever displayed, it must live in its own separated, unmixed,
unreordered section. Treat this as locked, alongside the never-cross-sum currency rule.
Related GYG constraints: 4.2.2(i) own-site only; 4.2.2(ii) Partner Platform design must
stay "significantly distinct" from the GYG Platform and GYG content must not be the
primary content; 3.1.4 no scraping / AI extraction (Bemgu uses official APIs — fine);
3.2.2 must disclose the GYG relationship as law requires and must never imply the
Partner Platform is endorsed by or official to GYG.

**ITEM 3 (LOW RISK — fold into the pending Viator email).**
**Viator General Terms 3.6** requires the Partner to *submit to Viator all proposed uses
of its names, logos, marks and/or trademarks* and not publish any such use *without
prior written consent*. The locked "text-only attribution, no logos" decision was
correct, but the clause covers **names**, not just logos — so the word "Viator" in a
card caption technically sits inside it. Add a one-line consent request to the open
Viator thread.
Also from Viator: **B-1.2** — Travel Product Information/Links may not be displayed
through any website/channel/platform other than the Partner Site (independently
CONFIRMS the existing note that per-host custom domains would break Viator); **3.2** —
must display all Travel Product Information provided and may not add to, alter or amend
it; **3.2** — no systematic analysis/extraction of the Viator Marketplace incl. reviews;
**14 (Publicity)** — no press release, advertisement or public statement about the
existence/contents of the Agreement or the parties' relationship without Viator's prior
written consent. **Flag:** the landing page comps table's "3 earning marketplaces"
framing brushes against clause 14 — review the marketing copy against it before launch.

## PHASE I — EXPERIENCE CONNECTORS (Stages 0/4A/4B SHIPPED + verified live, Jul 26 2026; scoped S29, Jul 10 2026)

Phase I part (b) — third-party bookable experiences on the guest-page Explore tab — is **BUILT, SHIPPED and verified live in production** through Stage 4B. This supersedes the loose "Viator/GetYourGuide/OpenTable" line in the Phase I roadmap bullet above. The scoping text below is retained for context; the "Build stages" list carries current status. **Remaining: Stage 5** (marketplace reporting ingest — until then commission figures deliberately link out to each provider dashboard).

> Scope, revenue model, host UX, marketing anchors, open provider threads, credentials/env ops and the full PRE-MARKETING provider-terms review are in docs/phase-i-affiliate.md.


**Link spec — CONFIRMED LIVE for all three providers (per-apartment campaign attribution on EVERY link):**
- **Viator:** `pid` + `mcid=42383` + `medium` (an API-supplied `medium=api` is preserved; `medium=link` stamped only when absent) + `campaign=bemgu-{apartmentId}`.
- **GYG:** `partner_id` + `cmp=bemgu-{apartmentId}` (**`cmp` MANDATORY** — a missing campaign lands in GYG's `no_reseller_campaign` bucket).
- **Tiqets:** `partner` + `tq_campaign=bemgu-{apartmentId}` (surfaces as `campaign_name` in both portal reports and the Reporting API; **CONFIRMED IN WRITING by Tiqets support Jul 27 2026** as the correct per-campaign tracking approach).
- **The link builder (`api/_lib/affiliate-links.ts`) is PARSE-AND-REWRITE (`URLSearchParams.set`), NEVER append.** Provider APIs return **PRE-TAGGED** product URLs (Viator embeds `pid`/`mcid`/`medium=api`; Tiqets embeds `partner`); blindly appending duplicated ids and produced conflicting `medium=api`+`medium=link`. **c-full critical:** a tier-3 host's link carries **ONLY the host's** partner ID — Bemgu's `pid` is REPLACED and Bemgu's `mcid` is **DROPPED** on host-owned Viator links. Covered by a `node:test` suite — **`npm run test:affiliate-links` — keep these assertions green forever** (a dev-only `.ts` resolver hook lets plain-node import the api/ TS; not shipped/imported by runtime).


### DECISION — tier ladder confirmed as-is (Jul 26 2026)
After explicit review, the ladder stays: **Tier 3 (Portfolio) capped at 12 properties; unlimited remains Tier 4's second leg** (alongside the future booking platform). Rationale: keeps T4 sellable BEFORE Phase F ships, and protects pricing power over large property managers; caps can always be **relaxed later, never tightened**. **Marketing MUST always say "up to 12" for Portfolio — NEVER "unlimited".**

## LAUNCH BLOCKERS (ordered — the calendar runs on the first two)
1. **Retention crons — SHIPPED 11 Aug 2026, blocker CLEARED.** `cron-cleanup-messages` (30d) and `cron-retention` (guest identities 30d, greetings 30d, guest push 7d, admin audit 365d) now match the drafted notice §6, so the documents are publishable. **The constraint is permanent even though the blocker is closed:** these periods are a two-sided contract — change a constant and the notice AND the Art. 30 record in the SAME commit, or none of them. **No exemptions, ever.**
2. **Legal review — the only external dependency, so start it earliest.** Four documents DRAFTED and committed under `docs/`, NOT published, NOT in force; **eight of ten inventory gaps open**; a Finnish lawyer must review. Every `[CONFIRM]`/`[BUILD]` marker in those files IS the to-do list — never resolve, tidy, renumber or remove one. Roles are THREE-WAY: Bemgu controller for host data, PROCESSOR for guest data, controller in its own right for logs and anti-abuse.
3. **npm audit triage — and the two recorded counts DISAGREE** (Known notes says 8; OPEN ITEMS says 7 on `d254df9`). Reconcile by running it, not by picking. Precedes the pentest gate.
4. **Pentest / "hacker" agent gate** — runs once on the Tiers 1-3 surface. Phase F needs its own second pass before Tier 4 is sold.
5. **⏰ 6-9 Sept 2026 — the only dated item, and it mails real people.** Confirmed against live DB: five hosts carry sandbox subscriptions, including `anna.humalainen@gmail.com` and `yiftach@xn--gnai-8qa.com`. Each auto-cancels at Stripe's 90-day limit and sends a genuine cancellation email. Doing nothing is a decision that mails them.
6. **Written multi-tenant confirmation from GetYourGuide and Tiqets.** Tier 3 sells "connect your own account" for both. That clearance is currently OUR terms reading, not theirs. Viator ruled NO on the identical question on 4 Aug 2026 after the same self-assessment said probably yes. Selling a tier on an unconfirmed permission is the risk; asking costs one email each.
7. **Stripe LIVE flip — LAST.** Also then: enable Supabase leaked-password protection.

> Full workstream, all ten gaps and the document status: docs/legal-workstream.md.

## On the horizon / next steps

### OPEN ITEMS — PRIORITY CHANGES (Aug 4 2026)

- **~~OPEN DECISION — TIER NAMES DIVERGE~~ — DECIDED AND SHIPPED `7d69fa6` (12 Aug 2026): ONE set of names, Starter / Growth / Portfolio / Pro.** `Landing.tsx` was the sole diverging source. Tier 4 shows "Pro (full booking)" on plan-selection surfaces via a `descriptor` FIELD, never folded into `name`, because `name` is what billing emails and webhook alerts mirror. Kept as the record of the decision, not as a to-do.
- **WATCH `src/lib/tierCopy.ts` — it feeds `/choose-plan`, the actual point of payment, and today carries NO earnings claim.** Any earnings bullet added there lands directly on the payment page and would need the tier qualifier in the string itself. The precise form to copy is `Landing.tsx:64` — "Keep 100% of GetYourGuide &amp; Tiqets commissions — paid to you directly" (both axes scoped in one string). Related residual: `EarningsPanel.tsx ~301` is unqualified but sits in `confirmedCard`, which renders only when `confirmedCount > 0` — never in production today.
- **VIATOR TIER-3 REMOVAL — the only item with a written compliance finding behind it.** Five verified sites: `api/_lib/affiliate-links.ts` (the `usingHostId` branch sets a host `pid` and strips `mcid` — Viator must NEVER take a host PID; leave GYG/Tiqets untouched pending their answers); `api/_lib/affiliate-links.test.mjs` line ~48, whose test ASSERTS the prohibited behaviour and must be inverted; `EarningsConnect.tsx` (Viator card + `viator_partner_id` input + line ~146 copy); `EarningsPanel.tsx` line ~379; `Landing.tsx` line ~63. **STAY UNCHANGED and are still true:** `Landing.tsx` ~245 (three-marketplace comparison) and ~289 ("live on every guest page"), and the Viator clicks column in EarningsPanel — those describe coverage and click reporting, not host attribution.
- **~~HOST ADDRESS CHANGES ARE UNRESTRICTED~~ — SHIPPED 14 Aug 2026 (`34e79c3` + a live migration).** The proposed rule was built as designed: defend the CAP, not the edit. **DB half —** trigger `apartments_enforce_address_swap` runs `enforce_property_address_swap()`, which blocks a **>1km coordinate move OR a city/country TEXT change**, but **ONLY for a host who is AT their property cap**; `service_role`, `is_exempt` and `is_demo` hosts are exempt. **The function is INVOKER rights, and that is load-bearing** — see the SECURITY DEFINER lesson below. **Client half —** `PropertySetup.tsx` surfaces a block as an **upgrade panel** ("this is a new property — upgrade to add it"), and an ALLOWED >1km move as a **staleness notice** flagging that the guide, geocoded picks, events city key and weather coordinates now describe the old location. Behaviour-tested live across **8 cases**. **DECLARED LIMITATION, not an oversight:** a swap to another flat in the SAME city under 1km is not stopped — the gate defends the cap against city-scale swaps, and tightening it further would block genuine corrections.
- **~~WELCOME SHARE PANEL~~ — SHIPPED `8ff40e5` (11-12 Aug 2026), and it also SETTLED the queued welcome-vs-QR placement question.** `/dashboard/share` (`SharePanel.tsx`, replacing `QRCodePanel`; `/dashboard/qr` redirects) carries "Step 1 — send this" (the welcome link inside a copyable message) above "Step 2 — print this" (the QR, with an explicit "Don't send this one to guests"). **Still open from Part 2:** the stay timeline was NOT built — see docs/design-backlog.md.
- **RUN `api/backfill-canonical-city` BY HAND** — GET with `Authorization: Bearer <CRON_SECRET>`. Idempotent. On no schedule. Watch `resolvedNoKey`: a city that resolves with no valid country code stays on the per-apartment path. **HALF DONE as of 11 Aug 2026:** 4 of 10 apartments carry a `canonical_city_key` (all resolved 7 Aug); the other 6 have `canonical_resolved_at` NULL = never attempted. Re-running takes the events cron from 9 units to ~7. **⚠ BUT THIS IS NOT CURRENTLY DOABLE:** `CRON_SECRET` is flagged **Sensitive** in Vercel, so its value cannot be read back and the Bearer header cannot be reconstructed — see the CRON_SECRET lesson below. This item is blocked on that decision, not on effort.
- **PRE-LIVE — OBTAIN WRITTEN CONFIRMATION FROM GYG AND TIQETS ON MULTI-TENANT HOST-OWN-ID.** Udy's own terms review (11 Aug 2026) cleared BOTH to keep host-own-partner-ID on Tier 3, and the code ships that way. **But note the EVIDENCE CLASS: that is a self-assessment, not a provider ruling.** For Viator we hold a written answer from Partner Support; for GYG and Tiqets we hold our own reading. **Viator is the proof that the two differ** — the terms were read carefully, the risk was spotted, the question was asked anyway, and the answer came back NO. Send the same question to both **before the Stripe live flip**, so a paying Tier-3 host is never sold a connection a provider later refuses. **Tiqets first — it uses the same partner-ID substitution shape (`partner=`) that Viator prohibited.** Contacts parked in PHASE I. If either answers no, Tier 3 needs repositioning, not just a code change.
- **⏰ DATED — EARLY SEPT 2026 (6-9 Sept). THE ONLY ITEM IN THIS FILE WITH A REAL DEADLINE, and it
  sends REAL EMAIL TO REAL PEOPLE.** All five remaining sandbox subscriptions hit Stripe's 90-day
  limit and auto-cancel. Each one WILL resolve a host row and send a genuine cancellation email —
  including to **anna.humalainen@gmail.com** and **yiftach@xn--gnai-8qa.com**. Decide before then
  whether test fixtures should carry real addresses at all. Doing nothing is a decision that mails
  those people.
- **THE QUEUE (replaces the previous one, 18 Aug 2026). In order:**
  1. **ONE DESIGN SESSION, ONE COMMIT — four related UI items.** **UX-1 blocked-save toast:
     mockup APPROVED 18 Aug** — a red toast at Save on ANY policy-blocked save, clicking it scrolls
     to the amber decision panel, both dismiss together; **built GENERIC so tier caps use it too**,
     not special-cased to the address gate. **UX-2 custom date picker: mockup OWED** — booked dates
     greyed, changeover days HALF-available (that half-state is the whole point: it is what makes
     same-day turnover visible, and it is the client-side face of the half-open interval the server
     already enforces). Plus **cancel-in-calendar-view** (impossible today — `CalendarView` is a
     grid of coloured cells with no click handler, no selection state, and multiple bookings can
     cover one cell, so a per-booking affordance needs a day-detail interaction first) and **the
     cancelled-conversation chip** (`Conversation.status` is already populated and read nowhere, so
     the chip plus gating the dead guest-page link is one render change).
  2. **Category naming cleanup migration** — prerequisite for the importer.
  3. **Listing importer.**
  4. **Pentest gate — LAST, and FOLD THE DEPENDABOT REVIEW INTO IT.** GitHub reports **16
     dependency vulnerabilities (8 high, 8 moderate) as of the 18 Aug push, UNREVIEWED.** Read the
     list before the gate — **earlier if any high is runtime-reachable**. NOTE this supersedes the
     earlier "7 total / 5 high / 2 moderate" `npm audit` measurement: those two tools count
     differently (GitHub counts one alert per advisory per manifest path, `npm audit` dedupes per
     package), so the gap is NOT drift and must not be re-litigated as such — but 16 is the number
     to review against.

  **STILL PARKED, unchanged:** block-source message fix (before Founding Hosts) · pre-arrival
  messaging gap · **`groq/compound` evaluation — now load-bearing, since guest-chat's Gemini
  grounding carries the 16 Oct 2026 shutdown** · **the `api/` typecheck gap** (`api/` is outside
  every tsconfig AND `@vercel/node` is not installed locally, so `npm run build` type-checks NONE
  of it; **an isolated strict `tsc` per change is the working compensation** and was used on every
  api/ commit this session) · **`cron-refresh-events` refill pacing at fleet scale** (~49s of
  refill needed against a ~20s unit, so concurrency 1 bounds simultaneity but NOT rate) ·
  **`guide.ts`'s POI list is unbounded** — the same structural gap the events corpus just closed,
  fits today · **`MAX_EVENTS` 15 vs the "aim for 20-30" prompt** — events 16-30 are reservation
  waste, now competing with the reasoning trace for the same allowance.

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
- **GUEST-CHAT'S 40/HOUR BRAKE — DOWNGRADED 12 Aug 2026: leave it until real guest usage exists.**
  `api/guest-chat.ts:87` `CHAT_HOURLY_LIMIT = 40`, enforced via `bump_api_counter`, alerting once at
  limit+1. The arithmetic still holds — at ~2.3k tok/turn, 40/hour is ~92k tokens from ONE host
  against a 100K/day FLEET-WIDE ceiling, so one host at the *permitted* rate could exhaust every AI
  surface for every tenant. **But the number cannot be sized without traffic to size it against, and
  there is none: no real guests exist yet.** Any figure chosen now is a second guess replacing the
  first. **Revisit on real usage.** If it is ever changed, it goes in its OWN commit with its own
  recorded arithmetic — never folded into the Step 6 migration, which must not change who may ask or
  how often.
- **~~RETENTION CRONS move onto the CRITICAL PATH~~ — SHIPPED 11 Aug 2026 (`1b7c3d7`), blocker
  cleared.** The RULE stays and is permanent: retention periods are a two-sided contract between
  the code and the published notice — change a constant and the guest notice §6 AND the Art. 30
  record in the SAME commit, or none of them. **No exemptions, ever.** The next condition on
  publication is the Finnish lawyer review, not code.
- **DEPENDENCY VULNS — MEASURED Aug 7 2026, replacing both stale claims.** The old "14 Dependabot
  alerts (7 high, 7 moderate)" and the older "3 dev-only vulns" (`docs/history.md`, S24 residual)
  are both superseded. `npm audit` on `d254df9` reports **7 total: 5 high, 2 moderate, 0 critical.**
  (The `d254df9` push banner said 15 — GitHub counts one alert per advisory per manifest path,
  `npm audit` dedupes to one entry per package, so the two numbers measure different things and
  neither is wrong. Do not treat the gap as drift again.)
  **DOES ANY REACH PRODUCTION RUNTIME? YES — two distinct defects, three of the seven entries:**
  **`react-router` (HIGH) + `react-router-dom` (MODERATE)** — the same defect counted twice, via a
  PROD dependency that ships in the browser bundle; and **`protobufjs` (MODERATE)** via
  `@google/genai`, which is still installed and imported even though the Gemini branches are
  dormant under the pilot. **The other four are build/dev-only and never ship:** `postcss` +
  `vite` (build), `js-yaml` + `brace-expansion` (both only via `eslint`/`typescript-eslint`).
  **NUANCE, NOT A DISMISSAL — needs triage, not assumption:** three of react-router's five
  advisories are scoped to **RSC / SSR** modes (RSC CSRF bypass, RSCErrorHandler XSS, SSR
  hydration `deserializeErrors`), and Bemgu is a **client-only SPA with no SSR and no RSC**, so
  they appear unreachable here. The two worth actually triaging are the **open redirect via
  backslash in `<Link>`/`useNavigate`** (GHSA-wrjc-x8rr-h8h6) and the route-matching DoS, which in
  an SPA is self-inflicted only. `fixAvailable: true` for every one — but **`npm audit fix` was
  NOT run**, because that touches the lockfile and this was a docs-only commit. **Triage before
  the pentest gate.**
- **~~TEST THE MONTHLY GUIDE CRON BY HAND BEFORE 1 SEPT~~ — RESOLVED 14 Aug 2026 (`ec66829`), and
  THE 1 SEPT DEADLINE IS GONE.** The risk was never the date, it was the unbounded fan-out, and
  that is now bounded in code rather than watched by hand — which is just as well, because
  "trigger it manually" was never possible (`CRON_SECRET` is Sensitive; see the lesson below).
  Shipped: `GUIDE_START_BUDGET_MS` (45s absolute start deadline, 150 − 100s in-flight worst case
  − 5s overhead, captured at handler entry), `GUIDE_MAX_AGE_DAYS` (25) freshness gate, and
  oldest-first ordering with never-generated apartments first — the staggering this entry
  predicted would need no new column, exactly as predicted, on `generated_at`. Schedule is now
  **daily `0 10 * * *`** (was `0 10 1 * *`); a deadline stop returns 200 with
  `stopped_early`/`remaining`, so successive runs work through the fleet. **Still open from this
  entry:** skip expired hosts, and log outcomes — see the residuals below.
- A `demo-create` cooldown was NOT built (secondary surface: Turnstile + one-demo gated).
  Fail-closed reconsideration remains a recorded non-blocking option.
- **CLAUDE.md size — RESTRUCTURED 10 Aug 2026.** The one-record rule caps the RATE of growth, not the DIRECTION, so archiving alone could never get back under the 150,000 working limit; ~22% of the file was strikethrough supersede narrative, which no archive move ever touches. Fixed by splitting on LIFETIME rather than topic: invariants and live work stay, reasoning trails moved to purpose-named files under `docs/`. **Standing rules: (a) delete a superseded claim rather than striking it through and explaining it — git holds the correction; (b) one pointer per moved BLOCK, never per item, or the pointer costs half the saving; (c) when this file passes ~140,000, restructure again rather than trimming.**
- **OPEN — STEP 7 / SELF-ATTACK DRILL (argued in `cron-sync-ical.ts` + commits):** `ok` = "no
  failure recorded", NOT "work was done" — two in-code empty-success paths (deadline-adjacent,
  window = one **POOL-WIDTH**; the SILENT no-`https://` path), not exhaustive. Alarm is
  **single-success-suppressible**, never the sole iCal health signal. Cron ignores
  `result.capped`. ntfy is a third consumer of `deferred + ok + failed === apartments.length`.
  `PropertySetup.tsx`'s "Calendar synced" toast hides the strings (UI, mockup-first).
- **OPEN — CITY COMPRESSION MEASURED, NOT PROJECTED (Aug 8 2026), and it is WEAK EVIDENCE.** The
  fleet is **10 apartments across 8 cities**, Helsinki the only city with more than one. Fully
  backfilled the cron would run **8 units for 10 apartments — about 1.25x compression, NOT a
  multiple.** The recorded ~8-apartment Tavily runway becomes **~10**. **CAVEAT, and it is the
  whole point: this is a TEST fleet whose geography was CHOSEN**, so it says almost nothing about
  real host clustering — which is the entire lever. **Re-derive at >= 10 paying hosts; that is
  when the card decision should be taken**, not at the 50-host milestone.
- **OPEN — THE LEAN-CONTEXT RULE IS NOW A MEASURED CONSTRAINT, not a design preference.** The
  Aug 8 measured **`corpusChars` 15,102**; the Aug 9 run BILLED **7,079 tok** (prompt 5,031 +
  maxTokens 2,048 RESERVED) — which was HALF of the then-12K TPM ceiling. **THAT HEADROOM IS GONE:
  the ceiling is 8,000 TPM (VERIFIED 17-18 Aug 2026), so the same run would have been 88% of it.**
  The events corpus is now bounded by a derived token budget rather than a snippet count
  (`CORPUS_TOKEN_BUDGET`, `8fbb`-era commit `8619c5f`), which is what brought it back inside.
  PILOT STEP 2's rule (b) — the router's ungrounded leg must not embed the guide — still binds,
  and now binds on TPM as well as on the day pool.
- **OPEN — THE SHARE MESSAGE AND `host_picks` ARE NOW COUPLED, and nothing enforces it.** The
  default welcome message promises "our own favourite places to eat and drink nearby", and
  `SharePanel` nags when a property has **zero `host_picks`** — the first time those two facts have
  met in the UI. A host who copies the message with no picks saved sends a promise the guest page
  does not keep. The nag is the only link; there is no gate, and none is proposed. **Design
  question, not a bug** — decide whether the message should soften when picks are empty, or the
  nag should be stronger.
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
- **~~OPEN 2 — `cron-sync-ical` 504s an interactive host~~ — ALREADY FIXED, verified in source
  12 Aug 2026.** `api/sync-ical.ts:68` sets `SYNC_FETCH_BUDGET_MS = 115_000` as an absolute
  deadline against `maxDuration` 150, passed as `deadlineAt` at `:126`; `api/_lib/ical.ts:161`
  enforces it MID-LOOP and **falls through to reconciliation** — a deadline is a partial sync, not
  a failed one. Vercel runtime errors over the last 7 days show two groups, neither iCal. The
  `d254df9` pattern was already applied here; the entry described the pre-fix state.
- **OPEN 3 — `cron-refresh-guides.ts` is sequential with NO deadline guard** and iterates **ALL
  visible apartments**, so it carries the same silent-truncation exposure: killed mid-flight, no
  summary, no alarm. Separate item from the two above.
- **OPEN — spend hardening.** Hoisted verbatim out of "SPEND-ABUSE ALARM + CALL COUNTER" when it
  moved to docs/history.md. **The (a)/(b)/(c)/(ii) labels are the ones from their SOURCE lists
  there, not a sequence** — they were kept so each item can be traced back; do not read them as
  ordered or complete.
  (b) COMPLIANCE: ntfy spend alerts now MAY include a host account UUID (pseudonymous).
      NTFY_URL confirmed a PRIVATE topic. Update the Art. 30 ntfy row from "no personal
      data" to "may include a host account UUID" (fbf58aa's blanket claim is now narrower).
  (c) KEY-NAMING TRAP: shared key GEMINI_API_KEY is nicknamed "Arrivly guide"
      (0819525902) but the PRIMARY guide spend goes to GEMINI_API_KEY_GUIDES
      (0816353550, billed, no recorded console nickname). Consider renaming project
      0816353550 to e.g. "bemgu-guides-billed" so an incident responder disables the
      right project.
  (a) NO ALERT ON VOLUME MINTED. Both alarms fire on RATE (5/h) and on CAP (100). An attacker
      serving exactly 100 uids and stopping at 5 syncs/hour mints 500 passes/hour with BOTH
      ALARMS SILENT. Cheapest fix: alert on `imported` per sync, not just request count.
  (b) The capped alert is NOT one-shot (unlike the rate alert's strict `=== LIMIT + 1`), so a
      capped host can fire up to 5 high-priority ntfy/hour. Give it the same dedupe.
  (c) `MAX_ICAL_URLS = 20` x the 10s `safeFetchIcal` timeout = up to 200s against
      `maxDuration: 150` — interactive: a self-inflicted 504 with the counter already spent;
      CRON: with `mapPool` concurrency 4, one host's slow feeds can burn the window and starve
      other hosts' syncs (a cross-tenant availability lever). Pre-existing and IMPROVED by the
      URL cap, not introduced. Consider `MAX_ICAL_URLS ~= 10` and/or a cron wall-clock budget.
  (ii) STILL OPEN: no cross-endpoint view — a host at 49% on all seven endpoints at once is
  invisible.
- STILL OPEN on the detector: **NO CRON HEARTBEAT — "never ran" remains undetectable**, the exact
  shape of the guide cron, which has still never run (and is DAILY since `ec66829`, so a silent
  "never ran" now costs a refresh every day rather than every month). The failure ntfy covers "ran and failed",
  not "never ran". Also `city-events-host` (9) and `sync-ical` (15) WILL false-positive on a
  legitimate Tier 3/4 multi-property setup sweep (12 properties > 9), firing a high-priority
  "block this host" alert at a paying customer — revisit when a real portfolio host exists.

### RESIDUALS FROM 14 Aug 2026 — recorded with enough detail to fix in ONE pass

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
  Comfortable at 9. **Re-derive BOTH constants beyond that**, not one of them.
- **The commission disclosure in `ExperiencesSheet.tsx` is unconditional BY DESIGN, and nothing in
  the code says so.** Every neighbouring earnings surface IS tier-qualified (`EarningsPanel`,
  `Landing`), so the pattern a future editor pattern-matches against is the conditional one —
  and making this one conditional would reintroduce the exact defect `736a715` fixed. A one-line
  comment above it would make a regression visible in a diff.
- **`PropertySetup.tsx`'s load effect has no cancellation guard** — same class as the recorded
  `BookingManager.tsx` `arrivly:messages-read` note: a tiny stale-overwrite race on rapid
  apartment switching. Fold into the next change to that file.
- **The `code-reviewer` subagent wrote `.claude/agent-memory/` files on its own initiative
  (14 Aug 2026), and they are NOT adopted.** They are gitignored, so they are invisible to
  everyone but the machine that wrote them, which is precisely why they must not become a second
  source of truth. **Project memory lives in CLAUDE.md + docs/history.md, nowhere else.** Do not
  read from, cite, or maintain those files.

> ✓ Plan values confirmed (hard gate CLOSED): T1 €10/cap 2, T2 €15/cap 7, T3 €25/cap 12, T4 €49/unlimited; trial_days = 14.
> **DECISION (S16, amended S19 cont.): flip-to-live is the LAST step. Build order reordered S19 cont. to G → H → I → F (Phase F / Tier-4 booking moved to the end).**
> **DECIDED (Udy, Jul 28 2026): OPTION (b) — flip live on Tiers 1–3, build Phase F (Tier-4 booking) AFTER launch.** Rationale: G/H/I are complete, Tier 4 has no waiting customers, and launching sooner starts real revenue and real traffic. **Consequence for the pentest gate: it now runs on the Tiers 1–3 surface WITHOUT the Phase F booking/payment flow**, which reduces its scope and cost. When Phase F is later built, it introduces a payment-taking surface that did not exist at gate time — **a second security pass over Phase F is therefore required before Tier 4 is sold.**
> **HARD PRE-LIVE GATE (Udy, S19 cont.): a pentest/"hacker" agent pass must run and pass before the live flip, on top of security-auditor.**
> **DOMAIN MIGRATION GATES PHASE I STAGE 0 (decided Jul 10 2026):** Udy is buying a dedicated Arrivly domain (availability order `arrivly.com` → `arrivly.app` → `arrivly.io` / `getarrivly.com`) BEFORE any experience-provider registration, so affiliate applications carry the final domain and the one-QR-forever promise holds. Masking `anna-stays.fi` is not viable (breaks PWA/OAuth/hash flow). Full migration checklist lives in "PHASE I — EXPERIENCE CONNECTORS" → Stage 0 above.
> **Apple Sign-in — PARKED (Jul 8 2026; do NOT build unless asked):** built + flag-hidden (`VITE_SOCIAL_APPLE` unset). Unblock when the Apple Developer account is accessible — create an App ID + a Services ID (Return URL = the Supabase callback `https://ptkabdelgxkgfslfialx.supabase.co/auth/v1/callback`; domain `ptkabdelgxkgfslfialx.supabase.co`) + a Sign-in-with-Apple `.p8` key (let Supabase generate + rotate the secret), enable Apple in Supabase Auth, then set `VITE_SOCIAL_APPLE=true` in Vercel. Matters for the future native iOS app (App Store guideline 4.8).
> **Social sign-in — minor/cosmetic (Jul 8 2026; non-blocking):** the two active-demo "Start free trial" CTAs (sidebar + dashboard banner) both open `KeepDemoModal` with `tier=null` → `/choose-plan` (identical destination, only the wording differs). Leftover `user_metadata.is_demo='true'` after conversion is harmless (nothing reads it post-convert).
> **LANDING — pre-launch facelift:** the S25 landing is shipped and good, but get a final visual facelift right before go-live (when all advertised features — esp. the experiences marketplace and full booking — are actually live), so marketing copy matches deployed reality. The "See a live demo" button is intentionally non-functional until then; wire it to a real demo (Sweet home `ARR-EVT777` is the candidate live guest page) as part of that facelift.
> **LANDING — PARKED motif idea:** reuse the guest-page phone-mockup motif on the landing as a **live, accent-switching guest-page preview** hero/feature element (the Stage-A/B comp looked great). Not now — do it as part of the pre-launch landing facelift. Note: `Landing.tsx` already mocks a Casa Marco guest card with +€6.40 / +€18.60 revenue tiles — extend that motif.
> **Marketing strategy — AI video ads (future session).** Ad-creative exploration was done OUTSIDE the repo (Higgsfield lifestyle hero ad with real screen-replacement of the guest page + a branded logo-grow finale using `public/icons/icon-512.png`; ~36s hero/brand cut, plus a reusable hero still). Decision: the landing page KEEPS its existing carousel / auto-cycling phone mockup for now — no landing hero-video swap. Next step (dedicated session): build the marketing strategy around the video ads — 15–30s paid-social cutdowns, 16:9 / 1:1 framings, placements, and where each asset lives. All video assets live outside the repo.


> Scoped but NOT built — detail in docs/design-backlog.md:
> **UX design conversations** (welcome-link vs QR placement, missing property name, no scroll reset) · **anon-read lockdown** for `guide_recommendations` + `host_picks` (needs the reader-migration-first pattern) ·
> **welcome page Part 2** (share panel, AI-drafted note, message variants, view counts) · **pre-arrival guest reachability** (the third page state, and the precondition for pre-arrival push).

Build order (reordered S19 cont.): **G → H → I → F → flip Stripe to live (LAST)**.
- G — pre-launch hardening (incl. pentest gate)
- H — UI/UX polish
- I — monetisation iteration
- F — Tier-4 full booking (moved to end)
- Flip Stripe to live — LAST. OPEN: F before or after the flip — decide after G/H/I.


> Moved to docs/history.md — "SECURITY — cross-tenant anon leak FOUND AND CLOSED (Jul 28 2026)".

## AI MODELS — the one fact that still binds
`gemini-2.5-flash` shuts down **16 Oct 2026** and is already refused to new Google Cloud projects. **ONE SURFACE STILL DEPENDS ON IT, so the deadline is REAL and dated, not conditional** — the earlier "no surface depends on it" claim was FALSE and is corrected here (18 Aug 2026). `api/guest-chat.ts` runs `gemini-2.5-flash` on `GEMINI_API_KEY_CHAT`, verified in source; it is the only Google dependency left in the stack, it is on the AI Studio FREE tier with no card, and pilot Step 6 (the chat router) was never built. **Either Step 6 lands or guest-chat breaks on 16 Oct 2026.** `groq/compound` ships built-in web search and is the obvious candidate to replace the grounding this surface depends on — parked and UNTESTED (see the queue). Grounding is 1,500 RPD free on the 2.5 line and **ZERO on Gemini 3** — that is what made graduation-to-Google expensive. Quota measurements, the per-project model and the migration analysis are in docs/pilot-history.md.

> Moved to docs/history.md — "SESSION Aug 4 2026 — Gemini terms verified at source; the 30 Jul session recorded".
> Moved to docs/history.md — "SESSION Aug 4 2026 (2) — pre-billing security: scrubErr + atomic per-host guide cooldown SHIPPED".
> Moved to docs/history.md — "SESSION Aug 7 2026 — B3.5 smoke PASSED, cron concurrency fixed, CLAUDE.md split". Superseded by the full-day record below.
> Moved to docs/history.md — "SESSION CLOSE — Aug 6 2026: pilot Steps 4 and 5 shipped, city-cache scoped, B3.5 shipped".
> Moved to docs/history.md — "SESSION Aug 8 2026 — date-window guard corrected; iCal sync bounded, fair and honest".
> Moved to docs/history.md — "Session — 10 Aug 2026 (HEAD 7f3dac5)". Its OPEN blocks were HOISTED
> first — the seven items live in Known notes, Tracked security follow-ups and OPEN ITEMS.
> Moved to docs/history.md — "Session — 9-10 Aug 2026 (HEAD 2b71fec)". Its GATE STOPPING
> CONDITION was HOISTED into Agent policy first — it existed nowhere else.
> Moved to docs/history.md — "Session — 10 Aug 2026 (restructuring, HEAD e694e90)". Its three
> standing size rules were already hoisted into the CLAUDE.md-size open item.

> Moved to docs/history.md — "Session — 11 Aug 2026 (retention crons + Viator ruling, HEAD
> 4d5ac2f)". Its Gmail/inbox rule was HOISTED into Agent policy first — it existed nowhere else.

> Moved to docs/history.md — "Session — 11 Aug 2026 (Viator enforcement + earnings-copy sweep,
> HEAD 9fa4b7b)". Its two OPEN DECISIONS, the tierCopy watch and the self-qualifying-claim rule
> were HOISTED first — into OPEN ITEMS and Lessons.

> Moved to docs/history.md — "Session — 11-12 Aug 2026 (the Share panel, HEAD 5153bc4)". Its
> picks-vs-message coupling was HOISTED into OPEN ITEMS first; the COMMENT-ONLY EXEMPTION it
> invented was already in Agent policy, and its `anon=m` correction is in docs/schema.md.

> Moved to docs/history.md — "Session — 12 Aug 2026 (tier names, contrast, scroll — HEAD a34af78)".
> NOTHING needed hoisting: its verify-a-queue-item rule and COMMENT-ONLY exemption were already in
> Agent policy, the `overflow-auto` lesson already in Lessons, and its Phase H scoping already in
> docs/design-backlog.md. Its tier-name decision is recorded as CLOSED in OPEN ITEMS.

> Moved to docs/history.md — "Session — 14 Aug 2026 (address-swap gate, beneficiary, the
> guide cron)". NOTHING needed hoisting: its four rules (SECURITY DEFINER vs INVOKER,
> fixtures that commit mid-session, CRON_SECRET being unreadable, repo visibility as a
> class of claim) were already in Lessons; the guide-cron starvation defect is in
> RESIDUALS and the address-swap/disclosure entries are in OPEN ITEMS.

## Session — 17-18 Aug 2026 (Groq migration closed with production proof; BookingManager — HEAD fc35d69)

**SHIPPED, four commits:** `c4981b2` repoint the dead Groq model + bound the reasoning budget ·
`8619c5f` bound the events corpus by a token budget derived from the real ceiling · `1a2ed59` size
the greeting budgets for a reasoning model + stop theme starvation · `fc35d69` reject overlapping
manual bookings, allow cancelling them. Plus `GROQ_MODEL=openai/gpt-oss-120b` set in all three
Vercel environments. Gates PASS on every commit; the last needed THREE rounds and six must-fixes.

**THE OUTAGE, AND THE PROOF IT IS OVER.** Groq decommissioned `llama-3.3-70b-versatile` on
16 Aug 2026 and **every Groq surface returned 404 `model_not_found`.** There was no "pick another
Llama" — the whole family is gone from the catalogue. **PRODUCTION-VERIFIED 18 Aug 2026, not
assumed:** `/api/daily-greeting` returned **200** on `openai/gpt-oss-120b` with
**`reasoningTokens` 156**, and the 09:00 UTC `cron-refresh-events` run was clean — **7 snippets,
`corpusTokensEst` 2,220 of the 2,300 budget, theme spread 2/2/1/2, reservation 5,571 of 8,000,
4 events extracted.** The theme spread is the specific number worth keeping: it is the round-robin
backfill working, which is the fix that a measurement — not a review — forced.

**THE MEASUREMENT THAT CHANGED THE DESIGN TWICE.** The events corpus was bounded by a fixed
snippet count, which cannot bound a worst case (14 slots measured 11,921 chars typical but
~19,600 at all-fields-at-cap). Replacing it with a derived token budget was the easy half. The
hard half only appeared under simulation: fair-sharing tokens in pass 1 was **not enough**, because
at 575 tokens per query pass 1 fits only ONE typical snippet, so the order-greedy backfill did the
real selecting and produced `calendar:4 / whats-on:1 / music:1 / culture:1`, with a CJK corpus
collapsing to calendar-only. **The rule: a budget that replaces a count must be re-simulated
against the ORDERING it inherits, or it silently becomes a producer filter.**

**THE 156 THAT SHOULD HAVE BEEN 128.** See the new Lessons rule — budget parity covers retries and
timeouts, never token counts. The greeting cap was inherited from a Gemini branch running
`thinkingBudget: 0`; the number survived, the condition did not, and the first production run
measured 156 reasoning tokens against a 128 ceiling. **It would have failed SILENTLY** — a
reasoning-starved call returns `''` on a 200 with no throw — which is why the empty path gained a
`console.error` in the same commit. Without that log there is no way to tell whether the fix worked.

**A FIX FOR AN ALARM SILENTLY DELETED THE ALARM'S REMEDIATION.** The reviewer was right that
`create-booking`'s ntfy said "ACTION: block this host" for someone who might have created zero
bookings (rejected 409s bump the counter too). Correcting the wording took the body to **633 chars
against `sendNtfy`'s silent 500-char slice**, truncating away the entire ACTION line and the key
names. Rebudgeted to **483 with 17 spare, ACTION moved SECOND** so truncation can never reach it,
with the measured number and a RE-MEASURE instruction in a comment. **The reviewer's own suggested
replacement measured 564 and was not adopted** — re-measure at the moment you state a number
applies to a gate's suggestion exactly as it applies to your own.

**TWO DB CHECKS TURNED HYPOTHESES INTO FACTS, AND BOTH WOULD HAVE SHIPPED SILENTLY.** A nullable
`bookings.status` would have made PostgREST's `.neq` skip the row while `cancel-booking` returned
success — **the guest token would have kept working.** A CHECK constraint on `admin_audit.action`
would have made every `cancel_booking` audit insert fail, and being best-effort, **fail silently
forever** — so the traceability justifying the whole endpoint would never have existed. Both
verified clean; both dependencies now in docs/schema.md, along with the `bookings` RLS predicate,
which was the entire boundary for a query this session widened and was **written down nowhere**
through two consecutive audits.

**79/79 PASSED, ZERO BLOCKERS (17-18 Aug 2026).** Full guest/host/seams/edge-case checklist plus
staged D6 (previous-guest protection: a past-token device gets the thank-you page, never the new
guest's page), the pre-arrival token path (a future-dated valid token resolves to PUBLIC tier —
`guest-access.ts` ~line 52), four `/w/` welcome-link states, and the six-step BookingManager
retest in production. **The anti-swap trigger was verified on BOTH layers as a non-exempt host:
the panel fired AND the DB kept the original address. D9's first "failure" was the exempt admin
account** — the trigger exempts `is_exempt` by design. **Rule: test a protection from a
non-exempt account, or you are testing the exemption.**

**BOOKINGMANAGER (`fc35d69`, deployed `dpl_4hsNgTV6…`).** Server-side overlap guard (half-open
intervals so same-day turnover passes by construction; blocks count as unavailable; 409 names the
conflict) + soft cancel for **manual-source only**, audit-logged, feed-owned rejected server-side +
the orphan rule: **a conversation with messages survives its booking's cancellation.** Residuals
are in the commit message; the notable one is cosmetic and queued — a cancelled conversation still
renders a live-looking temporal chip and a dead guest-page link.

## GROQ — VERIFIED PLATFORM FACTS (17-18 Aug 2026). Supersedes every earlier Groq figure.

Read from LIVE `x-ratelimit-*` response headers against the production free-tier key, not from
documentation and not carried forward from a note. Every older number in this file has been
corrected against these; two sites keep the old figure deliberately, phrased as history ("what
was then 12K TPM") with the correction adjacent.

| Fact | Value |
|---|---|
| Tokens per MINUTE (TPM) | **8,000** — the binding constraint |
| Requests per DAY (RPD) | **1,000** |
| Tokens per day | **not returned as a header at all** — unobservable here |
| Model sensitivity | **IDENTICAL on `openai/gpt-oss-120b` AND `openai/gpt-oss-20b`** — switching model buys NO extra TPM and is not a lever |

- **HEADER NAMING TRAP:** `x-ratelimit-limit-requests` is per **DAY**, `x-ratelimit-limit-tokens`
  is per **MINUTE**. Groq's naming genuinely misleads; do not read either as per-RPM.
- **THE RESERVATION RULE, confirmed to the token THREE separate times:** the debit is
  `promptTokens + max_tokens` — the RESERVATION, **never the actual completion**. Measured
  exactly: prompt 78 + max_tokens 300 = 378 debited for 19 generated. **Consequence: an unused
  output cap is pure waste, and a reservation larger than 8,000 can NEVER be satisfied on any
  bucket state — that is a PERMANENT failure, not a transient throttle, and no retry clears it.**
- **REASONING IS SEPARATE IN THE RESPONSE, SHARED IN THE BUDGET.** Groq returns the trace in
  `message.reasoning`; `message.content` stays clean, so JSON parsing at every call site is safe
  and **no stripping logic should ever be added**. But `reasoning_tokens` is billed INSIDE
  `completion_tokens`, i.e. out of the same `max_tokens` allowance as the answer. `reasoning_effort`
  is `'low'` globally, sent only when the model id starts with `openai/gpt-oss`.

**THE CATALOGUE AS OF 18 Aug 2026 — this is why there was no "pick another Llama" option:**
`gpt-oss-120b` and `gpt-oss-20b` are the **ONLY production text models**. The **entire Llama family
is gone.** `qwen3.6-27b` is **preview — evaluation only, do not ship on it.** **`groq/compound` has
BUILT-IN WEB SEARCH and is the potential replacement for guest-chat's Gemini grounding dependency
— PARKED AND UNTESTED**, which matters because that dependency now carries the 16 Oct 2026
shutdown date (see AI MODELS).

## ZERO-GOOGLE AI PILOT — APPROVED PLAN (Aug 5 2026) — CANONICAL, supersedes the pre-billing checklist

**STATUS.** Approved by Udy, Aug 5 2026. The Bemgu Google Cloud billing account
**01EC0F-C6FE15-32E552 is CLOSED with zero linked projects** (screenshots verified in-session).
All five Gemini projects are back on **no-card free tier**, and **no payment instrument exists
anywhere in Bemgu's AI stack**. The guides project `gen-lang-client-0816353550` was the only one
ever billed (~€0.80 accrued Aug 4; a trailing sub-€1 invoice may still arrive — that is history,
not exposure). The €10 spend cap is moot. **The "PRE-BILLING CHECKLIST" in the spend-hardening
summary below is SUPERSEDED by this plan: there is no billing flip.** Instead, surfaces graduate
one at a time (below). Anna's Stays billing is a separate account and is untouched.

**DECISION.** Run production with **ZERO Google AI keys and no postpaid meter until 50 hosts** —
the graduation milestone, a number Udy set on Aug 5.
> **⚠ RECONCILED Aug 6 2026 — THE FREE STACK DOES NOT REACH 50 HOSTS, whichever vendor.** Measured:
> **Tavily free = 1,000 credits/month FLEET-WIDE** = ~250 runs at 4 credits/run = **~8 booked
> apartments refreshed daily**; **Groq free = 1,000 RPD and 8,000 TPM ORG-WIDE (VERIFIED 17-18 Aug 2026 from live x-ratelimit headers, on BOTH gpt-oss-120b and gpt-oss-20b — switching model buys no TPM; a per-day token ceiling is not returned as a header at all); TPM debits prompt+maxTokens** across all eight
> surfaces. **Real free runway is ~10-20 hosts, not 50.** And the escape hatch below is narrower
> than it reads: **Groq's own Developer tier REQUIRES A CARD**, so "paid Groq with a hard spend
> limit" does **not** preserve the no-card state either. **The card question is therefore DEFERRED,
> NOT RESOLVED** (Udy, Aug 6) — vendors stay unpaid until graduation, and the 50-host milestone will
> need revisiting against these numbers before it is reached, not at it.
- **WALLET POLICY:** every AI / search / POI provider must be **no-card free tier or prepaid**.
  Providers that require an **uncapped card on file are BANNED** (Brave-class).
- **LLM PROVIDER ORDER:** Groq if its EEA/commercial terms + DPA pass **the same Aug 4 standard
  applied to Google**; else Mistral; or Groq paid **with a hard spend limit set BEFORE the first
  call** — **but note the card requirement above: that third option is not a no-card option.**
> Settled pilot history — vendor risk on Groq, the xAI pricing, the no-card bridge state, the no-rollback decision and the Step 0-5 status — is in docs/pilot-history.md. Steps 6-9 remain below.

**HARD CONSTRAINT — unchanged from the spend-hardening work.** Every brake, counter key, limit,
fail-open/fail-closed choice, the rolling + Sybil audit, retention/prune, and the
victim-vs-caller alarm rule stay **100% intact**. When a surface changes provider **its brake
moves WITH it: one counter bump = one FULL pipeline run**, search/POI and LLM legs included. The
**only** permitted alarm change is remediation **TEXT** (Google-project advice → pilot-provider
key revoke/rotate), preserving the `fa8fa32` victim-vs-caller wording rule. `cron-spend-audit`
needs **no logic change** — the endpoint keys do not move.

**TARGET STACK (9 surfaces).**
1. **guest-chat** — a router: ungrounded leg on a cheap LLM; "nearby X" → Geoapify/LocationIQ POI
   query; open-web → Tavily + cheap LLM. Brake unchanged (40/h, victim-keyed, fail-closed).
2. / 3. **city-events public + host refresh** — Tavily + cheap LLM, same DB cache. Counters
   unchanged (`city-events-public` 7/h, `city-events-host` 3/h).
4. **guide** — rebuilt on POI DATA: Geoapify (or LocationIQ, if the current plan covers
   Nearby/POI) categories around the apartment coords → cheap LLM writes the prose. **Coordinates
   come from the POI data, which structurally kills BOTH the fabricated-business problem and the
   geocoding weakness.** 6h atomic claim + 10/h alarm counter unchanged. Existing cached guides
   are untouched.
5. **daily-greeting**, 7. **rewrite-rules**, 8. **bulk-import**, 9. **guide-assistant +
   welcome-chat** (last) — cheap LLM, quality indistinguishable. Greeting brake 50/h unchanged.
6. **host-picks** — cheap LLM (host-reviewed; LocationIQ geocoding untouched).
- **create-booking and sync-ical brakes: untouched** — they were never AI.

**MECHANISM.** A new thin `api/_lib/ai-provider.ts` abstraction plus **per-surface env vars**
(`AI_PROVIDER_CHAT=groq|gemini`, `AI_PROVIDER_GUIDE=poi|gemini`, …). **The Gemini code paths are
KEPT as the `gemini` branch and never deleted.** Graduation is then an env-var flip + redeploy,
per surface.

**GEMINI KEY MAP — the single copy. Five keys, five projects, each with its own free-tier daily
quota. Still live: Step 8 (deleting these vars from Vercel) has NOT run, and the `gemini` branch
stays dormant in code. Alarms name the env var and the project ID, never a key value.**

| Env var | Project | Surfaces | Note |
|---|---|---|---|
| `GEMINI_API_KEY` (shared) | gen-lang-client-0819525902 | `_lib/greeting` / `daily-greeting`, `_lib/host-picks`, `bulk-import`, `rewrite-rules`, `guide-assistant` | the only ones competing with each other — **disabling it is blunt** |
| `GEMINI_API_KEY_GUIDES` | gen-lang-client-0816353550 | `_lib/guide` | |
| `GEMINI_API_KEY_CHAT` | gen-lang-client-0221179352 | `guest-chat` | was GROUNDED |
| `GEMINI_API_KEY_EVENTS` | gen-lang-client-0131909896 | `_lib/city-events` (guest lazy-fill, `cron-refresh-events`, host `refresh-events`) | was GROUNDED |
| `GEMINI_API_KEY_PUBLIC` | (separate project, no card) | `welcome-chat` | `gemini-3.1-flash-lite`, NO grounding |

Every dedicated key reads `<KEY> || GEMINI_API_KEY`, so behaviour is unchanged when the dedicated
var is absent. Keep each high-volume or public AI surface on its own key/project — that isolation
is provider-independent and survives the pilot.

**WORK PLAN.** Every code step: single-block prompt, code-reviewer + security-auditor blocking,
HEAD == Vercel READY verified after.
- **⚠ Step 6 IS NOW THE ONLY THING THAT CLEARS A DATED DEADLINE, AND IT IS NOT IN THE QUEUE
  (18 Aug 2026).** guest-chat still runs `gemini-2.5-flash`, which SHUTS DOWN 16 Oct 2026 — so
  either Step 6 lands, or `groq/compound` replaces the grounding, or guest-chat breaks on that
  date. The agreed queue (Founding-Hosts UI → category migration → importer → pentest gate) does
  not schedule either one, and `groq/compound` is parked and untested. **This tension is recorded,
  not resolved: it needs a decision about WHEN, not more analysis.** The entry below is kept for
  its acceptance criteria.
- **Step 6 — unblocked but NO LONGER NEXT (Aug 10 2026)** (the B3.5 smoke and the cron concurrency
  fix are both done, `d254df9`) — guest-chat router + host-picks. Acceptance test = the 20-question
  benchmark set recorded under "PILOT STEP 2". **NOTHING NOW PRECEDES IT (re-verified 12 Aug
  2026):** the restructuring session is done, Commit B (events staleness) is done, and the
  guest-chat brake is downgraded to "leave until real usage exists" rather than a blocker. If the
  brake is ever re-sized it still goes in its OWN commit — a migration must not change who may ask
  or how often.
- **Step 7** — alarm-text sweep + **SELF-ATTACK DRILL** (burst chat past 40, hammer
  `city-events-public`, booking flood; verify the brakes trip and the ntfy wording is right).
  **The drill is a graduation PREREQUISITE.**
- **Step 8** — Udy deletes the five `GEMINI_API_KEY*` vars from Vercel Production (the `gemini`
  branch stays dormant in code).
- **Step 9** — learning phase. **Iteration 2** (automated responses, victim-vs-caller-aware) and
  **Iteration 3** (superadmin attack dashboard) are built DURING this phase.

**GRADUATION.** At 50 hosts + Step 7 drill passed + alarms observed on real traffic + dashboard
live: per surface, **guest-chat first, events second**; **guide only if the POI version
underperforms** (it may never return — and after B2/B2.1 it looks unlikely to); the cheap four
likely never return. Each return = reopen the closed Bemgu billing account, set a fresh
**enforcement** spend cap sized by the **2x ceiling rule**, then flip the env var.
> **⚠ THE 50-HOST TRIGGER IS NOT REACHABLE ON THE FREE STACK (measured Aug 6 2026 — see the
> RECONCILED note under DECISION above).** Tavily's fleet-wide monthly pool caps the fleet at
> **~8 booked apartments refreshed daily**, so the binding constraint arrives at roughly **10-20
> hosts**, well before 50. **Consequence: a vendor decision is forced EARLIER than graduation, and
> the "reopen Google billing" path is only one of the options** — the others are a paid Groq/xAI tier
> (both card-gated) or the **city-level events cache**, which cuts the per-run cost for every vendor
> including the free one and is the only lever that needs no card. **Do not treat 50 hosts as the
> next decision point; treat the Tavily pool as it.**


- **OPEN — TAVILY'S FREE ALLOWANCE IS A FLEET-WIDE MONTHLY POOL (1000 credits), and NO brake
  bounds it.** Every existing counter is per-host-per-UTC-hour, which cannot bound a monthly
  fleet pool. **REVISED BY B3.3 — one pipeline run = 4 credits (was 3). Ceilings: public 7/h x 4 =
  28 credits/host/hour; host refresh 3/h x 4 = 12; `demo-create` unbraked at 4/demo; and the
  unbraked `cron-refresh-events` is the dominant consumer — ~8 candidate apartments (was ~11) would
  consume the entire monthly allowance on the cron alone**, so B3.3 made this item MORE pressing,
  not less. **ESCALATED Aug 6 2026: this is now the BINDING CONSTRAINT ON FLEET SIZE, not just a
  spend item — ~8 booked apartments refreshed daily exhausts the month, which puts the free runway at
  roughly 10-20 hosts and makes a vendor decision arrive BEFORE the 50-host graduation milestone.
  The CITY-LEVEL EVENTS CACHE (scoped below) is the only lever that relieves it without a card.**
  This is a genuinely NEW spend dimension the Step 3
  budget-parity rule (time/attempts) does not cover. Exhaustion degrades rather than bills (PAYG
  is prohibited by policy), and recovery is **monthly**, not daily as Gemini's quota was. Belongs
  in the Step 7 self-attack drill.

### PILOT STEP 2 — BENCHMARK CLOSED, APPROVED BY UDY (Aug 6 2026)

**The gate is passed and the POI approach is proven on real data, not assumed.** An
OSM/Overpass query around Sweet home (Runeberginkatu 17) returned **423 named POIs within 800 m**
— 172 restaurants, 64 cafés, 59 bars/pubs, 8 supermarkets, 4 pharmacies with opening hours,
7 museums. Metadata coverage: **73% carry `opening_hours`, 67% a website, 80% a street address.**
**11 of the live Google guide's 15 picks were found directly**, and the four misses were radius
artifacts rather than data gaps. **Udy judged the POI-built guide draft "even better than
Google".**

**THREE BINDING DESIGN RULES for the remaining migrations — each came from measurement, not
taste. Do not rediscover them:**
- **(a) CATEGORY MAPPING must include `place_of_worship` / `historic` / `memorial` tags**, or
  Temppeliaukio-class sights are silently missed.
- **(b) THE ROUTER'S UNGROUNDED LEG MUST NOT EMBED THE GUIDE.** `guest-chat`'s system prompt is
  currently **~1,600 tokens because it embeds the full guide JSON (~960 tok)**. Retrieve the
  relevant category on demand instead; floor is ~700 tok. **Context that makes this binding:
  Groq free tier is 8,000 TPM and 1,000 RPD ORG-WIDE (VERIFIED 17-18 Aug 2026), and TPM debits
  prompt+maxTokens** — with the old 12K figure corrected DOWN, TPM is now the tighter binder of
  the two, not the day pool: at ~2.3k tok/turn one host at the 40/h brake still burns the request
  allowance fast, but a single oversized call breaches the minute ceiling first.
- **(c) CHAT HISTORY MUST BE TRUNCATED SERVER-SIDE.**

**Geoapify Free is capped at 5 req/s**, so guide POI queries must run **SEQUENTIALLY with a
small gap** — reuse the LocationIQ ≥550 ms module-level gate pattern rather than fanning out.

**THE 20-QUESTION GUEST-CHAT BENCHMARK SET — agreed and recorded now, for B4 acceptance
testing:** 8 apartment-context questions (WiFi, checkout, door code and similar — **these must
come back identical in quality**, they are the regression guard); 6 POI-answerable (pharmacy
open Sunday, closest supermarket, café within walking distance, sushi tonight, something for
kids nearby, best bar); 6 live-web (events this weekend, is Temppeliaukio open now, airport
route, concerts tonight, weather tomorrow, tram status).

**TEST FIXTURE:** `ARR-EVT777` dates refreshed Aug 6 2026 via MCP — check_in Aug 5, check_out
Aug 9. (Standing rule: re-roll before any guest-page test.)

**~~NEXT ACTION — B2 / Step 4~~ — DONE Aug 6 2026** (`6baafe8` + `085ff2f`), and **B3 events on
Tavily is DONE too** (`5f15005` through `fc5c97e`, five rounds). **REMAINING in this plan: B4 /
Step 6** the chat router + host-picks — the 20-question benchmark above is its acceptance test —
then **Step 7** the self-attack drill (**remember the recorded stale-alarm residual list**) and
**Step 8** delete the `GEMINI_*` vars. **NOTE (Aug 10 2026): Step 6 is not the next action.** The
restructuring session, the guest-chat brake re-sizing and Commit B all precede it — see the top of
"OPEN ITEMS — PRIORITY CHANGES".

> Moved to docs/pilot-history.md — "PILOT STEP 5 — SHIPPED: city events on Tavily search + Groq extraction".
> Moved to docs/pilot-history.md — "B3.5 — THE LAST EVENTS ROUND: the prompt rebalanced for RECALL".
> Moved to docs/pilot-history.md — "B3.4 — the wrong-url blocker, theme diversity, the date window in code".
> Moved to docs/pilot-history.md — "B3.3 — RETRIEVAL quality fixed: the corpus was the problem".
> Moved to docs/pilot-history.md — "PILOT STEP 4 — SHIPPED: guide on Geoapify POI data + Groq prose".
> Moved to docs/pilot-history.md — "PILOT STEP 3 — SHIPPED + VERIFIED: provider abstraction + four surfaces on Groq".
## SPEND-ABUSE HARDENING — COMPLETE (Aug 5 2026) — CANONICAL SUMMARY

STATUS: Every expensive (grounded) Gemini surface is capped cross-instance; both pass-minting
doors are capped; sustained + cross-host (Sybil) detection is live; alarm remediation advice is
corrected. The fast-spend threat (running up the Gemini bill faster than Google billing/caps
react) is CLOSED on all pricey endpoints. Remaining items are low-value polish (see checklist),
none reopening the fast-spend risk.

> Mechanism detail — foundation, the seven brakes, detection/retention, client fix, deliverable, the superseded pre-billing checklist, residual and commit trail — is in docs/spend-hardening.md.

RULE: never share one counter key across a trust boundary (public flood must not eat the
host's own reserve).

FAIL-OPEN vs FAIL-CLOSED (do NOT "harmonise"): fail-open where blocking costs a host real work
(create-booking, sync-ical); fail-closed where the blocked behaviour is the free fallback
(greeting/chat/events). Fail-open is indefensible when the fallback is free.


VICTIM-vs-CALLER (operator safety, fa8fa32): victim-keyed alarms (guest-chat, daily-greeting,
city-events-public) say "INVESTIGATE, do not auto-block" (named host may be the victim: leaked
booking token, or public UUID) -> revoke booking token / rotate QR / block source per findings.
Caller-keyed alarms (create-booking, sync-ical, generate-guide, refresh-events) correctly say
"block this host". NEVER blanket-rewrite the caller-keyed ones. Classify by the ownership check
that precedes the bump, not the variable name (refresh-events passes apt.host_id but is
caller-keyed).

2x CEILING RULE: a counter unit != a Google call. Automatic retry (and empty-reply
fall-through) means real billed calls ~= 2x the limit; AbortSignal does NOT reduce Google
billing (SDK: client-only). Size Google per-project spend caps at ~2x the limits.


> Moved to docs/history.md — "SPEND-ABUSE ALARM + CALL COUNTER (Aug 5 2026)".
> Moved to docs/history.md — "SESSION Jul 29 2026 (2) — compliance pins + the guide became grounded".
> Moved to docs/history.md — "GUIDE GENERATION — MEASURED BEHAVIOUR (six live regenerations, Jul 29 2026)".
> Moved to docs/history.md — "CITY GUIDE — geocoding fix SHIPPED (`98017fe`)". The pre-live checklist below STAYS.
### PRE-LIVE ADDITIONS from this session (add to the pre-live checklist)

- **~~GUIDE GROUNDING / GUIDE QUALITY~~ — WORKSTREAM CLOSED (verified 30 Jul; see "SESSION
  Aug 4 2026").** No further prompt tuning on this endpoint; a thin category is answered by
  host picks, not by prompt work. **What REMAINS open is only the cost/model question:**
  grounding is free on the 2.5 line (1,500 RPD) but **ZERO on Gemini 3**, so the grounded guide
  is tied to `gemini-2.5-flash` and the 16 Oct 2026 shutdown — ~~re-test once billing is live~~
  **ANSWERED Aug 5 2026 by the ZERO-GOOGLE AI PILOT: the guide is rebuilt on POI DATA (Geoapify /
  LocationIQ) + a cheap LLM, so it needs no grounding at all — and because the coordinates come
  from the POI data, that structurally kills both the fabricated-business problem and the
  geocoding weakness.** See "MODEL-MIGRATION ANALYSIS" for the old framing.
- **NEW, minor: `coercePlaces` does not enforce the 5-per-category cap the prompt requests.**
  Harmless today — the post-retry total still cannot exceed `MAX_GEOCODE`.
- **`subscription_status` is DECOUPLED from the access gate.** `PrivateRoute` uses
  `needsPlan = !is_exempt && !is_demo && !stripe_subscription_id`. **Setting a host to
  'active' in the superadmin panel grants no access.** The operator set `is_exempt = true` on
  host `1d5a3b9c` (udy@tlv.capital) to work around this. **Either reconcile the two or make
  the admin panel warn.**
- **ALL DATABASE CONTENT IS TEST DATA created by the operator. There are no real users.**
  Decide before the Stripe flip whether to wipe or flag it — **this interacts with the
  retention gaps in the legal workstream below.**
- **NEW (Aug 14 2026) — READ ALL THREE AFFILIATE AGREEMENTS FOR THEIR OWN CONTRACTUAL DISCLOSURE
  REQUIREMENTS, SEPARATELY FROM STATUTE.** `736a715` fixed the commission disclosure against
  **Finnish consumer law** — which requires marketing to make clear its commercial purpose AND on
  whose behalf it is done, hence naming the beneficiary. **That is the statutory floor, not the
  contractual one.** Viator, GetYourGuide and Tiqets each impose their own affiliate-disclosure
  wording, placement and prominence terms, and a clause can demand MORE than the law does — none
  of the three has been read with this specific question in mind. **Pairs with the parked
  multi-tenant confirmation emails** (same threads, same recipients, so ask both questions at
  once). **Tiqets and GYG remain PARKED until go-live per Udy** — this is a pre-live checklist
  item, not a now item. Note the asymmetry already recorded: for Viator we hold a written ruling,
  for the other two only our own reading.

> Full workstream, all ten gaps and the document status: docs/legal-workstream.md.

