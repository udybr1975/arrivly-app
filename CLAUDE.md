# Arrivly — CLAUDE.md

> **Repo note (Jun 5 2026):** The canonical repo is now `udybr1975/arrivly-app`. The old `udybr1975/arrivly` is abandoned (server-side corruption: pushes rejected "missing necessary objects", Settings page 500s; GitHub support ticket open). Local working copy: `C:\dev\arrivly`. Vercel project `arrivly` is connected to `arrivly-app`.

## What is Arrivly?
Arrivly is a multi-tenant SaaS platform for short-term rental hosts. Each host sets up their property and gets a personalised branded guest page accessible via QR code. The guest page shows check-in info, WiFi, house rules, host picks, and an AI-generated neighbourhood guide.

**Pricing:** €19/property/month · 30-day free trial  
**Stack:** React 19 + Vite + TypeScript + Tailwind CSS · Supabase (auth + DB) · Vercel (host)  
**Repo:** https://github.com/udybr1975/arrivly-app (branch: master)  
**Supabase project:** ptkabdelgxkgfslfialx (eu-central-1)  
**Vercel project:** prj_0QUqUs4RqtLJu68IYGpk5KPTiaG6 · team: team_ez8n9ADnf76POLmcotzlykff  
**Admin email:** udy.bar.yosef@gmail.com  
**App URL:** https://arrivly.anna-stays.fi

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
| `/dashboard/settings` | Settings | protected |
| `/admin` | SuperAdmin | admin only |

## Database (Supabase)
- **hosts** — id (= auth.uid), name, brand_name, whatsapp, logo_url, accent_color, contact_email, country, city, neighborhood, street, street_number, lat, lng, plan, trial_ends_at, subscription_status, stripe_customer_id, stripe_subscription_id, push_endpoint, welcome_email_sent_at, trial_reminder_sent_at, tier (int, FK plans.tier), is_exempt (bool, default false), price_override_cents (int nullable), discount_percent (int nullable), discount_until (timestamptz nullable), property_cap_override (int nullable), created_at
- **plans** — tier (int PK), name, price_cents, max_properties (int nullable = unlimited), includes_booking (bool)
- **apartments** — id, host_id, name, country, city, neighborhood, street, street_number, floor_note, lat, lng, max_guests, description, images[], is_visible, accent_color, ical_urls, hero_image_url, city_image_url, city_image_credit, created_at
- **apartment_details** — id, apartment_id, category, content, is_private
- **host_picks** — id, apartment_id, name, category, address, lat, lng, note, display_order, created_at
- **bookings** — id, apartment_id, guest_id, check_in, check_out, status, reference_number, source, created_at
- **guests** — id, first_name, last_name, email, created_at
- **messages** — id, booking_id, apartment_id, sender_role ('guest'|'host'), body, created_at, read_at; RLS: `messages_host_all` scopes to host's own apartments via apartment_id
- **guide_recommendations** — id, apartment_id, neighborhood, categories (jsonb), generated_at
- **push_subscriptions** — id, host_id, apartment_id, booking_id, role, endpoint, p256dh, auth_key, created_at
- **guest_optins** — id, first_name, email, apartment_id, opted_in_at
- **app_settings** — id (always 1), trial_days (int, default 30), updated_at; RLS ON with zero policies (only service-role + SECURITY DEFINER trigger can read/write); `handle_new_user()` reads `trial_days` with hard fallback to 30 so a missing row never breaks signups. Change trial length: `update public.app_settings set trial_days=N, updated_at=now() where id=1;` (new signups only; existing hosts keep their dates). Future superadmin dashboard edits this row.

### Critical DB facts
- `apartments.accent_color` — NOT brand_color (common mistake, causes silent save failure)
- `apartments.ical_urls` — single text column, one URL per line, no limit (replaces old airbnb_ical_url)
- `bookings.reference_number` — is the guest token, used in QR URL
- `guide_recommendations` — always query with `.maybeSingle()` never `.single()`
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
All pricing and branding settings are in `src/config.ts`. Change there only.
Colour presets for BrandingPanel are in `ARRIVLY_CONFIG.colourPresets`.

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

**Host: Anna Banana** (udy.bar.yosef@gmail.com) — owns two apartments:
- **Sweet home** — id: `d9614d11-d573-4ff0-961a-54c5ea37c2bd`, Etu Töölö Helsinki, token: `ARR-SWEET1`. House rules AI-polished.
- **Test Apartment 1** — id: `aaaaaaaa-0000-0000-0000-000000000001`, Kallio Helsinki, accent #5a1a2a (Wine)
- **Casa Marco** — `d81e4e89-385a-4886-b461-ba952c78e7f8`, El Born Barcelona, token `ARR-BCN777` (booking 1–5 Jun 2026 ended → thank-you state, guest "Marco").
- **Maison Lumiere** — `d7f47672-fde5-4da1-91ae-0f9f774732fd`, Le Marais Paris, token `ARR-PAR777` (booking 3–12 Jun 2026 ongoing → active page, guest "Sophie"; has WiFi + rules + private check-in door code 4521).

**Host: Udyni** (udy.baryosef@jchelsinki.fi) — owns:
- **Penthouse in the sky** — id: `9b03a763-3ca6-4d1f-946c-d4e1f977d614`, token: `ARR-PENTH1`

**Test guest URL (Test Apartment 1):** `/guest?apt=aaaaaaaa-0000-0000-0000-000000000001&token=ARR-TEST01`

**Pending badge test-data cleanup:**
- 2 seeded unread guest messages — DELETE after badge testing:
  - `7cabced9-4c1e-4607-a00d-3deb755ccdb4` (ARR-TEST01, booking cccccccc-…-0001)
  - `3cfa4dc7-b72c-4a39-976c-669355fc14f0` (ARR-SWEET1, booking f803d95e-…)
- Date reverts pending: ARR-SWEET1 check_out → 2026-06-02; ARR-TEST01 → original 27–31 May (or delete).
- 3 guest push subs on ARR-SWEET1 (booking f803d95e) from push testing — old phone `fxoFeLto…`, new-phone tab `dPjCzkTFG…`, new-phone installed app `emdrm-rTQYM…`; decide whether to prune.

---

## Shipped (Sessions 1–8)

**S1–S2:** Scaffold + Supabase schema + all API stubs + all UI components (v1); full redesign to cream design system, all 12 screens, app live at arrivly.anna-stays.fi.

**S3:** GuestPage rewrite — token flow, 4 tabs (Home/Chat/Explore/More), weather widget (wttr.in), WiFi parser, private check-in gating (private `apartment_details` rows only shown to a guest with a valid confirmed booking token), host picks on Explore, AI guide on Explore, share bar, "Powered by Arrivly" footer, three terminal states: expired (token valid but dates past), neutral (no token), thankyou (opted in). BookingManager — add booking form (guest first name + dates → generates ARR-XXXXXX token, deduplication check), real iCal sync (unlimited URLs via `ical_urls` column — one per line; detects Airbnb/VRBO/Booking.com/Guesty/Hostaway/Lodgify, iCal UID deduplication, blocked periods stored as `*_block` source and rendered distinctly). `accent_color` bug fixed in BrandingPanel (was querying `brand_color`, silent save failure). DB migration: replaced `airbnb_ical_url` with `ical_urls` (text, one URL per line). `SUPABASE_SERVICE_ROLE_KEY` added to Vercel env vars.

**S4:** PWA icons shipped (icon-192, icon-512, maskable, apple-touch, favicon; manifest + index.html wired). `12fbb12` Geocoding wired into `PropertySetup.saveBasic` — `api/geocode.ts` (Bearer token auth forwarded by `src/lib/api.ts`, 3s AbortController timeout, 250-char input cap, generic errors only — iCal URLs can carry auth tokens so all error messages are scrubbed); dead `src/lib/geocode.ts` (unauthenticated duplicate) deleted; saveBasic shows a gentle notice if geocoding returns no coordinates, save always succeeds. `713b611` `api/rewrite-rules.ts` implemented (was a stub): POST `{ rawRules }` → `{ result }`; auth-gated; gemini-2.5-flash; 10s timeout; 5000-char cap; fallback to raw text on any failure. Note: gemini-2.0-flash retired by Google on 2026-06-01 (404s); migrated to gemini-2.5-flash. Guest page now renders rules stored at save time (no AI call per guest visit). `b6638d6`, `66cdfc6` Maps URL fix: canonical `getDirectionsUrl` helper in `src/lib/maps.ts` (`https://www.google.com/maps/dir/?api=1&destination=LAT,LNG&travelmode=walking`); deleted inline `mapsWalkingUrl` that used wrong path. `f315f45` **Security:** Supabase keys rotated to new API key format (`VITE_SUPABASE_ANON_KEY` = publishable key, `SUPABASE_SERVICE_ROLE_KEY` = secret key, legacy JWT-based API keys disabled, legacy HS256 signing secret revoked — triggered by a real key found in a local dirty `.env.example`; git history of `.env.example` was clean, no public leak). Google Geocoding API key rotated (restricted to Geocoding API only). `GEMINI_API_KEY` added to Vercel (Production) and `.env.local` — server-side only, no `VITE_` prefix. Housekeeping `c714e94`: `.env.example` sanitized to placeholders; `.gitignore` hardened (blocks `.env`, `.env.*`, preserves `!.env.example`); server-only `VITE_` type decls removed from `vite-env.d.ts`; generic geocode errors enforced.

**S5:** Per-property QR codes — `PropertyQRCard` child component; each card owns its own `canvasRef`; download filename includes property name; print matches image to URL. Multi-property editing — `PropertySetup` loads by URL param `/dashboard/property/:aptId`; guard redirects to `/dashboard` on missing/unowned apt (no data leak); form state resets on apt switch; `[aptId]` dep array prevents stale form; OnboardingFlow navigates directly to new property's edit page after creation. Dashboard real counts — Properties metric = real count; Bookings metric host-wide (`.in(aptIds)`); "Edit property" links to specific apt URL; "← Back to properties" link in PropertySetup. Overview consolidation — one rich card per property showing completeness %, Active/Draft pill, per-property booking count, QR/Preview/Edit buttons; `PropertyList.tsx` and bare `/dashboard/property` route removed; all redirects point to `/dashboard`. House rules auto-polish enforced on save — `saveRules` calls `/api/rewrite-rules`, falls back to raw on failure, updates textarea with stored result; manual "Rewrite with AI" button removed. PWA stale-cache fix — sw.js bumped to arrivly-v2; navigation + `/index.html` network-first (cache fallback offline); `/assets/` stays cache-first; unconditional `skipWaiting` removed; SKIP_WAITING message handler added; update-aware registration in main.tsx (reloads once on `controllerchange`, guards against first-install reload). PWA install prompt — `InstallPrompt` component (15s timer); Android one-tap via `beforeinstallprompt`; iOS Safari Share→Add instruction (Chrome/Firefox iOS explicitly excluded); dismissed state in localStorage; shown only on active guest page. Bookings multi-property — apartment dropdown drives list, calendar, iCal panel, and add-booking form; fixed `.limit(1)` single-property bug; cancellation flag prevents stale-request `setBookings` overwrites when user switches apartments quickly; `saveIcalUrls` now has `host_id` guard. Calendar month navigation — `cursor` state replaces frozen `new Date()`; ‹/› navigate via JS Date month±1 (year rollover automatic); today highlighted with ring in current month only.

**S6 — Push notifications:**
- `api/send-push.ts` — Bearer token → `getUser` (anon client); host-scoped by JWT (never trusts client-provided host_id); payload `{title,body,url}` must match sw.js push handler; prunes dead subs on 404/410. VAPID env vars in Vercel (Production): `VITE_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:udy.bar.yosef@gmail.com`).
- `api/_lib/push.ts` — `isPushConfigured()` (lazy singleton VAPID init) + `sendPushToHost(db, hostId, payload, apartmentId?)` (concurrent send; prunes 404/410 scoped by host_id+endpoint+role; never throws; url validated `startsWith('/')` or `https://`). `api/send-push.ts` refactored to delegate to this helper; external API unchanged.
- Host opt-in at `/dashboard/settings` — `subscribeToPush` returns `SubscribeResult` discriminated union (`unsupported | denied | no-key | subscribe-failed | invalid-subscription | save-failed`); clears existing PushSubscription before re-subscribing (fixes mobile `InvalidStateError` from stale/mismatched-key sub); all paths upsert `onConflict:'endpoint'`, rebinding host_id. `reaffirmSubscription(hostId)` called silently on Settings load — upserts current endpoint so a pruned DB row can't leave the toggle showing "on" while host receives nothing; hostId from server-verified `getUser()`, never localStorage.
- `subscribeToPush` key-reuse optimisation: reuses an existing PushSubscription when its `applicationServerKey` matches the current VAPID key (byte-compared), so Enable no longer mints a new endpoint and orphans the prior row each time. Key mismatch / unreadable → unsubscribe + fresh subscribe.
- `VITE_VAPID_PUBLIC_KEY` read server-side (send-push + _lib/push) is INTENTIONAL — it's the public key (browser-safe); Vercel exposes all env vars to functions regardless of prefix. The "fix it" reviewer note is a known false positive.
- New-booking push from `sync-ical` after `imported > 0` (best-effort, never breaks sync).
- **Cron triggers** — all guarded by `isCronAuthorized` (`api/_lib/cron.ts`, compares Authorization header to `Bearer <CRON_SECRET>`, fails closed if secret absent; Vercel auto-sends this header to paths listed in `vercel.json crons[]`):
  - `api/cron-checkout-reminder.ts` — daily `0 6 * * *`; queries `check_out = today UTC`, `status confirmed/completed`, excludes `*_block`, grouped per host; push body matches code, verified live to both devices. `5b01770`
  - `api/cron-trial-ending.ts` — daily `0 8 * * *`; hosts with `subscription_status='trial'` and `trial_reminder_sent_at IS NULL` whose `trial_ends_at` falls on the UTC calendar day exactly 5 days out; atomic `trial_reminder_sent_at` claim before sending (Lambda crash cannot cause double-send); computes real `daysLeft` from DB; sends push + Resend email; returns `{ok, eligible, pushed, emailed}`. `92113a1`, updated `3a77595`
  - `api/cron-sync-ical.ts` — monthly `0 4 1 * *`; service-role; iterates all apartments with `ical_urls`; aggregated push per host when new bookings land; global 30s maxDuration (needs batching before many hosts). `92113a1`
  - `api/_lib/ical.ts` — sync core extracted from `sync-ical.ts` (`detectSource`, `parseIcal`, `syncApartmentBookings`); `imported++` only on successful DB insert (no more false push on failed write); interactive route and cron share this one fixed core.
- **ESM hotfix** `0a1c9cd` — see Lessons. CRON_SECRET rotated after exposure during manual testing (`CRON_SECRET` can only trigger the three cron endpoints — no data read, no destructive action). Rotated again 2026-06-05 and redeployed.
- **Cron live verification (2026-06-02):** checkout-reminder confirmed end-to-end (real push to both host devices, body matched code); trial-ending verified via temporary trial-date nudge on test host (reverted after); sync-ical deployed and locked (real-feed import-triggered push still untested — needs a controllable test iCal feed, deferred). 401-without-bearer confirmed on all three endpoints. Push subscriptions churn correctly: installing the PWA invalidated the prior browser-tab subscription (FCM 410), which `sendPushToHost` auto-pruned; re-enabling inside the installed app registered a fresh endpoint. Notifications deliver with app closed and independent of an active login session.
- **Security fixes** — sync-ical now requires Bearer token + `apt.host_id === userId` ownership check (was unauthenticated service-role; `apartment_id` is public in guest URLs so anyone could inject bookings into any host's calendar — CRITICAL). Auth session-switch `79b4112`: global `signOut` → on error `signOut({scope:'local'})` + navigate to /login; Login.tsx `signOut({scope:'local'})` before `signInWithPassword` (auto-heals stuck sessions); try/finally.
- **Mobile layout** `263e0d3` — off-canvas hamburger drawer (top bar z-30, backdrop z-40, drawer z-50; closes on nav-link tap), static `md+` (desktop pixel-identical). a11y: `aria-expanded`/`aria-controls`.
- **App-open routing** `ce296a6` — `Landing` wrapper reads `getSession()` (local, fast, no flash) and redirects authenticated hosts to `/dashboard` (replace); `/dashboard` stays gated by PrivateRoute's server-validated `getUser()`. A `cancelled` flag guards setState-on-unmount under strict mode.

**S7:** Guide generation fix — `thinkingBudget: 0` in `api/generate-guide.ts`; Sweet home verified at 25 geocoded places across multiple categories. `de3eb37` Explore tab hardening — no longer caches an empty guide; retries on every tab switch until a non-empty guide loads; `cancelled` flag prevents stale setState on tab-switch during in-flight fetch. `95486d8` Service worker arrivly-v3 — cross-origin requests (Supabase, wttr.in, Google Maps) never intercepted or cached (guard at top of fetch handler: `if (url.origin !== self.location.origin) return`; no `event.respondWith` → passes to browser natively); cache version bumped to purge all stale v2 entries on activation; push handler `event.data.json()` wrapped in try/catch; notification URL validated before `openWindow` to prevent protocol-relative open redirect. `6238ae1` AI host picks endpoint — `api/generate-host-picks` + `api/_lib/host-picks.ts`: Gemini prompt identifies local picks by category → each candidate geocoded via `api/_lib/geo.ts` → returns ≤20 candidates with lat/lng + `located: boolean`, NO DB write (client reviews before inserting); auth-gated; apartment ownership verified (403 otherwise). `3da7e00`

**S8:**
- AI host picks UI — PropertySetup My-picks tab: free-text paste → `/api/generate-host-picks` (token via `api.post`) → editable candidate review list (name/category/address/note, 📍 located / ⚠ not-located indicator, remove) → "Confirm & add N" batch-inserts with `display_order` continuing from max; AI state reset on apartment switch (prevents wrong-apartment insert). Per-candidate "Re-locate from address": edit address → re-call `/api/geocode` (query string passed at call site, not closure; re-locate buttons serialise). Manual "Add a place" card removed (only saved `lat/lng = null`). `081f7eb`, `631d7c0`
- City events A3 — `api/city-events.ts` (replaced stub): city looked up server-side from DB (authoritative, never trusts a client-supplied city — proven with Helsinki + Barcelona test apartments); gemini-2.5-flash + googleSearch grounding (no `responseMimeType`; fenced-text defensive parse); `thinkingBudget: 0`; `maxOutputTokens: 4096`; 30s race-timeout; 3 retries; key-scrubbed logs; generated fresh on every open (no DB, no cron), next-7-days, "no past events"; prompt targets 10–15 events (integrity guard: include fewer rather than invent); returns `{ error: true }` on any failure. `EventsPage.tsx`: "This week in {city}" modal with loading/error/empty states; event cards are clickable links (official event page if model supplies one, else Google-search fallback); URLs sanitized to `http(s)` on BOTH client (`eventHref`) and server (pre-passthrough strip); mobile overflow fixed. `39ef5c9`, `0a22f04`
- Guest chatbot A4 — `api/_lib/guest-access.ts`: `resolveGuestAccess(db, apartmentId, token)` returns tier `verified` (token matches a confirmed/completed, in-dates booking for that apartment) or `public`, resolved entirely server-side; `buildGuestSystemInstruction` builds the prompt from `apartment_details` + `host_picks` + `guide_recommendations`, including private detail rows ONLY for the verified tier. This is the single seam Tier 2 extends (new tiers, email+reference) — no change to the endpoint or UI needed. `api/guest-chat.ts`: gemini-2.5-flash + googleSearch + `thinkingBudget: 0`; 2 retries × 20s timeout (≈43s worst case, inside 60s maxDuration); strips `**`; key-scrubbed logs. `ChatBot.tsx`: accent-themed bubbles, seeded greeting, persistent starter-question chips, auto-scroll, graceful error recovery. Browser sends only `{ apartmentId, token, message, history }`; all knowledge gating is server-side; public caller never receives private rows by construction. Verified on Sweet home `ARR-SWEET1`: greets guest by name, answers from private check-in/Wi-Fi details, grounded for neighbourhood. `5a53223`
- Phase B images — photo hero + accent scrim, accent section headers (`d2bbe37`); host logo upload (BrandingPanel) + per-property cover photo upload (PropertySetup) (`45e1c70`, `9dcc1f6`); Unsplash city default with attribution cached per property (`city_image_url` + `city_image_credit`) (`7da1c85`); Storage signed-URL upload fix via service-role key + `uploadToSignedUrl` in `api/create-upload-url.ts` (`72e8f41`). Auto-delete old hero/logo files on replace + remove shipped in Phase C prep (`1cde275`).

**S10 (2026-06-06):** Phase D1 superadmin dashboard — `api/admin-overview.ts` (GET, Bearer→`getUser`, email===`ADMIN_EMAIL` gate, service-role parallel queries for hosts+plans+apartments+bookings, computed `apartments_count`/`bookings_count`/`effective_price_cents`/`days_left`/`mrr_cents`, returns `{hosts,totals,plans}`). `src/components/admin/SuperAdmin.tsx` full rewrite: calls `api.get('/admin-overview')`, 6 metric tiles (total/trial/active/MRR/grace/expired), filter by status, sort by expiring/newest/name, exempt toggle ("Show my account"), host cards with tier+status pills + days_left (red ≤7) + disabled Impersonate placeholder (Phase D2), "Open my host dashboard →" link, `InstallCard`. `App.tsx` Landing: admin email → `/admin` redirect. `Layout.tsx`: "← Admin" nav link visible to admin only. Commit: `b8f41d5`.

**S9 (2026-06-05):** Transactional email (Phase C close-out) — Resend integration shipped and verified end-to-end. `api/_lib/email.ts` (Resend wrapper `sendEmail()` — never throws, scrubs key, `replyTo`; `welcomeEmail()` + `trialReminderEmail()` builders; sender `hello@anna-stays.fi`, reply-to `info@anna-stays.fi`). `api/send-welcome.ts` (Bearer-gated POST, atomic `welcome_email_sent_at` claim, recipient from DB only, fires fire-and-forget from `OnboardingFlow` at finish). `api/cron-trial-ending.ts` extended: atomic stamp before send, real `daysLeft` from DB, push + email. Dynamic trial length via `public.app_settings.trial_days` (DB-only, `handle_new_user()` reads with fallback 30). `CRON_SECRET` rotated and redeployed. Commits: `3a77595` (feat email) + `53e6460` (welcome path fix).

---

## Phase C — Communication (COMPLETE ✓)

### Done
- Storage auto-delete old hero/logo files on replace + remove (`1cde275`)
- `messages` table + RLS `messages_host_all` (migration: `create_messages_table`)
- `resolveMessagingAccess` in `api/_lib/guest-access.ts` + `api/guest-message.ts` — guest send/list, token-gated, server-resolved booking and apartment_id (`1856abb`)
- `api/host-message.ts` — host reply, Bearer auth, booking → apartment → host_id ownership chain, returns full thread (`bf56ea3`)
- Host Messages dashboard at `/dashboard/messages` — inbox grouped by booking, thread view with guest/host bubbles, reply box, two-pane desktop / single-col mobile (`a1399e0`)
- `api/guest-subscribe.ts` — public token-gated POST; service-role upsert to `push_subscriptions` (all IDs server-derived from resolved booking; guests cannot write direct — anon RLS blocks). `api/host-message.ts` extended: selects `reference_number`, `await sendPushToGuest(admin, booking.id, ...)` with `&msg=1` deep-link. (`69c01db`)
- Guest push subscribe UI (`8497496`) — `webpush.ts` refactored: private `acquirePushSubscription()` shared by `subscribeToPush` (host, direct DB) and `subscribeGuestToPush(aptId, token)` (POSTs to `/api/guest-subscribe`); `iosNeedsHomeScreen()` shared helper. First-message nudge in `MessageHost.tsx` (post-send, per-booking localStorage flag, `arrivly_guest_push_nudge_${token}`). More-tab permanent push control in `GuestPage.tsx` (state machine: loading/off/on/blocked/ios/unsupported; resets on each More-tab entry; no turn-off button — guests can't delete their RLS-blocked row). `&msg=1` deep-link: once-guarded effect → `setActiveTab('more')` + `setShowMessages(true)`; `MessageHost.onClose` lands on More tab.
- Unread badges (`c294bda`) — `Layout.tsx`: sidebar count pill on Messages nav + numeric host app badge (`navigator.setAppBadge(count)`); `countUnread` = exact head-count WHERE sender_role='guest' AND read_at IS NULL (RLS-scoped); refreshed on mount + 30s poll + visibilitychange + `arrivly:messages-read` window event. `Messages.tsx`: dispatches `arrivly:messages-read` after mark-read in `openThread` so Layout recounts live. `BookingManager.tsx`: per-booking dot on Upcoming + Past list cards (not calendar); also listens for `arrivly:messages-read` to clear dots live. `sw.js` bumped v3→v4; push handler sets guest DOT badge (`setAppBadge()` no-arg) for /guest URLs only; notificationclick clears it for /guest URLs only. `GuestPage.tsx`: `clearAppBadge()` on pageState=active, on &msg=1 auto-open, on "Open messages" click.
- PWA relaunch + push diagnostic (`3dbd8a8`) — Fix 1: `GuestPage.tsx` writes `arrivly_last_guest={apt,token}` to localStorage on the active guest page; `App.tsx` Landing redirects a NOT-authed standalone launch that has a valid saved guest to `/guest?apt=…&token=…`, so an installed guest opens their own page instead of the marketing landing. Fix 2: `webpush.ts` adds optional `detail?: string` to the failure result (subscribe error name+message / `missing keys` / `http <status>`); the GuestPage More-tab control and the MessageHost nudge surface it on screen. Reviewer W1 (clear stale detail on retry), W2 (non-Error throw guard), W4 (try/catch localStorage) applied. iOS caveat: installed-app storage is isolated from Safari, so Fix 1 works on Android, not iOS.
- Install-aware guest More-tab push + friendly failure copy (`3f9ceb6`) — `webpush.ts` adds `isStandalone()`; `GuestPage` `PushNotifState` gains `needs-install`; `computePushState` order ios→unsupported→tab(needs-install)→blocked/on/off; captured `beforeinstallprompt` for an in-More Android one-tap install CTA; once-per-booking first-launch auto-enable when standalone; raw `AbortError…` replaced everywhere with a friendly message (More-tab control + `MessageHost` nudge).
- Non-Chromium install fallback (`41eaece`) — Firefox never fires `beforeinstallprompt`; the guest needs-install no-button branch shows a Copy-link button + "best on Chrome" steer + Firefox menu line (keyed off `canInstall` only, no UA sniff).
- Host InstallCard in Settings (`738df0c`) — new `src/lib/useInstallPrompt.ts` (headless hook: `beforeinstallprompt` capture + `install()` + `isIOSSafari`, reuses `isStandalone()`); guest `InstallPrompt.tsx` refactored to consume it; new `src/components/host/InstallCard.tsx` rendered above the Notifications card, hoisted above the push-loading guard.
- Host-first installed-app routing + booking-scoped pointer + 'already installed' (`9450fe9`) — `App.tsx` Landing order: authed→/dashboard, valid saved guest→/guest, standalone(logged-out,no guest)→/login, else marketing LandingContent. `GuestPage` writes `arrivly_last_guest` on active, deletes on thankyou/neutral/expired. `useInstallPrompt` tracks `installed`; `InstallCard` shows "Arrivly is installed on this device".
- beforeinstallprompt early-capture + accurate Chromium fallback (`8cdfea1`) — inline `<head>` script in `index.html` captures `beforeinstallprompt`/`appinstalled` into `window.__arrivlyInstall` before the bundle loads; `useInstallPrompt` reads that global. Added `isChromium` (copy only): on Chromium with no one-tap offer, guide to the browser menu → Install / Add to Home screen instead of "open in Chrome".
- Transactional email (`3a77595`, path fix `53e6460`) — `api/_lib/email.ts` (Resend `sendEmail()` — never throws, scrubs key, `replyTo`; `welcomeEmail()` + `trialReminderEmail()` builders; sender `hello@anna-stays.fi`, reply-to `info@anna-stays.fi`); `api/send-welcome.ts` (Bearer-gated POST, atomic `welcome_email_sent_at` claim, recipient from DB only, rolls stamp back on send failure, fired fire-and-forget from `OnboardingFlow.finish()`); `api/cron-trial-ending.ts` extended: atomic `trial_reminder_sent_at` stamp before send, real `daysLeft`, push + email, returns `{ok, eligible, pushed, emailed}`; `api/send-email.ts` stays Tier-2 stub. `RESEND_API_KEY` env var (server-side, no `VITE_` prefix). Verified end-to-end: welcome stamped, day-25 reminder received at `udy.bar.yosef@gmail.com`.

**Phase C is 100% complete. Next: Phase D — Superadmin.**

---

## Known notes / minor debt
- Re-saving house rules re-polishes already-polished text (Gemini call on every save). Minor; acceptable for now.
- `BookingCalendar.tsx` is an unused stub; the real calendar is `CalendarView` inside `BookingManager.tsx`.
- QR scans metric on Overview still shows "—" (not wired to any data source).
- `api/stripe-webhook.ts` is a stub with NO signature verification — must implement before billing goes live.
- iCal fetch (`api/_lib/ical.ts`, used by both sync-ical and cron-sync-ical): mild SSRF (no
  private-IP/metadata blocklist on fetched URLs); no per-host rate limit. The monthly cron now
  exercises this unattended. Tidy SSRF + rate limit before public launch.
- `sendPushToHost` url check uses `startsWith('/')`, which also admits protocol-relative `//host` — only ever set from the host's own send-push request (self-targeted), so negligible.
- send-push `apartmentId` is not ownership-checked — latent only (lookup forces `host_id = userId`, so a foreign apartmentId matches zero rows).
- `api/guest-chat.ts` is public (guest-facing) with no rate limit — same posture as `city-events`/`generate-guide`; fold abuse/rate-limiting into Phase G hardening.
- Mobile drawer a11y follow-ups: Escape-to-close, focus return on close.
- Message retention: add ~90-day post-checkout cleanup job before public launch (Phase G).
- sw.js `showNotification().then()` — if showNotification rejects, badge is not set and the rejection is swallowed by `event.waitUntil`; low risk, standard SW pattern (W2, `c294bda`).
- `countUnread` in `Layout.tsx` called directly from event listeners with no mounted guard at call site — safe because `mounted` flag is closed over and listeners are removed on cleanup before it matters; no real bug (W3, `c294bda`).
- `BookingManager.tsx` `arrivly:messages-read` handler calls `loadBookings()` without a cancellation signal — tiny stale-overwrite race on rapid apartment switching; fold into next BookingManager change.

---

## Lessons / learnings

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

---

## Workflow

### Claude in chat vs Claude Code
Claude in chat NEVER pushes to GitHub. All code changes are delivered as Claude Code prompts pasted by Udy (run with `--dangerously-skip-permissions`). Claude uses GitHub/Supabase/Vercel MCPs proactively and reads the current file from GitHub before proposing edits.

### Agent policy
- Append the **code-reviewer** subagent to EVERY code-changing Claude Code prompt — read-only review before commit.
- Run **security-auditor** for any change touching secrets, auth, RLS, or API routes, and before every production deploy.
- **Docs-only prompts** (no code, no build) skip build validation and review agents.
- Use **debugger** only when stuck (~20+ min).
- Run **dead-code-cleaner** periodically; it writes a report and waits for approval before removing anything.
- Agents live in `.claude/agents/` and are invoked inside Claude Code by Udy.

### Config rule
All pricing and plan settings live in `src/config.ts` only.

### api/ ESM rule (Node runtime)
`package.json` is `"type":"module"`, so Vercel runs every api/ function as native
Node ESM. ALL relative imports inside api/ MUST include the `.js` extension
(e.g. `./_lib/push.js`, `./_lib/ical.js`, `./_lib/cron.js`). Extensionless relative
imports compile fine but throw `ERR_MODULE_NOT_FOUND` at runtime. Imports from
node_modules are unaffected.

---

## Roadmap to v1 (locked 2026-06-02)

Build order is A→G. Stripe/billing is intentionally late (per Udy): build the full product
first, switch on revenue near the end. Reorder only by explicit decision.

Locked product decisions:
- Guest↔host messaging: token-based, NO guest login/account. Guest messages from the guest
  page using their booking token. Install (add-to-home-screen) is NUDGED, not required — it
  enables push replies to the guest (mandatory for push on iOS). In-app messaging is the
  PRIMARY host↔guest channel; WhatsApp/email remain the un-installed fallback. System emails
  (trial reminders, receipts) are separate and stay.
- Guest-page city image: stock image API (mirror Anna's Stays' provider for licensing
  consistency). Host can override per-apartment via Supabase Storage upload.
- Design: every guest-page redesign starts as an inline interactive mockup for Udy to approve
  BEFORE any code.
- Superadmin impersonate: read-only "view as" snapshot served by the admin API — never a full
  session takeover — with a visible "viewing as" banner + audit trail. Money actions deferred
  until billing exists.

Phases:
- **A — Guest-page value:** COMPLETE ✓ A1 city guide (`de3eb37`), A2 host picks (`081f7eb`, `631d7c0`), A3 city events (`39ef5c9`, `0a22f04`), A4 guest chatbot (`5a53223`).
- **B — Guest look & feel:** COMPLETE ✓ Photo hero + accent scrim, logo/cover upload, Unsplash city default with attribution, Storage signed-URL fix. (`d2bbe37`, `45e1c70`, `9dcc1f6`, `7da1c85`, `72e8f41`)
- **C — Communication:** COMPLETE ✓ Messaging + push + badges + PWA install UX + transactional email (welcome + day-25 reminder). (`94e1fc0`→`53e6460`)
- **D — Superadmin:** D1 COMPLETE ✓ — server-driven overview API + enriched SuperAdmin UI + admin login routing + admin nav link in host dashboard (`b8f41d5`). D2 remaining: read-only impersonate snapshot (visible "viewing as" banner + audit trail, no full session takeover) — placeholder button in place.
- **E — Billing (Tier-1 Stripe):** create-subscription, billing-portal, stripe-webhook (signature
  verified), subscription lifecycle, guest-page grace/expired enforcement.
- **F — Tier-2 booking system:** Full booking (availability → request → approve → pay →
  manage) on the €49 price, referencing Anna's Stays components. Built on working Stripe.
- **G — Pre-launch hardening:** cron follow-ups (sync-ical real-feed test), iCal SSRF blocklist + rate limit, cron batching/maxDuration
  at scale, mobile drawer a11y (Escape-to-close, focus return), dead-code sweep, full security
  audit.
  - Add server-side file-size cap in `api/create-upload-url.ts` (client guards are 5 MB cover /
    2 MB logo; a direct API caller can bypass them).
  - Auto-delete old Storage objects on cover/logo replace + remove (partially done: `1cde275`).
  - Message retention: ~90-day cleanup job post-checkout.

Tier-2 architecture stays upgrade-ready throughout (plan-gated component slots; bookings/guests
schema already supports it).
