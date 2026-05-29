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
| `/dashboard/property` | PropertySetup | protected |
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
- **Test Apartment 1** — id: `aaaaaaaa-0000-0000-0000-000000000001`, Kallio Helsinki, accent #5a1a2a (Wine)
- **Test booking** — token: `ARR-TEST01`, check_in: 2026-05-27, check_out: 2026-05-31, guest: Udy
- **Test URL:** `/guest?apt=aaaaaaaa-0000-0000-0000-000000000001&token=ARR-TEST01`
- **Sweet home** — id: `d9614d11-d573-4ff0-961a-54c5ea37c2bd`, token: `ARR-ASJZ2R`
- **Penthouse in the sky** — id: `9b03a763-3ca6-4d1f-946c-d4e1f977d614`, token: `ARR-PENTH1`

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

### Known bugs / tech debt
- [ ] QR panel uses single canvasRef — only first apartment gets a real QR code
- [ ] api/rewrite-rules.ts — still a stub, returns nothing (Gemini not wired)
- [ ] BrandingPanel — accent_color typed as `string` in interface, should be `string | null`
- [ ] appUrl hardcoded in config.ts — should move to VITE_APP_URL env var
- [ ] Geocoding never called in saveBasic — lat/lng always null (breaks Take me home + weather precision)

### Session 4 priority list
1. Geocoding in saveBasic (PropertySetup) — calls api/geocode.ts on save, stores lat/lng
2. Real Gemini in api/rewrite-rules.ts — house rules AI rewrite
3. PWA icons — create /public/icons/icon-192.png and icon-512.png (manifest broken without them)
4. PWA install prompt on guest page — show after 15 seconds
5. Push subscription saving — ask permission, save to push_subscriptions table
6. Real api/send-push.ts — web-push library with VAPID keys
7. Notification triggers — new booking, QR scan, checkout reminder

## Session 3 Status: COMPLETE ✓
Core host flows working end-to-end. Guest page fully functional with token flow. Bookings addable manually and via iCal. My picks showing on guest Explore tab.

## Agent review policy
- Run the code-reviewer subagent (read-only) on every change that modifies code, before committing.
- Run the security-auditor subagent (read-only) before every production deploy, and for any change touching secrets, auth, RLS, or API routes.
- Use debugger only when stuck (~20+ min). Run dead-code-cleaner periodically; it writes a report and waits for approval before removing anything.
- Subagents live in .claude/agents/ and run inside Claude Code.
