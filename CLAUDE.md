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
> **Current HEAD (code) — `6fd015c`.** This session (Aug 4 2026, session 2):
> `3c56c95` (shared `scrubErr` helper) → `6fd015c` (atomic per-host `generate-guide` cooldown).
> Both live and SHA-verified against Vercel production. See "SESSION Aug 4 2026 (2)".
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
- **hosts** — id (= auth.uid), name, brand_name, whatsapp, logo_url, accent_color, contact_email, country, city, neighborhood, street, street_number, lat, lng, plan, trial_ends_at, subscription_status, stripe_customer_id, stripe_subscription_id, current_period_end (timestamptz, server-only — webhook/service-role writes only), push_endpoint, welcome_email_sent_at, trial_reminder_sent_at, tier (int, FK plans.tier), is_exempt (bool, default false), price_override_cents (int nullable), discount_percent (int nullable), discount_until (timestamptz nullable), property_cap_override (int nullable), billing_notice (jsonb nullable — server-only write, SELECT readable by authenticated; shape: `{ type, from_tier, to_tier, at }`), pending_tier (smallint nullable — server-only write, SELECT readable by authenticated; set by change-plan on deferred switch, cleared by webhook on tier apply or expiry), cancel_at_period_end (bool default false — server-only write, SELECT readable by authenticated; set by cancel-subscription), last_billing_notice_sig (text not null default '' — server-only write; dedup key for webhook fan-out; shape: `${tier}|${status}|${currentPeriodEnd ?? 'null'}`), welcome_seen_at (timestamptz nullable, CLIENT-writable — one-time dashboard welcome modal; backfilled S16 so only new signups see it), ui_state (jsonb NOT NULL default `'{}'`, CLIENT-writable — Host Guide `guideHints` + Earnings `experiencesConnect` application-progress; read-modify-write to preserve sibling keys), viator_partner_id / gyg_partner_id / tiqets_partner_id (text nullable — NON-SECRET public affiliate IDs; NULL = use Bemgu's IDs; **CLIENT-writable per column-level GRANT** added by migration `grant_host_partner_id_column_update`, written from the Earnings→Connect flow, tenant-scoped by `hosts_update_own`), created_at
- **plans** — tier (smallint PK 1-4), label, price_cents, currency, max_properties (int nullable = unlimited), includes_booking (bool), updated_at. RLS ON, single SELECT policy for authenticated; writes are service-role only (via api/admin-plans.ts). Edited from the admin Plan settings panel.
- **apartments** — id, host_id, name, country, city, neighborhood, street, street_number, floor_note, lat, lng, max_guests, description, images[], is_visible, accent_color, ical_urls, hero_image_url, city_image_url, city_image_credit, greeting_blurb (text nullable — Gemini-generated neighbourhood-character paragraph; generated best-effort whenever the guide runs; null → guest page uses a static fallback line), created_at
- **daily_greetings** — id, apartment_id (uuid NOT NULL, FK apartments cascade), booking_id (uuid NOT NULL, FK bookings cascade — added S28), stay_day (int nullable — added S28), local_date (date), day_part (text check morning|afternoon|evening|night), suggestion (text), weather_summary (text nullable), generated_at. **UNIQUE (booking_id, local_date, day_part)** (the old `(apartment_id, local_date, day_part)` unique + the apartment_id/local_date secondary index were dropped S28). **RLS ON with ZERO policies (service-role-only — like `city_events_cache` / `app_settings`; the old `daily_greetings_guest_read` anon + `daily_greetings_host_all` public policies were removed S28).** Cache is now **PER BOOKING** per day-part per day (not shared per-apartment); the endpoint feeds the booking's **last-6 suggestions as a do-not-repeat window** for anti-repeat. apartment_id (NOT NULL) + its FK retained so the existing RLS join shape stayed valid through the migration.
- **apartment_details** — id, apartment_id, category, content, is_private
- **apartment_qr_secrets** — apartment_id (PK, FK→apartments cascade), qr_secret (text, unique, default gen_random_uuid()::text), created_at. RLS ON with **ZERO policies** (service-role-only — never readable by anon/authenticated). The per-apartment secret embedded in the guest QR URL as `?key=` to unlock the tokenless date-lookup in `/api/guest-state`. 11/11 apartments backfilled (S19). New apartments auto-provision a secret via an AFTER-INSERT trigger. Read by hosts only through `api/qr-secrets.ts` (host_id-scoped). Added S19.
- **city_events_cache** — apartment_id (uuid PK, FK→apartments cascade), payload (jsonb — the {week, categories:[{name,events:[{title,venue,date,desc,price,url}]}]} shape), generated_at (timestamptz default now()). RLS ON with ZERO policies (service-role-only — guests never read it directly; reached only via api/city-events.ts). One row per apartment. Lazy-filled on first guest view, refreshed by api/cron-refresh-events.ts for apartments with a current/upcoming booking. generated_at drives the host manual-refresh 20h freshness gate. Added S20 (Phase G).
- **experiences_cache** — id (uuid), apartment_id (uuid, FK→apartments cascade), provider (text — 'viator'|'tiqets'; GYG has no content API so it is NOT cached), experiences (jsonb — normalized `NormalizedExperience[]` incl. `imageCredit`), fetched_at, expires_at. Unique (apartment_id, provider). **RLS ON with ZERO policies (service-role-only)** — reached only via `api/experiences.ts` (cache-first) + refreshed by `api/cron-refresh-experiences.ts` (daily 05:00 UTC). 7-day TTL; **NEVER extend past 14 days** (Tiqets freshness clause — see "Tiqets licence obligations"). Added Stage 4A (Phase I).
- **experience_clicks** — id (uuid), apartment_id (uuid, FK→apartments cascade), provider (text), product_id (text — **UNTRUSTED**, never rendered raw; capped 200 chars), clicked_at (timestamptz). Anonymous click beacon (NO PII/IP/UA). **RLS: `host_reads_own_clicks`** (SELECT, `authenticated`) scoped `apartment_id IN (select id from apartments where host_id = auth.uid())`; inserts are service-role only (via `api/experience-click.ts`). Read client-side by the Earnings panel (aggregate counts only). Added Stage 4A (Phase I).
- **experience_orders** — id (uuid), provider (text CHECK `'tiqets'`), provider_order_id (text), apartment_id (uuid nullable, FK→apartments cascade — null when the campaign tag is absent/foreign), campaign_name (text), commission_excl_vat (numeric), currency (text), product_id (text), status (text default `'fulfilled'`; flips to `'refunded'`), order_fulfilled_at (timestamptz), raw (jsonb — **PII-whitelisted**, only commercial fields), created_at. **UNIQUE(provider, provider_order_id)** for idempotent upserts; index `(apartment_id, order_fulfilled_at desc)`. **RLS ON:** single SELECT policy for hosts over own apartments (mirrors `experience_clicks`); writes service-role only; `authenticated` = SELECT only, `anon` = nothing. Written by `api/cron-refresh-earnings.ts` (Tiqets Reporting API ingest). Added Stage 5 (Phase I), migration `create_experience_orders`.
- **host_picks** — id, apartment_id, name, category, address, lat, lng, note, display_order, created_at
- **bookings** — id, apartment_id, guest_id, check_in, check_out, status, reference_number, source, ical_uid (text nullable — stable feed-match key for reconcile; raw feed UID for feed rows, NULL for manual; partial unique index `bookings_apt_ical_uid_key` on (apartment_id, ical_uid) WHERE ical_uid IS NOT NULL), created_at
- **guests** — id, first_name, last_name, email, created_at. **Creation is SERVER-SIDE only (S24)** via `api/create-booking.ts` (host-auth → service-role); the client no longer reads or inserts `guests`. Each manual booking gets its OWN guest row (no cross-host dedup; the old global first-name dedup is removed). **RLS (S24):** single policy `guests_host_read` (SELECT, `authenticated`) host-scoped via `id IN (select b.guest_id from bookings b join apartments a on a.id=b.apartment_id where a.host_id = auth.uid())`. anon + authenticated INSERT revoked (service-role inserts). Verified live: a host reads only its own bookings' guests, anon reads 0.
- **messages** — id, booking_id, apartment_id, sender_role ('guest'|'host'), body, created_at, read_at; RLS: `messages_host_all` scopes to host's own apartments via apartment_id
- **guide_recommendations** — id, apartment_id, neighborhood, categories (jsonb), generated_at
- **push_subscriptions** — id, host_id, apartment_id, booking_id, role, endpoint, p256dh, auth_key, created_at
- **guest_optins** — id, first_name, email, apartment_id, opted_in_at. **RLS (S24):** `optins_guest_insert` WITH CHECK constrained to `is_visible = true` apartments (no code inserts this today — pure hardening).
- **app_settings** — id (always 1), trial_days (int, default 14), updated_at; RLS ON with zero policies (only service-role + SECURITY DEFINER trigger can read/write); `handle_new_user()` reads `trial_days` with hard fallback to 30 so a missing row never breaks signups. Change trial length: `update public.app_settings set trial_days=N, updated_at=now() where id=1;` (new signups only; existing hosts keep their dates). Future superadmin dashboard edits this row.
- **admin_audit** — id, actor_email, action ('update_host'|'update_plans'|'impersonate_view'|'subscription_event'), target_host_id (uuid nullable), detail (jsonb), created_at. RLS ON with zero policies (service-role only). Written by the admin endpoints and stripe-webhook; read by api/admin-audit.ts (last 50). NOTE: edits made by direct SQL (not via an admin endpoint) are intentionally NOT logged here.

### DB functions
- **`guest_host_card(p_apartment_id uuid)`** — SECURITY DEFINER (`search_path = public, pg_temp`), granted to anon+authenticated (+service_role). Returns setof (brand_name, logo_url, whatsapp, subscription_status, **accent_color**) for visible apartments. Used by GuestPage to read host branding (incl. the account-default colour) without requiring anon SELECT on the hosts table. Added S13; extended with `accent_color` via Migration B (S27 2a, DROP+CREATE preserving SECURITY DEFINER + pinned search_path + grants).
- **`create_apartment_qr_secret()`** — AFTER-INSERT trigger `trg_apartment_qr_secret` on apartments; SECURITY DEFINER, `search_path=public`; auto-provisions an `apartment_qr_secrets` row (random `qr_secret`) for each new apartment. EXECUTE on the function is revoked from public/anon/authenticated. Added S19.
- **`reconcile_ical_bookings(p_apartment_id uuid, p_source text, p_events jsonb) RETURNS jsonb {imported,updated,cancelled}`** — SECURITY DEFINER, `search_path=public,pg_temp`; **service-role-only EXECUTE** (REVOKEd from anon/authenticated/public — Supabase default privileges auto-grant EXECUTE to anon+authenticated on every new public function, so a definer writer MUST revoke). Advisory xact lock per apartment+source. Upserts feed bookings keyed on `(apartment_id, ical_uid)`: INSERT new rows with a fresh `ARR-` token (INSERT-only `new_ref`); **ON CONFLICT updates check_in/check_out/status='confirmed'/source ONLY — NEVER guest_id or reference_number** (so CSV-attached guest names survive every sync). Soft-cancels rows of the `(p_source, p_source||'_block')` family whose uid dropped, **guarded on `cardinality(uids)>0`** (empty-but-successful fetch cancels nothing). Called by `api/_lib/ical.ts` (one call per base source, fully-fetched feeds only). Added Jun 27 2026. **KNOWN GAP (open):** Airbnb iCal exports only current+future events, so past rows age out of the feed and get soft-cancelled — proposed fix is a `check_out >= current_date` guard on the soft-cancel + one-off restore (not yet applied).

### Critical DB facts
- `apartments.accent_color` — NOT brand_color (common mistake, causes silent save failure)
- `apartments.ical_urls` — single text column, one URL per line, no limit (replaces old airbnb_ical_url)
- `bookings.reference_number` — is the guest token, used in QR URL
- `guide_recommendations` — always query with `.maybeSingle()` never `.single()`
- **Landing pricing/trial are DB-driven but anon CANNOT read the tables.** `plans` is `plans_select_authenticated` (authenticated only); `app_settings` has NO read policy (service-role only). The logged-out landing reads `{trialDays, fromPriceEuros}` from `api/public-pricing.ts` (service-role, marketing-safe fields only) — never by loosening RLS.
- **`bookings_guest_read` RLS policy — DROPPED (S19).** Migration `close_guest_disclosure_chain_lockdown` removed the anon read policy on `bookings`; guests no longer read `bookings`/`guests` directly. Booking state is now resolved server-side via `api/guest-state.ts` (service-role). VERIFIED: anon role reads 0 bookings + 0 guests; authenticated host still reads own bookings + guest list. `guests_host_read` was replaced with `USING(true)` scoped to role `authenticated` only (guests still readable by ALL authenticated hosts — see Tracked security follow-ups).
- RLS on `host_picks` joins through `apartments.host_id` — correct, verified
- `push_subscriptions` has a UNIQUE index on `endpoint` (`push_subscriptions_endpoint_key`) — subscriptions upsert with `onConflict: 'endpoint'`
- `push_subscriptions` RLS verified (2026-05-31): single ALL policy `push_host_all`
  `USING (host_id = auth.uid())` with no explicit WITH CHECK — Postgres applies USING
  as WITH CHECK on ALL policies, so client writes are host-scoped.
- **`push_subscriptions.apartment_id` is NULL for host account-level subscriptions.**
  Always call `sendPushToHost(db, hostId, payload)` WITHOUT the optional `apartmentId`
  argument when notifying the host — passing one filters the lookup to zero rows and
  delivers nothing silently.
- **`push_subscriptions.booking_id`** — nullable UUID; set for guest subscriptions (server-derived from resolved booking in `api/guest-subscribe.ts`); NULL for host subscriptions.
- **`hosts` server-only columns** — `hosts` has 14 client-updatable profile columns only; `tier`, `is_exempt`, `price_override_cents`, `discount_percent`, `discount_until`, `property_cap_override`, `subscription_status`, `billing_notice`, `pending_tier`, `cancel_at_period_end`, `current_period_end`, `last_billing_notice_sig` are server-only for WRITE (column-level UPDATE revoked from authenticated+anon; verified via `role_column_grants` in Task 2 for `pending_tier` and `cancel_at_period_end`; `last_billing_notice_sig` UPDATE confirmed granted to `service_role` + `postgres` only, NOT authenticated/anon — F-05 verified safe S24). `billing_notice`, `pending_tier`, `cancel_at_period_end`, and `current_period_end` ARE SELECT-readable by authenticated (needed for BillingPanel). Never write server-only columns from the client — only via admin endpoints, `change-plan.ts`, `cancel-subscription.ts`, or the stripe-webhook (service-role).
- **`config.ts` no longer holds any pricing/plan fields** — the legacy `trialDays`, `pricePerPropertyMonthly` (removed S19) and `maxPropertiesByPlan` (removed S23) are gone. Pricing/plan data is DB-driven (`plans` table + `app_settings.trial_days`); never reintroduce hardcoded tier prices into `config.ts`. Live `config.ts` keys: `currencySymbol`, `colourPresets`, `adminEmail`, `appUrl`, `poweredByText`.
- **`apartments` property cap is enforced by a DB trigger**, not just UI: `enforce_property_cap()` BEFORE INSERT on apartments (migration `enforce_property_cap_trigger`, S18). Effective cap = is_exempt ? unlimited : (property_cap_override ?? plans.max_properties); NULL = unlimited. Raises `property_cap_reached` (SQLSTATE P0001) when a non-exempt host inserts over cap. Locks the host row to serialize concurrent inserts. NEVER blocks or rewrites existing over-cap rows (only new INSERTs). NOTE: this also guards SQL/MCP seeding — adding apartments to a non-exempt at-cap host via SQL is rejected too (exempt hosts unaffected).
- **Apartment creation is deferred (S18):** the apartments row is INSERTed only on the first successful Basic-info save in PropertySetup (route `/dashboard/property/new`), not when "Add property" is clicked. Required-to-save fields: name, country, city, neighbourhood, street, street_number, max_guests (≥1); floor note + cover photo optional. Non-Basic tabs are locked (toast) until first save. Clicking Add then leaving creates nothing and consumes no cap slot.
- **`city_events_cache` is service-role-only (RLS ON, ZERO policies)** — hosts CANNOT read it, including its `generated_at` timestamp. The property editor's "Guide & events" tab therefore derives events freshness from the **`/api/refresh-events` JSON response** (`refreshed` / `reason` / `generated_at`), NEVER a direct cache SELECT. (The city-guide row, by contrast, reads `guide_recommendations.generated_at` directly — that table IS host-readable.)
- **`apartments.accent_color` is NULLABLE (S27 2a, Migration A):** the old NOT NULL + default were dropped. NULL = inherit `hosts.accent_color` (account default); non-null = per-property override. The "Look" tab writes a validated hex on override and `NULL` on "reset to brand default", scoped `.eq('id', aptId).eq('host_id', hostId)`. Backfill state after Migration A: 7 inheriting (NULL) / 4 explicit overrides / 11 total.
- **Both billing surfaces (`BillingPanel` + `ChoosePlan`) render plan price + property cap DYNAMICALLY from the `plans` table** (admin-editable via `api/admin-plans.ts`): price from `plans.price_cents / 100`, capacity from `plans.max_properties`. Plan name / tagline / bullets / "Most popular" come from `src/lib/tierCopy.ts` (static presentation copy, NO numbers). **REINFORCE the `plans.price_cents` lesson: it is DISPLAY-ONLY** — the cards show it but Stripe charges from the `STRIPE_PRICE_TIER_n` env (immutable Stripe Prices). Editing the admin price changes the displayed number on BOTH card surfaces but NOT the actual charge; a real price change needs a new Stripe Price + env update + redeploy.

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
- Cron sequential loops in `cron-sync-ical` AND `cron-refresh-events` share the "batch at scale / maxDuration" debt — fine at current apartment counts; batch before many booked apartments. (Phase G cron-batching item.)
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

- **NEXT ACTION — PILOT STEP 1 CHECKS (no code):** Groq terms/DPA; Tavily DPA + post-Nebius
  ownership; LocationIQ plan POI endpoint + quota; Geoapify quotas + commercial use. GATE before
  any code. See "ZERO-GOOGLE AI PILOT — APPROVED PLAN", which is canonical for this workstream.
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
- **14 Dependabot alerts (7 high, 7 moderate) do NOT reconcile** with the older note claiming
  **3 dev-only vulns** (`docs/history.md`, S24 residual). **Triage before the pentest gate.**
- **~~Re-test grounding on Gemini 3 once billing is live~~ — SUPERSEDED by the ZERO-GOOGLE AI
  PILOT.** Billing is closed, so there is nothing to re-test. The pilot **dissolves the 16 Oct
  `gemini-2.5-flash` shutdown pressure by a different route**: grounded surfaces move to
  Tavily/POI + a cheap LLM, so no surface depends on Google grounding at all. Revisit only if a
  surface graduates back.

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

## SECURITY — cross-tenant anon leak FOUND AND CLOSED (Jul 28 2026)

**The most serious defect found in the project to date, and the S24 full security audit did
not catch it.** Four RLS policies — `apartments_guest_read`, `apt_details_guest_read`,
`host_picks_guest_read`, `guide_guest_read` — targeted **PUBLIC with NO apartment scoping**.
The publishable key is bundled in the client, so anyone holding it could read **every host's
rows**, not just the apartment they were looking at. **Proven live with count-only queries.**

**What was exposed:**
- **`apartments.ical_urls`** — the worst of it. That is a **bearer secret**: the URL alone
  grants read access to a host's entire platform reservation calendar.
- **All WiFi passwords** (they were `is_private = false` at the time).
- **Every property's street address and coordinates.**

**Migrations — ALREADY RUN by the operator via MCP. DO NOT RE-RUN:**
`anon_column_scope_apartments`, `revoke_truncate_trigger_references_client_roles`,
`backfill_wifi_rows_private`, `drop_unscoped_anon_guest_read_policies`.

**Code — `27b881b`:** new `api/guest-bootstrap.ts` (service-role, **single-apartment**)
replaced the four anon reads in `GuestPage.tsx`; WiFi reclassified `is_private = true` in
both `PropertySetup` and `demo-create`. **Verified:** all four tables now 401 to anon, and
verified guests still receive their WiFi.

Both durable lessons from this are recorded in **Lessons / learnings** above (document the
policy predicate not the app's query; and the blanket TRUNCATE/TRIGGER/REFERENCES grants).

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

## SESSION Aug 4 2026 — Gemini terms verified at source; the 30 Jul session recorded

**DOCS-ONLY. Code HEAD unchanged at `d282fe8`.**

> **REMEDY SUPERSEDED Aug 5 2026 — the FINDINGS below are unchanged and still true.** Every
> "enable billing on all five projects" instruction in this section is answered instead by the
> **ZERO-GOOGLE AI PILOT** (canonical section above): the Bemgu billing account is CLOSED and the
> surfaces migrate OFF Google. The terms analysis is exactly WHY that plan exists — read the
> findings here, take the remedy from there.

### GEMINI API TERMS — READ AT SOURCE, not from summaries
Source: **https://ai.google.dev/gemini-api/terms** — *Gemini API Additional Terms of Service*,
effective **23 March 2026**.

1. **CONFIRMED — LAUNCH BLOCKER.** "Use Restrictions", verbatim: *"You may use only Paid
   Services when making API Clients available to users in the European Economic Area,
   Switzerland, or the United Kingdom."* Bemgu is a Finnish product serving EU hosts and EU
   guests on **five no-card free-tier keys** (`GEMINI_API_KEY`, `_GUIDES`, `_CHAT`, `_EVENTS`,
   `_PUBLIC`). **On the plain reading this is a breach TODAY.** Enabling billing on all five
   projects is a **CONDITION OF LAWFUL USE, not a quota improvement.**
2. **CORRECTED — the 30 Jul data-training concern does NOT apply to Bemgu.** That note claimed
   free-tier guest chat sits under terms permitting Google to use it for product improvement,
   and called it the worse of the two problems. **Google's terms say the opposite for EEA
   developers.** End of the "Unpaid Services" section, verbatim: *"If you're in the European
   Economic Area, Switzerland, or the United Kingdom, the terms under 'How Google uses Your
   Data' in 'Paid Services' apply to all Services, including Google AI Studio and unpaid quota
   in the Gemini API, even though they are offered free of charge."* Bemgu is established in
   Finland, so the **paid data terms already govern**: Google does **not** use prompts or
   responses to improve its products, and processes them under the **Data Processing Addendum
   for Products Where Google is a Data Processor**.
   **CONSEQUENCE:** the DPA's no-AI-training commitment and the guest notice's chat paragraph
   **were never false and did not block publication.**
   **LESSON TO RECORD:** the 30 Jul conclusion came from a **developer-forum thread plus
   secondary sources and was explicitly flagged as unverified**; acting on it would have
   written a **materially wrong statement INTO a privacy document**. **Read the binding text at
   source before recording a compliance fact.**
3. **NEW — grounding carries its OWN data terms on top of the tier terms.** "Grounding with
   Google Search" → "Data Collection and How Google Uses Your Data": Google **stores prompts,
   contextual information provided, and output for THIRTY DAYS** to create Grounded Results and
   Search Suggestions, and that stored information **can be used for debugging and testing** of
   the systems supporting grounding. Critically, that debugging/testing processing falls under
   the **processor DPA only "when using Grounding with Google Search via paid quota of Gemini
   API"**. Bemgu grounds **`guest-chat`, `_lib/guide`, `_lib/city-events`** → this is a
   **SECOND, INDEPENDENT reason billing must be enabled**, and the **30-day storage must appear
   in the guest privacy notice either way.**
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

### THE 30 JUL 2026 SESSION — never recorded until now
- **All three legal documents DRAFTED** — host privacy policy, guest privacy notice, DPA.
  Status: **draft, unpublished, not in force**, pending lawyer review. **They are still outside
  the repo** — see the ⚠ note in the legal workstream's step list.
- **CONTROLLER STRUCTURE IS THREE-WAY, not two** — now corrected in the legal workstream
  section. The load-bearing part: **Bemgu is CONTROLLER IN ITS OWN RIGHT for server logs and the
  anti-abuse check on the pre-arrival chat**, because those are Bemgu's own security decisions,
  not the host's instructions. **Claiming processor status for that slice would be wrong.**
- **SEQUENCING TRAP — ON THE CRITICAL PATH** (recorded in full in the legal workstream): the
  drafts promise 30-day erasure that **the code does not perform**. **Retention crons ship
  BEFORE publication and BEFORE the lawyer review.**
- **WEATHER (Gap 9) — a better answer than disclosure:** proxy wttr.in through Bemgu's own
  server and the guest's IP never reaches the third party, **deleting a subprocessor and a
  disclosure instead of documenting them.**
- **TWO SMALL BUILD TASKS:** link the guest notice from every guest page and welcome page
  (Gap 6 — currently linked from nowhere), and inject the host's brand name so a guest can see
  who the controller is.

### GUIDE GROUNDING — WORKSTREAM CLOSED (verified 30 Jul)
Both test guides regenerated on `d282fe8`. **Casa Marco** (Barcelona/El Born): **11 places,
Coffee 2**. **Villa in the sky** (Berlin/Prenzlauer Berg): **28 places, Coffee 4**. Coffee was
**0 in both** before the empty-category retry — **so the retry works**; Berlin's total doubled
from 14. Barcelona stays the weaker case at 11 but is **no longer empty**.
**DECISION RECORDED: no further prompt tuning on this endpoint — if a category is thin, host
picks are the product answer.** Guide-quality items are off the open list.

### AIRBNB LINK DELIVERY — researched 29 Jul; changes a Phase-a assumption
**Airbnb blocks external links PRE-BOOKING only.** Links are permitted **once a reservation is
confirmed** — which is exactly when the welcome link is sent. Competitor **Touch Stay's
documented workflow is pasting the guidebook link into Airbnb message templates**, so the
channel works in practice.
**TRAP TO RECORD:** a link added to a **SCHEDULED** message **appears non-functional in the
editor but works once sent** — the most likely cause of a host reporting "Airbnb blocked my
link".
**FALLBACKS** if a confirmed-booking link is genuinely stripped: send an **IMAGE containing the
QR code plus the URL in readable text** (Airbnb permits photo attachments in scheduled
messages), or use Airbnb's own **check-in-instructions / house-manual** fields.
**PERMANENT CONSTRAINT: OTAs often do not pass the guest's email to the host**, so Bemgu
**cannot rely on email as a fallback channel.**
**STILL UNVERIFIED:** the confirmed-booking link test has not been run; **Vrbo and Booking.com
policies are entirely unresearched.**

### NEW MUST-HAVE (Udy, 29 Jul) — a host guide on communicating with guests, per booking platform
Belongs in the **existing Host Guide system** (docked drawer + hint strips + Ask Bemgu; content
source `docs/arrivly-host-guide-content-v1.md`) as a **new section plus a hint strip on the
Share panel** — **not new architecture**. Must cover, per channel: **Airbnb** (post-confirmation
only, the scheduled-message trap, the image+QR fallback), **Vrbo**, **Booking.com**, direct
bookings, WhatsApp, SMS, email; plus a **"my link was blocked" troubleshooting section**.
**BLOCKED ON:** the Airbnb test result, and Vrbo/Booking.com research. **Do not write platform
instructions that have not been verified.**

### VIATOR REPLIED (~29 Jul) — NO APPROVAL GIVEN
Their message confirms **Viator's affiliate relationship is with Bemgu**, and that **under the
current setup payouts can only be issued to Bemgu, never to individual hosts** — which
**validates the T1–T2 half of c-full as built**. It asks whether commissions are intended for
Bemgu or the hosts, and **restates the tier-3 host-own-PID proposal WITHOUT approving or
rejecting it**. The message is **ambiguous as to which passages are Viator's words and which are
Bemgu's quoted back**.
**A reply is drafted and UNSENT**, pending (a) Udy confirming which passages are whose, and
(b) **verifying whether the noindex claim is actually true in the live code** before asserting
it to a partner.
**RECORD THE RISK:** tier 3 asks Viator to credit a **host's** affiliate account for traffic on
**bemgu.app — a domain that host does not own**, which sits against **Viator's own-domain
requirement**. This is the specific point needing **explicit written sign-off**, and it is a
**TIER 3 LAUNCH DEPENDENCY, not general backlog.**

## SESSION Aug 4 2026 (2) — pre-billing security: scrubErr + atomic per-host guide cooldown SHIPPED

**Two commits, both pushed and SHA-verified against Vercel production. Code HEAD is now `6fd015c`.**
Chain this session: `3c56c95` (shared scrubErr helper) → `6fd015c` (atomic per-host generate-guide
cooldown). Both READY on Vercel, SHAs match GitHub.

**GOAL:** close the pre-billing spend-abuse holes on `generate-guide` before Gemini billing is
enabled (a billed key turns a looped call from a quota nuisance into unbounded spend; the repo is
PUBLIC).

**`3c56c95` — shared `scrubErr` helper.** New `api/_lib/scrub.ts` (redact `AIza…` + `key=` then
truncate) centralises the redact-then-truncate logic that was hand-copied across ~15 call sites;
1 new file + 14 importers, net −23 lines. **Closed Finding 1:** five AI-calling files
(`_lib/host-picks`, `guest-chat`, `guide-assistant`, `bulk-import`, `welcome-chat`) previously
scrubbed only `key=` and MISSED the `AIza` pattern. Stripe files deliberately NOT converted (they
scrub `sk_`/`whsec_`, which scrubErr does not cover). code-reviewer + security-auditor both passed.

**`6fd015c` — atomic per-host cooldown on `generate-guide` (6h server floor).** The real fix for
the loop-the-endpoint hole. Took THREE security-auditor rounds, each catching a real, exploitable
bypass — the gate did its job:
- Round 1 (rejected): read `generated_at` then generate — lost to parallel bursts (TOCTOU), and
  failed generations never wrote a row so the gate never armed.
- Round 2 (rejected): claim on `guide_recommendations` — defeated because a host could **delete
  their apartment (FK cascade destroys the claim row), recreate it, and burst the ungated
  first-generation path**. The claim must not live on an apartment-linked, host-deletable row.
- Round 3 (SHIPPED): claim on **`hosts.guide_claimed_at`** — a row a host cannot delete (without
  destroying their own account) and cannot UPDATE (no table- or column-level UPDATE grant for
  `authenticated`). Single atomic conditional UPDATE
  (`.eq('id',userId).or('guide_claimed_at.is.null,guide_claimed_at.lt.<cutoff>')`) taken AFTER
  auth+ownership and BEFORE generation. Under READ COMMITTED a concurrent burst serialises on the
  host row lock → exactly one caller wins per 6h window. Claim is stamped BEFORE generation, so a
  FAILED run also consumes the window (deliberate — a failed grounded gen costs the same money).
  scrubErr re-applied to the blurb-failure log in the same file.

**TWO MIGRATIONS applied this session via Supabase MCP — DO NOT RE-RUN:**
- `guide_recommendations_lock_and_claim`: dropped the ALL/PUBLIC `guide_host_all` policy →
  replaced with SELECT-only `guide_host_select` (apartment-scoped); REVOKEd INSERT/UPDATE/DELETE
  on `guide_recommendations` from anon+authenticated (verified: `authenticated` now SELECT-only,
  `anon` no grants). Also added a now-UNUSED `guide_recommendations.guide_claimed_at` column
  (superseded by the hosts column below — harmless, left in place).
- `hosts_guide_claim_column`: added `hosts.guide_claimed_at` (nullable timestamptz). VERIFIED
  server-only: `hosts` has NO table-level UPDATE grant for `authenticated` and NO column-level
  UPDATE grant on the new column, so a host cannot reset their own claim via PostgREST.

**BEHAVIOUR — INTENDED AND ACCEPTED:** the cooldown is per-HOST, so a host with several properties
gets **one guide refresh per 6h across ALL their properties**. A property created within 6h of any
refresh gets no guide/greeting_blurb until refreshed manually. Documented at the call site with a
warning that a per-apartment exemption would recreate the delete/recreate hole. REVISIT only if a
real multi-property power-host complains — not before.

**DECISION — fail OPEN on claim-infra error** (Udy): if the claim query itself errors, the request
proceeds to generate. The auditor preferred fail-closed and classified fail-open as a non-blocking
decision, not a risk. Rationale accepted: the claim is a trivial single-row update that essentially
only errors if Supabase is down, in which case `generate-guide` cannot function anyway.

**LIVE TESTS (production, Madrid apt `84c136f7-…`, host `udy.bar.yosef@sterlights.com`):**
- **Cooldown PROVEN.** 6-call loop after deploy: call 1 → `200 {ok,placeCount:10}` (won the claim,
  generated); calls 2–6 → **instant** `429 {"error":"cooldown","retry_after_s":~21560}` counting
  down from 6h, NO `[guide] generated` log, NO Gemini call, €0. This is the in-code,
  billing-independent protection that was the whole point.
- **Earlier burst (25 parallel, pre-cooldown) hit Gemini's per-minute 429 rate-limit**, NOT the
  spend cap — proven from Vercel logs (`429 "exceeded your current quota"` AFTER a full slow
  generation attempt). Useful: the RPM limit blocks burst hammering instantly.

**GOOGLE CLOUD BILLING — configured on ONE project (the test target):**
- Created a new **"Bemgu" billing account** (Finland, EUR) and linked the guides project
  **`gen-lang-client-0816353550`** ("Anna stays guide" — display name is misleading; trust the
  project ID; this is `GEMINI_API_KEY_GUIDES`).
- Set a **Spend Cap (enforcement, not alert-only)** scoped to that project + service **Gemini
  API**, initially €1, **raised to €10** (no real hosts yet). Verified **"Spend cap status =
  Configured"** — the exact column that read "Not applicable" during the June Anna's Stays €2000
  leak.
- **LESSON — the spend cap CANNOT be live-tested to the pause, because Google's cost data LAGS
  hours** (Reports showed €0.00 after ~€0.80 of real spend). So a lagging spend cap is a SLOW
  backstop; it cannot stop a fast leak on its own.
- **The layered defence (what actually protects spend), fast → slow:** (1) the in-code
  `generate-guide` cooldown — instant, €0, proven live; (2) Gemini per-minute 429 rate-limit —
  instant, proven; (3) the €10 enforcement spend cap — real but lagging; (4) Google's un-removable
  ~$250 tier-1 ceiling — the hard wall that makes a €2000 repeat structurally impossible. June had
  NONE of these (only a €51 alert-only budget).
- Per-API daily-quota override was ABANDONED (the Cloud Console quota UI would not surface the live
  per-project generate-content quota; the €10 cap makes it moot).

**~~STILL OPEN after this session: the other FOUR Gemini projects need billing + a spend cap
each~~ — MOOT Aug 5 2026.** The Bemgu billing account is CLOSED with zero linked projects; the
guides project's billing and €10 cap were removed with it, so nothing here needs a cap. See the
**ZERO-GOOGLE AI PILOT** (canonical). The layered-defence and lagging-cost-data lessons above
remain valid and are why the in-code brakes, not a spend cap, are the primary control. A
`demo-create` cooldown was NOT built (secondary surface: Turnstile + one-demo gated). Fail-closed
reconsideration remains a recorded non-blocking option.

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
- **WALLET POLICY:** every AI / search / POI provider must be **no-card free tier or prepaid**.
  Providers that require an **uncapped card on file are BANNED** (Brave-class).
- **LLM PROVIDER ORDER:** Groq if its EEA/commercial terms + DPA pass **the same Aug 4 standard
  applied to Google**; else Mistral; or Groq paid **with a hard spend limit set BEFORE the first
  call**.

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
- **Step 1 — checks, NO code:** Groq terms/DPA; Tavily DPA + post-Nebius ownership; LocationIQ
  plan POI endpoint + quota; Geoapify quotas + commercial use. **GATE: 1a-or-fallback and
  1d-or-1c green before ANY code.**
- **Step 2 — quality benchmark** on Sweet home (guide side-by-side + ~20 guest questions), **Udy
  judges. GATE.**
- **Step 3 — SHIPPED (Aug 6 2026).** `ai-provider.ts` + greeting / rewrite-rules / bulk-import /
  guide-assistant migrated to Groq. Details in "PILOT STEP 3 — SHIPPED" below.
- **Step 4** — guide on POI data. **Step 5** — events on Tavily. **Step 6** — guest-chat router +
  host-picks.
- **Step 7** — alarm-text sweep + **SELF-ATTACK DRILL** (burst chat past 40, hammer
  `city-events-public`, booking flood; verify the brakes trip and the ntfy wording is right).
  **The drill is a graduation PREREQUISITE.**
- **Step 8** — Udy deletes the five `GEMINI_API_KEY*` vars from Vercel Production (the `gemini`
  branch stays dormant in code).
- **Step 9** — learning phase. **Iteration 2** (automated responses, victim-vs-caller-aware) and
  **Iteration 3** (superadmin attack dashboard) are built DURING this phase.

**GRADUATION.** At 50 hosts + Step 7 drill passed + alarms observed on real traffic + dashboard
live: per surface, **guest-chat first, events second**; **guide only if the POI version
underperforms** (it may never return); the cheap four likely never return. Each return =
reopen the closed Bemgu billing account, set a fresh **enforcement** spend cap sized by the **2x
ceiling rule**, then flip the env var.

**SIDE EFFECT OF THE NO-CARD INTERIM — stated plainly.** Per the Aug 4 terms finding, the Gemini
free tier is **not** the compliant EEA basis. That is **accepted as a pre-launch BRIDGE state,
and this plan removes it entirely.**

### PILOT STEP 3 — SHIPPED (Aug 6 2026): provider abstraction + the four cheap surfaces on Groq

**FOUR SURFACES NOW DEFAULT TO GROQ:** `daily-greeting` (via `_lib/greeting.ts`),
`rewrite-rules`, `bulk-import`, `guide-assistant`. New `api/_lib/ai-provider.ts` exports
`resolveProvider(surface)` + `aiGenerate(surface, opts)`; plain `fetch` to Groq's OpenAI-compatible
`/openai/v1/chat/completions`, no new npm dependency.

- **ENV CONTRACT:** `AI_PROVIDER_<SURFACE>` → `AI_PROVIDER_DEFAULT` → `'groq'`. Surface vars:
  `AI_PROVIDER_GREETING`, `_REWRITE`, `_BULK_IMPORT`, `_GUIDE_ASSISTANT`, `_CHAT`, `_EVENTS`,
  `_GUIDE`, `_HOST_PICKS` (full enum declared now; only the first four are wired). `GROQ_MODEL`
  overrides the default `llama-3.3-70b-versatile`. **Rollback is an env-var flip + redeploy, not
  a code change** — set `AI_PROVIDER_<SURFACE>=gemini`.
- **KEYS in Vercel Production, all flagged Sensitive:** `GROQ_API_KEY`, `TAVILY_API_KEY`,
  `GEOAPIFY_API_KEY`. **Vendor-side naming convention: the key is called `bemgu-production` at
  each vendor**; the Vercel variable name carries the vendor, so an incident responder can map
  var → vendor console without guessing.
- **THE GEMINI CODE PATHS ARE KEPT**, unchanged, behind the provider branch at each call site.
  `ai-provider.ts`'s `gemini` case deliberately THROWS (`'gemini branch handled at call site'`) —
  Gemini is never reimplemented there.
- **`scrubErr` now also redacts `gsk_…`** alongside `AIza…` and `key=…`, so a Groq key can no
  more reach a log than a Google one. Redaction runs before the truncate.
- **GROQ FREE TIER LIMITS ARE ORG-LEVEL: 30 RPM / 6K TPM** — not per key and not per surface, so
  all migrated surfaces share one pool. This is a capacity ceiling, NOT a spend ceiling (free
  tier has no bill), and it is deliberately far below the in-app brakes, which remain the control.
- **BRAKES UNTOUCHED, and provably so:** every counter bump, cooldown, cache read/write, rate
  limit, fail-open/fail-closed choice and ntfy call sits OUTSIDE the provider branch.
  `daily-greeting`'s 50/h victim-keyed fail-closed brake and its `(booking, date, day_part)`
  cache were not edited at all — the greeting migration happens one level down in
  `_lib/greeting.ts::generateDailySuggestion`, which is where the model call actually lives.
  `cron-spend-audit` needs no change (endpoint keys unmoved).
- **A PROVIDER SWAP SILENTLY RE-SIZES EVERY BRAKE THROUGH ITS RETRY COUNT — both gates caught
  this, and it is the durable lesson of Step 3.** A brake counts REQUESTS; what a request costs
  is the provider's attempt budget. The first draft used a uniform `retries: 2` + 30s for all
  four surfaces, which silently turned `bulk-import`'s SINGLE 10s shot into 3 attempts / ~92s
  (on an endpoint with no rate limiter at all) and moved `daily-greeting`'s 50/h ceiling from
  ~100 model calls to ~150. **`AiGenerateOpts` now carries per-surface `retries` + `timeoutMs`,
  and every call site passes the SAME budget its Gemini path used:** greeting 1 retry x 12s,
  rewrite 2 x 10s, bulk-import **0** x 10s, guide-assistant 1 x 20s. So one counter unit costs
  the same number of model calls on both paths, and the recorded 2x ceiling rule still holds.
  **Check this on every remaining migration — passing no budget is the bug.**
- **`generateGreetingBlurb` (same file) STAYS ON GEMINI** — it is invoked from `generate-guide`,
  so it migrates with the guide in Step 4, not here.
- **THE ONE UNAVOIDABLE PROVIDER DIFFERENCE — `bulk-import`.** Groq's `json_object` mode emits a
  top-level OBJECT, but that prompt asks for a bare ARRAY, so the array can arrive wrapped
  (`{"categories":[…]}`) and the existing `Array.isArray` check would 502 on every import. The
  parse now unwraps a single array-valued property before that check. **A bare array — what
  Gemini returns in the normal case — never enters the unwrap, so the Gemini path is unaffected
  in practice**, and anything still not an array falls through to the unchanged 502. It is NOT a
  strict no-op though: a wrapped object from EITHER provider used to 502 and is now accepted —
  an intended widening, still gated by the per-item category/content validation. Prompts were
  NOT edited.
- **THE `GEMINI_API_KEY` EARLY-GUARD TRAP, worth remembering for Steps 4-6:** all four files
  returned early if `GEMINI_API_KEY` was unset. Left at the top, that guard would have nulled or
  500'd every request on the Groq path the moment **Step 8 deletes the `GEMINI_*` vars** — a
  fault that would appear only after a later, unrelated step. Each guard moved INSIDE its gemini
  branch. **Check this on every remaining migration.**
- **`docs/providers/` is committed** — Groq/Tavily/Geoapify contracts, DPAs and dated console
  screenshots. **`docs/providers/README.md` is the findings manifest**; read it before relying on
  any provider-terms claim.
- **STALE ALARM TEXT — RESIDUAL, fold into the Step 7 sweep (both gates flagged it).** The
  per-hour `daily-greeting` alarm was corrected, but three other places still point an incident
  responder at Google for a surface that now spends Groq: `cron-spend-audit.ts`'s
  `KEY_HINT['daily-greeting']`, the "watch daily-greeting (GEMINI_API_KEY)" lines in
  `create-booking.ts` + `sync-ical.ts`, and the stale comment at the top of `daily-greeting.ts`'s
  brake block. Costs a wasted action rather than money (Groq is no-card), so it was NOT fixed
  here to avoid a third gate cycle — **but Step 7's alarm-text sweep must catch it.** General
  rule, same class as `fa8fa32`: **an alarm's remediation text migrates with its surface.**
- **KNOWN, NOT FIXED (both gates, non-blocking):** a missing `GROQ_API_KEY` returns
  `502 'rewrite failed'` / `502` on rewrite-rules + bulk-import where their Gemini branches
  returned `500 'AI not configured'` (observability only — `guide-assistant` maps it correctly
  via `isAiConfigError`). And `resolveProvider` runs twice per request (call site + inside
  `aiGenerate`) — pure function, harmless, but an unrecognised-value warn double-logs.
- **TAVILY HAS NO SELF-SERVE DPA** (confirmed in its Trust Center, 2026-08-06), and its
  subprocessor list includes **Groq, Cohere and OpenAI, all US**. **HARD BUILD RULE for Steps 5-6:
  no guest text and no personal data may ever enter a Tavily query.** The compliance position
  rests on that rule, not on a signed document.
- **GROQ ZDR IS UNVERIFIED — OPEN, and it gates the guest-notice wording.** `docs/providers/README.md`
  asserted "Inference APIs ZDR = Enabled", but its own screenshot shows **ZDR Disabled** under
  the breadcrumb **"Personal / Default Project"**, not the **Bemgu** org the production key
  belongs to. The README now carries the contradiction and an ACTION rather than the claim.
  **If ZDR is off, Groq retains inputs + outputs for 30 days** — the same disclosure shape as
  the Gemini grounding 30-day finding (legal Gap 5). Verify inside the Bemgu org and re-capture
  a dated screenshot before any legal document relies on it.
- **NEW DATA EGRESS TO GROQ — record for Art. 30 / the subprocessor list**, ranked by what each
  prompt can actually carry: (1) **`bulk-import`** — up to 8000 chars of arbitrary host-pasted
  property info; the prompt tells the model to SKIP WiFi/check-in content, **but the input
  containing those door codes is still transmitted**; (2) **`rewrite-rules`** — up to 5000 chars
  of host-written house rules, commonly carrying a host name and phone number;
  (3) **`guide-assistant`** — the host's own questions plus 8 turns of history;
  (4) **`daily-greeting` — the cleanest, and worth stating precisely**: day-part, temp/condition,
  neighbourhood + city, up to 5 place names, stay-day index and up to 6 of this booking's own
  prior suggestions — **no guest name, no booking token, no street address, no apartment UUID,
  no host id.** The only guest-controlled free text reaching Groq anywhere is `condition`
  (<=100 chars, already validated).

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

## SPEND-ABUSE ALARM + CALL COUNTER (Aug 5 2026 — commit 5423285 + migration
api_call_counters_and_bump_fn, applied CHAT-SIDE via Supabase MCP)
- Table `public.api_call_counters` (host_id uuid FK→hosts ON DELETE CASCADE, endpoint
  text, window_start timestamptz, count int; PK (host_id,endpoint,window_start)). RLS ON,
  ZERO policies (service-role only). ALL grants revoked from public/anon/authenticated
  (incl. TRUNCATE/TRIGGER/REFERENCES) — a host cannot read, delete, or truncate their own
  counter rows, so the alarm cannot be erased. Verified live: grants = postgres +
  service_role only.
- Function `public.bump_api_counter(p_host_id uuid, p_endpoint text) returns integer` —
  SECURITY DEFINER, search_path pinned public,pg_temp, EXECUTE granted to service_role
  ONLY. Atomic upsert: increments the (host, endpoint, current-UTC-hour) row and returns
  the new count. This is the reusable cross-instance counter primitive for all spend
  endpoints.
- generate-guide.ts: after auth+ownership and BEFORE the cooldown claim, calls
  bump_api_counter and fires ONE sendNtfy (priority high) when the hourly count === 10.
  Placed before the cooldown so cooldown-blocked (429) attempts count too. Best-effort:
  try/catch, never throws/blocks/alters the response. The ntfy message carries the feature
  name, endpoint path, host UUID, and env-var NAME + PUBLIC Google project IDs to disable
  (GEMINI_API_KEY_GUIDES=gen-lang-client-0816353550 primary; GEMINI_API_KEY=
  gen-lang-client-0819525902 secondary, blurb) — never a key value.
- OPEN / tracked:
  (a) ~~RETENTION: api_call_counters has no cleanup yet~~ **DONE (Aug 5 2026)** — `cron-spend-audit`
      prunes rows older than 48h on every run (every 3h). Closes the GDPR-minimisation gap.
  (b) COMPLIANCE: ntfy spend alerts now MAY include a host account UUID (pseudonymous).
      NTFY_URL confirmed a PRIVATE topic. Update the Art. 30 ntfy row from "no personal
      data" to "may include a host account UUID" (fbf58aa's blanket claim is now narrower).
  (c) KEY-NAMING TRAP: shared key GEMINI_API_KEY is nicknamed "Arrivly guide"
      (0819525902) but the PRIMARY guide spend goes to GEMINI_API_KEY_GUIDES
      (0816353550, billed, no recorded console nickname). Consider renaming project
      0816353550 to e.g. "bemgu-guides-billed" so an incident responder disables the
      right project.

BOOKING AMPLIFIER — DECISION + PLAN (Aug 5 2026)
- create-booking.ts is the "amplifier": it mints a fresh in-dates guest pass on every call,
  with NO cap and HOST-CONTROLLED dates. Those passes are what unlock the paid guest AI
  (guest-chat, daily-greeting), so uncapped booking creation = uncapped valid passes. The
  endpoint itself calls NO paid API (no Gemini key) — it only writes rows. It feeds:
  guest-chat (GEMINI_API_KEY_CHAT) and daily-greeting (GEMINI_API_KEY).
- DECISION (Aug 5): the fix for this endpoint is a SECURITY BRAKE ONLY — a real
  cross-instance rate limit via bump_api_counter (per host, per UTC hour, block over
  30/hour, fail-open on infra error) plus one ntfy alarm at first breach. Double-booking
  prevention is explicitly OUT OF SCOPE of this security fix (kept small + reviewable).
- BACKLOG (product, separate task): double-booking prevention — reject a new MANUAL booking
  whose dates overlap an existing confirmed booking for the same apartment. TWO CAVEATS that
  make this fiddly: (1) must ALLOW same-day turnover (checkout day == next check-in day);
  (2) must be source-aware so it does not collide with iCal-imported blocks (source != 'manual').
  This is a data-integrity/product feature, NOT the security brake.
- BACKLOG (security, belt-and-suspenders): active-bookings-per-apartment cap — bound the
  number of concurrent in-dates confirmed bookings per apartment, to stop SLOW accumulation
  of valid passes (the hourly rate limit only slows minting, it does not bound the standing
  total). Lower priority than the per-endpoint AI brakes (guest-chat, daily-greeting) still
  to come.
- SHIPPED (Aug 5 2026): the brake is live in `create-booking.ts` — atomic `bump_api_counter`
  (endpoint key `'create-booking'`) after auth+ownership and BEFORE the guest/booking inserts,
  so a blocked attempt writes no rows; `429 {error:'rate_limited'}` over 30/hour; ONE ntfy at
  exactly limit+1. code-reviewer PASS (0 must-fix), security-auditor PASS.
- DECISION RECORDED — FAIL-OPEN ON COUNTER ERROR IS DELIBERATE AND ACCEPTED (Udy, Aug 5).
  Unlike `generate-guide` — where the counter is only an alarm and the real gate is the atomic
  `hosts.guide_claimed_at` claim — here THE COUNTER IS THE ONLY GATE, so a counter/infra error
  removes the limit entirely. The security-auditor's objection, recorded in full so it is not
  rediscovered as new: the error conditions CORRELATE WITH THE ATTACK, because a burst from one
  host hammers a single hot counter row (one row per host/endpoint/UTC-hour) — exactly the shape
  that produces lock-wait, statement-timeout and pool exhaustion. `p_host_id` is JWT-derived and
  `p_endpoint` is a literal, so no client-controlled value reaches the RPC and the error path is
  not directly attacker-triggerable. Accepted anyway because adding a booking is a low-frequency
  human action and locking real hosts out of their own calendar is the worse failure. REVISIT
  (flip to `503 unavailable`) if counter-bump errors are ever actually observed in the logs.
- RESIDUAL BYPASS, CONFIRMED, NOT FIXED — `sync-ical.ts` is the OTHER token-minting path.
  The rationed asset is `bookings.reference_number` (the guest pass), not "calls to
  create-booking". `sync-ical` → `syncApartmentBookings` → `reconcile_ical_bookings` mints ONE
  `ARR-` token PER VEVENT from a host-supplied feed URL, guarded only by a per-Lambda-instance
  5/min `Map` limiter (best-effort, not a cross-instance cap) and NO `bump_api_counter`. So the
  uncapped path dominates the capped one: create-booking = 1 token/request hard-capped at 30/h;
  sync-ical = N tokens/request with N attacker-chosen. FIX WHEN PICKED UP: add
  `bump_api_counter` with endpoint `'sync-ical'` after the ownership check, and/or cap
  `p_events.length` before the RPC. `import-airbnb-csv.ts` was checked and CLEARED (it only
  names existing bookings, never inserts one); `demo-create.ts` seeds exactly one behind
  Turnstile.
- SCOPE HONESTY — what 30/hour does NOT bound. `daily-greeting` caches on
  `(booking_id, local_date, day_part)`, so EVERY new booking is a guaranteed cache miss (up to
  4 fresh generations per token per day on `GEMINI_API_KEY`); at 30/h ≈ 720 tokens/day that is
  up to ~2,880 generations/day/host. `guest-chat`'s limiter is keyed apartment+IP per-instance,
  NOT per-token, so ONE token already permits substantial chat spend — the booking brake is not
  the control there. The per-endpoint AI brakes (guest-chat, daily-greeting) are still the real
  fix and are still to come. Also note `create-booking` has NO plan/subscription check, so the
  global bound is 30/hour x number of accounts an attacker registers.

ICAL AMPLIFIER — CLOSED (Aug 5 2026). The residual bypass above is fixed in `_lib/ical.ts` +
`sync-ical.ts`. `MAX_ICAL_URLS = 20`, `MAX_ICAL_EVENTS = 100` per sync (the counter is GLOBAL to
the sync, not per URL or per source), plus a cross-instance `bump_api_counter` cap of 5 syncs/
host/UTC-hour (endpoint key `'sync-ical'`) on top of the retained per-instance 5/min limiter.
Over the event cap the sync mints NOTHING — it returns before the reconcile loop, because a
partial 100-pass batch would still be an amplifier. NEW WORST CASE: 5 x 100 = **500 passes/host/
hour** (was unbounded). Re-syncing the same feed mints nothing (the RPC never writes
`reference_number` ON CONFLICT), so sustaining that needs 100 NEW uids per sync.
- LOAD-BEARING INVARIANT, do not refactor away: a dropped URL, a failed fetch and an over-cap
  parse are all "we did not read this feed completely", and ALL THREE must converge on "do not
  reconcile this source". The security-auditor caught a real regression here — URL truncation
  sliced dropped links off BEFORE the fetch loop, so their source never entered
  `incompleteSources`; a dropped link sharing a source with a kept one (two airbnb feeds, the
  21st dropped) would have reconciled from a PARTIAL uid set and SOFT-CANCELLED live bookings
  that existed only in the dropped feed. Fixed by marking dropped sources incomplete. NOTE the
  RPC's `cardinality(uids)>0` guard does NOT cover this case — the uid array is non-empty (the
  kept feed's uids), which is exactly why the guard would not have saved it.
- STILL OPEN / tracked (none blocking):
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
  (d) `cron-sync-ical.ts` (deliberately unmodified) has NO `bump_api_counter`, so it remains the
      residual per-host-uncapped path (100 x #apartments/day; unbounded for `is_exempt`/Tier 4).
      It also never fires the capped alert — cron-side cap trips are silent.
  (e) FAIL-OPEN on `counterErr` retained per spec, matching the create-booking decision above.
      Auditor's distinction, recorded: here each slipped call mints up to 100 passes rather than
      1, so the same infra error costs 100x — and an interactive sync is not needed for a host to
      function (the daily cron covers the scheduled path). Revisit to `503` before the other one.
  (f) Third shrink path, benign today: the `startsWith('https://')` filter also drops URLs
      without marking the source incomplete. Only bites if a previously-synced https link is
      edited to http. Fold in if that filter is ever touched.
  (g) UX: `PropertySetup.syncNow` toasts success even when a sync was capped or truncated, and
      renders only `errors.length` as "N links couldn't be read"; the 429 shows raw. Same
      user-visible gap already tracked for create-booking.

DAILY-GREETING SPEND BRAKE — SHIPPED (Aug 5 2026). Per-host cross-instance cap of 50
generations/host/UTC-hour via `bump_api_counter` (endpoint key `'daily-greeting'`), counted ONLY
on the cache-MISS paid path and placed BEFORE Gemini. Guest-facing, so a breach returns
`200 {suggestion:null}` (static copy) — NEVER a 4xx/5xx to the guest hero. ONE ntfy at limit+1.
Counter keyed on the APARTMENT'S HOST (the caller is unauthenticated); a token for host X can
only ever charge host X, and unverified/public callers return before the RPC, so the limit is
not third-party-exhaustible across tenants.
- **THE REAL FINDING — A CACHE KEY CAPS SPEND ONLY SEQUENTIALLY.** The cache row is written
  AFTER the 2-13s Gemini call, so K CONCURRENT requests on ONE valid pass all miss the cache and
  all spend. The "4 generations/day per booking" ceiling was therefore never a spend bound —
  before this brake, a single legitimate in-dates pass was worth UNBOUNDED Gemini spend, capped
  only by Gemini's own per-minute 429. This is why the counter matters far more than the
  pass-minting arithmetic suggested. Recognise this shape anywhere a cache is treated as a cap.
- **FAIL-CLOSED HERE, DELIBERATELY OPPOSITE TO THE SIBLING BRAKES — do not "fix" the
  inconsistency.** `create-booking`/`sync-ical` fail OPEN because blocking costs a host real
  work. Here the blocked behaviour IS the free fallback (the same static line the UI renders
  anyway), so failing closed costs a cosmetic sentence while failing open would spend uncapped
  Gemini during exactly the burst that breaks the counter. GENERAL RULE: fail-open is
  indefensible when the failure fallback is free.
- **A FAIL-CLOSED GATE IS ONLY COMPLETE WHEN EVERY QUERY FEEDING THE GATE'S CONDITION ALSO FAILS
  CLOSED.** Closing the counter-error leg moved the hole one line up: the apartment select uses
  `.maybeSingle()`, which reports query FAILURE as `data:null` — indistinguishable from "no row"
  — so a failed read skipped the whole brake and generated unbraked+unalarmed, under the same DB
  stress. Now an early return. `.maybeSingle()` is the specific trap.
- Non-numeric RPC return logs loudly (`console.error`, brake inactive) and still generates —
  reachable only via an operator-side change to the RPC's return shape, never by attacker input.
- STILL OPEN / tracked:
  (a) ~~`GuestPage.tsx` fires this endpoint TWICE per load~~ **FIXED (Aug 5 2026).** The effect
      was keyed on `weather` with no guard, so it ran once on mount (`temp:null`) and again when
      wttr.in resolved — and because the server writes its cache row only AFTER the 2-13s
      generation, BOTH calls missed and BOTH spent. Now a `greetingFiredRef` latch + a 2.5s
      weather grace window = exactly ONE request per active load. Effective legit headroom went
      ~25 → ~50 fresh loads/host/hour, which removes the false-abuse-alert risk for a
      multi-property host. **BUT NOTE WHAT IT DID NOT CHANGE: the worst-case ceiling is still
      ~100 model calls/host/hour** — an attacker calls the endpoint directly and never runs this
      effect, so a CLIENT fix moves throughput UNDER the ceiling, never the ceiling itself.
      TWO DURABLE CONSEQUENCES: (i) the ref is a permanent latch set BEFORE the fetch, so a
      transient network failure means NO suggestion for the life of that page (deliberate — the
      old accidental retry was the double-spend); (ii) **a fire-once ref silently converts its
      own dependency array into a no-op.** That is safe TODAY only because every path changing
      `aptId`/`tokenParam` does a full `window.location.replace`. If GuestPage is ever refactored
      to switch booking without remounting, this effect will neither refetch nor clear
      `dailySuggestion` — re-audit then rather than trusting the deps list.
  (b) The apartment select still discards its error string — the fail-closed log says THAT it
      failed, not WHY. Observability only now that the branch is closed.
  (c) ~~`guest-chat` remains UNCAPPED cross-instance~~ **CLOSED (`6f915b5`, Aug 5 2026)** — now
      40/host/hour, fail-closed. Every grounded surface is capped; see the CANONICAL SUMMARY.
  (d) Optional: page via `sendNtfy` on RPC shape drift instead of only logging.
- **BUILD CAVEAT, GENERAL — `npm run build` DOES NOT TYPECHECK `api/`.** `tsconfig.app.json`
  includes only `src`, `tsconfig.node.json` only `vite.config.ts`, and the root tsconfig is
  `"files": []`; `api/` is compiled by Vercel at deploy time. A green build is therefore NOT
  evidence that an api/ change typechecks — that is what the review gates read by hand, and it
  is the same reason the `.js`-suffix ESM rule can only fail at Lambda startup.

GUEST-CHAT SPEND BRAKE — SHIPPED (Aug 5 2026), the last of the five. 40 calls/host/UTC-hour via
`bump_api_counter` (endpoint key `'guest-chat'`), placed AFTER the verify-gate 403 and the
per-instance 15/min limiter, and BEFORE the Gemini key read / brand fetch / system-instruction
build / generateContent. A blocked request costs 3 cheap queries and EUR 0. FAIL-CLOSED (429) on
counter error; non-numeric return logs loudly and proceeds. ONE ntfy at limit+1.
- **A COUNTER UNIT IS NOT A MODEL CALL — SIZE THE GOOGLE BUDGET OFF 80, NOT 40.** `MAX_RETRIES=2`
  plus an empty-`reply` fall-through means 40 is a REQUEST cap and an 80-ATTEMPT spend ceiling.
  Same correction for `daily-greeting`: 50 units = up to 100 attempts (`withRetry retries:1`).
- **`abortSignal` IS NOT A SPEND CONTROL — THE MOST IMPORTANT CORRECTION IN THIS WORKSTREAM.**
  The per-attempt `Promise.race` was replaced with a real AbortController (Aug 5 2026), which
  tears down the in-flight HTTP request instead of merely abandoning it. It does NOT reduce the
  ceiling. The SDK is explicit (`@google/genai` `genai.d.ts`, doc comment on
  `GenerateContentConfig.abortSignal`): *"AbortSignal is a client-only operation. Using it to
  cancel an operation will not cancel the request in the service. You will still be charged
  usage for any applicable operations."* So abort is a COST REDUCER (expected value), never a
  cap — **and the retry fires regardless, so the number of calls is unchanged.** ALWAYS quote a
  brake as ATTEMPTS x retry factor, NEVER as billed generations. (The earlier note here claimed
  an AbortSignal would make the ceiling literal — that was WRONG; it does not.)
  **METHOD LESSON: this was caught by reading the vendor's installed `.d.ts`, not by reasoning
  about what abort "should" do — the same read-the-binding-text-at-source rule that the 4 Aug
  Gemini terms verification produced. Note the quote WRAPS ACROSS LINES in the `.d.ts`, so a
  single-line grep returns no match and can look like a fabricated citation.**
- ABORT-COVERAGE INVENTORY across every AI call site (Aug 5 2026):
  **Real AbortController (correct):** `guest-chat`, `_lib/city-events`, `_lib/greeting` (x2),
  `_lib/guide` (x2), `rewrite-rules`.
  **Bare `Promise.race` INSIDE a retry — abandons a billed call AND issues a second:**
  **`welcome-chat.ts` (PRIORITY 1 — the only one on an UNAUTHENTICATED surface, `/w/:code`;
  mitigated only by being ungrounded flash-lite on `GEMINI_API_KEY_PUBLIC`)** and
  `guide-assistant.ts` (host-auth = a named, blockable actor, so lower urgency).
  **Single-shot `Promise.race` — wastes the call it already paid for but CANNOT amplify:**
  `bulk-import.ts`, `_lib/host-picks.ts`. No AI call site lacks a timeout entirely.
- NOTE `_lib/retry.ts` treats BOTH `AbortError` and the literal string `"timeout"` as transient,
  so converting any site to AbortController does NOT stop the retry by itself — it only changes
  what the abandoned attempt costs.
- The `if (reply) return` empty-reply fall-through costs a second FULL call and **no abort
  mechanism can ever reach it** (it is a successful, fully-billed, non-throwing response). It
  belongs to any future work that tries to make one counter unit equal one model call.
- `apt.host_id` needs NO null guard here (unlike `daily-greeting`): `api_call_counters` carries
  `host_id` in its PK plus an FK to `hosts`, so a null key RAISES on the upsert → `chatCountErr`
  → the fail-closed 429. It can never silently skip the brake. Do not "harmonise" it.
- WHAT THE FIVE BRAKES ACTUALLY ACHIEVED: the token-derived chain is now bounded END TO END.
  Both pass CONSUMERS are capped per host per hour **regardless of how many passes exist**, so
  the standing-pass total no longer converts into AI spend — which DEMOTES the tracked
  "active-bookings-per-apartment cap" from a security item to a product one.
- **~~NEXT BRAKE~~ — `api/city-events.ts` lazy fill was the WEAKEST AI SURFACE IN THE SYSTEM,
  weaker than guest-chat was before this change. CLOSED (`66cb385`, split `bcf9396`).** The
  description below is retained because it is why it mattered: fully UNAUTHENTICATED (no captcha,
  no verify gate), GROUNDED on `GEMINI_API_KEY_EVENTS`, guarded only by a per-instance 5/min
  apt+IP Map — and it writes its cache row AFTER the model call, so the cache-race applies
  (concurrent requests on one uncached apartment all miss and all spend). Any account that can
  create/delete apartments manufactures fresh uncached rows at will.
- ~~ALSO STILL UNCAPPED: `refresh-events`~~ **CLOSED (`66cb385`, split `bcf9396`)** — 3/host/hour
  on `'city-events-host'`. STILL UNCAPPED cross-instance, all CHEAP + NON-GROUNDED + host-auth,
  so none reopens the fast-spend risk (checklist item 2 polish): `rewrite-rules`,
  `generate-host-picks`, `bulk-import` (NO limiter at all, one shared-key call per request);
  `guide-assistant` (per-instance 20/min only); all crons (per-apartment fan-out, no per-host
  counter — unbounded for `is_exempt`/Tier 4); `demo-create` (Turnstile + one-demo gated).
- ALARM BLIND SPOT — **NARROWED, NOT CLOSED (`cron-spend-audit`, Aug 5 2026). Never record it as
  closed.** The per-hour brakes are spend CAPS, not detectors: the alarm is a strict intra-hour
  `=== limit+1` and the counter resets on the UTC hour, so an attacker pacing at the limit
  sustained the full ceiling indefinitely with ZERO alerts. `api/cron-spend-audit.ts` (every 3h)
  now sums `api_call_counters` per (host, endpoint) over a rolling 6h window and alerts at ~3x
  the hourly limit. **Effect: the silent band drops from 100% of the ceiling to ~49.6% — a 2x
  reduction.** Undetected sustained rates that remain: guest-chat ~19.8/hr (~476/day, grounded,
  and remember a unit can be 2 model calls), daily-greeting ~24.8/hr on the SHARED key,
  create-booking ~14.8 passes/hr.
  (i) ~~NO CROSS-HOST AGGREGATE~~ **CLOSED (Aug 5 2026)** — see the Sybil check below.
  (ii) STILL OPEN: no cross-endpoint view — a host at 49% on all seven endpoints at once is
  invisible.

CROSS-HOST (SYBIL) AGGREGATE — SHIPPED (Aug 5 2026), closing the top item of three audits.
`cron-spend-audit` now also sums EVERY host per endpoint and alarms at
`GLOBAL_HOST_EQUIVALENT (5) x` the per-host rolling threshold. **The framing matters: the old
residual was `N x 119` and grew WITHOUT LIMIT in N; the fleet residual is now a FIXED CONSTANT
independent of N.** That is an unbounded leak becoming a bounded one — a genuine closure of the
SCALING, with a fixed floor.
- **BUDGETING INPUT (size the Google per-project spend caps against this, it is not a defect):**
  an attacker with >=6 host keys per surface can still sustain ~599 guest-chat + ~749
  daily-greeting + ~104 city-events-public units per 6h ~= **5,800 counter units/day**, and since
  a unit can be 2 model calls, **up to ~11,600 model calls/day** — invisible to every layer. No
  threshold tweak removes this; every detector has a threshold.
- The real evadable RATE is lower than `threshold/6` because the window is 6-7 buckets, so a
  constant-rate attacker must hold any 7-bucket sum under the line: ~85/hr guest-chat, ~107/hr
  daily-greeting. The `0 */3 * * *` schedule gives full temporal coverage (every instant seen by
  two runs) — no scheduling blind gap.
- COVERS BOTH ATTACKER MODELS because the sum discards the host dimension: Sybil-ACCOUNTS (many
  created accounts hitting the caller-keyed endpoints) and Sybil-VICTIMS (harvested apartment
  UUIDs/tokens hitting the victim-keyed guest endpoints) land in the same total.
- **`GLOBAL_HOST_EQUIVALENT = 5` IS A FLEET-SIZE-DEPENDENT KNOB — the first threshold here that
  scales with fleet size rather than per-host behaviour.** The comment's mental model ("5 hosts
  at the limit") does NOT match the arithmetic: it is a SUM, so 600 guest-chat calls is 6 calls
  each from 100 hosts. First false positives land around **50-150 active hosts**, and the binding
  constraints are the low-limit HOST-AUTH endpoints (`city-events-host` ~45 refresh clicks/6h
  fleet-wide, `sync-ical` ~75 manual syncs). `city-events-public` and `daily-greeting` are far
  safer than raw traffic suggests because both bump on **cache MISS only**. A per-run
  **fleet-totals log** was added so calibration has a BASELINE — otherwise the first evidence the
  knob is too low arrives as a FALSE POSITIVE, which trains a reactive raise, the wrong direction
  for a detector. Revisit trigger: any endpoint over 50% of its global threshold on three
  consecutive runs, or 50 paying hosts, whichever first.
- **VICTIM-vs-CALLER — THE OPERATOR-SAFETY RULE. An alert's ACTION line is REMEDIATION ADVICE and
  must be audited as such.** Both alerts previously said "block this host in Supabase". On
  `guest-chat` / `daily-greeting` / `city-events-public` the counter key is the **VICTIM host**,
  not the caller — following that instruction disables an innocent PAYING host while the attacker
  moves on. Both now lead with "INVESTIGATE BEFORE BLOCKING" plus the endpoint-scoped caveat
  (rotate QR secrets / revoke tokens instead). **Do NOT blanket-rewrite the others:**
  `create-booking`, `sync-ical`, `generate-guide` are caller-keyed (`userId`), and
  `city-events-host` passes `apt.host_id` but is caller-keyed because an ownership check precedes
  it — for those four, blocking IS right.
- FAN-OUT IS ORDERED BY SEVERITY AND BOUNDEDNESS, NOT COMPUTATION ORDER: the global finding is
  higher-signal and structurally bounded to 7 messages, so it sends BEFORE the per-host loop,
  which can hold 22 x 5s of ntfy timeouts. Compute-and-log every finding before ANY fan-out.
- NTFY LENGTH BUDGETING: bodies are sliced at 500 chars, so an ACTION line placed last can be
  SILENTLY TRUNCATED away. Measure the worst case as a JOINT max (longest endpoint paired with
  ITS OWN `KEY_HINT` — the 72-char amplifier hint belongs to the SHORT endpoint names). Measured
  ceilings: per-host ~443, global ~464. Re-count before adding any line.

**~~FOLLOW-UP — misdirected remediation in the three PER-HOUR brake alarms~~ DONE (Aug 5 2026).**
`guest-chat`, `daily-greeting` and `city-events` (public) are victim-keyed and all three said
"block this host in Supabase"; `daily-greeting` additionally asserted "Likely mass self-minted
guest passes", a FALSE CAUSAL STORY about a host whose guests were the target. All three now lead
their ACTION with "INVESTIGATE, do not auto-block" plus why (the key may be a victim) and what to
do instead. **The four caller-keyed alarms — `create-booking`, `sync-ical`, `generate-guide`,
`refresh-events` — deliberately still say "block this host", which is CORRECT for them. Never
blanket-rewrite them.** `refresh-events` must be classified by the ownership check that PRECEDES
its bump, not by the variable name: it passes `apt.host_id` but is caller-keyed.
- **NTFY 500-CHAR BUDGET — the spec'd replacements would have OVERFLOWED all three (~520 / ~585 /
  ~528) and silently truncated the very ACTION line being fixed.** Tightened, and the trailing
  `Logs: /api/...` clause dropped because line 1 of every message already carries the endpoint
  path. Measured finals: **guest-chat 453, city-events 465, daily-greeting 473.** These are PROOFS
  not samples — the alarm fires only at `count === LIMIT + 1` (a constant) and the only other
  interpolation is a fixed 36-char UUID, so **worst case == typical case, no variable-length
  fields**. `daily-greeting` at 27 chars spare is the TIGHTEST MESSAGE IN THE REPO: measure before
  touching it.
- RECOMMENDED, NOT DONE (all three text-only, so batch them — each edit re-runs both gates):
  (a) **`city-events` now OVER-ASSERTS innocence** — "= the VICTIM here, not the caller". A
      hostile host CAN be the caller: hitting their own apartment UUID unauthenticated gives them
      **7 grounded generations/hour vs the 3/hour their authenticated `refresh-events` reserve
      allows**, so the anonymous path is the CHEAPER one for them. This is the SYMMETRIC defect to
      the one just fixed — **an alert can mislead by over-asserting innocence, not only by
      accusing the victim.** Fix: "USUALLY the VICTIM, not the caller" (+4 chars, budget-safe).
  (b) "Revoke token" is ACTIONABLE (an operator `UPDATE bookings SET status='cancelled'` kills the
      token across guest-chat/daily-greeting/guest-state) **but INCOMPLETE: it does not close a
      leaked QR key.** `guest-state` returns the current in-dates booking's `reference_number` to
      anyone presenting the apartment's `qr_secret`, so revoking one token only holds until the
      next booking. The GLOBAL alert already says "rotate QR secrets / revoke tokens"; the
      per-endpoint ones say only "Revoke token". Adding it costs 18 of daily-greeting's 27 spare
      chars, so trim its line 4 in the same edit.
  (c) "Check source IPs" is UNVERIFIED, not wrong: `city-events` computes `clientIp(req)` for the
      per-instance limiter and DISCARDS it, so nothing on the flood path emits an IP — the
      instruction depends on Vercel exposing request IPs in the log view AND on log retention
      outliving the alert. Self-supporting fix = log the tripping IP beside the alarm (value is
      already in scope). That is a LOGIC change, so it needs its own pass.
- `cron-spend-audit` DESIGN NOTES worth keeping: the scan is PAGINATED because an unbounded
  PostgREST select silently truncates at max-rows with NO error — it would have UNDER-COUNTED
  exactly the abusers it exists to catch while still reporting `ok:true`. **A detection control
  that silently under-counts is worse than none: it manufactures confidence.** Pagination is
  sound here only because the PK `(host_id, endpoint, window_start)` gives a total order and
  `bump_api_counter` only writes the current-hour row (which sorts AFTER the cursor). Prune runs
  BEFORE the alert fan-out so a long fan-out can never starve retention; fan-out is capped at 20
  (worst offenders first) with an overflow summary; both a failed scan AND a truncated scan page
  the operator, since an incomplete audit must not look like a clean one.
  **The prune's `.lt()` filter is LOAD-BEARING FOR ENFORCEMENT:** without it the delete becomes a
  full table wipe that resets every host's CURRENT-hour counter and silently disables all six
  brakes on every run. The cutoff guard catches an inverted/too-recent VALUE only — it cannot
  detect a dropped filter, and the comment says so.
- STILL OPEN on the detector: **NO CRON HEARTBEAT — "never ran" remains undetectable**, the exact
  shape of the monthly guide cron that has never run. The failure ntfy covers "ran and failed",
  not "never ran". Also `city-events-host` (9) and `sync-ical` (15) WILL false-positive on a
  legitimate Tier 3/4 multi-property setup sweep (12 properties > 9), firing a high-priority
  "block this host" alert at a paying customer — revisit when a real portfolio host exists.
- TWO CORRECTIONS TO THE SHIPPED COMMENTS (cosmetic, not fixed, so the gate verdicts stand on
  the reviewed bytes): (i) the block comment says a 429 renders the "lots of questions" copy —
  that is the **500** branch of `ChatBot.tsx`; 429 renders "You're sending messages quickly".
  Note the guest wording implies THE GUEST was fast, but a per-HOST hourly cap can trip for a
  guest who sent one message. (ii) `GEMINI_API_KEY_CHAT = gen-lang-client-0221179352` in the
  alert is **UNVERIFIED against Google Cloud** — it appears nowhere else in the repo. CONFIRM IT
  AND ADD IT TO THE KEY MAP: if wrong, the operator disables the wrong key mid-incident.

CITY-EVENTS SPEND BRAKE — SHIPPED (Aug 5 2026), closing the last uncapped grounded surface.
Both `city-events.ts` (PUBLIC lazy-fill) and `refresh-events.ts` (host refresh) bump
`bump_api_counter` before `generateCityEvents`. **SPLIT KEYS (final, shipped): public =
`'city-events-public'` 7/hour, host = `'city-events-host'` 3/hour** — same 10-unit wallet, but
the host reserve is unreachable from the public surface. Both FAIL CLOSED on a counter error
using their own soft shape (`200 {error:true}` / `200 {refreshed:false,reason:'busy'}`), both use
the 3-branch typeof convention, and each fires its own distinctly-titled ntfy at limit+1.
- WHY IT WAS UNBOUNDED: a null/failed generation writes NO cache row, so the cache-miss branch
  re-fires forever; `refresh-events`' 20h freshness gate has the identical never-arms defect
  (read-then-generate, and the gate only arms once a row exists). Both closed by the counter.
- ORDERING IS THE LOAD-BEARING PART: the brake sits AFTER the cache read, and `city-events` has
  NO cache TTL — so once any generation succeeds, every later public call is a DB read forever.
  The public path can only spend on apartments that are uncached AND whose generation keeps
  failing. Warm guests cost 0 units; a host clicking Refresh on a fresh property costs 0.
- REAL CEILING, RE-VERIFIED AFTER THE SPLIT (it moved budget, it did NOT add any): 7x2 + 3x2 =
  **<=20 grounded calls/host/hour, <=480/day** — identical to the pre-split single key, because
  `withRetry(retries:1)` in `_lib/city-events.ts` doubles every unit (realistic ~10/hr; the retry
  only fires on transient errors). AND `EventsPage.tsx` retries 3x on `{error:true}` AND on a
  429, so ONE failing guest view burns 3 of the 7 public units — ~2 page-opens exhaust the public
  hour. Size expectations off 7/3, never off "7".
- **W-1 — CLOSED by the split (shipped).** The shared key had been the first counter spanning an
  unauthenticated and an authenticated surface: an anonymous stranger holding ONE apartment UUID
  could, in ~11 cheap requests, make the HOST'S OWN "Refresh events" button fail for the rest of
  the hour across ALL their properties, never authenticating. `bump_api_counter` keys on
  `(host_id, endpoint, window_start)`, so the two keys are physically distinct rows and the host
  reserve is now unreachable from `/api/city-events`. **GENERALISABLE RULE: never share one
  counter key across a trust boundary — the untrusted side will spend the trusted side's
  allowance.**
- **A KEY SPLIT IS NOT AN UPSTREAM SPLIT (the honest limit of the fix).** Both surfaces plus the
  uncapped cron still spend the SAME `GEMINI_API_KEY_EVENTS` project, so a public flood ACROSS
  MANY HOSTS can still exhaust that project's per-minute limit or spend cap and degrade a host
  refresh. The host reserve is guaranteed ALLOWANCE, not guaranteed CAPACITY.
- Benign residual coupling: a successful anon lazy-fill writes `city_events_cache.generated_at`,
  so the host's 20h freshness gate then short-circuits for 20h. The host gets exactly the content
  their refresh would have produced, at zero cost to their reserve — not a denial of value.
- **APARTMENT UUIDs ARE FREELY OBTAINABLE — treat "the attacker knows one" as GIVEN for every
  public endpoint keyed on one.** Not enumerable (UUIDv4, 122 bits), but: every guest link
  carries it in plain sight (`/guest?apt=UUID`, kept forever by any past guest/cleaner/QR
  photographer, with no per-guest revocation), and **`api/welcome.ts` returns the raw
  `apartment.id` in the body of the fully public `/w/:code` endpoint** — and welcome links are
  DESIGNED to be broadcast over Airbnb/WhatsApp/email. This makes W-1 a real targeted attack,
  though it rules out mass random abuse.
- W-2 — CLOSED. Both files now use the 3-branch typeof convention (fail closed on RPC error; loud
  `console.error` "brake inactive" and PROCEED on a non-numeric return; alarm then 429 over the
  limit), matching `daily-greeting`/`guest-chat`. The 2-branch shorthand they replaced would have
  SILENTLY DISABLED the brake with no log anywhere if the RPC's return shape ever changed.
- **OPEN, RAISED BY BOTH GATES — THE 3/HOUR HOST RESERVE IS PROBABLY TOO TIGHT, AND ITS FAILURE
  MODE IS AN ALARM NAMING AN INNOCENT PAYING CUSTOMER.** `PropertySetup` does NOT auto-retry, so
  1 host click = 1 unit, and only STALE properties consume (the 20h gate is free). But a Tier-2/3
  host doing a setup sweep across >=4 stale properties gets a 429 on the 4th click — surfaced as
  the generic "Could not refresh events. Please try again.", advice that is FALSE for the next
  hour — and that same legitimate 4th click is exactly limit+1, so it fires a HIGH-priority ntfy
  titled "Bemgu spend alert" against a host who did nothing wrong. **Tier 3 sells "up to 12
  properties", so this is reachable by a paying customer on day one.** Options: raise host to ~6
  and drop public to 4 (keeps the 10 total), or keep 3/7 and make the 429 copy say "you've
  refreshed several properties recently — try again in an hour". Not urgent only because there
  are no real hosts yet. DECIDE BEFORE LAUNCH.
- The public alarm is an ATTACKER-CONTROLLED PAGER: `/api/city-events` is unauthenticated, so
  anyone with an apartment UUID can deliberately fire a high-priority operator notification with
  8 requests (pacing or rotating IPs defeats the 5/min per-instance limiter). Bounded to 1 per
  host per hour per key — so 2 per host-hour across both surfaces, no flood — but with N known
  host UUIDs it is N alerts/hour, and the trigger is NOT trustworthy.
- CACHE RACE: still structurally present (N concurrent cold callers all miss, all generate), but
  it can no longer OVER-SPEND — each request bumps its own unit first, so N concurrent requests
  consume N units. The race just compresses the hour's budget into seconds.
- THIRD CALLER NOT BRAKED: `demo-create.ts` also calls `generateCityEvents` on the same key
  (Turnstile + one-demo gated). The shared-budget comments read as if `'city-events'` covers the
  whole key — it does not.
- `cron-refresh-events` deliberately does NOT bump: it is cron-authorised, daily, booking-
  filtered. Keep it that way — adding it would let a guest starve the cron.
- INFO: `city-events.ts`'s `rlHits` Map has NO bounded-memory sweep (unlike `guest-chat`'s
  `RL_MAX_KEYS`), on the endpoint with the least-trusted callers. `GEMINI_API_KEY_EVENTS =
  gen-lang-client-0131909896` is likewise UNVERIFIED against Google Cloud — confirm with the
  chat project ID and record both in the key map.

## SESSION Jul 29 2026 (2) — compliance pins + the guide became grounded

Four commits, all live and SHA-verified against Vercel production.

**`fbf58aa` — compliance.** `vercel.json` gained `"regions": ["fra1"]`. Compute was unpinned and
defaulting to **iad1 (US East)** while Supabase is eu-central-1 — a transatlantic round-trip on
every DB call AND an international-transfer entry in the Art. 30 record. **VERIFIED LIVE:** a fetch
of `bemgu.app/api/public-pricing` returned `x-vercel-id` ending `::fra1::` — the compute region
itself, not just the config. Also removed the host name from **4 ntfy call sites**
(`cancel-subscription` ×2, `change-plan` ×2), matching the generic "A host …" phrasing
`stripe-webhook` already used. Host-facing **emails keep the name** — correct, they go to the host
themself. **All 7 ntfy call sites in the repo are now free of personal data** (the other three send
aggregate counts only). Closes legal Gaps 2 and 3.

**`1af1012` — the guide became grounded.** `_lib/guide.ts` adopted the city-events pattern: dropped
`responseMimeType` JSON, added `tools: [{ googleSearch: {} }]`. The two cannot coexist in Google's
API — which is why the guide had been generated from training memory with no ability to verify
anything. Descriptions switched to **ENGLISH, place names kept in local form**: a guest **reads**
the description but **shows** the name — to a driver, or against the sign on the door. (Previously
every guide was in the city's own language — Finnish, Spanish, German — on an English page.)
Per-attempt timeout 20s → 40s, `maxDuration` 60 → 120, plus a first-brace/last-brace parse fallback
since bare-JSON output is no longer guaranteed. `demo-create.ts` now reads lat/lng/country back and
passes them through — it had still been calling the generator unbiased, leaving demo guides exposed
to the regional-centroid bug `98017fe` fixed everywhere else.

**`a940158`** — distance rules, Coffee category, per-generation logging.
**`d282fe8`** — cross-category dedupe, empty-category retry, ceiling 120 → 150.
Findings from both are in "GUIDE GENERATION — MEASURED BEHAVIOUR" below.

## GUIDE GENERATION — MEASURED BEHAVIOUR (six live regenerations, Jul 29 2026)

Barcelona/El Born + Berlin/Prenzlauer Berg. Findings, not the blow-by-blow.

**GROUNDING WORKS, WITH A KNOWN BIAS.** Fabrication stopped — best evidence: an apartment at
Kollwitzstrasse 76 returned four real restaurants at Kollwitzstrasse 47, 53, 58 and 64. **But
grounding pulls toward FAMOUS, not NEAR** — search surfaces what is most written about, and the
internet is saturated with the Fernsehturm and near-silent about the small park four streets away.
Pre-fix runs returned the Fernsehturm (3.5km), Klunkerkranich (8km, Neukolln), Disfrutar (3km,
Eixample) and Boqueria. **Any future prompt work on this endpoint must actively counter that pull.**
Grounding also reduces invention but does **NOT** guarantee accuracy: a grounded run still returned
Mercat de la Boqueria with postcode 08003 (correct 08001) and Mauerpark with a six-digit German
postcode (133555; correct 13355).

**AN UNFILLABLE CONSTRAINT GETS ABANDONED, NOT PARTIALLY MET.** A flat "15 minutes' walk" across all
six categories is often impossible for Sight and Nightlife in a residential neighbourhood. Faced
with no valid answer the model broke the rule **entirely** and reached for the city landmark rather
than returning a short list. Splitting it — 15 min for daily needs (Restaurant/Bar/Coffee/Essential),
30 min for destinations (Sight/Nightlife) — fixed it completely in both cities: every city-wide
drift disappeared AND Sight gained entries while becoming more local. **General principle for prompt
work: give the model a rule it can satisfy.**

**THE MODEL STOPS VOLUNTARILY AT ~HALF ITS TOKEN BUDGET.** `finishReason` STOP with `rawLen` 3,076
and 4,188 against `maxOutputTokens` 8192. **Truncation is PERMANENTLY ruled out for this endpoint**,
`maxOutputTokens` is not binding, and no prompt instruction about quantity increases output —
"aim for 4-5 per category" produced no change (totals stayed 13–16). **If more places are ever
needed, the answer is more CALLS, not more prompt.** That is why `d282fe8`'s empty-category fix is a
second focused call rather than more prompt text.

**PROMPT INSTRUCTIONS CANNOT FORCE A CATEGORY TO FILL.** Coffee returned an empty array in both
cities even after an explicit definition, being explicitly fenced off from Bar/Restaurant, and being
told an empty list means the search was insufficient. Berlin then improved to 1, Barcelona stayed at
0. Evidence suggests cafes get absorbed into Bar/Restaurant (a Berlin Bar entry was described as
"a relaxed bar and cafe"). **Not truncation** — all six JSON keys were present and the categories
positioned AFTER Coffee were populated.

**n=1 CANNOT SEPARATE A PROMPT EFFECT FROM VARIANCE.** These generations are non-deterministic:
Berlin's Restaurant count swung 5 → 2 between runs and could not be attributed to the change. Only
findings that moved the same way across **both cities and multiple entries** (i.e. the distance
result) were treated as trustworthy. **Future prompt evaluation on this endpoint needs at least two
runs per city per condition.**

**TIMING, CORRECTED — the intuitive version is wrong.** The `d282fe8` retry fires only when the main
call is under 45s elapsed, so 45 + 25 = **70s sits BELOW the 80.6s the main path could already reach
alone** — the retry **cannot** raise the function's worst case. The 120 → 150 raise closes a
**different, pre-existing** overrun: `generate-guide.ts` chains `generateGreetingBlurb` (2×12s)
**after** the guide upsert, giving ~123s against a 120s ceiling — the worst failure shape available,
since it 504s a generation that already **succeeded AND saved**, sending the host to re-run completed
work. **Do NOT record the raise as "making room for the retry".** Observed real-world main call:
~13s Gemini + ~7s geocoding, single attempt, ~20s total — the worst cases here are theoretical.
Vercel Pro accepted `maxDuration: 150` at build time.

**GUIDE REFRESH IS GATED CLIENT-SIDE ONLY.** `GUIDE_FRESH_HOURS = 24` in `PropertySetup.tsx`: the
button disables and relabels to "Up to date" for 24h after `generated_at`. For testing, clear the
lock chat-side by back-dating `guide_recommendations.generated_at` via Supabase MCP — that moves
only the timestamp and leaves guide content intact.

## CITY GUIDE — geocoding fix SHIPPED (`98017fe`), plus a bigger unresolved issue

**Measured across 7 guides / 208 places.** Casa Miraflores (Lima) had **17 of 30 places over
20 km out, worst 150.8 km**; a fresh regeneration made it **16 of 30, worst 4,567 km**, with
**12 places collapsed onto just 2 identical coordinates**.

**ROOT CAUSE:** `geo.ts` queried LocationIQ with `limit=1` and no bounding, so where OSM
coverage is thin it returned a **REGIONAL CENTROID instead of failing**, and `guide.ts`
stored it. **The affected places were REAL and correctly addressed** (Huaca Pucllana, Parque
Kennedy, Museo de Arte de Lima) — **the model was fine, the geocoder was not.**

**FIX:** `geo.ts` takes an optional bias (**viewbox + `bounded=1` + `countrycodes`** —
LocationIQ has **NO proximity parameter**, confirmed from their docs); `guide.ts` passes the
apartment coordinates and rejects any fix beyond **`MAX_PLACE_KM = 25`** by leaving lat/lng
unset — **the place STAYS, only the coordinate goes. Never drop places: that would delete the
best content.** No country code is passed because `apartments.country` holds names ("Peru"),
not ISO codes.

**RESULT after refresh:** Lima worst **4,567 km → 6.9 km** (avg 1.6); Sweet home **57.3 km →
5.8 km** (avg 1.2); Test Apartment 1 → **3.1 km** (avg 0.9). **ZERO Navigate buttons lost in
any of them** — the bias fixed it at source and the 25 km net caught nothing. Barcelona (1.9),
Madrid (1.3) and Berlin (2.4) were never affected and were left un-refreshed.

**Shape to recognise:** "Penthouse in the sky" has 25 places with **NO coordinates at all**
(stale Jun 22 data, hidden apartment, expired host) — that is old data, not this bug.

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
- **THE MONTHLY GUIDE CRON HAS NEVER RUN, AND IS NOW STRUCTURALLY UNABLE TO.** No guide's
  `generated_at` matches the 10:00 UTC 1st-of-month schedule. It loops apartments
  **sequentially**, and a guide call now costs **up to ~99s each** — roughly **one apartment per
  invocation**. **Batching + staggering is the strongest candidate for the next piece of guide
  work.** Staggering needs **no new column** — the rule is "refresh guides older than N days",
  because `generated_at` already staggers naturally. Also skip expired hosts, and log outcomes.
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
