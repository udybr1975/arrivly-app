# Arrivly — CLAUDE.md

Historical session detail lives in docs/history.md. Read it only when past context is
needed. (Deliberately a plain filename, NOT an @import — an imported file is pulled into
context automatically every session, which is exactly what splitting this file avoided.)

Three more purpose-named files were split out at the 22 Aug 2026 restructure. **NO RULE lives
in any of them** — every rule stayed here; those files hold only the reasoning behind one:
- **docs/pre-arrival-link-design.md** — the full pre-arrival link design: the locked decision,
  the amendment that falsified part of it, and why each rule is shaped as it is. Read before
  changing that feature's shape.
- **docs/resolved-debt.md** — closed debt, each with what closed it AND how that was verified.
  Read before re-opening something that looks broken, in case it was already answered.

> **BRAND vs CODENAME (Jul 12 2026 — rebrand):** the **public brand = Bemgu** (domain **https://bemgu.app**, Resend sender **hello@bemgu.app**, registrar **Porkbun**). The **internal codename = arrivly** — the GitHub repo name (`udybr1975/arrivly-app`), `package.json` name, local folder `C:\dev\arrivly`, the Stripe **`metadata.app === 'arrivly'`** filter (case-sensitive, load-bearing in `api/stripe-webhook.ts`), every `arrivly_*`/`arrivly:*` storage key + window/DOM event, the `arrivly-v*` SW cache name, all env var NAMES, and every code identifier / CSS class deliberately KEEP "arrivly". **Never rename them.** User-facing strings (page titles, meta tags, email copy + sender, push titles, aria-labels, displayed URLs, the "Powered by Bemgu" footer, manifest name) are all "Bemgu".
>
> **Cloudflare Turnstile widgets are HOSTNAME-ALLOWLISTED.** Any domain change must repeat it or the demo money-gate shows "Unable to connect".
> **Supabase auth email routes through Resend Custom SMTP** (`smtp.resend.com:465`, user `resend`, sender `Bemgu <hello@bemgu.app>`) — the built-in mailer is not used.
>
> Domain migration + rebrand narrative (Jul 12-17 2026) and its 8/8 smoke tests: docs/history.md.
> **Repo note (Jun 5 2026):** The canonical repo is now `udybr1975/arrivly-app`. The old `udybr1975/arrivly` is abandoned (server-side corruption: pushes rejected "missing necessary objects", Settings page 500s; GitHub support ticket open). Local working copy: `C:\dev\arrivly`. Vercel project `arrivly` is connected to `arrivly-app`.
> **No secret values live in this repo — it is PUBLIC.** Server-side keys have no `VITE_` prefix and exist only in Vercel env vars. **VERIFIED AT SOURCE 14 Aug 2026** via the GitHub API — `"private": false`, `"visibility": "public"`, `created_at 2026-06-05`, i.e. public since creation, never flipped. `.gitignore` carries five `.env` ignore patterns plus a `!.env.example` negation, and no secret has ever been committed. Do not re-derive or soften this line.
> **Current HEAD (code) — `60a4c2b`** (19 Aug 2026), the four UI items — availability picker, cancel from the calendar view, generic policy-block toast, cancelled-conversation chip. **PUSHED and verified live** (`dpl_FG7LrLidcSRwsaW4738YTWoDkfQu`). `fc35d69` before it is the BookingManager overlap guard + soft cancel; `c4981b2`/`8619c5f`/`1a2ed59` the Groq migration. **Two DOCS-ONLY commits sit on top — `057da82` and `eb13715` — both verified to touch zero files under `src/` or `api/`, both PUSHED and ancestors of the remote tip (measured, not recalled). They are listed for DRIFT DETECTION, not as outstanding work:** a docs tip above the code HEAD is the normal state here, never a mismatch. Docs-only commits land on top of it; a docs tip is not a mismatch. Full commit ancestry is in git — do not restate it here.
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

Full per-host enumeration, the Airbnb CSV names and the pending badge-cleanup list are archived in
docs/history.md — "Test Data (in DB) — full enumeration as of 18 Aug 2026". **Row-level detail rots
within days; only the rules below are durable.**

**Apartment ids** (stable, used by every manual test):
- Sweet home `d9614d11-d573-4ff0-961a-54c5ea37c2bd` (Etu Töölö Helsinki) · Test Apartment 1
  `aaaaaaaa-0000-0000-0000-000000000001` (Kallio) · Casa Marco
  `d81e4e89-385a-4886-b461-ba952c78e7f8` (El Born Barcelona) · Maison Lumiere
  `d7f47672-fde5-4da1-91ae-0f9f774732fd` (Le Marais Paris) · Penthouse in the sky
  `9b03a763-3ca6-4d1f-946c-d4e1f977d614` · Anna Stays `eab1e358-…` (Vantaa/Hakunila).
- **Test guest URL:** `/guest?apt=aaaaaaaa-0000-0000-0000-000000000001&token=ARR-TEST01`
- **Welcome codes:** Sweet home `XJ8SSKFH` · Casa Marco `962SM37Y` · Penthouse `3RV23Y2C`.

**Live plan values (confirmed S12, hard gate CLOSED):** Tier 1 €10/cap 2, Tier 2 €15/cap 7,
Tier 3 €25/cap 12, Tier 4 €49/unlimited; `app_settings.trial_days` = 14. **The official base
values — do not change without an explicit decision.**

**THE FIXTURE RULES — these are what survives, not the dates:**
- **FIXTURES SURVIVE RETENTION BY DATE-REFRESHING, NEVER BY EXEMPTION.** An exemption makes the
  published privacy notice false for everyone. **Re-roll dates before any guest-page test.**
- **`ARR-NOA001` (Sweet home) is CANCELLED ON PURPOSE — it is the C8 fixture** for the
  cancelled-conversation-survives rule. **It must survive every cleanup; do not "fix" it.**
- **Test Apartment 1 is DELIBERATELY geocoded to Vantaa** — a side effect of running D9 from the
  exempt admin account, kept as a fixture. **This is not drift; do not "correct" it.**
- **`ARR-SWE001` (Elena, 13-17 Aug) HAS ALREADY LAPSED** — checked out 17 Aug, verified in the DB
  18 Aug 2026. The ten `ARR-***001` rows seeded 18 Aug were dated 17-21 Aug and **are stale after
  21 Aug 2026.**
- **`ARR-FUT001` (Casa Marco, 23-26 Aug) is the PRE-ARRIVAL fixture** — a future-dated valid token
  resolving to the public tier.
- **`ARR-EVT777` / `ARR-PAR777` / `ARR-BCN777` are KEEP-PERMANENTLY** live/active/thank-you-state
  fixtures. Re-roll their dates when they lapse; never delete them.
- **Roy's `property_cap_override` was set to 2 for D8 and REVERTED to null** — verified reverted.
- **THE TWO PRE-ARRIVAL CLAIM FIXTURES, on "importer test" (welcome code `DX89PW3H`). BOTH
  CREDENTIALS ARE FABRICATED — shape only, no entropy from any real feed. Udy keeps all test
  data; never suggest deleting these.** `ARR-IMP401` / `platform_ref` `TESTCLAIM1`, 19-23 Aug
  2026 — exercises the **ACTIVE** state (verified claimed). `ARR-PRE901` / `TESTFUTURE1`,
  21-25 Sep 2026, guest first name attached **BY THE LINK** (the booking had none) — exercises
  the **PREVIEW** state and the name-fill path, and its `link_claimed_at` is still NULL, which
  is the chip's timing gap showing up exactly as recorded.

**Billing-test host rows rot fastest of all — VERIFY AGAINST THE LIVE DB, never trust a written
list.** The 11 Aug check found four of five prior descriptions wrong, including one row named here
as the clean "no subscription" test case that had since acquired one.

---

## Known notes / minor debt
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

- **A REVOKE MUST NAME THE ROLES THAT HOLD THE GRANT, AND THE CATALOG MUST CONFIRM IT.** Supabase default privileges grant EXECUTE to `anon` and `authenticated` BY NAME on every new function in `public`, so `REVOKE ... FROM PUBLIC` is a SILENT NO-OP against them. Four new SECURITY DEFINER retention functions shipped with `anon` holding EXECUTE — and SECURITY DEFINER bypasses RLS, so any holder of the public anon key could have called `cleanup_guest_identities(0)` and erased every guest name. Caught only by querying `pg_proc.proacl` afterwards. **Same class as the column-vs-table REVOKE trap already recorded here, and that record did not prevent it.** Always revoke from `anon, authenticated` explicitly and diff the ACL against a known-good function.

- **Record the RLS policy PREDICATE, never the app's query.** The app's `.eq()` is a convention; the predicate is the boundary. Describing policies by app behaviour is what hid a cross-tenant leak through a full security audit.

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

- **Anything the guest page must show from `is_private=true` rows needs a server endpoint with the booking token as the credential.** Anon RLS on `apartment_details` blocks private rows at the DB layer (`apt_details_guest_read USING (is_private = false)`), so client-side filtering after an anon query can never surface them — the rows simply aren't in the HTTP response. The only safe pattern is a token-verified server endpoint (using `resolveGuestAccess`) that calls the service-role client and returns only the private rows for the verified booking.

- **Guest booking-state is resolved server-side via `api/guest-state.ts` (S19), never by reading `bookings`/`guests` from the client.** The anon `bookings_guest_read` policy is gone. GuestPage calls `/api/guest-state` (plain fetch — guests have no auth session) in two stages: token path, then a KEYED date path gated by the per-apartment `apartment_qr_secrets.qr_secret` carried in the QR URL as `?key=`. An apt-only URL with no token and no valid key resolves to the neutral page by design. Every non-active outcome returns an identical flat neutral body so the endpoint leaks nothing.

- **When a function's EXECUTE comes from the DEFAULT PUBLIC grant (ACL `=X/owner`), `REVOKE EXECUTE ... FROM anon, authenticated` is a SILENT NO-OP** (S24). Those roles inherit EXECUTE via PUBLIC, not a direct grant, so there is nothing to revoke from them. `REVOKE EXECUTE ... FROM PUBLIC` instead — owner (`postgres`) + `service_role` keep their explicit grants, and trigger functions fire as owner regardless. ALWAYS confirm a function-privilege change against the LIVE ACL (`pg_proc.proacl` / `has_function_privilege`), not just that the statement executed without error. (Same trap applies to table grants via PUBLIC — check `relacl`.)

- **`guests` is server-write-only (`api/create-booking`) with a host-scoped SELECT policy (S24).** Never reintroduce a client-side `guests` insert/read, or a `USING(true)` policy. One guest row per booking; no cross-host first-name dedup. The host-scoped SELECT (`id IN (select b.guest_id from bookings b join apartments a on a.id=b.apartment_id where a.host_id = auth.uid())`) keeps the bookings-list and Messages `guests(...)` embedded joins working because they only ever surface the host's own bookings' guests.

- **`hosts` uses COLUMN-LEVEL UPDATE grants as a defence layer — new columns do NOT inherit them (Stage 4B, Jul 26 2026).** `authenticated` has UPDATE on a specific allowlist of host columns only (brand_name, accent_color, ui_state, …); server-only columns (tier, plan, subscription_status, stripe_*, trial_ends_at, the notice/pending/cancel columns) have UPDATE deliberately withheld. **Any migration adding a host-writable column MUST include an explicit column-scoped `GRANT UPDATE (col) ON public.hosts TO authenticated`** — RLS `hosts_update_own` (`auth.uid()=id`) alone is NOT sufficient because PostgREST also needs the column privilege. Stage 2 missed this for the three `*_partner_id` columns (they were granted SELECT/INSERT but not UPDATE), so the client Connect write silently 403'd; corrective migration **`grant_host_partner_id_column_update`** fixed it (verified: the three partner-id columns writable by `authenticated`; tier/plan/stripe/trial columns still read-only). ALWAYS confirm with `information_schema.column_privileges` after the grant.

- **WORKFLOW — migrations belong to Claude-in-chat via Supabase MCP, NOT to Claude Code mid-build.** In Stage 4B a needed corrective migration was applied by Claude Code during the build. The fix was correct and verified, but the rule is: **if a migration turns out to be needed mid-build, STOP and report back** rather than applying it. Future code prompts must state this explicitly (reader-migration-first sequencing stays a chat-side responsibility).


### Stripe & billing

- **Stripe Basil API (2025-03-31) moved `current_period_end` off the subscription root onto `sub.items.data[0]`**. Read item-level with a root fallback: `(sub.items?.data?.[0] as any)?.current_period_end ?? (sub as any).current_period_end ?? null`. Use `as any` casts deliberately — the installed Stripe SDK types and the account's runtime API version differ.

- **Stripe webhooks on Vercel require a raw body stream.** Set `export const config = { api: { bodyParser: false } }` and read the body manually with a stream-to-Buffer collector. `webhooks.constructEvent()` rejects any pre-parsed body.

- **Subscribing via Stripe Checkout starts the subscription in `trialing` status, not `active`.** `subscription_status` stays `'trial'` (not `'active'`) until the trial converts at the trial end date. This is expected — not a webhook bug. The `BillingPanel` trial banner is driven by `trial_ends_at` from the DB, not by `subscription_status`.

- **Stripe subscription schedule `iterations:1` with a historical `start_date` applies the new price immediately.** When creating a deferred switch from an existing schedule (`from_subscription`), the schedule already has `phases[0]` with `start_date` = current period start (historical) and `end_date` = current period end (the real billing boundary). Always rebuild the phase using `schedule.phases[0].start_date` + `schedule.phases[0].end_date` explicitly. Never use `iterations` — it counts forward from `start_date`, which is in the past, so the phase is instantly over. If `p0.end_date` is absent (shouldn't happen on a real schedule), fall back to `sub.items.data[0].current_period_end`, then `now + 30d` with a warn log.

- **`api/cancel-subscription.ts` release-then-cancel (S15, replaces the old 409 guard).** If a subscription schedule is attached, RELEASE it first (`subscriptionSchedules.release`) and clear `pending_tier`, THEN set `cancel_at_period_end`. Releasing before the cancel flag is mandatory — a live schedule and `cancel_at_period_end` on the same period end produce undefined Stripe behaviour. The host no longer has to undo a pending change before cancelling; the cancellation email notes the scheduled change was also cancelled when one existed.

- **Stripe secret key and webhook secret MUST point at the same Stripe environment.** A mismatch passes `constructEvent()` signature verification but fails `subscriptions.retrieve()` → the webhook 500s on every event and the DB never updates (symptom: 500 "subscription retrieve error", not 400). The real env is the sandbox with `cus_UfOVHv9hahCr78` + the Arrivly product's 3 prices. After any Stripe key change, replay one subscription event and confirm webhook 200 AND host-row update.

- **`plans.price_cents` is DISPLAY-ONLY; it does NOT control what Stripe charges.** The charged amount comes from the Stripe Price objects in env `STRIPE_PRICE_TIER_1/2/3` (`api/_lib/stripe.ts`). Editing the DB price only changes what the landing + plan cards SHOW. To change a price for real: (1) create a NEW Stripe Price (immutable), (2) update `STRIPE_PRICE_TIER_n` in Vercel + redeploy, (3) update `plans.price_cents` for display — Stripe first/together. Existing subscribers stay on the old price unless migrated. `app_settings.trial_days` needs NO Stripe action (trial applied per-sub at creation via `trial_end`; new signups only). Tier 4 has no Stripe price env; `create-subscription` returns `booking_tier_unavailable`.

- **Stripe `metadata.app` check is case-sensitive.** The webhook ignores any subscription whose `metadata.app !== 'arrivly'` (exact lowercase) with a silent 200. Test/clock subs need `metadata.app = arrivly` AND `metadata.host_id = <uuid>`.

- **Signup does NOT create a Stripe subscription.** `Signup.tsx` only fires `/send-welcome`. A subscription exists only after a completed Checkout (`create-subscription`). Subscribing during the trial carries the remaining trial via `trial_end` → status stays `'trial'` (no charge) until the trial date, then converts to active.

### AI providers & spend

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

- **Public guest-facing AI endpoints are spend-gated by verifying the booking token BEFORE calling the model, not by rate-limiting alone.** `api/guest-chat.ts` (S21) returns `403 verify_required` for the public tier before any Gemini/brand/prompt work, so only a verified in-dates booking can spend tokens — the same gate `daily-greeting` uses. The added per-instance rate limiter (15/60s, keyed apartmentId+IP) is a second layer but BEST-EFFORT: Vercel spreads requests across lambda instances, each with its own in-memory Map, so the 429 can't be observed reliably from outside and is NOT a hard cross-instance cap. Treat verify-gating (not the limiter) as the real spend control.

- **Keep every high-volume or public AI surface on its OWN key/project.** A shared key means one surface exhausting its daily quota takes down the others — this actually happened (25 Jun 2026: the events cron 429'd every apartment on the shared key and fired the "all refreshes failed" alarm; closed by `acd16f4`). The isolation is provider-independent and outlives Gemini. Key table under "ZERO-GOOGLE AI PILOT -> MECHANISM"; the superseded billing-flip and "Groq cannot replace guest-chat" annotations are dropped — both are false under the pilot.

- **Gemini free-tier quota is a DAILY cap; exhausting it surfaces as intermittent guest-facing 500s — not a code bug.** In S21 testing an 18-call burst exhausted the free-tier daily quota; later chats returned Gemini `429 "exceeded your current quota"` (plus transient `503 "high demand"`), surfaced as a 500. The daily cap does NOT reset within a minute, so "wait a moment" is wrong advice for a quota 429. Before blaming app code for guest-chat failures, check the Vercel runtime logs for the upstream Gemini status code; a dedicated/billed key is the fix, not a code change.

### PWA, push & service worker

- **`public/sw.js` must NEVER cache cross-origin requests.** Guard at the top of the `fetch`
  handler: `if (url.origin !== self.location.origin) return`. Returning without calling
  `event.respondWith` passes the request to the browser natively — no caching, no interception.
  Bump `CACHE_NAME` on EVERY `sw.js` change so the activate handler purges stale caches. Current value: `'arrivly-v4'` (bumped in `c294bda`).

- **Host push subscriptions are stored account-level (`apartment_id = NULL`).** Always call
  `sendPushToHost(db, hostId, payload)` without the optional `apartmentId` argument when
  notifying the host. Passing one narrows the subscription lookup to zero rows and delivers
  nothing silently.

- **Host app-icon badge is numeric and owned by `Layout.tsx`** (`navigator.setAppBadge(count)`). It updates only while the dashboard app is open — the SW deliberately does NOT badge host (/dashboard) pushes, so a closed dashboard icon lags until reopened. The in-app sidebar count pill is the live indicator.

- **Guest badge is DOT-ONLY** (`setAppBadge()` — no arg), set by SW on /guest push, cleared on page open. Persists until next open if the notification is dismissed without tapping. All Badging API calls are guarded (`'setAppBadge' in navigator / self.navigator`) — silent no-op on unsupported platforms.

- **Guest web push is PER-CONTEXT.** A browser tab and the installed WebAPK each hold their OWN push subscription (separate FCM endpoints — verified in `push_subscriptions`). Enabling notifications in a tab does NOT carry into the installed app, and vice-versa; the guest must enable push in the context they actually use. UX implication: in a tab offer **Install the app**; in the installed app offer **Turn on notifications**.


### Client & API conventions

- **Supabase Storage rejects the host's gotrue user JWT on this project.** Never upload with an anon/host session — mint a server-side signed upload URL via `api/create-upload-url.ts` (service-role) and use `uploadToSignedUrl`. Also lifts the Vercel 4.5 MB body limit. Evidence in docs/learnings.md.

- **Calendar/date math must use device-LOCAL `YYYY-MM-DD`, not `toISOString()`.** `new Date(y,m,d)`
  is local midnight; `.toISOString()` then converts to UTC and shifts the day back for every
  positive-UTC host (Helsinki/Barcelona/Paris — the whole market). Build the string from local
  `y/m/d` parts to match how `check_in`/`check_out` are stored and compared.

- **`vercel.json` `functions{}`: never list a specific file pattern alongside the `api/**/*.ts`
  glob** — Vercel rejects overlapping patterns and the build fails. Use one glob, raise its
  `maxDuration`.

- **api/ relative imports MUST end in `.js`** (e.g. `./_lib/push.js`, `./_lib/ical.js`,
  `./_lib/cron.js`). `package.json` `"type":"module"` makes Vercel run every api/ function as
  native Node ESM; extensionless imports compile fine (`tsc` uses bundler moduleResolution and
  `vite build` only builds the frontend — neither runs api/ through Node's ESM resolver) but
  throw `ERR_MODULE_NOT_FOUND` at Lambda startup. `tsc` maps `.js` specifiers back to `.ts`
  source at build time, so the fix is zero-friction. Imports from node_modules are unaffected.

- **`src/lib/api.ts` already prefixes `BASE = '/api'`** — callers must pass the path **without** a leading `/api` (e.g. `api.post('/send-welcome')`). Passing `/api/send-welcome` produces `/api/api/send-welcome` (404) — silently swallowed by a `.catch(() => {})`. Always check the helper before writing a new call.

- **A Vercel environment-variable change only takes effect after a redeploy.** Adding or rotating a secret in the Vercel dashboard does not hot-reload running functions. Trigger a redeploy (push a commit, or use the Vercel dashboard "Redeploy" button) immediately after any env-var change and confirm the new deployment is READY before testing.

- **`api.post` / `api.get` throw `new Error(rawResponseText)` on non-2xx.** To extract a typed error code in a component: `JSON.parse(err.message)?.error`. This is the only safe pattern — the error body may not be valid JSON (network errors, Vercel 5xx HTML), so always wrap in try/catch with a JSON.parse guard.

- **Guests have no auth session — `src/lib/api.ts` attaches the logged-in Bearer.** Guest-page calls to token-gated endpoints (e.g. `api/guest-details`, `api/guest-message`) must use plain `fetch()`, NOT `api.get()` / `api.post()`. Using `api.get` from a guest page would send a null/empty Bearer header — the endpoint would behave differently from its intended unauthenticated path.

- **LocationIQ geocoding (S19).** `api/_lib/geo.ts` uses the EU endpoint `eu1.locationiq.com/v1/search?key=…&q=…&format=json&limit=1`. The response is a JSON ARRAY; lat/lon come back as STRINGS and the longitude field is `"lon"` (NOT `"lng"`) — parse with `Number()` + `Number.isFinite` guards on both. The key sits in the URL, so the function must stay SILENT (no logging on any path). Free tier ≈ 2 req/sec; the module-level rate gate spaces request START times ≥550ms so concurrent fan-out callers (guide, host-picks) throttle automatically with no caller changes. Best-effort, never throws, returns null on every failure.

- **Logged-out landing reads DB values via a service-role endpoint, not RLS.** anon can't read `plans` or `app_settings`; expose only marketing-safe fields through `api/public-pricing.ts` — same pattern as `guest-availability`.

- **Vercel strips `s-maxage`/`stale-while-revalidate` from the browser-facing `Cache-Control`** (edge honours them; client sees only `public`). The authenticated Vercel MCP fetch ALSO bypasses the CDN cache (always MISS) — verify caching from a real browser. A new deploy purges the edge cache. With `s-maxage=60`, admin edits surface on the landing within ~1 min.

- **Windows PowerShell dev-env gotchas (setting Vercel env vars locally).** `npx` can fail with `npx.ps1 cannot be loaded` (unsigned script) — fix once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or call `npx.cmd`. In PowerShell `curl` is an alias for `Invoke-WebRequest` (different flags) — use `curl.exe` for real curl. Inline `-d '{json}'` mangles quotes in PowerShell — write the body to a file and pass `--data "@file"`. A Vercel env-var add needs a redeploy (`npx vercel redeploy <url>`) to take effect. **(Jul 27 2026 addendum)** `npx.ps1` can STILL be blocked under `RemoteSigned` when the file carries the downloaded-from-internet flag — use `npx.cmd` or `Unblock-File`.

- **Vercel "sensitive"-flagged env vars cannot be pulled — `vercel env pull` returns them EMPTY (Jul 27 2026).** So a manual cron trigger that needs `CRON_SECRET` (marked sensitive) is NOT possible from a fresh machine — you cannot reconstruct the `Authorization: Bearer <CRON_SECRET>` header the cron guard requires. **Verify a scheduled cron ran by reading its RUNTIME LOGS (Vercel MCP / dashboard), not by manually curling the endpoint.** Same trap applies to any sensitive secret (Viator/Tiqets keys) — they're write-only once set.

- **`overflow-auto` DOES NOT MEAN THAT ELEMENT SCROLLS (Aug 12 2026).** An element scrolls only
  if it can be SHORTER than its content. `Layout`'s root is `flex min-h-screen` — a **MINIMUM** —
  so `<main class="flex-1 overflow-auto">` stretches to at least its content height and its
  `scrollTop` is permanently 0. A `<main>`-targeted route scroll-reset SHIPPED and was a silent
  no-op; `window.scrollTo(0, 0)` is correct here. **The tell was in the same file:** a SIBLING
  sidebar with `md:sticky md:top-0` can only pin the way this dashboard actually behaves if the
  DOCUMENT scrolls. Checking that `overflow-auto` is present is not checking who scrolls.

### Method & process

- **FIXTURE DATA INVENTED FOR A MOCKUP IS NOT EVIDENCE ABOUT PRODUCTION (Aug 18 2026).** A comp's
  sample bookings were described to Udy as "the real Sweet home calendar". **They were invented.**
  No booking named Maria has ever existed, and Sweet home's 21 Aug is FULLY booked rather than the
  half-day the claim implied. **The comp itself was fine — a mockup needs fixtures.** The defect was
  the SENTENCE around it, which made a checkable claim about live data that was never checked, and
  which a reader would reasonably act on. **LABEL COMP FIXTURES AS FIXTURES, and derive any "try
  this on <apartment>" instruction from a QUERY, never from the picture.** Same class as the
  address-is-not-a-human error closed the same day: both dressed an assumption as an observation.

- **A MIRROR'S EXISTENCE IS EVIDENCE THAT THE GATE GUARDING IT PASSED (Aug 18 2026).** The
  stripe-webhook ignores any subscription whose `metadata.app !== 'arrivly'`, and that metadata
  could not be read — every Stripe var is Sensitive-flagged in Vercel and pulls EMPTY, the
  `CRON_SECRET` trap again. But `hosts.current_period_end`, `tier` and `subscription_status` are
  written ONLY by that webhook, and all five sandbox rows carry them — **so the gate passed for all
  five, proved without ever reading the field it tests.** **Generalise: when an upstream check is
  unreadable, look for a downstream artefact that only exists if it passed.** Weaker than reading
  the source, and it must be stated as inference — but it is a real answer where "unverifiable"
  would otherwise stand.

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

- **A QUALIFIER BELONGS INSIDE THE CLAIM STRING, NOT IN THE PROSE AROUND IT (Aug 11 2026).** `Landing.tsx` scopes its hero earnings figures with a 15px parent that precedes them in DOM order; `AuthShell`'s DOM order is reversed, so the claim was made **self-qualifying** instead — "and on Portfolio, you earn", qualifier and claim in the SAME text node at the same font size. **Prominence parity then holds by construction and cannot decouple under a later CSS change**, which a parent-prose or caption qualifier can. Prefer this form for any quantified claim. Corollary from the same commit: fixing the shared `AUTH_POINTS` default covered all **five** AuthShell render surfaces (Login, Signup, ResetPassword, Demo, CompleteProfile); a per-caller fix would have left four stale.

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

- **A SCRIPT THAT MUTATES IN MEMORY AND WRITES ONCE AT THE END LOSES EVERYTHING IF A LATER
  ASSERTION THROWS (Aug 19 2026, AND AGAIN Aug 20 2026).** `eb13715` left two run-together bullets
  because the script carrying their fix aborted on an unrelated assertion before its single write.
  **It recurred the very next session** — a batch of six edits was discarded by one stale match
  string, after four of them had already been computed. The assertion is doing its job; the WRITE
  PATTERN defeats it. **Write after each independent edit, or accept that one failure discards the
  batch.**

- **CONTRAST IS COMPUTED, NEVER EYEBALLED — and the states that carry a component's POINT are the
  ones to check (Aug 19 2026).** In the availability picker the two failing states were DEPARTURE
  and ARRIVAL, i.e. the ENABLED ones a host must actually click, at **1.45:1** against a 4.5:1
  floor; the always-disabled FULL cells were WCAG-exempt and fine. Eyeballing had passed all of
  them. Compute the ratio and quote it.

- **AN ADDRESS IS NOT EVIDENCE OF A HUMAN (Aug 18 2026).** `anna.humalainen@gmail.com` reads like a
  person, so five sandbox subscriptions were carried for weeks as the file's only live deadline on
  the strength of that impression, and nobody asked. **Before recording an exposure that turns on
  who is on the other end, ask who is on the other end.**

- **iCAL FOLDS LONG LINES AT 75 OCTETS, CONTINUING THEM WITH A LEADING SPACE — SO A LINE-BY-LINE
  PARSER SILENTLY CAPTURES A FRAGMENT (Aug 21 2026).** `parseIcal` matched `/^KEY:(.+)$/m` and
  never unfolded, so Airbnb's DESCRIPTION — which folds mid-URL on every real reservation — yielded
  `…/hosting/reservations/de` and lost the confirmation code. **THE TRUNCATION WAS NEVER
  DESCRIPTION-SPECIFIC: it was cutting ANY folded field, and had been all along.** Nobody noticed
  because Airbnb's SUMMARY values are short enough never to fold. **AND THE DEFECT SHIPS LOOKING
  CORRECT: a short hand-written fixture does not fold, so it passes while every real feed fails.**
  A fixture that does not fold proves nothing — fold it on purpose, mid-token.

- **A QUERY STRING CANNOT SATISFY A "NEVER LOGGED" REQUIREMENT ON THIS PROJECT (Aug 21 2026).**
  `vercel.json` rewrites `/(.*)` to `index.html`, so the full query string is written into Vercel's
  EDGE ACCESS LOG **before a line of our JavaScript runs**. Client-side stripping afterwards is
  theatre — it cleans the address bar and nothing else. **A URL FRAGMENT is the only structural
  answer:** browsers never transmit it to a server and never place it in a `Referer`. When a
  requirement is "this value must never reach a log", the question is not what our code does with
  it, but **whether the value ever crosses the boundary at all.**

- **NEVER COPY LIVE FEED OR BOOKING OUTPUT FROM CHAT INTO A PROMPT, FIXTURE, DOC OR MEMORY — THE
  REPO IS PUBLIC (Aug 21 2026).** A real Airbnb VEVENT, carrying a live confirmation code, real
  last-4 phone digits, a real UID and real stay dates, was pasted into a build prompt this session
  and became a test fixture. The security gate blocked the commit. **Then the FIRST replacement was
  a CASE-FOLDED version of the real code — and case-folding is NOT de-identification: the full
  entropy is preserved and it is reversed by typing it in upper case.** The tell is that the value
  still looks random beside fixtures that look invented. **Fabricate the whole thing; keep only the
  SHAPE.** git objects do not expire, and a committed fixture is a permanent carve-out from the
  published 30-day guest-identity retention promise.

- **A WRITE-BOUNDARY FIX MUST BE REPEATED AT EVERY WRITER, FOREVER — INCLUDING WRITERS THAT DO NOT
  EXIST YET. A READ-BOUNDARY FIX IS DONE ONCE (Aug 22 2026).** `guests.first_name` is interpolated
  raw into the guest-chat system instruction at `guest-access.ts:200`, outside the nonce fence.
  `c0848d8` constrained the name at the NEW write path — correct and necessary, because that path
  moved the write from "authenticated host" to "anyone holding a confirmation code" — but two other
  writers remain and any future one starts unprotected by default. **Prefer the read boundary;
  keep the write-boundary check as defence in depth.** The same asymmetry decides where every
  future sanitiser belongs.

- **A PROMPT SENTENCE IS A HINT, NOT A MECHANISM (Aug 22 2026).** `f113943` added a generalised
  CODES rule to `bulk-import`'s prompt, which lowers the FREQUENCY of a code reaching a public
  extras row and changes the BOUND not at all. The mechanism is `scrubCredentialSentences`, applied
  in code before the insert — and that endpoint still has none. **Record the difference explicitly
  wherever a prompt rule stands in for a missing check**, because the realistic failure is not a
  reader believing the path is safe: it is someone triaging the queue, seeing a shipped rule with a
  passing test, and deprioritising the mechanism.

- **VERIFY THE PALETTE AGAINST SHIPPED SOURCE, NEVER AGAINST A REMEMBERED SPEC (Aug 22 2026).** A
  build prompt this session specified a DARK host card (`#1c1c1a`, `bg-white/10`); the shipped
  dashboard is the CREAM workspace, exactly as this file's Design System records. Claude Code
  checked the neighbouring components, overrode the brief and said so. **NEITHER GATE COULD HAVE
  CAUGHT THIS** — a wrong palette is not a security finding and not a correctness bug, so it would
  have shipped as the only dark surface in the workspace. **Design-system claims need the same
  "check it at the source" discipline as environment facts.**

- **TWO PROMPTS TEACHING THE SAME CONCEPT WILL DRIFT, AND THE DRIFT STARTS IMMEDIATELY
  (Aug 22 2026).** In `f113943` a clause diverged **on day one** — "never a code or A utility"
  against the importer's "never a code or utility" — inside a paragraph whose own comment declared
  it copied verbatim. **The fix that holds is a WHOLE-BLOCK equality test against the other
  prompt's LIVE value.** Sampling sentences is blind to the failure shape that actually occurs,
  which is "added to one side only" — precisely how `3417e01` left this gap in the first place.

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
3. **Dependency triage — the current figure is GitHub's 16 (8 high, 8 moderate) as of the 18 Aug push**, unreviewed; the runtime-reachability analysis is in queue item 4. **Older counts in this file (Known notes' 8, and a since-deleted 7 on `d254df9`) are SUPERSEDED, and the gap between them was never drift** — GitHub counts one alert per advisory per manifest path while `npm audit` dedupes per package, so the two tools measure different things. Precedes the pentest gate.
4. **Pentest / "hacker" agent gate** — runs once on the Tiers 1-3 surface. Phase F needs its own second pass before Tier 4 is sold.
5. **~~Sandbox subscriptions mail real people~~ — NOT A BLOCKER. CLOSED 18 Aug 2026:** none of the five addresses belongs to a real person (confirmed by Udy), so there is no one to mail. The measured dates are kept in OPEN ITEMS as fact; the exposure they described does not exist. **It was carried for weeks on the strength of an address LOOKING personal.** With it closed, the **16 Oct 2026 `gemini-2.5-flash` shutdown is now the file's only live dated deadline** — and unlike this one it has a decided route (option A).
6. **Written multi-tenant confirmation from GetYourGuide and Tiqets.** Tier 3 sells "connect your own account" for both. That clearance is currently OUR terms reading, not theirs. Viator ruled NO on the identical question on 4 Aug 2026 after the same self-assessment said probably yes. Selling a tier on an unconfirmed permission is the risk; asking costs one email each.
7. **Stripe LIVE flip — LAST.** Also then: enable Supabase leaked-password protection.

> Full workstream, all ten gaps and the document status: docs/legal-workstream.md.

## On the horizon / next steps

### OPEN ITEMS — PRIORITY CHANGES (Aug 4 2026)

- **Tier names DECIDED and shipped (`7d69fa6`, 12 Aug 2026): Starter / Growth / Portfolio / Pro.**
  Tier 4 shows "Pro (full booking)" via a `descriptor` FIELD, never folded into `name` — `name` is
  what billing emails and webhook alerts mirror.
- **WATCH `src/lib/tierCopy.ts` — it feeds `/choose-plan`, the actual point of payment, and today carries NO earnings claim.** Any earnings bullet added there lands directly on the payment page and would need the tier qualifier in the string itself. The precise form to copy is `Landing.tsx:64` — "Keep 100% of GetYourGuide &amp; Tiqets commissions — paid to you directly" (both axes scoped in one string). Related residual: `EarningsPanel.tsx ~301` is unqualified but sits in `confirmedCard`, which renders only when `confirmedCount > 0` — never in production today.
- **Welcome share panel shipped (`8ff40e5`); Part 2's STAY TIMELINE was not built** — see
  docs/design-backlog.md.
- **RUN `api/backfill-canonical-city` BY HAND** — GET with `Authorization: Bearer <CRON_SECRET>`. Idempotent. On no schedule. Watch `resolvedNoKey`: a city that resolves with no valid country code stays on the per-apartment path. **HALF DONE — RE-COUNTED AGAINST THE LIVE DB 18 Aug 2026: the fleet is NINE visible apartments, not ten.** 4 of 9 carry a `canonical_city_key` and 4 have been attempted, across 8 distinct cities; the rest have `canonical_resolved_at` NULL = never attempted. **⚠ BUT THIS IS NOT CURRENTLY DOABLE:** `CRON_SECRET` is flagged **Sensitive** in Vercel, so its value cannot be read back and the Bearer header cannot be reconstructed — see the CRON_SECRET lesson below. This item is blocked on that decision, not on effort.
- **PRE-LIVE — OBTAIN WRITTEN CONFIRMATION FROM GYG AND TIQETS ON MULTI-TENANT HOST-OWN-ID.** Udy's own terms review (11 Aug 2026) cleared BOTH to keep host-own-partner-ID on Tier 3, and the code ships that way. **But note the EVIDENCE CLASS: that is a self-assessment, not a provider ruling.** For Viator we hold a written answer from Partner Support; for GYG and Tiqets we hold our own reading. **Viator is the proof that the two differ** — the terms were read carefully, the risk was spotted, the question was asked anyway, and the answer came back NO. Send the same question to both **before the Stripe live flip**, so a paying Tier-3 host is never sold a connection a provider later refuses. **Tiqets first — it uses the same partner-ID substitution shape (`partner=`) that Viator prohibited.** Contacts parked in PHASE I. If either answers no, Tier 3 needs repositioning, not just a code change.
- **~~SANDBOX SUBSCRIPTIONS MAIL REAL PEOPLE~~ — CLOSED 18 Aug 2026**, on the ground that
  none of the five addresses belongs to a real person. The measured `current_period_end`
  dates and the reasoning moved to **docs/resolved-debt.md**. The lesson it produced — an
  address is not evidence of a human — is in Lessons and stays there.
- **THE QUEUE (updated 22 Aug 2026). In order:**
  1. **~~The four UI items~~ (`60a4c2b`), ~~the category cleanup migration~~, ~~the listing
     importer~~ (`3417e01`), ~~the PRE-ARRIVAL PERSONAL GUEST LINK~~ (`13eaaf3` / `c0848d8` /
     `ed92ad2`) and ~~bulk-import's offering-routing clause~~ (`f113943`) — ALL DONE, pushed and
     deploy-verified. **~~The service-worker reload that aborted the claim~~ (`118d05f`) — DONE,
     and its acceptance test has since PASSED on the controlled path.****
  2. **NEXT — `bulk-import` HAS NO CREDENTIAL SCRUB, AND THIS CLASS OF FAILURE HAS ALREADY
     OCCURRED ONCE.** MEASURED at source 22 Aug 2026, not inferred: `api/bulk-import.ts` matches
     `scrubCredentialSentences` exactly TWICE and **both matches are COMMENTS** — zero real calls —
     while `api/_lib/import-listing.ts` calls it THREE times (lines 350, 394, 429). bulk-import
     writes **`is_private: false` on EVERY row**, so a door code that slips past the model on the
     old paste-a-wall-of-text path is **anon-readable on the guest page**.
     **`993fa3d` EXISTS BECAUSE A CODE LEAKED INTO PUBLIC EXTRAS ON A LIVE RUN — and the scrub
     written in response was wired into ONE DOOR ONLY.** `f113943` added a generalised CODES
     sentence to bulk-import's prompt, and that helps, but **A PROMPT SENTENCE IS A HINT, NOT A
     MECHANISM.** The fix is **one import and one call before the insert** (the function is already
     exported), and the disposition is **SUPPRESSION, not relocation**, because this path never
     writes `entry_instructions`. **It currently lives ONLY in `f113943`'s commit message, which is
     the weakest place for it — that is why it is here.**
  3. **RESIDUALS FROM `118d05f`, recorded so they are not rediscovered as bugs.** (a) A genuine
     worker UPDATE arriving mid-claim still reloads and still aborts the POST — seconds long,
     only after a deploy; closing it means coupling `main.tsx` to `WelcomePage`, which is why it
     was not. (b) A tab loaded via HARD RELOAD bypasses the SW and starts uncontrolled with no
     claim event, so it spends its latch on the NEXT deploy's worker and picks up the one after.
     **Bounded, never permanent** — nothing serves stale, `sw.js` being network-first for
     navigations.
  4. **PHASE H — PRE-ARRIVAL / GUEST PAGE VISUAL PARITY. The two pages read as different
     products.** Measured, not impressionistic: `GuestPage` has a full-bleed photo hero
     (`hero_image_url`, scrim, Unsplash credit, the host-upload → city-image → default fallback
     chain) and `WelcomePage` has **NO IMAGE** — a centred logo on cream. **That is the biggest
     gap, and the data is already loaded.** `GuestPage` also has the bottom tab bar
     (Home/Chat/Explore/Settings) where `WelcomePage` is one long scroll · quick-access tiles
     (WIFI/DOOR/HOME) where it has none · and the PWA install prompt, which `WelcomePage` does
     NOT offer — **arguably backwards, since the pre-arrival page is the one a guest holds for
     weeks.** Accent branding IS already consistent across both.
     **OPEN DESIGN QUESTION, not a bug:** does `WelcomePage` adopt the tab shell (Home/Explore/
     Chat all work pre-arrival, with WIFI/DOOR rendering LOCKED), or stay a single scroll?
     **Mockup-first.**
  5. **TEMPLATE COPY — add a reassurance line before the link in `sharePlatforms.ts`,** so a
     guest expects Airbnb's "You're leaving Airbnb" interstitial instead of bouncing off it.
  6. **PRIVACY QUESTION — RECORD, DO NOT ACT.** The welcome page shows the property's STREET
     ADDRESS, and that page is public to anyone holding the welcome code. **Pre-existing
     behaviour, but the pre-arrival link makes that page far more widely shared.** Decide
     deliberately rather than by drift.
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
- **NOT VERIFIED, and do not let this be read as covered: whether a link is CLICKABLE once
  actually SENT to a guest** (everything was observed in Airbnb's composer, not in a delivered
  message) · **Booking.com** · **Vrbo**. The latter two ship as a `verified: false` record that
  structurally cannot render steps.

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
- A `demo-create` cooldown was NOT built (secondary surface: Turnstile + one-demo gated).
  Fail-closed reconsideration remains a recorded non-blocking option.
- **CLAUDE.md SIZE — THREE STANDING RULES.** (a) **DELETE a superseded claim** rather than
  striking it through and explaining it — git holds the correction. (b) **ONE pointer per moved
  BLOCK, never per item**, or the pointer costs half the saving. (c) **When this file passes
  ~140,000 chars, RESTRUCTURE rather than trimming** — split on LIFETIME (invariants and live work
  stay; reasoning trails go to purpose-named files under `docs/`), because the one-record rule
  caps the RATE of growth, not the DIRECTION. Working limit 150,000. **Restructured 10 Aug 2026
  and again 18 Aug 2026.**- **OPEN — STEP 7 / SELF-ATTACK DRILL (argued in `cron-sync-ical.ts` + commits):** `ok` = "no
  failure recorded", NOT "work was done" — two in-code empty-success paths (deadline-adjacent,
  window = one **POOL-WIDTH**; the SILENT no-`https://` path), not exhaustive. Alarm is
  **single-success-suppressible**, never the sole iCal health signal. Cron ignores
  `result.capped`. ntfy is a third consumer of `deferred + ok + failed === apartments.length`.
  `PropertySetup.tsx`'s "Calendar synced" toast hides the strings (UI, mockup-first).
- **OPEN — CITY COMPRESSION MEASURED, NOT PROJECTED (Aug 8 2026), and it is WEAK EVIDENCE.** The
  fleet is **NINE VISIBLE apartments across 8 cities** (re-counted live 18 Aug 2026 — the earlier
  "10" was wrong), Helsinki the only city with more than one. Fully backfilled the cron would run
  **8 units for 9 apartments — about 1.1x compression, NOT a multiple.** **CAVEAT, and it is the
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
- STILL OPEN on the detector: **NO CRON HEARTBEAT — "never ran" remains undetectable as a CLASS**,
  and that is what this item is for. **CORRECTION 18 Aug 2026: the guide cron HAS RUN — the earlier
  "has still never run" clause was FALSE.** `guide_recommendations` shows three apartments
  refreshed **15 Aug 10:00:18-10:00:29 UTC**, matching the `0 10 * * *` schedule, and it has
  correctly IDLED since: all nine visible apartments now sit inside the 25-day freshness gate
  (oldest 29 July against a 24 July cutoff). **THE 15 AUG RUN COMPLETED ITS QUEUE rather than
  stopping at the deadline, so 3/run is a LOWER BOUND on throughput, not a capacity measurement**
  — the "~2/run x 25 days ≈ 50 apartments" figure in RESIDUALS therefore stays an ESTIMATE and must
  NOT be upgraded to a measured value. The failure ntfy still covers "ran and failed",
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
- **STILL OPEN from the guide-cron bounding (`ec66829`): skip EXPIRED HOSTS, and LOG
  OUTCOMES.** Neither shipped with the deadline/freshness/oldest-first work, and the second
  is the same gap as the missing failure alarm below — a run that does nothing is currently
  indistinguishable from a run that did everything.
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

## AI MODELS — provider assignment, keys, and the one dated fact
`gemini-2.5-flash` shuts down **16 Oct 2026** and is already refused to new Google Cloud projects. **ONE SURFACE STILL DEPENDS ON IT, so the deadline is REAL and dated** — the older "no surface depends on it" claim was FALSE. `api/guest-chat.ts:9` runs `gemini-2.5-flash` on `GEMINI_API_KEY_CHAT`, verified in source; it is the only Google dependency left, on the AI Studio FREE tier with no card, so it cannot bill.

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

## Session — 22 Aug 2026 (the pre-arrival personal guest link, shipped in three commits, plus the bulk-import offering clause — HEAD f113943)

**FIVE COMMITS. The feature is complete end to end, and the fifth is the one that made it
actually work for a guest.**

- **`13eaaf3`** — iCal LINE UNFOLDING + capture of the platform's own booking reference into
  `bookings.platform_ref`. **VERIFIED LIVE against a real Airbnb feed AFTER the deploy:
  13 of 13 current-or-future reservations carry a code, every one 10 chars, all distinct, all
  matching `^[A-Z0-9]{10}$` · 0 of 52 blocks and 0 of 19 past reservations, both CORRECT —
  Airbnb exports only current and future events, and a block is not a reservation. Zero
  contaminated rows.**
- **`c0848d8`** — `api/welcome-claim.ts` + `api/_lib/welcome-claim.ts` (public claim endpoint),
  `WelcomePage` fragment read/strip and the three guest states, `ROLLING_LIMITS` registration.
- **`ed92ad2`** — `sharePlatforms.ts`, the two-part Airbnb card, the conditional `ensureUrl`,
  the "Guest identified via link" chip.
- **`f113943`** — bulk-import learns what an offering is (the clause `3417e01` left behind).
- **`118d05f`** — **A LAUNCH-BLOCKING DEFECT FOUND AFTER THE DOCS COMMIT, during live testing:
  the pre-arrival link did not work for ANY first-time visitor.** `public/sw.js` calls
  `self.clients.claim()` unconditionally on activate and `src/main.tsx` reloaded on every
  `controllerchange`, so a FIRST visit always self-reloaded — aborting the in-flight claim POST
  and reloading a URL that no longer carried the hints, because `WelcomePage` strips them during
  first render. The second load saw no hints and rendered the ordinary welcome page.
  **PRE-EXISTING, NOT NEW: a QR link carries its data in QUERY PARAMETERS, which survive a
  reload; a fragment does not.** The spurious reload had been shipping for a long time and was
  harmless until something depended on in-flight state. `GuestPage`'s first-visit
  `/api/guest-state` fetch was latently exposed to the same abort and is now also protected.
  **FIX:** `navigator.serviceWorker.controller` sampled at MODULE EVALUATION — read inside the
  handler it always observes the NEW controller, so the guard could never fire — and the guard
  **LATCHES** rather than returning forever, so a genuine update later in the same tab still
  reloads it. `sw.js` unchanged. 19 lines, `src/main.tsx` only; reasoning in the commit message.

**WHAT WAS VERIFIED LIVE, ON UDY'S OWN AIRBNB ACCOUNT, 21 Aug 2026 — and this is the evidence
the whole design rests on, so do not re-derive it from memory:**
- **Shortcodes CANNOT be typed or pasted.** They are inserted from an "Add details" menu inside
  Airbnb's editor, so a pasted template arrives as dead literal text. **That is why no
  copy-the-whole-thing button can exist for Airbnb** and why its card is guided.
- **The check-in DATE chip is DEAD.** It renders as a human-readable string with spaces and a
  comma, which TERMINATES a URL, and it is LOCALISED, so it breaks differently per language.
- **The confirmation-code chip renders as an unbroken uppercase-alphanumeric run** and inserts
  mid-URL cleanly.
- **A `#` fragment survives that insertion intact.**
- **A plain link saves in a scheduled message with no error.**

**AND VERIFIED ON A SENT MESSAGE, 22 Aug 2026 — this was previously the stated gap and is now
closed:** Airbnb DOES linkify a `bemgu.app` URL in a delivered message (underlined, tappable) ·
tapping shows an interstitial — warning triangle, *"You're leaving Airbnb — make sure you trust
the source before continuing"*, **Back to Airbnb** / **Continue to bemgu.app** · **THE FRAGMENT
SURVIVES both the linkifier and that interstitial redirect**, confirmed by a completed
`POST /api/welcome-claim` from the tapped link.

**STILL NOT VERIFIED: Booking.com · Vrbo.** Both ship as a `verified: false` record that
structurally cannot render steps.

**THE ACCEPTANCE TEST `118d05f` LEFT UNRUN HAS SINCE BEEN RUN, against production in a real
browser, and PASSED:** `POST /api/welcome-claim` 200 (completed, not aborted) · exactly ONE
`GET /api/welcome` 200 · `guest-bootstrap`, `guest-state`, `guest-details` all 200 · final URL
`/guest?apt=…&token=…`. No aborted requests, no second load. **CAVEAT: that profile ALREADY had
the service worker installed, so it exercised the CONTROLLED path. The genuinely UNCONTROLLED
first visit is covered by the guard's logic but has NOT been observed.**

**THE REAL PROPERTY IS NOW LIVE — "Beautiful private space in Helsinki center"** (welcome code
`PDQV8ATW`, Helsinki, created 22 Aug 2026), Airbnb feed connected. **Measured in the DB, not
recalled: 13 of 13 Airbnb reservations carry `platform_ref`, and 5 of 5 blocks correctly carry
none.**

**THE GATES CAUGHT SEVEN MUST-FIX ITEMS ACROSS THE THREE BUILD COMMITS, and the pattern in them
is worth more than the list.** Every one was invisible from the design and visible only in the
diff: a brake that a single trailing space made completely inert (the bucket label came from the
raw code, the matcher from the trimmed one) · an unauthenticated caller able to write 40
arbitrary characters into the guest-chat SYSTEM INSTRUCTION · a missing expired-subscription gate
inherited by copying `api/welcome.ts`'s frame but not its billing check · a brake that left NO
ARTEFACT, so a guessing run would have been unobservable afterwards · a display path that routed
around `ensureUrl`, so a message saved on Airbnb and copied for email went out with no link at
all · a save reporting success PostgREST never confirmed · and a test fixture that was VERBATIM
LIVE GUEST DATA in a public repo.

**THE HONEST SECURITY ARGUMENT FOR THE CLAIM ENDPOINT IS `platform_ref` ENTROPY, NOT THE BRAKE**
— Airbnb's 10-character code is ~3.7e15, which no online attack reaches. The brake is a speed
bump; the persistent victim-keyed counter is the detector. Recorded in the file, because a
future reader will otherwise assume the brake is the control. **The 8-character floor the
validator accepts is only 1e8, so no second writer of `platform_ref` may be added without
redoing that analysis.**

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

> Full mechanism and history: docs/spend-hardening.md.

### PRE-LIVE ADDITIONS from this session (add to the pre-live checklist)

- **NEW 22 Aug 2026 — THE HELP-DRAWER REFRESH, deliberately LAST so it is written ONCE.**
  `src/guide/content.ts` feeds **both the drawer AND the help chat**, so one edit updates both.
  It still describes an older product. Bring it up to date with everything shipped since, in ONE
  pass: the listing importer · `apartment_source_docs` guest-chat knowledge · AvailabilityPicker +
  cancel-from-calendar + the cancelled-conversation chip · the city-events DB cache and host
  refresh · the experience marketplaces and earnings · the welcome/share panel · PWA install · and
  the pre-arrival link.
  **THE SPLIT THAT AVOIDS DRIFT, and it is the point of doing it last:** the **SHARE PANEL holds
  the authoritative STEPS** — they are DATA in `sharePlatforms.ts`, so they change with the
  platform — while the **DRAWER explains WHAT the feature is, WHY the link is shaped that way,
  what a finished link looks like, and what to do when it goes wrong.** Two copies of the steps
  would drift within a session; this session proved that twice.
- **NEW 22 Aug 2026 — A PASTE-BACK CHECKER. Proposed, NOT built.** A host pastes their finished
  link and the app tells them whether it is right. **It catches the failure Airbnb's own forums
  are full of:** a host who TYPED the tag instead of inserting it from the menu, whose messages
  then go out reading "Dear guest first name". **HARD CONDITION, and it is not negotiable: it must
  run ENTIRELY CLIENT-SIDE — never sent to the server, never stored, never logged — because a
  RESOLVED paste contains a real guest's name AND their real booking credential.** A checker that
  posts the link for validation would recreate, on purpose, the exact exposure the fragment design
  exists to prevent.
- **NEW 22 Aug 2026 — THE CHIP'S TIMING GAP.** `link_claimed_at` is written only in the ACTIVE
  state, so **"Guest identified via link" appears on ARRIVAL DAY**, not when the guest first opens
  the link. Its stated purpose is TEMPLATE HEALTH, which wants a signal at PASTE time — a host who
  sets the template up in March learns nothing until someone arrives. **The earlier signal already
  exists in the data and needs no new column: an iCal booking that suddenly HAS a name got it from
  a link, because Airbnb iCal carries no names.** Not a defect; a follow-up.

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

