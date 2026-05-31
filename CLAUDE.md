# Arrivly — CLAUDE.md

## What is Arrivly?
Arrivly is a multi-tenant SaaS platform for short-term rental hosts. Each host sets up their property and gets a personalised branded guest page accessible via QR code. The guest page shows check-in info, WiFi, house rules, host picks, and an AI-generated neighbourhood guide.

**Pricing:** €19/property/month · 30-day free trial  
**Stack:** React 19 + Vite + TypeScript + Tailwind CSS · Supabase (auth + DB) · Vercel (host)  
**Repo:** https://github.com/udybr1975/arrivly  
**Supabase project:** ptkabdelgxkgfslfialx (eu-central-1)  
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
| `/dashboard/qr` | QRCodePanel | protected |
| `/dashboard/branding` | BrandingPanel | protected |
| `/dashboard/billing` | BillingPanel | protected |
| `/admin` | SuperAdmin | admin only |

## Database (Supabase)
- **hosts** — id (= auth.uid), name, brand_name, whatsapp, logo_url, accent_color, contact_email, country, city, neighborhood, street, street_number, lat, lng, plan, trial_ends_at, subscription_status, stripe_customer_id, stripe_subscription_id, push_endpoint, created_at
- **apartments** — id, host_id, name, country, city, neighborhood, street, street_number, floor_note, lat, lng, max_guests, description, images[], is_visible, accent_color, ical_urls, created_at
- **apartment_details** — id, apartment_id, category, content, is_private
- **host_picks** — id, apartment_id, name, category, address, lat, lng, note, display_order, created_at
- **bookings** — id, apartment_id, guest_id, check_in, check_out, status, reference_number, source, created_at
- **guests** — id, first_name, last_name, email, created_at
- **guide_recommendations** — id, apartment_id, neighborhood, categories (jsonb), generated_at
- **push_subscriptions** — id, host_id, apartment_id, role, endpoint, p256dh, auth_key, created_at
- **guest_optins** — id, first_name, email, apartment_id, opted_in_at

### Critical DB facts
- `apartments.accent_color` — NOT brand_color (common mistake, causes silent save failure)
- `apartments.ical_urls` — single text column, one URL per line, no limit (replaces old airbnb_ical_url)
- `bookings.reference_number` — is the guest token, used in QR URL
- `guide_recommendations` — always query with `.maybeSingle()` never `.single()`
- RLS on `host_picks` joins through `apartments.host_id` — correct, verified
- `push_subscriptions` has a UNIQUE index on `endpoint` (`push_subscriptions_endpoint_key`) — subscriptions upsert with `onConflict: 'endpoint'`

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

**Host: Udyni** (udy.baryosef@jchelsinki.fi) — owns:
- **Penthouse in the sky** — id: `9b03a763-3ca6-4d1f-946c-d4e1f977d614`, token: `ARR-PENTH1`

**Test guest URL (Test Apartment 1):** `/guest?apt=aaaaaaaa-0000-0000-0000-000000000001&token=ARR-TEST01`

---

## Session 1 Status: COMPLETE ✓
Scaffold, Supabase schema, all API stubs, all UI components (v1).

## Session 2 Status: COMPLETE ✓
Full redesign to cream design system. All 12 screens. App live at arrivly.anna-stays.fi.

---

## Session 3 Progress (May 28, 2026)

### Completed
- [x] GuestPage — full rewrite: token flow, 4 tabs (Home/Chat/Explore/More), weather, WiFi parser, private check-in gating, host picks, guide, share bar, "Powered by Arrivly" footer, expired/neutral/thankyou states
- [x] BookingManager — add booking form (guest name + dates → generates ARR-XXXXXX token), real iCal sync (unlimited URLs via ical_urls column, detects Airbnb/VRBO/Booking/Guesty/Hostaway/Lodgify, blocked periods handled), source labels + colours
- [x] DB migration — replaced airbnb_ical_url with ical_urls (text, one URL per line)
- [x] Onboarding redirect loop fixed — finish() now creates blank draft apartment if none exists
- [x] PropertySetup — My picks tab added (tab 6): add/delete picks, saves to host_picks table
- [x] BrandingPanel — fixed accent_color bug (was querying brand_color, silent save failure)
- [x] SUPABASE_SERVICE_ROLE_KEY added to Vercel env vars — unblocks all server-side API routes

### Known bugs / tech debt (session 3, updated)
- [x] ~~QR panel uses single canvasRef~~ — RESOLVED `c01a050`: PropertyQRCard, own canvasRef per property
- [x] ~~BrandingPanel accent_color typed as `string`~~ — RESOLVED `f9833f6`: now `string | null`
- [x] ~~appUrl hardcoded in config.ts~~ — RESOLVED `f9833f6`: sourced from VITE_APP_URL with fallback
- [x] ~~House rules manual-only rewrite~~ — RESOLVED `3af381d`: enforced on save, manual button removed
- [ ] PWA stale service-worker — RESOLVED in Session 5 (`2c0c1f1`)

## Session 3 Status: COMPLETE ✓
Core host flows working end-to-end. Guest page fully functional with token flow. Bookings addable manually and via iCal. My picks showing on guest Explore tab.

---

## Session 4 Progress (2026-05-30)

### Completed
- [x] PWA icon set shipped (icon-192, icon-512, maskable, apple-touch, favicon; manifest + index.html wired). `12fbb12`
- [x] Geocoding wired into PropertySetup.saveBasic (address → lat/lng on save). `713b611`
  - api/geocode.ts hardened: Bearer token auth (forwarded by src/lib/api.ts), 3s AbortController timeout, 250-char input cap, generic errors only.
  - Dead src/lib/geocode.ts (unauthenticated duplicate) deleted.
  - saveBasic shows a gentle notice if geocoding returns no coordinates; save always succeeds.
- [x] api/rewrite-rules.ts implemented (was a stub): POST `{ rawRules }` → `{ result }`; auth-gated; @google/genai gemini-2.5-flash; 10s timeout; 5000-char cap; fallback to raw text on any failure. `b6638d6`
  - Removed a broken unauthenticated fetch from GuestPage — guest page now renders rules stored at save time (no AI call per guest visit).
  - gemini-2.0-flash retired by Google on 2026-06-01 (404s); switched to gemini-2.5-flash, verified working live. `66cdfc6`
- [x] Guest "Take me home" and pick "Go" Maps URLs fixed: inline mapsWalkingUrl had wrong path (maps.google.com/dir/ → 404). Deleted; all call-sites import canonical getDirectionsUrl from src/lib/maps.ts (`https://www.google.com/maps/dir/?api=1&destination=LAT,LNG&travelmode=walking`). `f315f45`

## Session 4 Status: COMPLETE ✓
Geocoding live. House-rules AI rewrite live (gemini-2.5-flash). All guest navigation buttons working. PWA icons shipped.

---

## Security (Session 4 — 2026-05-30)
- **Supabase keys rotated** — migrated to new API key format. `VITE_SUPABASE_ANON_KEY` is now the publishable key; `SUPABASE_SERVICE_ROLE_KEY` is the secret key. Env var NAMES unchanged, values rotated. Legacy JWT-based API keys disabled; legacy HS256 signing secret revoked. (Triggered by a real key found in a local dirty .env.example; git history of .env.example was clean — no public leak.)
- **Google Geocoding API key rotated** — restricted to Geocoding API only, old key deleted.
- **GEMINI_API_KEY added** to Vercel (Production) and .env.local — server-side only, no VITE_ prefix.
- **Housekeeping** (`c714e94`): .env.example sanitized to placeholders; .gitignore hardened (blocks .env, .env.*, preserves !.env.example); server-only VITE_ type decls removed from vite-env.d.ts; generic geocode errors enforced.

---

## Session 5 Progress (2026-05-30)

### Completed
- [x] Per-property QR codes — PropertyQRCard child component; each card owns its own canvasRef, download filename includes property name, print matches image to URL. `c01a050`
- [x] R2 cleanups — `accent_color: string | null` in BrandingPanel; `appUrl` sourced from `VITE_APP_URL` env var with hardcoded fallback; `vite-env.d.ts` tightened to `string | undefined`. `f9833f6`
- [x] Multi-property editing — PropertySetup loads by URL param `/dashboard/property/:aptId`; guard redirects to `/dashboard` on missing/unowned apt; form state reset on switch; `[aptId]` dep array. OnboardingFlow navigates directly to new property's edit page. `99082fa`
- [x] Dashboard real counts + back link — Properties metric = real count; Bookings metric host-wide (`.in(aptIds)`); "Edit property" links to specific apt; "← Back to properties" link in PropertySetup; `neighborhood: string | null` type fix. `d6c468f`
- [x] Overview consolidation — one rich card per property (completeness, Active/Draft pill, per-property booking count, QR/Preview/Edit); "My property" nav item + PropertyList.tsx removed; bare `/dashboard/property` route gone; all redirects point to `/dashboard`. `e491602`
- [x] House rules: auto-polish enforced on save — manual "Rewrite with AI" button removed; saveRules calls `/api/rewrite-rules`, falls back to raw on failure, updates textarea with stored result. `3af381d`
- [x] PWA stale-cache fix — sw.js bumped to arrivly-v2; navigation + `/index.html` network-first (cache fallback offline); `/assets/` stays cache-first; unconditional skipWaiting removed; SKIP_WAITING message handler + update-aware registration in main.tsx (reloads once on controllerchange, skips on first install). `2c0c1f1`
- [x] PWA install prompt — InstallPrompt component (15s timer); Android one-tap via beforeinstallprompt; iOS Safari Share→Add instruction (Chrome/Firefox iOS excluded); dismissed state persisted to localStorage; shown in active guest page only. `2c0c1f1`
- [x] Bookings multi-property — apartment dropdown (default first, one at a time) drives list, calendar, iCal panel, and add-booking form; fixed `.limit(1)` single-property bug; cancellation flag prevents stale-request overwrites; `saveIcalUrls` now has `host_id` guard. `35e88ba`
- [x] Calendar month navigation — CalendarView: cursor state replaces frozen `new Date()`; ‹ / › buttons navigate via JS Date month±1 (year rollover automatic); today highlighted with ring in current month only. `c1be4a2`

## Session 5 Status: COMPLETE ✓
Full multi-property support (overview, bookings, editing). House-rules auto-polish. PWA stale-cache fixed. Calendar navigable.

---

## Session 6 Progress (2026-05-31)

### Completed — Priority 4 Push Notifications
- [x] **4a** — Real `api/send-push.ts` via `web-push`. `71e484b`
  - Auth-gated: Bearer token → `getUser` (anon client); host-scoped by JWT (never trusts client-provided host_id).
  - Reads VAPID from env; payload `{title,body,url}` (must match sw.js push handler exactly); prunes dead subs on 404/410.
  - VAPID env set by Udy in Vercel (Production): `VITE_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:udy.bar.yosef@gmail.com`). Verified live (`200 {sent:1}`).
- [x] **4b** — Host push opt-in. `a8228dc`
  - Settings page at `/dashboard/settings` (enable/disable) + sidebar nav.
  - `webpush.ts` hardened (try/catch, null-guard VAPID, safe toJSON, upsert error check, PushManager guard).
  - DB migration: `create unique index push_subscriptions_endpoint_key on push_subscriptions (endpoint)` — enables upsert `onConflict:'endpoint'`.
- [x] **Mobile enable fix** — `f495d94`
  - `subscribeToPush` returns a `SubscribeResult` discriminated union (`unsupported | denied | no-key | subscribe-failed | invalid-subscription | save-failed`) instead of a bare boolean.
  - Clears any existing PushSubscription before re-subscribing → fixes mobile `InvalidStateError` from a stale/mismatched-key subscription.
  - Settings shows a specific message per failure reason. Verified working on mobile.
- [x] **4c-1 + 4c-2** — Server-side send helper + new-booking notification. `a0cc452`
  - NEW `api/_lib/push.ts` (underscore folder → NOT a Vercel route): `isPushConfigured()` (lazy singleton VAPID init) + `sendPushToHost(db, hostId, payload, apartmentId?)` (concurrent send; prunes 404/410 scoped by host_id+endpoint+role; never throws). url validated to start with `/` or `https://`.
  - `api/send-push.ts` refactored to delegate lookup+send+prune to the helper; external API unchanged (405/500/401/400/200).
  - `api/sync-ical.ts`: after the import loop, if `imported > 0`, best-effort `sendPushToHost` ("N new booking(s) synced for {name}", url `/dashboard/bookings`). A push failure can never break a sync. `imported` is a true new-booking count (sync dedupes by iCal UID).

### Completed — Security & fixes
- [x] **sync-ical auth/ownership gate** — `91b6239` (CRITICAL). Was service-role with NO auth; apartment_id is public (guest URLs) → anyone could inject bookings into any host's calendar. Now requires Bearer token + verifies `apt.host_id === userId` (403 else). Error messages scrubbed (iCal URLs can carry auth tokens).
- [x] **Auth/session-switch fix** — `79b4112` (CRITICAL). Logging out then into a 2nd account stayed on the 1st until site data cleared. Layout.signOut: global signOut → on error `signOut({scope:'local'})` → navigate to /login; Login.tsx `signOut({scope:'local'})` before signInWithPassword (auto-heals stuck users); try/finally.
- [x] **Responsive mobile layout** — `263e0d3`. The 170px sidebar (always in-flow) ate ~half the phone width and clipped pages. Now an off-canvas hamburger drawer on mobile (top bar z-30, backdrop z-40, drawer z-50; closes on nav-link tap), static `md+` (desktop pixel-identical). a11y: aria-expanded/aria-controls.
- [x] **Landing login link** — `b283f3f`. Added "Log in" to the landing hero (was signup-only).

### Verified / closed this session (no code change)
- push_subscriptions RLS = single `ALL` policy `USING (host_id = auth.uid())` → DELETE correctly gated for RLS clients; sync-ical's service-role prune bypasses RLS and is code-scoped (host_id+endpoint+role). No gap.
- `VITE_VAPID_PUBLIC_KEY` read server-side (send-push + _lib/push) is INTENTIONAL and correct — it's the public key (browser-safe); Vercel exposes all env vars to functions regardless of prefix. Documented in the helper comment. The "fix it" reviewer note is a false positive.

### Hotfix (2026-05-31) — API routes 500: Node ESM missing import extension
- [x] **ESM import extension** — `0a1c9cd`. `package.json` `"type":"module"` makes
  Vercel run every api/ function as native Node ESM, which requires explicit file
  extensions on relative imports. The 4c helper import `./_lib/push` (no extension)
  threw `ERR_MODULE_NOT_FOUND` at Lambda startup, so every `send-push` and
  `sync-ical` request 500'd from `a0cc452` onward (sync-ical surfaced it; send-push
  was latent — its earlier 200s were on a pre-4c deployment).
  - Root cause hidden at build: `tsc` uses bundler moduleResolution and `vite build`
    only builds the frontend, so neither runs api/ through Node's ESM resolver.
  - Fix: `./_lib/push` → `./_lib/push.js` in `api/sync-ical.ts` and `api/send-push.ts`.
    tsc maps the `.js` specifier back to the `.ts` source (build stays green); Node
    resolves the emitted `.js` at runtime.
  - code-reviewer + security-auditor: both clear. Deployed `dpl_Fz9Hqv…` (READY).
    Live re-test of an actual iCal sync still pending confirmation.

## Session 6 Status: COMPLETE ✓ (ESM hotfix shipped; 4c-3 crons pending CRON_SECRET)
Push send path live; host opt-in live (desktop + mobile); new-booking-on-sync notification live. Remaining: unattended cron triggers (4c-3).

## Known notes / minor debt
- Re-saving house rules re-polishes already-polished text (Gemini call on every save). Minor; acceptable for now.
- `BookingCalendar.tsx` is an unused stub; the real calendar is `CalendarView` inside `BookingManager.tsx`.
- QR scans metric on Overview still shows "—" (not wired to any data source).
- `api/stripe-webhook.ts` is a stub with NO signature verification — must implement before billing goes live.
- `api/sync-ical.ts`: mild SSRF (no private-IP/metadata blocklist on fetched iCal URLs — only an authenticated host can reach it now); no per-host rate limit; insert errors not checked (`imported++` regardless). Tidy before public launch.
- `sendPushToHost` url check uses `startsWith('/')`, which also admits protocol-relative `//host` — only ever set from the host's own send-push request (self-targeted), so negligible.
- send-push `apartmentId` is not ownership-checked — latent only (lookup forces `host_id = userId`, so a foreign apartmentId matches zero rows).
- Mobile drawer a11y follow-ups: Escape-to-close, focus return on close.
- Push opt-in persistence (identified 2026-05-31, fix queued — not yet shipped):
  the Settings toggle reads browser state only (never the DB), and `subscribeToPush`
  unconditionally unsubscribes + re-subscribes on every enable — minting a new
  endpoint and orphaning the prior `push_subscriptions` row (4 rows seen for one
  host/device). Cross-device re-enable is inherent to web push. Planned fix: reuse
  an existing subscription when the VAPID key matches; reaffirm the DB row on load.
  Stale endpoints self-prune on next send (404/410).

---

## Workflow

### Claude in chat vs Claude Code
Claude in chat NEVER pushes to GitHub. All code changes are delivered as Claude Code prompts pasted by Udy (run with `--dangerously-skip-permissions`). Claude uses GitHub/Supabase/Vercel MCPs proactively and reads the current file from GitHub before proposing edits.

### Agent policy
- Append the **code-reviewer** subagent to EVERY code-changing Claude Code prompt — read-only review before commit.
- Run **security-auditor** for any change touching secrets, auth, RLS, or API routes, and before every production deploy.
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
node_modules are unaffected. This applies to the 4c-3 cron files when they land.

---

## Next up (Priority order)

1. **Priority 4 — Push notifications: 4c-3 crons (remaining).**
   - **PREREQUISITE (Udy, in Vercel before any code):** set `CRON_SECRET` (Production) to a long random string. Vercel auto-sends it as `Authorization: Bearer <CRON_SECRET>` to cron endpoints; each endpoint rejects anything else.
   - Add a `vercel.json` cron schedule.
   - Build cron endpoints on the shared `sendPushToHost` helper, each guarded by the bearer check:
     - Monthly iCal sync-all → notify hosts of newly imported bookings (this is what makes the 4c-2 notification genuinely valuable — unattended).
     - Trial-ending reminder (5 days before expiry).
     - Checkout-reminder (morning of departure).
2. **Stripe webhook** — implement `api/stripe-webhook.ts` with signature verification before any billing goes live.
3. **Tier-2 booking system** (future; €49 `price_tier2`) — architecture already upgrade-ready.
