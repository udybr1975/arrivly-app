# Arrivly — CLAUDE.md

Historical session detail lives in docs/history.md. Read it only when past context is
needed. (Deliberately a plain filename, NOT an @import — an imported file is pulled into
context automatically every session, which is exactly what splitting this file avoided.)

Purpose-named files were split out at the 22 Aug and 24 Aug 2026 restructures. **NO RULE lives
in any of them** — every rule stayed here; those files hold only the reasoning behind one, and
every open item keeps its one-line statement here. Read one when you need to know WHY:
- **docs/pre-arrival-link-design.md** — the pre-arrival link design: the locked decision, the
  amendment that falsified part of it, and why each rule is shaped as it is. Read before
  changing that feature's shape.
- **docs/resolved-debt.md** — closed debt, each with what closed it AND how that was verified.
  Read before re-opening something that looks broken, in case it was already answered.
- **docs/events-system.md** (24 Aug) — the events / city-events measurements, arithmetic and
  accepted trade-offs behind those open items.
- **docs/guide-cron-debt.md** (24 Aug) — the guide-cron starvation detail, the `refreshed++`
  miscount and the capacity arithmetic, with enough detail to fix in ONE pass.
- **docs/pre-live-checklist.md** (24 Aug) — the argument behind each pre-live addition.
- **docs/spend-hardening.md** — the seven brakes, plus the six open residual items (24 Aug).
- **docs/design-backlog.md** — scoped-but-not-built work, plus the parked and landing/marketing
  narrative (24 Aug).

> **BRAND vs CODENAME (Jul 12 2026 — rebrand):** the **public brand = Bemgu** (domain **https://bemgu.app**, Resend sender **hello@bemgu.app**, registrar **Porkbun**). The **internal codename = arrivly** — the GitHub repo name (`udybr1975/arrivly-app`), `package.json` name, local folder `C:\dev\arrivly`, the Stripe **`metadata.app === 'arrivly'`** filter (case-sensitive, load-bearing in `api/stripe-webhook.ts`), every `arrivly_*`/`arrivly:*` storage key + window/DOM event, the `arrivly-v*` SW cache name, all env var NAMES, and every code identifier / CSS class deliberately KEEP "arrivly". **Never rename them.** User-facing strings (page titles, meta tags, email copy + sender, push titles, aria-labels, displayed URLs, the "Powered by Bemgu" footer, manifest name) are all "Bemgu".
>
> **Cloudflare Turnstile widgets are HOSTNAME-ALLOWLISTED.** Any domain change must repeat it or the demo money-gate shows "Unable to connect".
> **Supabase auth email routes through Resend Custom SMTP** (`smtp.resend.com:465`, user `resend`, sender `Bemgu <hello@bemgu.app>`) — the built-in mailer is not used.
>
> Domain migration + rebrand narrative (Jul 12-17 2026) and its 8/8 smoke tests: docs/history.md.
> **Repo note (Jun 5 2026):** The canonical repo is now `udybr1975/arrivly-app`. The old `udybr1975/arrivly` is abandoned (server-side corruption: pushes rejected "missing necessary objects", Settings page 500s; GitHub support ticket open). Local working copy: `C:\dev\arrivly`. Vercel project `arrivly` is connected to `arrivly-app`.
> **No secret values live in this repo — it is PUBLIC.** Server-side keys have no `VITE_` prefix and exist only in Vercel env vars. **VERIFIED AT SOURCE 14 Aug 2026** via the GitHub API — `"private": false`, `"visibility": "public"`, `created_at 2026-06-05`, i.e. public since creation, never flipped. `.gitignore` carries five `.env` ignore patterns plus a `!.env.example` negation, and no secret has ever been committed. Do not re-derive or soften this line.
> **Current HEAD — `401db9d`** (24 Aug 2026), Print relabelled "Print / Save as PDF"; `f3f49a9` the designed A5 guest card and `cc2aba6` the help-drawer refresh before it. **PUSHED — MEASURED, not recalled** (`git log --oneline origin/master..HEAD` empty after a fetch). **A DOCS TIP ABOVE THE CODE HEAD IS THE NORMAL STATE HERE, NEVER A MISMATCH** — this line exists for DRIFT DETECTION only. Full commit ancestry is in git; do not restate it here, and do not infer push state from any SHA quoted in this file.
>
> **WHERE THE PROJECT IS:** Phases A–E, G, H and Phase I Stages 0/4A/4B/5 are COMPLETE.
> Build order decided: **flip live on Tiers 1–3 FIRST, then build Phase F (Tier-4 booking)**
> — so the pentest gate runs on the Tiers 1–3 surface, and Phase F needs its own second
> security pass before Tier 4 is sold.
>
> **THE FOUR THINGS BLOCKING LAUNCH:** (1) ~~Gemini billing~~ — dissolved by the ZERO-GOOGLE AI PILOT; Google is leaving the stack, there is no billing flip. (2) the legal/compliance workstream — inventory DONE, **eight gaps open**, documents 3/4/5 DRAFTED but unpublished, (the retention crons that gated publication SHIPPED 11 Aug 2026). (3) the `gemini-2.5-flash` **16 Oct 2026** shutdown — **STILL BINDS, but the route is now DECIDED (OPTION A, 18 Aug 2026): repoint guest-chat to a current Gemini model AND make the model an ENV-CONFIGURABLE value**, so the next retirement is a dashboard change, not a code change. `api/guest-chat.ts:9` is today a hardcoded `const MODEL = 'gemini-2.5-flash'` on `GEMINI_API_KEY_CHAT` (project `gen-lang-client-0221179352`), verified in source, free tier, no card. Guest-chat remains the SOLE Google dependency. **The deadline did not go away; it acquired a decided route.** (4) the pentest gate. Also open but smaller: welcome-page Part 2 and the pre-live additions.
>
> Full session-by-session history — including the long HEAD chain this line replaced — is in
> docs/history.md.
>
> **Design system — GROUND TRUTH (verified from shipped `Layout.tsx`, S26):**
> - Host dashboard = **DARK sidebar + CREAM workspace** (NOT all-dark). Sidebar bg `#1c1c1a`, border `#322c25`. Workspace/main bg `#f0ede6`. Cards `#fffdf9`, hairline `#e4ddd0`.
> - Brass `#c8a24e` (active state + primary CTA), brass-deep `#a8842f`, brass-soft `#e7d6ad`. Text `#231d17`, muted `#6b6354`, faint `#b3aa9b`, label `#a79e8e`. Good `#5d7c34` on `#eaf0dd`. Private badge text `#8a1a1a`.
> - Fonts: Fraunces (display) + Inter (body), loaded globally in `index.html`.
> - In-page section nav (e.g. property editor) = **HORIZONTAL premium tabs, NOT a vertical rail**. Active tab = charcoal pill (bg `#1c1c1a`, text `#f0ede6`); inactive = hairline outline, muted text. Brass reserved for Save + accents. (A vertical rail was tried and rejected — read as a competing second menu.)
>
> **Colour model (per-property inherit / account default) — LIVE (shipped S27 2a `981bd5b`):**
> - `apartments.accent_color`: NULL = "inherit the brand default". `hosts.accent_color` = the account-wide brand default.
> - Guest page resolves colour as: `apartment.accent_color ?? host.accent_color ?? colourPresets[0].hex` (`#1c1c1a`) — wired in `GuestPage.tsx` (`accent_color` added to the Host type).
> - SECURITY DEFINER RPC `guest_host_card(p_apartment_id)` now ALSO returns `accent_color` (Migration B); `/api/guest-preview`'s host payload now surfaces `host.accent_color`. The coalesce is live on both the real guest page and the owner/admin preview.
> - **`guest_host_card` MASKS `whatsapp` FOR `is_public_demo` APARTMENTS (DB-side migration, 26 Aug 2026)** — it returns NULL there, real apartments on the same host are unaffected (each checked). **This is the ENFORCING fix; the `!isPublicDemo` guards in `GuestPage.tsx` are defence in depth and say so in the code.** The RPC is anon-callable, so a client-side guard alone would have hidden the number while still SENDING it. Note `api/welcome.ts` is a SECOND server reader of `hosts.whatsapp` and is NOT demo-aware — it does not matter today (the welcome code is a separate door) but it is the reason a future "hide the host's number" job must be scoped to all readers, not to this RPC.
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
- **THE `is_test` SYSTEM (23 Aug 2026) — FIXTURES ARE FLAGGED, NEVER DELETED.** `hosts.is_test`
  and `apartments.is_test`, both **NOT NULL DEFAULT false** and **server-only for WRITE**
  (`anon`/`authenticated` hold SELECT and nothing else — verified via `has_column_privilege`).
  **TRIGGER-MAINTAINED, and the asymmetry is deliberate:** an apartment created or updated under
  a test host is FORCED test, and flagging a host test CASCADES true to its apartments — but
  **never false**, so a mixed account keeps its apartment-level flags. Consumers: every cron
  filters `.eq('is_test', false)`; every HOST-FACING email is gated `!is_test` (admin
  email / ntfy / audit still fire, deliberately — the operator must still see the machinery run);
  admin-overview metrics exclude test hosts. **A test host RESTS AT active + exempt with NULL
  Stripe refs — that is the SANCTIONED state, not a phantom subscription to be reconciled.**
  Live state 26 Aug 2026: **1 real host, FOUR real properties** (`8ad00130` charming 1908 studio,
  `d273d7d4` Beautiful private space, `51a8b817` Cozy Studio in central Helsinki, `a1b1f547`
  Charming Studio for couples — the fourth was created 25 Aug 2026 and is a REAL property, not
  drift). Apartment totals: **14 total, 5 visible, 10 `is_test`.**
  **NOTHING WAS DELETED HERE** — the fixtures are the only regression corpus this project has,
  several are load-bearing, and they stay, flagged. (The ONE deliberate exception is Sweet home
  `d9614d11`, rebuilt in place on 26 Aug 2026 as the public demo — see the fixture rules and
  docs/history.md. That was a decision, not a cleanup, and it does not license another.)
- **TWO DEMO FLAGS, DIFFERENT THINGS — NEVER CONFLATE (26 Aug 2026).** `hosts.is_demo` = a
  **48-hour SANDBOX HOST** (a stranger who signed up at `/demo`; real AI, real two-way messaging,
  their own dashboard, expires). `apartments.is_public_demo` = the **LANDING-PAGE PEEK FIXTURE**
  (one shared apartment, scripted chat, messaging off, no expiry). They were nearly given the
  same name; the migration was renamed before any code referenced it for exactly this reason.
  Both are excluded from `experience_clicks`, and `is_demo` is excluded from admin totals.
  **THE RULE THAT DECIDES THE SHAPE, hoisted 26 Aug 2026 out of the moved 25 Aug design block:
  A PUBLIC QR CANNOT BE TWO-SIDED** — one shared apartment means one shared or fake inbox, so the
  peek is one-sided (messaging OFF, a public token must never reach a host inbox) and the SANDBOX
  is the two-sided demo. **Re-confirmed 26 Aug, not reopened; do not try to make the peek
  two-sided.**
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

Full per-host enumeration, the Airbnb CSV names and the pending badge-cleanup list are archived in
docs/history.md — "Test Data (in DB) — full enumeration as of 18 Aug 2026". **Row-level detail rots
within days; only the rules below are durable.**

**Apartment ids** (stable, used by every manual test):
- Sweet home `d9614d11-d573-4ff0-961a-54c5ea37c2bd` (Helsinki) — **NOW THE PUBLIC DEMO FIXTURE,
  see the rule below; it is no longer an ordinary test flat** · Test Apartment 1
  `aaaaaaaa-0000-0000-0000-000000000001` (Kallio) · Casa Marco
  `d81e4e89-385a-4886-b461-ba952c78e7f8` (El Born Barcelona) · Maison Lumiere
  `d7f47672-fde5-4da1-91ae-0f9f774732fd` (Le Marais Paris) · Penthouse in the sky
  `9b03a763-3ca6-4d1f-946c-d4e1f977d614` · Anna Stays `eab1e358-…` (Vantaa/Hakunila).
- **Test guest URL:** `/guest?apt=aaaaaaaa-0000-0000-0000-000000000001&token=ARR-TEST01`
- **Welcome codes:** Sweet home `XJ8SSKFH` · Casa Marco `962SM37Y` · Penthouse `3RV23Y2C`.
  **Casa Marco and Penthouse are UNPUBLISHED since 23 Aug 2026** (`is_visible = false`), so their
  guest and welcome pages resolve to the unavailable/neutral screens until republished. The codes
  are unchanged and still correct — republish the apartment before using either.

**Live plan values (confirmed S12, hard gate CLOSED):** Tier 1 €10/cap 2, Tier 2 €15/cap 7,
Tier 3 €25/cap 12, Tier 4 €49/unlimited; `app_settings.trial_days` = 14. **The official base
values — do not change without an explicit decision.**

**THE FIXTURE RULES — these are what survives, not the dates:**
- **FIXTURES SURVIVE RETENTION BY DATE-REFRESHING, NEVER BY EXEMPTION.** An exemption makes the
  published privacy notice false for everyone. **Re-roll dates before any guest-page test.**
- **`ARR-NOA001` NO LONGER EXISTS (26 Aug 2026) — and its absence is CORRECT.** It was the C8
  cancelled-conversation fixture on Sweet home, and it went with the 95 bookings deleted when that
  apartment was rebuilt as the public demo. **Do not rediscover it as a missing row and re-create
  it** — re-creating it would put a second booking on a PUBLISHED apartment. If the
  cancelled-conversation rule ever needs a fixture again, build it on a test apartment, never on
  `d9614d11`.
- **Test Apartment 1 is DELIBERATELY geocoded to Vantaa** — a side effect of running D9 from the
  exempt admin account, kept as a fixture. **This is not drift; do not "correct" it.**
- **`ARR-FUT001` (Casa Marco, 23-26 Aug) is the PRE-ARRIVAL fixture** — a future-dated valid token
  resolving to the public tier.
- **`ARR-IMP301` DOES NOT EXIST in `bookings`, and its ABSENCE IS CORRECT.** The fixture list
  over-claimed it; nothing references it. **Do not "rediscover" it as a missing row and
  re-create it.** (Hoisted 24 Aug 2026 out of the 23 Aug (2) session record before that block
  moved to docs/history.md — it existed at exactly one site.)
- **`ARR-PAR777` / `ARR-BCN777` are KEEP-PERMANENTLY** live/active/thank-you-state fixtures.
  Re-roll their dates when they lapse; never delete them.
- **`ARR-EVT777` ON SWEET HOME IS THE PUBLIC DEMO FIXTURE (landing QR) — NOT a test fixture, and
  the date rule does NOT apply to it (26 Aug 2026).** `apartments.is_public_demo = true`, and it
  is the ONLY row that carries that flag. **ALL DATA ON IT IS INVENTED.** No iCal feed, no
  street, no WhatsApp, ONE booking. **The token is deliberately PUBLIC** and resolves on any
  date — `resolveGuestAccess` skips the date bound for this apartment — so there is nothing to
  re-roll and a lapsed-looking date is the fixture working.
  **NEVER attach a feed, a real address, real check-in details or a real stay to it**, and
  **NEVER re-add `is_public_demo` to the host column allowlist.** Flagging an apartment publishes
  EVERYTHING already on it, not just the one token the landing page prints: every
  confirmed/completed booking on a flagged apartment becomes a permanent verified credential.
  Full reasoning in `api/_lib/public-demo.ts`; the rebuild that produced it is in docs/history.md
  (26 Aug 2026).
- **Roy's `property_cap_override` was set to 2 for D8 and REVERTED to null** — verified reverted.
- **THE THREE PRE-ARRIVAL CLAIM FIXTURES, on "charming 1908 studio" (renamed from "importer
  test" 23 Aug 2026; welcome code `DX89PW3H` UNCHANGED). ALL
  CREDENTIALS FABRICATED — shape only, no entropy from any real feed. Udy keeps all test data;
  never suggest deleting these.** Verified in the DB 23 Aug 2026:
  - **`ARR-ACT501` / `TESTACTIVE1` — KEEP PERMANENTLY.** 22-26 Aug. **Its dates are MOVED BY HAND**
    to exercise preview / active / thankyou in turn, so a date that looks stale here is the
    fixture working, not drift.
  - **`ARR-IMP401` / `TESTCLAIM1`** — 19-23 Aug, checked out 23 Aug, the thankyou fixture.
    **BUT "permanent thankyou" IS NOT A THING THE DATA CAN DO:** `welcome-claim` reaches thankyou
    only between 11:00 and midnight Helsinki on CHECKOUT DAY (`check_out >= helsinkiToday`), so
    from 24 Aug this resolves to a MISS. **Re-roll `check_out` to today to test that state.**
  - **`ARR-PRE901` / `TESTFUTURE1`** — 21-25 Sep, `link_claimed_at` deliberately still NULL.
    **The clean PREVIEW control — do not claim it**, or the only unclaimed fixture is gone.
- Cron sequential loops in `cron-sync-ical` AND `cron-refresh-events` share the "batch at scale / maxDuration" debt — fine at current apartment counts; batch before many booked apartments. (Phase G cron-batching item.) **⚠ NO LONGER "fine at current counts" FOR `cron-refresh-events` (Aug 6 2026): at B3.3+ prompt sizes its `mapPool` concurrency of 2 EXCEEDS the Groq org TPM ceiling deterministically (2 x ~7.6k debit, measured Aug 10, against what was then 12K TPM — **the ceiling is now 8,000 TPM, VERIFIED 17-18 Aug 2026, so the margin is TIGHTER not looser and concurrency 1 is the only width that fits**), so a multi-candidate run is expected to 429 AND starves guest-chat / guide / daily-greeting across every tenant while it runs. Fix is `concurrency: 1`, and it is the top of this debt — see "SESSION CLOSE Aug 6 2026" open item 1.**
  **PARTIALLY CLOSED, VERIFIED AT SOURCE 22 Aug 2026:** `cron-refresh-events` now calls
  `mapPool(units, 1, …)` — concurrency IS 1, so the TPM half of this debt is done. The
  `cron-sync-ical` batching half is **UNVERIFIED AT THE RESTRUCTURE** and stays open.
- `city-events` lazy-fill: the FIRST guest to view an uncached apartment waits ~the generation time (one-off); the cron pre-warms apartments with current/upcoming bookings so most are already warm.
- **`cron-refresh-events` / `cron-refresh-guides` schedule vs the Gemini quota-day — CLOSED
  (`dbfc034`, Jul 28 2026).** Narrative and the original incident moved to
  **docs/resolved-debt.md**. The surviving rule: both Gemini crons run AFTER the Pacific
  free-tier reset (`0 9 * * *` events, `0 10 1 * *` guides) and each reads its OWN key, so
  neither reschedule is neutralised by key-sharing.
- Re-saving house rules re-polishes already-polished text (Gemini call on every save). Minor; acceptable for now.
- iCal fetch (`api/_lib/ical.ts`, used by both sync-ical and cron-sync-ical): mild SSRF (no
  private-IP/metadata blocklist on fetched URLs); no per-host rate limit. The monthly cron now
  exercises this unattended. Tidy SSRF + rate limit before public launch.
- `sendPushToHost` url check uses `startsWith('/')`, which also admits protocol-relative `//host` — only ever set from the host's own send-push request (self-targeted), so negligible.
- send-push `apartmentId` is not ownership-checked — latent only (lookup forces `host_id = userId`, so a foreign apartmentId matches zero rows).
> Two items VERIFIED RESOLVED at the 22 Aug restructure and moved to **docs/resolved-debt.md**
> with the grep that closed each: `BookingManager.tsx`'s `arrivly:messages-read` cancellation
> signal, and `PropertySetup.tsx`'s load-effect cancellation guard. Both are fixed in the
> shipped code; the entries are kept as evidence, not as work.

- `api/guest-chat.ts` (S21): verify-gated (public tier → `403 verify_required` before any Gemini call) + per-instance rate limiter (15/min, apt+IP) + dedicated `GEMINI_API_KEY_CHAT`. The limiter is per-instance best-effort, not a hard cross-instance cap. `generate-guide` remains host-auth+ownership-gated (no public AI-spend surface).
- **Retention crons SHIPPED (11 Aug 2026)** — `cron-cleanup-messages` (30d) and `cron-retention` (guest identities 30d, greetings 30d, guest push 7d, admin audit 365d). **The periods are a PUBLISHED PROMISE** in the guest notice §6 and in the Art. 30 record: change a constant and the document in the SAME commit, or neither. **No exemptions, ever** — a carve-out makes the notice false for everyone; fixtures survive by refreshing their DATES.
- sw.js `showNotification().then()` — if showNotification rejects, badge is not set and the rejection is swallowed by `event.waitUntil`; low risk, standard SW pattern (W2, `c294bda`).
- `countUnread` in `Layout.tsx` called directly from event listeners with no mounted guard at call site — safe because `mounted` flag is closed over and listeners are removed on cleanup before it matters; no real bug (W3, `c294bda`).
- **The address-swap gate has a DECLARED LIMITATION, not an oversight (shipped `34e79c3`):**
  a swap to another flat in the SAME city, under 1km, is NOT stopped. The trigger
  `enforce_property_address_swap()` blocks a >1km coordinate move or a city/country text
  change, and only for a host AT their property cap (`service_role`, `is_exempt` and
  `is_demo` exempt). **It defends the CAP against city-scale swaps; tightening it further
  would block genuine address corrections.** The function is INVOKER rights and that is
  load-bearing — see the SECURITY DEFINER lesson.
- **RESIDUALS FROM `60a4c2b` (the four UI items) — six items, one line each; full argument in
  docs/resolved-debt.md under "STILL-OPEN residuals".**
  - `Messages.tsx` still carries its own `isBlockSource`/`sourceColor`/`sourceLabel` now that
  `bookingChrome.ts` exists, and its `sourceLabel` DIVERGES — unreachable today, **one import
  from fixed, and a latent trap until it is.**
  - The `ARR-` token now renders VISIBLY on hover in the availability picker — same trust
  boundary and same data the list view shows openly; added risk is shoulder-surfing only.
  - Neither calendar has `role="grid"` / roving tabindex — every cell is a real button with a
  focus ring and full `aria-label`, so the accessibility floor is met. An improvement, not a fix.
  - `fmt()` parses `new Date('YYYY-MM-DD')` as UTC and formats locally — off by one day for a
  negative-UTC viewer. Pre-existing, shared by three surfaces.
  - The picker's `nightMap` caps expansion at 800 nights, so a genuine multi-year block draws its
  later nights free. **Degrades to a 409, never to a double booking. There is NO server-side
  maximum stay length, which is what makes the cap reachable at all.**
  - `void loadBookings()` on the 409 is unsignalled — A's rows could land after B's.

- `api/public-pricing.ts` cache is `s-maxage=60` — admin trial/price edits show on the landing within ~1 min.
- **npm vulnerabilities — the superseded 8-count and the tool-counting explanation moved to
  **docs/resolved-debt.md**. THE LIVE NUMBER IS IN THE QUEUE (GitHub's 16), and the
  npm-audit-vs-Dependabot gap is a counting difference, NOT drift — do not re-litigate it.
- **Redundant root `as any` in `api/stripe-webhook.ts` blunts a compile-error canary.** `types/Subscriptions.d.ts` declares `current_period_end` on the root, so that read compiles uncast; the cast's only effect is to SUPPRESS the error a Basil-typed SDK bump would raise there — the exact migration signal `api/_lib/stripe.ts` preserves and tells you not to cast away. **One-token removal, no runtime effect** — take it on the next non-comment edit to that block.
- **First real `invoice.payment_succeeded` after `7f3dac5` is worth watching in the Vercel logs.**
  **UNVERIFIED AT THE 22 Aug 2026 RESTRUCTURE** — settling it needs the Vercel runtime logs,
  which cannot be read from the repo, so it stays open by the restructure's own rule. That path has NEVER executed on this endpoint (the pre-Basil field read resolved null and returned 200), so nothing downstream of the id extraction has run here. Specifically check it resolves the CURRENT subscription, not a superseded one — see the `sub.id` item under Tracked security follow-ups.
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

### Supabase, RLS & the database

- **SECURITY DEFINER MAKES `current_user` THE FUNCTION OWNER — A GATE THAT INSPECTS ITS CALLER MUST
  BE INVOKER RIGHTS (Aug 14 2026).** Under DEFINER any exemption keyed on `current_user` /
  `session_user` / `auth.uid()` / a role check matches EVERY call, so the gate is inert while
  looking correct and running clean. **DEFINER is for functions that ACT beyond the caller's rights;
  INVOKER is for functions that JUDGE the caller** — a function doing both is a design error. Prove
  any caller-keyed exemption by a behaviour test from each side of the boundary, never by reading
  the function.

- **A REVOKE ONLY REMOVES A GRANT AT THE LEVEL IT WAS MADE, AND YOU CANNOT TELL WHICH LEVEL WITHOUT
  LOOKING — BOTH DIRECTIONS HAVE BITTEN (Aug 14 2026).** Supabase grants EXECUTE to `anon` and
  `authenticated` BY NAME on every new public function, so `REVOKE … FROM PUBLIC` is a silent no-op
  against them; a grant inherited via PUBLIC (ACL `=X/owner`) is untouched by `REVOKE … FROM anon,
  authenticated`. A SECURITY DEFINER writer (e.g. `reconcile_ical_bookings`) or retention function
  left callable by `anon` is a service-role write path behind the public key. **Revoke from `anon,
  authenticated, public` explicitly; then confirm from `pg_proc.proacl` / `relacl` /
  `has_function_privilege` (anon=false, authenticated=false, service_role=true) and diff against a
  known-good object.** Owner + `service_role` keep their grants; trigger functions fire as owner
  regardless. Statement success is not evidence.

- **Record the RLS policy PREDICATE, never the app's query.** The app's `.eq()` is a convention; the predicate is the boundary. Describing policies by app behaviour is what hid a cross-tenant leak through a full security audit.

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

- **Anything the guest page must show from `is_private=true` rows needs a server endpoint with the
  booking token as the credential.** Anon RLS on `apartment_details` (`USING (is_private = false)`)
  means private rows never reach the browser, so client-side filtering cannot surface them. The only
  pattern: a token-verified endpoint (`resolveGuestAccess`) using the service-role client, returning
  private rows only for the verified booking.

- **THE COORDINATE GATE (`422cc65`, 23 Aug 2026) — EXACT COORDINATES *ARE* THE STREET ADDRESS.**
  `api/guest-bootstrap.ts` includes `lat`/`lng` **iff** `apartments.welcome_show_address = true` OR
  the request carries a token that `resolveGuestAccess` rates `verified` (confirmed/completed **AND
  in dates**). Otherwise both fields are OMITTED (absent, not null, like `api/welcome.ts`); a wrong
  token is byte-identical to no token. **The date bound is the whole point:** `welcome-claim` hands
  the `ARR-` token to any confirmation-code holder before arrival, and `welcome.ts` refuses that
  same person the address — a status-only gate reopens the bypass through the token door and makes a
  completed booking a coordinate credential forever. **Reuse `resolveGuestAccess`; never
  re-implement a looser copy.** `anon` has no SELECT on `apartments`, so no RLS path routes around
  this.

- **Guest booking-state is resolved server-side via `api/guest-state.ts` (S19), never by reading `bookings`/`guests` from the client.** The anon `bookings_guest_read` policy is gone. GuestPage calls `/api/guest-state` (plain fetch — guests have no auth session) in two stages: token path, then a KEYED date path gated by the per-apartment `apartment_qr_secrets.qr_secret` carried in the QR URL as `?key=`. An apt-only URL with no token and no valid key resolves to the neutral page by design. Every non-active outcome returns an identical flat neutral body so the endpoint leaks nothing.

- **`guests` is server-write-only (`api/create-booking`) with a host-scoped SELECT policy (S24).** Never reintroduce a client-side `guests` insert/read, or a `USING(true)` policy. One guest row per booking; no cross-host first-name dedup. The host-scoped SELECT (`id IN (select b.guest_id from bookings b join apartments a on a.id=b.apartment_id where a.host_id = auth.uid())`) keeps the bookings-list and Messages `guests(...)` embedded joins working because they only ever surface the host's own bookings' guests.

- **`hosts` AND `apartments` USE COLUMN-LEVEL INSERT/UPDATE ALLOWLISTS — NEW COLUMNS DO NOT INHERIT
  THEM (Jul 26 / Aug 23 2026).** Table-level INSERT and UPDATE are REVOKED from `authenticated`,
  `anon` and PUBLIC on both tables and re-granted per column; server-only columns (`tier`, `plan`,
  `subscription_status`, `stripe_*`, `trial_ends_at`, the notice/pending/cancel columns, `is_test`)
  are deliberately withheld. **Any migration adding a client-writable column on either table MUST
  include `GRANT UPDATE (col) ON public.<table> TO authenticated`** (and INSERT where the client
  inserts) — RLS alone is not sufficient because PostgREST also needs the column privilege, and the
  symptom is a silent 403 in the editor. It has bitten on both tables (three `*_partner_id` columns
  on `hosts`, corrective migration `grant_host_partner_id_column_update`). Confirm with
  `has_column_privilege()` / `information_schema.column_privileges` after every such migration.

- **WORKFLOW — migrations belong to Claude-in-chat via Supabase MCP, NOT to Claude Code mid-build.** In Stage 4B a needed corrective migration was applied by Claude Code during the build. The fix was correct and verified, but the rule is: **if a migration turns out to be needed mid-build, STOP and report back** rather than applying it. Future code prompts must state this explicitly (reader-migration-first sequencing stays a chat-side responsibility).


### Stripe & billing

- **Stripe Basil API (2025-03-31) moved `current_period_end` off the subscription root onto `sub.items.data[0]`**. Read item-level with a root fallback: `(sub.items?.data?.[0] as any)?.current_period_end ?? (sub as any).current_period_end ?? null`. Use `as any` casts deliberately — the installed Stripe SDK types and the account's runtime API version differ.

- **Stripe webhooks on Vercel require a raw body stream.** Set `export const config = { api: { bodyParser: false } }` and read the body manually with a stream-to-Buffer collector. `webhooks.constructEvent()` rejects any pre-parsed body.

- **Subscribing via Stripe Checkout starts the subscription in `trialing` status, not `active`.** `subscription_status` stays `'trial'` (not `'active'`) until the trial converts at the trial end date. This is expected — not a webhook bug. The `BillingPanel` trial banner is driven by `trial_ends_at` from the DB, not by `subscription_status`.

- **Stripe subscription schedule `iterations:1` with a historical `start_date` applies the new price immediately.** When creating a deferred switch from an existing schedule (`from_subscription`), the schedule already has `phases[0]` with `start_date` = current period start (historical) and `end_date` = current period end (the real billing boundary). Always rebuild the phase using `schedule.phases[0].start_date` + `schedule.phases[0].end_date` explicitly. Never use `iterations` — it counts forward from `start_date`, which is in the past, so the phase is instantly over. If `p0.end_date` is absent (shouldn't happen on a real schedule), fall back to `sub.items.data[0].current_period_end`, then `now + 30d` with a warn log.

- **`api/cancel-subscription.ts` release-then-cancel (S15, replaces the old 409 guard).** If a subscription schedule is attached, RELEASE it first (`subscriptionSchedules.release`) and clear `pending_tier`, THEN set `cancel_at_period_end`. Releasing before the cancel flag is mandatory — a live schedule and `cancel_at_period_end` on the same period end produce undefined Stripe behaviour. The host no longer has to undo a pending change before cancelling; the cancellation email notes the scheduled change was also cancelled when one existed.

- **Stripe secret key and webhook secret MUST point at the same Stripe environment.** A mismatch
  passes `constructEvent()` but fails `subscriptions.retrieve()` — the webhook 500s on every event
  ("subscription retrieve error", not a 400) and the DB never updates. After any Stripe key change,
  replay one subscription event and confirm webhook 200 AND a host-row update.

- **`plans.price_cents` is DISPLAY-ONLY; it does NOT control what Stripe charges.** The charged amount comes from the Stripe Price objects in env `STRIPE_PRICE_TIER_1/2/3` (`api/_lib/stripe.ts`). Editing the DB price only changes what the landing + plan cards SHOW. To change a price for real: (1) create a NEW Stripe Price (immutable), (2) update `STRIPE_PRICE_TIER_n` in Vercel + redeploy, (3) update `plans.price_cents` for display — Stripe first/together. Existing subscribers stay on the old price unless migrated. `app_settings.trial_days` needs NO Stripe action (trial applied per-sub at creation via `trial_end`; new signups only). Tier 4 has no Stripe price env; `create-subscription` returns `booking_tier_unavailable`.

- **Test/clock subscriptions need `metadata.app = arrivly` (exact lowercase — see BRAND vs CODENAME)
  AND `metadata.host_id = <uuid>`**, or the webhook ignores them with a silent 200.

- **Signup does NOT create a Stripe subscription** — but `/choose-plan` is **step 2 of 2** and Stripe Checkout **captures the card there**; the dashboard is gated on `stripe_subscription_id`. **"No card needed" is FALSE anywhere in the product; the true wording is "no charge today"** (the 48-hour `/demo` sandbox is the ONE exception — it is genuinely card-free). `Signup.tsx` only fires `/send-welcome`. A subscription exists only after a completed Checkout (`create-subscription`). Subscribing during the trial carries the remaining trial via `trial_end` → status stays `'trial'` (no charge) until the trial date, then converts to active.

### AI providers & spend

- **BUDGET PARITY COVERS RETRIES AND TIMEOUTS. IT NEVER COVERS TOKEN COUNTS (Aug 18 2026).**
  `_lib/greeting.ts` inherited `maxTokens: 128` from the Gemini branch, whose 128 only works because
  it also sets `thinkingBudget: 0`. On gpt-oss, reasoning is billed INSIDE `completion_tokens`, so
  thinking and answering share one allowance and 128 is starved. **Size a token budget per provider
  from that provider's token semantics; parity applies only to attempt count and per-attempt
  timeout.** The failure is silent: `groqGenerate` returns `content ?? ''` on a 200, so `withRetry`
  never fires — only the budget and a `console.error` on the empty path can reveal it.

- **gemini-2.5-flash thinking is ON by default** and consumes the output token budget, returning
  empty text on large/JSON generations. Always set `thinkingConfig: { thinkingBudget: 0 }`.
  Working pattern: `responseMimeType: 'application/json'` + `thinkingBudget: 0` + JSON shape in
  the prompt + defensive parse. Do NOT use `responseJsonSchema` (unreliable with thinking off).

- **Guest-facing AI context is gated server-side, never client-side.** `api/guest-chat.ts`
  takes only `{ apartmentId, token }` from the browser; the server resolves the access tier
  (`api/_lib/guest-access.ts`) and filters private `apartment_details` before building the
  prompt, so a public caller can't obtain private rows by tampering with client state. Keep the
  tier/context logic in that one file so the Tier-2 upgrade is additive (new tiers,
  email+reference) with no change to the endpoint or the chatbot UI. Grounded chat (googleSearch)
  cannot use `responseMimeType` — return plain text and strip `**`.


- **Gemini throws transient 5xx errors intermittently.** Wrap all `ai.models.generateContent()` calls with `withRetry` (`api/_lib/retry.ts`). Size the per-attempt AbortController timeout and retry count to fit within the function's `maxDuration` (e.g. 3 × 10s for rewrite-rules, 2 × 20s for guide).

- **Public guest-facing AI endpoints are spend-gated by verifying the booking token BEFORE the model
  is called, not by rate-limiting.** `api/guest-chat.ts` returns `403 verify_required` for the
  public tier before any Gemini/brand/prompt work (same gate as `daily-greeting`). The per-instance
  limiter (15/60s, apartmentId+IP) is a second, BEST-EFFORT layer: Vercel spreads requests across
  lambda instances with separate in-memory Maps, so the 429 is not a hard cross-instance cap.
  Verify-gating is the real spend control.

- **Keep every high-volume or public AI surface on its OWN key/project.** A shared key lets one
  surface's daily quota exhaustion take down the others — it happened (25 Jun 2026: the events cron
  429'd every apartment on the shared key and fired the "all refreshes failed" alarm; closed by
  `acd16f4`). Provider-independent; key table under "ZERO-GOOGLE AI PILOT -> MECHANISM".

- **Gemini free-tier quota is a DAILY cap; exhausting it surfaces as intermittent guest-facing 500s,
  not a code bug.** A burst of ~18 calls can exhaust it; later calls return `429 "exceeded your
  current quota"` (plus transient `503`), surfaced as 500. The cap does not reset within minutes.
  Before blaming app code, read the upstream Gemini status in Vercel runtime logs; a
  dedicated/billed key is the fix.

### PWA, push & service worker

- **`public/sw.js` must NEVER cache cross-origin requests.** Guard at the top of the `fetch`
  handler: `if (url.origin !== self.location.origin) return` — returning without `event.respondWith`
  hands the request to the browser natively. **Bump `CACHE_NAME` (`arrivly-v*`) on EVERY `sw.js`
  change** so the activate handler purges stale caches; read the current value from the file, never
  from a note.

- **Host app-icon badge is numeric and owned by `Layout.tsx`** (`navigator.setAppBadge(count)`). It updates only while the dashboard app is open — the SW deliberately does NOT badge host (/dashboard) pushes, so a closed dashboard icon lags until reopened. The in-app sidebar count pill is the live indicator.

- **Guest badge is DOT-ONLY** (`setAppBadge()` — no arg), set by SW on /guest push, cleared on page open. Persists until next open if the notification is dismissed without tapping. All Badging API calls are guarded (`'setAppBadge' in navigator / self.navigator`) — silent no-op on unsupported platforms.

- **Guest web push is PER-CONTEXT.** A browser tab and the installed WebAPK each hold their OWN push subscription (separate FCM endpoints — verified in `push_subscriptions`). Enabling notifications in a tab does NOT carry into the installed app, and vice-versa; the guest must enable push in the context they actually use. UX implication: in a tab offer **Install the app**; in the installed app offer **Turn on notifications**.


### Client & API conventions

- **EVERY AI CHAT SURFACE CARRIES A PERSISTENT "AI assistant" LABEL IN FIXED INK** — never the
  host accent and never white-on-accent, because a host-typed hex has no verifiable ratio
  (measured: 1.44:1 white on a pale accent, 1.38:1 accent-as-text). Three surfaces are labelled
  (`guest-chat`, `welcome-chat`, `guide-assistant`); **a fourth inherits the obligation, and
  "host-facing" is NOT an Art. 50 carve-out.**
- **BLURB PLACE-CLAIMS ARE GEOCODE-VERIFIED, FAIL-CLOSED** — every place named in a
  `greeting_blurb` is geocoded and distance-checked at ≤1.5km, a geocode failure counts as a
  failure, and the fallback names no places. **Do not bypass this in a future `greeting.ts`
  edit:** two shipped blurbs claimed ~3km and ~2.5km landmarks as "a stone's throw" and "just
  steps".

- **Supabase Storage rejects the host's gotrue user JWT on this project.** Never upload with an anon/host session — mint a server-side signed upload URL via `api/create-upload-url.ts` (service-role) and use `uploadToSignedUrl`. Also lifts the Vercel 4.5 MB body limit. Evidence in docs/learnings.md.

- **Calendar/date math must use device-LOCAL `YYYY-MM-DD`, not `toISOString()`.** `new Date(y,m,d)`
  is local midnight; `.toISOString()` then converts to UTC and shifts the day back for every
  positive-UTC host (Helsinki/Barcelona/Paris — the whole market). Build the string from local
  `y/m/d` parts to match how `check_in`/`check_out` are stored and compared.

- **`vercel.json` `functions{}`: never list a specific file pattern alongside the `api/**/*.ts`
  glob** — Vercel rejects overlapping patterns and the build fails. Use one glob, raise its
  `maxDuration`.

- **`src/lib/api.ts` already prefixes `BASE = '/api'`** — callers must pass the path **without** a leading `/api` (e.g. `api.post('/send-welcome')`). Passing `/api/send-welcome` produces `/api/api/send-welcome` (404) — silently swallowed by a `.catch(() => {})`. Always check the helper before writing a new call.

- **A Vercel environment-variable change only takes effect after a redeploy.** Adding or rotating a secret in the Vercel dashboard does not hot-reload running functions. Trigger a redeploy (push a commit, or use the Vercel dashboard "Redeploy" button) immediately after any env-var change and confirm the new deployment is READY before testing.

- **`api.post` / `api.get` throw `new Error(rawResponseText)` on non-2xx.** To extract a typed error code in a component: `JSON.parse(err.message)?.error`. This is the only safe pattern — the error body may not be valid JSON (network errors, Vercel 5xx HTML), so always wrap in try/catch with a JSON.parse guard.

- **Guests have no auth session — `src/lib/api.ts` attaches the logged-in Bearer.** Guest-page calls to token-gated endpoints (e.g. `api/guest-details`, `api/guest-message`) must use plain `fetch()`, NOT `api.get()` / `api.post()`. Using `api.get` from a guest page would send a null/empty Bearer header — the endpoint would behave differently from its intended unauthenticated path.

- **LocationIQ geocoding (S19).** `api/_lib/geo.ts` uses the EU endpoint `eu1.locationiq.com/v1/search?key=…&q=…&format=json&limit=1`. The response is a JSON ARRAY; lat/lon come back as STRINGS and the longitude field is `"lon"` (NOT `"lng"`) — parse with `Number()` + `Number.isFinite` guards on both. The key sits in the URL, so the function must stay SILENT (no logging on any path). Free tier ≈ 2 req/sec; the module-level rate gate spaces request START times ≥550ms so concurrent fan-out callers (guide, host-picks) throttle automatically with no caller changes. Best-effort, never throws, returns null on every failure.

- **Logged-out landing reads DB values via a service-role endpoint, not RLS.** anon can't read `plans` or `app_settings`; expose only marketing-safe fields through `api/public-pricing.ts` — same pattern as `guest-availability`.

- **Vercel strips `s-maxage`/`stale-while-revalidate` from the browser-facing `Cache-Control`** (edge honours them; client sees only `public`). The authenticated Vercel MCP fetch ALSO bypasses the CDN cache (always MISS) — verify caching from a real browser. A new deploy purges the edge cache. With `s-maxage=60`, admin edits surface on the landing within ~1 min.

- **Windows PowerShell dev-env gotchas.** `npx` can fail with `npx.ps1 cannot be loaded` (unsigned,
  or downloaded-from-internet flag) — use `npx.cmd`, or `Unblock-File` / `Set-ExecutionPolicy -Scope
  CurrentUser RemoteSigned`. `curl` is an alias for `Invoke-WebRequest` — use `curl.exe`. Inline `-d
  '{json}'` mangles quotes — write the body to a file and pass `--data "@file"`.

- **`CRON_SECRET` AND EVERY OTHER SENSITIVE-FLAGGED VERCEL VAR CANNOT BE READ BACK — MANUAL CRON
  INVOCATION IS IMPOSSIBLE, STOP PLANNING IT (Jul 27 / Aug 14 2026).** `vercel env pull` writes them
  EMPTY and the dashboard hides them (Stripe, Viator, Tiqets keys included — write-only once set).
  The `Authorization: Bearer <CRON_SECRET>` header a cron guard needs cannot be reconstructed
  without rotating the secret, which invalidates running crons until the redeploy lands. Two
  sessions planned "trigger it by hand" as a verification step and it was never available. **Verify
  crons from their RUNTIME LOGS (Vercel MCP / dashboard). The alternative is a deliberate decision
  to unset Sensitive on this one variable — drifting into planning manual invocation a third time is
  not.** (`api/backfill-canonical-city` is blocked on this decision.)

- **`overflow-auto` DOES NOT MEAN THAT ELEMENT SCROLLS (Aug 12 2026).** An element scrolls only if
  it can be SHORTER than its content. `Layout`'s root is `flex min-h-screen` (a MINIMUM), so `<main
  class="flex-1 overflow-auto">` stretches to its content and its `scrollTop` is permanently 0 — a
  `<main>`-targeted scroll-reset shipped as a silent no-op; `window.scrollTo(0, 0)` is correct,
  because the DOCUMENT scrolls (the `md:sticky` sidebar only works that way). Checking that
  `overflow-auto` is present is not checking who scrolls.

### Method & process

- **FIXTURE DATA INVENTED FOR A MOCKUP IS NOT EVIDENCE ABOUT PRODUCTION (Aug 18 2026).** A comp's
  invented sample bookings were described as "the real Sweet home calendar"; the comp was fine, the
  SENTENCE around it made a checkable claim about live data that was never checked. **Label comp
  fixtures as fixtures, and derive any "try this on <apartment>" instruction from a QUERY, never
  from the picture.** Same class as "an address is not evidence of a human": an assumption dressed
  as an observation.

- **A MIRROR'S EXISTENCE IS EVIDENCE THAT THE GATE GUARDING IT PASSED (Aug 18 2026).** The webhook's
  `metadata.app` gate could not be read (Sensitive-flagged vars), but `hosts.current_period_end` /
  `tier` / `subscription_status` are written ONLY by that webhook — rows carrying them prove the
  gate passed without reading the field it tests. **When an upstream check is unreadable, look for a
  downstream artefact that only exists if it passed.** State it as inference; it is a real answer
  where "unverifiable" would otherwise stand.

- **TEST FIXTURES THAT COMMIT MID-SESSION INVERT LATER TEST RESULTS (Aug 14 2026).**
  Behaviour-testing the address-swap gate mutated its own fixtures, so a later case ran against
  state an earlier case wrote and returned the opposite verdict — the baseline had moved, not the
  gate. **Restore from a known baseline before re-running a case, and re-measure rather than reusing
  a number from earlier in the session** (the re-measure rule, one layer down).

- **THE REPO IS PUBLIC, AND HAS BEEN SINCE IT WAS CREATED ON 5 JUNE 2026 — VERIFIED AT THE GITHUB
  API, NOT BELIEVED (Aug 14 2026).** Nothing is exposed: no secret has ever been committed, server
  keys have no `VITE_` prefix and live only in Vercel, `.gitignore` covers `.env*`. **The lesson is
  the CLASS of claim:** repo visibility is an environment fact no build, test or gate checks, so a
  wrong belief about it persists silently and mis-prices every decision about what may be written
  down. Check it at the API when it matters; never carry it forward from a note.

- **A QUALIFIER BELONGS INSIDE THE CLAIM STRING, NOT IN THE PROSE AROUND IT (Aug 11 2026).**
  `AuthShell`'s earnings claim was made self-qualifying — "and on Portfolio, you earn" in the SAME
  text node at the same size — so prominence parity holds by construction and cannot decouple under
  a later CSS change, which a parent-prose or caption qualifier can. Prefer this form for any
  quantified claim. Corollary: fixing the shared `AUTH_POINTS` default covered all five AuthShell
  surfaces (Login, Signup, ResetPassword, Demo, CompleteProfile); a per-caller fix would have left
  four stale.

- **WHEN A FACT LIVES IN N PLACES, ENUMERATE THE SITES — DO NOT GREP FOR A PHRASING.** Grep finds the copies you wrote and misses the ones you didn't. Failed FOUR times in two sessions: three partial Gemini key maps; "messages 90 days" missed by three search variants; a table row containing neither the number nor the searched phrase; and `RETENTION CRONS` skipped by a `[Rr]etention` search because it was uppercase. **Three of four table rows updated is the signature.** List the assertion sites first, tick each individually.

- **RE-MEASURE AT THE MOMENT YOU STATE A NUMBER, especially about an irreversible delete.** Estimates missed by +234, then -14,500, then quoted "~34 messages" when the true figure was 29 — stale because a fixture date-refresh performed EARLIER IN THE SAME SESSION had moved bookings back inside the window. A figure measured before your own change does not describe the state you are describing.

- **When a resource becomes SHARED between tenants, re-classify every input that reaches it** — not only the one that selects it. Locking the routing key does nothing if the payload is built from unlocked fields.

- **A spec defect is still a defect.** Four of the last defects the gates caught were in the prompt's own spec, not the code — a bound handed to a parser is part of the parser; a detector suppressed on a bucket correlated with the fault is silenced exactly when it matters. Derive numbers from the concurrency model, and assert that the control you are NOT testing let the write through.

- **`grep -v "^[+-][+-]"` SILENTLY HIDES EVERY CHANGE TO A MARKDOWN BULLET (Aug 10 2026).** That
  filter exists to drop a diff's `---`/`+++` headers. But a removed bullet `- Cron sequential…`
  renders as `-- Cron sequential…` and is swallowed by it. **In a file that is almost entirely
  bullets — this one — that hides almost everything.** Caught only because the RAW `+/-` count was
  16 against a filtered view showing 12. **RAW COUNTS ARE THE RELIABLE CHECK**, and this will
  recur on every future CLAUDE.md edit, so do not re-derive it each time.

- **GATE ON THE VALUES THE SERVER ACCEPTS, NEVER ON THE ONE YOU HAPPEN TO BE THINKING ABOUT
  (Aug 19 2026).** The guest-page link was gated `status !== 'cancelled'` — a DENYLIST, which
  renders a live-looking link for every OTHER status the resolver also rejects. It was the same
  defect the cancelled-chip existed to fix, one value over. An allowlist mirroring the server's own
  accepted set (`guest-access.ts` / `guest-state.ts`) is the only form that stays correct when a
  new status is added.

- **A SCRIPT THAT MUTATES IN MEMORY AND WRITES ONCE AT THE END LOSES EVERYTHING IF A LATER ASSERTION
  THROWS (Aug 19–20 2026, twice).** `eb13715` left two run-together bullets, and the next session
  discarded six computed edits on one stale match string, because the single write came after the
  assertion that aborted. The assertion is doing its job; the WRITE PATTERN defeats it. **Write
  after each independent edit, or accept that one failure discards the batch.**

- **CONTRAST IS COMPUTED, NEVER EYEBALLED — and the states that carry a component's POINT are the
  ones to check (Aug 19 2026).** In the availability picker the failing states were the ENABLED
  arrival/departure cells a host must click (1.45:1 against 4.5:1); the disabled cells were
  WCAG-exempt and fine. Eyeballing passed all of them. Compute the ratio and quote it.

- **AN ADDRESS IS NOT EVIDENCE OF A HUMAN (Aug 18 2026).** An email that reads like a person carried
  five sandbox subscriptions as the file's only live deadline for weeks, and nobody asked. **Before
  recording an exposure that turns on who is on the other end, ask who is on the other end.**

- **iCAL FOLDS LONG LINES AT 75 OCTETS WITH A LEADING-SPACE CONTINUATION (Aug 21 2026).**
  `parseIcal` now unfolds before matching (the un-unfolded parser silently captured a fragment of
  ANY folded field, and Airbnb's DESCRIPTION folds mid-URL on every real reservation). **The defect
  shipped looking correct because a short hand-written fixture never folds — fold every iCal fixture
  on purpose, mid-token, or it proves nothing.**

- **A QUERY STRING CANNOT SATISFY A "NEVER LOGGED" REQUIREMENT ON THIS PROJECT (Aug 21 2026).**
  `vercel.json` rewrites `/(.*)` to `index.html`, so the full query string reaches Vercel's EDGE
  ACCESS LOG before any of our JavaScript runs; client-side stripping cleans the address bar and
  nothing else. **A URL FRAGMENT is the only structural answer** — browsers never send it to a
  server or place it in a `Referer`. The question is whether the value ever crosses the boundary,
  not what our code does with it afterwards.

- **NEVER COPY LIVE FEED OR BOOKING OUTPUT FROM CHAT INTO A PROMPT, FIXTURE, DOC OR MEMORY — THE
  REPO IS PUBLIC (Aug 21 2026).** A real VEVENT with a live confirmation code became a test fixture
  and was stopped only by the security gate. **Case-folding a real value is NOT de-identification**
  — full entropy preserved, reversed by upper-casing; the tell is a value that still looks random
  beside invented ones. **Fabricate the whole thing; keep only the SHAPE.** git objects never
  expire, so a committed fixture is a permanent carve-out from the published 30-day guest-identity
  retention promise.

- **A WRITE-BOUNDARY FIX MUST BE REPEATED AT EVERY WRITER, FOREVER — INCLUDING WRITERS THAT DO NOT
  EXIST YET; A READ-BOUNDARY FIX IS DONE ONCE (Aug 22 2026).** `guests.first_name` is interpolated
  raw into the guest-chat system instruction (`guest-access.ts:200`, outside the nonce fence).
  `c0848d8` constrained it at the NEW write path — necessary, since that path moved the write to
  "anyone holding a confirmation code" — but other writers remain and any future one starts
  unprotected. **Prefer the read boundary; keep write-side checks as defence in depth.** This
  asymmetry decides where every future sanitiser belongs.

- **A PROMPT SENTENCE IS A HINT, NOT A MECHANISM (Aug 22 2026).** A prompt rule lowers the FREQUENCY
  of a bad output and changes the BOUND not at all; the mechanism is the code check before the write
  (e.g. `scrubCredentialSentences` before insert, now present in both importer doors). **Wherever a
  prompt rule stands in for a missing check, record the difference explicitly** — the realistic
  failure is a triager seeing a shipped rule with a passing test and deprioritising the mechanism.

- **VERIFY THE PALETTE AGAINST SHIPPED SOURCE, NEVER AGAINST A REMEMBERED SPEC (Aug 22 2026).** A
  build prompt specified a DARK host card; the shipped dashboard is the CREAM workspace, as the
  Design System records. Claude Code checked neighbouring components and overrode the brief.
  **Neither gate could have caught it** — a wrong palette is neither a security nor a correctness
  finding. Design-system claims need the same check-at-source discipline as environment facts.

- **TWO PROMPTS TEACHING THE SAME CONCEPT WILL DRIFT, AND THE DRIFT STARTS IMMEDIATELY (Aug 22
  2026).** In `f113943` a "copied verbatim" clause diverged on day one ("a code or A utility" vs "a
  code or utility"). **The fix that holds is a WHOLE-BLOCK equality test against the other prompt's
  LIVE value** — sampling sentences is blind to "added to one side only", which is exactly how
  `3417e01` opened the gap.

- **TEST GUEST-FACING FIRST-VISIT FLOWS IN A FRESH PROFILE (Aug 22 2026).** `118d05f` was
  invisible for hours because every browser in use already had the service worker installed AND a
  token in localStorage — **two independent reasons the broken path looked fine.** A developer's
  own browser is never a first-time guest.

- **A NO-ORACLE ENDPOINT IS ALSO OPAQUE TO ITS AUTHOR (Aug 22 2026).** `welcome-claim` returns
  200 with an identical body for hit and miss BY DESIGN, so the logs could not distinguish them;
  diagnosis needed a direct endpoint call plus a network trace. **The posture is correct — budget
  for the diagnostic cost rather than weakening it.**

- **AN ABORTED REQUEST HAS NO STATUS IN A NETWORK TRACE (Aug 22 2026).** The ABSENCE of a
  response code was the whole tell in `118d05f`. **Reading only completed requests would have
  missed it entirely.**

- **WHEN TWO DEVICES DISAGREE, SUSPECT LOCAL STATE BEFORE SUSPECTING THE PLATFORM
  (Aug 22 2026).** The first hypothesis was that Airbnb's in-app browser stripped the fragment.
  **It did not.** The difference was service-worker registration and a stored token.

- **A COPY-PASTE ARTEFACT IS NOT PLATFORM BEHAVIOUR (Aug 22 2026).** Text copied out of Airbnb
  into a chat gained object-replacement characters and a swallowed word, and that was
  misdiagnosed as Airbnb's linkifier mangling the URL. **The composer screenshot falsified it.**
  Verify against the SOURCE SURFACE, never a transcription of it.

- **RENDERED OUTPUT IS THE TEST FOR VISUAL WORK; THE NUMBERS ARE THE PRE-CHECK (Aug 25 2026, four
  times).** A screenshot of the built page is part of the gate for any UI diff, and the question is
  "what is the narrowest this element's container gets?", not "do the named widths look right?".

- **`text-shadow` IS NOT AN INPUT TO WCAG CONTRAST (Aug 25 2026).** It is a perceptual aid; the
  ratio is unchanged by definition. Never record a shadow as closing an AA gap.

- **THE PLATFORM-SCOPE CAVEAT LIVES AT EIGHT SITES IN `Landing.tsx` (Aug 26 2026) — and the
  enumeration is in a code comment there, NOT in a grep.** Five carry a numbered `CAVEAT SITE n
  of 8` marker; **three do not** (the hero paragraph, the "Do guests have to scan the QR?" FAQ,
  and the "download an app" FAQ), so a grep for `CAVEAT` returns five and misses three — the
  "three of four table rows updated" signature, walked into while writing the comment meant to
  prevent it. **If the pre-arrival link is ever verified on Vrbo or Booking.com, update all
  EIGHT in ONE commit, and flip `sharePlatforms.ts`'s `verified` flags in that SAME commit** —
  the landing and the Share panel must never disagree about which platforms work, which is
  exactly the divergence the gate caught in `3b7084c`.

- **PRE-ARRIVAL GUIDEBOOK LINKS ARE CATEGORY-STANDARD — NEVER CLAIM UNIQUENESS FOR THE FEATURE
  (Aug 26 2026).** Touch Stay sends a per-reservation link into the Airbnb inbox via its free
  Airbnb integration; Hostfully populates guidebook links in message templates when its PMS is
  integrated. (Sources, dated, in docs/history.md 26 Aug afternoon.) **No "unlike", no "only",
  no comparative revenue claim** for pre-arrival. **The two DEFENSIBLE differences, statable
  without a comparative: no integration to connect** (it rides Airbnb's own message variables)
  **and the link self-unlocks on check-in day.** The research was done BEFORE the copy, which is
  the only reason this cost nothing — the same finding after launch is a retraction.

- **MARKETING COPY NAMES NO REAL BUSINESS; HOST-FACING PLACEHOLDER EXAMPLES MAY (Aug 25 2026, three
  passes).** On Landing/Auth mockups fabricate the name and verify it resolves NOWHERE (Nominatim
  structured lookup with controls — web search alone passed two real names); landmarks without
  endorsement or hours/price claims may stay. Placeholder hints in host setup screens demonstrate
  what to type and keep real places — decided, not a gap.

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
- **PUSH STATE IS MEASURED, NEVER RECALLED.** Do NOT infer what is pushed from commit SHAs quoted
  in a brief, in this file, or earlier in a conversation. **The only valid source is
  `git log --oneline origin/master..HEAD` after `git fetch origin`** — empty output means
  everything is pushed. **Why this exists:** `eb13715`'s closing summary claimed "six commits
  stacked and unpushed" while `git status -sb` said `ahead 1` and `origin/master` was already
  current; a later `git fetch` moved nothing, so the correct answer was **on disk the whole time**.
  The five SHAs it listed were simply the ones printed in its own brief. **NOTE WHERE THIS
  SLIPPED:** that commit's eight read-back checks each ran a command and reported real output —
  the closing summary ran nothing. **GATES INSPECT THE DIFF; NOTHING INSPECTS THE NARRATION.**
  **Any count, size or state claim in a summary must name the command that produced it.**
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
- **`.claude/agent-memory/` IS NOT ADOPTED — PROJECT MEMORY LIVES IN CLAUDE.md + docs/ AND
  NOWHERE ELSE.** The `code-reviewer` subagent wrote files there on its own initiative
  (14 Aug 2026). They are gitignored, so they are invisible to everyone but the machine that
  wrote them — which is exactly why they must never become a second source of truth. **Do not
  read from, cite, or maintain those files**, and tell a subagent not to write them.
  (HOISTED 24 Aug 2026 out of "RESIDUALS FROM 14 Aug" before that block moved to
  docs/guide-cron-debt.md — it existed at ONE site and would otherwise have left with it.)
- **The other standing false positive:** `VITE_`-prefixed env vars read in `api/` routes are
  correct on Vercel (all env vars reach functions regardless of prefix).

### Config rule
Pricing/plan values are DB-driven (`plans` + `app_settings.trial_days`). `config.ts` holds only branding (colour presets) and currency symbol; its pricing fields are legacy stubs — never reintroduce hardcoded tier prices.

### api/ ESM rule (Node runtime)
`package.json` is `"type":"module"`, so Vercel runs every api/ function as native
Node ESM. ALL relative imports inside api/ MUST include the `.js` extension
(e.g. `./_lib/push.js`, `./_lib/ical.js`, `./_lib/cron.js`). Extensionless relative
imports compile fine but throw `ERR_MODULE_NOT_FOUND` at runtime. Imports from
node_modules are unaffected. `tsc` maps `.js` specifiers back to `.ts` source at
build time, so the fix is zero-friction.

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
written consent. **Closed 25 Aug 2026 (Udy):** Viator stays named on the landing page as GUEST value only
(comps row + intro); it is removed from every host-earnings statement, since Viator is
Bemgu-attributed at every tier and hosts earn only on GetYourGuide and Tiqets (Portfolio).

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
3. **Dependency triage — the current figure is GitHub's 16 (8 high, 8 moderate) as of the 18 Aug push**, unreviewed; the runtime-reachability analysis is in queue item 4. **Older counts in this file (Known notes' 8, and a since-deleted 7 on `d254df9`) are SUPERSEDED, and the gap between them was never drift** — GitHub counts one alert per advisory per manifest path while `npm audit` dedupes per package, so the two tools measure different things. Precedes the pentest gate.
4. **Pentest / "hacker" agent gate** — runs once on the Tiers 1-3 surface. Phase F needs its own second pass before Tier 4 is sold.
5. **Written multi-tenant confirmation from GetYourGuide and Tiqets.** Tier 3 sells "connect your own account" for both. That clearance is currently OUR terms reading, not theirs. Viator ruled NO on the identical question on 4 Aug 2026 after the same self-assessment said probably yes. Selling a tier on an unconfirmed permission is the risk; asking costs one email each.
6. **Stripe LIVE flip — LAST.** Also then: enable Supabase leaked-password protection.

**COUNSEL-PENDING, opened 24 Aug 2026 by the ntfy heartbeat — all three are `[CONFIRM]`s in the
drafted notice, not code work:** ntfy RETENTION for notice §6 (no period invented — every other
row there is a promise backed by a cron); ntfy.sh OPERATOR/LOCATION in §4 and DPA Annex 2; and
whether the heartbeat belongs in §5 (Bemgu's own processing) as well as §4 (recipients) — it is
recorded in both today.

> Full workstream, all ten gaps and the document status: docs/legal-workstream.md.

## On the horizon / next steps

### OPEN ITEMS — PRIORITY CHANGES (Aug 4 2026)

- **Tier names DECIDED and shipped (`7d69fa6`, 12 Aug 2026): Starter / Growth / Portfolio / Pro.**
  Tier 4 shows "Pro (full booking)" via a `descriptor` FIELD, never folded into `name` — `name` is
  what billing emails and webhook alerts mirror.
- **WATCH `src/lib/tierCopy.ts` — it feeds `/choose-plan`, the actual point of payment, and today carries NO earnings claim.** Any earnings bullet added there lands directly on the payment page and would need the tier qualifier in the string itself. The precise form to copy is `Landing.tsx:64` — "Keep 100% of GetYourGuide &amp; Tiqets commissions — paid to you directly" (both axes scoped in one string). Related residual: `EarningsPanel.tsx ~301` is unqualified but sits in `confirmedCard`, which renders only when `confirmedCount > 0` — never in production today.
- **Welcome share panel shipped (`8ff40e5`); Part 2's STAY TIMELINE was not built** — see
  docs/design-backlog.md.
- **RUN `api/backfill-canonical-city` BY HAND** — GET with `Authorization: Bearer <CRON_SECRET>`. Idempotent. On no schedule. Watch `resolvedNoKey`: a city that resolves with no valid country code stays on the per-apartment path. **HALF DONE, AND THE DENOMINATOR MOVED — RE-COUNTED AGAINST THE LIVE DB 23 Aug 2026: the VISIBLE fleet is THREE apartments, all Helsinki.** The nine test apartments were deliberately UNPUBLISHED (`is_visible = false`) for launch and are republishable per-experiment, so the earlier "nine visible across 8 cities" count is superseded by unpublishing, not by drift. The backfill's remaining work therefore shrank to almost nothing at the visible surface and is still entirely present behind it — **re-count before running it, because the number moves whenever a fixture is republished.** **⚠ BUT THIS IS NOT CURRENTLY DOABLE:** `CRON_SECRET` is flagged **Sensitive** in Vercel, so its value cannot be read back and the Bearer header cannot be reconstructed — see the CRON_SECRET lesson below. This item is blocked on that decision, not on effort.
- **PRE-LIVE — OBTAIN WRITTEN CONFIRMATION FROM GYG AND TIQETS ON MULTI-TENANT HOST-OWN-ID.** Udy's own terms review (11 Aug 2026) cleared BOTH to keep host-own-partner-ID on Tier 3, and the code ships that way. **But note the EVIDENCE CLASS: that is a self-assessment, not a provider ruling.** For Viator we hold a written answer from Partner Support; for GYG and Tiqets we hold our own reading. **Viator is the proof that the two differ** — the terms were read carefully, the risk was spotted, the question was asked anyway, and the answer came back NO. Send the same question to both **before the Stripe live flip**, so a paying Tier-3 host is never sold a connection a provider later refuses. **Tiqets first — it uses the same partner-ID substitution shape (`partner=`) that Viator prohibited.** Contacts parked in PHASE I. If either answers no, Tier 3 needs repositioning, not just a code change.
- **THE QUEUE (updated 24 Aug 2026). In order:**
  1. **Items through `f113943` / `118d05f`: DONE, deploy-verified.** (Full commit ancestry is in git.)
  2. **RESIDUALS FROM `118d05f`, recorded so they are not rediscovered as bugs.** (a) A genuine
     worker UPDATE arriving mid-claim still reloads and still aborts the POST — seconds long,
     only after a deploy; closing it means coupling `main.tsx` to `WelcomePage`, which is why it
     was not. (b) A tab loaded via HARD RELOAD bypasses the SW and starts uncontrolled with no
     claim event, so it spends its latch on the NEXT deploy's worker and picks up the one after.
     **Bounded, never permanent** — nothing serves stale, `sw.js` being network-first for
     navigations.
  3. **TEMPLATE COPY / Airbnb interstitial line — CLOSED WITHOUT CHANGE (Udy, 24 Aug 2026).**
     Guests understand platform interstitials; a warning about a warning reads as a disclaimer
     and costs trust. Revisit only if a real guest is observed bouncing off it.
  4. **PRIVACY QUESTION — DECIDED 24 Aug 2026 (Udy): ACCEPTED, no product change.** A guest
     holding the welcome link or a confirmed booking seeing the property address is fine — the
     booking platforms (Airbnb / Vrbo / Booking.com) already show it to that same person.
     `apartments.welcome_show_address` stays exactly as it is: NOT NULL DEFAULT true, no host
     UI. **The question is closed — do not re-open it as drift.** What this does NOT license is
     a documentation claim that the address is hidden; `cc2aba6` corrected one such claim, and
     the truthful version is the one to keep.
  5. **GREY-ON-CREAM CONTRAST SWEEP — DONE (`d93c2d9`).** `#8a8276` -> `#6b6354`, 132 sites /
     21 files. Print-card colours EXCLUDED by decision (live-print approved; paper is not
     governed by WCAG) — the old scope text claiming otherwise is deleted, not struck through.
  6. **THE ORDER — REPLACED 26 Aug 2026. THIS IS THE AUTHORITATIVE QUEUE.**
     0. **CLAUDE.md EXPIRY PASS — THE FIRST ITEM OF THE NEXT DOCS CLOSE. Target ~130K,
        DECISION-PER-LESSON.** Booked 26 Aug 2026 (pm), when the file closed at **141,826** —
        over the ~140,000 restructure trigger, accepted for that one commit rather than
        restructuring at a session close.
        **IT SITS AT 0 RATHER THAN 1 BECAUSE IT IS A DOCS TASK AND MUST NOT DISPLACE ITEM 3'S
        DATED DEADLINE.** It is the first thing the next DOCS close does; the next BUILD session
        still opens on the gemini repoint.
        **NOT A TRIM AND NOT ANOTHER SPLIT.** Rule (d) already says restructuring to 139,9xx buys
        one session and repeats; rule (c) says split on LIFETIME, and that lever is spent — the
        22, 24 and 26 Aug passes took it. **What is left is deciding, per lesson, that one has
        stopped earning its place**, which needs Udy approving a proposal table item by item (the
        25 Aug pass, `4bfa0f2`, is the shape: 140,328 → 131,277).
        **AND THE EXPIRY CLASS IS PART OF IT, not a separate job** — this session found a
        "NOT VERIFIED" line that had been false for four days and had already cost a queue item.
        **Sweep every claim in this file that asserts a GAP, an UNVERIFIED state or a PENDING
        answer, and re-check each against source before it is kept.** A lesson that is merely
        old is not the problem; a lesson that is WRONG is.
     1. ~~THE DEMO~~ — **DONE** (`23d5197`, 26 Aug 2026).
     2. ~~PRE-ARRIVAL MARKETING PASS~~ — **DONE** (`3b7084c`, 26 Aug 2026). Landing.tsx only;
        the research, the dropped "unlike" claims and the eight caveat sites are in
        docs/history.md (26 Aug afternoon). **Step (i) turned out to be ALREADY DONE on 22 Aug**
        — see the corrected delivered-message line above. **Step (iv), sandbox gap #1 (Alex has
        no `platform_ref`), was NOT built and STAYS PARKED**; gap #6's copy is still deferred
        behind it.
     3. **`gemini-2.5-flash` repoint (OPTION A) — THE NEXT SESSION OPENS HERE.** **Deadline
        16 Oct 2026, the file's only live dated deadline. Must ship before it.**
     4. **Pentest gate** — the unchanged list at item 7 below, **plus the `demo-create` cooldown**.
     5. **AA-FLOOR SESSION:** the `#9a958c` sweep (73 occurrences / 8 files, enumeration
        PENDING) and the FOCUS-RING TOKEN REFACTOR (62 declarations / 11 colour-alpha variants /
        7 offset colours — **NOT a value sweep**: backgrounds must be determined per site and
        `Landing.tsx` mixes light and dark. Both design decisions are pre-settled — two tokens,
        `#7a5c00` light / `#c8a24e` dark, alpha variants dropped).
        **A SECOND FAILING FAMILY, MEASURED 26 Aug 2026 — low-alpha CREAM ON DARK, which the
        `#9a958c` sweep does not cover.** Two live examples, both computed at the gate:
        `text-[#f0ede6]/35` on `#16100d` = **2.86:1** (trust-strip label) and `/40` on `#1c1c1a`
        = **3.43:1** (footer copyright). Enumerate this family INTO the frozen surface before
        that session starts — it is the same defect `3b7084c` fixed at one site (`/40` → `/55`,
        3.38:1 → 5.12:1), one background over.
        **RULE FROM THAT FIX: A PARENTHETICAL IS NOT EXEMPT — IT CARRIES THE PLATFORM SCOPE.**
        The line that failed was the aside qualifying the whole "How it works" section to Airbnb,
        i.e. the last text on the page that may be the dimmest. Subordinate a scope note by TYPE
        SIZE, never by lowering contrast. (`/50` = 4.48:1 also fails; recorded so it is not
        re-proposed as a compromise.) **Also carried into this
        session from the moved 25 Aug record, so they are not lost with it: the AuthShell
        TAGLINE at 2.96:1 on mobile and the LIFT-OUT at 4.26:1, both measured and both under
        AA; and the PHONE/TABLET BROWSER CHECKS that need a real device — h2 wrap at 375px, the
        GuideDrawer Ask panel's ring-inset at the viewport edge, and the ticket-stub earnings
        card at a real 768 and 1024.**
     6. **Cosmetic tail** — `€25` hardcoded twice vs `plans`, `sagrada.jpg` licence, Founding
        Hosts prep, and **the hero phone's lift-out callouts overlap the Before-arrival frame's
        Directions tile (`3b7084c`)** — reflow or reposition; the callouts sit ~130px inside the
        270px frame at EVERY width, so this is a real overlap and not a breakpoint artefact.
        **Screenshot gate** — it cannot be judged from the class names.
     **Stripe LIVE flip is ABSOLUTE LAST, and only after the GYG + Tiqets written confirmations.**
     (The LESSONS RETIREMENT PASS that used to head this list was done 25 Aug, `4bfa0f2`.)
  7. **Pentest gate — LAST, and FOLD THE DEPENDABOT REVIEW INTO IT.** GitHub reports **16
     dependency vulnerabilities (8 high, 8 moderate) as of the 18 Aug push, UNREVIEWED.** Read the
     list before the gate — **earlier if any high is runtime-reachable**. NOTE this supersedes the
     earlier "7 total / 5 high / 2 moderate" `npm audit` measurement: those two tools count
     differently (GitHub counts one alert per advisory per manifest path, `npm audit` dedupes per
     package), so the gap is NOT drift and must not be re-litigated as such — but 16 is the number
     to review against.
     **THE RUNTIME-REACHABILITY TRIAGE SURVIVES THE SUPERSEDED COUNT AND IS STILL THE STARTING
     POINT** (measured Aug 7 2026, hoisted here 18 Aug when its parent bullet was deleted):
     **`react-router` (HIGH) + `react-router-dom` (MODERATE) are the same defect counted twice,
     via a PROD dependency that ships in the browser bundle**, and `protobufjs` (MODERATE) arrives
     via `@google/genai`, which is still installed and imported. **The other four are build/dev
     only and never ship** (`postcss` + `vite`; `js-yaml` + `brace-expansion` via eslint).
     **NUANCE:** three of react-router's five advisories are scoped to **RSC / SSR**, and Bemgu is
     a client-only SPA with no SSR and no RSC, so they appear unreachable — leaving the
     **backslash open-redirect in `<Link>`/`useNavigate` (GHSA-wrjc-x8rr-h8h6)** and the
     **route-matching DoS** as the two genuinely worth triaging.
     **ADDED TO THE GATE 22 Aug 2026:**
     - **THE RAW NAME INTERPOLATION — and the PRINCIPLE is worth more than the instance.**
       `api/_lib/guest-access.ts:200` interpolates the guest's name straight into the guest-chat
       SYSTEM INSTRUCTION, **outside the nonce fence**. `c0848d8` fixed the WRITE boundary on the
       new claim path with an allowlist, but **two writers of host-supplied names remain** —
       `api/create-booking.ts:193` and `api/import-airbnb-csv.ts:168,178` — both
       host-authenticated, so severity drops, and the defect is NOT closed. (A third inserter,
       `api/demo-create.ts:139`, writes a hardcoded constant and does not count.)
       **THE PRINCIPLE: A WRITE-BOUNDARY FIX MUST BE REPEATED AT EVERY WRITER, FOREVER — INCLUDING
       WRITERS THAT DO NOT EXIST YET. A READ-BOUNDARY FIX IS DONE ONCE.** The durable fix is
       fencing the name where it is INTERPOLATED; the allowlists stay as defence in depth.
     - **`bulk-import` has NO rate limiter, NO `bump_api_counter` and NO `ROLLING_LIMITS` entry,**
       unlike its sibling importer, which has all three. Pre-existing. **The same two-doors
       argument `f113943` makes about wording, one layer down.**
     - **VERCEL'S `x-forwarded-for` HANDLING ON THIS PROJECT IS UNMEASURED.** `welcome-claim`'s
       `clientIp` prefers the platform-set headers (`x-vercel-forwarded-for`, `x-real-ip`) and
       falls back to `x-forwarded-for`. **The IP keys BOTH anti-enumeration controls on that
       endpoint**, so an unmeasured assumption sits underneath them. **One measurement closes it**
       — and until it is taken, the honest control is `platform_ref` entropy, not the brakes.
     - **ADDED 23 Aug 2026 — `no-store` PARITY ACROSS THE FOUR TOKEN-VARYING GUEST ENDPOINTS.**
       `guest-state`, `guest-bootstrap`, `guest-details` and `welcome` all vary their body by a
       booking token or a welcome code, and **all four set NO `Cache-Control` at all.** Nothing
       is cached today (Vercel does not CDN-cache a function response absent one), so this is a
       latent gap, not a live leak — **but `guest-bootstrap` now carries only a COMMENT
       forbidding a future `s-maxage`, and a comment standing in for a mechanism is the exact
       shape this file records elsewhere as the thing that gets deprioritised.** Set `no-store`
       on all four in ONE pass, or the parity argument that justifies leaving each one bare
       stops being true the moment one of them changes.
     - **ADDED 24 Aug 2026 — ntfy SILENT 429.** `_lib/ntfy.ts` logs a 429 in the same shape as
       a 200, so a DROPPED priority-high alarm is indistinguishable from a delivered one.
     - **ADDED 24 Aug 2026 — split the heartbeat and alarm topics** if heartbeat volume ever
       threatens the detector: they share one NTFY_URL today.
     - **ADDED 24 Aug 2026 — ring-inset / viewport-edge check** on the GuideDrawer Ask panel
       (`2d7985b`): the ring has no offset and the panel is flush to the drawer edge. Needs a
       browser; neither a gate nor Claude can render it.
     - **ADDED 24 Aug 2026 — A CSP WOULD BREAK THE PRINT CARD SILENTLY.** The generated A5
       document depends on an INLINE `<script>` (it self-prints on load, because nothing outside
       it calls `print()` any more) and an INLINE `onerror` on the logo image. The repo has NO
       Content-Security-Policy today. **Any future CSP must allow both, or printing dies with no
       error and no dialog** — the host sees a blank tab and concludes the button is broken.
     - **ADDED 23 Aug 2026 — `bulk-import`'s SILENT ALL-SCRUBBED PASTE.** When the credential
       scrub (`20609c1`) empties every row, the endpoint returns `{ categories: [] }`,
       `PropertySetup.tsx` renders NOTHING for an empty list **and clears the paste box**, and
       the handler returns before the delete so the host's unchanged extras re-render. **The
       host concludes it worked; their text is gone, nothing was saved, and the code they pasted
       now exists nowhere** — this path cannot write `entry_instructions` either. The other door
       returns `redacted` and renders "We left N sentence(s) out of the public sections". **Fix
       is one response field plus one component line** — a response-shape change, which is why
       it was not folded into the scrub commit. Transparency, not a boundary — but it is the
       residual most likely to cost a real host real content.


### PRE-ARRIVAL PERSONAL GUEST LINK — the binding rules (SHIPPED `13eaaf3`/`c0848d8`/`ed92ad2`)

> Full design record — the original locked decision, the 22 Aug amendment with its
> strike-through, and the reasoning for both — moved to **docs/pre-arrival-link-design.md**.
> Read it when you need to know WHY one of these is shaped the way it is. Everything below
> BINDS the next change to this feature.

- **THE HINT RIDES IN A URL FRAGMENT (`#`), NEVER A QUERY STRING (`?`).** `vercel.json` rewrites
  `/(.*)` to `index.html`, so a query string is written into Vercel's EDGE ACCESS LOG **before a
  line of our JavaScript runs** — client-side stripping afterwards is theatre. A fragment is
  never transmitted to a server and never appears in a `Referer`. **Never move the hints into a
  query string, a GET, a fetched URL, or a redirect target.** They travel in a POST body.
- **THE ORDER IS `#c={code}&g={name}` — CODE FIRST.** A first name can contain a SPACE, and a
  space TERMINATES an auto-linked URL. Name-first, the link arrives as `…#g=Anna`, the CODE IS
  GONE, and the feature silently never fires while the host's own self-check still looks
  correct. Code-first, only the name shortens and the claim still succeeds. **Do not reorder.**
- **THE LINK IS THE DEFAULT; THE QR IS THE PERMANENT FALLBACK AND THE SOLE PRESENCE-PROOF PATH.**
  QR semantics are unchanged by this feature.
- **THE PRODUCT MUST WORK 100% FOR A HOST WHO DOES NOTHING.** The template is an upgrade, never
  a precondition. Nothing in the Share panel may gate, block or require it.
- **A PLAIN LINK NEVER SELF-TRANSFORMS ("Tom protection")** — without the hints, arrival day
  shows a QR pointer line. The transformation is a property of a CLAIMED link, not of the date.
- **THE NAME HINT IS READ ONCE, STRIPPED FROM THE URL IMMEDIATELY, NEVER LOGGED, FIRST NAME
  ONLY**, and it is an **ALLOWLIST** (letters, marks, spaces, apostrophes, hyphens, full stops)
  rather than a control-character strip — `guests.first_name` is interpolated RAW into the
  guest-chat system instruction, outside the nonce fence, and this endpoint moved that write
  from "authenticated host only" to "anyone holding a confirmation code". **A STORED NAME ALWAYS
  WINS: the hint fills a blank, never corrects one**, or the endpoint is a rename primitive.
- **`link_claimed_at` IS A PING MARKER, NOT A LOCKOUT.** The QR proves PHYSICAL PRESENCE so a
  lockout is safe there; a confirmation code is a SHARED CREDENTIAL and two travellers on one
  booking both hold it, so a lockout would lock out the second traveller. The host push fires
  ONCE (decided by rows returned from a conditional update); the token is never withheld.
- **THE TOKEN IS REVEALED, NOT MINTED** — every feed booking already carries an `ARR-` reference
  from `reconcile_ical_bookings`. If a future edit finds itself generating one here, stop.
- **THE REAL GUESSING CONTROL IS `platform_ref` ENTROPY, NOT THE BRAKE.** Both in-memory brakes
  are per-Lambda-instance; the persistent victim-keyed counter is the detector. **No second
  writer of `platform_ref` may be added without redoing that analysis** — the 8-char floor the
  validator accepts is only 1e8, against Airbnb's 10-char ~3.7e15.
- **VERIFY THE PLATFORM'S VARIABLE SYNTAX AGAINST LIVE BEHAVIOUR AT BUILD TIME, NEVER FROM
  MEMORY.** This invariant is what falsified the check-in date on 21 Aug and forced the
  amendment — the lock held and the invariant overrode it.
- **VERIFIED ON A DELIVERED AIRBNB MESSAGE, 22 Aug 2026 — this line used to say the opposite
  and the stale version cost a queue item on 26 Aug.** Airbnb linkifies a `bemgu.app` URL in a
  SENT message; tapping shows the "You're leaving Airbnb" interstitial; **the fragment survives
  both the linkifier and that redirect**, confirmed by a completed `POST /api/welcome-claim`
  from the tapped link. Evidence in docs/history.md, 22 Aug.
  **THE LESSON, and it is why this correction is written out rather than just applied: a
  "NOT VERIFIED" line is a CLAIM WITH AN EXPIRY, and nothing in this project re-checks one.**
  It was true when written, was closed three days later by a test recorded in another file, and
  then propagated into a 26 Aug queue item as a live to-do that would have sent someone to
  re-run a passing test. When a gap closes, close it AT THE LINE THAT ASSERTS IT, in the same
  session — not only in the record of the session that closed it.
- **STILL NOT VERIFIED: Booking.com · Vrbo.** Both ship as a `verified: false` record that
  structurally cannot render steps, and `sharePlatforms.ts` deliberately makes NO claim that
  either works. Only the Airbnb half closed.

**STILL PARKED, unchanged:** block-source message fix (before Founding Hosts) · pre-arrival
  messaging gap · **`groq/compound` evaluation — PARKED WITHOUT A DEADLINE (option B).** Option A
  (repoint + env-configurable model, decided 18 Aug 2026) clears the 16 Oct date, so this is no
  longer the only route and is not on the critical path · **the `api/` typecheck gap** (`api/` is outside
  every tsconfig AND `@vercel/node` is not installed locally, so `npm run build` type-checks NONE
  of it; **an isolated strict `tsc` per change is the working compensation** and was used on every
  api/ commit this session) · **`cron-refresh-events` refill pacing at fleet scale** (~49s of
  refill needed against a ~20s unit, so concurrency 1 bounds simultaneity but NOT rate) ·
  **`guide.ts`'s POI list is unbounded** — the same structural gap the events corpus just closed,
  fits today · **`MAX_EVENTS` 15 vs the "aim for 20-30" prompt** — events 16-30 are reservation
  waste, now competing with the reasoning trace for the same allowance.

- **OPEN — EVENTS / CITY-EVENTS SYSTEM. Nine items, one-line each; the measurements, the
  arithmetic and the accepted trade-offs are in docs/events-system.md.** The RULES are here, not
  there.
  - **RECALL IS CORPUS-LIMITED, NOT WINDOW-LIMITED** — the untouched lever is SEARCH (query
  design, results per search, number of searches), never the extraction prompt.
  - **CITY COMPRESSION is SUPERSEDED BY UNPUBLISHING, deliberately NOT re-derived.**
  **RULE: re-derive at >= 10 PAYING hosts** — that is when the card decision is taken.
  - **LEAN CONTEXT IS A MEASURED CONSTRAINT, not a preference** — the 8,000 TPM ceiling is what
  binds. **RULE: PILOT STEP 2's rule (b) — the router's ungrounded leg must NOT embed the guide
  — now binds on TPM as well as on the day pool.**
  - `city_events_cache` holds ONE stale row while `city_events_by_city` refreshes daily — decide
  whether to delete the row or the fallback path. **One look, not a build.**
  - The per-apartment fallback has no `last_attempted_at`, so a failing apartment can pin the
  head of the LRU queue.
  - `demo-create.ts` is a FOURTH writer bypassing `eventsCacheRef` — safe only while a demo
  apartment has no canonical key, and it breaks QUIETLY if that changes.
  - The shared 20h freshness gate is CROSS-TENANT and **ACCEPTED** — but **RULE: the
  `fresh_city` copy must NEVER read as a refusal.**
  - An empty first-fill from the public lazy-fill is visible CITY-WIDE until something non-empty
  replaces it; self-heals via the cron or a host refresh.
  - REMAINING EDGE, accepted: a host moving real coordinates into another city spends at someone
  else's credit — never content poisoning.

- **GUEST-CHAT'S 40/HOUR BRAKE — DOWNGRADED 12 Aug 2026: leave it until real guest usage exists.**
  `api/guest-chat.ts:87` `CHAT_HOURLY_LIMIT = 40`, enforced via `bump_api_counter`, alerting once at
  limit+1. The arithmetic still holds — at ~2.3k tok/turn, 40/hour is ~92k tokens from ONE host
  against a 100K/day FLEET-WIDE ceiling, so one host at the *permitted* rate could exhaust every AI
  surface for every tenant. **But the number cannot be sized without traffic to size it against, and
  there is none: no real guests exist yet.** Any figure chosen now is a second guess replacing the
  first. **Revisit on real usage.** If it is ever changed, it goes in its OWN commit with its own
  recorded arithmetic — never folded into the Step 6 migration, which must not change who may ask or
  how often.
- A `demo-create` cooldown was NOT built (secondary surface: Turnstile + one-demo gated).
  Fail-closed reconsideration remains a recorded non-blocking option.
- **CLAUDE.md SIZE — THREE STANDING RULES.** (a) **DELETE a superseded claim** rather than
  striking it through and explaining it — git holds the correction. (b) **ONE pointer per moved
  BLOCK, never per item**, or the pointer costs half the saving. (c) **When this file passes
  ~140,000 chars, RESTRUCTURE rather than trimming** — split on LIFETIME (invariants and live work
  stay; reasoning trails go to purpose-named files under `docs/`), because the one-record rule
  caps the RATE of growth, not the DIRECTION. Working limit 150,000. **Restructured 10 Aug, 18 Aug
  and 24 Aug 2026.** (d) **RESTRUCTURE TO REAL HEADROOM, NEVER TO 139,9xx** — the 24 Aug pass
  took the file from 143.8K to ~135K precisely because stopping at the threshold buys one session
  and then the whole exercise repeats. **The practical FLOOR under the split-on-lifetime rule is
  ~130K**: Lessons alone is ~35K and every word of it is a rule, so past that point the only
  lever left is deciding a lesson has stopped earning its place.- **OPEN — STEP 7 / SELF-ATTACK DRILL (argued in `cron-sync-ical.ts` + commits):** `ok` = "no
  failure recorded", NOT "work was done" — two in-code empty-success paths (deadline-adjacent,
  window = one **POOL-WIDTH**; the SILENT no-`https://` path), not exhaustive. Alarm is
  **single-success-suppressible**, never the sole iCal health signal. Cron ignores
  `result.capped`. ntfy is a third consumer of `deferred + ok + failed === apartments.length`.
  `PropertySetup.tsx`'s "Calendar synced" toast hides the strings (UI, mockup-first).

- **PARKED (not scheduled) — "GIRLFRIEND ACCESS": a SECOND EMAIL that can see Udy's host
  dashboard AND /admin (26 Aug 2026).** **Not possible today**, and the two blockers are
  structural, not cosmetic: RLS is written as `auth.uid() = host_id` throughout, and
  `SuperAdminRoute` gates on ONE hardcoded email. Two options recorded, neither chosen:
  **(a) a second superadmin + the existing Impersonate** — cheapest, but **verify Impersonate's
  WRITE semantics first**: reading as another host is not the same permission as writing as them,
  and nobody has checked which it does. **(b) a `host_members` table + an RLS rewrite** — the
  real feature, a genuine multi-user model, and therefore a **pentest-gate item**, since it
  changes the tenancy boundary every policy in the database is written against. **Do not treat
  (a) as a stepping stone to (b)** — they are different products.
- **OPEN — THE SHARE MESSAGE AND `host_picks` ARE NOW COUPLED, and nothing enforces it.** The
  default welcome message promises "our own favourite places to eat and drink nearby", and
  `SharePanel` nags when a property has **zero `host_picks`** — the first time those two facts have
  met in the UI. A host who copies the message with no picks saved sends a promise the guest page
  does not keep. The nag is the only link; there is no gate, and none is proposed. **Design
  question, not a bug** — decide whether the message should soften when picks are empty, or the
  nag should be stronger.

- **OPEN — spend hardening. SIX residual items, one-line each; full argument in docs/spend-hardening.md.**
  (a) NO ALERT ON VOLUME MINTED — both alarms fire on RATE and CAP, so 100 uids x 5 syncs/hour
  mints 500 passes/hour SILENTLY; alert on `imported`, not request count.
  (b) The capped alert is NOT one-shot, so a capped host can fire 5 high-priority ntfy/hour.
  (c) `MAX_ICAL_URLS = 20` x 10s timeout = 200s against `maxDuration: 150` — self-inflicted 504
  interactively, and a cross-tenant availability lever in the cron.
  (d) COMPLIANCE — ntfy spend alerts MAY carry a host account UUID; the Art. 30 ntfy row still
  says "no personal data" and must be narrowed.
  (e) KEY-NAMING TRAP — `GEMINI_API_KEY` is nicknamed "Arrivly guide" while the primary guide
  spend goes to `GEMINI_API_KEY_GUIDES`; an incident responder would disable the wrong project.
  (f) No cross-endpoint view — a host at 49% on all seven endpoints at once is invisible.

- STILL OPEN on the detector: **NO CRON HEARTBEAT — "never ran" remains undetectable as a CLASS**,
  and that is what this item is for. **CORRECTION 18 Aug 2026: the guide cron HAS RUN — the earlier
  "has still never run" clause was FALSE.** `guide_recommendations` shows three apartments
  refreshed **15 Aug 10:00:18-10:00:29 UTC**, matching the `0 10 * * *` schedule, and it has
  correctly IDLED since: every visible apartment sat inside the 25-day freshness gate
  (oldest 29 July against a 24 July cutoff). **The fleet that was measured against was NINE
  visible; since 23 Aug 2026 it is THREE, all Helsinki, the other nine unpublished — so the
  idle is now over-determined and proves less than it did.** **THE 15 AUG RUN COMPLETED ITS QUEUE rather than
  stopping at the deadline, so 3/run is a LOWER BOUND on throughput, not a capacity measurement**
  — the "~2/run x 25 days ≈ 50 apartments" figure in RESIDUALS therefore stays an ESTIMATE and must
  NOT be upgraded to a measured value. The failure ntfy still covers "ran and failed",
  not "never ran". Also `city-events-host` (9) and `sync-ical` (15) WILL false-positive on a
  legitimate Tier 3/4 multi-property setup sweep (12 properties > 9), firing a high-priority
  "block this host" alert at a paying customer — revisit when a real portfolio host exists.

### RESIDUALS FROM 14 Aug 2026 — recorded with enough detail to fix in ONE pass

- **STARVATION IN `cron-refresh-guides`** — `generated_at` advances only on a successful upsert,
  which `_lib/guide.ts` skips on three paths, so a consistently-failing apartment sorts first
  forever and pins a daily slot. **The obvious fix is WRONG: a never-generated apartment has no
  row to stamp, so the column probably belongs on `apartments`.** Deferred deliberately — nothing
  is currently failing. **Decide the column's home before writing the migration.**
- **STILL OPEN from `ec66829`:** skip EXPIRED HOSTS, and LOG OUTCOMES.
- **The guide cron bypasses `generate-guide.ts`'s 6h atomic claim and `bump_api_counter`** — cron
  guide spend is invisible to `cron-spend-audit`, and the monthly→daily move multiplied its
  weight ~30x.
- **`cron-refresh-guides` has NO failure alarm and NO `console.*` at all** — copy
  `cron-refresh-events`'s ntfy shape, including its `attempted = units - deferred` denominator.
  This is also the one detector that would reveal the "never ran" condition.
- **Guide-cron capacity ≈ 50 apartments** before permanent backlog. **RULE: re-derive BOTH
  constants beyond that, not one of them.** Today's headroom came from UNPUBLISHING, not from any
  change to the cron.
- **The commission disclosure in `ExperiencesSheet.tsx` is unconditional BY DESIGN** — every
  neighbouring earnings surface is tier-qualified, so the pattern a future editor matches against
  is the conditional one, and making this one conditional would reintroduce the defect `736a715`
  fixed. A one-line comment above it would make a regression visible in a diff.

> Full detail for all of the above — the failing paths, the `refreshed++` miscount, the ~30x
> argument and the capacity arithmetic — is in **docs/guide-cron-debt.md**.


> ✓ Plan values confirmed (hard gate CLOSED): T1 €10/cap 2, T2 €15/cap 7, T3 €25/cap 12, T4 €49/unlimited; trial_days = 14.
> **DECISION (S16, amended S19 cont.): flip-to-live is the LAST step. Build order reordered S19 cont. to G → H → I → F (Phase F / Tier-4 booking moved to the end).**
> **DECIDED (Udy, Jul 28 2026): OPTION (b) — flip live on Tiers 1–3, build Phase F (Tier-4 booking) AFTER launch.** Rationale: G/H/I are complete, Tier 4 has no waiting customers, and launching sooner starts real revenue and real traffic. **Consequence for the pentest gate: it now runs on the Tiers 1–3 surface WITHOUT the Phase F booking/payment flow**, which reduces its scope and cost. When Phase F is later built, it introduces a payment-taking surface that did not exist at gate time — **a second security pass over Phase F is therefore required before Tier 4 is sold.**
> **HARD PRE-LIVE GATE (Udy, S19 cont.): a pentest/"hacker" agent pass must run and pass before the live flip, on top of security-auditor.**
> **Apple Sign-in — PARKED (do NOT build unless asked).** Built + flag-hidden
> (`VITE_SOCIAL_APPLE` unset). Blocked on Apple Developer account access; matters for the future
> native iOS app (App Store guideline 4.8). Setup steps in docs/design-backlog.md.
> **Social sign-in — minor/cosmetic, non-blocking:** the two active-demo CTAs share a destination;
> leftover `user_metadata.is_demo` after conversion is harmless.
> **LANDING — pre-launch facelift** right before go-live, so copy matches deployed reality; wire
> "See a live demo" to a real guest page as part of it. **PARKED motif idea** and the **AI video
> ad strategy** (assets live outside the repo) are recorded with it in docs/design-backlog.md.
> **DOMAIN MIGRATION GATES PHASE I STAGE 0** — settled by the move to bemgu.app; kept as history
> in docs/design-backlog.md.

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

## AI MODELS — provider assignment, keys, and the one dated fact
`gemini-2.5-flash` shuts down **16 Oct 2026** and is already refused to new Google Cloud projects. **ONE SURFACE STILL DEPENDS ON IT, so the deadline is REAL and dated — and it is the FILE'S ONLY LIVE DATED DEADLINE** (that clause used to live in the sandbox-subscriptions Launch Blocker, deleted 23 Aug 2026; it existed nowhere else) — the older "no surface depends on it" claim was FALSE. `api/guest-chat.ts:9` runs `gemini-2.5-flash` on `GEMINI_API_KEY_CHAT`, verified in source; it is the only Google dependency left, on the AI Studio FREE tier with no card, so it cannot bill.

**DECIDED 18 Aug 2026 — OPTION A, and this supersedes the "unresolved tension" recorded in `057da82`:** repoint guest-chat to a **current Gemini model**, and make the model an **ENV-CONFIGURABLE value** rather than the hardcoded `const MODEL` it is today — so the *next* model retirement is a dashboard change and a redeploy, not a code change and a gate cycle. **OPTION B (`groq/compound`, which ships built-in web search and would take Google to zero) stays PARKED WITHOUT A DEADLINE — option A buys the time to evaluate it properly.** Pilot Step 6 (the chat router) was never built and is no longer what clears this date. Grounding is 1,500 RPD free on the 2.5 line and **ZERO on Gemini 3** — that is what made graduation-to-Google expensive. Quota measurements, the per-project model and the migration analysis are in docs/pilot-history.md.

**WALLET CONSTRAINT — PERMANENT, and it survives the pilot narrative that moved out.** Every AI /
search / POI provider must be **no-card free tier or prepaid**. Providers requiring an **uncapped
card on file are BANNED** (Brave-class). The Bemgu Google billing account is CLOSED with zero
linked projects; **no payment instrument exists anywhere in the AI stack.** Groq's own Developer
tier requires a card, so "just pay for Groq" does NOT preserve the no-card state either — the card
question is DEFERRED, not resolved.

**PER-SURFACE PROVIDER SELECTION** is `AI_PROVIDER_<SURFACE>` → `AI_PROVIDER_DEFAULT` → `groq`
(`api/_lib/ai-provider.ts`). The Gemini code paths are KEPT as the `gemini` branch at each call
site and never deleted, so a rollback is an env-var flip per surface, not a code change.

**KEY MAP — the single copy. Five keys, five projects, each with its own free-tier daily quota.**
Pilot Step 8 (deleting these vars from Vercel) has NOT run. **Alarms name the env var and the
project ID, NEVER a key value.**

| Env var | Project | Surfaces |
|---|---|---|
| `GEMINI_API_KEY` (shared) | gen-lang-client-0819525902 | greeting/daily-greeting, host-picks, bulk-import, rewrite-rules, guide-assistant — **the only ones competing with each other, so disabling it is BLUNT** |
| `GEMINI_API_KEY_GUIDES` | gen-lang-client-0816353550 | `_lib/guide` |
| `GEMINI_API_KEY_CHAT` | gen-lang-client-0221179352 | **`guest-chat` — THE ONLY ONE STILL LIVE ON GOOGLE** |
| `GEMINI_API_KEY_EVENTS` | gen-lang-client-0131909896 | `_lib/city-events` |
| `GEMINI_API_KEY_PUBLIC` | (separate, no card) | `welcome-chat` |

Every dedicated key reads `<KEY> || GEMINI_API_KEY`. **Keep every high-volume or public AI surface
on its OWN key/project** — that isolation is provider-independent and outlives Gemini.

**STATE OF PILOT STEP 6 (the guest-chat router + host-picks): NOT BUILT, and NO LONGER THE THING
THAT CLEARS THE 16 OCT DEADLINE** — option A above does that. Its acceptance criteria, the
20-question benchmark set and the three binding design rules (POI category mapping must include
`place_of_worship`/`historic`/`memorial`; the router's ungrounded leg must NOT embed the guide;
chat history must be truncated server-side) are in docs/pilot-history.md. **Step 7 (the self-attack
drill) remains a graduation prerequisite.**

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

> Moved to docs/history.md — "Session — 18-19 Aug 2026 (restructure, the push-state rule,
> four UI items)". Its FOUR rules were HOISTED into Lessons first — the allowlist rule, the
> write-after-each-edit rule, the computed-contrast rule and "an address is not evidence of a
> human" — none of which existed anywhere else.

> Moved to docs/history.md — "Session — 20 Aug 2026 (the importer, completed through five
> live test rounds)". NOTHING needed hoisting: its taxonomy-before-prompt lesson and the
> label-comp-fixtures rule were already in Lessons, and its open items are carried in the
> queue below.

> Moved to docs/history.md — "Session — 22 Aug 2026 (the pre-arrival personal guest
> link, shipped in three commits, plus the bulk-import offering clause)". Its binding
> rules already live in "PRE-ARRIVAL PERSONAL GUEST LINK"; nothing needed hoisting.

> Moved to docs/history.md — "Session — 23 Aug 2026 (Phase H pre-arrival parity,
> 3aaca7b)". Its five BINDING rules moved WITH it: each is reasoning about a shipped
> feature, not an open item, so nothing needed hoisting.

> Moved to docs/history.md — "Session — 23 Aug 2026 (2) — pre-launch data state
> settled". Its `is_test` invariants already live in DB TRAPS; only the `ARR-IMP301`
> non-existence note needed hoisting, and it is now in the Test Data fixture rules.

> Moved to docs/history.md — "Session — 24 Aug 2026 — drawer refresh, the A5 guest card, privacy
> decided". Its decisions are restated under DECIDED in the 25 Aug block.

> Moved to docs/history.md — "Session — 25 Aug 2026 — Lessons retired, landing made
> true, the mark became a B". Its QUEUE was superseded on 26 Aug (see THE QUEUE item 6);
> its DECIDED items and the `md:scale-[0.62] lg:scale-[0.92]` note moved WITH it, and its
> OPEN list is carried in the queue's cosmetic tail. The DEMO — APPROVED DESIGN block moved with
> it too, marked SHIPPED — **one rule was HOISTED out of it first** ("a public QR cannot be
> two-sided"), into the TWO DEMO FLAGS trap in DB TRAPS, because it is a design rule and would
> otherwise have left with the record.

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

> Moved to docs/pilot-history.md — "ZERO-GOOGLE AI PILOT — APPROVED PLAN (Aug 5 2026)",
> including its PILOT STEP 2 benchmark. The pilot's LIVE residue — the per-surface key/model
> table, the no-card constraint and the state of Step 6 — is in "## AI MODELS" above.

## SPEND-ABUSE HARDENING — the invariants only

Mechanism, the seven brakes, the commit trail and the full narrative are in
docs/spend-hardening.md. What stays here is only what a future change could BREAK.

- **NEVER share one counter key across a trust boundary** — a public flood must not eat the
  host's own reserve.
- **FAIL-OPEN vs FAIL-CLOSED is a per-endpoint DECISION, never to be "harmonised".** Fail OPEN
  where blocking costs a host real work (`create-booking`, `sync-ical`); fail CLOSED where the
  blocked behaviour is the free fallback (greeting/chat/events). Fail-open is indefensible when
  the fallback is free.
- **VICTIM-vs-CALLER (operator safety, `fa8fa32`).** Victim-keyed alarms (guest-chat,
  daily-greeting, city-events-public) say "INVESTIGATE, do not auto-block" — the named host may
  be the victim of a leaked booking token or a public UUID. Caller-keyed alarms (create-booking,
  sync-ical, generate-guide, refresh-events, cancel-booking) correctly say "block this host".
  **NEVER blanket-rewrite the caller-keyed ones.** Classify by the ownership check that precedes
  the bump, not by the variable name — `refresh-events` passes `apt.host_id` but is caller-keyed.
- **2x CEILING RULE:** a counter unit is NOT one provider call. Automatic retry (and empty-reply
  fall-through) means real billed calls ~= 2x the limit; an AbortSignal does NOT reduce provider
  billing. Size any per-project spend cap at ~2x the limit.
- **A BRAKE IS UNFINISHED UNTIL ITS KEY IS IN `cron-spend-audit.ts`'s `ROLLING_LIMITS`** —
  unlisted endpoints are ignored by BOTH detectors, so the 429 fires while nothing alarms. This
  has now been missed three times.

- **OPERATOR NTFY HEARTBEAT ON GUEST-PAGE OPENS (`a4a35bd`).** Payload is PROPERTY / STATE /
  DOOR only — **never the guest name, token, confirmation code, IP, stay dates or any host
  id**; the Art. 30 record says so, so a payload change is a two-sided change. Off switch is
  unsetting `NTFY_URL`. Known and accepted: redirect paths DOUBLE-COUNT, so the feed counts
  redirects, not humans — see the enumerated cases at `notifyOpen`.

> Full mechanism and history: docs/spend-hardening.md.

### PRE-LIVE ADDITIONS from this session (add to the pre-live checklist)

- **STANDING RULE — THE SPLIT THAT AVOIDS DRIFT** (the help-drawer refresh itself shipped as
  `cc2aba6`, 24 Aug 2026; this rule outlives it and binds every future edit to either file).
  `src/guide/content.ts` feeds BOTH the drawer and the help chat, so one edit updates both.
  **The SHARE PANEL holds the authoritative STEPS** (they are DATA in `sharePlatforms.ts`, so
  they change with the platform) **while the DRAWER explains WHAT the feature is, WHY the link
  is shaped that way, and what to do when it goes wrong.** Two copies of the steps drift within
  a session — this has been proved twice. **Never write a numbered link-building step into
  `content.ts`.**
- **A PASTE-BACK CHECKER — proposed, NOT built.** Catches the host who TYPED the tag instead of
  inserting it, whose messages go out reading "Dear guest first name". **RULE, NOT NEGOTIABLE:
  it must run ENTIRELY CLIENT-SIDE — never sent to the server, never stored, never logged —
  because a RESOLVED paste contains a real guest's name AND their real booking credential.** A
  checker that posts the link for validation would recreate, on purpose, the exposure the
  fragment design exists to prevent.
- **THE CHIP'S TIMING GAP** — `link_claimed_at` is written only in the ACTIVE state, so "Guest
  identified via link" appears on ARRIVAL DAY, while its purpose (template health) wants a signal
  at PASTE time. **The earlier signal already exists and needs no new column: an iCal booking
  that suddenly HAS a name got it from a link.** Not a defect; a follow-up.
- **GUIDE GROUNDING / GUIDE QUALITY — WORKSTREAM CLOSED.** No further prompt tuning; a thin
  category is answered by host picks. The cost/model question was answered by the pilot — the
  guide is rebuilt on POI data, so it needs no grounding at all.
- **Minor: `coercePlaces` does not enforce the 5-per-category cap the prompt requests.** Harmless
  — the post-retry total still cannot exceed `MAX_GEOCODE`.
- **READ ALL THREE AFFILIATE AGREEMENTS FOR THEIR OWN CONTRACTUAL DISCLOSURE REQUIREMENTS,
  SEPARATELY FROM STATUTE.** `736a715` met the Finnish statutory floor; a contract can demand
  MORE, and none of the three has been read with this question in mind. **Pairs with the parked
  multi-tenant confirmation emails** — same threads, same recipients, ask both at once. PARKED
  until go-live per Udy.

> Full argument for all six — including why the drawer is written last and why the checker's
> client-side condition is not negotiable — is in **docs/pre-live-checklist.md**.


> Full workstream, all ten gaps and the document status: docs/legal-workstream.md.

