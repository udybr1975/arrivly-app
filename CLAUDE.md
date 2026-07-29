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
> **Current HEAD (Jul 29 2026):** `98017fe` — city-guide geocoding bias + 25 km sanity bound.
> Preceding this session: `27b881b` (cross-tenant anon leak CLOSED — see the SECURITY section),
> `82fd0dc` → `5f16b42` → `ff444a0` → `aa446d2` → `d79fd9e` (welcome page `/w/:code` Phase 1 +
> model/grounding fixes). All live and verified on production.
>
> **WHERE THE PROJECT IS:** Phases A–E, G, H and Phase I Stages 0/4A/4B/5 are COMPLETE.
> Build order decided: **flip live on Tiers 1–3 FIRST, then build Phase F (Tier-4 booking)**
> — so the pentest gate runs on the Tiers 1–3 surface, and Phase F needs its own second
> security pass before Tier 4 is sold.
>
> **THE THREE THINGS BLOCKING LAUNCH:** (1) the legal/compliance workstream — inventory DONE,
> **ten gaps still open**; (2) migrating the eight `gemini-2.5-flash` call sites before its
> **16 Oct 2026 shutdown**, and sizing the paid-grounding cost; (3) the pentest gate.
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
- **Guide: upsert fires even on empty parse result** — a 0-place guide silently overwrites a previously good guide. Gate the upsert on `placeCount > 0` (see next steps #7).
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

- **guest-chat runs on its own AI key (`GEMINI_API_KEY_CHAT`), isolated from the shared `GEMINI_API_KEY`.** It reads `process.env.GEMINI_API_KEY_CHAT || GEMINI_API_KEY` (same fallback shape as the guides key) and is a no-card key created in a SEPARATE AI Studio project so its free-tier DAILY quota is its own. INTERIM (S21): it stays no-card until the Google payment issue is resolved, then this single key flips to BILLED — which removes the daily cap; the verify-gate + limiter bound the spend. Groq cannot replace guest-chat (needs googleSearch grounding).

- **Gemini free-tier quota is a DAILY cap; exhausting it surfaces as intermittent guest-facing 500s — not a code bug.** In S21 testing an 18-call burst exhausted the free-tier daily quota; later chats returned Gemini `429 "exceeded your current quota"` (plus transient `503 "high demand"`), surfaced as a 500. The daily cap does NOT reset within a minute, so "wait a moment" is wrong advice for a quota 429. Before blaming app code for guest-chat failures, check the Vercel runtime logs for the upstream Gemini status code; a dedicated/billed key is the fix, not a code change.

- **city-events runs on its own AI key (`GEMINI_API_KEY_EVENTS`), isolated from the shared `GEMINI_API_KEY`** (`acd16f4`, Jun 25 2026). `api/_lib/city-events.ts` reads `process.env.GEMINI_API_KEY_EVENTS || process.env.GEMINI_API_KEY` (same fallback shape as the guides/chat keys) — a no-card key in a SEPARATE AI Studio project so its free-tier DAILY quota is its own; the `if (!apiKey)` guard and `scrubErr` key-scrubbing are unchanged. Trigger: on 2026-06-25 the `0 4 * * *` events cron 429'd every apartment and fired the ntfy "all refreshes failed" alert because the shared key's daily quota was exhausted at 04:00 UTC (≈21:00 Pacific, the tail of Gemini's quota-day; free-tier resets ~midnight Pacific). The shared key still serves the non-grounded endpoints — keep each high-volume/public Gemini surface on its own dedicated key.

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
- **(S28) UI (`GuestPage.tsx`): the blurb is FIRST-OPEN-ONLY** (per-booking `localStorage` flag `arrivly_guest_blurb_seen_<token>`); on later opens the letter reads as a stable host note. The time/weather/suggestion moved OUT of the letter into a dedicated **"Right now" card** (the visibly-fresh element). **KNOWN LIMITATION (pre-existing, out of scope, recorded):** the suggestion generates on the FIRST `/api/daily-greeting` fetch, which fires before weather resolves, so the suggestion text itself is NOT weather-influenced; the "Right now" card's weather pill is independently live.
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

**Open verification items / external threads:** (a) exact commission rates are account-level and change — product copy must say "typically ~8%", **never promise a number**; (b) **Viator multi-tenant / host-own-ID permission** — email sent to `affiliateapi@tripadvisor.com` Jul 24, **still OPEN** (follow-up ~Jul 30 if silent; until confirmed, tier-3 host Viator IDs are wired but their acceptance by Viator is unverified); (c) **Tiqets image pipeline — VERIFIED LIVE Jul 27 for partner `bemgu-188668`** (cache invalidated via MCP → lazy-fill returned real Tiqets CDN image URLs on all Sweet home cards; ratings + `imageCredit` mapping shipped). Only a final visual caption eyeball on a live card remains (if not already done). **DONE this session (was item d):** the Tiqets `reviewCount`-null bug is fixed (`146173f` — `ratings.total`/`ratings.average` mapping) and the temporary `[experiences:tiqets:debug]` log is removed.

### Tiqets licence obligations (permanent — confirmed by email Jul 26 2026)
- **Image credits (clause 9.1c):** image access is **ENABLED + VERIFIED LIVE (Jul 27 2026)** for partner `bemgu-188668`. Confirmed shape from the (now-removed) `[experiences:tiqets:imgdebug]` one-shot log: each `images[]` object carries `{ small, medium, large, extra_large, credits, alt_text }` — the credit field is **`credits`** (string or null; null is valid — a caption renders only when Tiqets provides one, e.g. "Stromma Finland" / "Helsinki Dreamdays Tours" on Sweet home cards). `540d57f` maps `imageCredit` from the selected image's `credits`; `ExperiencesSheet` renders it as a caption — **never strip it.**
- **Cache-freshness floor:** images/product data must refresh at least every **14 days** (Tiqets disclaims liability for stale images). The current 7-day `expires_at` + daily cron satisfies it — **NEVER extend `experiences_cache` TTL beyond 14 days.**
- **Viator constraints still stand (unchanged):** guest pages carrying marketplace content are **noindex**; per-host custom domains would breach Viator's own-domain clause (do NOT offer custom host domains while experiences render on the guest page).

### Credentials, keys & environment (Stage 4A/4B ops — Jul 26 2026)
- **Viator has TWO key types on the SAME dashboard page (Tools → Affiliate API): SANDBOX (issued first, top of page) and PRODUCTION (a separate "Get key" step below).** Sandbox keys `401` against the production API — this cost ~2 days of debugging. `VIATOR_API_KEY` in Vercel **Production** is now the **PRODUCTION** key, stored with Vercel's **"sensitive" flag** (write-only — re-copy from the Viator dashboard if it's ever needed again). `TIQETS_API_TOKEN` unchanged. Partner IDs are NON-SECRET; API keys/tokens are SECRETS (server-side env, no `VITE_` prefix). GYG has no API key at this access level (link/widget-based).
- **ENVIRONMENT POLICY — there is NO Preview environment for Bemgu (by decision).** Pre-marketing, **production IS the test environment** (guest pages are unreachable without a QR/link, so there's no exposure). All testing happens on production; the Preview env-var scope is deliberately **not maintained**. `VITE_EXPERIENCES_ENABLED=true` is live in Production (public flag, non-sensitive). **REVISIT-TRIGGER = the first real paying host:** at that point re-establish Preview (add `VIATOR_API_KEY`, `TIQETS_API_TOKEN`, `VITE_EXPERIENCES_ENABLED` to the Preview scope) and stop testing on prod.
- **Email / comms:** `hello@bemgu.app` sends via Gmail "send mail as" + Resend SMTP (`smtp.resend.com:465` / SSL, username `resend`, a **dedicated send-only key `bemgu-smtp-personal`** — SEPARATE from the production `RESEND_API_KEY`). A real (non-forwarded) mailbox is a pre-live checklist item. **Provider thread log:** **Tiqets — FULLY CLOSED (Jul 27 2026, two replies same day):** all three asks resolved — Reporting API self-serve via a fresh Essential-API token, `tq_campaign` confirmed in writing, images enabled for `bemgu-188668`. **Viator multi-tenant/host-own-ID permission — still OPEN** (sent to `affiliateapi@tripadvisor.com` Jul 24; follow-up ~Jul 30 if silent).

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

- **THE GUIDE IS NOT GROUNDED.** `_lib/guide.ts` uses `responseMimeType: 'application/json'`
  and no `tools` array — **Google's API does not allow forced JSON together with Search.** So
  a guide refresh **RE-ROLLS the same training knowledge; it does NOT find new places, and a
  re-roll can make a good guide WORSE.** City events and guest-chat DO use grounding. **Decide
  before launch** whether to build two-step grounded generation (a grounded research call,
  then a formatting call).
- **THE MONTHLY GUIDE CRON APPEARS NEVER TO HAVE RUN.** No guide's `generated_at` matches the
  10:00 UTC 1st-of-month schedule. It also loops apartments **sequentially at ~20–30s each
  against a 60s maxDuration**, and would need ~1 Gemini call per apartment against a ~20/day
  quota. **Needs batching AND staggering.** Staggering needs **no new column** — the rule is
  "refresh guides older than N days", because `generated_at` already staggers naturally. Also
  skip expired hosts, and log outcomes.
- **`generate-guide.ts` has NO server-side cooldown.** `GUIDE_FRESH_HOURS = 24` exists only in
  `PropertySetup.tsx`, so the endpoint can be called in a loop — and it spends **Bemgu's**
  quota, not the host's. Same class as the client-side upload caps.
- **`demo-create.ts` calls the guide generator WITHOUT coordinates**, so demo guides keep the
  old unbiased, unchecked behaviour. **The demo is the shop window — close this before
  marketing.**
- **Fabricated businesses still slip through.** The Lima guide invented "S-market,
  Runeberginkatu 33-35" (verified: it is an **Alepa at number 28**). **Geocoding cannot catch
  this — the street exists.** Needs a places lookup or grounding.
- **Guides generate in the LOCAL LANGUAGE** (the Helsinki guide is entirely in Finnish) on an
  English guest page.
- **`subscription_status` is DECOUPLED from the access gate.** `PrivateRoute` uses
  `needsPlan = !is_exempt && !is_demo && !stripe_subscription_id`. **Setting a host to
  'active' in the superadmin panel grants no access.** The operator set `is_exempt = true` on
  host `1d5a3b9c` (udy@tlv.capital) to work around this. **Either reconcile the two or make
  the admin panel warn.**
- **Enable GitHub secret scanning + push protection** (free, public repo, 2 minutes). A full
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

**THE STRUCTURAL POINT — two simultaneous legal relationships. Get this right first:**
- **Host data** (name, email, address, billing) → **Bemgu is the CONTROLLER**.
- **Guest data** (names, stay dates, messages) → **the HOST is the CONTROLLER, Bemgu is
  the PROCESSOR**. The host collects it; Bemgu handles it on their behalf.
This split means TWO privacy documents, not one, and it is why a DPA (GDPR Art. 28) is
required. Products routinely get this wrong by writing a single blurred policy.

**STEP 1 IS DONE (Jul 28–29 2026) — the data inventory exists, as an external `.docx`
(not in this repo).** It covers the Art. 30 record in BOTH roles (controller for hosts,
processor for guests), a table/column inventory with retention, the subprocessor list with
residency, client-side disclosures, transfers, and Art. 32 measures.

**TEN OPEN GAPS from that inventory — ALL STILL OPEN. These are the actual remaining work:**
1. **Legal entity details** for the record header (registered name, address, contact).
2. **Vercel function region is NOT pinned** — so compute is likely US. One config line to
   pin `fra1`. This is the cheapest gap to close and it changes the transfer analysis.
3. **ntfy alert payloads unaudited** for personal data.
4. **Retention undecided** for: `guests`, the bookings↔guest link, `daily_greetings`, guest
   `push_subscriptions`, `admin_audit`. **These BLOCK the Art. 17 erasure feature** — the
   delete flow cannot be built correctly until each has a decided retention period.
5. **Gemini unpaid-tier data-use terms** + the SCC/DPF transfer basis.
6. **No privacy-notice link on the guest page.**
7. **`guest_optins` is dormant (0 rows)** — decide keep or drop.
8. **Supabase auth-log and Vercel log retention unverified.**
9. **wttr.in weather is fetched by the GUEST'S BROWSER** — that sends the guest's IP to a
   third party with no DPA. Client-side, so it is a disclosure/consent question, not a
   server fix.
10. **LocationIQ corporate seat and DPA.**

**Agreed order of work (Jul 28):**
1. ~~**Data inventory** (GDPR Art. 30 record of processing) + **subprocessor list**~~ —
   **DONE Jul 28–29 2026** (external .docx; ten gaps above). It was the input to every
   other document, and the part a lawyer would otherwise bill to extract.
2. **Data-flow and residency check** — Supabase `eu-central-1` and Resend `eu-west-1` are
   EU; **Gemini is Google in the US = an international transfer needing explicit
   handling**. Also in scope: Vercel, Stripe, LocationIQ, Cloudflare Turnstile, and the
   three experience marketplaces.
3. Host-facing **privacy policy** + **terms of service**.
4. Guest-facing **privacy notice**.
5. **Data processing agreement** (host = controller, Bemgu = processor).
6. **Delete account & data** feature (Art. 17 right to erasure) — build LAST, because it
   needs the retention decisions from step 1 to be correct.

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
