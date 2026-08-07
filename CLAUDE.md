# Arrivly — CLAUDE.md

Historical session detail lives in docs/history.md. Read it only when past context is
needed. (Deliberately a plain filename, NOT an @import — an imported file is pulled into
context automatically every session, which is exactly what splitting this file avoided.)

> **BRAND vs CODENAME (Jul 12 2026 — rebrand):** the **public brand = Bemgu** (domain **https://bemgu.app**, Resend sender **hello@bemgu.app**, registrar **Porkbun**). The **internal codename = arrivly** — the GitHub repo name (`udybr1975/arrivly-app`), `package.json` name, local folder `C:\dev\arrivly`, the Stripe **`metadata.app === 'arrivly'`** filter (case-sensitive, load-bearing in `api/stripe-webhook.ts`), every `arrivly_*`/`arrivly:*` storage key + window/DOM event, the `arrivly-v*` SW cache name, all env var NAMES, and every code identifier / CSS class deliberately KEEP "arrivly". **Never rename them.** User-facing strings (page titles, meta tags, email copy + sender, push titles, aria-labels, displayed URLs, the "Powered by Bemgu" footer, manifest name) are all "Bemgu".
>
> **Domain migration — COMPLETED (Jul 12 2026):** `bemgu.app` is live; the old `arrivly.anna-stays.fi` now **308-redirects permanently** to it (keep the old domain forever). Stripe **TEST** webhook endpoint is now `https://bemgu.app/api/stripe-webhook`. **Resend = a separate Bemgu account** (region eu-west-1, domain `bemgu.app` verified SPF/DKIM); `RESEND_API_KEY` in Vercel was swapped to the Bemgu account key. `VITE_APP_URL` in Vercel = `https://bemgu.app`. The app URL everywhere in this doc is now **https://bemgu.app**.
>
> **Domain migration + rebrand — FULLY COMPLETE AND SMOKE-TESTED (Jul 17 2026):** all **8/8** prod smoke tests PASSED — (1) demo signup email via the new pipeline; (2) password-reset recovery-hash flow on `bemgu.app` (verified in DB: sign-in + password update 38s apart; **NOTE/lesson:** GoTrue clears `recovery_sent_at` once the link is consumed, so its absence after the flow is normal, not a failure); (3) Google sign-in; (4) plain email/password login; (5) guest-page active state (token `ARR-EVT777`); (6) PWA installs as "Bemgu"; (7) QR downloads as `bemgu-qr-*` and scans to `bemgu.app`; (8) Stripe webhook — real events (`invoice.payment_succeeded`, `customer.subscription.updated`, Jul 14) delivered to `https://bemgu.app/api/stripe-webhook` with **200 OK**. The migration + rebrand is done; only Part G (affiliate registration) remains open.
>
> **Durable facts discovered during the migration + smoke tests (Jul 17 2026):**
> - **Supabase auth emails now route through Resend via Custom SMTP:** host `smtp.resend.com`, port `465`, username `resend`, password = the **bemgu-production Resend API key**, sender **`Bemgu <hello@bemgu.app>`**. Supabase's built-in mailer is no longer used (it was rate-limited and sent from a Supabase address). Supabase email **templates** (incl. the Magic Link/OTP template that carried an ARRIVLY header) were rebranded to Bemgu in the dashboard.
> - **Cloudflare Turnstile widgets are HOSTNAME-ALLOWLISTED:** `bemgu.app` was added to the widget's allowed hostnames (old domain kept). Any future domain event MUST repeat this or the demo money-gate shows "Unable to connect".
> - **Google OAuth consent screen:** App name = **"Bemgu"**; authorized domains include `bemgu.app` (plus the load-bearing `ptkabdelgxkgfslfialx.supabase.co`). The Google popup currently says "to continue to `ptkabdelgxkgfslfialx.supabase.co`" — expected Supabase-architecture behaviour, NOT a bug.
> - **Porkbun account** (registrar for `bemgu.app`/`.co`/`.net` + `getbemgu.com`) is 2FA-protected; free email forwarding provides `hello@`/`info@bemgu.app` → Gmail; Resend "Enable Receiving" stays **OFF** (forwarding owns inbound).
> - **`bemgu.com`** is registered by a third party (dormant GoDaddy-builder placeholder, reg. Mar 2025, renewed to Mar 2027) — a possible future acquisition; revisit post-revenue.
> - **Test-fixture rule reaffirmed:** Sweet home booking `ARR-EVT777` dates must be re-refreshed (`check_in = current_date-1`, `check_out = current_date+3`) before any guest-page test.
>
> **Repo note (Jun 5 2026):** The canonical repo is now `udybr1975/arrivly-app`. The old `udybr1975/arrivly` is abandoned (server-side corruption: pushes rejected "missing necessary objects", Settings page 500s; GitHub support ticket open). Local working copy: `C:\dev\arrivly`. Vercel project `arrivly` is connected to `arrivly-app`.
> **Current HEAD (code) — `d254df9`** (Aug 7 2026), live and SHA-verified against Vercel
> production (`d254df9` = deploy `dpl_5Gy5f7PKNj8mJiyUtwJ5z74PpjRq`, READY):
> `d254df9` (cron-refresh-events correct at concurrency 1 — TPM starvation + silent
> truncation). See "SESSION Aug 7 2026".
> PRIOR — the Aug 6 2026 session shipped **eight** commits, all
> live and SHA-verified against Vercel production (`fc5c97e` = deploy
> `dpl_HdjyX4DZkSPeaJht4rXJqpVnYsvc`, READY):
> `6baafe8` (Step 4 — guide on Geoapify POI + Groq prose, blurb migrated) → `085ff2f` (B2.1 —
> tiered Sight, significance before proximity) → `5f15005` (Step 5 — city events on Tavily + Groq)
> → `862973b` (B3.1 — never overwrite good events with an empty extraction) → `be1b1a9` (B3.2 —
> cron wholesale-failure condition + `no_events` toast) → `8e62b83` (B3.3 — retrieval quality) →
> `863e6e1` (B3.4 — aggregator-url rejection, theme diversity, server-side date window) →
> `fc5c97e` (B3.5 — prompt rebalanced for recall; **LAST events round**).
> **B3.5 IS NOW SMOKE-VERIFIED AND PASSED (Aug 7 2026)** — from the real 09:00 UTC cron run,
> not a manual trigger. Fabrication clean, diversity resolved, recall 3 → 6. One unanticipated
> finding: the OPTIONAL FIELDS COLLAPSED (desc, price, venue). **B3.5 still stands as the last
> events round — do NOT open B3.6.** See "SESSION Aug 7 2026".
> PRIOR: `3c56c95` (shared `scrubErr` helper) → `6fd015c` (atomic per-host `generate-guide`
> cooldown), Aug 4 session 2; then `b90a648` (Step 3 — four surfaces on Groq).
> PRIOR HISTORY: `d282fe8` (guide dedupe + empty-category retry) closed the Jul 29 session 2
> chain `fbf58aa` (fra1 pin + ntfy scrub) → `1af1012` (grounded guide + English descriptions)
> → `a940158` (distance rules + Coffee + per-generation logging) → `d282fe8`.
> Preceding that: `98017fe` (geocoding bias
> + 25 km bound), `27b881b` (cross-tenant anon leak CLOSED — see the SECURITY section),
> `82fd0dc` → `5f16b42` → `ff444a0` → `aa446d2` → `d79fd9e` (welcome page `/w/:code` Phase 1).
>
> **WHERE THE PROJECT IS:** Phases A–E, G, H and Phase I Stages 0/4A/4B/5 are COMPLETE.
> Build order decided: **flip live on Tiers 1–3 FIRST, then build Phase F (Tier-4 booking)**
> — so the pentest gate runs on the Tiers 1–3 surface, and Phase F needs its own second
> security pass before Tier 4 is sold.
>
> **THE FOUR THINGS BLOCKING LAUNCH:** (1) **~~enable billing on ALL FIVE Gemini projects~~ —
> REPLACED Aug 5 2026 by the ZERO-GOOGLE AI PILOT (see its canonical section; the Bemgu billing
> account is CLOSED and there is no billing flip).** The reason billing was ever required stands
> and is what the pilot answers: Google's terms permit **only Paid Services** for API Clients made
> available to EEA/CH/UK users, and grounding's processor-DPA cover also requires paid quota — a
> **CONDITION OF LAWFUL USE, not a quota upgrade**. The pilot removes Google from the stack rather
> than paying for it. **The pre-billing security review's in-code half is COMPLETE** — see
> "SPEND-ABUSE HARDENING — COMPLETE, CANONICAL SUMMARY". **Next action: PILOT STEP 1 CHECKS.**
> (2) the legal/compliance workstream — inventory DONE, **eight gaps still open** (2 + 3 closed
> by `fbf58aa`); documents 3/4/5 **DRAFTED, unpublished** — and the **retention crons must ship
> before any of them is published**; (3) migrating the eight `gemini-2.5-flash` call sites before
> its **16 Oct 2026 shutdown**, and sizing the paid-grounding cost; (4) the pentest gate.
> Also open but smaller: welcome-page Part 2, and the pre-live additions listed further down.
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
| `/onboarding` | OnboardingFlow | protected |
| `/dashboard` | Dashboard | protected |
| `/dashboard/property/:aptId` | PropertySetup | protected |
| `/dashboard/bookings` | BookingManager | protected |
| `/dashboard/messages` | Messages | protected |
| `/dashboard/qr` | QRCodePanel | protected |
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

**Billing-test hosts (S19 cont.):**
- **Roy** (udy.bar.yosef@sterlights.com) `3b11235b-d6af-4291-a929-db0194065740` — billing sanity click-through; now tier 2, status trial, sub `sub_1TgnuY…` / `cus_UgADqTdBVkwPFj`, trial ends ~2026-06-24.
- **Yaron** (udy@1234.com) `06eb554e-40eb-45fd-a6ed-7dbc2edbc0c1` — subscribed-during-trial (completed Checkout; trialing `sub_1TlZaX…` / `cus_Ul5l…`, no charge until ~2026-07-07).
- **Udyn** `11b5b459-d631-41b1-8d5c-327613f0e346` — parked in `grace` on the test-clock sub (`cus_UkzljDJks6qaGC` / `sub_1TlTpFFgkuKMBYAu7yJaesdN`).
- **Yiftach** (yiftach@xn--gnai-8qa.com) `6dbfbda4` — clean trial, no subscription (a pre-fix subscribe attempt errored before creating anything; nothing to remove).

---

## Gemini AI key map (per-surface isolation)

> **STALE-FRAMING POINTER (Aug 4 2026, REVISED Aug 5 2026) — read before acting on any "no-card"
> wording below.** The per-surface key **ISOLATION is correct and STAYS**. The Aug 4 position was
> that **all five projects must be on BILLING before launch**, because Google's terms permit
> **only Paid Services** for API Clients made available to EEA/CH/UK users and grounding's
> processor-DPA cover requires paid quota. **That requirement is now answered a different way:
> the ZERO-GOOGLE AI PILOT (Aug 5) REMOVES Google from the stack instead of paying for it — the
> Bemgu billing account is CLOSED and all five projects are back on no-card free tier as an
> accepted pre-launch bridge state.** So "no-card" wording below is once again accurate for the
> interim, and the key map itself is superseded per-surface as each one migrates. See the
> ZERO-GOOGLE AI PILOT section (canonical) and "SESSION Aug 4 2026" for the terms reasoning.

Each high-volume / public surface has its OWN no-card AI Studio key (separate free-tier daily quota), with `|| GEMINI_API_KEY` fallback so behaviour is unchanged until the dedicated key is present in Vercel. NO secret values live in this repo (public).
- **Shared `GEMINI_API_KEY`** serves: `rewrite-rules`, `bulk-import`, `greeting` / `daily-greeting`, `host-picks`.
- **`GEMINI_API_KEY_GUIDES`** → `api/_lib/guide.ts` (guides). Reads `GEMINI_API_KEY_GUIDES || GEMINI_API_KEY`.
- **`GEMINI_API_KEY_CHAT`** → `api/guest-chat.ts` (guest chat). Reads `GEMINI_API_KEY_CHAT || GEMINI_API_KEY`.
- **`GEMINI_API_KEY_EVENTS`** → `api/_lib/city-events.ts` (city events; shared by the guest lazy-fill, `cron-refresh-events`, and host `refresh-events`). Reads `GEMINI_API_KEY_EVENTS || GEMINI_API_KEY` (`acd16f4`, Jun 25 2026). Set in Vercel production + preview.
- **Grounded endpoints (`guest-chat`, `city-events`) MUST stay on Gemini** — Groq can't do Google Search grounding. The non-grounded shared-key endpoints are the only ones eligible to move to Groq later (capacity/redundancy, see "On the horizon").

---

## Known notes / minor debt
- Cron sequential loops in `cron-sync-ical` AND `cron-refresh-events` share the "batch at scale / maxDuration" debt — fine at current apartment counts; batch before many booked apartments. (Phase G cron-batching item.) **⚠ NO LONGER "fine at current counts" FOR `cron-refresh-events` (Aug 6 2026): at B3.3+ prompt sizes its `mapPool` concurrency of 2 EXCEEDS the 6K TPM Groq org ceiling deterministically, so a multi-candidate run is expected to 429 AND starves guest-chat / guide / daily-greeting across every tenant while it runs. Fix is `concurrency: 1`, and it is the top of this debt — see "SESSION CLOSE Aug 6 2026" open item 1.**
- `city-events` lazy-fill: the FIRST guest to view an uncached apartment waits ~the generation time (one-off); the cron pre-warms apartments with current/upcoming bookings so most are already warm.
- **`cron-refresh-events` schedule vs Gemini quota-day — CLOSED (`dbfc034`, Jul 28 2026).** Both Gemini crons rescheduled off the tail of the free-tier quota day: `cron-refresh-events` `0 4 * * *` → **`0 9 * * *`**; `cron-refresh-guides` `0 3 1 * *` → **`0 10 1 * *`** (verified via source that it calls Gemini through `generateGuideForApartment` → `api/_lib/guide.ts`). Key isolation confirmed at the same time: events reads `GEMINI_API_KEY_EVENTS || GEMINI_API_KEY`, guides reads `GEMINI_API_KEY_GUIDES || GEMINI_API_KEY` — each a separate AI Studio project with its own daily quota, so neither reschedule is neutralised by key-sharing. **HONEST FRAMING:** the Jun 25 incident was already mitigated a month earlier by the dedicated events key (`acd16f4`); this reschedule is defence-in-depth for events, and the FIRST timing protection for guides. code-reviewer PASS (0 must-fix); vercel.json only, 2 changed lines, both schedule strings. Original entry follows for history: The events cron runs `0 4 * * *` (04:00 UTC ≈ 21:00 Pacific) — the TAIL of Gemini's free-tier quota-day (free-tier daily limits reset ~midnight Pacific ≈ 07:00–08:00 UTC). On 2026-06-25 this run 429'd every candidate apartment and fired the ntfy "all event refreshes failed" alert because city-events was still on the SHARED `GEMINI_API_KEY`, whose daily quota was exhausted. Mitigated by the dedicated `GEMINI_API_KEY_EVENTS` (`acd16f4`) giving the events surface its own daily quota. **Not yet done (Udy deferred):** reschedule `cron-refresh-events` from `0 4 * * *` → `0 9 * * *` in `vercel.json` so the run lands just AFTER the Pacific reset — the dedicated key lowers recurrence risk, the reschedule mostly removes it. NOTE: the cron itself behaved correctly that day (returned 200, left cache rows intact / stale-safe; the alert only fires when `refreshed === 0`). VERIFICATION PENDING: the next 04:00 UTC run is the passive test — no ntfy alert = the dedicated key worked.
- Re-saving house rules re-polishes already-polished text (Gemini call on every save). Minor; acceptable for now.
- iCal fetch (`api/_lib/ical.ts`, used by both sync-ical and cron-sync-ical): mild SSRF (no
  private-IP/metadata blocklist on fetched URLs); no per-host rate limit. The monthly cron now
  exercises this unattended. Tidy SSRF + rate limit before public launch.
- `sendPushToHost` url check uses `startsWith('/')`, which also admits protocol-relative `//host` — only ever set from the host's own send-push request (self-targeted), so negligible.
- send-push `apartmentId` is not ownership-checked — latent only (lookup forces `host_id = userId`, so a foreign apartmentId matches zero rows).
- `api/guest-chat.ts` (S21): verify-gated (public tier → `403 verify_required` before any Gemini call) + per-instance rate limiter (15/min, apt+IP) + dedicated `GEMINI_API_KEY_CHAT`. The limiter is per-instance best-effort, not a hard cross-instance cap. `generate-guide` remains host-auth+ownership-gated (no public AI-spend surface).
- Message retention: add ~90-day post-checkout cleanup job before public launch (Phase G).
- sw.js `showNotification().then()` — if showNotification rejects, badge is not set and the rejection is swallowed by `event.waitUntil`; low risk, standard SW pattern (W2, `c294bda`).
- `countUnread` in `Layout.tsx` called directly from event listeners with no mounted guard at call site — safe because `mounted` flag is closed over and listeners are removed on cleanup before it matters; no real bug (W3, `c294bda`).
- `BookingManager.tsx` `arrivly:messages-read` handler calls `loadBookings()` without a cancellation signal — tiny stale-overwrite race on rapid apartment switching; fold into next BookingManager change.
- `api/public-pricing.ts` cache is `s-maxage=60` — admin trial/price edits show on the landing within ~1 min.

### Tracked security follow-ups (S19; updated S24)
- ~~**`guests` readable by ALL authenticated hosts**~~ **RESOLVED S24 (F-01)** — guest creation moved server-side (`api/create-booking`), `guests_host_read` replaced with a host-scoped SELECT policy. Verified live: cross-tenant overlap 0.
- ~~**`guests_insert_open` anon INSERT**~~ **RESOLVED S24 (F-02)** — policy dropped; anon + authenticated INSERT revoked (service-role inserts only).
- ~~**`function_search_path_mutable` on `set_updated_at` + `auth_owns_apartment`**~~ **RESOLVED S24** — `search_path=public` pinned on both.
- ~~**Non-public SECURITY DEFINER EXECUTE grants** (`auth_owns_apartment`, `enforce_property_cap`, `handle_new_user`)~~ **RESOLVED S24** — PUBLIC EXECUTE revoked (anon/authenticated can no longer RPC them). `guest_host_card` remains anon-callable BY DESIGN (guest page reads host branding).
- **STILL OPEN — leaked-password protection disabled** (Auth dashboard HaveIBeenPwned toggle; pending).
- **STILL OPEN — `api/guest-state.ts` rate limiter is per-instance best-effort** (serverless memory not shared) — a shared-store / Vercel-firewall limiter is a later option.
- **STILL OPEN — QR key rotation:** a leaked per-apartment key is revocable only by rotating `apartment_qr_secrets.qr_secret`, which invalidates every printed QR for that apartment (no per-guest revocation).
- **STILL OPEN (by-design, INFO):** the 4 RLS-on/zero-policy service-role tables (`admin_audit`, `apartment_qr_secrets`, `app_settings`, `city_events_cache`) and the intentional anon `guest_host_card` EXECUTE remain as advisor INFO/WARN — accepted by design.

---

## Lessons / learnings

- **DOCUMENT WHAT A POLICY PERMITS, NOT WHAT THE APP DOES (Jul 28 2026 — this cost a
  cross-tenant leak).** CLAUDE.md described the four anon guest-read policies by the app's
  behaviour (".eq('apartment_id')") instead of the policy predicate (`USING (true)` for
  PUBLIC, no apartment scoping). Reading the doc, the policies looked scoped; they were not.
  That wording is precisely why the leak stayed invisible across multiple sessions and was
  MISSED BY THE FULL S24 SECURITY AUDIT. For every RLS policy, record the predicate itself —
  the app's query is a convention, not a boundary, and an attacker uses the bundled
  publishable key directly rather than the app.

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

- **CRITICAL — Supabase Storage rejects the host's gotrue user JWT on this project.**
  Authenticated uploads are treated as anonymous, so the owner-scoped write RLS policy refuses
  them with "new row violates row-level security policy" (HTTP 400). The database (PostgREST)
  and auth (gotrue) accept the SAME token fine; only Storage refuses it. Almost certainly a
  side effect of the earlier API-key / JWT-signing-key migration (legacy HS256 revoked). Proven:
  a simulated authenticated insert to `{hostId}/...` passes RLS; the real request carries
  `Authorization: Bearer` and still 400s. **DO NOT fix uploads by attaching the token
  client-side** — that was tried (`2cbad9b`) and Storage still refused it. The working pattern
  is server-minted signed upload URLs via the service-role key + client `uploadToSignedUrl`
  (the signed token authorises, independent of the user JWT); this also lifts the Vercel 4.5 MB
  body limit since the file goes direct to Storage. Open item: Storage not accepting user JWTs
  is a project-level issue to raise with Supabase support (JWT signing keys) — not required for
  uploads to work, but affects any future direct-Storage client call.

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

- **`AbortError: Registration failed - push service error` is a device / local-Chrome state, not an app bug.** Diagnosed on a Redmi Note 13 Pro 5G (HyperOS): web push worked for other sites but failed for Arrivly. Tells: permission "allowed", error thrown by `pushManager.subscribe`, and an EMPTY `chrome://gcm-internals` Registration Log = the failure is LOCAL (before any FCM round-trip), not Google-side. Cause was corrupted local notification state tangled with the installed WebAPK's notification delegation ("Managed by Arrivly"). Fix that worked: uninstall the app → Chrome site settings → Delete data and reset permissions → reboot → enable in a clean tab. Treat web push as best-effort — unreliable on Xiaomi/HyperOS and other battery-aggressive Android ROMs; the in-app 15s poll + host-always-notified is the fallback, so a guest device that can't register push still works.

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

- **guest-chat runs on its own AI key (`GEMINI_API_KEY_CHAT`), isolated from the shared `GEMINI_API_KEY`.** It reads `process.env.GEMINI_API_KEY_CHAT || GEMINI_API_KEY` (same fallback shape as the guides key) and is a no-card key created in a SEPARATE AI Studio project so its free-tier DAILY quota is its own. INTERIM (S21): it stays no-card until the Google payment issue is resolved, then this single key flips to BILLED — which removes the daily cap; the verify-gate + limiter bound the spend. Groq cannot replace guest-chat (needs googleSearch grounding). **SUPERSEDED IN PART (Aug 4 2026): this is NOT a one-key quota flip pending a payment issue — ALL FIVE projects must go to billing before launch, for the contractual (EEA paid-only) and grounding-DPA reasons in "SESSION Aug 4 2026". The isolation itself stays correct.** **FULLY SUPERSEDED (Aug 5 2026) by the ZERO-GOOGLE AI PILOT — TWO corrections: (a) there is NO billing flip, the Bemgu billing account is CLOSED; (b) "Groq cannot replace guest-chat" is NO LONGER TRUE — the pilot replaces grounding with a ROUTER (cheap LLM for ungrounded turns, Geoapify/LocationIQ POI for "nearby X", Tavily for open-web), so guest-chat does not need googleSearch at all. The per-surface key isolation still stays correct, and its brake (40/h, victim-keyed, fail-closed) moves with it.**

- **Gemini free-tier quota is a DAILY cap; exhausting it surfaces as intermittent guest-facing 500s — not a code bug.** In S21 testing an 18-call burst exhausted the free-tier daily quota; later chats returned Gemini `429 "exceeded your current quota"` (plus transient `503 "high demand"`), surfaced as a 500. The daily cap does NOT reset within a minute, so "wait a moment" is wrong advice for a quota 429. Before blaming app code for guest-chat failures, check the Vercel runtime logs for the upstream Gemini status code; a dedicated/billed key is the fix, not a code change.

- **city-events runs on its own AI key (`GEMINI_API_KEY_EVENTS`), isolated from the shared `GEMINI_API_KEY`** (`acd16f4`, Jun 25 2026). `api/_lib/city-events.ts` reads `process.env.GEMINI_API_KEY_EVENTS || process.env.GEMINI_API_KEY` (same fallback shape as the guides/chat keys) — a no-card key in a SEPARATE AI Studio project so its free-tier DAILY quota is its own; the `if (!apiKey)` guard and `scrubErr` key-scrubbing are unchanged. Trigger: on 2026-06-25 the `0 4 * * *` events cron 429'd every apartment and fired the ntfy "all refreshes failed" alert because the shared key's daily quota was exhausted at 04:00 UTC (≈21:00 Pacific, the tail of Gemini's quota-day; free-tier resets ~midnight Pacific). The shared key still serves the non-grounded endpoints — keep each high-volume/public Gemini surface on its own dedicated key. **ANNOTATION (Aug 4 2026): the "no-card" part is now a launch blocker, not a cost choice — all five projects go to billing before launch (see "SESSION Aug 4 2026"). The per-surface isolation stays.**

- **Windows PowerShell dev-env gotchas (setting Vercel env vars locally).** `npx` can fail with `npx.ps1 cannot be loaded` (unsigned script) — fix once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or call `npx.cmd`. In PowerShell `curl` is an alias for `Invoke-WebRequest` (different flags) — use `curl.exe` for real curl. Inline `-d '{json}'` mangles quotes in PowerShell — write the body to a file and pass `--data "@file"`. A Vercel env-var add needs a redeploy (`npx vercel redeploy <url>`) to take effect. **(Jul 27 2026 addendum)** `npx.ps1` can STILL be blocked under `RemoteSigned` when the file carries the downloaded-from-internet flag — use `npx.cmd` or `Unblock-File`.

- **Vercel "sensitive"-flagged env vars cannot be pulled — `vercel env pull` returns them EMPTY (Jul 27 2026).** So a manual cron trigger that needs `CRON_SECRET` (marked sensitive) is NOT possible from a fresh machine — you cannot reconstruct the `Authorization: Bearer <CRON_SECRET>` header the cron guard requires. **Verify a scheduled cron ran by reading its RUNTIME LOGS (Vercel MCP / dashboard), not by manually curling the endpoint.** Same trap applies to any sensitive secret (Viator/Tiqets keys) — they're write-only once set.

- **When a function's EXECUTE comes from the DEFAULT PUBLIC grant (ACL `=X/owner`), `REVOKE EXECUTE ... FROM anon, authenticated` is a SILENT NO-OP** (S24). Those roles inherit EXECUTE via PUBLIC, not a direct grant, so there is nothing to revoke from them. `REVOKE EXECUTE ... FROM PUBLIC` instead — owner (`postgres`) + `service_role` keep their explicit grants, and trigger functions fire as owner regardless. ALWAYS confirm a function-privilege change against the LIVE ACL (`pg_proc.proacl` / `has_function_privilege`), not just that the statement executed without error. (Same trap applies to table grants via PUBLIC — check `relacl`.)

- **`guests` is server-write-only (`api/create-booking`) with a host-scoped SELECT policy (S24).** Never reintroduce a client-side `guests` insert/read, or a `USING(true)` policy. One guest row per booking; no cross-host first-name dedup. The host-scoped SELECT (`id IN (select b.guest_id from bookings b join apartments a on a.id=b.apartment_id where a.host_id = auth.uid())`) keeps the bookings-list and Messages `guests(...)` embedded joins working because they only ever surface the host's own bookings' guests.

- **`hosts` uses COLUMN-LEVEL UPDATE grants as a defence layer — new columns do NOT inherit them (Stage 4B, Jul 26 2026).** `authenticated` has UPDATE on a specific allowlist of host columns only (brand_name, accent_color, ui_state, …); server-only columns (tier, plan, subscription_status, stripe_*, trial_ends_at, the notice/pending/cancel columns) have UPDATE deliberately withheld. **Any migration adding a host-writable column MUST include an explicit column-scoped `GRANT UPDATE (col) ON public.hosts TO authenticated`** — RLS `hosts_update_own` (`auth.uid()=id`) alone is NOT sufficient because PostgREST also needs the column privilege. Stage 2 missed this for the three `*_partner_id` columns (they were granted SELECT/INSERT but not UPDATE), so the client Connect write silently 403'd; corrective migration **`grant_host_partner_id_column_update`** fixed it (verified: the three partner-id columns writable by `authenticated`; tier/plan/stripe/trial columns still read-only). ALWAYS confirm with `information_schema.column_privileges` after the grant.

- **WORKFLOW — migrations belong to Claude-in-chat via Supabase MCP, NOT to Claude Code mid-build.** In Stage 4B a needed corrective migration was applied by Claude Code during the build. The fix was correct and verified, but the rule is: **if a migration turns out to be needed mid-build, STOP and report back** rather than applying it. Future code prompts must state this explicitly (reader-migration-first sequencing stays a chat-side responsibility).

- **Click beacons undercount: context-menu "open in new tab" and middle-click bypass the card's onClick (Jul 26 2026).** `experience_clicks` therefore misses those opens (verified: 1 seeded browser-control click never logged). **Provider-side attribution is UNAFFECTED** — the outbound link carries its campaign tag regardless of how it's opened. Accepted for v1: **Earnings taps are DIRECTIONAL; the provider dashboards are money-truth.** BACKLOG: a `/api/go` redirect endpoint (log-then-302) if exact click counts are ever needed.

**THE DURABLE LESSON — BOTH REVIEW GATES INDEPENDENTLY CAUGHT A DEFECT IN THE PROMPT'S OWN SPEC,
not in the code.** The instruction was to gate the alarm on `deferred === 0`. That is **wrong in
the dangerous direction**: a skip is **ORTHOGONAL** to failure (B3.2's whole argument — every
provider fault lands as `failed`, never as `skipped`, so a skip is positive evidence AGAINST an
outage), but a deferral is **CORRELATED** with it, because a hanging provider burns the deadline
on apartment 1 and defers the rest. Gating on `deferred === 0` would therefore have silenced
**exactly the slow outage the alarm exists to catch**, while still firing on fast ones. Shipped
instead: scope the claim to what was tried —
`attempted = candidates.length - deferred`, alarm when `failed === attempted`.
**GENERAL RULE: SUPPRESSING AN ALARM ON A BUCKET CORRELATED WITH THE FAULT IS NOT THE SAME AS
SUPPRESSING IT ON AN ORTHOGONAL ONE.** Before suppressing a detector on a new state, prove which
failure modes actually produce that state.

Judged against B3.5's OWN recorded acceptance criteria — which is the point, because those
criteria were written before the run and specifically to stop a higher event count being mistaken
for success:
- **FABRICATION: CLEAN.** Blank-url share = 6 − 0 − 0 − 5 = **1 of 6**; the recorded padding
  signature did not appear. **`urlsRejectedProvenance` 0 is the stronger reading — the model
  invented NO urls at all**, it only reached for site-level ones the aggregator guard then caught.
  Hand-checked **3 of 3 correct** against the live web: Pete Parkkonen / Allas Live / 8.8.2026
  exact; México A Cappella / Temppeliaukio Church / 13 Aug 19:00 exact (Mexican Embassy, free
  admission); bbno$ / Kulttuuritalo corroborated by the independent B3.3 run.
- **DIVERSITY: RESOLVED — and it was EXTRACTION, not SELECTION.** `themeCounts` culture is **3**,
  not 0-1, so the recorded "if culture is 0-1 it is SELECTION and no prompt text can fix it"
  branch **did not apply**. Output spans concert / family / market / arts festival against B3.4's
  three straight concerts. **This is exactly why `themeCounts` was added: it decided between two
  causes needing opposite fixes, instead of another guess.**
- **RECALL: 3 → 6.** Below the stated floor of 8, direction correct.
- **NEW, NOT ANTICIPATED BY THE CRITERIA — THE OPTIONAL FIELDS COLLAPSED.** `desc` came back as
  **7-19-character labels** ("Concert", "Music event") against a "one short sentence, max ~100
  characters" spec; **all six prices empty INCLUDING México A Cappella, which is explicitly
  free**; **2 of 6 venues empty**. Mechanism: B3.5 added a hard count target and floor while
  capping `desc`, so the model met the count by minimising per-event cost — **it bought recall
  with field quality.** NOT fabrication, NOT a guard failure. **Blank venue is the one that
  matters**, because `EventsPage.eventHref` falls back to a title+venue+city search when the url
  is blank, so a blank-url blank-venue event has the weakest fallback of all.
  **DECISION (Udy): do NOT open B3.6. B3.5 stands as the last events round.** Fold ONE
  field-quality clause into the Step 7 prompt/alarm-text sweep — text-only, no new round, no extra
  Tavily spend.
- **ALSO: `datesUnparseable` 3 includes both Finnish `d.m.yyyy` dates**, so the recorded
  non-English date gap now **demonstrably carries real, correct traffic** through the `null` =
  KEEP branch. Working as designed — **but state it precisely: the window guard is INERT for
  Finnish-format dates**, so those events are kept unverified rather than checked.
- **MARGINAL, worth knowing:** "Helsinki Festival, 14-31 August" intersects the window only on its
  final day. Correct per the code (a range is kept if ANY day intersects), just barely.

### Greeting system (S18)
- The guest home-tab greeting is 4 layers: (1) time-aware salutation (getDayPart/getTimeSalutation from the guest's DEVICE clock), (2) neighbourhood blurb from `apartments.greeting_blurb` or a static fallback, (3) live weather (now fetched via the apartment's `lat,lng` — more reliable than the old neighbourhood/city text lookup), (4) a dynamic time-of-day suggestion from `/api/daily-greeting`. Signed in the host's brand name.
- `api/_lib/greeting.ts` = generateGreetingBlurb (Gemini → apartments.greeting_blurb; called best-effort after guide generation, so refreshing the guide refreshes the blurb) + generateDailySuggestion (pure prose; the endpoint handles caching). Both follow guide.ts conventions: gemini-2.5-flash, thinkingConfig.thinkingBudget 0, withRetry, AbortController, AIza/key= error scrubbing.
- `api/daily-greeting.ts` = guest POST { apt, token, day_part, temp?, condition? }. Auth via resolveGuestAccess (booking token) — ONLY 'verified' guests trigger Gemini (protects spend); everything else returns { suggestion: null } → static fallback. local_date is derived SERVER-SIDE (Helsinki) to prevent cache flooding; the client must NOT send a date. **(S28) Caches/reads/race-reselects PER BOOKING on `(booking_id, local_date, day_part)`** (gated on `verified && bookingId`); computes `stay_day = local_date − check_in + 1` (UTC-midnight diff); feeds the booking's last-6 suggestions to generation as a do-not-repeat list. ALWAYS returns 200 (null on any error) — never 5xx the guest hero.
- **(S28) `generateDailySuggestion` is now per-booking, day-part-HARD-constrained (explicit ALLOW/DENY per part — morning never shows evening/night content and vice-versa), anti-repeat (a SLIDING WINDOW of the booking's last ~6 lines, not absolute), and stay-day aware (a variety nudge from `stay_day`).** Old shared `(apartment, date, day_part)` cache is gone. All model config preserved (gemini-2.5-flash, thinkingBudget 0, withRetry, AIza/key scrubbing); response shape `{ suggestion }` unchanged (no client contract change). The old PARKED sketch (blurb VARIANTS + a big "Right now in {neighborhood}" slot) was SUPERSEDED — variants were dropped as unnecessary once the blurb became first-open-only.
- **(S28) UI (`GuestPage.tsx`): the blurb is FIRST-OPEN-ONLY** (per-booking `localStorage` flag `arrivly_guest_blurb_seen_<token>`); on later opens the letter reads as a stable host note. The time/weather/suggestion moved OUT of the letter into a dedicated **"Right now" card** (the visibly-fresh element). **~~KNOWN LIMITATION~~ — LARGELY CLOSED (Aug 5 2026):** the suggestion used to generate on the FIRST `/api/daily-greeting` fetch, which fired before weather resolved, so the text was NOT weather-influenced. The fire-once fix added a **2.5s grace window**, so in the common path the request now carries real `temp`/`condition` and the suggestion CAN reference the weather. If weather is slow or fails it still fires once with nulls (never blocks the hero) — and note the server cache key `(booking_id, local_date, day_part)` excludes weather, so a weather-less suggestion is then persisted for the whole slot. The "Right now" card's weather pill remains independently live.
- The blurb generates only when the guide runs (property Basic save is client-side, no server hook). To make a new property warm immediately, PropertySetup fires `api.post('/generate-guide')` fire-and-forget on first creation (wasNew) — guide + blurb populate in the background without blocking navigation.

---

## Workflow

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

## PHASE I — EXPERIENCE CONNECTORS (Stages 0/4A/4B SHIPPED + verified live, Jul 26 2026; scoped S29, Jul 10 2026)

Phase I part (b) — third-party bookable experiences on the guest-page Explore tab — is **BUILT, SHIPPED and verified live in production** through Stage 4B. This supersedes the loose "Viator/GetYourGuide/OpenTable" line in the Phase I roadmap bullet above. The scoping text below is retained for context; the "Build stages" list carries current status. **Remaining: Stage 5** (marketplace reporting ingest — until then commission figures deliberately link out to each provider dashboard).

**Scope — v1 providers: Viator + GetYourGuide + Tiqets** (maximum city coverage; all three have open/free affiliate signup — Viator grants Basic API access instantly, Tiqets grants Content+Availability APIs at signup, GYG partner-portal review takes days). **Restaurants (OpenTable/TheFork) DROPPED from Phase I:** per-booking fees are pennies, access gates are slow, EU coverage is weak (OpenTable), and Host Picks already covers restaurants editorially. **Holibob** (B2B white-label experiences API, 500k+ products, negotiated margin) = the **Phase-2 embedded-checkout target** once volume justifies a BD conversation.

**Revenue model DECIDED — variant "c-full" ("show everywhere, earn at Tier 3"):**
- Guest pages on ALL tiers show IDENTICAL experience cards; outbound links are **server-built deep links (NOT provider embed widgets** — widgets set cookies and would drag GDPR consent obligations onto the guest page).
- Every link stamped with campaign tag **`arrivly-{apartmentId}`**.
- **Tier 1–2:** links carry ARRIVLY's OWN partner IDs → Arrivly earns the ~8% commission on lower-tier traffic; per-campaign provider reporting powers a personalised, factual upgrade tease in the Earnings panel ("Guests at your properties booked €X last month — on Tier 3 that commission is yours"). **Transparent copy is MANDATORY:** the panel must state plainly that on T1–T2 commissions go to Arrivly and on T3 to the host.
- **Tier 3+:** host pastes their OWN partner IDs (per provider) and links switch to the host's IDs → provider pays the host directly (~8%); Arrivly never touches host money.
- **Gating rationale (verified Jul 10 2026):** Hostfully includes Viator earning FREE on all plans incl. free tier; Hostaway ships GYG as a standard integration. c-full keeps guests unharmed, monetises low tiers, and turns the gate into a personalised upgrade ad.

**Host UX:** new account-level **"Earnings" sidebar section** (partner IDs are per-host, NOT per-property). Per provider: signup deep link, ID input with format validation (Viator ID = `P` + 8 digits), connected state. **Guest UX:** experience cards render in the Explore tab via the existing `SHOW_EXPERIENCES_SLOT` flag-gated slots.

**Marketing anchor numbers (for the landing page later):** ~8% commission → ~**€315/month** of guest bookings covers the full **€25 Tier-3** fee (~2–3 tour bookings); comps charge per property (Hostfully Guidebooks $9.99/1 → $24.99/5 → $49.99/10 → $75+; Touch Stay ~$15/property, no free plan) vs Arrivly **flat €25 unlimited**.


**Link spec — CONFIRMED LIVE for all three providers (per-apartment campaign attribution on EVERY link):**
- **Viator:** `pid` + `mcid=42383` + `medium` (an API-supplied `medium=api` is preserved; `medium=link` stamped only when absent) + `campaign=bemgu-{apartmentId}`.
- **GYG:** `partner_id` + `cmp=bemgu-{apartmentId}` (**`cmp` MANDATORY** — a missing campaign lands in GYG's `no_reseller_campaign` bucket).
- **Tiqets:** `partner` + `tq_campaign=bemgu-{apartmentId}` (surfaces as `campaign_name` in both portal reports and the Reporting API; **CONFIRMED IN WRITING by Tiqets support Jul 27 2026** as the correct per-campaign tracking approach).
- **The link builder (`api/_lib/affiliate-links.ts`) is PARSE-AND-REWRITE (`URLSearchParams.set`), NEVER append.** Provider APIs return **PRE-TAGGED** product URLs (Viator embeds `pid`/`mcid`/`medium=api`; Tiqets embeds `partner`); blindly appending duplicated ids and produced conflicting `medium=api`+`medium=link`. **c-full critical:** a tier-3 host's link carries **ONLY the host's** partner ID — Bemgu's `pid` is REPLACED and Bemgu's `mcid` is **DROPPED** on host-owned Viator links. Covered by a `node:test` suite — **`npm run test:affiliate-links` — keep these assertions green forever** (a dev-only `.ts` resolver hook lets plain-node import the api/ TS; not shipped/imported by runtime).

**Open verification items / external threads:** (a) exact commission rates are account-level and change — product copy must say "typically ~8%", **never promise a number**; (b) **Viator multi-tenant / host-own-ID permission — REPLIED ~Jul 29, NO APPROVAL GIVEN, still OPEN and now a TIER 3 LAUNCH DEPENDENCY** (sent Jul 24; see "SESSION Aug 4 2026" for what the reply did and did not say, and for the drafted-unsent response); (c) **Tiqets image pipeline — VERIFIED LIVE Jul 27 for partner `bemgu-188668`** (cache invalidated via MCP → lazy-fill returned real Tiqets CDN image URLs on all Sweet home cards; ratings + `imageCredit` mapping shipped). Only a final visual caption eyeball on a live card remains (if not already done). **DONE this session (was item d):** the Tiqets `reviewCount`-null bug is fixed (`146173f` — `ratings.total`/`ratings.average` mapping) and the temporary `[experiences:tiqets:debug]` log is removed.

### Tiqets licence obligations (permanent — confirmed by email Jul 26 2026)
- **Image credits (clause 9.1c):** image access is **ENABLED + VERIFIED LIVE (Jul 27 2026)** for partner `bemgu-188668`. Confirmed shape from the (now-removed) `[experiences:tiqets:imgdebug]` one-shot log: each `images[]` object carries `{ small, medium, large, extra_large, credits, alt_text }` — the credit field is **`credits`** (string or null; null is valid — a caption renders only when Tiqets provides one, e.g. "Stromma Finland" / "Helsinki Dreamdays Tours" on Sweet home cards). `540d57f` maps `imageCredit` from the selected image's `credits`; `ExperiencesSheet` renders it as a caption — **never strip it.**
- **Cache-freshness floor:** images/product data must refresh at least every **14 days** (Tiqets disclaims liability for stale images). The current 7-day `expires_at` + daily cron satisfies it — **NEVER extend `experiences_cache` TTL beyond 14 days.**
- **Viator constraints still stand (unchanged):** guest pages carrying marketplace content are **noindex**; per-host custom domains would breach Viator's own-domain clause (do NOT offer custom host domains while experiences render on the guest page).

### Credentials, keys & environment (Stage 4A/4B ops — Jul 26 2026)
- **Viator has TWO key types on the SAME dashboard page (Tools → Affiliate API): SANDBOX (issued first, top of page) and PRODUCTION (a separate "Get key" step below).** Sandbox keys `401` against the production API — this cost ~2 days of debugging. `VIATOR_API_KEY` in Vercel **Production** is now the **PRODUCTION** key, stored with Vercel's **"sensitive" flag** (write-only — re-copy from the Viator dashboard if it's ever needed again). `TIQETS_API_TOKEN` unchanged. Partner IDs are NON-SECRET; API keys/tokens are SECRETS (server-side env, no `VITE_` prefix). GYG has no API key at this access level (link/widget-based).
- **ENVIRONMENT POLICY — there is NO Preview environment for Bemgu (by decision).** Pre-marketing, **production IS the test environment** (guest pages are unreachable without a QR/link, so there's no exposure). All testing happens on production; the Preview env-var scope is deliberately **not maintained**. `VITE_EXPERIENCES_ENABLED=true` is live in Production (public flag, non-sensitive). **REVISIT-TRIGGER = the first real paying host:** at that point re-establish Preview (add `VIATOR_API_KEY`, `TIQETS_API_TOKEN`, `VITE_EXPERIENCES_ENABLED` to the Preview scope) and stop testing on prod.
- **Email / comms:** `hello@bemgu.app` sends via Gmail "send mail as" + Resend SMTP (`smtp.resend.com:465` / SSL, username `resend`, a **dedicated send-only key `bemgu-smtp-personal`** — SEPARATE from the production `RESEND_API_KEY`). A real (non-forwarded) mailbox is a pre-live checklist item. **Provider thread log:** **Tiqets — FULLY CLOSED (Jul 27 2026, two replies same day):** all three asks resolved — Reporting API self-serve via a fresh Essential-API token, `tq_campaign` confirmed in writing, images enabled for `bemgu-188668`. **Viator — REPLIED ~Jul 29 without approving or rejecting the tier-3 host-own-PID proposal; reply drafted and UNSENT** (see "SESSION Aug 4 2026"). **Provider-thread status in one line: Tiqets CLOSED (27 Jul) · Viator SENT + REPLIED, unresolved · GetYourGuide the only unverified/unstarted thread.** (Corrects any earlier "three unsent provider emails" phrasing — Viator was sent Jul 24 and Tiqets closed Jul 27.)

### PRE-MARKETING TO-DO — provider terms review (logged Jul 28 2026, DEFERRED)

**Status: parked by Udy's decision — deal with this immediately before the marketing
push / live flip, not now.** Research done Jul 28 2026 by reading each provider's
actual partner terms (not summaries). Claude is not a lawyer; these are readings of
contract text, and what binds Bemgu is the version accepted at signup.

**Headline finding: no provider forbids carrying the other two.** All three grant
explicitly non-exclusive licences — GYG clause 13 (NON-EXCLUSIVITY) is explicit;
Viator B-1.1 and A-3.1 grant non-exclusive licences; Tiqets 2.3.1 grants a worldwide
non-exclusive content licence. Multi-marketplace affiliate sites are industry-normal.
The risk is not the three-provider concept — it is three specific clauses about HOW
they are displayed.

**ITEM 1 (highest priority — VERIFY FIRST). Tiqets non-compete, clause 3.5.2.**
The publicly retrievable Tiqets Affiliate Partner T&Cs (**Version 4, 27 Jan 2021**)
state under "3.5 Non-solicitation, non-compete and price comparisons": *"The Partner
agrees to not offer any products or services and/or Suppliers on its websites that are
available as Solution on the Tiqets website for the duration of the Agreement… will in
no event exceed a period of five years following the Effective Date."* Read literally,
Viator/GYG inventory overlapping Tiqets' museum/attraction/tour catalogue could breach
this.
**DATA GAP — UNRESOLVED:** the CURRENT version is dated **January 25 2024** and sits
behind the Tiqets partner portal; the public URL
(partners.tiqets.com/en_us/term-conditions-affiliate-and-ticket-agent-HkLKZfYKC)
returns 404 to an unauthenticated fetch. **The 2021 wording may have changed or been
dropped — this is UNVERIFIED and must NOT be treated as fact.**
**Action when this item is picked up:** (a) log into the Tiqets partner portal, open
the accepted terms, search "non-compete" / "not offer any products"; (b) if the clause
survives, email Tiqets asking directly whether displaying other marketplaces' affiliate
links alongside Tiqets is acceptable.
**Contra-indications (reasons it likely is not fatal):** recital (B) scopes the whole
agreement to *generating traffic to Tiqets' website* and expressly does NOT extend to
the Partner's own ticket-sale activities — suggesting the clause targets the Partner
reselling supplier tickets directly, not carrying a competitor's affiliate links; the
Tiqets affiliate landing page lists "hotels, travel companies" among welcome partner
types; and Tiqets knowingly configured per-campaign tracking for a multi-property host
platform across three support threads.

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

**COMMERCIAL CONTEXT (no legal effect).** Tiqets was **acquired by Expedia Group in
December 2025**; Viator is TripAdvisor. Two of the three marketplaces are now owned by
direct competitors. No obstacle for an affiliate, but it means terms on both sides may
be revised under new ownership — which makes ITEM 1's verification more worth doing,
not less.

**SOURCES READ (Jul 28 2026):** Viator Partner Program General Terms + Agent Service
Terms [A] + Affiliate Service Terms [B]
(partners.vtrcdn.com/static/docs/Viator-Partner-Program-Terms-en_EN.pdf); GetYourGuide
Partner Terms and Conditions, version Aug 2 2024
(getyourguide.com/c/partner-terms-and-conditions/); Tiqets Affiliate Partner Terms and
Conditions **Version 4, 27 Jan 2021** (S3 tiqets-cdn PDF) — **current Jan 2024 version
NOT retrievable, see ITEM 1 data gap.**

### DECISION — tier ladder confirmed as-is (Jul 26 2026)
After explicit review, the ladder stays: **Tier 3 (Portfolio) capped at 12 properties; unlimited remains Tier 4's second leg** (alongside the future booking platform). Rationale: keeps T4 sellable BEFORE Phase F ships, and protects pricing power over large property managers; caps can always be **relaxed later, never tightened**. **Marketing MUST always say "up to 12" for Portfolio — NEVER "unlimited".**

## On the horizon / next steps

### OPEN ITEMS — PRIORITY CHANGES (Aug 4 2026)

- **~~NEXT ACTION — PILOT STEP 1 CHECKS (no code)~~ — DONE (Aug 6 2026). Steps 1-5 of the pilot are
  all COMPLETE and live.** ~~NEXT ACTION: (1) SMOKE-TEST B3.5; (2) `cron-refresh-events`
  concurrency 2 → 1.~~ **BOTH DONE Aug 7 2026** — B3.5 smoke PASSED, and the cron fix shipped
  as `d254df9`. **NEXT ACTION is now Step 6 (guest-chat router + host-picks)**, whose acceptance
  test is the 20-question benchmark under "PILOT STEP 2". See "SESSION Aug 7 2026" and
  "ZERO-GOOGLE AI PILOT — APPROVED PLAN", still canonical for this workstream.
- **~~NEW, TOP OF PRE-LIVE — enable billing on ALL FIVE Gemini projects~~ — SUPERSEDED Aug 5 2026
  by the ZERO-GOOGLE AI PILOT.** The Bemgu billing account is now CLOSED with zero linked
  projects; **there is no billing flip**. The two grounds recorded below still explain WHY Google
  free tier cannot be the launch basis — which the pilot resolves by REMOVING Google from the
  stack, not by paying for it: the **contractual** EEA/CH/UK paid-only restriction, and the
  **grounding processor-DPA** cover that exists only on paid quota. See "SESSION Aug 4 2026".
- **MUST PRECEDE BILLING — the pre-billing SECURITY REVIEW. THE IN-CODE HALF IS NOW COMPLETE
  (Aug 5 2026) — see "SPEND-ABUSE HARDENING — COMPLETE, CANONICAL SUMMARY" for the whole
  picture; that section is the single source of truth and this entry defers to it.** Moving from
  no-card to billed keys converts a leaked key from a **quota nuisance into unbounded spend**,
  and **this repo is PUBLIC**. Every expensive (grounded) Gemini surface and both pass-minting
  doors are now capped cross-instance, with rolling + cross-host detection live. **~~REMAINING and
  still blocking the flip: per-project budget caps on the four remaining Gemini projects, API key
  restrictions, key rotation after the flip~~ — MOOT under the ZERO-GOOGLE AI PILOT: the billing
  account is CLOSED, so there are no Google keys to cap, restrict or rotate.** Those steps return
  only if a surface graduates back to Google, and the pilot already specifies a fresh enforcement
  cap sized by the 2x ceiling rule at that point. Still open but NOT blocking: `demo-create` has
  no cooldown (Turnstile + one-demo-per-account gated). The log/bundle half is satisfied by the
  shared `scrubErr` helper (`3c56c95`) plus the clean 279-commit history scan.
- **RETENTION CRONS move onto the CRITICAL PATH** — they must ship **before any legal document
  is published** (see the SEQUENCING TRAP in the legal workstream).
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
- **~~Re-test grounding on Gemini 3 once billing is live~~ — SUPERSEDED by the ZERO-GOOGLE AI
  PILOT.** Billing is closed, so there is nothing to re-test. The pilot **dissolves the 16 Oct
  `gemini-2.5-flash` shutdown pressure by a different route**: grounded surfaces move to
  Tavily/POI + a cheap LLM, so no surface depends on Google grounding at all. Revisit only if a
  surface graduates back.
- **THE MONTHLY GUIDE CRON HAS NEVER RUN, AND IS NOW STRUCTURALLY UNABLE TO.** No guide's
  `generated_at` matches the 10:00 UTC 1st-of-month schedule. It loops apartments
  **sequentially**, and a guide call now costs **up to ~99s each** — roughly **one apartment per
  invocation**. **Batching + staggering is the strongest candidate for the next piece of guide
  work.** Staggering needs **no new column** — the rule is "refresh guides older than N days",
  because `generated_at` already staggers naturally. Also skip expired hosts, and log outcomes.
- A `demo-create` cooldown was NOT built (secondary surface: Turnstile + one-demo gated).
  Fail-closed reconsideration remains a recorded non-blocking option.
- **OPEN 1 — LRU ROTATION CAN STALL (`cron-refresh-events`, from `d254df9`).** `generated_at`
  advances **only on a successful WRITE**, so **neither a B3.1 skip nor a failure advances it** —
  and an apartment that consistently fails or extracts nothing **pins the head of the queue and
  spends 4 Tavily credits every day** while pushing the tail back. Ordering alone cannot fix it:
  it needs a persisted **"last ATTEMPTED"** timestamp = a schema change = chat-side.
  **FOLDED INTO the city-level events cache work**, which rebuilds this table and cron anyway —
  **do not build it separately.**
- **OPEN 2 — `cron-sync-ical` has the SAME FAILURE SHAPE just fixed in `d254df9`.**
  `MAX_ICAL_URLS` 20 x the 10s `safeFetchIcal` timeout = **up to 200s against `maxDuration` 150**,
  and unlike the events cron **this one is INTERACTIVE** — a host clicks Sync, gets a **504**,
  with the counter unit already spent. **`d254df9` is now the pattern to copy** (start-deadline +
  a deferred bucket + an alarm condition scoped to what was attempted). **Queued after the city
  cache.**
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
  shape of the monthly guide cron that has never run. The failure ntfy covers "ran and failed",
  not "never ran". Also `city-events-host` (9) and `sync-ical` (15) WILL false-positive on a
  legitimate Tier 3/4 multi-property setup sweep (12 properties > 9), firing a high-priority
  "block this host" alert at a paying customer — revisit when a real portfolio host exists.

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


### UX — NEEDS A DESIGN CONVERSATION FIRST (discussion list, NOT the build list — Jul 29 2026)

Three items raised this session. **Do not write a prompt for any of them until discussed.**

1. **WELCOME LINK vs QR CODE placement.** The agreed Phase-a mockup puts the welcome link
   side by side with the QR code. Udy wants to revisit: the two have **completely different
   jobs** — the link is **SENT** to a guest who has just booked, the QR is **PRINTED** and left
   in the flat — and side-by-side placement risks a host sending the wrong one. **NOTE: this
   REOPENS an already-agreed and recorded design decision** (the "Step 1 you send it / Step 2
   you print it" split under WELCOME PAGE Part 2), so that recorded agreement **must not be
   treated as settled** at the start of the Phase-a build.
2. **PROPERTY NAME MISSING from the edit page.** `PropertySetup.tsx` renders a hard-coded
   `<h1>Property setup</h1>`; the property name **is loaded into state but never displayed**.
   With several properties every edit page looks identical, so a host cannot tell which one
   they are editing.
3. **NO SCROLL RESET ON ROUTE CHANGE — global, not local.** Verified: **no `ScrollRestoration`,
   no scroll-to-top handler, no `autoFocus`, no `scrollIntoView` anywhere in `src/`.** React
   Router does not reset scroll position by default, so navigating from a scrolled page lands
   the next page mid-content — e.g. scrolling the dashboard to reach a property card and
   clicking Edit opens the setup page **below its own tab bar**. Surfaced on the property edit
   page, but it affects **EVERY route**.

Build order (reordered S19 cont.): **G → H → I → F → flip Stripe to live (LAST)**.
- G — pre-launch hardening (incl. pentest gate)
- H — UI/UX polish
- I — monetisation iteration
- F — Tier-4 full booking (moved to end)
- Flip Stripe to live — LAST. OPEN: F before or after the flip — decide after G/H/I.

### Anon-read lockdown: guide_recommendations + host_picks (PARKED — do NOT build until asked)

`guide_recommendations.guide_guest_read` and `host_picks.host_picks_guest_read` are `USING(true)` anon-read **AND load-bearing** — `GuestPage` reads both tables directly via the anon client (the Explore tab). Locking them down requires the **reader-migration-first pattern** (move those reads to a service-role endpoint, THEN drop the anon policies), same shape as the guest-disclosure-chain lockdown (S19). A quick policy drop would break the guest Explore tab. Low urgency (data is non-sensitive: host picks + neighbourhood guide), but tracked.

> Moved to docs/history.md — "SECURITY — cross-tenant anon leak FOUND AND CLOSED (Jul 28 2026)".
## WELCOME PAGE — Phase 1 SHIPPED (Jul 28–29 2026); Part 2 NOT BUILT

Public per-apartment page at **`/w/:code`** — the pre-arrival surface the guest can be sent
BEFORE they arrive (the QR is physical and only reachable at the property).

**Decisions locked:** full address shown, host-toggleable via `apartments.welcome_show_address`
(**default true**); **8-char code from a 30-char unambiguous alphabet**; public AI concierge
branded with the **host's** name; **no in-app messaging** — WhatsApp instead, so **no guest
PII is collected**; experiences framed as **host advice, not a storefront**; an expired host
shows brand + one neutral line + WhatsApp only and **never** billing state; **noindex**
(Viator licence).

**Migrations — ALREADY RUN by the operator. DO NOT RE-RUN:** `welcome_page_columns`
(`welcome_code` unique, backfilled + BEFORE INSERT trigger, `welcome_show_address`,
`welcome_note`), `welcome_views_counter` (day-bucketed, service-role write, host SELECT
only, TRUNCATE/TRIGGER/REFERENCES revoked).

**Code:** `82fd0dc` (page + `api/welcome.ts` + `api/welcome-chat.ts`), `5f16b42` / `ff444a0`
(model selection), `aa446d2` (grounding removed), `d79fd9e` (no-live-info prompt bullet).

**PART 2 REMAINING (not built):**
- **Share panel** — rename the QR panel: "**Step 1, you send it**" (welcome link) vs
  "**Step 2, you print it**" (QR), with a stay timeline and an explicit "do not send this
  one" line on the QR card.
- **AI-drafted, editable welcome note.**
- **Three copy-ready message variants** (Airbnb / WhatsApp / email) with 2–3 language options.
- **View-count display.**
- **Point `GuestPage`'s dead neutral state at the welcome renderer.**

## AI MODELS AND QUOTA — MEASURED (Jul 29 2026), not assumed

- **`gemini-2.5-flash` shuts down 16 Oct 2026** and is **ALREADY refused to new Google Cloud
  projects** (404 "no longer available to new users"). Existing projects are grandfathered —
  which is the only reason this app still works on it.
- **Free-tier limits observed on a NEW project:** 2.5-flash **5 RPM / 20 RPD**;
  3.1-flash-lite **15 RPM / 500 RPD**; **3.5-flash NOT AVAILABLE on free tier (429)**.
- **Google Search grounding: 1,500 RPD free on the 2.5 line, but ZERO on Gemini 3.** Proven:
  same key and model returns 200 without a `tools` array and 429 with one.
- **`welcome-chat` runs `gemini-3.1-flash-lite` on `GEMINI_API_KEY_PUBLIC`** (separate
  project, no card) with **NO grounding**.
- **The other EIGHT call sites still run `gemini-2.5-flash`:** `_lib/greeting`,
  `_lib/city-events`, `_lib/guide`, `_lib/host-picks`, `bulk-import`, `guest-chat`,
  `guide-assistant`, `rewrite-rules`. **Migrating them is a PRE-LAUNCH task** (hard deadline
  16 Oct 2026).
- **`guest-chat` and `city-events` depend on grounding, which is paid-only on Gemini 3.**
  **That is the real AI cost driver to size before marketing.**

### QUOTA IS PER GOOGLE CLOUD PROJECT, NOT PER ACCOUNT (Jul 29 2026)

Bemgu splits AI across **five keys in separate projects**, so each carries its **own daily
allowance** instead of sharing one pool:

| Key | Surfaces | Note |
|---|---|---|
| `GEMINI_API_KEY` | `_lib/greeting`, `_lib/host-picks`, `bulk-import`, `rewrite-rules`, `guide-assistant` | **the only ones that compete with each other** |
| `GEMINI_API_KEY_GUIDES` | `_lib/guide` | own project |
| `GEMINI_API_KEY_CHAT` | `guest-chat` | **GROUNDED** |
| `GEMINI_API_KEY_EVENTS` | `_lib/city-events` | **GROUNDED** |
| `GEMINI_API_KEY_PUBLIC` | `welcome-chat` | `gemini-3.1-flash-lite`, no grounding |

**CONSEQUENCE: the effective ceiling is well above 20 calls/day, so QUOTA IS NOT CURRENTLY
THE BINDING CONSTRAINT.** Do not plan around the 20 RPD figure as if it were global. **The
real deadline is the 16 Oct 2026 model shutdown.**

> **ANNOTATION (Aug 4 2026, SUPERSEDED Aug 5 2026).** The Aug 4 position was that the free tier
> is not an option independently of quota — Google's terms permit **only Paid Services** for API
> Clients made available to EEA/CH/UK users, and grounding's processor-DPA cover also requires
> paid quota — so billing would be added to each of the five projects. **The ZERO-GOOGLE AI PILOT
> (Aug 5, canonical) replaces that: billing is CLOSED, the five projects are back on no-card free
> tier as an accepted bridge, and the surfaces migrate OFF Google instead.** ~~Re-test grounding
> on Gemini 3 once billing is live~~ — moot; the pilot dissolves the 16 Oct migration tension
> below by a different route, since the grounded surfaces move to Tavily/POI + a cheap LLM and no
> surface depends on Google grounding. See "SESSION Aug 4 2026" for the terms reasoning.

### MODEL-MIGRATION ANALYSIS — do NOT big-bang this (Jul 29 2026)

**The 500 RPD free allowance belongs specifically to Flash-LITE. Gemini 3 Flash is 5 RPM /
20 RPD — identical to `gemini-2.5-flash`.** So the 25× quota gain comes from choosing a
**SMALLER model, not a newer generation**. It is a **capability trade, not a free upgrade**,
and that is why the migration splits three ways:

- **CANNOT MOVE** (grounded, and grounding is zero-quota on Gemini 3): **`guest-chat`,
  `_lib/city-events`**. ~~Stuck on `gemini-2.5-flash` until billing is enabled or 16 Oct forces
  the issue.~~ **RESOLVED DIFFERENTLY (Aug 5 2026): the ZERO-GOOGLE AI PILOT moves both to
  Tavily/POI + a cheap LLM, so neither needs Google grounding and neither is stuck.** The 16 Oct
  deadline stops binding once they migrate.
- **SAFE TO MOVE** (simple, text-in/text-out, no strict structure, no deep world knowledge):
  **`_lib/greeting`, `rewrite-rules`, `guide-assistant`**.
- **TEST BEFORE MOVING** (knowledge-heavy and/or strict JSON — where a lite model is most
  likely to degrade): **`_lib/guide`** (must recall 30 real businesses with real addresses,
  and **guide accuracy is already the known weak spot** — see the fabricated-business note
  below), **`_lib/host-picks`** (must identify real places from partial names a host typed),
  **`bulk-import`** (simple classification, so probably fine).

**RECOMMENDED ORDER:** (1) **fix the guide's grounding first** — it is a real defect and the
pattern is already proven in-house (see the CITY GUIDE section below); (2) move the three
safe endpoints and verify; (3) **compare real output side by side** for `guide` and
`host-picks` on Flash-Lite **before** committing to the switch; (4) then decide the
grounding-cost question for the two stuck endpoints.

**NOTE THE TENSION:** grounding the guide ties it to the 2.5 line, which is the line being
retired. Steps (1) and (3) pull in opposite directions for that one endpoint — resolve it
deliberately rather than by accident.

> Moved to docs/history.md — "SESSION Aug 4 2026 — Gemini terms verified at source; the 30 Jul session recorded".
> Moved to docs/history.md — "SESSION Aug 4 2026 (2) — pre-billing security: scrubErr + atomic per-host guide cooldown SHIPPED".
> Moved to docs/history.md — "SESSION Aug 7 2026 — B3.5 smoke PASSED, cron concurrency fixed, CLAUDE.md split". Superseded by the full-day record below.
> Moved to docs/history.md — "SESSION CLOSE — Aug 6 2026: pilot Steps 4 and 5 shipped, city-cache scoped, B3.5 shipped".
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
> apartments refreshed daily**; **Groq free = 1,000 req/day and 6K TPM ORG-WIDE** across all eight
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
- **VENDOR RISK ON GROQ — recorded, not acted on (Aug 6 2026):** NVIDIA acquired Groq's **founder,
  president and ~90% of engineering in Dec 2025**, and standalone GroqCloud's long-term trajectory
  is described as uncertain. `ai-provider.ts` makes switching an env flip, which is exactly why that
  abstraction was built — **but a SECOND provider actually implemented behind that interface is
  worth having eventually**, since today the interface has one real branch plus a dormant Gemini one.
- **xAI (Grok) — PRICED AND DEFERRED (Aug 6 2026). NOTE IT IS A DIFFERENT COMPANY FROM Groq despite
  the near-identical name** — do not conflate them in any future note. Grok 4 Fast **$0.20/$0.50
  per 1M tokens** plus **$5-10 per 1,000 web searches** (**sources DISAGREE on the tool rate —
  VERIFY IN CONSOLE before relying on it**). Events-only estimate: **~$0.025-0.045/run**;
  **~$0.75-1.35/month today**, **~$34-61/month at 50 hosts** per-apartment, or **~$15-27 with
  city-level caching** (see the city-cache design below — it changes the vendor maths for every
  vendor, including the free one). **Blocked on the card requirement, and its EEA terms/DPA are
  UNCHECKED.**

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

**WORK PLAN.** Every code step: single-block prompt, code-reviewer + security-auditor blocking,
HEAD == Vercel READY verified after.
- **Step 0** — this docs commit.
- **Step 1 — DONE.** Checks, no code: Groq terms/DPA (ZDR confirmed); Tavily DPA (**none
  self-serve** — hence the no-personal-data-in-queries rule); LocationIQ; Geoapify. Findings live in
  `docs/providers/README.md`, the manifest to read before relying on any provider-terms claim.
- **Step 2 — CLOSED, APPROVED BY UDY (Aug 6 2026).** Quality benchmark on Sweet home. Evidence
  and the three binding design rules it produced are in "PILOT STEP 2 — BENCHMARK CLOSED" below.
- **Step 3 — SHIPPED + SMOKE-VERIFIED + LOG-VERIFIED (Aug 6 2026, `b90a648`).** `ai-provider.ts`
  + greeting / rewrite-rules / bulk-import / guide-assistant on Groq. Details in "PILOT STEP 3 —
  SHIPPED" below.
- **Step 4 — SHIPPED (Aug 6 2026).** Guide on Geoapify POI data + Groq prose, blurb migrated with
  it (plus B2.1, tiered Sight). Details in "PILOT STEP 4 — SHIPPED" below.
- **Step 5 — SHIPPED (Aug 6 2026), then FIVE correctness/quality rounds B3.1-B3.5.** City events on
  Tavily search + Groq extraction. Details in "PILOT STEP 5 — SHIPPED" below plus the B3.1-B3.5
  subsections (moved to docs/pilot-history.md). **FULLY SMOKE-VERIFIED: B3.4 on Aug 6, B3.5 on
  Aug 7 (PASSED). Step 5 is closed — B3.5 stands as the last events round.**
- **Step 6 — NEXT, and now unblocked** (the B3.5 smoke and the cron concurrency fix are both
  done, `d254df9`) — guest-chat router +
  host-picks. Acceptance test = the 20-question benchmark set recorded under "PILOT STEP 2".
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

**SIDE EFFECT OF THE NO-CARD INTERIM — stated plainly.** Per the Aug 4 terms finding, the Gemini
free tier is **not** the compliant EEA basis. That is **accepted as a pre-launch BRIDGE state,
and this plan removes it entirely.**

~~Rollback is `AI_PROVIDER_EVENTS=gemini` + redeploy.~~ **DECISION Aug 6 2026 (Udy, explicit): NO
ROLLBACK TO GEMINI ON EVENTS, UNDER ANY CIRCUMSTANCES.** The `gemini` branch stays in the code as
history and as the abstraction's second arm, **not** as an operational lever. Two reasons it would
be the wrong move anyway: it is contractually non-compliant for EEA users on the free tier (Aug 4
finding), and — per B3.4 — **it would silently disable BOTH new validators**, since the window check
and the aggregator-url check live only on the Tavily path.

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
  Groq free tier is 6K TPM ORG-WIDE ≈ 2-3 chat calls/minute at the current footprint** — the
  prompt size, not the request count, is what would throttle chat first.
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
**Step 8** delete the `GEMINI_*` vars. See "SESSION CLOSE Aug 6 2026" for what must happen before
Step 6 starts.

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

FOUNDATION: `api_call_counters` table + `bump_api_counter(p_host_id, p_endpoint)` RPC
(SECURITY DEFINER, service-role only, RLS on, all grants revoked from public/anon/authenticated).
Cross-instance atomic per-host/endpoint/UTC-hour counter — the real cap (per-instance Map
limiters are porous on Vercel and do NOT count). Alarms via `_lib/ntfy.ts` sendNtfy (private
topic, ASCII-only, env-var NAME + public project ID only, never a key value).

BRAKES (per host per UTC hour):
- create-booking 30/h, FAIL-OPEN, blocked mints nothing. Caller-keyed (userId). Amplifier
  (mints passes; spends no Gemini itself). (f0a1cb8)
- sync-ical 5 syncs/h + MAX_ICAL_EVENTS=100/sync + MAX_ICAL_URLS=20, FAIL-OPEN, over-cap mints
  NOTHING; dropped/failed/over-cap feeds all treated as "incomplete" so soft-cancel never
  wrongly cancels live bookings. Caller-keyed. Dominant amplifier. (6b33d40)
- generate-guide: real gate is the atomic 1-per-6h claim (guide_claimed_at); counter is
  alarm-only at 10/h. Caller-keyed. Key GEMINI_API_KEY_GUIDES. (5423285)
- daily-greeting 50/h, FAIL-CLOSED, degrades to {suggestion:null}. VICTIM-keyed (apt.host_id).
  Shared GEMINI_API_KEY. (f8952b0)
- guest-chat 40/h, FAIL-CLOSED, 429 -> soft ChatBot copy. VICTIM-keyed. Dearest (grounded)
  call. Key GEMINI_API_KEY_CHAT. (6f915b5)
- city-events public 'city-events-public' 7/h, FAIL-CLOSED. VICTIM-keyed (unauthenticated;
  caller needs only the apartment UUID). Key GEMINI_API_KEY_EVENTS. (66cb385 -> split bcf9396)
- refresh-events host 'city-events-host' 3/h, FAIL-CLOSED. Caller-keyed (ownership check
  precedes bump). Key GEMINI_API_KEY_EVENTS. (66cb385 -> split bcf9396)
RULE: never share one counter key across a trust boundary (public flood must not eat the
host's own reserve).

FAIL-OPEN vs FAIL-CLOSED (do NOT "harmonise"): fail-open where blocking costs a host real work
(create-booking, sync-ical); fail-closed where the blocked behaviour is the free fallback
(greeting/chat/events). Fail-open is indefensible when the fallback is free.

DETECTION (cron-spend-audit, `0 */3 * * *`):
- Rolling: sums each host's last-6h usage per endpoint, alarms ~3x the hourly limit
  (guest-chat 120, daily-greeting 150, create-booking 90, sync-ical 15, generate-guide 30,
  city-events-public 21, city-events-host 9). (3b1a128)
- Cross-host (Sybil): sums ALL hosts per endpoint, alarms at GLOBAL_HOST_EQUIVALENT(5) x the
  per-host rolling threshold; logs top contributors. Turns the "N accounts" leak from
  unbounded-in-N into a fixed constant. GLOBAL_HOST_EQUIVALENT is a SUM (not "5 hosts") ->
  false-positives around ~50-150 active hosts; raise from the per-run fleet-totals log. (196f073)
- Retention: prunes counter rows >48h every run (also GDPR minimisation). Prune's `.lt()`
  filter is load-bearing (without it -> full table wipe that resets every current-hour counter).
  Paginated scan (unbounded PostgREST select truncates silently -> would under-count). (3b1a128)

VICTIM-vs-CALLER (operator safety, fa8fa32): victim-keyed alarms (guest-chat, daily-greeting,
city-events-public) say "INVESTIGATE, do not auto-block" (named host may be the victim: leaked
booking token, or public UUID) -> revoke booking token / rotate QR / block source per findings.
Caller-keyed alarms (create-booking, sync-ical, generate-guide, refresh-events) correctly say
"block this host". NEVER blanket-rewrite the caller-keyed ones. Classify by the ownership check
that precedes the bump, not the variable name (refresh-events passes apt.host_id but is
caller-keyed).

KEY MAP (env var -> project; alarms name these, never a key value):
- GEMINI_API_KEY_CHAT   = gen-lang-client-0221179352 (guest-chat only; CONFIRMED)
- GEMINI_API_KEY_EVENTS = gen-lang-client-0131909896 (city-events + refresh-events; CONFIRMED)
- GEMINI_API_KEY_GUIDES = gen-lang-client-0816353550 (guide)
- GEMINI_API_KEY shared = gen-lang-client-0819525902 (daily-greeting + host-picks + rewrite +
  bulk-import -> disabling is blunt)

2x CEILING RULE: a counter unit != a Google call. Automatic retry (and empty-reply
fall-through) means real billed calls ~= 2x the limit; AbortSignal does NOT reduce Google
billing (SDK: client-only). Size Google per-project spend caps at ~2x the limits.

CLIENT FIX: GuestPage daily-greeting fired twice/load (weather-keyed effect) -> fire-once ref
+ 2.5s weather grace (6382174). Lowers real usage, not the ceiling.

DELIVERABLE (outside repo): plain-English risk & response guide for Udy —
Bemgu-AI-spend-risk-and-response-guide.md/.docx (incident cheat-sheet + full measures record).

PRE-BILLING CHECKLIST — **SUPERSEDED Aug 5 2026 by the ZERO-GOOGLE AI PILOT plan above — kept
for history.** (There is no billing flip; surfaces graduate individually instead.)
1. Set a per-project spend cap on Google Cloud for each of the 4 projects above at ~2x the
   in-app limits — the only non-code net for the bounded multi-account residual.
2. Optional polish (none blocking): meter cheap non-grounded host endpoints (host-picks,
   bulk-import, rewrite-rules); add an api/ typecheck to the build; the 3 city-events alert
   refinements (over-asserted innocence, revoke-token vs rotate-QR, log the tripping IP); a
   cron "never ran" heartbeat; raise city-events-host reserve (3/h) before multi-property
   hosts; welcome-chat/guide-assistant abort tidy-ups.
3. Flip GEMINI_API_KEY_CHAT to a billed key once the Google payment issue is resolved.

RESIDUAL (accepted, not holes): bounded (not zero) spend possible for a determined
multi-account attacker -> covered by the Google cap. One remaining blind spot: a single host
at ~49% on all endpoints at once (cross-endpoint, lower value).

COMMIT TRAIL: DB counter migration -> 5423285 -> f0a1cb8 -> 6b33d40 -> f8952b0 -> 6f915b5 ->
66cb385 -> bcf9396 -> 6382174 -> 6259e9e -> 3b1a128 -> 196f073 -> fa8fa32.

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
- **~~RAISED — `generate-guide.ts` has NO server-side cooldown~~ — RESOLVED (`6fd015c`,
  Aug 4 2026).** `GUIDE_FRESH_HOURS = 24` in `PropertySetup.tsx` was UI-only, so an
  authenticated host could loop the endpoint and spend **Bemgu's** quota. Now gated by an
  **atomic per-host 6h claim on `hosts.guide_claimed_at`**, taken before generation and proven
  live (calls 2–6 of a loop returned instant `429 cooldown`, no Gemini call, €0). Details in
  "SESSION Aug 4 2026 (2)".
- **NEW, minor: `coercePlaces` does not enforce the 5-per-category cap the prompt requests.**
  Harmless today — the post-retry total still cannot exceed `MAX_GEOCODE`.
- **`subscription_status` is DECOUPLED from the access gate.** `PrivateRoute` uses
  `needsPlan = !is_exempt && !is_demo && !stripe_subscription_id`. **Setting a host to
  'active' in the superadmin panel grants no access.** The operator set `is_exempt = true` on
  host `1d5a3b9c` (udy@tlv.capital) to work around this. **Either reconcile the two or make
  the admin panel warn.**
- **~~Enable GitHub secret scanning + push protection~~ — VERIFIED ALREADY ENABLED (Jul 29 2026).
  No action was needed.** A full
  history scan of **all 279 commits found ZERO secrets**, no `.env` ever committed, no
  client-side AI provider calls, and no secret-named `VITE_` vars — **the Anna's Stays failure
  modes are all absent.** Push protection makes that mechanical rather than dependent on
  discipline.
- **ALL DATABASE CONTENT IS TEST DATA created by the operator. There are no real users.**
  Decide before the Stripe flip whether to wipe or flag it — **this interacts with the
  retention gaps in the legal workstream below.**

## PRE-LIVE LEGAL & COMPLIANCE WORKSTREAM (opened Jul 28 2026 — BLOCKS LAUNCH)

Promoted out of the Settings cosmetic backlog. Bemgu will take subscription money from
EU hosts and processes personal data about their guests (names, stay dates, chat
messages). The following are mandatory, not polish, and are the only fully UNSTARTED
launch blocker.

**THE STRUCTURAL POINT — the relationships are THREE-WAY, not two (corrected 30 Jul 2026):**
- **Host account data** (name, email, address, billing) → **Bemgu is the CONTROLLER**.
- **Guest data** (names, stay dates, messages) → **the HOST is the CONTROLLER, Bemgu is
  the PROCESSOR**. The host collects it; Bemgu handles it on their behalf.
- **Server logs + the anti-abuse check on the pre-arrival chat** → **Bemgu is the CONTROLLER
  IN ITS OWN RIGHT**, because those are **Bemgu's own security decisions, not the host's
  instructions**. **Claiming processor status for that slice would be wrong.**
This split means TWO privacy documents, not one, and it is why a DPA (GDPR Art. 28) is
required. Products routinely get this wrong by writing a single blurred policy.

**SEQUENCING TRAP — ON THE CRITICAL PATH. The retention crons must ship BEFORE publication
and BEFORE the lawyer review.** The drafts state guest names and messages are erased **30 days
after check-out**. **THE CODE DOES NOT DO THIS:** messages are on **90 days**, and the
guest-name, greeting and push sweeps **do not exist at all**. Publishing first would put a
**FALSE STATEMENT into a privacy notice** — materially worse than having no notice.

**STEP 1 IS DONE (Jul 28–29 2026) — the data inventory exists, as an external `.docx`
(not in this repo).** It covers the Art. 30 record in BOTH roles (controller for hosts,
processor for guests), a table/column inventory with retention, the subprocessor list with
residency, client-side disclosures, transfers, and Art. 32 measures.

**TEN GAPS from that inventory — 2 and 3 CLOSED (`fbf58aa`), EIGHT still open:**
1. **Legal entity details** for the record header (registered name, address, contact).
2. ~~**Vercel function region is NOT pinned**~~ **CLOSED (`fbf58aa`)** — `"regions": ["fra1"]`,
   verified live via `x-vercel-id` ending `::fra1::`. **WORDING DISCIPLINE for the Art. 30
   record: the correct claim is "compute pinned to fra1", NOT "EU-only processing"** — Gemini
   (US), LocationIQ, wttr.in and Stripe all still receive data outside the EU.
3. ~~**ntfy alert payloads unaudited**~~ **CLOSED (`fbf58aa`)** — all 7 call sites audited;
   host names removed from 4, the rest send aggregate counts only.
4. **Retention undecided** for: `guests`, the bookings↔guest link, `daily_greetings`, guest
   `push_subscriptions`, `admin_audit`. **These BLOCK the Art. 17 erasure feature** — the
   delete flow cannot be built correctly until each has a decided retention period.
5. **Gemini terms — VERIFIED AT SOURCE Aug 4 2026, and the answer changed.** The **unpaid-tier
   data-training worry is DEAD**: for EEA/CH/UK developers Google applies the **paid** data
   terms to all Services, so no training on prompts/responses and the processor DPA already
   governs. What replaces it: **(a) the free tier is contractually not permitted at all for
   EEA users** → **ANSWERED Aug 5 2026 by the ZERO-GOOGLE AI PILOT (Google leaves the stack;
   billing account CLOSED), not by enabling billing**; **(b) grounding stores
   prompts, context and output for 30 DAYS** and its debugging/testing use is covered by the
   processor DPA **only on paid quota** — **the 30-day storage must be stated in the guest
   notice**; **(c) an UNRESOLVED question for the lawyer** — the guide caches grounded output
   and shows it to every guest, against a "display only to the submitting end user / do not
   cache" restriction. Full text and citations in "SESSION Aug 4 2026". SCC/DPF transfer basis
   still to be recorded. **WIDENED (`1af1012`): the grounded guide sends the property address
   into GOOGLE SEARCH, not only to the Gemini model** — a broader disclosure than this entry
   originally described. (`guest-chat` and `city-events` were already grounded.)
6. **No privacy-notice link on the guest page.** **BUILD TASK (30 Jul):** link the guest notice
   from **every guest page AND welcome page**, and **inject the host's brand name** so a guest
   can see who the controller is.
7. **`guest_optins` is dormant (0 rows)** — decide keep or drop.
8. **Supabase auth-log and Vercel log retention unverified.**
9. **wttr.in weather is fetched by the GUEST'S BROWSER** — that sends the guest's IP to a
   third party with no DPA. **RECOMMENDED ANSWER (30 Jul), better than disclosure: route the
   call through Bemgu's own server.** The guest's IP then never reaches the third party,
   **deleting a subprocessor and a disclosure instead of documenting them.** Preferred over
   writing the consent paragraph.
10. **LocationIQ corporate seat and DPA.**
4. **NEW OPEN QUESTION — potentially architectural, NOT resolved. Do not attempt to resolve it
   in code or here; flag it for the lawyer alongside the three documents.** The grounding "Use
   Restrictions" state the developer *"will only display the Grounded Results with the
   associated Search Suggestion(s) to the end user who submitted the prompt"*, and will not
   *"cache, frame, syndicate, resell, analyze, train on, or otherwise learn from Grounded
   Results"*. **The city guide CACHES grounded output in `guide_recommendations` and displays it
   to EVERY guest of that property**, not only whoever triggered the refresh. Whether a
   host-initiated refresh makes the **host** the submitting end user is **genuinely unclear**.
   There is a narrow permitted carve-out for storing Grounded Result text (evaluation/
   optimisation, end-user chat history, refinement round-trips) — **whether the guide cache fits
   any of those is exactly the question.**

**Already verified, no action needed:** Supabase Custom SMTP via Resend (done 17 Jul); GitHub
secret scanning + push protection confirmed **already enabled** 29 Jul.

**Agreed order of work (Jul 28):**
1. ~~**Data inventory** (GDPR Art. 30 record of processing) + **subprocessor list**~~ —
   **DONE Jul 28–29 2026** (external .docx; ten gaps above). It was the input to every
   other document, and the part a lawyer would otherwise bill to extract.
2. **Data-flow and residency check** — Supabase `eu-central-1` and Resend `eu-west-1` are
   EU; **Gemini is Google in the US = an international transfer needing explicit
   handling**. Also in scope: Vercel, Stripe, LocationIQ, Cloudflare Turnstile, and the
   three experience marketplaces.
3. Host-facing **privacy policy** + terms of service — **DRAFTED 30 Jul.** NOT published, NOT in force.
4. Guest-facing **privacy notice** — **DRAFTED 30 Jul.** NOT published, NOT in force.
5. **Data processing agreement** (host = controller, Bemgu = processor) — **DRAFTED 30 Jul.** NOT published, NOT in force.
   **ALL FOUR DOCUMENTS ARE NOW COMMITTED (Aug 4 2026), verbatim, under `docs/`:**
   `legal-host-privacy-policy-DRAFT.md`, `legal-guest-privacy-notice-DRAFT.md`,
   `legal-dpa-DRAFT.md`, plus the Art. 30 data inventory as both
   `legal-data-inventory-2026-07-28.md` (readable/diffable) and
   `legal-data-inventory-2026-07-28.docx` (the format counsel will want).
   All remain **DRAFT, NOT published, NOT in force**, pending the **retention crons shipping**
   (SEQUENCING TRAP above) and **Finnish lawyer review**. Every `[CONFIRM]` / `[BUILD]` marker
   is intact and IS the outstanding to-do list — **never resolve, tidy, renumber or remove one.**
   **Three `[CONFIRM]` markers are now answerable from the 4 Aug Gemini terms verification**
   (host policy open item 6; the host policy §7 transfer-mechanism marker citing "Google's terms
   for unpaid API tiers"; and the guest notice §4 chat paragraph, which does not yet mention the
   30-day grounding storage) — ~~queued for a post-billing editing pass~~ **REFRAMED Aug 5 2026:
   under the ZERO-GOOGLE AI PILOT these answers depend on the FINAL PROVIDER SET, not on Google
   billing. Resolve them once the pilot's provider checks (Step 1) land, since the transfer
   mechanism and the chat/grounding storage paragraphs will name Groq/Tavily/Geoapify rather than
   Google.**
6. **Delete account & data** feature (Art. 17 right to erasure) — **still unbuilt**; build LAST,
   because it needs the retention decisions from step 1 to be correct.

**Steps 1–2 Claude can do properly from the codebase. Steps 3–5 Claude can draft, but a
Finnish lawyer must review before publication — handing over a completed inventory cuts
that review to a fraction of its cost. Claude is not a lawyer; nothing here is legal
advice.**

## PRE-ARRIVAL GUEST REACHABILITY — DESIGN SESSION SCOPED (Jul 28 2026; do NOT build yet)

**The problem.** The guest page is binary today: active during the stay, neutral
otherwise. A guest who opens the link before arrival gets the neutral page, and a host
message sent pre-arrival is never seen.

**The reframe:** this is not one feature, it is a THIRD PAGE STATE — "upcoming" — with
its own content rules. It cannot be a simple date-condition change, because check-in
secrets (door code, entry instructions) are deliberately gated, and "previous guest
protection" exists to stop a departed guest seeing the next booking. Opening the page
early without a content model would leak door codes weeks ahead.

**Five questions the design session must answer, in order:**
1. **What shows in the upcoming state?** Starting proposal: everything EXCEPT check-in
   secrets — greeting, dates, getting-here directions, city guide, host picks,
   experiences, house rules, message-the-host. Withheld: door code, entry instructions.
2. **When do the secrets unlock?** Fixed rule (e.g. 24h before check-in) vs a host
   setting. Hosts differ genuinely here, which argues for a setting — but that is more
   surface to build and to get wrong.
3. **How does the link reach the guest?** The QR is physical and AT the property, so
   pre-arrival access depends entirely on the host sending a link. A prominent "copy
   guest link" affordance in Bookings is therefore a hard dependency, not a nicety.
4. **AI spend and the security gates — handle with care.** `guest-chat` is verify-gated
   on an **in-dates** token (Phase G security work); pre-arrival access requires changing
   that gate. The daily greeting is built around stay-days that do not exist pre-arrival.
   Neither is a quick condition flip.
5. **Cache targeting.** `cron-refresh-experiences` is booking-targeted on ACTIVE stays;
   pre-arrival guests would hit cold cache unless upcoming bookings are included.

**Why it is worth doing.** (a) A guest can only subscribe to push AFTER opening the page
— so pre-arrival access is the PRECONDITION for pre-arrival messaging working at all.
(b) Commercially: someone planning two weeks out is far likelier to book a tour than
someone who has just dropped their bags. The Phase I affiliate revenue is currently
switched OFF during the window with the highest booking intent.
