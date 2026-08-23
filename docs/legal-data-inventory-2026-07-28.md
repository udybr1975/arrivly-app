# **Bemgu**

GDPR Data Inventory — Record of Processing Activities (Art. 30) and Subprocessor List

*Draft prepared for review by legal counsel*

Date of inventory: 28 July 2026

> **The `.md` is canonical; the `.docx` twin is a snapshot and now DRIFTS from it.** Counsel reads the `.docx` — regenerate it from this file before handing it over, or counsel reviews stale retention figures.

Source of truth: live production database (Supabase project ptkabdelgxkgfslfialx, region eu-central-1) and application source code at Git commit 2592e2c on the production branch. This document was compiled by reading the actual schema and server routes, not from memory or summaries.

**Important:** this document was drafted with AI assistance and is not legal advice. It is a factual inventory intended to reduce the cost of legal review. Every item marked **GAP** or "verify" is an open question deliberately left for the founder and counsel rather than guessed at.

## 1. Purpose and scope

Bemgu is a multi-tenant SaaS product for short-term rental hosts. Each host gets a branded, QR-activated "guest page" for their guests: WiFi details, house rules, check-in instructions, an AI concierge chatbot, a city guide, host recommendations, bookable third-party experiences (affiliate model), and host-to-guest messaging. Hosts pay a monthly subscription (Stripe; currently in test mode — no live payments have been taken). The product is live at https://bemgu.app.

This document covers: (a) the two legal roles Bemgu occupies; (b) the categories of data subjects; (c) an Art. 30-style record of processing activities in both roles; (d) a table-and-column level inventory of personal data in the database; (e) retention — what is implemented and what is undecided; (f) the subprocessor list with data residency; (g) third parties contacted directly by the end user’s browser; (h) international transfers; (i) a summary of technical and organisational measures; and (j) a numbered list of open gaps requiring a decision or verification.

## 2. The two legal roles (the structural point)

Bemgu simultaneously occupies two different GDPR roles, and this split drives every downstream document:

- Host data (the host’s own name, email, business address, billing state): Bemgu is the CONTROLLER. Hosts are Bemgu’s customers; Bemgu decides why and how their data is processed.
- Guest data (guest first/last names, stay dates, chat messages to the host): the HOST is the CONTROLLER and Bemgu is the PROCESSOR. The host collects this data from their guest (or from Airbnb/VRBO exports) and enters it into Bemgu; Bemgu handles it on the host’s behalf to render the guest page and deliver messages.

Consequence: two privacy documents are needed (a host-facing privacy policy where Bemgu is controller, and a guest-facing privacy notice describing processing done for the host), plus a Data Processing Agreement (GDPR Art. 28) between each host and Bemgu. Guest data listed in Part B of the record below therefore appears in Bemgu’s Art. 30(2) record as processor, with the host as the controller on whose behalf the processing occurs.

**GAP 1 — record header details missing:** an Art. 30 record must name the controller/processor entity, its business ID, address and contact details. Bemgu’s legal form (sole trader vs company), registered name and Finnish business ID are not recorded anywhere in the codebase and must be supplied by the founder. Whether a Data Protection Officer is required (very likely not, at this scale) is for counsel to confirm.

## 3. Categories of data subjects

| **Category** | **Description** | **Where their data lives** |
| --- | --- | --- |
| Hosts | Paying/trialing customers: short-term rental hosts who sign up with email+password or Google OAuth. One superadmin account (the founder) exists with elevated access. | auth.users (Supabase Auth), public.hosts, Stripe, Resend send logs, push_subscriptions (role=host), admin_audit |
| Demo users | People who try the free 48-hour demo. Same technical shape as a host account, flagged is_demo, no payment data. | auth.users, public.hosts (is_demo=true) and the same tables as hosts; fully auto-purged (see §6) |
| Guests | End users of a host’s property. They never create an account and never log in; they open the guest page via a QR code or link containing an access token. | public.guests, public.bookings, public.messages, public.daily_greetings, public.push_subscriptions (role=guest), transient AI-chat traffic |
| Guest opt-ins | A dormant capability: a table exists for guests leaving a name+email, but no live code writes to it (0 rows in production). | public.guest_optins (empty) |

## 4. Record of processing — Part A: Bemgu as controller (host data)

Proposed legal bases are marked as proposals for counsel to confirm; they are not asserted as settled.

| **Activity** | **Personal data** | **Purpose** | **Proposed legal basis** | **Recipients / systems** |
| --- | --- | --- | --- | --- |
| A1. Account creation & authentication | Email, hashed password (or Google OAuth identity: Google account email, subject ID, name/avatar as provided by Google), first name, sign-in timestamps. Supabase Auth also keeps auth event logs which may include IP addresses (retention on Supabase’s side — verify, GAP 8). | Create and secure the host account; sign-in; password reset. | Art. 6(1)(b) contract | Supabase Auth (eu-central-1); Google (OAuth only) |
| A2. Host profile & branding | Name, brand name, contact email, WhatsApp number (optional), logo (uploaded file), business address (country, city, neighbourhood, street, street number) and its geocoded lat/lng. | Operate the host dashboard; brand the guest page; hyper-local AI guide generation. | Art. 6(1)(b) contract | Supabase DB + Storage; address string sent once to LocationIQ for geocoding |
| A3. Subscription & billing | Stripe customer ID, subscription ID, tier, subscription status, period end, discounts/overrides, cancellation flags. Card details never touch Bemgu — payment collection happens on Stripe-hosted surfaces; Bemgu stores only identifiers and state. | Charge the subscription; enforce plan limits; show billing state. | Art. 6(1)(b) contract; Art. 6(1)(c) for bookkeeping records (Finnish accounting law — counsel to confirm retention period, typically 6 years) | Stripe; Supabase; billing state changes are also fanned out as founder ops alerts via ntfy (see GAP 3) |
| A4. Transactional email | Email address, first name; email content (welcome email at onboarding; trial-ending reminder ~day 25). No marketing emails exist. | Service communications required to run the account. | Art. 6(1)(b) contract (or 6(1)(f)) — service messages, not marketing | Resend (sending region eu-west-1, sender hello@bemgu.app) |
| A5. Host push notifications | Web Push subscription (endpoint URL, p256dh key, auth key) tied to host ID. Endpoint URLs identify a browser/device at the browser vendor’s push service. | Notify hosts of new guest messages, bookings, trial expiry, checkout reminders. | Art. 6(1)(b) contract (host opts in via browser permission) | Supabase; payload delivered via the browser vendor’s push service (Google FCM / Apple / Mozilla), encrypted end-to-end |
| A6. Admin / superadmin operations | admin_audit rows: acting admin email, action type, target host ID, JSON detail, timestamp. The superadmin can view all hosts and impersonate (view-only; impersonation is audit-logged). | Customer support, billing corrections, abuse handling, audit trail. | Art. 6(1)(f) legitimate interest (running and securing the service) | Supabase (admin_audit is service-role-only, not client-readable) |
| A7. Free demo accounts | Same as A1/A2 but is_demo=true, demo_expires_at set (48h). A Cloudflare Turnstile CAPTCHA check runs at creation: the token plus the requester’s IP address is sent to Cloudflare for verification. | Let prospects try the product without payment; prevent bot abuse. | Art. 6(1)(b) (pre-contractual steps); 6(1)(f) for the anti-bot check | Supabase; Cloudflare (Turnstile siteverify) |
| A8. Security rate-limiting | Client IP addresses are read from request headers and used transiently in in-memory rate limiters on public endpoints (guest-state, guest-chat, city-events, demo-create, and others). IPs are not written to the database; server code deliberately scrubs keys and URLs from logs. | Abuse and cost protection on public endpoints. | Art. 6(1)(f) legitimate interest (security) | Vercel serverless functions (transient, in-memory); Vercel platform request logs exist independently — verify their retention (GAP 8) |
| A9. Founder support mailbox | Correspondence with hosts and providers at hello@bemgu.app (Gmail send-as over Resend SMTP with a dedicated key). | Support and partner communication. | Art. 6(1)(b)/(f) | Google (Gmail), Resend (SMTP relay) |

## 5. Record of processing — Part B: Bemgu as processor for hosts (guest data)

For every activity below, the controller is the individual host; Bemgu processes on the host’s instructions given through the product. The host’s own legal basis toward the guest (typically contract for the stay, or legitimate interest) belongs in the host-facing DPA and guest-facing notice, not here.

| **Activity** | **Personal data** | **Purpose (host’s purpose)** | **Systems / recipients** |
| --- | --- | --- | --- |
| B1. Booking management (manual entry) | Guest first name (last name and email fields exist in the schema but the manual form collects only first name), check-in/check-out dates, booking status, source, a random access token (reference_number, format ARR-XXXXXX). | Track stays; personalise the guest page ("Dear \<name\>"); gate access to private check-in details by stay dates. | Supabase (guests, bookings). Guest rows are created server-side only; host reads are tenant-isolated by row-level security. |
| B2. iCal calendar sync (Airbnb/VRBO) | Stay dates and feed UIDs only — iCal feeds carry no guest names. Bemgu fetches the host-pasted feed URL server-side (with SSRF-hardened fetching); the feed URL itself embeds a platform token and is treated as a secret (never logged). | Keep the booking calendar in sync with the host’s listing platforms. | Supabase; outbound fetch to Airbnb/VRBO servers (Bemgu discloses nothing about guests to them — the request is a plain calendar download). |
| B3. Airbnb CSV import | Guest names and stay dates from the host’s own Airbnb reservations export, attached to existing feed bookings. | Restore guest names that iCal feeds omit. | Supabase. |
| B4. Guest page access | The access token (and per-apartment QR key) presented in the URL; resolved server-side to a booking. Guests never authenticate; the browser stores the token in localStorage for return visits. Anonymous roles cannot read bookings or guests directly — state is resolved by a service-role endpoint that reveals nothing on a wrong key. | Show the right guest the right page for the right dates; protect the previous/next guest’s privacy. | Supabase via api/guest-state. |
| B5. Guest ↔ host messaging | Message text (guest- and host-written, up to 4000 chars — free text, so guests may type anything including sensitive information), sender role, timestamps, read state, linked booking. | Direct communication during the stay. | Supabase (messages). Deleted 30 days after checkout (implemented — see §6). |
| B6. Guest push notifications | Web Push subscription (endpoint, keys) tied to the booking. Server-derived; guests cannot write the table directly. | Notify the guest when the host replies. | Supabase; delivery via browser vendors’ push services (encrypted payloads). |
| B7. AI concierge chat | The guest’s typed chat messages and recent chat history; the guest’s first name; the apartment’s full street address; host-authored content (house rules, picks, guide, extras) — all assembled into the model prompt. Only verified in-stay guests reach the model (public callers are rejected before any AI call). Nothing is stored by Bemgu — chat history lives in the guest’s browser session only. | Answer guest questions about the apartment and the city. | Google Gemini API (United States) with Google Search grounding — this is the product’s principal international transfer; see §8 and GAP 5 on free-tier API terms. |
| B8. Daily greeting suggestions | Booking-linked cache rows: stay day number, date, day part, an AI-written suggestion, weather summary. The AI prompt contains stay-day, weather and apartment context but not the guest’s name (verified in source). | A fresh, weather-aware suggestion on the guest page each day part. | Google Gemini API (US) for generation; Supabase (daily_greetings, service-role-only) for the cache. Rows are removed only via booking deletion cascade — no age-based purge (GAP 4). |
| B9. Experience clicks (affiliate) | Deliberately anonymous: apartment ID, provider, product ID, timestamp. No guest identifier, IP or user-agent is stored (verified in schema and endpoint). | Show hosts aggregate click counts; attribute affiliate commissions per property. | Supabase (experience_clicks). Commission ingest (experience_orders) stores only a strict allowlist of commercial fields — buyer PII from the provider’s reporting API is never written (allowlist verified in source). |
| B10. Weather on the guest page | No data leaves Bemgu’s servers — but the guest’s own browser calls wttr.in directly with the apartment’s coordinates, so wttr.in observes the guest’s IP address. See § client-side disclosures. | Show current weather. | wttr.in (third-party, contacted by the guest’s browser, not by Bemgu). |
| B11. Personal link remembered on the guest's device | The guest's own browser stores the booking's platform confirmation reference and their first name (localStorage, keyed to the property's public welcome code). Written only after the server has verified that reference against a real booking; cleared when the stay ends and expired 30 days after check-in. | Let a bookmarked or home-screen-installed welcome page reopen as that guest's own page, without the personal link having to be re-sent. | The guest's own device only. No additional server-side collection — Bemgu already holds both values under B1/B2/B3. |

## 6. Data inventory by table, with retention

All 19 public tables in the live database were enumerated. Tables holding no personal data (plans, app_settings, city_events_cache, experiences_cache, guide_recommendations, apartment_qr_secrets, host_picks, apartment_details) are listed at the end for completeness. Row counts are live as of 28 July 2026 (test data only — no real customers yet). Retention marked GAP means no rule exists and a decision is required before the erasure feature (workstream step 6) can be built.

| **Table** | **Personal data columns** | **Subjects** | **Retention (implemented vs GAP)** |
| --- | --- | --- | --- |
| auth.users (Supabase Auth) | Email, hashed password, OAuth identities (Google), phone (unused), sign-in metadata; Supabase-side auth logs may hold IPs. | Hosts, demo users | Life of account. Demo users: hard-deleted by purge cron 1 day after demo expiry (implemented). Hosts: no self-service deletion yet — the Art. 17 erasure feature is planned last in the workstream. GAP 8: verify Supabase auth-log retention. |
| hosts | name, brand_name, contact_email, whatsapp, logo_url, country/city/neighborhood/street/street_number, lat/lng, Stripe IDs, billing state, partner IDs (viator/gyg/tiqets — business identifiers), email-sent stamps, demo flags. | Hosts, demo users | Life of account (same as above). Demo rows purged (implemented). |
| guests | first_name (last_name, email columns exist but are unpopulated by current flows), created_at. | Guests | RESOLVED 11 Aug 2026: identity erased 30 days after the linked booking checks out (`cleanup_guest_identities` nulls `bookings.guest_id`, then deletes guests no booking references — the booking survives with no name attached). Formerly GAP 4a: indefinite, decision required — e.g. delete or anonymise N days after the last linked booking’s checkout. |
| bookings | check_in, check_out, status, reference token, source, iCal UID; links a guest to an apartment (stay dates of an identifiable person = personal data). | Guests | PARTLY RESOLVED 11 Aug 2026: the GUEST LINK is severed automatically — `cleanup_guest_identities` nulls `bookings.guest_id` 30 days after check-out, so the row survives with no name attached and stops being personal data at that point. **STILL OPEN (GAP 4b): the booking ROW itself is retained indefinitely, deliberately** — hosts have a legitimate business-records interest in booking history. Whether "indefinite, guest link severed at 30 days" is the final answer is for the founder + counsel, and **this is the one retention decision still gating the Art. 17 erasure feature.** |
| messages | Free-text message bodies (guest and host), timestamps, read state. | Guests, hosts | IMPLEMENTED: hard-deleted 30 days after the linked booking’s checkout (daily cron, set-based delete, verified live). Guest identities, daily greetings and guest push registrations are swept on the same anchor by a second daily cron (30 / 30 / 7 days). |
| daily_greetings | Booking-linked stay-day cache with AI suggestions and weather. | Guests (indirectly, via booking link) | RESOLVED 11 Aug 2026: age-purged 30 days after the linked booking checks out (`cleanup_old_greetings`, anchored on `bookings.check_out`). Formerly GAP 4c: no age purge. Low sensitivity, but should follow whatever bookings decision is made. |
| push_subscriptions | Push endpoint URL + crypto keys; host- or booking-scoped. An endpoint URL identifies a device at a push service. | Hosts, guests | RESOLVED 11 Aug 2026: guest subscriptions purged 7 days after the linked booking checks out (`cleanup_guest_push`, scoped `role = guest`, so HOST account-level subscriptions are never touched). Formerly GAP 4d: no purge (5 test rows live). Stale endpoints also accumulate technically. Decide: delete guest rows at/after checkout (aligns with the pre-arrival messaging design, which depends on push). |
| guest_optins | first_name, email (dormant — 0 rows, no writing code path). | Guest opt-ins | GAP 7: decide to keep (and document as future marketing consent, Art. 6(1)(a)) or drop the table before launch. |
| admin_audit | Acting admin email, target host ID, action detail JSON. | Hosts, founder | IMPLEMENTED 11 Aug 2026: hard-deleted 365 days after row creation (`cleanup_admin_audit`, daily cron). Bemgu is CONTROLLER here and the table holds no guest data, which is why the period is a year rather than a month. **[CONFIRM] — 365 days is the founder's recommendation, NOT counsel's. An audit trail arguably should be long-lived; confirm or set a different period.** Formerly GAP 4e: indefinite. |
| experience_orders | None personal — allowlisted commercial fields only (commission, currency, product, campaign). Buyer PII excluded by design. | — | Indefinite (financial/affiliate records; align with bookkeeping). |
| experience_clicks | None personal — no IP/UA/guest ID by design. | — | Indefinite acceptable. |
| Storage bucket apartment-images | Host logo and property photos (host-uploaded). Property photos are generally not personal data; a logo may embed a personal name. | Hosts | Replaced/removed files are auto-deleted; account-level deletion arrives with the erasure feature. |
| Non-personal tables | plans, app_settings, guide_recommendations, host_picks, apartment_details, apartment_qr_secrets, city_events_cache, experiences_cache — configuration, host-authored property content, caches and per-apartment secrets. apartments itself holds the property address (the host’s business address is in hosts and may coincide for home-sharers — treat the property address as potentially personal for sole-trader hosts). | — | Life of the apartment/account. |

## 7. Subprocessor and third-party service list

### 7.1 Subprocessors (server-side; personal data passes through or rests here)

"Transfer mechanism" is deliberately left as a verification column: current DPAs, SCC modules and EU-US Data Privacy Framework certifications must be pulled from each provider’s live legal pages at contract time, not asserted from memory.

| **Provider** | **Function** | **Personal data involved** | **Data location** | **Transfer mechanism** |
| --- | --- | --- | --- | --- |
| Supabase | Database, authentication, file storage (the system of record) | All personal data in §6. | Project pinned to eu-central-1 (AWS Frankfurt). Supabase Inc. is a US company; AWS is the infrastructure sub-subprocessor. | Verify: Supabase DPA + SCC/DPF status |
| Vercel | Web hosting, serverless API functions, cron scheduler, request logs | All personal data transits the functions; logs may contain request metadata (code scrubs secrets/URLs). | GAP 2: function region is NOT pinned in vercel.json — Vercel’s default is a US region. The compute that processes EU personal data therefore likely runs in the US today. Recommendation: pin the function region to Frankfurt (fra1) before launch (one config line + redeploy), then verify in the dashboard. | Verify: Vercel DPA + DPF |
| Stripe | Subscription billing (currently test mode) | Host billing identity and subscription state; card data is collected on Stripe-hosted surfaces and never touches Bemgu. | Stripe Payments Europe Ltd (Ireland) typically contracts EU merchants; global infrastructure. | Verify: Stripe DPA; note Stripe is also an independent controller for its own payment compliance |
| Resend | Transactional email + SMTP relay for the founder mailbox | Host email, first name, email contents. | Sending region eu-west-1 (Ireland); Resend is a US company. | Verify: Resend DPA + DPF |
| Google — Gemini API | AI generation: guest concierge chat, daily greetings, city guides, city events, house-rules polishing, picks parsing | Highest-sensitivity flow: guest chat messages + guest first name + apartment street address (verified guests only); host-authored content; NO data at rest at Google beyond their API handling. | United States. This is the product’s principal international transfer. | GAP 5 — two-part: (a) verify Google’s current API data-use terms: the UNPAID (free-tier) Gemini API has historically permitted Google to use submitted content to improve its products, while the paid tier does not. Several Bemgu keys are deliberately free-tier today. If the current unpaid terms still allow training use, guest chat on a free key is very hard to defend — the planned switch of the chat key to a billed key becomes a compliance prerequisite for launch, not just a quota upgrade. (b) confirm the SCC/DPF basis for the US transfer. |
| Google — OAuth | Host sign-in ("Sign in with Google") | Google identity (email, subject, profile basics) at sign-in. | US/global. | Covered by Google’s terms; verify |
| LocationIQ (Unwired Labs) | Forward geocoding of host business addresses and host-pick place addresses (one-time on save; results stored) | Host address strings (personal data for sole-trader hosts). | EU endpoint used (eu1.locationiq.com). Corporate seat and processing guarantees: verify (GAP 10). | Verify: DPA availability |
| Cloudflare — Turnstile | Bot check on demo signup | CAPTCHA token + requester IP sent to siteverify. | Cloudflare global network; US company. | Verify: Cloudflare DPA + DPF |
| Browser push services (Google FCM, Apple, Mozilla) | Delivery pipe for Web Push | Push endpoint identifies a device; payloads are encrypted end-to-end (the push service cannot read them). | Global, per browser vendor. | Inherent to the Web Push standard; describe in notices rather than contract individually |
| ntfy.sh | Founder ops alerts (billing events, cron failures) | GAP 3: payload contents not yet audited for personal data. ntfy topics are effectively public if the topic name is guessable — if any alert includes a host email or name, this is a disclosure. Verify payloads are IDs/counts only, or move alerts to email. | ntfy.sh public instance (location: verify). | Resolve GAP 3 first |
| Google — Gmail | Founder support mailbox (hello@bemgu.app send-as) | Support correspondence with hosts. | Google global. | Standard Google terms; verify |

### 7.2 Third parties that receive no personal data from Bemgu’s servers

- Viator and Tiqets (content APIs): server-side requests contain apartment coordinates/city only — no guest or host personal data. Responses are cached in Bemgu’s DB. Commission reporting ingest is PII-allowlisted (§5 B9).
- GetYourGuide: link-out only; no API traffic at all.
- Airbnb / VRBO iCal: Bemgu only downloads the host’s calendar feed; it sends nothing but the HTTP request.
- Unsplash (server side): the city-image endpoint queries by city name only.
- GitHub: the source repository is public and contains code only; a standing rule prohibits any secret or personal data in the repo.

### 7.3 Client-side disclosures (the guest’s or host’s own browser contacts these directly)

These are not subprocessors — Bemgu sends them nothing — but the end user’s browser reveals its IP address (and the requested resource) to them, so they belong in the guest-facing notice:

- wttr.in — the guest page fetches weather directly from the guest’s browser using the apartment’s coordinates. wttr.in observes the guest’s IP + the coordinates. wttr.in is a community-run service with no DPA; hosting location unverified (GAP 9). If counsel is uncomfortable, the mitigation is trivial: proxy the weather call through a Bemgu API route.
- Unsplash CDN — city hero images load in the browser (guest IP visible to Unsplash; attribution is displayed as required).
- Viator/Tiqets image CDNs — experience card images load in the browser.
- Google Maps — "Take me home" and Navigate buttons open a Google Maps URL; the guest leaves Bemgu and is under Google’s terms from the tap.
- Experience click-out — tapping an experience card takes the guest to the provider’s site with an affiliate-tagged link; from that point the provider is an independent controller. The tag identifies the apartment, not the guest.
- No analytics, advertising, tracking pixels or third-party cookies exist anywhere in the product (verified: no analytics SDK in the codebase). The only browser storage used is functional (guest access token, UI preferences).

## 8. International transfers — summary

- Data at rest: entirely EU (Supabase Frankfurt; Resend sends from Ireland).
- Data in transit / compute: Google Gemini API (US) is the deliberate, product-critical transfer — guest chat content, guest first name, apartment address, host content. Needs explicit treatment in both notices and the DPA, plus the GAP 5 free-tier terms check.
- GAP 2: Vercel function compute is probably US-region today because no region is pinned. Fixing this (pin fra1) collapses most incidental US processing and materially simplifies the transfer story.
- Peripheral US touchpoints: Stripe, Cloudflare Turnstile, Google OAuth, browser push services — all standard SaaS dependencies with (to be verified) SCC/DPF coverage.

## 9. Technical and organisational measures (Art. 32 summary)

A condensed factual list for the DPA annex; all items verified in code or live configuration:

- Tenant isolation: row-level security on every table; hosts can read only their own guests, bookings, messages, clicks (verified live with cross-tenant read tests). Sensitive tables (audit, secrets, caches, settings) have zero client policies — service-role only.
- Guest data is not readable anonymously: the former anonymous booking-read path was removed; guest state resolves through a server endpoint that reveals nothing on an invalid token/key, with previous-guest protection.
- Guest creation, booking creation and push subscription writes are server-side only (client roles have no insert rights).
- Server-only columns: billing and entitlement fields on hosts cannot be written by the account owner (column-level grants verified).
- Secrets: all API keys are server-side environment variables; a standing rule bans the public VITE_ prefix on secrets; keys are scrubbed from error logs; the repo is public and contains no secrets.
- Abuse/cost controls: verify-gates before any AI spend on public endpoints; per-endpoint rate limiters; CAPTCHA on demo signup; SSRF-hardened fetching of host-pasted URLs; upload size and MIME caps enforced at the storage bucket.
- Data minimisation by design: click beacon stores no PII; commission ingest is field-allowlisted; retention crons (messages, guest identities and greetings 30 days post-checkout; guest push 7); demo accounts fully purged 1 day after expiry including their auth users and guests.
- Access: one superadmin (the founder); admin actions are audit-logged; impersonation is view-only and logged.
- Planned before launch (already scheduled): full penetration-test gate; Supabase leaked-password protection toggle; npm dependency audit.

## 10. Open gaps and decisions required (consolidated)

Numbered for reference from the sections above. None of these are guessed at in this document.

1. Legal entity details for the Art. 30 record header: registered name, legal form, Finnish business ID, address, contact. DPO requirement to be confirmed (likely not required).
2. Vercel function region is not pinned — likely US compute today. Pin fra1 in vercel.json + redeploy, then verify in the dashboard. Small change, large simplification of the transfer analysis.
3. ntfy alerts: audit payloads for personal data and assess topic guessability; either confirm alerts are ID/count-only or move them to email.
4. Retention decisions: (a) guests rows, (c) daily_greetings age purge and (d) guest push_subscriptions post-checkout were DECIDED AND IMPLEMENTED 11 Aug 2026 (30 / 30 / 7 days), matching the guest notice §6. (e) admin_audit is IMPLEMENTED at 365 days but **[CONFIRM] — that period is the founder's recommendation, not counsel's.** **(b) the bookings ROW remains OPEN and is the one still gating Art. 17 erasure** — the guest LINK is severed automatically at 30 days by the identity sweep, but the row itself is retained indefinitely, deliberately, on a business-records rationale that counsel should confirm. These decisions are the prerequisite for building the Art. 17 erasure feature correctly.
5. Google Gemini API: (a) verify current unpaid-tier data-use terms — if free-tier content may be used to improve Google products, switching at least the guest-chat key to the paid tier becomes a launch prerequisite; (b) confirm the SCC/DPF basis for the US transfer. Collect DPAs/terms for all providers in §7.1.
6. The guest page currently has no privacy-notice link. The guest-facing notice (workstream step 4) needs a permanent, unobtrusive surface on the page.
7. guest_optins is dormant (0 rows, no code path). Keep and document, or drop before launch.
8. Verify platform-side log retention: Supabase auth logs (IPs) and Vercel request/function logs.
9. wttr.in weather is fetched by the guest’s browser directly (guest IP disclosed to a community service with no DPA). Either accept and disclose in the guest notice, or proxy the call server-side.
10. LocationIQ (Unwired Labs): confirm corporate seat, DPA availability and where the EU endpoint actually processes.

## 11. Method and disclaimer

Method: the table/column inventory was read from the live Supabase schema via the management API; processing activities and data flows were read from the 54 server routes and shared libraries in the production codebase at commit 2592e2c; retention behaviour was confirmed against the deployed cron configuration; specific claims (what enters the AI prompt, what the click beacon stores, what the commission ingest allowlists, where the weather call originates) were verified against source rather than documentation.

This document was prepared with AI assistance for the founder of Bemgu. It is a factual inventory and working draft, not legal advice, and it must be reviewed by qualified Finnish counsel before any privacy policy, notice or DPA based on it is published. Where the document proposes a legal basis, the proposal is explicitly subject to counsel’s confirmation.
