# Bemgu / arrivly — session history

Historical detail moved out of CLAUDE.md on 2026-07-29 so the always-loaded file stays
under the context limit. Nothing here was edited — every block is verbatim as it stood in
CLAUDE.md. Ordered newest first. Read this only when past context is actually needed.

Current state, active workstreams, database schema, lessons and conventions all stay in
CLAUDE.md; this file is the archive of work already shipped.

---


---

## CLOSED ITEMS ARCHIVED Aug 8 2026 (verbatim, moved from CLAUDE.md)

- ~~**`guests` readable by ALL authenticated hosts**~~ **RESOLVED S24 (F-01)** — guest creation moved server-side (`api/create-booking`), `guests_host_read` replaced with a host-scoped SELECT policy. Verified live: cross-tenant overlap 0.
- ~~**`guests_insert_open` anon INSERT**~~ **RESOLVED S24 (F-02)** — policy dropped; anon + authenticated INSERT revoked (service-role inserts only).
- ~~**`function_search_path_mutable` on `set_updated_at` + `auth_owns_apartment`**~~ **RESOLVED S24** — `search_path=public` pinned on both.
- ~~**Non-public SECURITY DEFINER EXECUTE grants** (`auth_owns_apartment`, `enforce_property_cap`, `handle_new_user`)~~ **RESOLVED S24** — PUBLIC EXECUTE revoked (anon/authenticated can no longer RPC them). `guest_host_card` remains anon-callable BY DESIGN (guest page reads host branding).
- **~~RAISED — `generate-guide.ts` has NO server-side cooldown~~ — RESOLVED (`6fd015c`,
  Aug 4 2026).** `GUIDE_FRESH_HOURS = 24` in `PropertySetup.tsx` was UI-only, so an
  authenticated host could loop the endpoint and spend **Bemgu's** quota. Now gated by an
  **atomic per-host 6h claim on `hosts.guide_claimed_at`**, taken before generation and proven
  live (calls 2–6 of a loop returned instant `429 cooldown`, no Gemini call, €0). Details in
  "SESSION Aug 4 2026 (2)".
- **~~Enable GitHub secret scanning + push protection~~ — VERIFIED ALREADY ENABLED (Jul 29 2026).
  No action was needed.** A full
  history scan of **all 279 commits found ZERO secrets**, no `.env` ever committed, no
  client-side AI provider calls, and no secret-named `VITE_` vars — **the Anna's Stays failure
  modes are all absent.** Push protection makes that mechanical rather than dependent on
  discipline.

---

## Aug 8 2026 — date-window guard: the measured evidence

The run evidence behind `cc8e870`, moved here from CLAUDE.md so the always-loaded file carries
the correction and not the raw counters. The Aug 8 session record joins this file at the next
session close.

**EVIDENCE (09:00 UTC, window 8-15 Aug):** `eventsExtracted` 4, `eventsDroppedOutOfWindow` 6,
`datesUnparseable` 2 — "Helsinki Festival" (18 Aug - 5 Sep) and "Poets of the Fall" (empty date)
reached the **SHARED city row**. **4 WAS NOT A RECALL FAILURE:** the model emitted **10**, inside
target, and the guard dropped 6 — a city corpus lists a MONTH against a SEVEN-DAY window, so
~60% is legitimately out of scope. **Retrieval-scope mismatch, not a prompt problem; supports
not opening B3.6.**

**VERIFIED AGAINST LIVE BEHAVIOUR, not against statements running without error:** an
`authenticated` write of `canonical_city_key` and `ical_last_synced_at` was reverted **while
`floor_note` in the SAME statement landed**; a `service_role` write landed; an INSERT seeding the
column came back NULL. Fleet back to **10 apartments, 0 stamped, 6 triggers**.

---

## SESSION Aug 7 2026 — the city-level events cache, built and live

**HEAD `9291f74`, verified live: deploy `dpl_9g3FPzPyGX5PQF79odhm87aJB5Bq` READY.** Four code
commits, three migrations, one docs split. Events are now cached per CITY instead of per
APARTMENT, so N apartments in one city cost ONE search and ONE bill instead of N.

### THE FOUR COMMITS
- **`d254df9` — `cron-refresh-events` correct at concurrency 1.** Two apartments in flight
  breached Groq's 6K TPM ORG-WIDE ceiling deterministically, starving guest-chat, the guide and
  daily-greeting across every tenant. Concurrency 1 alone would have been incomplete: serialising
  a pool whose items cost ~75s under a 150s `maxDuration` means run 3+ is killed mid-flight,
  SILENTLY — no JSON summary, no wholesale-failure ntfy. So also a **65s `START_DEADLINE_MS`**
  that defers rather than starting work it cannot finish, **least-recently-refreshed ordering** so
  the deadline cannot starve a fixed tail, and the alarm scoped to `attempted`.
- **`48eb2e6` — canonical city identity (cache commit 1 of 3).** `reverseGeocode()` in
  `_lib/geo.ts` reusing the SAME 550ms gate as forward geocoding (the LocationIQ limit is
  per-key, not per-endpoint); `POST /api/resolve-canonical-city`; `GET
  /api/backfill-canonical-city`; fire-and-forget from `PropertySetup` only when the coordinates
  actually CHANGED. `normalizecity=1` and `accept-language=en` are both load-bearing.
- **`73587d3` — the cache becomes CITY-KEYED (commit 2).** One shared helper, `eventsCacheRef` in
  `_lib/city-events.ts`, owns WHERE the row lives; each caller keeps its own guards, counters,
  alarms and copy. Cron does ONE unit of work per distinct city key plus one per unkeyed
  apartment. Ordering moved to **`last_attempted_at`** — the OPEN-1 fix from `d254df9`: it is
  stamped on success, B3.1 skip AND failure, but deliberately NOT on deferral, because a deferred
  unit was never attempted.
- **`9291f74` — LocationIQ counter (commit 3).** `bump_api_counter` on
  `/api/resolve-canonical-city`, 20/hour, caller-keyed, placed after the ownership check and
  before the vendor call. Fails closed but SOFTLY — `200 { resolved: false, reason }`, never a
  4xx, because the caller is fire-and-forget and must never fail a save. Registered in
  `cron-spend-audit.ts` as `'resolve-canonical-city': 60`.

### THE THREE MIGRATIONS — applied via Supabase MCP, in NO commit
**A future session reading only git history will not see these.**
- **`add_canonical_city_columns`** — five nullable `canonical_*` columns on `apartments` plus a
  partial index on the key.
- **`create_city_events_by_city`** — `city_key` PK, `payload`, `generated_at`,
  `last_attempted_at`. RLS ON, ZERO policies, anon/authenticated hold nothing — **verified
  against the LIVE ACL, not against the statement having run without error.**
- **`protect_canonical_city_columns`** — BEFORE UPDATE trigger reverting all five `canonical_*`
  columns unless `current_user` is `service_role` / `postgres` / `supabase_admin`.

### LIVE PROOF — measured, not assumed
Sweet home + Test Apartment 1 both resolve to **`fi:helsinki`** and share ONE row; Casa Marco
`es:barcelona`; Maison Lumiere `fr:paris`. **FIVE apartments are unkeyed and still on their own
rows, so the per-apartment fallback is the COMMON path today, not an edge case** — it must stay
behaviourally identical to pre-commit-2 production. Trigger verified THREE ways: an
`authenticated` write of the key was reverted, a `service_role` write landed, an ordinary host
save of a normal column was unaffected. First city-keyed generation smoke-tested 12:45 UTC — city
row written, `last_attempted_at` stamped, the per-apartment row untouched at 09:01:22.

### STATUS CHANGE — do not delete this as dead code
Commit 2's **key/city AGREEMENT CHECK** in `_lib/city-events.ts` was LOAD-BEARING when written,
because `authenticated` then held UPDATE on those columns. `protect_canonical_city_columns`
retired that. **It is now DEFENCE IN DEPTH, not the control — still correct, still keep it, but
its status changed.**

### CORRECTION
The Routes table listed `/onboarding` → `OnboardingFlow`. **NEITHER EXISTS** in the repo
(verified during `48eb2e6`); the row is removed. `PropertySetup` is the only address-save path.

---

## Phase I Stage 5 — decision + status (Jul 27 2026)

### Stage 5 — DECISION + status (Jul 27 2026): "Option A, tease-focused"
**Scope DECIDED:** automated ingest of **Bemgu's OWN Tiqets per-campaign commissions only**, powering REAL euros in the **tier 1–2 Earnings tease** ("your guests booked €X — on Portfolio it would be yours"). The two other providers stay link-out: **Viator** = manual CSV only (no reporting API), **GYG** = screen-only (no export). **Tier-3 own-token ingest is PARKED** — it would require storing each host's provider API token, a secret-storage design question deferred until there's demand.

**Ingest cron SHIPPED (`e1431a2`):** `api/cron-refresh-earnings.ts`, daily **05:30 UTC** in `vercel.json` (30 min after `cron-refresh-experiences`). Pulls `GET api.tiqets.com/v2/reports/orders` + `/reports/refunds` over a rolling **14-day** window (`Authorization: Token <TIQETS_API_TOKEN>`, `page_size` 100, hard cap 20 pages, `withRetry`, **never throws** — returns `200 {ok:false}` on a failed fetch). Defensive **order-id field detection** (first present of `order_id`/`order_reference`/`id`/`reference` — the real field name is a DATA GAP); `campaign_name` → apartment UUID via regex + UUID check + **FK-safe batch-scoped `.in()` apartments lookup** (unknown/foreign UUID → `apartment_id` null, row still stored); `raw` built from a **strict PII allowlist** (no customer/buyer fields); upsert `onConflict provider,provider_order_id`; refunds flip `status` → `'refunded'`. **TWO temporary keys-only shape logs** `[earnings:tiqets:orders:debug]` + `[earnings:tiqets:refund:debug]` — **REMOVE after first real data reveals the field names.** (These are the ONLY remaining Tiqets temp logs — the guest-adapter `imgdebug`/ratings logs are gone as of `540d57f`/`146173f`.) code-reviewer 0 must-fix (3 recommendeds applied) + security-auditor PASS (0 confirmed risk).

**DB — migration `create_experience_orders` applied + verified via MCP (Jul 27):** `public.experience_orders` — provider check (`'tiqets'`), **UNIQUE(provider, provider_order_id)** for idempotent upserts, `apartment_id` nullable FK→apartments cascade, `campaign_name`, `commission_excl_vat` numeric, `currency`, `product_id`, `status` default `'fulfilled'`, `order_fulfilled_at`, `raw` jsonb (PII-whitelisted), `created_at`; index `(apartment_id, order_fulfilled_at desc)`. **RLS ON:** single SELECT policy for hosts over own apartments (mirrors `experience_clicks`); writes service-role only; grants verified clean (`authenticated` = SELECT only; TRUNCATE/TRIGGER/REFERENCES revoked per the Jul 24 PUBLIC-grant lesson; `anon` = nothing).

**Tiqets Reporting API is LIVE (self-serve, Jul 27):** the old token predated Tiqets' **"Essential API"** bundle; a FRESH portal token carries **Content + Availability + Pricing + Reporting**. New token verified `200` on `/v2/reports/orders` AND the Content API, swapped into Vercel Production (sensitive flag) via CLI + forced redeploy, old tokens deleted. Reporting fields per order: **`campaign_name` (= `tq_campaign`)**, `commission_excl_vat`, `currency`, `click_id`, `product_id`, `order_fulfilled_at`.

**VERIFICATION PENDING (next session, first item):** read the 05:30 UTC cron run's response/logs via Vercel MCP — expect `ok:true` with `ordersFetched:0`. (A manual trigger was NOT possible — `CRON_SECRET` is Vercel-sensitive, so `vercel env pull` returns it empty — see the ops lesson.)

**STAGE 5 COMPLETE (Jul 28 2026).** (a) **Ingest verified** — the 05:30 UTC `cron-refresh-earnings` first scheduled run returned `200` at 05:30:05 with zero error lines in the window; `experience_orders` row count `0`, consistent with `ordersFetched: 0`. Vercel does not capture response bodies, so `ok:true` was established by elimination against the handler's failure paths (each emits a `console.error`) plus the confirmed-present `TIQETS_API_TOKEN`. (b) **`imageCredit` caption visually confirmed** on a live Tiqets card (Stromma Finland, Helsinki Cruise, Sweet home Explore tab) — Tiqets licence clause 9.1c satisfied. (c) **Tease card SHIPPED (`363c7ce`)** — client-only change to `src/components/host/EarningsPanel.tsx` (+64/−3). Reads `experience_orders` (`commission_excl_vat`, `currency` ONLY — no `raw`, no PII) filtered `provider='tiqets'`, `status='fulfilled'`, `.in('apartment_id', aptIds)`, `.gte('order_fulfilled_at', since)` on the same 30-day boundary as the clicks query; sums **EUR rows only** (never cross-summed), `Number()`-coerces against PostgREST numerics-as-strings, rounds to 2 decimals; new `eurExact()` (Intl.NumberFormat) leaves the existing whole-euro `eur()` untouched. Gold-bordered (`#dcc68f`) card renders **only when `confirmedCount > 0`**, in both TeaseState branches — so with zero rows the page is byte-identical to before. security-auditor PASS (0 confirmed risk); code-reviewer 0 must-fix. **TWO KNOWN NUANCES (not defects):** clicks filter on `clicked_at` while orders filter on `order_fulfilled_at`, so the two figures are not strictly the same 30 days of guest activity; and refunds are excluded silently via `status='fulfilled'` (the footnote discloses this). **STILL OPEN:** the two temporary `[earnings:tiqets:orders:debug]` / `[earnings:tiqets:refund:debug]` keys-only shape logs remain in `api/cron-refresh-earnings.ts` until first real order data reveals the field names.

**Reference (link-out providers, unchanged):** **GYG** Analytics → Campaigns (native EUR table, ~24h lag); **Viator** Performance Exports CSV (manually generated from Performance Trends, **7-day expiry, no API**; has a "Campaign Name" column + "Gross Commission (USD)" per campaign — W1 confirmed).

**Currency rule stands (reaffirmed Jul 26, W4):** v1 shows native currency per provider (Viator USD, GYG + Tiqets EUR), **never cross-summed**; a host display-currency preference is a v2 backlog item. Revisit at payout-details time — if Viator reporting flips to EUR then, the panel can be simplified.



---

## Landing — 4-tier pricing + comps section (Jul 26 2026)

### Landing — 4-tier pricing + comps section (SHIPPED `aec0c6c` + `cd983a9`, W5)
- **Pricing section rewritten:** headline "Simple, flat pricing. Never per property.", all four tier cards — Starter €10/2, Host €15/7, **Portfolio €25/12 featured "Earn with it"**, Full booking €49/unlimited "Coming soon" (disabled non-link). Prices fetched from the extended `/api/public-pricing` (now also returns `plans[]` — `tier`, `priceEuros`, `maxProperties`, `includesBooking`; the old `trialDays`/`fromPriceEuros`/`currency` fields stay byte-compatible; security-auditor PASS, 0 confirmed risk). DB-matching hardcoded fallback so no flash / renders if the fetch fails.
- **Marketing tier NAMES (Starter / Host / Portfolio / Full booking) are DISPLAY-ONLY labels in `Landing.tsx`** (`TIER_META`) — the DB `plans.label` values are untouched.
- **New comps section between Pricing and FAQ:** 9-row comparison table vs **Hostfully "Guidebooks"** + **Touch Stay** (raised charcoal Bemgu column, brass accents, `th scope` + sr-only Yes/No for a11y, keyboard-scrollable region), 3 anchor-stat cards (2–3 bookings / 3 marketplaces / 100% yours), dated fine print. **Never a promised commission number** — only "typically around ~8%" + disclaimer. Footer Pricing anchor unchanged (now lands on the full grid).
- **COMPS-TABLE FACT BASE (verified Jul 26 from public sources — re-verify before any future pricing-claim edit):**
  - **Touch Stay HAS a guest-facing AI chatbot** (guidebook-content-only, all plans) → AI-concierge row = muted-check "answers from your guidebook only". Touch Stay also offers an **AI guidebook draft at setup** → row relabelled "City guide writes and refreshes itself", Touch Stay muted "AI draft at setup".
  - **Hostfully Guidebooks** = AI Itinerary Planner (guest-facing) + InboxAI (host-side, PMS) but **no guest Q&A chatbot** → muted "Trip planner; host-side inbox AI"; city-guide row "Host-curated".
  - **Bemgu's defensible differentiators on these rows:** live local knowledge BEYOND the guidebook + auto-refresh.
  - **Competitor pricing (fine print "July 2026"):** Hostfully $9.99/1 → $24.99/5 → $49.99/10 → $75+; Touch Stay ~$8.25–15/property/mo, no free plan.

---



---

## Phase I — waiting-period queue results (Jul 26 2026)

### Waiting-period queue results (Jul 26 2026)
Work done while awaiting provider replies. W3/W4 detail lives in the Stage 5 stub above; W5 in the header.
- **W1 — attribution test CLOSED (results in, checked Jul 27 2026, ~24h after seeding).** Seeded on the Sweet home guest page: 3× Viator, 3× Tiqets, 3× GYG (app-handoff) + 1 browser-control GYG click. Results by provider (tag = `bemgu-d9614d11-…`, the full 42-char apartment tag):

  | Provider | Tag untruncated? | Campaign in reporting? | Ingest path |
  |---|---|---|---|
  | Viator | ✅ full tag | ✅ Performance Trends "Campaign" breakdown (Source Type "Affiliate API") + CSV "Campaign Name" col + "Gross Commission (USD)" per campaign | manual CSV (7-day expiry, no API) → link-out |
  | Tiqets | ✅ full tag | ✅ Traffic Performance → Campaign Performance table w/ Commission (excl. VAT) col | **Reporting API → ingest cron** |
  | GYG | ✅ full tag | ⚠️ present but UNDERCOUNTS (see below) | screen-only → link-out |

  - **Viator & Tiqets campaign attribution CONFIRMED end-to-end** — the Stage 5 Viator-blocker question is answered YES (Viator has the campaign column + per-campaign gross commission).
  - **GYG app-handoff DROPS the `cmp` tag.** GYG Analytics→Campaigns showed only **2 visitors** (1 under our campaign + 1 under `no_reseller_campaign`) vs **4 clicks** made — the browser click preserved `cmp`, the app deep-link handoff did not. **Partner-level commission attribution survives app handoff** (the visit still lands in our account); only per-property campaign granularity is lost for app users. **OPEN STRATEGY ITEM (parked, revisit with real traffic):** accept the undercount vs explore a web-flow-forcing link format.
  - (All seeded clicks logged in `experience_clicks` EXCEPT the 1 browser-control click — see the beacon lesson below.)
- **W2 — end-to-end tier-3 connect test CLOSED (passed in production, both directions).** Tier 1→3 via MCP → Connect flow validated a fake ID `P99999999` (and correctly BLOCKED `P123`) → live `/api/experiences` Viator links flipped to `pid=P99999999` with **NO `mcid`**, campaign preserved, **instantly** (serve-time link building) → disconnect → links reverted to `pid=P00310630` + `mcid=42383` → host row restored byte-identical (tier 1, all partner IDs null). Both Earnings states eyeballed.
- **W3 — Tiqets Reporting API: access now LIVE (self-serve, Jul 27).** The Jul 26 401-blocked state was RESOLVED by a fresh Essential-API portal token; spec + shipped ingest in the Stage 5 section above.
- **W4 — Viator reporting currency CONFIRMED USD (no self-serve switch).** Two-currency Earnings rule stands for v1. See the Stage 5 stub.
- **W5 — landing pricing + comps SHIPPED (`aec0c6c` + `cd983a9`).** See the "Landing — 4-tier pricing + comps section" note below.
- **BONUS — Earnings per-card Connect CTA SHIPPED (`fc19a07`).** Not-connected provider cards in `/dashboard/earnings` now carry a full-width gold **"Connect {provider} →"** CTA → `/dashboard/earnings/connect?provider={key}`; the Connect page scrolls to that provider section. Connected cards unchanged.



---

## Phase I — build stages 0–5 (completed stage log)

**Build stages:**
- **Stage 0 — Udy homework.** **DOMAIN MIGRATION GATES STAGE 0 (decided Jul 10 2026):** Udy is purchasing a dedicated Arrivly domain (check availability in order: `arrivly.com` → `arrivly.app` → `arrivly.io` / `getarrivly.com`) BEFORE any provider registration. Rationale: the one-QR-forever promise makes the domain permanent at launch; affiliate applications should carry the FINAL domain; masking `anna-stays.fi` is NOT technically viable (breaks PWA/OAuth/hash flow). **Migration mini-session checklist:** Vercel add domain + set primary + 301 the old subdomain (keep forever); `VITE_APP_URL` change + forced fresh redeploy (build-time baking); Supabase Auth Site URL + additional redirect URLs BEFORE the switch, then re-test Google sign-in AND the ResetPassword recovery-hash flow on the new domain (both depend on implicit/hash redirects); Google Cloud consent-screen authorized domains += new domain (client redirect URI unchanged — points at the Supabase project URL); Resend: verify new domain (SPF/DKIM) then switch sender — FIRST CHECK which sender domain Resend currently uses (unverified); Stripe TEST webhook endpoint URL update; regenerate test-property QR codes; installed test PWAs + old-origin push subs die (test artifacts only); Vercel crons unaffected; **(added Jul 17 2026, discovered during smoke tests) Cloudflare Turnstile: add the new domain to the widget's allowed hostnames** (else the demo money-gate shows "Unable to connect"); **(added Jul 17 2026) Supabase Custom SMTP: point auth emails at Resend (`smtp.resend.com:465`, user `resend`, the prod Resend API key) with sender `Bemgu <hello@bemgu.app>`, and rebrand the Supabase auth email templates** (the Magic Link/OTP template still carried an ARRIVLY header). THEN: create ARRIVLY's own affiliate accounts at all three providers, collect partner IDs + API keys (server-side env names, NO `VITE_` prefix: e.g. `VIATOR_API_KEY`, `TIQETS_API_TOKEN`), and verify in each dashboard that bookings can be reported/exported **PER CAMPAIGN TAG** (the c-full linchpin; if a provider can't, its T1–T2 tease falls back to click counts).
- **Stage 0 — APPROVAL-COMPLETE across ALL THREE providers (Jul 23 2026; faster than planned — no review delays materialised anywhere; domain migration to `bemgu.app` already COMPLETE + smoke-tested — see the domain-migration block at the top).** All three affiliate signups use email **`hello@bemgu.app`** + website **`https://bemgu.app`**. **Payout details deliberately NOT entered anywhere yet** (not blocking; Udy fills them directly in each provider dashboard before first payout). Per-provider state:
>   - **GetYourGuide — LIVE.** Instant self-serve (no partner-portal review delay materialised). **Affiliate partner ID = `VMY9NWZ`.** Commission rate stated in-dashboard: **8%** (in writing). Account 2FA enabled. **C-FULL LINCHPIN CONFIRMED:** Analytics → Campaigns is a native **per-campaign euro report** (columns: Campaign · Visitors · Bookings · Potential income · Conversion rate · First/Last seen; updated daily, ~24h lag, dates CE(S)T). **BUILD-SPEC CONSEQUENCE:** links WITHOUT a campaign value fall into a `no_reseller_campaign` bucket → the link-builder must treat `cmp=` as **MANDATORY** (format **`cmp=bemgu-{apartmentId}`**). Analytics → Integrations additionally monitors deployed deeplink/widget health per page (Active/Inactive/Redirected/Broken) — free link-health telemetry at scale. **GYG has NO API key at this access level — it is link/widget-based** (no env var needed). NOTE: the account was created in the **agent-flavoured portal mode** ("book for your clients" UI); the Links tool + partner ID work normally; if campaign analytics ever prove limited, ask GYG partner support about an account-type switch.
>   - **Viator — APPROVED (KYC PASSED).** Identity verification (government ID + selfie, Tripadvisor KYC) is complete and the account is approved. Category on file: Travel agency / Concierge service. **STILL TO HARVEST next session:** the **Partner ID (format `P` + 8 digits)** and the **Affiliate API key (Basic Access)** from the dashboard; enable 2FA if offered.
>   - **Tiqets — APPROVED.** Partner application approved. **STILL TO HARVEST next session:** partner/affiliate ID + API token (Content + Availability APIs come with signup); enable 2FA.
>   - **CREDENTIALS STORAGE RULE:** **partner IDs are NON-SECRET** (may appear in docs/chat/CLAUDE.md); **API keys/tokens are SECRETS → Vercel server-side env vars ONLY, NO `VITE_` prefix.** Proposed names: **`VIATOR_API_KEY`**, **`TIQETS_API_TOKEN`** (GYG has no API key at this access level — link/widget-based).
>   - **NEXT SESSION plan:** (1) **harvest** Viator + Tiqets credentials — partner IDs into CLAUDE.md, API keys/tokens into Vercel (server-side env); (2) **Stage 2** Supabase MCP migrations — partner-ID columns on `hosts` (`viator_partner_id`, `gyg_partner_id`, `tiqets_partner_id`), `experiences_cache` table mirroring the `city_events_cache` pattern (RLS ON / zero policies / service-role only / cron-refreshed), `experience_clicks` click-log table; (3) **Stage 3** mockup-first — Explore-tab experience cards + account-level Earnings panel (T3 connected state AND the T1–T2 real-euro tease state with UpgradeCTA per the upgrade-slot architecture).
- **Stage 1 — scoping close-out in chat:** DONE — GYG v1 mechanism = deep links (no content API at our access level).
- **Stage 2 — DB migrations via Supabase MCP:** DONE — partner-ID columns on `hosts`, `experiences_cache`, `experience_clicks` (see the Database section). **Corrective migration `grant_host_partner_id_column_update`** later added the missing column-level UPDATE grant (see the DB lesson below).
- **Stage 3 — mockup-first:** DONE — Explore-tab cards + Earnings panel (both states) approved (mockups B + C).
- **Stage 4A — guest-side pipeline:** **SHIPPED + VERIFIED LIVE (`2fd4832`).** `api/experiences.ts` (cache-first blended Viator + Tiqets, rating-ordered) + GYG city-link card; `api/experiences-providers.ts` adapters; `api/cron-refresh-experiences.ts` (daily 05:00 UTC — observed running); `api/experience-click.ts` beacon → `experience_clicks`. Guest Explore renders the cards via the `VITE_EXPERIENCES_ENABLED` flag (live in Production).
- **Stage 4B — Earnings + Connect + link-builder rewrite:** **SHIPPED + VERIFIED LIVE (`d5e3bda`).** `/dashboard/earnings` (tier ≥ 3 connected state with real 30-day click data + honest "reported in your {provider} dashboard" commission cells — **NO fabricated numbers**; tier 1–2 tease with real clicks + clearly-labelled estimates + UpgradeCTA; empty state). `/dashboard/earnings/connect` guided flow (apply → find ID → paste; Viator `^P\d{8}$` hard-block, GYG/Tiqets warn-only; application-progress persisted to `hosts.ui_state.experiencesConnect`; disconnect supported). Sidebar "Earnings" nav (hidden for demo hosts). `src/lib/experienceProviders.ts` holds provider metadata + validation; `src/config.ts` adds `experiencesTierGate: 3` (mirrors server `EXPERIENCES_TIER_GATE`) + `experienceEstimate` constants. Both stages passed code-reviewer + security-auditor before push.
- **Stage 5 (v1.1) — INGEST BACKEND SHIPPED (`e1431a2`, Jul 27 2026); tease UI REMAINING.** Automated ingest of **Bemgu's OWN** Tiqets per-campaign commissions (Reporting API) into `experience_orders`, to power REAL euros in the tier 1–2 Earnings tease. Viator (manual CSV, no API) + GYG (screen-only) stay link-out. Tier-3 own-token ingest PARKED (secret-storage design question). See the Stage 5 scope stub below.


---

## Phase H and earlier — completed work sections (Jun–Jul 2026)

### S27 — pass 2 (DONE)

Dashboard pass 2 is complete: the colour model is LIVE and the property editor is redesigned. Build order ran reader-first (migrations → account-wide read/write code 2a → property-editor 2b).

**PASS 2a — DONE (`981bd5b`): colour model + account-wide Branding + guest read.**
- **Migration A applied** (Supabase): `apartments.accent_color` is now NULLABLE with the default dropped; `hosts.accent_color` backfilled from each host's OLDEST apartment (fallback `#1c1c1a`); apartments equal to their host's default were nulled to inherit. Result: **7 inheriting (NULL) / 4 explicit overrides / 11 total.** Three test properties verified unchanged: Sweet home (`d9614d11`) + Maison Lumière (`d7f47672`) inherit `#0c3547`; Casa Marco (`d81e4e89`) keeps its explicit `#7a5c00`.
- **Migration B applied** (Supabase, DROP+CREATE): `guest_host_card(p_apartment_id)` now ALSO returns `accent_color`, preserving SECURITY DEFINER + pinned `search_path = public, pg_temp` + grants (anon / authenticated / service_role). Read live, not blind-rewritten from memory.
- **Code shipped `981bd5b`:** `BrandingPanel.tsx` rebuilt **account-wide** (writes `hosts.brand_name` + `hosts.accent_color`; logo flow kept; first-property-only logic removed; chrome restyle + live phone preview; NO contact toggle). `GuestPage.tsx` resolver = `apartment?.accent_color ?? host?.accent_color ?? ARRIVLY_CONFIG.colourPresets[0].hex` (+ `accent_color` added to the Host type). `api/guest-preview.ts` host payload now surfaces `host.accent_color`.
- **Colour model is LIVE:** `apartments.accent_color` NULL = inherit `hosts.accent_color` (account default); non-null = per-property override.

**PASS 2b — DONE (`fd32109`): property editor redesign.** code-reviewer PASS (no must-fix; 2 should-fix warnings applied — robust custom-hex save + inline hex validation); security-auditor PASS (no confirmed risk). `npm run build` green.
- `PropertySetup.tsx` restyled into the S26 chrome (cream `#fffdf9` cards, `#e4ddd0` hairlines, Fraunces headings, brass Save / charcoal AI buttons, white inputs with brass focus ring) with **HORIZONTAL premium tabs** (charcoal active pill / hairline-outline inactive). All prior tab logic preserved byte-faithfully (geocoding on save, hero upload, WiFi/Check-in-private/House-rules-Gemini-rewrite rows, Extras AI bulk-import, My-picks AI enrich + relocate flow).
- Tab order (shipped): **Basics · WiFi · Check-in 🔒 · House rules · Extras · My picks · Guide & events · Look.** Both new tabs are covered by the existing unsaved-property lock (`apartmentId === null && key !== 'basic'`).
- NEW **"Guide & events"** tab: city-guide status from `guide_recommendations.generated_at` ("updated X ago") with a **24h client-side freshness gate** → button disabled "Up to date" inside the window (no Gemini call); Refresh → `/generate-guide`, handles the 503 `guide_empty` via `JSON.parse(err.message)?.error`. Local-events status comes from the **`/refresh-events` response only** (`refreshed`/`reason`/`generated_at`) — **no `city_events_cache` read, no auto-call on tab open**; Refresh → `/refresh-events` (server ~20h-gated). **NO "Refresh all" button.**
- NEW **"Look"** tab: per-property colour inherit/override + reset; override writes a validated hex, reset writes `NULL`, both scoped `.eq('id', aptId).eq('host_id', hostId)`; custom hex validated `/^#[0-9a-fA-F]{6}$/`; live phone preview (hero, WiFi accent left-border, active tab, "Take me home"); signpost to Branding for logo/name/default.
- `Dashboard.tsx` property card accent now coalesces `apt.accent_color || host.accent_color || preset` (NULL-inheriting cards show the brand default, not charcoal).

### Phase H — pricing-card redesign (DONE `41bd2d6`)

Premium plan-card redesign on BOTH billing surfaces. code-reviewer PASS (no must-fix; nits non-blocking + intentional); security-auditor PASS (no confirmed risk — presentation-only, all five billing endpoints + payloads + guards byte-faithful). `npm run build` green. Committed + pushed (deploy-gate default).
- **NEW `src/components/host/PlanCard.tsx`** — shared **presentational** plan card (NO fetch / NO business logic; the parent injects the CTA as a `ReactNode` and owns every API call + branch). Charcoal-inverted **"Most popular"** featured variant + cream default; brass-check bullets, capacity chip, "Your plan" / "At launch" pills, CTA slot; equal-height (`h-full` + `flex-1` bullets, CTA pinned bottom). **Design = Direction A (charcoal-inverted featured), deliberately NOT the gradient-SaaS reference look.** CTA button recipes (brass / quiet / ghost / current-cream / disabled) are duplicated in each parent by the cross-boundary-duplication convention (no shared import).
- **`BillingPanel.tsx` + `ChoosePlan.tsx`** restyled to use `<PlanCard>` in the S26 chrome; responsive grid `grid-cols-1 sm:2 xl:4`; banners / manage footer / confirmation modal recoloured to chrome tones. **Presentation-only** — every handler, payload, state branch, banner condition, and the modal's conditional copy are byte-faithful. Price still derives from `plans.price_cents / 100`, capacity from `plans.max_properties`.
- **One sanctioned content change:** ChoosePlan Pro (tier 4) now shows its real price from `price_cents` instead of `—` (CTA stays disabled "Coming soon"; `create-subscription` still 403s tier 4 server-side).

### Phase H — admin host-finder (DONE `9bed006`)

Searchable host finder added to the Superadmin host list. SINGLE FILE, frontend-only, admin-only. code-reviewer PASS (0 critical; both should-fix a11y warnings applied — scroll-active-into-view + gate `aria-controls` on open). security-auditor NOT required (no data/auth/RLS/API change — purely a client-side filter over the already-loaded `/admin-overview` payload). `npm run build` green. Committed + pushed (deploy-gate default).
- **`src/components/admin/SuperAdmin.tsx`** — added an accessible **"Find a host" combobox** (in-file `HostFinder` sub-component + `rankHosts` helper) as a full-width row directly ABOVE the existing filter/sort/exempt row. Operates client-side over the already-loaded `data.hosts`; no new endpoint, no payload change.
- **Search pool** = `showExempt ? data.hosts : data.hosts.filter(h => !h.is_exempt)` — respects the exempt toggle, IGNORES the status filter (any host is findable). Case-insensitive match on (brand_name OR name) OR contact_email; rank = startsWith(name/brand) → contains(name/brand) → email-contains (stable V8 sort preserves intra-tier order).
- **Pin behaviour:** selecting a host sets `pinnedHostId`, shows its name + ×, and collapses the list to ONLY that host's existing card (Manage / View-as intact), hiding the filter/sort/exempt row + the "{N} hosts" count. Clearing (× or emptying the input) unpins. Pinned host is resolved fresh from the search pool each render and unpinned **gracefully via an effect** if it vanishes after a Manage re-fetch.
- **Full a11y:** `role=combobox` (`aria-expanded` / `aria-controls` gated on open / `aria-activedescendant`), `role=listbox`, `role=option` rows with `aria-selected`; ArrowUp/Down (open-if-closed then move + scroll active into view), Enter (active or first match), Escape (close), click-outside (close), hover + click select.
- **NOTE — SuperAdmin is STILL on the OLD pre-Phase-H styling** (`#f8f6f2` / `#ddd8ce` / serif headings, NOT the new DARK-sidebar/CREAM chrome). The host-finder deliberately matches that existing admin styling. A full admin chrome refresh remains a SEPARATE future pass.

### Phase H — Overview/Home + sidebar (DONE)

Host **Overview/Home** redesign + the dashboard **sidebar** account/identity area. All shipped with code-reviewer PASS (+ security-auditor on the destructive delete) and `npm run build` green. Commit trail (newest last):
- **`4eb8004`** — **sidebar account menu** (`Layout.tsx`): replaced the faint corner "Sign out" link with a bottom-pinned account row → upward popover (**Settings · Install app · Sign out**). Install app gated `canInstall && !installed && !standalone`. Escape closes the popover with `stopPropagation()` so it never reaches the mobile-drawer Escape listener; popover is conditionally rendered so its buttons stay out of the drawer focus-trap; click-outside via a `mousedown` listener gated on open. Identity moved from the top brand block to the foot (mobile top bar still shows brand_name).
- **`98e6316`** — **pin sidebar to viewport** (`Layout.tsx`, CSS-only): base `flex flex-col` (dropped `min-h-screen`); desktop `md:static` → `md:sticky md:top-0 md:h-screen md:self-start`. `md:self-start` is load-bearing (sticky-in-flex: stops align-stretch so `h-screen` governs height). `<nav>` (`flex-1 overflow-y-auto`) is the ONLY scroll region; the `mt-auto` account row sits at the viewport bottom with zero page scroll. Mobile drawer pixel-identical (height from `fixed inset-y-0`).
- **`f90adac`** — **operational Overview** (`Dashboard.tsx`): a clickable **today strip** (Staying now / Checking in today / Checking out today → `/dashboard/bookings`; Unread → `/dashboard/messages`) with **zero-muting** (0 → muted number + neutral icon chip). Counts computed by **widening the existing bookings select** to `apartment_id, check_in, check_out, status, source` (NO new round-trip) and tallied against the **DEVICE-LOCAL** date (`YYYY-MM-DD` built from local parts, NOT `toISOString()`), counting only `status ∈ {confirmed,completed}` AND `source` NOT ending `_block`. Functional header (date eyebrow + greeting + live one-line day summary, zero clauses dropped, calm fallback). Next-step banner now targets the **incomplete property CLOSEST to ready** (highest `met`, stable tie-break). **State-matched card primary**: ready → "Preview" (Eye); not-ready → "Finish setup" + outline Preview. Per-card **"QR & share" REMOVED** (redundant with the sidebar QR tab). One unified readiness system (Ready/Setup · "{met} of {total}" · "Still to add" on any incomplete card). Coming-soon demoted to a quiet dashed strip. `bookingTotal` still computed but no longer rendered (kept as `const [, setBookingTotal]`).
- **`2cd5fbc`** — **hatched "No photo yet" hero** (`Dashboard.tsx`): a photoless **DRAFT** card (`!hero_image_url && !is_visible`) gets a hatched cream gradient + centered "No photo yet" pill instead of a heavy solid block; the dark scrim is gated to photo heroes only. **Live-but-photoless cards keep their solid accent thumbnail** (per-property colour identity); only an unpublished draft hatches.
- **`f81b9a2`** — **"Discard draft" CardMenu item** (`Dashboard.tsx`): see the Draft-discard lesson below.

**LESSON — Draft discard (no migration needed).** A host may delete their own property via a client `supabase.from('apartments').delete().eq('id', apt.id)` under RLS `apartments_host_all` (`host_id = auth.uid()`) — a foreign id deletes **zero rows** (USING is applied as WITH CHECK on the ALL-command policy). All **10 child FKs are ON DELETE CASCADE** within the same tenant, so the delete is self-contained (no orphans, no migration). The UI offers **Discard ONLY on a true throwaway draft (`!is_visible && zero bookings`)** as an accidental-loss **guardrail — NOT a security boundary** (RLS is the boundary). Confirm-then-delete (non-optimistic); `bookingCountByApt` counts every booking row incl. `*_block`, so a property carrying only a calendar block is correctly non-discardable. Deliberately NO DB trigger / stricter RLS, to keep a future legitimate "delete a live property" flow open. security-auditor PASS (no CONFIRMED RISK); its lone YOUR-CALL item (live `confdeltype` re-check) is advisory, not a gate.

### iCal guest-name preservation + Bookings redesign (DONE) — Jun 27 2026

Airbnb's iCal feed carries **no guest names** and re-issues a booking's UID when an event changes, leaving "ghost" rows. This session reworked sync to **reconcile** (upsert keyed on a stable feed UID, never touching guest fields), added an **Airbnb CSV** path to attach names, moved iCal management into the property's **Calendars** tab, and gave **Bookings** a full Phase H redesign. Code HEAD `be6301d`.

**DB migrations (applied via Supabase MCP, project `ptkabdelgxkgfslfialx`; additive; verified — do NOT recreate):**
- **`bookings_ical_uid_reconcile_foundation`** — added `bookings.ical_uid` (text, nullable); backfilled `ical_uid = reference_number` for feed rows (`source <> 'manual'`); partial unique index `bookings_apt_ical_uid_key ON (apartment_id, ical_uid) WHERE ical_uid IS NOT NULL`. Verified 27 feed rows keyed / 0 missing / 0 manual mis-keyed.
- **`reconcile_ical_bookings_function`** — `public.reconcile_ical_bookings(p_apartment_id uuid, p_source text, p_events jsonb) RETURNS jsonb {imported,updated,cancelled}`. SECURITY DEFINER, `search_path=public,pg_temp`. Advisory xact lock per apartment+source. Upsert keyed on `(apartment_id, ical_uid)`: INSERT new feed rows with a fresh `ARR-` token (`new_ref`, INSERT-only); **ON CONFLICT updates check_in/check_out/status='confirmed'/source ONLY — NEVER guest_id or reference_number** (CSV names survive every sync by construction). Soft-cancels rows of the `(p_source, p_source||'_block')` family whose uid dropped from the feed, **GUARDED on `cardinality(uids) > 0`** (empty-but-successful fetch cancels nothing). `imported` = pre-count of uids not yet present.
- **`reconcile_ical_bookings_lock_grants`** — Supabase default privileges had auto-granted EXECUTE to anon+authenticated; **REVOKEd from anon, authenticated, public**. Verified anon=false, authenticated=false, service_role=true.

**Code commits:**
- **`695f114` (P1)** — `api/_lib/ical.ts` `syncApartmentBookings` now calls `reconcile_ical_bookings`: group events by base source, RPC once per source, **skip a source with ANY failed fetch** (so a feed that didn't load can't soft-cancel its own rows), `ARR-`+6 crypto-random `new_ref` per event. Same signature + `SyncResult {imported,skipped,errors}`; both callers untouched (both already pass a service-role client). `vercel.json` cron-sync-ical `0 4 1 * *` → `0 2 * * *` (monthly → daily 02:00 UTC).
- **`85c3c6c` (P2)** — NEW `api/import-airbnb-csv.ts`. Bearer → anon getUser → service-role admin → apartment ownership 403; mirrors `create-booking.ts` (guests insert `last_name:''`/`email:''`). 5/60s per-user limiter, `no-store`, 1 MB cap (`MAX_CSV_LEN`), 5000-row bound. Language-proof **POSITIONAL** parse: BOM strip, RFC4180 quote-aware reader, cols start=4/end=5/nights=6/guest=7 (verified vs the 18-col Airbnb export), strict MM/DD/YYYY→ISO + end-from-Nights fallback, data-row guard skips header/summary without trusting the localised Type cell. Match `source='airbnb'` + `status='confirmed'` + exact dates; oldest match named, extras counted ambiguous; first whitespace token = first_name; idempotent re-upload updates the linked guest in place (no dup). Returns `{matched,named,skipped,ambiguous}`. Never deletes/cancels. code-reviewer + security-auditor PASS.
- **`5ba1fec` (P3)** — **Calendars tab** in `PropertySetup.tsx` (after Guide & events, before Look; inherits the unsaved-property lock). Card A iCal-links textarea ↔ `apartments.ical_urls` (single newline-delimited TEXT col; host-scoped anon update) + Save + "Sync now" (`/sync-ical`). Card B Airbnb CSV upload (`/import-airbnb-csv`) + 1 MB guard. Lazy-load on tab open; reset on apartment switch; generic error sentences only.
- **`ae57886` (P4)** — `BookingManager.tsx` Phase H redesign. Hide cancelled (`.neq('status','cancelled')`). **messages-read concurrency FIX** (event handler shares the effect's cancel signal). Removed the duplicate iCal sync card → "N calendars connected · Manage calendars →" pointer row. Filter chips All/Guests/Blocks + guest-name search (list only). Reservations = source-accented cards (name-or-"Guest", unread badge, status pill, channel tag, **ARR-only reference**, "+ add name" hint → `?tab=calendars`, active-today Guest-page link). Blocks demoted to thin grey strips. Colour-coded calendar (reservation wins over grey block) + present-categories legend; occupancy view ignores the list filter. **Calendar / Upcoming-Past date string built from LOCAL y/m/d (not `toISOString`) — fixes off-by-one for +UTC hosts.** code-reviewer PASS (its 1 must-fix = that date bug, applied).
- **`be6301d` (P5)** — `PropertySetup` honours `?tab=` deep-link (existing-property branch only; `'new'` still forces `'basic'`), so the two Bookings links open the Calendars tab directly.

**Live verification:** the Sweet home ghost (26–28 Jun, UID …3059…) flipped to `status='cancelled'` on the first reconcile sync while the live …adc92… stayed confirmed; a whole-DB ghost scan found only that one. CSV import on the host's real Airbnb CSV → **"6 named · 6 matched · 1 no match"**; the 6 = all current confirmed Sweet-home Airbnb reservations (Carla 26–28 Jun live / Max 1–2 Sep / Momone 15–17 Sep / Rachel 29–30 Sep / Nina 2–3 Oct / Hannah 22–23 Nov).

**DONE — past-Airbnb soft-cancellation guard + restore (migration `reconcile_ical_past_cancel_guard_and_restore`, Supabase ptkabdelgxkgfslfialx, Jun 27 2026).** Airbnb's iCal exports only current+future events, so on the first daily reconcile all PAST Airbnb rows aged out of the feed and were soft-cancelled (16 Sweet-home rows). FIX (DB-only, no deploy): added a `check_out >= current_date` clause to the reconcile soft-cancel — **ONLY that WHERE clause changed; every other line of `reconcile_ical_bookings` is byte-identical** — so past rows never age-out into `'cancelled'`, while ghost-kill + upcoming-cancellation reflection (today/future) are preserved. Re-asserted service-role-only EXECUTE (`REVOKE` public/anon/authenticated, `GRANT` service_role). One-off restore: past airbnb-family `cancelled` rows → `'confirmed'`. Verified: airbnb-family cancelled **16 → 1** (the one genuine ghost, check_out 26–28 Jun, correctly stays cancelled); confirmed **11 → 26**; guard present in the function body; grants anon=false / authenticated=false / service_role=true.

**Guest-page token backfill (legacy Airbnb refs) — DONE (DB-only, no deploy, Jun 27 2026).** Legacy Airbnb feed rows carried their raw iCal UID (`…@airbnb.com`) as `reference_number`, which fails `api/guest-state.ts` `TOKEN_RE` (`^[A-Za-z0-9-]{4,32}$`) — so the Bookings "Guest page" button AND the real keyed-date redirect resolved to the **neutral page** for every Airbnb reservation. Cause: reconcile's `ARR-` `new_ref` only fires on **INSERT of a never-seen uid**; every current uid already existed, so rows were only **UPDATEd, never re-keyed**. FIX: backfilled `reference_number = 'ARR-' || upper(substr(md5(gen_random_uuid()::text || id::text),1,6))` for `source IN ('airbnb','airbnb_block') AND status='confirmed' AND reference_number !~ '^ARR-'` → **26 rows**; **`ical_uid` (raw UID, the feed match key) left untouched** so reconcile still matches. Rollback is derivable: `SET reference_number = ical_uid` (pre-backfill they were identical). Verified: 0 non-ARR confirmed feed rows, 26 distinct ARR tokens, `ical_uid` intact, Carla → `ARR-BB4E3E` resolves `'active'`. Future Airbnb rows get an `ARR-` token automatically via reconcile's INSERT path.

**PARKED — Airbnb name-automation (do NOT build until Udy asks).** Goal = host-side button to auto-pull guest names instead of manual CSV. Official Airbnb API is gated to vetted channel-manager partners (**RE-VERIFY vs Airbnb dev terms before relying on this**). Credential-scrape / headless-login **REJECTED** (ToS, credential storage, 2FA/CAPTCHA, fragile). **Email ingestion** is the realistic terms-safe auto path: host adds a one-time forward rule (airbnb.com → Arrivly inbound address), Arrivly parses each booking email (carries first name + dates) and date-matches like the CSV — needs inbound-email infra (verify Resend inbound; else Postmark/Cloudflare), a format-resilient parser, PII handling, email-beats-iCal ordering. **Guest self-identify** (already on V2 roadmap) ≈ 80% of the value for a fraction of the build (loses only pre-arrival personalisation). Cheap win regardless: deep-link the CSV step to Airbnb's export page + tight inline instructions.

**DEFERRED / BACKLOG (unchanged):** host-contact-to-guests toggle (+ guest display); property-card overflow-menu edge detection (open-upward clip, short viewports); remaining surfaces Messages / Settings (mockup-first) + the non-card chrome of the Billing/ChoosePlan pages already done; pre-arrival guest reachability (don't build until asked); `GEMINI_API_KEY_CHAT` → billed when Google payment resolves.

**NEW low-priority fold-ins (flagged this session — separate surfaces, not urgent):**
- (a) **Admin Plan-settings panel** — add a one-line note in the UI that the price field updates **DISPLAY only**; a real billing change needs a new immutable Stripe Price + `STRIPE_PRICE_TIER_n` env + redeploy (see the `plans.price_cents` lesson).
- (b) **ChoosePlan "14-day free trial" copy is hardcoded** — wire it to `app_settings.trial_days` via the same source the landing uses (`api/public-pricing`) so it stays consistent if `trial_days` changes.

**PENDING UDY ACTIONS:** ✅ DONE — Supabase Auth redirect URL `https://arrivly.anna-stays.fi/reset-password` added (password reset now complete). STILL OPEN — hand over remaining dashboard "open issues" to fold in next session.

**PHASE H — COMPLETE (Overview/Home + Bookings + Messages + Settings + the guest-page redesign all DONE — see sections above):**
- **The guest-page redesign (`GuestPage.tsx` + 4 children) — DONE Jun 28 2026** (Stages A–D `7acd244`→`d2d1eb0`→`bc445a1`→`f7b547f` + accent-pill `fd57079`; see "Guest-page redesign — Phase H (DONE)" above). This was the LAST Phase H surface — **the whole Phase H polish pass is now complete.**
- **Home greeting freshness — DONE (S28, Jun 28 2026)** — multi-day "same greeting every open" fixed: per-booking suggestion (hard day-part + sliding anti-repeat + stay-day nudge), first-open-only blurb, new "Right now" card. The old parked sketch (blurb variants + big "Right now in {neighborhood}" slot) was superseded; variants dropped. 5 parts: Stage 1 + Stage 2b + lockdown migrations, Stage 2 `abd5202`, Stage 3 `8771612`. See "S28 — Home greeting freshness (DONE)" below.
- **NEW backlog (PARKED): anon-read lockdown for `guide_recommendations` + `host_picks`** — both are `USING(true)` anon-read AND load-bearing (GuestPage Explore reads them directly). Needs the reader-migration-first pattern (service-role endpoint, then drop the anon policies); a quick drop breaks Explore. Low urgency (non-sensitive data). See section below; do NOT build until asked.
- **NEW nits (pre-existing, low priority):** `EventsPage` ✕ button has no `aria-label` (+ 🗓 glyph should be `aria-hidden`); some guest error strings use `text-red-500` instead of design-system red `#8a1a1a`.
- **NEW backlog (a11y, Jul 27 2026): Tiqets `alt_text`.** Each Tiqets `images[]` object carries an `alt_text` string the adapter does NOT yet surface (a `TODO` marks it in `api/_lib/experiences-providers.ts`). Wire it into an `imageAlt` field on `NormalizedExperience` + the `ExperiencesSheet` `<img alt>` next time that UI file is touched (currently the guest experience-card image has an empty alt). Deferred because it spans the adapter + the shared type + the UI (multi-file).
- **Airbnb name-automation — PARKED** (see PARKED note above; do NOT build until Udy asks).
- Low-priority fold-ins (admin Plan-settings DISPLAY-only note; ChoosePlan trial copy → `app_settings.trial_days` via `api/public-pricing`).
- This session's new backlog: **Messages** — "Awaiting reply" also shows on checked-out threads (cosmetic); the conversation LIST re-renders every 25s poll (the open thread is `threadSig`-deduped, the list isn't); realtime/websocket is a future upgrade vs the poll. **Settings** — real Terms/Privacy/Support URLs (currently `#` placeholders); feature tickets: change email/password, per-alert + email notification prefs, delete account & data.
- Carry-over: **QRCodePanel "Refresh guide / Refresh events" confusable** (visually distinguish/group); **PWA installability** — on phone, BOTH the guest page and the host dashboard currently show "copy URL" instead of an install / Add-to-Home-Screen option (investigate manifest / `beforeinstallprompt` / standalone detection / install-prompt UX); **pre-arrival guest reachability** (don't build until asked); **admin chrome refresh** (SuperAdmin still on pre-Phase-H styling).

> **Groq deferred to Phase G** (capacity/redundancy, NOT security; trigger = observed Gemini free-tier 429s in production). Non-grounded endpoints that could move: `rewrite-rules`, `bulk-import`, `greeting`, `host-picks`. Grounded endpoints stay on Gemini: `guest-chat`, `city-events`.

### Messages — Phase H redesign (DONE) — code `bc6d46f8`

Single file `src/components/host/Messages.tsx` (+466 / −129), deployed & verified. **Conversation-driven inbox** (blocks filtered out — they're not guest conversations) replacing the old booking-row scroll.
- **Tabs Open / Past / All** (Open default + brass count badge). Visibility: **Open** = in-house OR unread>0 OR last message within 14 days; **Past** = checked-out AND has ≥1 message; **All** = has ≥1 message OR in-house. **Empty UPCOMING bookings never appear** in any tab + a dashed "N upcoming bookings with no messages are hidden" note (Open tab, no search; shown even when the list is otherwise empty).
- **Header controls:** property dropdown (only when >1 distinct property) + case-insensitive guest-name search (search hides the dashed note).
- **Rows** (source-accented left border): channel-coloured avatar, In-house / Checked-out status chip, amber "Awaiting reply" chip, "You:" host-prefix on the preview, unread badge OR last-message date; warmer bg on unread; sorted **attention → in-house → recency**.
- **Thread:** Fraunces header + status chip + reference, **"Open guest page ↗"** (in-house + reference only, URL built exactly like `BookingManager.guestPageUrl`), bubbles with **day separators**, reply box with ⌘/Ctrl+Enter + hint. **No auto-select on load** (opening a thread marks-read, so auto-select would mark a guest's message read before the host saw it).
- **Live polling:** 25s interval + window focus + visibilitychange→visible; **SILENT on poll** (no error toast on background failures); `threadSig` (count+last-id) dedup skips no-op thread re-renders; `isNearBottom()` scroll guard never yanks when the host scrolled up; mobile "← Back" clears `openThreadIdRef` (so the poll stops marking that thread read from the list); mark-read fires only when there's an actual unread. Cancel-signal + `openThreadIdRef` stale guards throughout; interval/listeners cleaned up on unmount.
- Client-only (code-reviewer PASS — 0 must-fix; 4 should-fix warnings all applied; no security-auditor needed).
- **BACKLOG:** "Awaiting reply" also renders on checked-out threads (cosmetic); the conversation LIST re-renders every 25s (thread is deduped, list isn't); realtime/websocket is a future upgrade over the poll.

### Settings — Phase H redesign + sidebar de-dupe (DONE) — code `938cf8af`

3 files (+199 / −84): `src/components/host/Settings.tsx`, `src/components/host/InstallCard.tsx`, `src/components/shared/Layout.tsx`. Deployed & verified. Client-only (code-reviewer PASS — 0 critical / 0 must-fix / 0 convention violations; no security-auditor needed).
- **`Settings.tsx`** is now a cream **sectioned hub** (`max-w-2xl`, Fraunces title): **Account** (48px gradient avatar + brand/email + trial-or-status badge; key/value rows "Edit in Branding →" / "Manage in Billing →" / "Email & password" Coming) · **Notifications** (push logic — checkPermission/isSubscribed/reaffirmSubscription, handleEnable error-reason→toast map, handleDisable, loading/off/on/blocked — preserved **VERBATIM**; restyled to cream with brass Enable / outline Turn off; "what you get" events list; "per-alert & email prefs" Coming; `'loading'` gates only the Notifications card body) · **This device** (`<InstallCard/>`) · **Account actions** (danger Sign out mirroring `Layout.signOut` exactly via `useNavigate`; "Delete account & data" Coming) · **Footer** (non-card Terms/Privacy/Support placeholder `#` links with a TODO comment). New host fetch: `select('brand_name, subscription_status, trial_ends_at')` `.eq('id', user.id).maybeSingle()`; `trialRemaining` computed like Layout; trial pill only when `subscription_status==='trial' && trialRemaining>0`.
- **`InstallCard.tsx`** restyled dark→cream (eyebrow "Install"→"This device"); **every branch + all logic byte-identical** (standalone→null, isIOSSafari, canInstall, installed, isChromium, fallback, copy-link).
- **`Layout.tsx`** account popover **slimmed to Sign out ONLY** — removed the duplicate Settings NavLink + Install button + the divider above Sign out; removed the `Download` icon import and the `useInstallPrompt` import/destructure. **All a11y intact** (focus trap, Escape incl. the popover's `stopPropagation`, return-focus, outside-click on `accountOpen`, mobile drawer); NAV_GROUPS Settings nav item, trial widget, identity trigger, unread badge, `signOut` all untouched.
- **BACKLOG:** change email/password; per-alert + email notification prefs. **(The Terms/Privacy URLs and delete-account-and-data items were PROMOTED OUT of this cosmetic backlog on Jul 28 2026 — see "PRE-LIVE LEGAL & COMPLIANCE WORKSTREAM" below. They are launch blockers, not polish.)**

### Guest-page redesign — Phase H (DONE) — Jun 28 2026

The LAST and biggest Phase H surface — `src/components/guest/GuestPage.tsx` + its 4 children — is complete, shipped in 4 staged **client-only** commits (each code-reviewer PASS / 0 must-fix / `npm run build` green; **no security-auditor needed** — presentation-only, no data/auth/RLS/endpoint change), plus a tiny pill follow-up. **Direction = "A, accent-led":** the host `accent_color` is the ONLY colour, on cream/charcoal neutrals — paper `#fbfaf7` · card `#fffdf9` · hairline `#e9e4d9` · ink `#1c1c1a` · ink-soft `#5b5853` · ink-faint `#9a958c`; **Fraunces** (display, via `font-['Fraunces']`) + **Inter** (body); **NO Arrivly brass**. Fonts already loaded globally in `index.html`. Accent applied ONLY via inline `style` with `accentColor` (tints `accentColor+'14'` ≈8% / `+'26'`). Commit trail (newest last):

- **`7acd244` (A — Home):** immersive Anna's-style hero (photo-forward, **NEUTRAL** dark bottom scrim — accent scrim removed; place welcome "Welcome to {neighborhood}." + host signature/avatar + Scroll cue; the NAME moved into the letter). "Dear {name}," letter with the blurb/weather/dailySuggestion composition **byte-faithful** and revised Chat-vs-host closing copy. NEW on-page **Message-host card** (reuses the existing `setShowMessages` trigger, token-gated). NEW data-gated **Quick-access strip** (WiFi copy / Door copy via the same regex / Home directions). WiFi promoted to the primary card (3px accent top bar); check-in/rules/extras restyled. All token / private-detail / greeting / weather logic untouched.
- **`d2d1eb0` (B — Explore):** cream/Fraunces restyle (header band keeps the accent — the one place Explore leads with colour); events card, host-pick cards, guide accordions, attribution all restyled; Go-link href branch byte-identical. NEW **Phase-I monetization slots, INERT + FLAG-GATED OFF** — module consts `SHOW_EXPERIENCES_SLOT=false` / `SHOW_RESERVE_SLOT=false`. Slot 1 = "Tours & tickets" entry card (Viator/GetYourGuide) under a "Plan your time" eyebrow; Slot 2 = solid "Reserve" chip on `Restaurant` picks (TheFork/OpenTable). Both render NOTHING today (flags false), make no network calls, no handlers/hrefs. **Flipping a flag is a SEPARATE security-reviewed change that also wires the affiliate endpoints.** lucide `Ticket` added. **Follow-up `fd57079`:** category pills changed from the fixed `CATEGORY_COLORS` rainbow to accent-tint chips (`accentColor+'14'` bg / `accentColor` text); the now-unused `categoryColor` fn + `CATEGORY_COLORS` const removed (−13 net). The guest page now uses the host accent colour **EXCLUSIVELY** — no non-host colour anywhere.
- **`bc445a1` (C — Settings + nav + non-active states):** "More" tab → visible label **"Settings"** + lucide `Settings` gear, BUT the internal `ActiveTab` id **STAYS `'more'`** (the push effect guards on `activeTab==='more'`, `onClose` does `setActiveTab('more')`, the autoprompt references it — renaming would break the push surface; **label/icon only**). Install app + Allow notifications promoted to two hero feature cards under "This device" (gated by the SAME `tokenParam && pushNotifState!=='unsupported' && !=='loading'` condition; the needs-install/off/on/blocked/ios branches + `canInstall` install flow + copy-link fallback + `handleMoreTabPushEnable` preserved **verbatim**). Save-this-page + WhatsApp demoted to quiet rows under "This page". **DELETED:** the duplicate "Message your host" block (now on Home) AND the Home fixed `bottom-14` pinned save bar (Save lives in Settings). Preview branch keeps its own inert demo cards (restyled). Bottom nav restyled (frosted `#fffdf9`/93%, `h-16`, ink-faint inactive, short centered accent top pill). Chat tab height fixed `calc(100vh - 64px)` to match `h-16`. neutral/expired/unavailable/thankyou restyled (Fraunces, cream/ink, sparing accent); no change to which state renders or any redirect/data condition.
- **`f7b547f` (D — children):** `ChatBot`, `MessageHost`, `EventsPage`, `InstallPrompt` restyled onto the same system (39+/39− pure className-string swaps: `#faf9f6`→`#fffdf9`, `border-gray-*`→`border-[#e9e4d9]`, `text-gray-*`→ink tokens, headings→Fraunces; `InstallPrompt` moved off the dashboard tokens `#ddd8ce`/`#1a1a1a`/`#888`). Every network call, the MessageHost 15s poll + nudge state machine, the ChatBot 429/403/500 branches + starters, the EventsPage retry loop + `eventHref`, and the InstallPrompt timer/dismiss/branches are **byte-faithful**.
- **`fd57079` (follow-up):** accent-tint Explore category pills — replaced the fixed-rainbow `CATEGORY_COLORS` fill with `accentColor+'14'` bg + `accentColor` text (the last non-host colour on the guest page), and **removed the now-dead `categoryColor` fn + `CATEGORY_COLORS` const** (zero remaining refs). **NOTE this supersedes the Stage-B "categoryColor pills kept" line above.** The guest page now uses host accent colour exclusively across every surface.

**Nits found this session (PRE-EXISTING, not from the redesign — low-priority fold-ins):** `EventsPage` close (✕) button lacks an `aria-label` (the other guest modals have one) and its 🗓 glyph could be `aria-hidden`; a few guest error strings use `text-red-500` instead of the design-system red `#8a1a1a`.

### Social sign-in (Google LIVE; Apple built + flag-gated) — Jul 8 2026

**STATUS:** Google social sign-in is **BUILT, LIVE, and END-TO-END TESTED on prod** (new-account + demo paths DB-verified). **Apple is built but flag-hidden** (`VITE_SOCIAL_APPLE` unset) — postponed until the Apple Developer account is accessible.

**COMMITS (chained on docs HEAD `94ad5a5`):**
- **`73c228c`** — social sign-in core: `SocialAuthButtons` (Google + Apple; gated behind `VITE_SOCIAL_AUTH`; Apple additionally behind `VITE_SOCIAL_APPLE`; renders `null` when off) on Login + Signup; `AuthCallback` (`/auth/callback`) resolves the OAuth session via `getUser` polling and routes; `CompleteProfile` (`/complete-profile`) first-login brand bootstrap. code-reviewer + security-auditor PASS.
- **`5d39c6a`** — dashboard: warm first-time welcome for brand-new hosts (`welcome_seen_at` null) across header + empty-state + welcome modal (shared `greeting` string; new `welcomeTitle` for the modal; warmer modal body). Presentation-only.
- **`ad3d699`** — Google-on-demo (identity-tied): `api/demo-claim.ts` (NEW) + `SocialAuthButtons` `onBeforeRedirect` + `AuthCallback` demo-intent routing + `Demo.tsx` Google entry. code-reviewer + security-auditor PASS.
- **`65229d1`** — demo step-1 reorder (location first, Google prominent). Presentation-only.

**ARCHITECTURE / KEY DECISIONS (durable facts):**
- **Flow type UNCHANGED — implicit/hash (no `flowType` set).** `ResetPassword` depends on the recovery token arriving in the URL hash (`type=recovery`) + the `PASSWORD_RECOVERY` event — do NOT switch to PKCE or it breaks. OAuth on the implicit flow returns the session in the URL hash, auto-captured by `detectSessionInUrl` (default on); `AuthCallback` polls `getUser` (~5s) to resolve it.
- **OAuth hosts-row bootstrap gap.** `handle_new_user()` sets `name` (from `user_metadata.first_name`, default `''`), `contact_email`, `subscription_status='trial'`, `plan='trial'`, `tier=1`, `trial_ends_at` — but NEVER `brand_name`. Normal `Signup` writes `name`/`brand_name` in a client UPDATE after `signUp`; an OAuth first-login skips that and Google/Apple don't supply `first_name`. **`CompleteProfile` (`/complete-profile`)** closes this: self-guarded, prefills first name from provider metadata (`given_name` / first token of `name`), writes `name` + `brand_name` + `contact_email` (same single-retry-on-zero-rows pattern as Signup), fires `/send-welcome`, then → `/choose-plan`.
- **`AuthCallback` routing order** (reads `select('name, brand_name, is_demo')`): `host.is_demo===true` → `/dashboard` (Layout shows the wall if expired); else pending demo intent + `brand_name` empty → `/demo`; else pending demo intent + `brand_name` set → `/dashboard`; else `brand_name` empty → `/complete-profile`; else admin email → `/admin`; else → `/dashboard`.
- **Post-auth plan gate unchanged.** A new OAuth host (trial, no `stripe_subscription_id`, not exempt, not demo) hits `PrivateRoute`'s existing `/choose-plan` gate. `PrivateRoute` untouched.
- **Account linking = Supabase default, VERIFIED (not assumed).** Supabase auto-links a social identity to an existing user when the email matches AND is verified. Email confirmation is disabled (email/password users auto-verified) and Google/Apple return verified emails, so same-email link works with NO extra toggle.

**GOOGLE-ON-DEMO (identity-tied demo → subscribe keeps the SAME account):**
- Problem: `signInWithOAuth` cannot stamp `user_metadata.is_demo=true`, and `demo-create`'s create-gate REQUIRES it. Solution = `api/demo-claim.ts`.
- **`api/demo-claim.ts`**: POST-only, `no-store`, Bearer host-auth (anon `getUser`) → service-role AFTER auth; 5/min IP+user limiter; scrubbed logs; generic errors. **DENY-BY-DEFAULT eligibility** (`host.is_demo!==true` AND `subscription_status='trial'` AND no stripe sub AND 0 apartments) → sets `user_metadata.is_demo=true` via `admin.updateUserById` **PRESERVING existing metadata**; best-effort own-row backfill of empty `hosts.name` from the typed first name (non-fatal). Idempotent: unexpired demo → `{ok:true,already:true}`; **EXPIRED demo → `{ok:false,reason:'not_eligible'}`** (caller routes to `/dashboard` = the wall). It is a **SECOND independent gate** — `demo-create` still re-checks every condition; the Turnstile/AI money-gate stays at `demo-create` (`demo-claim` spends nothing, no captcha). **`api/demo-create.ts` and `api/demo-precheck.ts` are UNTOUCHED.**
- **Client:** `/demo` step 1 persists `{ city, neighbourhood, street, streetNumber, firstName, ts }` to sessionStorage key **`arrivly_demo_intent`** (stale >30 min) BEFORE the Google redirect (`SocialAuthButtons onBeforeRedirect=persistDemoIntent`; returning `false` aborts). Google → `/auth/callback` → back to `/demo`, which claims eligibility (`demo-claim`) then hands off to the EXISTING step-3 Choose + fresh-Turnstile → `demo-create` path. sessionStorage survives the OAuth round-trip (same tab). **Demo hosts intentionally have `brand_name` NULL** (never collected) — hence `AuthCallback` must NOT send demo users to `/complete-profile`.
- **Demo step-1 reorder (`65229d1`):** City+Neighbourhood → Street/Street number → "continue with" divider + Google → "or" divider (gated on `VITE_SOCIAL_AUTH` so it never floats) → email/OTP form. `autoFocus` moved to City. OTP flow byte-unchanged.

**TESTING DONE:**
- **New-account Google sign-in:** → `/complete-profile` (brand) → `/choose-plan` → Stripe Checkout → `/dashboard`; DB-verified (`auth_provider` google, `name`+`brand_name` written, welcome email fired, trial + sub).
- **Google-on-demo:** `/demo` → Continue with Google → step-3 Choose → seeded demo dashboard; then convert (Start free trial) → **same host id retained**, `is_demo` cleared, apartment+booking preserved, real Stripe trial sub attached. DB-verified.
- Both test hosts (Google identity, `arrivlyudyarrivly@gmail.com`) deleted after testing; DB clean (7 real hosts intact). NOTE: converted-demo deletions leave an orphaned Stripe TEST subscription (harmless).

### Free 48-hour demo flow (BUILT + LIVE + END-TO-END TESTED) — Jun 30 2026

Status: **BUILT + LIVE + END-TO-END TESTED (Jun 30 2026).** `VITE_DEMO_ENABLED=true` is set in the Vercel **Production** scope; a `--force` prod redeploy baked the flag in, so the landing **"See a live demo"** button routes to `/demo`. Supabase **global CAPTCHA stays OFF** (so login/signup/reset keep working) — the demo path is bot-protected by our OWN server-side Turnstile verify. **Tests A–E all PASS end-to-end on live prod** (see "Demo testing — DONE (Jun 30 2026)" below) — the feature is DONE.

PURPOSE: a logged-out visitor spins up a REAL, fully-populated branded guest page for their own city/neighbourhood — free for 48 hours, **no card to start** — then "keeps it" by converting into a normal host account (set password → **Stripe Checkout for the chosen tier**, card captured at checkout exactly like every normal host; the 14-day trial is still free). The whole surface is gated behind `VITE_DEMO_ENABLED` (now `true` in prod; was inert through every build stage).

**CONFIG REQUIREMENT — Supabase Auth Email OTP length MUST be 6** to match `Demo.tsx`'s 6-box verify input. (It was found set to **8** during testing and corrected to **6** — do NOT revert.)

DB (server-only WRITE; SELECT-readable by the owner): `hosts.is_demo` (bool NOT NULL default false), `hosts.demo_expires_at` (timestamptz). Service-role-only table `app_settings.demo_hours` (default 48) + `app_settings.trial_days` (14). Migration `add_hosts_ui_state_client_writable` is unrelated (Host Guide); the demo columns were added in the demo foundation. UPDATE on `is_demo`/`demo_expires_at` confirmed granted to `postgres`+`service_role` only (verified).

ENDPOINTS (all `api/`, `.js` relative imports, no-store, key-scrubbed logs, generic errors):
- **`api/demo-precheck.ts`** — PUBLIC POST `{ email }`, no auth, 10/min IP limiter. Disposable-domain block (`api/_lib/disposable-domains.ts` `isDisposableEmail`) → `{ok:false,reason:'disposable_email'}`. Service-role lookup of `hosts.contact_email` (case-insensitive, LIKE-wildcard-escaped) → non-demo host `account_exists` · unexpired demo `{ok:true,resume:true}` · expired demo `{ok:false,reason:'demo_expired'}` · else `{ok:true}`. Leaks nothing beyond those reason codes.
- **`api/demo-create.ts`** — Bearer host-auth (anon getUser) → service-role; 5/min IP limiter. **Idempotent RESUME** for the caller's own unexpired demo (body `{}`; ensure 1 apartment + 1 active seeded booking). Else **fresh-create**, deny-by-default: requires `is_demo!==true` AND `subscription_status='trial'` AND no Stripe sub AND **0 apartments** AND **`user_metadata.is_demo===true`** (only the `/demo` OTP flow sets that — a normal signup can never be demo-ified). **CAPTCHA money-gate:** `verifyTurnstile(turnstileToken, clientIp)` (`api/_lib/turnstile.ts`, fail-closed) runs BEFORE any host mutation / apartment / AI → `403 captcha_failed` on fail. On create: flip host (`is_demo=true`, `demo_expires_at=now+demo_hours`, `property_cap_override=1`, `tier=1`, `trial_ends_at=demo_expires_at`); seed 1 apartment (best-effort geocode — **door-level when the optional Street/Street number is given, else neighbourhood-centroid** — `is_visible=true`, `accent_color` NULL, **`country` auto-derived from the geocoder**); seed 1 active booking (guest **"Alex"**, `check_in=today-1`/`check_out=today+3` UTC, confirmed, manual, fresh `ARR-` token); **seed the static showcase `apartment_details` (BOTH paths) + the city hero image (BOTH paths) — see SHOWCASE SEEDING below**; `path:'quick'` **additionally** best-effort seeds guide + ≤2 host picks (derived from the guide) + city events, **each in its own try/catch** (a generation failure NEVER fails create); `path:'full'` skips AI. Every seed step is best-effort/non-fatal.
- **`api/demo-convert.ts`** — Bearer host-auth → service-role; 5/min limiter. **Idempotent** (`is_demo!==true` → `{ok:true,already:true}`, never re-trials a real account). Flips via service-role ONLY: `is_demo=false`, `demo_expires_at=null`, `subscription_status='trial'`, `trial_ends_at=now+trial_days`, `property_cap_override=null` (inherit tier-1 cap; tier stays 1); **re-publishes apartments** (`is_visible=true`). The PASSWORD is set client-side via `supabase.auth.updateUser` — the endpoint never sees it.
- **`api/cron-demo-expiry.ts`** — HOURLY (`vercel.json` `0 * * * *`, `isCronAuthorized` Bearer CRON_SECRET, fails closed), service-role. (1) **Idempotent guest-page close** — `apartments.is_visible=false` for EVERY lapsed demo each run (decoupled from the status flip so a transient close failure self-heals; the live guest page is gated on `is_visible`, NOT `subscription_status`). (2) **Atomic claim** — one `UPDATE…RETURNING` flips `subscription_status='expired'` once per host (no double-email under overlap) + best-effort `demoEndedEmail` (recipient from the DB row only).
- **`api/cron-demo-purge.ts`** — DAILY (`vercel.json` `0 7 * * *`, `isCronAuthorized` Bearer CRON_SECRET, fails closed), service-role. **Data-minimisation**: deletes UNCONVERTED demos + all their data 1 day after expiry. **DENY-BY-DEFAULT eligibility**: `is_demo=true` AND `demo_expires_at < now() - interval '1 day'` AND `stripe_subscription_id IS NULL` (so converted/real hosts NEVER match, and the **1-day window preserves the convert-after-expiry recovery path**). Per host (per-host try/catch, idempotent, **batch-capped 200**, logs counts only — no PII): capture the booking `guest_id`s → **delete those guests FIRST** (since `bookings.guest_id` is `ON DELETE SET NULL` and `guests` is NOT cascaded, so this is self-healing on partial failure) → `auth.admin.deleteUser(hostId)` **cascades `auth.users` → `hosts` → `apartments` → ALL child rows** (details/qr_secrets/bookings/events/greetings/optins/guides/picks/messages/push). Demos use a remote Unsplash `city_image_url` (no Storage upload), so no Storage cleanup.

CLIENT (all behind `VITE_DEMO_ENABLED==='true'`; non-demo users completely unaffected):
- **`src/components/demo/Demo.tsx`** (`/demo`, public, flag-gated → `<Navigate to="/">` when off) — 3-step card in `AuthShell`: Your place (name/email/city/neighbourhood + Turnstile) → precheck → `signInWithOtp({ shouldCreateUser, captchaToken?, data:{ first_name, is_demo:true } })` → Verify (6-digit OTP) → `verifyOtp` → Choose (Quick/Full; a FRESH Turnstile token captured here, sent as `turnstileToken`). Intents create/resume/expired; `account_exists` dead-ends to login.
- **`src/components/demo/TurnstileWidget.tsx`** (managed Turnstile, public site key) · **`KeepDemoModal.tsx`** (convert dialog: read-only email + password≥8 → `updateUser(password)` → `/demo-convert {}` → **then the NORMAL new-host path**: with a chosen `tier` ≥1, `POST /create-subscription { tier, flow:'signup' }` → `window.location.href = Stripe Checkout url`; on any failure or no tier → `/choose-plan`; full a11y + in-flight guard) · **`demoTime.ts`** (`demoRemaining`) · **`BeYourGuestCard.tsx`** (QR + open-guest spotlight) · **`UpgradeWall.tsx`** (lapsed-demo wall: 4 PlanCards reusing `PlanCard`+`tierCopy`, **each CTA passes its `tier` via `onKeep(tier)`**; **Pro/tier-4 renders a disabled "Coming soon" CTA mirroring ChoosePlan**; plans-failed fallback passes `onKeep(0)` → `/choose-plan`; + Sign out).
- **`Layout.tsx`** (is_demo-gated): demo sidebar widget (48h countdown + "Start free trial") replaces the trial widget; **Billing nav hidden**; tracks **`selectedTier`** (wall `onKeep(tier)` ≥1 → that tier, else null; active 'keep it' = null; reset on modal close) and passes it to `KeepDemoModal`; `demoExpired` (client clock OR `subscription_status==='expired'`) renders `UpgradeWall` instead of the Outlet for every `/dashboard/*` route. **`Dashboard.tsx`**: demo banner + "Be your guest" spotlight (active seeded booking token); its banner opens `KeepDemoModal` with `tier={null}`. **`PrivateRoute.tsx`**: `is_demo` hosts bypass the `/choose-plan` card gate; its existing **`returnedFromCheckout`** bypass lands the converted host on `/dashboard` after Stripe success (never bounced to `/choose-plan`); non-demo byte-unchanged.

ENV: `VITE_DEMO_ENABLED` (public flag, prod=`true`) · `VITE_TURNSTILE_SITE_KEY` (public Turnstile site key, `0x4AAAAAADs_r_9q6e_4-9Id`) · `TURNSTILE_SECRET_KEY` (server-only, NO `VITE_`; demo fresh-create is fail-closed without it) · `UNSPLASH_ACCESS_KEY` (server-only, NO `VITE_`; city hero). All in `.env.example`.

**Social sign-in ENV (added Jul 8 2026):** `VITE_SOCIAL_AUTH` (public flag; buttons appear only when exactly `'true'`; **set `true` in Vercel Production this session**) · `VITE_SOCIAL_APPLE` (public flag; keep BLANK until Apple is configured, then `'true'`). Both in `.env.example` + `vite-env.d.ts`. Google provider Client ID/Secret configured in Supabase Auth; Supabase **Redirect URLs now include the 3 `/auth/callback` entries** (prod + master alias + preview wildcard) alongside the 2 existing reset-password entries (**total 5**). Provider "Authorized redirect URI" / Apple "Return URL" = `https://ptkabdelgxkgfslfialx.supabase.co/auth/v1/callback` (Supabase's callback, NOT the app's).

**SHOWCASE SEEDING (`demo-create`, BOTH Quick and Full).** Seeds static, identical-for-every-demo `apartment_details` in the **EXACT editor formats** (so they render on the guest page AND populate the `PropertySetup` editor tabs):
- **WiFi** — category `'WiFi'`, `is_private=false`, content `"Network: ArrivlyStay\nPassword: WelcomeHome2026"`.
- **House Rules** — category `'House Rules'`, `is_private=false`, single detailed row.
- **Check-in** — category `'Check-in'`, `is_private=true`, **FOUR rows**: `"Check-in from: 15:00"` / `"Check-out by: 11:00"` / `"Door code: 2049#"` / a free entry-instructions row.
Quick **additionally** seeds the AI guide + ≤2 picks + city events; Full skips AI. Optional door-level **Street / Street number** on the `Demo.tsx` "Your place" step (else neighbourhood-centroid geocode). Door/lockbox/WiFi values are intentional obviously-fake placeholders.

**CITY HERO IMAGE.** New shared **`api/_lib/city-image.ts` `fetchCityImage(city)`** (Unsplash, server-only `UNSPLASH_ACCESS_KEY`, best-effort/never-throws/never-logs-the-key): searches **`"{city} city"` then falls back to `"{city}"`** (so smaller cities like **Holon** resolve instead of the generic image; two sequential 4s searches, ~8s worst case). Writes `apartments.city_image_url` + `city_image_credit`. **Guest hero precedence: `hero_image_url` → `city_image_url` → `FALLBACK_HERO`**; the Unsplash credit renders top-right of the hero. `api/city-image.ts` (host editor path) was refactored to use the SAME helper (behaviour byte-faithful).

**COUNTRY AUTO-DERIVE.** `api/_lib/geo.ts` `geocodeAddress` now requests **`addressdetails=1`** and returns an **additive** `country?: string | null` (from `data[0].address?.country`); `demo-create` stores `apartments.country` (fixes the empty/placeholder Country in the Basics tab). Existing lat/lng-only callers (`guide.ts`, `host-picks.ts`) are unaffected.

**CONVERSION = the NORMAL NEW-HOST PATH (no longer a card-less trial).** A converted demo is a normal host whose 14-day trial captures a card at Stripe Checkout — same as every signup; the card-less demo trial was the anomaly. Flow: `KeepDemoModal` → `updateUser(password)` → `/demo-convert {}` (clears `is_demo`, re-publishes apartments, sets the fresh `trial_ends_at` baseline that `create-subscription` reads as the Stripe `trial_end`) → if a tier was chosen on the wall, `POST /create-subscription { tier, flow:'signup' }` → **Stripe Checkout for that tier**; on success returns to `/dashboard` via `PrivateRoute`'s `returnedFromCheckout` bypass (NEVER `/choose-plan`). The **active 'keep it'** path (no tier) and **any failure** → `/choose-plan` (standard new-host picker; no dead-end). `demoEndedEmail` copy was made honest: removed "No card needed" → **"no charge today, cancel anytime"** (keeps the 24h-or-removed urgency + `/dashboard` CTA). `Demo.tsx` ENTRY copy ("try free for 48h, no card") stays — the 48h entry is genuinely card-free.

OPEN/MINOR (record — do NOT build unless asked): `demoEndedEmail` lands in **Gmail Promotions** (deliverability polish only). A deleted converted demo can leave an **orphaned Stripe TEST subscription** (test-mode, harmless). The **Pro/tier-4 wall CTA is now a disabled "Coming soon"**. The sample **"Alex"** booking survives conversion and ages out in ~3 days. Demo length = `app_settings.demo_hours` (48). The OTP email send itself is NOT captcha-gated (relies on Supabase send limits) — revisit only if email-bombing is observed. `Demo.tsx` ENTRY copy stays genuinely card-free ("try free for 48h, no card").

### Demo testing — DONE (Jun 30 2026)

**Tests A–E all PASS end-to-end on live prod.** The feature is DONE.
- **A — Quick happy path:** landing → `/demo` → precheck `ok` → 6-digit OTP → silent Turnstile → Quick → seeded apartment + active "Alex" booking + showcase details + city hero + AI guide/events/picks; dashboard demo chrome (banner, 48h countdown, "Be your guest" spotlight, Billing hidden); guest page renders greeting + WiFi + rules + Explore + grounded chatbot + events; guest→host **Messages** round-trip arrives.
- **B — Full path:** Full skips AI but is otherwise fully populated; walked Basics→WiFi→Check-in→Rules→Branding→Picks→Extras inside the demo account; seeded booking + chrome present; saves work.
- **C — Anti-abuse:** `account_exists` dead-ends (no OTP) · disposable domain blocked (no OTP) · **resume/idempotency** re-enter same email → SAME demo, no duplicate apartment / no second AI spend.
- **D — Conversion:** password → `/demo-convert` → **Stripe Checkout for the chosen tier** → success → `/dashboard` (via `returnedFromCheckout`, not `/choose-plan`).
- **E — Expiry → wall → cron → convert-after-expiry:** client clock lapse → **UpgradeWall** shows immediately (pre-cron); hourly **`cron-demo-expiry`** closes the guest page (`is_visible=false`) + flips `status='expired'` once + sends `demoEndedEmail` (**Resend: Delivered**); convert-after-expiry from the wall → **Stripe Checkout (tier 2 verified)** → webhook set `stripe_subscription_id` + `tier`, `is_demo=false`, apartment re-published.
- **Purge:** `cron-demo-purge` eligibility **dry-run confirmed ZERO blast radius** on real hosts. All `+demo1..4` test hosts purged after testing (`auth.users` cascade + orphan guests removed) — **DB clean, 7 real hosts intact**.

### Host Guide system (DONE) — Jun 29 2026

In-app first-time + always-on host guidance, built on ONE modular content source feeding three surfaces. Client-only except the assistant endpoint + a single client-writable `ui_state` column. Chained on docs `112a6401`: `7463c85` (content module + Browse drawer) → `8719bae` (hint strips + Show-me-in-Guide + a11y nits) → `2b4804c` (Ask Arrivly endpoint + panel + mobile keyboard-grow). Each: code-reviewer PASS (0 must-fix after fixes); security-auditor PASS on the `ui_state` write (`8719bae`) + the endpoint (`2b4804c`); `npm run build` green.

- **PURPOSE — two browse surfaces + an assistant, ONE corpus.** (a) A docked, **non-modal** "Guide & help" drawer (sidebar toggle, NOT a NavLink — leaves the current page's nav item highlighted): **desktop** = right-side overlay (~392px) with **NO scrim** so the page stays fully usable; **mobile** = 40% bottom sheet with a **minimize-to-a-docked-pill** ("Guide ⌃") + ✕ close. (b) Per-page **first-visit hint strips** (slim cream/brass, "First time here"). (c) A host-auth **"Ask Arrivly"** assistant tab.
- **CONTENT MODEL (modular by design).** `src/guide/content.ts` — **PURE DATA, zero imports**, importable from both `src/` and `api/`. Exports `GUIDE_MODULES` (12 modules: `{ id, category, title, summary, body(markdown), status, related?, page?, tags? }`), `GUIDE_CATEGORIES` (5 task-based groups), and `moduleForPath(pathname)` (longest-prefix match on each module's `page` — `/dashboard` exact → home, `/dashboard/property/abc` → property, `/dashboard/qr` → guest-page-qr). **Human-readable source of truth = `docs/arrivly-host-guide-content-v1.md`** (the `.md` the typed module is generated from; each `##` section → one module, "In one line:" → summary, prose → body, the `live`/`coming-soon` heading tag → status). The SAME corpus feeds the drawer articles, the hint-strip summaries, AND the assistant. **Adding a feature later = add a module** (status `coming-soon` until it ships) — nothing else restructures. A tiny inline markdown renderer in `GuideDrawer.tsx` (no markdown dependency added) handles `###`/`>`/`-`/`**`/`*`/`` ` `` for article bodies.
- **TAXONOMY + COMING-SOON (best-practice grounded).** 5 task-based categories (NOT 12 flat): **Get set up · Your guest page · Run your stays · Plan & account · Fix a problem.** Coming-soon modules (**Earning more**, **Full booking**) render as short **"Coming soon" PREVIEW cards** under their category only, are **EXCLUDED from the first-visit hint strips**, never appear via `related`/for-this-page, and the assistant frames them as **not-yet-available** (never promises them).
- **`hosts.ui_state` (client-writable, dismissed-hint store).** jsonb, **NOT NULL default `'{}'`**, CLIENT-WRITABLE for the owner (column-level UPDATE grant to `authenticated`; RLS own-row `auth.uid = id`; the `hosts` server-only billing/tier columns are untouched — verified). Migration `add_hosts_ui_state_client_writable` (applied via MCP, "Stage 0"). Shape: `{ guideHints: { [moduleId]: true } }`. Every write is **read-modify-write** (re-reads `ui_state`, spreads `...current`, writes only `guideHints`) so sibling keys are preserved; scoped `.eq('id', userId)` (userId from server-verified `getUser`); updates **ONLY the `ui_state` column**; **errors swallowed** (never echoed to the UI); **optimistic** (local state first). `Layout.tsx` owns the state and provides a `useGuide()` context (`src/guide/guideContext.ts`: `openGuide`/`isDismissed`/`dismissHint`/`restoreHint`/`uiReady`) around the `<Outlet/>`. **`PageHint.tsx`** (single, route-aware, mounted once above the Outlet) renders **nothing** on **Home** (`/dashboard` exact — the welcome modal + next-step banner already orient there), on **coming-soon**, or before **`uiReady`** (avoids a flash). The sidebar shows a brass **"unseen" dot** per nav item until that page's hint is dismissed (gated on `uiReady`; skips Home + module-less/coming-soon routes). "Show me in Guide" on a hint opens the drawer **straight to that article** (`requestedModuleId`, consumed once so a later plain toggle still opens to the route section).
- **ASK ARRIVLY — `api/guide-assistant.ts`.** Host-only **POST** (Bearer → anon-client `auth.getUser(token)`, 401 if no user; **no guest-token path, no service-role client, ZERO DB reads**). Answers **ONLY** from static `GUIDE_MODULES` (imported from `../src/guide/content.js`) concatenated into a system instruction built **once at module scope** — **NO tools / NO googleSearch / NO web, NO secrets, NO per-host data**; coming-soon modules tagged `[NOT YET AVAILABLE]`; closed-domain prompt (answer only from the guide, never invent app behaviour, no general STR advice). gemini-2.5-flash, `thinkingBudget 0`, `maxOutputTokens 1024`, 20s timeout, 2 retries, key-scrubbed `console.warn`, strips `**`. Uses **`GEMINI_API_KEY`** (the base key — **NO new env var**, NOT the interim chat key; 500 `assistant_unavailable` if absent). Caps **message ≤600 / history ≤8** (filter valid roles → cap → ensure contents start with a user turn — same shape as `guest-chat`). Per-instance **~20/min** limiter keyed `${userId}:${clientIp}` → 429. Mirrors `guest-chat.ts`'s hardening; the deliberate divergence is the missing `tools` array (corpus-only, not web-grounded). The Ask tab UI lives in `GuideDrawer.tsx` (intro line, suggestion chips, Q/A thread, Enter+button send, calm error); the **mobile bottom sheet grows to ~85vh while the Ask input is focused**, back to 40% on blur (desktop overlay unaffected).
- **DEPLOY-WATCH RESOLVED.** The cross-dir `../src/guide/content.js` import bundles correctly on Vercel (same `.js`→`.ts` resolution as the `api/_lib/*.js` imports; `content.ts` is zero-import pure data). Confirmed: a GET to `/api/guide-assistant` on the READY prod deploy returns **405** (handler ran = module loaded) — no `ERR_MODULE_NOT_FOUND`.
- **NON-BLOCKING / BACKLOG (do NOT build unless asked).** `HostData` interface omits the now-fetched `ui_state` field (cosmetic typing only — `data` is loosely typed, no runtime impact). Benign best-effort race on rapid concurrent hint writes (acceptable for hint state; revisit only if other features start writing `ui_state` concurrently). Ask-tab nits: fuller inline error copy; collapse the mobile sheet on Send-button tap; fuller tab ARIA roving (cosmetic). Real **Terms/Privacy/Support URLs** still placeholders; the **Settings auth tickets** (change email/password, notification prefs, delete account & data) remain parked.

### S28 — Home greeting freshness (DONE) — Jun 28 2026

The multi-day "same greeting every open" problem is fixed end-to-end. **The old PARKED sketch (blurb VARIANTS at guide-time + a big "Right now in {neighborhood}" slot) was SUPERSEDED** — what actually shipped:
- **Suggestions are now PER-BOOKING** (not the old shared `(apartment, local_date, day_part)` cache that gave all guests the same ~4 lines/day → the constant "stroll to Café Regatta").
- **Day-part is a HARD allow/deny constraint** in the prompt (morning never shows evening/night content and vice-versa).
- **Anti-repeat is a SLIDING WINDOW** (do-not-repeat the booking's last ~6 suggestions), not absolute history.
- **Stay-day awareness:** `stay_day = local_date − check_in + 1` nudges variety by day of stay.
- **Blurb shows on FIRST OPEN ONLY** (per-booking flag); **blurb VARIANTS were DROPPED as unnecessary** once the blurb became first-open-only.

**Five-part delivery:**
- **Stage 1 (migration `daily_greetings_per_booking_stage1`):** added `booking_id` (uuid, FK bookings cascade) + `stay_day` (int); moved uniqueness to `(booking_id, local_date, day_part)`; dropped the old `(apartment_id, local_date, day_part)` unique + the `apartment_id/local_date` secondary index; TRUNCATEd the disposable cache; KEPT `apartment_id` (NOT NULL) + its FK so the RLS join shape stayed valid. **Plan A:** `booking_id` added NULLABLE first, keeping the live endpoint working during the gap.
- **R1 (same session):** dropped the vestigial anon SELECT policy `daily_greetings_guest_read`.
- **Lockdown (migration `daily_greetings_service_role_only_lockdown`):** dropped `daily_greetings_host_all` (it was granted to role `public`). `daily_greetings` is now **RLS ON / ZERO policies / service-role-only** — identical governance to `city_events_cache` + `app_settings`. Security advisor: +1 by-design `rls_enabled_no_policy` INFO (now 5 such tables, 8 lints total) — all by-design/Pro-gated, no new WARN.
- **Stage 2 (`abd5202`):** `guest-access.ts` `GuestAccess` extended additively with `bookingId` + `checkIn` (single `PUBLIC` const on every non-verified path; `guest-chat.ts` unaffected — reads only `tier`/`guestName`); `daily-greeting.ts` gates on `verified && bookingId`, keys cache/insert/race-reselect on `(booking_id, local_date, day_part)`, computes `stay_day` via a UTC-midnight date diff, feeds the booking's last-6 suggestions as a do-not-repeat list; `greeting.ts` `generateDailySuggestion` gained a hard per-day-part ALLOW/DENY block, a bounded anti-repeat block, and a stay-day variety nudge — all model config preserved (gemini-2.5-flash, thinkingBudget 0, withRetry, AIza/key scrubbing). Response shape `{ suggestion }` unchanged → no client contract change. **code-reviewer + security-auditor PASS** (0 confirmed risk).
- **Stage 2b (migration `daily_greetings_booking_id_not_null`):** cleared any NULL-booking rows (none) and set `booking_id` NOT NULL once the deployed endpoint guaranteed it. `stay_day` intentionally stays nullable.
- **Stage 3 (`8771612`, `GuestPage.tsx`, UI-only):** blurb shows only on a booking's first active open (per-booking `localStorage` flag `arrivly_guest_blurb_seen_<token>`, synchronous init to avoid flash, active-gated ref-guarded mark-seen effect mirroring the `arrivly_guest_push_autoprompt` pattern; a neutral/non-active visit never consumes the first-open blurb; preview/no-token always shows it). Letter reduced to `{salutation}.{showBlurb ? ' '+blurb : ''}` with the inline weather+suggestion removed. New **"Right now" primary card** after the letter (3px accent top bar, `bg-[#fffdf9]`/`border-[#e9e4d9]`/`rounded-2xl`, `max-w-lg`; "Right now" eyebrow + muted day-part label + weather pill `{temp}°C·{condition}{icon}` when weather present + suggestion body), gated on `(dailySuggestion || staticWeatherLine)` so it never renders empty. **Two reviewer-confirmed spec deviations:** omitted the unused `setShowBlurb` (`noUnusedLocals`; value decided once at mount), and used the file's established muted token `#9a958c` (the spec's `#8a8378` has 0 occurrences — honouring "don't invent tokens"). **code-reviewer PASS;** no security-auditor needed (UI-only, gates content already shown to the same verified guest).

**YC-3 — accept-and-document:** `condition` is the only guest-controlled free-text reaching the daily-suggestion prompt; it's capped at 100 chars and the prompt carries NO private apartment data, so a successful injection only skews that one verified guest's own ≤30-word line on their own screen — **no exfiltration path.** Revisit (sanitise/segregate `condition`) ONLY if that prompt ever gains private apartment data.

**Verification on record:** test booking **ARR-EVT777** (Sweet home, active through 2026-06-29). First verified open wrote `booking_id` + `stay_day=4` (afternoon) — per-booking write proven under the NOT NULL constraint. Anti-repeat + hard day-part are empirically confirmable on a second day-part open (e.g. an evening open should return a non-coffee, evening-appropriate pick that isn't the afternoon's Café Regatta).



---

## Pre-live work items 1–8 (all DONE, S16–S19)

Pre-live work, in priority order (Udy-set, S16; updated S17):

1. ~~**Demo / preview guest page.**~~ **DONE S17** (`06b3168`, `dad5bd2`) — `?preview=1` server-gated; owner + admin; full real page incl. private details; fidelity (sample chat, inert More-tab cards).
2. ~~**Admin "View as" guest page broken.**~~ **DONE S17** (`06b3168`) — fixed via same preview mechanism; SuperAdmin "Preview guest page ↗" link added.
3. ~~**Multi-property add + plan-cap enforcement.**~~ **DONE S18** (`29857da` caps UI, `a95b3d6` deferred creation, `679c4d3` + `3dbf724` warm greeting). DB trigger `enforce_property_cap` is the authoritative guard; dashboard add card gated with at-cap upgrade nudge + "X of Y used"; apartment creation deferred to first save. (Warm time/weather-aware guest greeting shipped alongside.)
4. ~~**Live/Draft publish toggle.**~~ **DONE S19** (`6fc9a89`) — dashboard property card Publish/Unpublish button writing `apartments.is_visible` (host-RLS-scoped, no host_id from client); badge relabelled Live/Draft; new properties stay Live by default (no migration). Unpublished properties now show a branded "temporarily unavailable" guest screen via `api/guest-availability.ts` (`47a1335`) instead of the booking-oriented neutral page.
5. ~~**Guest-data security close-out.**~~ **DONE S19** — `api/guest-state.ts` service-role resolver + keyed QR URLs; `bookings_guest_read` anon policy dropped; GuestPage no longer reads bookings/guests directly. Verified anon reads 0 bookings + 0 guests. (Residual: `guests` still readable by all authenticated hosts — see Tracked security follow-ups.)
6. ~~**Two billing edge tests + pipeline verification.**~~ **DONE S19 cont.** — Scenario 5 (payment fail → grace) + Scenario 6 (renewal → silence) via test clock; plus host-initiated upgrade/cancel/resume and subscribe-from-zero. Also fixed a Stripe key/env mismatch that had silently 500'd the webhook on every event since the Anna's Stays incident (pre-live; only test hosts affected).
7. ~~**Cleanups.**~~ **DONE S19 cont.** Landing copy DB-driven via `api/public-pricing.ts` (edge cache 60s). Prompt B (`360a987`): removed the "QR scans" tile (grid-cols-3→2); wired the "City guide" tick to `guide_recommendations` existence (`guideByApt.has(apt.id)`); Layout sidebar CTA → "Manage plan" when `stripe_subscription_id` is set. All pre-live cleanup items now closed.
8. ~~**Remove the 2-day change-reminder cron + drop `hosts.change_reminder_sent_at`.**~~ **DONE S19** — cron already absent from the codebase (zero references found); column dropped via migration `drop_unused_change_reminder_sent_at` (was all-NULL, no code or DB dependencies).

**Shipped S19 (this session):** greeting-blurb fix (`8a5dc35` — opens by naming the place; bans the "Stepping out," / participial opener); Live/Draft publish toggle (`6fc9a89`); branded "temporarily unavailable" guest screen for unpublished properties (`47a1335`); dropped unused `hosts.change_reminder_sent_at` (#8 done).

**Phase G CLOSED (S25). Phase H IN PROGRESS — host dashboard (S26–S27).** Order: landing (SHIPPED S25) → host dashboard (in progress) → guest page (last). Dashboard **pass 1 SHIPPED S26** (`ba113d2`): Layout sidebar IA + Overview grid + QR grid (refresh controls removed from QR — relocated into the property editor in S27 pass 2b). Auth redesign + `/reset-password` (`1e03d95`) and branding icons (`a8d6c64`) also shipped S26. Dashboard **pass 2 SHIPPED S27** (`981bd5b` 2a + `fd32109` 2b): account-wide Branding + LIVE colour model + property-editor redesign with "Guide & events" + "Look" tabs (see "S27 — pass 2 (DONE)" below). NEXT = remaining dashboard surfaces (Bookings / Messages / Billing / Settings, mockup-first) then the guest-page pass. The pentest gate (h) runs once after Phase F, just before the live flip. Rides just before the flip: Batch C `npm audit fix` + leaked-password toggle + ~~landing page: add the comps-comparison sales pitch/table~~ **DONE (`aec0c6c` + `cd983a9`, Jul 26 2026)** — 4-tier pricing grid + 9-row comps table vs Hostfully/Touch Stay shipped (Bemgu flat **€25 / up to 12 properties on Portfolio** — NOT "unlimited"; 3 earning marketplaces; AI concierge; host keeps 100% of commissions; ~2–3 tour bookings/month covers the fee); see "Landing — 4-tier pricing + comps section" above + **(added Jul 17 2026) fill the Privacy Policy + Terms of Service links on the Google consent screen** (currently EMPTY — required before marketing launch) + **(added Jul 17 2026, optional) Supabase Custom Domain (paid) for auth** so the Google popup shows `auth.bemgu.app` instead of the `supabase.co` project URL (polish + brand-verification eligibility) + **(added Jul 17 2026, optional) email polish** — add a Bemgu sign-off + branded subjects to the Supabase auth email templates. Interim: flip `GEMINI_API_KEY_CHAT` to billed once Google payment resolved.


---

## Roadmap to v1 (locked 2026-06-02) — as originally written

## Roadmap to v1 (locked 2026-06-02)

Build order A→I, THEN flip to live (revised S16: Phase I — monetisation — completes BEFORE live payments). Reorder only by explicit decision.

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
- **D — Superadmin:** COMPLETE ✓ — D1 overview API + UI + admin routing (`b8f41d5`); D2 read-only "View as" + `admin_audit` (`09b9e50`); D2.1 enriched View-as + plans `label` fix (`bf4e318`, `b2015d2`); D3a host Manage drawer + `api/admin-update-host.ts` (tier/status/price/discount/cap/trial extend, 6-key allowlist, audited) (`909dda5`); D3b global Plan-settings panel (`api/admin-plans.ts`, edits tier price+cap and `app_settings.trial_days`) + Activity-log view (`api/admin-audit.ts`) + fixes: MRR/totals re-fetch after Manage save, discount preview clamped 0-100, `mobile-web-app-capable` meta tag (`3fc401d`). Business model: 4 tiers, flat price per tier, dashboard-editable; Tiers 1-3 guest-page at rising caps, Tier 4 adds booking. Lifecycle status and tier are independent dimensions. PRE-STRIPE: all admin edits set intent + move MRR projection only — they charge no one (money/destructive actions wait for E). D4 — billing-tab tier cards (plans read client-side) + `src/lib/tierCopy.ts` + `api/set-tier.ts` inert pre-Stripe seam (403 billing_not_live) (`ec77806`).
- **E — Billing (Tier-1 Stripe):** E1 DONE ✓ (`23a4abd`) — create-subscription + billing-portal + `api/_lib/stripe.ts`, verified in Stripe TEST sandbox. E2 DONE ✓ (`bb077e6`) — stripe-webhook (raw-body, signature verify, Arrivly isolation, idempotent sync); lifecycle emails; guest-page host fetch via SECURITY DEFINER RPC; `showPoweredBy` = trial || grace. E2.1 DONE ✓ (`a18f9ec`) — 7-channel subscription-change fan-out; dismissible `billing_notice` banner; ntfy live. E3 DONE ✓ (`b827ecb`→`71a974c`) — in-app plan switching, cancellation/resume, BillingPanel manage-mode, deferral + webhook triple-fire fixes. E (S15) DONE ✓ (`a67c50d`→`b3b8c23`) — immediate prorated upgrades (402 on card fail), enriched emails+ntfy, billing panel unlocked during a pending downgrade (upgrade/re-target/cancel; one cancel-scheduled control), cancel-subscription release-then-cancel, request-time host+admin emails. **Phase E close-out (S16):** 360 webhook test COMPLETE (all 4 scenarios); signup-with-card shipped. Remaining go-live items moved to "On the horizon" below; the 2-day change-reminder cron is DROPPED (Udy, S16).
> **BUILD ORDER (reordered S19 cont.): G → H → I → F → flip live.** Phase F (Tier-4 booking) moved to the end. The A–E phases below are already complete; the remaining order is G, then H, then I, then F.
- **G — Pre-launch hardening:** cron follow-ups (sync-ical real-feed test), iCal SSRF blocklist + rate limit (DONE S20), cron batching/maxDuration at scale (DONE S22 — `mapPool` concurrency pool, sync-ical 4 / refresh-events 2), mobile drawer a11y (Escape-to-close, focus trap, dialog semantics — DONE S23), dead-code sweep (DONE S23), full security audit (DONE S24 — 0 critical/0 high; F-01/F-02 + fn hardening fixed). Plus: server-side file-size cap in `api/create-upload-url.ts` (DONE S22 — bucket `file_size_limit`/`allowed_mime_types` authoritative + per-kind declared-size pre-check); auto-delete old Storage objects on cover/logo replace + remove (partially done: `1cde275`); message retention ~90-day cleanup job post-checkout (DONE S22 — `cron-cleanup-messages`); rate-limit/verify-gate public guest-facing AI endpoints (`city-events` DB-cached S20; `guest-chat` verify-gated + limited + dedicated key S20–S21; `daily-greeting` already verified + cached; `generate-guide` host-auth). **PHASE G CLOSED (S25): items a–g complete.** The pentest/"hacker" pass is NOT a G-internal task — it is the dynamic/offensive pre-live gate that runs ONCE, after Phase F, immediately before the flip, on the complete surface (so H/I/F additions are all in scope). Rationale: a pass run now would be invalidated by H/I/F surface added on top of it, and would skip F's booking/payment flow — the highest-value offensive target. Defensive coverage in the interim is the standard `security-auditor` on every auth/RLS/API-route change. Uses the existing "hacker" skill — no separate agent to author.
- **H — UI/UX design polish:** Dedicated visual-quality pass once core features work end-to-end; design-system refinement, guest-page + dashboard polish, consistency sweep; mockup-first. Deferred deliberately so polish lands on a stable surface.
  - **Refresh-button confusability:** QRCodePanel shows two near-identical adjacent buttons per property — "↻ Refresh guide" and "↻ Refresh events". Too easy to click the wrong one (observed in S20 testing). Both work correctly; this is purely a visual/spatial fix — distinguish, separate, or group/relabel them.
- **I — Monetisation iteration (data-driven):** (a) pricing/packaging experiments, annual billing, discounts/referrals, trial-to-paid conversion, churn — not yet started; (b) **third-party experience connectors — SHIPPED (Stages 0/4A/4B, Jul 26 2026):** Viator + GetYourGuide + Tiqets on the guest Explore tab, c-full revenue model live (Bemgu earns T1–2, host earns T3+), per-apartment campaign attribution. Only Stage 5 (reporting ingest) remains. Full detail in "PHASE I — EXPERIENCE CONNECTORS" above. (OpenTable/TheFork were DROPPED at scoping.)
- **F — Tier-4 full booking system (MOVED TO END):** Full booking (availability → request → approve → pay → manage) on the €49 / Tier-4 price, referencing Anna's Stays components (read-only). Built on the verified Stripe pipeline. Tier-2 architecture has stayed upgrade-ready throughout (plan-gated component slots; bookings/guests schema already supports it).
- **PRE-LIVE GATE — pentest/"hacker" agent (HARD, Udy S19 cont.):** before the live Stripe flip, run a dedicated security/penetration-test pass in addition to the standard security-auditor. Must pass. Sits in/after Phase G.
- **Flip Stripe to live (LAST):** create live products/prices/webhook, set live keys in Vercel, re-verify price→tier mapping, redeploy, clean up sandbox test data. **OPEN: whether F ships before or after this flip is NOT yet decided (see "On the horizon"). To be settled after G/H/I.**

Tier-2 architecture stays upgrade-ready throughout (plan-gated component slots; bookings/guests
schema already supports it).

Tier differentiation beyond property caps is a wanted direction (not iterated yet). Future per-tier feature flags follow the existing `plans.includes_booking` precedent (e.g. `includes_experiences`). Do NOT add flags or gate features until the differentiation is iterated with Udy.

---



---

## Phase C — Communication (COMPLETE)

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



---

## Shipped — S19 cont. through S24 (Jun 2026)

- **Step 2 — geocoding → LocationIQ** (`0d31967`, attribution `98ee376`). `LOCATIONIQ_API_KEY` set in Vercel (production + preview); LocationIQ free tier = no card, ~5,000/day, 2 req/sec, EU endpoint `eu1.locationiq.com/v1/search`, permits permanent storage of results. `api/_lib/geo.ts` rewritten for LocationIQ EU forward geocoding: parses the JSON array's lat/lon STRINGS (`"lon"` not `"lng"`) with `Number.isFinite` guards; silent/never-throw (key-in-URL never logged); module-level rate gate spacing request START times ≥550ms (~1.8 req/s) so concurrent callers (guide 5×, host-picks up to 20×) stay under the 2/s cap with NO caller changes. `api/geocode.ts` now delegates to `geocodeAddress` from `./_lib/geo.js` (inline Google block + duplicate interface removed; Bearer auth + 250-char cap unchanged). GuestPage Explore tab shows an ungated attribution line "Location data © OpenStreetMap contributors · Geocoding by LocationIQ" (links to openstreetmap.org/copyright and locationiq.com). `GOOGLE_GEOCODING_API_KEY` REMOVED from Arrivly Vercel (production + preview); the actual Google Cloud key was left alone (possibly shared with Anna's Stays — any action on it is Anna's-Stays-side only). Result: every metered external API Arrivly uses is now no-card; no keys shared with Anna's Stays.
- **Step 3 — guest-data disclosure chain CLOSED** (`caf1c1e`, `eb7f6d7`, `8fa50ac` + DB-only Phase 5). Original chain: anon RLS `bookings_guest_read` (USING true) let anyone read every `reference_number`; `resolveGuestAccess` treated "valid token = in-dates confirmed booking" as verified; verified unlocked private door/WiFi codes (`guest-details`) + chatbot context. Fixed build-then-lock in 5 phases:
  - **Phase 1** — `apartment_qr_secrets` table + auto-provision trigger (see schema/DB functions above); 11/11 apartments backfilled.
  - **Phase 2** — `api/guest-state.ts` (NEW, service-role GET): returns `{ state: active|thankyou|neutral, token, guestName }`. Token path first (reference_number+apt+status confirmed/completed; `' 11:00:00'` Helsinki checkout cutoff → thankyou; inclusive in-dates → active), then KEYED date path (only when `?key` matches that apartment's `apartment_qr_secrets.qr_secret` → status=confirmed, check_in≤today<check_out, ref not null, order source desc). Flat neutral on every non-active outcome; wrong/missing key reveals nothing; inputs validated; best-effort per-instance IP rate limiter (30/60s → 429); truncated secret-free logs.
  - **Phase 3** — `api/qr-secrets.ts` (NEW, host-auth POST): Bearer→anon getUser→401; service-role client only after auth; resolves apartments by `host_id=user.id`; returns `{ secrets: { [apartment_id]: qr_secret } }` for the caller's OWN apartments only (never trusts client-supplied ids). `QRCodePanel.tsx`: guest URL is now `{appUrl}/guest?apt=ID&key=SECRET` (keyless fallback if a secret is missing); secrets fetched via `/api/qr-secrets`.
  - **Phase 4** — `GuestPage.tsx` `fetchData` resolves state via `/api/guest-state` (plain fetch) in two stages — Stage A token path, Stage B keyed date path (reads new `?key` param; previous-guest protection preserved). NO direct bookings/guests reads remain; apartments / apartment_details(public) / guest_host_card RPC / expired check / guest-details private fetch / weather / PWA unchanged.
  - **Phase 5 (DB-only)** — migration `close_guest_disclosure_chain_lockdown`: dropped `bookings_guest_read` (anon); replaced `guests_host_read` with `USING(true)` scoped to role `authenticated` only. VERIFIED: anon reads 0 bookings + 0 guests; authenticated host still reads own bookings + guest list; security advisor shows no new issues.
  - **BEHAVIOUR CHANGE (intended):** a guest URL with apt only / no token / wrong key → neutral page. Keyed QR URLs carry the key; token URLs + localStorage-returning guests still work.

**S19 cont. (2026-06-23):** Post-hardening cleanups, a critical Stripe key/env fix, full billing-pipeline verification (#6), and DB-driven landing pricing (#7 part). HEAD `4e09d03`.
- **Quick fixes:** greeting-blurb prompt opens by naming the place + bans participial openers ("Stepping","Nestled","Tucked") (`8a5dc35`); dashboard Live/Draft publish toggle on `apartments.is_visible` (host-RLS-scoped; new properties default Live) (`6fc9a89`); branded "temporarily unavailable" guest screen for unpublished properties via new `api/guest-availability.ts` (anon GET, service-role after UUID validation, returns only {status, brand}) (`47a1335`); dropped unused all-NULL `hosts.change_reminder_sent_at` (migration `drop_unused_change_reminder_sent_at`); docs refresh (`44789a7`).
- **CRITICAL — Stripe key/environment mismatch fixed (Vercel env change, no commit).** During the Anna's Stays incident key rotation, `STRIPE_SECRET_KEY` was left pointing at a DIFFERENT Stripe environment than `STRIPE_WEBHOOK_SECRET`. Events passed signature verification but `subscriptions.retrieve()` failed → the webhook 500'd on EVERY billing event since the incident, silently. The app's real Stripe env is the SANDBOX holding `cus_UfOVHv9hahCr78` + the Arrivly product's three prices. Fix: Udy set `STRIPE_SECRET_KEY` to that sandbox's secret key (webhook secret + 3 price IDs already correct); redeployed; webhook 500→200. Pre-live, no real subscribers, so only test hosts were affected — no real billing harmed.
- **#6 billing pipeline — VERIFIED COMPLETE.** Inbound (test clock): Scenario 6 (renewal → silence) PASS; Scenario 5 (payment fail → grace) PASS. Outbound (host Roy): upgrade via `change-plan` ("upgraded" notice) PASS; cancel + resume via `cancel-subscription` PASS. Subscribe-from-zero: new host completed Stripe Checkout → trialing sub + "started" notice PASS.
- **Webhook isolation metadata is CASE-SENSITIVE:** subscription `metadata.app` must be exactly lowercase `arrivly` (`Arrivly` is silently ignored — 200, no update). Test/clock subs also need `metadata.host_id`. Clock artefacts: `cus_UkzljDJks6qaGC` / `sub_1TlTpFFgkuKMBYAu7yJaesdN`.
- **Landing dynamic pricing** — `9e2cff8`: new `api/public-pricing.ts` (anon GET, service-role, returns ONLY `{ trialDays, fromPriceEuros, currency }`; fail-soft to `{14,10,'eur'}`; per-instance IP rate limiter 60/60s; edge-cached). `src/App.tsx` `LandingContent` fetches it on mount (DB-matching defaults → no flash); copy now "Start free — {trialDays} days", "From €{fromPriceEuros}/month", "{trialDays} days free · No payment needed to start · Cancel anytime". Dead `config.ts` fields `trialDays` + `pricePerPropertyMonthly` removed. code-reviewer + security-auditor PASS. `4e09d03`: shortened public-pricing edge cache to `s-maxage=60, stale-while-revalidate=120` so admin trial/price edits show within ~1 min.
- **Test values reverted to defaults** after testing the dynamic flow: `app_settings.trial_days` = 14, `plans` tier 1 = €10. Tiers 2–4 untouched.
- **Pre-live cleanup #7 — DONE (`360a987`).** Dashboard: removed the placeholder "QR scans" metric tile (grid-cols-3 → grid-cols-2); wired the "City guide" completeness tick to real data (bulk `.in()` on `guide_recommendations` inside the existing Promise.all → `guideByApt` Set → `check(guideByApt.has(apt.id))`). Layout: sidebar trial-widget CTA now reads "Manage plan" when `host.stripe_subscription_id` is set, else "Add card" (NavLink target + countdown unchanged). code-reviewer PASS, no must-fix. This closes ALL pre-live cleanup items.
- **ROADMAP REORDER (Udy decision, S19 cont.):** Phase F (Tier-4 full booking) is moved to the END of the build order. New sequence: **G (hardening) → H (polish) → I (monetisation) → F (Tier-4 booking) → flip Stripe to live**. Rationale: ship the guest-page product's hardening/polish/monetisation first; booking is the last build phase.
- **OPEN DECISION (deferred, Udy):** does Tier-4 booking (F) ship BEFORE or AFTER the live Stripe flip? NOT yet decided — to be settled once G/H/I are done. Two options on the table: (a) F is the final build phase, then flip live (launch live with booking already built); (b) flip live on the guest-page product (Tiers 1–3) first, then build F as a post-launch addition. Do NOT bake either into plans until Udy chooses.
- **PRE-LIVE GATE (Udy, S19 cont.):** a security/penetration-test pass ("hacker" agent) is a HARD required gate before the live Stripe flip — in addition to the standard security-auditor. Runs as part of / immediately after Phase G hardening and must pass before go-live.

**S20 (2026-06-23):** Phase G hardening — iCal SSRF closed, city-events moved to DB cache. HEAD f1ef316.
- **iCal SSRF fix** (`f45d7ef`) — host-pasted iCal URLs were fetched server-side with no destination validation (SSRF). New `api/_lib/safe-fetch.ts` `safeFetchIcal()`: https-only; DNS-rebinding-resistant (Node `https.request` with a custom `lookup` that resolves + validates every IP against blocked ranges — loopback/private/link-local/CGNAT/metadata/multicast/reserved + IPv6 ::1/fc00::/7/fe80::/10/IPv4-mapped — at connect-time, so the kernel connects to the exact validated address); manual redirects re-validated each hop, cap 3; 10s timeout; 5MB body cap; never logs/echoes the URL (tokens). `api/_lib/ical.ts` uses it + url filter tightened to `https://`; generic host-facing error "couldn't be used (check it's a public https calendar link)" (no blocked-vs-network distinction, no probing signal). `api/sync-ical.ts` got a per-instance per-host rate limiter (5/min, keyed on verified userId, after auth); cron untouched. code-reviewer + security-auditor PASS. VERIFIED by live attack: real Airbnb URL still syncs (DB row written); `169.254.169.254` + `127.0.0.1` both refused, 0 rows written, fast, no leak.
- **city-events → DB cache** (`f1ef316`) — was a live Gemini call on EVERY guest view (public AI-spend abuse surface + slow). Now cache-first. New table `city_events_cache` (above). New `api/_lib/city-events.ts` shared generator (exact prior Gemini config — gemini-2.5-flash, googleSearch grounding, thinkingBudget 0, 4096 tokens, same prompt + defensive fenced parse + https-scheme URL sanitize; withRetry; UTC day-granular 7-day window; key-scrubbed; returns {payload:null} on failure, never throws). `api/city-events.ts` rewired: public POST, reads cache → returns instantly with NO Gemini; only an uncached apartment triggers lazy-fill (rate-limited 5/min apt+IP); never caches a failed result; unchanged {week,categories}/{error:true} shape so the guest EventsPage needs no change. New `api/cron-refresh-events.ts` (daily `0 4 * * *`, isCronAuthorized-gated, refreshes ONLY visible apartments with a confirmed/completed booking current-or-within-7-days, *_block excluded, deduped; stale-safe — a failed generation never overwrites a good row; ntfy on wholesale failure). New `api/refresh-events.ts` (host Bearer + ownership-gated; 20h freshness gate → "up to date" without Gemini when fresh; per-host 5/min limiter; stale-safe upsert). `QRCodePanel.tsx` got a per-property "↻ Refresh events" button mirroring the guide-refresh UX. code-reviewer + security-auditor PASS. VERIFIED live: lazy-fill wrote 13 real Helsinki events to cache; re-open served from cache (generated_at unchanged = no Gemini call); host refresh on a fresh row returned "up to date" without regenerating.
- **Test data:** added a manual active booking to Sweet home (`d9614d11-…`) token **ARR-EVT777** (check_in current_date-1 → check_out +3) so the live guest page (Explore/events/chat) is reachable for testing — Maison Lumiere + Casa Marco bookings have ended (thank-you state). Kept permanently.

**S21 (2026-06-24):** Phase G hardening — guest-chat verify-gate + spend limiter, dedicated chat AI key, verified-guest address. HEAD adc9eee.
- **guest-chat verify-gate + per-instance rate limiter** (`9a53e19`) — `api/guest-chat.ts` now resolves the access tier and returns `403 { error: 'verify_required' }` for the `public` tier BEFORE any Gemini/brand/system-instruction work; only a verified in-dates booking token reaches the model (mirrors daily-greeting's verified-only spend gate). The live UI only mounts `<ChatBot>` on the active (token-bearing) guest page, so real guests are unaffected; this also closes a direct-script anonymous-quota-exhaustion DoS on the shared key. The verified path then passes a per-instance limiter (Map, 15 req/60s, keyed `${apt.id}:${clientIp}`, `RL_MAX_KEYS=5000` bounded-memory sweep) → `429 { error: 'rate_limited' }`. `ChatBot.tsx` got 403/429 branches before the generic error throw. **Best-effort, not a hard cap:** Vercel spreads requests across lambda instances (each with its own in-memory Map), so the 429 can't be observed reliably from outside — documented limitation, consistent with the `guest-state`/`city-events` posture. code-reviewer + security-auditor PASS.
- **Dedicated chat AI key + softer failure copy** (`58b76ed`) — `api/guest-chat.ts` reads `process.env.GEMINI_API_KEY_CHAT || process.env.GEMINI_API_KEY` (same fallback shape as the guides key). `GEMINI_API_KEY_CHAT` is a no-card key in a SEPARATE AI Studio project, so guest-chat has its OWN daily free-tier quota, isolated from the shared key. `ChatBot.tsx` 403/429/500 branches now show soft, wait-friendly copy ("I'm getting a lot of questions right now — please try again in a moment.") instead of "connection hiccup". **INTERIM:** this one key flips to a BILLED key once the Google payment issue is resolved → removes the free-tier daily cap (the verify-gate + limiter then bound spend). Groq cannot replace guest-chat — it needs googleSearch grounding. code-reviewer + security-auditor PASS.
- **Verified-guest street address in the chatbot** (`adc9eee`) — the chatbot said it didn't have the address because `api/guest-chat.ts` never selected `street`/`street_number` and `buildGuestSystemInstruction` never emitted them. Fixed: `guest-chat` selects `street, street_number`; `ApartmentCtx` gained both fields; `buildGuestSystemInstruction` computes `streetLine`/`fullAddress` and emits an `ADDRESS:` line under `APARTMENT DATA:` — **gated `access.tier !== 'public'`**, so the address bytes are never assembled into a public prompt (security-auditor explicitly confirmed public can never receive it). Verified live: chat answers "Runeberginkatu 17, Etu Töölö, Helsinki, Finland" for the ARR-EVT777 guest.
- **Diagnostic lesson:** the intermittent guest-chat 500s seen during testing were Gemini free-tier `429` quota errors (self-induced by an 18-call burst stress-test) plus transient `503` overloads — NOT our code. The free-tier DAILY cap does not reset within a minute.

**S22 (2026-06-24):** Phase G hardening — upload size cap (bucket + endpoint), message-retention cleanup cron, bounded-concurrency cron pool. HEAD adeaad3. All live + verified.
- **Upload size cap** (`31c8135`, Phase G item b) — TWO LAYERS:
  - **Layer 1 (authoritative, bypass-proof):** the `apartment-images` Storage bucket now has `file_size_limit = 5242880` (5 MB) AND `allowed_mime_types = ['image/png','image/jpeg','image/webp']`, set via migration. This is the real enforcement — a direct/hostile caller minting a signed URL cannot exceed it. The single bucket limit must clear the largest kind (hero 5 MB); the 2 MB logo limit stays a client-side + declared-size nicety, not a bucket-level guarantee.
  - **Layer 2 (defence-in-depth + clean UX):** `api/create-upload-url.ts` accepts an optional `size` and rejects an oversized DECLARED size per-kind (hero 5 MB / logo 2 MB) BEFORE minting the signed URL → `400 { error: 'file_too_large', maxBytes }`. Only a finite numeric size over cap blocks; missing/NaN passes through (the bucket is the gate). `src/lib/imageUtils.ts` sends `size: file.size` and maps `file_too_large` to a friendly message for both callers (BrandingPanel logo + PropertySetup hero). NOT the security boundary (a caller can lie about declared size) — documented as such in code. code-reviewer + security-auditor PASS.
- **Message-retention cleanup cron** (`16eca9e`, Phase G item c) — new `api/cron-cleanup-messages.ts` (daily 05:00 UTC, `isCronAuthorized`-gated, fails closed) calls a service-role-only SECURITY DEFINER function `public.cleanup_old_messages(retention_days int)` [migration `message_retention_cleanup_function`] that runs ONE set-based join delete of messages whose linked `booking.check_out < current_date - 90 days`. Anchor is `booking.check_out` (NOT message age); hard delete (data minimisation). `RETENTION_DAYS = 90` constant. ntfy only when `deleted > 0`; never throws. Function grants verified live: `postgres` + `service_role` EXECUTE only (no anon/authenticated); `search_path` pinned to `public`. `messages.booking_id` is NOT-NULL (no orphans; join-delete is complete). `vercel.json` got one cron entry. Verified safe: dry-run against live data = 0 deletions today (newest checkout ~mid-June 2026; first real deletions ~mid-Sept 2026), so all current test data is retained — consistent with the keep-all-test-data policy. code-reviewer + security-auditor PASS.
- **Cron concurrency pool** (`adeaad3`, Phase G item d) — new `api/_lib/pool.ts` `mapPool<T,R>(items, limit, fn)`: order-preserving index-cursor worker pool that caps in-flight work to bound wall-clock under the 60s function maxDuration. `cron-sync-ical` now runs apartment sync at concurrency **4** (network-bound iCal, each fetch already 10s-capped by `safeFetchIcal`); `cron-refresh-events` runs at concurrency **2** (deliberately low — each iteration is a Gemini call against the free-tier events key; keep quota bursts small). Behaviour-preserving: aggregation moved to a single post-pool sequential pass (no concurrent mutation of `byHost`/`errors`), stale-safe upsert and the exact `candidates>0 && refreshed===0` wholesale-failure ntfy condition both preserved; response shapes unchanged. No schedule/schema/`functions{}` change. **KNOWN PROPERTY:** `mapPool` leaves a slot `undefined` if a mapper THROWS rather than returns — not reachable today (both mappers are total / catch internally); the "keep mappers total" contract is documented in `pool.ts`. A future caller passing a throwing mapper must handle this. code-reviewer + security-auditor PASS.

**S23 (2026-06-24):** Phase G hardening — mobile-drawer a11y + dead-code sweep. HEAD 05ed610. All live + verified.
- **Mobile-drawer a11y** (`d2ffa1e`, Phase G item e) — the host dashboard hamburger drawer in `src/components/shared/Layout.tsx` gained complete modal a11y, ALL gated on `menuOpen` (only ever true on mobile — the hamburger sits in a `md:hidden` bar — so the static desktop sidebar is untouched): (1) Escape-to-close (document keydown listener, added on open / removed on close+unmount); (2) focus moves to the first nav link on open; (3) focus returns to the hamburger on close, but ONLY on a true→false transition (a `wasMenuOpen` ref prevents focus-steal on initial mount); (4) Tab/Shift+Tab focus trap (recomputes focusables each Tab via `a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])`, wraps last↔first, pulls focus back in if it escaped); (5) `role="dialog"` + `aria-modal="true"` + `aria-label="Dashboard menu"` present ONLY while open (absent when closed so the desktop sidebar is never announced as a dialog). Existing hamburger `aria-expanded`/`aria-controls`/`aria-label`, backdrop-tap-close, nav-link-tap-close, and all visuals preserved. No body-scroll-lock / resize handling (out of scope). Frontend-only — code-reviewer PASS (no must-fix); security-auditor not required. Verified live on mobile + keyboard + desktop (Escape does nothing to the desktop sidebar = correct gating).
- **Dead-code sweep** (`05ed610`, Phase G item f) — two-stage (report-only → approved removal). Deleted 4 unreferenced stub components (`BookingCalendar.tsx` [real calendar is `CalendarView` in `BookingManager.tsx`], `GuidesPanel.tsx`, `HostPicks.tsx`, `GuideModal.tsx`) + 1 orphaned asset (`public/arrivly-logo-lockup.png`); removed 10 legacy `src/config.ts` fields (`trialReminderDays`, `currency`, `stripePriceId`, `stripePublishableKey`, `poweredByOnTrial`, `poweredByOnPaid`, `appName`, `defaultTravelMode`, `guideRefreshDays`, `maxPropertiesByPlan`), keeping only the 5 live keys (`currencySymbol`, `colourPresets`, `adminEmail`, `appUrl`, `poweredByText`); removed the unused `getSearchUrl` export from `src/lib/maps.ts` (`getDirectionsUrl` untouched). `npm run build` was the hard backstop — any misclassified-as-dead TS file/field/export would have failed the compile; it passed (exit 0), confirming the set was truly dead. NOTHING under `api/`, no Tier-2 seams, no duplicated constants, no PWA wiring touched. code-reviewer APPROVED, no must-fix. (The transient `dead-code-report.md` working artifact was never tracked; deleted from disk.)

**S24 (Jun 24 2026):** Phase G item (g) — FULL SECURITY-AUDITOR PASS (report-first, two-stage like the dead-code sweep). Whole-surface read-only audit at c0229a8 → 0 critical, 0 high, 4 medium, 9 low/info; report kept as a gitignored untracked artifact (public repo).
- **Batch A** (DB-only, `security_fn_hardening_*`): pinned `search_path` on `set_updated_at` + `auth_owns_apartment`; revoked PUBLIC EXECUTE on `auth_owns_apartment` / `enforce_property_cap` / `handle_new_user` (kept `guest_host_card` anon-callable by design).
- **Batch B** (`81b3767` + migration `guests_tenant_isolation_lockdown`): new host-auth service-role `api/create-booking.ts` (Bearer→getUser→apartment ownership→service-role insert of guest + booking, ref-collision retry, no new side effects); `BookingManager.addBooking` now calls it, `randomRef` removed; dropped `guests_insert_open` + `USING(true)` `guests_host_read`, replaced with host-scoped SELECT; revoked anon/authenticated INSERT; constrained `guest_optins` insert. Verified live: host A sees 10/13 guests, host B 2/13, cross-tenant overlap 0; anon 0.
- **F-05** verified safe (`last_billing_notice_sig` UPDATE = `service_role`/`postgres` only).
- **Residual:** leaked-password toggle (Auth dashboard, pending); Batch C `npm audit fix` (3 dev/build-time vulns, none in prod runtime) deferred to just before the live flip.


---

## Shipped — Sessions 1–19 (the original session log)

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

**S10 (2026-06-06):** Phase D1 superadmin dashboard — `api/admin-overview.ts` (GET, Bearer→`getUser`, email===`ADMIN_EMAIL` gate, service-role parallel queries for hosts+plans+apartments+bookings, computed `apartments_count`/`bookings_count`/`effective_price_cents`/`days_left`/`mrr_cents`, returns `{hosts,totals,plans}`). `src/components/admin/SuperAdmin.tsx` full rewrite: calls `api.get('/admin-overview')`, 6 metric tiles (total/trial/active/MRR/grace/expired), filter by status, sort by expiring/newest/name, exempt toggle ("Show my account"), host cards with tier+status pills + days_left (red ≤7) + disabled Impersonate placeholder (Phase D2), "Open my host dashboard →" link, `InstallCard`. `App.tsx` Landing: admin email → `/admin` redirect. `Layout.tsx`: "← Admin" nav link visible to admin only. Commit: `b8f41d5`. Phase D2 read-only impersonate — `api/admin-impersonate.ts` (GET `?host_id=UUID`, same admin gate, UUID regex, service-role snapshot: host fields without Stripe IDs/push_endpoint/tokens, apartments with bookings+picks counts, best-effort audit insert to `admin_audit`). `public.admin_audit` table (migration `phase_d2_admin_audit`: RLS ON, zero policies — service-role only). `SuperAdmin.tsx`: "View as" button enables snapshot fetch; normal-flow faux-viewport overlay with sticky amber "👁 Viewing {brand} — read only" banner + Exit; hero resolved only when non-null (accent swatch otherwise); zero mutating controls. `App.tsx`: `/superadmin` + `/dashboard/admin` both redirect to `/admin`. Commit: `09b9e50`.

**S9 (2026-06-05):** Transactional email (Phase C close-out) — Resend integration shipped and verified end-to-end. `api/_lib/email.ts` (Resend wrapper `sendEmail()` — never throws, scrubs key, `replyTo`; `welcomeEmail()` + `trialReminderEmail()` builders; sender `hello@anna-stays.fi`, reply-to `info@anna-stays.fi`). `api/send-welcome.ts` (Bearer-gated POST, atomic `welcome_email_sent_at` claim, recipient from DB only, fires fire-and-forget from `OnboardingFlow` at finish). `api/cron-trial-ending.ts` extended: atomic stamp before send, real `daysLeft` from DB, push + email. Dynamic trial length via `public.app_settings.trial_days` (DB-only, `handle_new_user()` reads with fallback 30). `CRON_SECRET` rotated and redeployed. Commits: `3a77595` (feat email) + `53e6460` (welcome path fix).

**S12 — E1 (Stripe subscribe + portal, TEST sandbox only) (`23a4abd`):** `api/_lib/stripe.ts` — lazy `getStripe()` singleton (throws if `STRIPE_SECRET_KEY` absent), `priceIdForTier(tier)` reading env `STRIPE_PRICE_TIER_1/2/3`, `tierForPriceId(id)` reverse lookup for the webhook, `ARRIVLY_STRIPE_METADATA = {app:'arrivly'}`. `api/create-subscription.ts` (was stub) — Bearer→getUser, tiers 1–3 valid (tier 4 → 403 `booking_tier_unavailable`), find-or-create Stripe customer persisted to `hosts.stripe_customer_id`, `trial_end` passthrough only when status is `trial` and the date is future, Checkout subscription session with `client_reference_id`, `subscription_data.metadata = {app:'arrivly',host_id,tier}`, `payment_method_collection:'always'` (required so the card is captured during the €0 trial for auto-charge at trial end), success/cancel → `/dashboard/billing?checkout=success|cancelled`, key-scrubbed errors. `api/billing-portal.ts` (was stub) — Bearer→getUser, 400 `no_subscription` if no `stripe_customer_id`, else returns a Customer Portal session URL. `BillingPanel.tsx` wired: tiers 1–3 → create-subscription→redirect; active/grace → Manage subscription→billing-portal; `?checkout=` banners. `package.json` adds `stripe ^17`. Env (test): `STRIPE_SECRET_KEY` + `STRIPE_PRICE_TIER_1/2/3` set in Vercel. Stripe sandbox 'U & A investment and consultancy' holds one product 'Arrivly' + three recurring EUR prices €10/€15/€25, all tagged metadata `app=arrivly`; test checkout verified live (trialing subscription created, customer `cus_UfOVHv9hahCr78`, no charge during trial = correct). NOTE: this sandbox also contains Anna's Stays one-time test payments — the `app=arrivly` filter in the E2 webhook is what isolates Arrivly events.

**S12 (2026-06-08):** D4 — host self-tier-selection surface. `BillingPanel.tsx` rewritten to read the `plans` table client-side (`plans_select_authenticated`, USING true) plus the host's own `tier`/`subscription_status`/`trial_ends_at`; renders four tier cards (Starter/Growth/Portfolio/Pro) with capacity as the headline differentiator, Growth flagged most popular, trial banner computed from `trial_ends_at` only (no client `app_settings` dependency). CTAs are disabled "Available at launch" pre-Stripe; "Your plan" shown on the active tier. New `src/lib/tierCopy.ts` holds per-tier presentation copy only (no numbers). New `api/set-tier.ts` is the Phase-E seam: Bearer→`getUser` host-scoped, validates tier 1–4, returns `403 { error: 'billing_not_live' }` and writes nothing until Stripe exists. `config.ts` pricing fields no longer drive the billing tab. Live plan values confirmed as official base values this session; hard gate closed. `ec77806`

**S11 (2026-06-08):** Five targeted fixes + AI extras feature (HEAD `f4a89bd`):
1. **Onboarding 403 on new-user registration** — `OnboardingFlow.finish()` changed from `.upsert({id,...})` to `.update({...}).eq('id', user.id)`. The D0 column lockdown revoked UPDATE on `hosts.id`; PostgREST included `id` in the ON CONFLICT SET payload → Postgres 42501 → HTTP 403. Removing `id` from the payload fixes it. `bdd5c64`
2. **New properties created hidden** — `OnboardingFlow` apartments insert now `is_visible: true`. `guest-chat`, `guest-message`, and `guest-subscribe` all 404 on `is_visible=false`, making every brand-new host's property fully dead until a manual DB flip. `5acdd77`
3. **CRITICAL cross-tenant leak in Messages tab** — `bookings_guest_read` RLS policy was `USING(true) TO public`, so every authenticated host could see all hosts' bookings via the messages booking lookup. Fixed via migration `scope_bookings_guest_read_to_anon` (`ALTER POLICY ... TO anon`). Verified: a host now sees only their own bookings (2 of 35). **NOTE:** anon key is public so anon can still enumerate all bookings/guests — deeper close-out (service-role endpoint for guest booking-state + drop the policy) is required before go-live.
4. **House rules stored raw** — `api/rewrite-rules.ts` was missing `thinkingConfig: {thinkingBudget: 0}`; gemini-2.5-flash spent its output budget thinking and returned empty text on longer inputs, so the fallback stored raw unpolished rules. Added `thinkingBudget: 0`, raised `maxOutputTokens` 1024→1500, key-scrubbed `console.error` on 502, `clearTimeout` moved to `finally`. `219700d`
5. **AI bulk extras built end-to-end** (was stub + fake UI). `api/bulk-import.ts`: auth + ownership check + Gemini JSON categorisation (`thinkingBudget: 0`, `maxOutputTokens: 2048`, `responseMimeType: application/json`) + replace-scoped-to-EXTRAS_CATEGORIES insert (DELETE only fires when `valid.length > 0` — no silent data wipe on empty parse). `PropertySetup` Extras tab: `loadExtras` on tab open, bulk import wired to real API response, deletable list with `apartment_id` guard. `GuestPage` home tab: "Good to know" section after house rules in `EXTRAS_CATEGORIES` order. `EXTRAS_CATEGORIES = ['Parking','Recycling & Bins','Appliances','Transport','Amenities','Safety','Good to know']` — duplicated intentionally across `api/bulk-import.ts`, `PropertySetup.tsx`, `GuestPage.tsx` (no cross-boundary import). `f4a89bd`

**S13 (2026-06-09):** Phase E2 + E2.1 shipped and verified; Gemini retry hardened. HEAD `1de4d2a`.

**Phase E2 — Stripe webhook + lifecycle emails + guest enforcement** (`bb077e6`):
- `api/stripe-webhook.ts` — full implementation: raw-body stream read (`config: { api: { bodyParser: false } }`), `webhooks.constructEvent()` signature verification, `app=arrivly` isolation on the live-retrieved subscription (not the event payload — prevents tampered-replay bypass), `mapStatus()` (trialing→trial, active→active, incomplete/past_due/unpaid/paused→grace, canceled/incomplete_expired→expired), UUID-validated `sub.metadata.host_id` with `stripe_customer_id` fallback, service-role write of `tier`/`subscription_status`/`current_period_end`. Basil-proof period end: reads `sub.items.data[0].current_period_end` with `sub.current_period_end` root fallback (Stripe Basil API 2025-03-31 moved the field to items; this account's webhook version is post-Basil).
- `api/_lib/email.ts` — added `subscriptionStartedEmail`, `subscriptionChangedEmail`, `subscriptionCancelledEmail`, `subscriptionPastDueEmail`, `adminSubscriptionEventEmail`. Local `TIER_NAMES` map follows the cross-boundary duplication pattern.
- `src/components/guest/GuestPage.tsx` — host fetch replaced with `supabase.rpc('guest_host_card', { p_apartment_id })` (SECURITY DEFINER — anon SELECT on `hosts` was returning zero rows, so expired-enforcement never fired before this fix). `showPoweredBy = trial || grace` (grace page stays live). Silent push bug fixed: `handleMoreTabPushEnable` now uses `apartment` state instead of stale closure `apt`.
- DB: `guest_host_card(p_apartment_id uuid)` SECURITY DEFINER function added (anon+authenticated); `hosts.billing_notice` jsonb column added (authenticated UPDATE revoked; SELECT readable).

**Phase E2.1 — Subscription-change notification fan-out** (`a18f9ec` + fixes `0348c36`, `0f39980`):
- Webhook detects transition type (started/upgraded/downgraded/cancelled/grace) from pre-write host row vs. new state. Routine renewals send nothing. On a real transition, fans out via `Promise.allSettled` to 7 channels: (a) `hosts.billing_notice` DB write, (b) host lifecycle email, (c) host push → `/dashboard/billing`, (d) admin event email to udy.bar.yosef@gmail.com, (e) admin push → `/admin`, (f) ntfy, (g) `admin_audit` insert (`action='subscription_event'`).
- New `api/_lib/ntfy.ts` — POST to `NTFY_URL`; `https://`-only scheme guard; ASCII-only `Title`/`Priority` headers (non-ASCII causes ByteString errors on Vercel); 500-char body cap; 5s timeout; never throws. `NTFY_URL` = `https://ntfy.sh/arrivly-subscription-plan-99` (set in Vercel Production).
- New `api/dismiss-billing-notice.ts` — Bearer→anon `getUser`; service-role nulls `billing_notice`; host can only clear their own row.
- `src/components/host/BillingPanel.tsx` — dismissible green/amber/red `billing_notice` banner above the checkout banners; `handleDismissNotice` optimistically clears on success.
- `src/components/admin/SuperAdmin.tsx` — activity log `auditSummary()` and `ACTION_LABEL` extended for `subscription_event` rows.
- Webhook test scenarios: Scenario 2 (upgrade) and Scenario 3 (downgrade) PASSED. Scenarios 1 (started) and 4 (cancel) still pending.

**AI reliability — transient retry** (`1de4d2a`):
- Diagnosed: rewrite-rules and generate-guide were intermittently 502-ing with identical code. Temporary diagnostic logging (commit `4573bc5`) confirmed transient Gemini 5xx — same key+model succeeded minutes later; Google status was green.
- New `api/_lib/retry.ts` — `withRetry<T>(fn, opts)`: exponential backoff, retries 429/5xx/AbortError/network keywords, throws immediately on non-transient 4xx.
- `api/rewrite-rules.ts` — diagnostic removed; per-attempt AbortController 10s + `withRetry({ retries: 2 })` → max ~31.8s worst case (within 60s maxDuration).
- `api/_lib/guide.ts` — same pattern; per-attempt timeout 20s + `withRetry({ retries: 1 })` → max ~58.6s worst case (2 × 20s + 600ms delay + ~18s geocoding — within 60s maxDuration).

**S14 (2026-06-09):** Phase E3 — in-app plan switching + cancellation. HEAD `71a974c`.

- **`api/change-plan.ts`** (`b827ecb`) — Bearer→getUser; tier 4 → 403; trialing → immediate price swap (Stripe `items` update, `proration_behavior:'none'`); active → deferred switch via Stripe subscription schedule (creates schedule from sub if none, rebuilds phase 0 verbatim from `schedule.phases[0]` using its own `start_date`+`end_date`, appends phase 1 with new price, `end_behavior:'release'`), writes `hosts.pending_tier`; selecting the current tier releases the schedule and clears `pending_tier` (revert path); grace/expired → 409 `not_switchable`. Returns `{ mode: 'immediate'|'scheduled'|'reverted', effective_at }`.
- **`api/cancel-subscription.ts`** (`b827ecb`) — Bearer→getUser; `{ resume: bool }` body; cancel path: 409 `pending_change_in_progress` if a schedule is attached (must undo pending change first); sets `cancel_at_period_end: true` via Stripe + mirrors to DB. Resume path: clears `cancel_at_period_end`. Returns `{ cancel_at }` or `{ resumed: true }`.
- **`BillingPanel.tsx` full rewrite** (`9d82e3d`) — reads `pending_tier`, `cancel_at_period_end`, `current_period_end` from host row; `chooseMode` (no sub or expired) vs `manageMode` (has sub); tier cards with current-plan ring + pill; upgrade/downgrade confirmation modal (deferred-vs-immediate copy based on `sub.status`); pending-tier banner + Undo button; cancel-pending banner + Resume button; footer Cancel link + "Payment method & receipts" portal link; modal focus trap (Escape-to-close, `role="dialog"`, `aria-modal`). `src/lib/api.ts`: `api.post` now throws `new Error(rawText)` on non-2xx, so callers can `JSON.parse(err.message)?.error` to get the error code.
- **Deferral bug fix** (`34fb94b`) — `iterations: 1` with a historical `start_date` was applying the new price immediately in production. Fixed by using `schedule.phases[0].end_date` explicitly as the phase boundary. Verified live: deferred upgrade/downgrade sets `pending_tier`, live tier/price unchanged until the period boundary; Stripe dashboard shows the scheduled change.
- **Webhook notice + de-dup fix** (`71a974c`) — Classification chain: cancelled > grace > started (fresh or re-subscribe after expiry) > upgraded/downgraded (live sub only). Previous bug: cancellation misfired as 'upgraded' due to a price remap on the same transition; re-subscribe misfired as 'downgraded'. Atomic fan-out de-dup: `noticeSig = ${tier}|${status}|${periodEnd ?? 'null'}` claimed via `UPDATE ... WHERE last_billing_notice_sig <> noticeSig`; only the winning lambda fans out (kills triple-fire from concurrent Stripe events).
- **Vercel env fix** (dashboard + redeploy, no commit) — `STRIPE_PRICE_TIER_*` now map each tier to the correct-amount Stripe price. The forward (`priceIdForTier`) and reverse (`tierForPriceId`) lookups share the same env vars; a wrong mapping was invisible in-app until a tier switch exercised the reverse path.
- **Note — Stripe sandbox "Auto-cancels 7 Sept"**: test subscriptions auto-cancel after 90 days and are deleted 30 days later. Not a product bug. Our schedule uses `end_behavior: 'release'` so the sub continues normally when the schedule completes; it is not affected by sandbox cleanup.

**S15 (2026-06-09):** Phase E billing iteration — immediate upgrades, enriched notifications, unlocked panel. HEAD `b3b8c23`.

- **`api/change-plan.ts`** (`a67c50d`) — active-sub branch split three ways: revert (select current tier → release schedule + clear `pending_tier`); immediate upgrade (`proration_behavior:'always_invoice'` + `payment_behavior:'error_if_incomplete'` → charges the prorated difference now, does NOT grant the tier until payment succeeds; 402 `payment_failed` on card decline; renewal date unchanged); deferred downgrade (existing schedule path). Trialing upgrades stay immediate with no charge.
- **Enriched emails + ntfy** (`9f066db`) — `api/_lib/email.ts` `formatMoney()` + all host/admin builders now state €price/month, amount charged, and the relevant date. `stripe-webhook.ts` expands `latest_invoice` for the charged amount; `change-plan.ts` + `cancel-subscription.ts` fire ntfy on every deferred/undo path; `ntfy.ts` gained skip/sent logs.
- **Billing panel unlocked during a pending downgrade** (`e2e296e` + `b3b8c23`) — `BillingPanel.tsx`: a pending downgrade no longer disables the tier buttons or Cancel (`locked` keys on `cancelPending` only). Host can upgrade (immediate), re-target the schedule to a different lower tier, or cancel — without undoing first. One control: the banner button, relabelled "Cancel scheduled change"; the current-tier card stays a plain status (no second undo affordance — matches GitHub/HighLevel/Stripe-portal best practice). Re-target modal copy guarded by `status==='active'`.
- **`api/cancel-subscription.ts`** (`e2e296e`) — replaced the 409 `pending_change_in_progress` guard with release-then-cancel: if a schedule is attached, release it + clear `pending_tier`, THEN set `cancel_at_period_end` (release BEFORE the cancel flag, so they never collide on the same period end). `hadPendingChange` passed to `subscriptionScheduledCancelEmail` to add the line "Your previously scheduled plan change has also been cancelled."
- **Request-time confirmation emails** (`a67c50d`) — host + admin emails fire at the moment of scheduled change / undo / cancel / resume (apply-time webhook email unchanged). NOTE: request-time deferred actions do NOT write `admin_audit` — only the webhook does; verify those via inbox/ntfy, not the audit trail.
- **Verified live (S15):** immediate upgrade produced a real prorated invoice + single `upgraded` audit row; re-target / cancel-with-schedule / resume all cleaned up (no orphan schedule, `pending_tier` cleared). End state: test host Tier 2, active, no pending change.

**S17 (2026-06-10–11):** Owner/admin guest-page preview, private check-in details fix, preview fidelity. HEAD `dad5bd2`.
- **`06b3168` — server-gated owner/admin preview (`?preview=1`):**
  - `api/guest-preview.ts` — GET, Bearer-gated (anon `getUser`); validates `?apt=` UUID; authorizes owner (`user.id === apt.host_id`) OR admin email via `authorizePreview()`; THEN builds service-role client; returns full page payload: apartment, host card, ALL `apartment_details` (incl. `is_private=true`), host picks, guide. Works for drafts (`is_visible=false`). Read-only, no audit insert.
  - `api/_lib/guest-access.ts` — `GuestTier` extended with `'owner'`; pure `authorizePreview()` helper added; `buildGuestSystemInstruction` private-inclusion checks changed from `tier === 'verified'` → `tier !== 'public'` (owner is treated like verified for context; chat path never produces `'owner'` yet — forward-compat only).
  - `GuestPage.tsx` — `?preview=1` bypasses the booking/token flow entirely, populates state from `api/guest-preview`, sample guest name `'Alex'`, persistent "Preview — what your guests see" banner with Exit; guest side effects suppressed (push, `arrivly_last_guest` pointer, `InstallPrompt`); `shareUrl` strips `?preview` param so shared links are clean. A stranger appending `?preview=1` falls through to the normal neutral page.
  - Dashboard "👁 Preview guest page" + SuperAdmin "Preview guest page ↗" links now append `&preview=1`. QR-code URLs, share URLs, and all real guest-facing URLs unchanged.
- **`dad5bd2` — fixed a LATENT PRODUCTION BUG + preview fidelity:**
  - **Bug:** Private check-in details (`is_private=true`) NEVER rendered on the live guest page for any guest — the page fetches `apartment_details` as anon, RLS strips private rows (`apt_details_guest_read` USING `is_private = false`), and the check-in card filters for `d.is_private === true`, so it was always empty. Guests could only get door codes via the chatbot (server-side). Existed since S3.
  - **Fix:** `api/guest-details.ts` — new unauthenticated GET endpoint where the booking token IS the credential (same pattern as `guest-chat.ts`); validates `apt` (UUID regex) + `token` (`/^[A-Za-z0-9-]{4,32}$/`); calls `resolveGuestAccess` (confirmed/completed booking, in-dates, Helsinki timezone); returns ONLY `is_private=true` rows for the verified apartment; generic `403 { error: 'forbidden' }` on every non-verified path — no enumeration signal. `GuestPage.tsx` verified-token branch fetches private rows via plain `fetch()` (guests have no auth session — see Lessons); merges with `publicRows` (pre-filtered to `!is_private` before the `try` so the client-side guard is never bypassed); `Array.isArray(priv)` guard before spreading; graceful degradation — any failure falls back to public-only rows.
  - **Preview fidelity (B1):** Chat tab static "Sample conversation" — real WiFi details from `wifiParsed`, accent-coloured guest bubbles, disabled input bar.
  - **Preview fidelity (B2):** More tab inert "Message your host" + "Get replies on your phone" cards in `preview && (...)` blocks alongside existing `tokenParam && (...)` blocks; "Available to your guests during their stay." caption. Real-guest rendering byte-identical to before.
- **Deliberately parked:** owner-tier chat in preview is static sample only — live AI chat is not enabled in preview mode.
- **Test data:** Udyni's 3 bookings deleted + 4 orphan guest rows cleared (clean billing test host).

**S16 (2026-06-10):** Signup-with-card, onboarding retired, guide fix, 360 test complete. HEAD `0c4e245`.
- **Signup-with-card** (`7b64d8c`) — new flow: register (first name, email, password, brand name, terms) → mandatory plan step (`ChoosePlan.tsx`; tiers 1-3 selectable, tier 4 "coming soon"; card captured via Stripe Checkout, no charge until the 14-day trial ends) → dashboard. `create-subscription.ts` gained `flow:'signup'|'billing'` (success/cancel URLs built server-side, no client URL injection). `PrivateRoute.tsx` guard: non-exempt host with no `stripe_subscription_id` → `/choose-plan` (bypass for `/choose-plan` and `?checkout=success`). Host-level location dropped — per-property location is authoritative.
- **Onboarding retired + dashboard welcome** (`d0a2ea1` build-broke → hotfix `bdc92b6`) — removed `/onboarding` route + OnboardingFlow + the 3 stub files; dashboard empty-state greeting + "Add my first property" CTA (creates a blank apartment name=brand_name, is_visible=true); one-time dismissible welcome modal gated on `hosts.welcome_seen_at`. **Lesson:** validate with `npm run build` (`tsc -b && vite build`), NOT `tsc --noEmit` — they differ here (a `.catch()` on a Supabase builder passed `--noEmit` but failed `tsc -b`, breaking the deploy). All future prompts validate with `npm run build`.
- **Guide silent-failure fix** (`0c4e245`) — `_lib/guide.ts` skips the upsert when `placeCount === 0` (never overwrites a good guide with an empty result); `generate-guide.ts` returns `503 guide_empty` instead of 200 so the client surfaces a retry; `cron-refresh-guides.ts` counts only real refreshes; `QRCodePanel.tsx` shows "No places were generated this time. Please try again." Root cause was a transient Gemini failure (an immediate retry produced a full 30-place guide); the fix makes a transient blip safe and visible, not silent. Does NOT reduce how often the transient happens — raising function maxDuration is a separate future option.
- **360 webhook test COMPLETE** — Scenario 1 verified (new host Roy = exactly one `started` event). All four scenarios pass.
- Test hosts Roy + Anna deleted; Anna (anna.humalainen@gmail.com) re-registered through the new flow → host `b4f76db4`, apt "Anna's stays" `cf5a643f` (Arrivly project; distinct from the protected "Anna's Stays").
- **DECISION:** finish Phase I before flipping Stripe to live.

**S19 (2026-06-23):** Security hardening — every metered external API moved to no-card keys; geocoding migrated off Google; the guest-data disclosure chain closed. HEAD `8fa50ac`.

- **Step 1 — AI on no-card keys.** `GEMINI_API_KEY` is now an Arrivly-only no-card AI Studio key (replaced the dead shared key); `GEMINI_API_KEY_GUIDES` is a second no-card project used for guides only. `api/_lib/guide.ts` reads `GEMINI_API_KEY_GUIDES || GEMINI_API_KEY` (the only endpoint that prefers the guides key).


---

## Current-HEAD chain as of Jul 28 2026 (the long-form version, verbatim)

This was a single line at the top of CLAUDE.md; it accumulated every session's commit chain
and was replaced with a short current-state block on Jul 29 2026.

> **Current HEAD:** code HEAD `dbfc034` (cron quota-day reschedule) on docs `9493edf` (pre-marketing provider-terms to-do) on `363c7ce` (Stage 5 tease card — confirmed Tiqets euros in the tier 1–2 Earnings panel) on `540d57f` → `146173f` → `e1431a2` (Stage 5 ingest cron); this docs commit sits on top; live + verified on production, latest Vercel READY prod deploy matches. **PHASE I STAGE 5 IS COMPLETE (Jul 28 2026)** — ingest backend + verified first cron run + tease card all shipped. **NEXT = the two non-build sessions scoped Jul 28: (1) legal/compliance data inventory (see "PRE-LIVE LEGAL & COMPLIANCE WORKSTREAM" below), (2) pre-arrival guest reachability design session (see its scope note below).** Superseded Stage 5 checklist follows for history: (a) verify the 05:30 UTC `cron-refresh-earnings` first run via Vercel MCP logs (expect `ok:true`, `ordersFetched:0`); (b) a final visual `imageCredit`-caption check on a live Tiqets card (if not already eyeballed today); then (c) build the tier 1–2 Earnings tease card showing REAL Tiqets euros (mockup-first, deferred until the ingest is verified). **Tiqets provider thread is FULLY CLOSED (all three asks resolved Jul 27); the Stage 5 Tiqets ingest cron is SHIPPED (`e1431a2`) and the Tiqets guest-card image pipeline is VERIFIED LIVE (images + ratings + imageCredit).** The one remaining OPEN provider thread is Viator host-own-ID permission (sent Jul 24; follow-up ~Jul 30 if silent). **Phase I Stages 0 + 4A + 4B + the Stage 5 ingest backend are SHIPPED and verified live** — see "PHASE I — EXPERIENCE CONNECTORS" below. **Latest session (Jul 27 2026) — Tiqets thread fully closed (Reporting API self-serve via a fresh Essential-API token, `tq_campaign` confirmed in writing, images enabled); W1 attribution results in (Viator + Tiqets campaign attribution CONFIRMED end-to-end; GYG app-handoff drops the `cmp` tag); Stage 5 scoped "Option A" + `create_experience_orders` migration applied + `cron-refresh-earnings.ts` shipped (`e1431a2`); then Tiqets images VERIFIED LIVE + ratings mapping fixed (`146173f`) + `imageCredit` wired from `images[].credits` (`540d57f`).** **Prior session (Jul 26 2026) — W1 attribution seeded; W2/W3/W4 closed; W5 (landing 4-tier pricing grid + comps-comparison section) SHIPPED; Earnings per-card Connect CTA shipped; tier-ladder confirmed as-is; comps fact base verified.** Earlier that day — Phase I Stages 4A + 4B SHIPPED + verified live: guest-side experiences pipeline (`2fd4832` — blended Viator + Tiqets cards + GYG city link on Explore; `experiences_cache` + daily 05:00 UTC cron; click beacon → `experience_clicks`) and the host Earnings + Connect surfaces (`d5e3bda` — `/dashboard/earnings` + `/dashboard/earnings/connect` + link-builder rewrite). Link spec locked for all three providers with per-apartment campaign attribution; every code-changing commit passed code-reviewer (+ security-auditor where an api/ surface changed) before push. See the Phase I section below. **Prior session — Domain migration + rebrand FULLY COMPLETE AND SMOKE-TESTED (8/8 prod tests PASS), Jul 17 2026 — see the domain-migration block above.** **Prior session — Social sign-in (Google LIVE; Apple built + flag-gated) + Google-on-demo + first-time welcome; TESTED (Jul 8 2026).** Google social sign-in is BUILT, LIVE, and END-TO-END TESTED on prod (new-account + demo paths DB-verified); Apple is built but flag-hidden (`VITE_SOCIAL_APPLE` unset) until the Apple Developer account is accessible. Chained on docs `94ad5a5`: `73c228c` (social core — `SocialAuthButtons` on Login+Signup, `/auth/callback` `AuthCallback`, `/complete-profile` `CompleteProfile` brand bootstrap) → `5d39c6a` (dashboard warm first-time welcome for brand-new hosts, presentation-only) → `ad3d699` (Google-on-demo, identity-tied — `api/demo-claim.ts` NEW + `onBeforeRedirect` + demo-intent routing + `Demo.tsx` Google entry) → `65229d1` (demo step-1 reorder — location first, Google prominent, presentation-only). Each code-changing commit: code-reviewer PASS (0 must-fix) + security-auditor PASS on the auth/OAuth/service-role work (0 confirmed risk) + `npm run build` green. Flow type UNCHANGED (implicit/hash — ResetPassword depends on it). See "Social sign-in (Google LIVE; Apple built + flag-gated) — Jul 8 2026" below. **Prior session — Free 48-hour DEMO flow: BUILT + LIVE + END-TO-END TESTED (Jun 30 2026).** Turned the demo into a complete showcase (full guest page + editor populated on both paths), auto-derived country, added a daily purge cron, and routed conversion through the normal Stripe-checkout path. Chained on docs `00e6f61`: `2bc2d03` (showcase — full guest page + editor on Quick & Full) → `987cf76` (country auto-derive from the geocoder) → `989deb0` (daily `cron-demo-purge` + honest email copy) → `8f6bea9` (convert → Stripe Checkout for the chosen tier) → `42dbf2f` (disable Pro CTA on the wall + city-image `{city}` fallback). Each: code-reviewer PASS (0 must-fix) + security-auditor PASS (0 confirmed risk) + `npm run build` green. **Tests A–E all PASS end-to-end on live prod** — see "Free 48-hour demo flow (BUILT + LIVE + END-TO-END TESTED)" + "Demo testing — DONE (Jun 30 2026)" below. **Prior session — Free 48-hour DEMO flow is BUILT + now LIVE IN PRODUCTION.** `VITE_DEMO_ENABLED=true` is set in the Vercel **Production** scope and a `--force` prod redeploy (`dpl_J129NMW31iDG7mFRYwn1AgtMkRZi`, READY) baked the flag in; the landing **"See a live demo"** button now routes to `/demo`. Supabase **global CAPTCHA remains OFF** (login/signup/reset keep working) — bot protection on the demo path is our OWN server-side Turnstile verify (`api/_lib/turnstile.ts`), fail-closed before any fresh-create AI spend. Built across five reviewed stages, chained on docs `2b4804c`: `fe0aa63` (inert backend: precheck/create + disposable-domains) → `4136a06` (flag-gated entry UI + 2 backend guards) → `086f2ce` (Turnstile money-gate) → `4aa08a8` (demo dashboard chrome + KeepDemoModal convert) → `2ab2679` (48h expiry cron + UpgradeWall + PrivateRoute is_demo bypass). Each: code-reviewer PASS (0 must-fix) + security-auditor PASS (0 confirmed risk) + `npm run build` green. (Subsequently showcased, conversion re-routed to Stripe, and end-to-end TESTED this session.) **Prior session — Host Guide system (DONE):** new in-app host guidance built on ONE modular content source (`src/guide/content.ts`) — (a) a docked, non-modal "Guide & help" drawer (sidebar toggle; desktop right overlay, no scrim; mobile 40% bottom sheet w/ minimize-pill), (b) per-page first-visit hint strips persisted to `hosts.ui_state`, and (c) a host-auth corpus-grounded "Ask Arrivly" assistant (`api/guide-assistant.ts`). Chained on docs `112a6401`: `7463c85` (content module + Browse drawer) → `8719bae` (hint strips + Show-me-in-Guide + a11y nits) → `2b4804c` (Ask Arrivly endpoint + panel + mobile keyboard-grow); migration `add_hosts_ui_state_client_writable`. Each code-reviewer PASS (0 must-fix) + security-auditor PASS (ui_state write + endpoint) + `npm run build` green. See "Host Guide system (DONE) — Jun 29 2026" below. **Prior session — Home greeting freshness (S28, DONE):** the multi-day "same greeting every open" problem is fixed end-to-end across 5 parts — Stage 1 + Stage 2b DB migrations (per-booking `daily_greetings` + `daily_greetings_service_role_only_lockdown`), Stage 2 `abd5202` (per-booking suggestion: hard day-part allow/deny + sliding anti-repeat + stay-day nudge), Stage 3 `8771612` (UI: first-open-only blurb + a "Right now" card). See "S28 — Home greeting freshness (DONE)" + the updated "Greeting system" + `daily_greetings` schema below. **Prior session — guest-page redesign (Phase H, the last + biggest surface):** chained (on prior docs `89f270a`) `7acd244` (A — Home) → `d2d1eb0` (B — Explore + inert flag-gated Phase-I slots) → `bc445a1` (C — Settings/nav/non-active states) → `f7b547f` (D — children restyle) → `fd57079` (accent-tint Explore category pills; drop CATEGORY_COLORS). All client-only, each code-reviewer PASS (0 must-fix) + `npm run build` green; no security-auditor (presentation-only). See "Guest-page redesign — Phase H (DONE) — Jun 28 2026" below. **PHASE H GUEST SURFACE COMPLETE — the whole Phase H dashboard+guest redesign is now done.** **Prior session — Messages & Settings Phase H + iCal cancel-guard/token backfill:** chained (on prior docs `a9233da`) `bc6d46f8` (Messages Phase H redesign) → `938cf8af` (Settings Phase H + sidebar de-dupe), plus TWO MCP-applied DB changes (reconcile past-cancel guard migration + legacy-Airbnb token backfill). See "Messages — Phase H redesign (DONE)" + "Settings — Phase H redesign + sidebar de-dupe (DONE)" + the iCal section below. **Prior session — iCal guest-name preservation + Bookings redesign:** chained (on prior docs `985b871`) `695f114` (P1 reconcile sync + daily cron) → `85c3c6c` (P2 Airbnb CSV import endpoint) → `5ba1fec` (P3 Calendars tab) → `ae57886` (P4 Bookings Phase H redesign) → `be6301d` (P5 `?tab=` deep-link), plus 3 additive DB migrations. See "iCal guest-name preservation + Bookings redesign (DONE)" below. Prior this session chained `981bd5b` (S27 2a) → `fd32109` (S27 2b) → `41bd2d6` (Phase H pricing cards) → `9bed006` (admin host-finder) → **Phase H Overview/Home redesign + sidebar `4eb8004` → `98e6316` → `f90adac` → `2cd5fbc` → `f81b9a2`** (see "Phase H — Overview/Home + sidebar (DONE)" below). **S27 dashboard pass 2 COMPLETE** — colour model LIVE + property-editor redesign: **2a `981bd5b`** Migrations A + B applied, BrandingPanel rebuilt account-wide, guest colour resolver + preview coalesce per-property → account default; **2b `fd32109`** PropertySetup restyled into the S26 chrome with horizontal premium tabs + new "Guide & events" and "Look" tabs (all prior tab logic preserved); Dashboard card coalesces apt → host accent. **Phase H premium plan-card redesign `41bd2d6`** — new shared `PlanCard.tsx` (charcoal-inverted "Most popular" featured variant + cream default, Direction A); BillingPanel + ChoosePlan restyled to use it (presentation-only; all billing logic byte-faithful; Pro now shows its real price). **Admin host-finder `9bed006`** — accessible "Find a host" combobox in SuperAdmin (client-side over already-loaded hosts; pins one host → collapses to that single card; full a11y). NOTE: SuperAdmin is still on the OLD pre-Phase-H styling — a full admin chrome refresh is a separate future pass. See "S27 — pass 2 (DONE)" + "Phase H — pricing-card redesign (DONE)" + "Phase H — admin host-finder (DONE)" below. **Design system = DARK sidebar + CREAM workspace** (see "Design system — ground truth" below). Prior: ba113d2 (S26 — dashboard pass 1: Layout sidebar IA + Overview grid + QR grid; auth redesign `1e03d95` + `/reset-password`; branding icons `a8d6c64`). Prior: b658813 (S25 — landing redesign; Phase G CLOSED; pentest gate before the live flip after Phase F). Prior code HEAD: 81b3767 (S24, server-side create-booking + host-scoped guests RLS).
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
remain valid and are why the in-code brakes, not a spend cap, are the primary control.

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

## SESSION CLOSE — Aug 6 2026: pilot Steps 4 and 5 shipped, city-cache scoped, B3.5 shipped (SMOKED Aug 7 — PASSED)

**HEAD `fc5c97e`, verified against Vercel: latest READY production deploy is
`dpl_HdjyX4DZkSPeaJht4rXJqpVnYsvc` = `fc5c97e98423b7ff…`. All EIGHT of today's commits are READY in
production.** Every one passed code-reviewer + security-auditor before push.

### ~~FIRST ACTION OF THE NEXT SESSION — SMOKE-TEST B3.5~~ — DONE Aug 7 2026, PASSED

**B3.5 was smoke-verified on Aug 7 2026 from the real 09:00 UTC cron run and PASSED. Results and
verdict are in "SESSION Aug 7 2026"; do not re-run it.** The acceptance criteria below are kept
because they are what that run was judged against — and because the reasoning generalises to any
future extraction round. They
exist because **the one axis with no code guard (fabrication) is also the one axis with no
metric** — so a higher event count is NOT by itself evidence the round worked:
- **Blank-url share** = `eventsExtracted − urlsKept − urlsRejectedProvenance − urlsRejectedNonSpecific`.
  An invented title cannot match a corpus url slug, so **padding shows up there**. 12 events with 9
  blank urls is padding, not recall.
- **Hand-check three titles against the web**, exactly as B3.4's run was checked.
- **`themeCounts`** decides whether the diversity problem is SELECTION or EXTRACTION. Culture at 0-1
  means SELECTION, and **no further prompt round can fix that** (B3.5 was the last events round).
- **`datesUnparseable`** read ALONGSIDE `eventsDroppedOutOfWindow`, never alone.
- **`rawLen` ~6-8k in a parse-failure log means TRUNCATION**, not malformed JSON — see B3.5's lever
  order (drop the target to 10-12 before raising `maxTokens`).

### WHAT SHIPPED, in order
`6baafe8` Step 4 (guide on Geoapify POI + Groq prose, blurb migrated) → `085ff2f` B2.1 (tiered
Sight — significance before proximity) → `5f15005` Step 5 (city events on Tavily + Groq) →
`862973b` B3.1 (never overwrite good events with an empty extraction) → `be1b1a9` B3.2 (cron
wholesale-failure condition + `no_events` toast) → `8e62b83` B3.3 (retrieval quality) → `863e6e1`
B3.4 (aggregator-url rejection, theme diversity, server-side date window) → `fc5c97e` B3.5 (prompt
rebalanced for recall — **LAST events round**).

### SMOKE RESULTS — measured facts
- **GUIDE (Step 4 + B2.1) — SMOKE-VERIFIED.** **30 places, 30 with coordinates, 30 described, all
  within 0.45 km.** B2.1 confirmed its own fix: Sight went from **five statues within 220 m** to
  **Temppeliaukion kirkko, Luonnontieteellinen museo, Punkmuseo, Helsingin synagoga**, while the
  **five untiered categories returned IDENTICAL names in IDENTICAL order** — the regression guard
  held, which is what makes the Sight change attributable rather than coincidental. Cooldown claimed
  6s before the write; no alarm fired.
- **EVENTS — SMOKE-VERIFIED THROUGH B3.4 as of this session; B3.5 was verified the NEXT day
  (Aug 7) and PASSED — see "SESSION Aug 7 2026".** B3.3 run: 4 events, real headline events, **but
  every url pointed at an aggregator page and one at the WRONG festival** — which is what B3.4 then
  fixed. B3.4 run: **3 events, ALL CORRECT** (Hellsinki Metal Festival / Haloo Helsinki! / Jethro
  Tull, all in-window, one carrying a real price), **`urlsRejectedNonSpecific` 3**,
  `urlsRejectedProvenance` 0, `eventsDroppedOutOfWindow` 0, `corpusChars` 13638.
- **B3.5 — TESTED Aug 7 2026, PASSED.** 6 events, fabrication clean, diversity resolved. Full
  measurements and verdict in "SESSION Aug 7 2026".

### DECISIONS TAKEN TODAY — do not relitigate
- **NO ROLLBACK TO GEMINI ON EVENTS, UNDER ANY CIRCUMSTANCES** (Udy, explicit). Operational
  consequence recorded by B3.4: `AI_PROVIDER_EVENTS=gemini` would **silently disable BOTH** the
  server-side date window and the aggregator-url check, since both live only on the Tavily path.
  **Rollback is no longer a free incident-response lever** — reconciled at the Step 5 header.
- **VENDORS STAY UNPAID until graduation. The card question is DEFERRED, NOT RESOLVED.**
- **xAI (Grok) PRICED AND DEFERRED** — see the pilot's LLM PROVIDER ORDER for the numbers. **It is a
  DIFFERENT COMPANY from Groq despite the name; never conflate them.**
- **THE FREE STACK DOES NOT REACH 50 HOSTS** — measured; reconciled into the pilot's DECISION and
  GRADUATION blocks. Real runway ~10-20 hosts, and **Groq's own Developer tier also requires a card**,
  so the "paid Groq with a hard cap" lever does not preserve the no-card state.
- **VENDOR RISK ON GROQ** recorded (NVIDIA took its founder, president and ~90% of engineering in
  Dec 2025) — a second real provider behind `ai-provider.ts` is worth having eventually.

### SCOPED AND AGREED, NOT YET BUILT — the CITY-LEVEL EVENTS CACHE
**WHY:** events are a property of the **CITY** but cached per **APARTMENT**, so N apartments in one
city generate N identical searches and N identical bills. Live data: **9 visible apartments across 7
cities, THREE in Helsinki** — only a 1.3x saving today, **but the test data is artificial and real
hosts will cluster in few cities, so size it off the CEILING, not today's ratio.** It also improves
**DATA quality** (one city fetched well beats N thin fetches) and **makes every vendor cheaper,
including the free one** — which is why it is the only relief lever that needs no card.

**KEYING DECISION, with the reasoning, because three plausible options were rejected:**
- **NOT the host's typed city** — free text. The live data already held `"Helsinki"`, `"HELSINKI"`
  and `"Finland "` with a trailing space; **those were CLEANED via MCP this session.**
- **NOT geographic clustering**, though it was considered: a radius rule is **ORDER-DEPENDENT** —
  whoever refreshes first plants the cluster centre — and **non-determinism is a bad property in a
  cache.**
- **NOT LocationIQ's `place_id`** — a Nominatim internal, **not stable across data refreshes.**
- **INSTEAD: reverse-geocode the apartment's coordinates ONCE at address save**, and key on
  **country_code + the OSM-normalised city name** (e.g. `"fi:helsinki"`).

**VERIFIED:** LocationIQ reverse geocoding is on the **FREE tier (5,000/day)**, same key, same `eu1`
endpoint `geo.ts` already uses. **TWO PARAMETERS ARE ESSENTIAL:** `normalizecity=1` (without it OSM
returns town/village for smaller places and `address.city` comes back **EMPTY**, so a host in a small
town gets a **null key**) and `accept-language=en` (so Helsinki/Helsingfors resolve consistently).

**LICENSING QUESTION FOR THE PRE-LIVE LEGAL LIST — flagged, NOT resolved:** LocationIQ's free terms
say response data may be stored indefinitely but **request/response PAIRS cached only 48 hours**. We
would store a **DERIVED field permanently**, which reads as allowed — **confirm before launch rather
than assume.**

**SHAPE — two commits, smoked separately:**
1. `canonical_city` / `canonical_country` / `canonical_country_code` / `canonical_city_key` /
   `canonical_resolved_at` columns, **all nullable, the host's typed city/country UNTOUCHED for
   display**; `reverseGeocode()` in `_lib/geo.ts` reusing the existing **550 ms gate**, silent, never
   throws; resolve on address save **when coordinates change**; **failure leaves nulls and never
   blocks a save**; backfill the 9 apartments via MCP.
2. The city-keyed cache table, three callers switching with a **per-apartment fallback when the key
   is null**, and the cron iterating **booked CITIES**.

**COUNTERS STAY HOST-KEYED** — whoever triggers a run pays for it. **Changing the counter key would
be a SECURITY change, and those go badly when bundled with a feature.**

**ACCEPTED BEHAVIOUR CHANGE:** one host's Refresh benefits every host in that city, so a second host
may be told "already up to date". Correct and cheaper, **but the copy must not read as failure —
same class as the B3.2 toast.**

**UNSOLVED AND ACCEPTED:** metro areas — Espoo/Vantaa resolve as distinct from Helsinki though they
share an events market. Merging needs a **curated list, rejected as multi-city-hostile.** Accept the
split until real host data shows it mattering.

### OPEN ITEMS — in priority order, and the first is genuinely the most urgent
1. **`cron-refresh-events` at concurrency 2 now EXCEEDS the 6K TPM org ceiling DETERMINISTICALLY at
   B3.3+ sizes.** A multi-candidate run is **EXPECTED to 429**, and while it runs it **starves
   guest-chat, the guide and daily-greeting across EVERY tenant.** Fix is **`concurrency: 1`** — one
   word, top of the cron-batching debt. This is the most urgent item in the repo.
2. **Guide prose reads templated** ("X is a museum that guests can visit to learn about…") —
   prompt-only, batch with the Step 7 sweep.
3. **Per-tier Sight logging:** a silent Geoapify timeout on Tier 1 is **indistinguishable from a
   genuinely thin Tier 1** and would promote statues back into Sight.
4. **Everything B3.3/B3.4/B3.5 already recorded** and still open: Tavily's fleet-wide monthly pool
   (now the fleet-size constraint, item above), the non-Latin-script token ceiling, the duplicated
   `countEvents` predicate, the `probe_failed` skip suppressing a real signal, the three
   code-comment inaccuracies, and the stale Gemini-era alarm text for the Step 7 sweep.

### DURABLE LESSONS FROM TODAY — the reason this record is worth writing
- **A RECENCY FILTER ON A SEARCH API FILTERS WHEN THE PAGE CHANGED, NEVER WHEN THE EVENT HAPPENS.**
  This single default was the primary cause of the weak events corpus.
- **A PROVIDER'S DEFAULT ORDERING IS A DESIGN DECISION YOU INHERIT SILENTLY.** Geoapify's
  nearest-first is right for "closest pharmacy" and wrong for "best sight".
- **PROVENANCE PROVES ORIGIN, NEVER ABOUTNESS.** A url can pass every origin check and still be the
  wrong url; under an event's name an aggregator link spends the **HOST'S** brand trust to mislead a
  guest. **Blank beats plausible-but-wrong.**
- **A URL IS AN IDENTITY KEY, NOT DISPLAY TEXT — cap it by REJECTION, never by slicing.**
- **A CORPUS CAP APPLIED IN PRODUCER ORDER SILENTLY BECOMES A PRODUCER FILTER.**
- **A CORPUS BUDGET SIZED OFF ONE FIELD IS WRONG** — a snippet costs the SUM of every capped field
  plus scaffolding.
- **A PROMPT CLAUSE THAT DUPLICATES A CODE GUARANTEE COSTS RECALL AND BUYS NOTHING:** when a rule
  moves into code, **RELAX** the wording rather than leaving it standing.
- **A PROMPT-ONLY CHANGE CAN WEAKEN A GUARANTEE WITHOUT TOUCHING A GUARD**, by shifting which BRANCH
  input lands on. **"No guard moved" and "the guarantee is unchanged in practice" are different
  claims.**
- **TEST THE REAL MODULE.** A hand-copied transcription manufactured a phantom failure while
  **HIDING** a real bug.
- **WHEN REMOVING DUPLICATED CLAUSES, SWEEP THE FIELD SPEC TOO**, not just the rules prose.

## SESSION Aug 7 2026 — B3.5 smoke PASSED, cron concurrency fixed, CLAUDE.md split

**HEAD `d254df9`, verified live: deploy `dpl_5Gy5f7PKNj8mJiyUtwJ5z74PpjRq` READY.** One code
commit, then a docs-only split of this file.

### B3.5 — SMOKE-VERIFIED AND PASSED (from the real 09:00 UTC cron run, not a manual trigger)

Sweet home, Helsinki. Measured, from the cron's own diagnostic line:
`tavilyResults [8,8,7,8]`, `snippets` 14, `corpusChars` 11195,
`themeCounts` calendar 4 / whats-on 4 / music 3 / culture 3,
`eventsExtracted` 6, `urlsKept` 0, `urlsRejectedProvenance` 0, `urlsRejectedNonSpecific` 5,
`eventsDroppedOutOfWindow` 0, `datesUnparseable` 3.

### `d254df9` — cron-refresh-events correct at concurrency 1

`mapPool` ran at concurrency 2. Each iteration is four Tavily searches plus a Groq extraction
(~3.5-5.5k tokens) against Groq's **6K TPM ORG-WIDE** ceiling shared by every AI surface, so two
apartments in flight breached it deterministically — the cron 429ing itself **and starving
guest-chat, the guide and daily-greeting across every tenant** while it ran.

**Concurrency 1 alone would have been incomplete, which is why four changes shipped together.**
Serialising a pool whose items cost ~75s worst case under a 150s `maxDuration` means run 3+ is
killed mid-flight — **silently: no JSON summary and no wholesale-failure ntfy**, losing the only
fleet-level signal for Tavily's 1000-credit monthly pool (this cron deliberately does not
`bump_api_counter`, so `cron-spend-audit` is structurally blind to it). So: a **65s
START_DEADLINE_MS** that defers instead of starting work that cannot finish (a deferral spends no
Tavily credit and no Groq tokens, and the apartment keeps its last-good row and stays reachable
via lazy-fill); **least-recently-refreshed ordering** so the deadline cannot starve a fixed tail;
and `deferred` folded into the alarm condition.

Also applied from review: `startedAt` moved to handler entry (it sat after three DB round-trips,
over-committing the reserve against `sendNtfy`'s own 5s timeout), and a `mapPool` array hole now
counts as a failure rather than throwing past the alarm and 500ing the run. Both gates ran
**three times** — every post-review edit re-ran both, including the comment-only pass — finishing
0 must-fix each.

### CLAUDE.md split (docs-only, `b9c34d4`)

290,660 → **140,644 chars (−51.6%)**, into `docs/history.md`, new `docs/pilot-history.md` and new
`docs/schema.md`. Verbatim moves, live open items hoisted out first, one-line pointers left
behind, **no `@import`** (an imported file loads every session, which is what the split exists to
prevent). Gate was a char-level conservation check that reconciled **EXACTLY** to 290,660.
**It caught a real error**: the first attempt reconciled at **+5,154** because hoisted blocks were
being copied rather than moved, so they appeared both in CLAUDE.md and inside the sections that
then moved to history. **A surplus means duplication; a shortfall means silent loss — check for
both.**

## SESSION Aug 8 2026 — date-window guard corrected; iCal sync bounded, fair and honest

**HEAD `4cce676`. Four commits, three migrations, all HEAD == Vercel READY when shipped.**

- **`cc8e870` — `eventDateInWindow`.** Empty-date events dropped **AT THE CALL SITE** with their
  own `eventsDroppedNoDate` counter — **not inside the function**, whose `null` contract means
  "cannot judge"; returning `false` would have corrupted `eventsDroppedOutOfWindow`. Cross-month
  ranges judged when unambiguous. `d.m.yyyy` incl. ranges, **d.m-vs-m.d ambiguity resolved by
  WIDENING** (union of both readings) rather than choosing. **TWO TEST ASSERTIONS DELIBERATELY
  CHANGED, not weakened** — they pinned the old keep-everything branch. Suite 24/24.
- **`dc04dc1` (b1) — optional absolute `deadlineAt`. THE BOUND WENT IN THE URL LOOP, NOT THE
  CRON:** 20 links x 10s = 200s vs maxDuration 150, and a cron-level start-deadline fixes
  **NEITHER** caller — the interactive route 504s with its counter unit already spent. Both opt in
  (115s / 100s). Unfetched URLs enter `incompleteSources` **INCLUSIVE of the abandoned index**;
  without that `reconcile_ical_bookings` soft-cancels live bookings that existed only in an
  **UNREAD** feed. **Gate must-fix:** the deadline bounds when a fetch **STARTS, not FINISHES**, so
  the last can overrun 10s — reserves cut 125->115 and 110->100, cron overrun modelled as **+10s
  WALL CLOCK** (4 workers overrun concurrently, not additively).
- **`d5cc9e7` (b2).** Least-recently-synced ordering (**ASC, NULLS FIRST — Postgres defaults to
  NULLS LAST, the exact inversion of intent**); deferral **reusing `deadlineAt`, no second
  constant**; attempt stamp **AFTER the deferral check, BEFORE the sync**; this cron's first
  wholesale-failure alarm, on `attempted >= 2 && ok === 0 && failed === attempted`. **`>= 2` is a
  DELIBERATE DEPARTURE from `d254df9`:** at 1 the claim is indistinguishable from one host's broken
  link — the B3.2 alarm-fatigue cost. Deferral enters as **`attempted`**, never `deferred === 0`.
- **`4cce676` (b3) — `SyncResult.failures`,** at exactly the three genuine failure sites and **no
  notice site**, required on all three return paths. b2 keyed `failed` on `errors.length > 0`, but
  **`errors` mixes NOTICES with FAILURES and the MAX_ICAL_URLS notice fires UNCONDITIONALLY BEFORE
  ANY FETCH** — so a >20-link apartment was `failed` forever, never `succeeded`. `errors[]`
  unchanged (host copy; Step 7 rewrites it). `stampFailures` in JSON, kept **OUT** of the alarm.

### THE THREE MIGRATIONS — applied via Supabase MCP, in NO commit
**A future session reading only git history will not see these.**
- **`add_ical_last_synced_at`** — the column + `trg_protect_ical_sync` (BEFORE UPDATE).
- **`rename_ical_sync_trigger_to_convention`** — the first name broke the `trg_` convention.
- **`protect_ical_sync_column_on_insert`** — the UPDATE guard left row **CREATION** uncovered;
  `OLD` does not exist on INSERT, so it needed a `TG_OP` branch. **Live impact NIL, and why it was
  closed anyway is the durable part:** that argument rests entirely on `ASC NULLS FIRST` in a
  TypeScript file, and **a DB-level security property must not depend on application code that can
  change without anyone re-deriving it.**

All three were **VERIFIED AGAINST LIVE BEHAVIOUR**, not against a statement running without
error — observations in docs/history.md, "Aug 8 2026 — date-window guard: the measured
evidence".

**NEXT ACTION is PILOT STEP 6** (guest-chat router + host-picks). The "NEXT ACTION is Step 6"
lines elsewhere are **CORRECT, not stale** — recorded so it is not re-litigated as drift.
## Session — 10 Aug 2026 (HEAD 7f3dac5)

Triggered by a "Subscription event: started / Growth -> Growth" email for host
11b5b459 (udy.baryosef@jchelsinki.fi) on 9 Aug 20:05 UTC.

ROOT CAUSE. `api/create-subscription.ts` opened a fresh Checkout session with
no check for an existing live subscription, so every checkout run stacked
another concurrent Stripe subscription on the same customer. The DB column was
overwritten each time; superseded subscriptions stayed alive and kept billing.
`sub_1TgVsf` (created 9 Jun, orphaned since) renewed on 9 Aug and flipped the
host from `expired` to `active`. The notice read "started" because the
classifier's `oldStatus === 'expired'` branch fired — behaving exactly as
written.

SHIPPED (4 commits, all verified READY on Vercel with matching SHAs):
- 1735d30 — duplicate-subscription guard. `findBlockingSubscription` in
  `api/_lib/stripe.ts`; blocks with 409 `subscription_exists` /
  `subscription_needs_payment`, fails CLOSED (503) if the Stripe lookup errors.
  Writes no billing column — the webhook stays the single writer.
- 6bb48d5 — package-lock.json sync. `stripe` was declared in package.json but
  absent from the lockfile; `npm ci` failed and every build resolved the SDK
  fresh. 248/3, no source touched.
- 90aed01 — explicit Stripe API version pin. Six gate rounds, all failures on
  comment prose; the code never changed after round 1.
- 7f3dac5 — invoice subscription-id extraction across API versions.

STRIPE CLEANUP. Four orphaned sandbox subscriptions cancelled: Anna's 8 Jun
`sub_1Tg9xv`, two for arrivlyudyarrivly@gmail.com (8 Jul), one for
udy.bar.yosef+demo3 (30 Jun). Proven beforehand to fire nothing — their
`metadata.host_id` pointed at deleted rows and their `stripe_customer_id`
matched nothing on file, so both webhook lookups fail. Confirmed after: no
audit rows, no host row changed. Five subscriptions remain, one per host.

DB MIGRATIONS on `hosts`:
- `revoke_client_insert_on_hosts_billing_columns` — SILENT NO-OP, superseded.
- `revoke_client_insert_on_hosts_table_level` — the real fix.
Verified: 0 columns with client INSERT. Signup smoke-tested live (trigger
writes tier 1 / trial correctly); test account removed, cascade clean.

KEY LESSONS
- A column-level REVOKE CANNOT subtract from a table-level GRANT. Postgres
  accepts it, reports success, changes nothing. Revoke at the level the grant
  was made. Same family as the `REVOKE ... FROM PUBLIC` lesson. ALWAYS re-read
  the catalog after a grant change — success means the statement parsed.
- Omitting `apiVersion` does NOT omit the `Stripe-Version` header. Verified in
  stripe@17.7.0 source: `version: props.apiVersion || DEFAULT_API_VERSION`,
  default `2025-02-24.acacia`. Unpinned SDK = unpinned wire API version.
- TWO Stripe versions govern this integration. The client pin governs outbound
  calls. The webhook ENDPOINT version (Dashboard, no deploy, no code review)
  governs inbound payload shape. Endpoint verified at `2026-04-22.dahlia` on
  10 Aug 2026 — a dated observation, not a timeless claim.
- `npm install` reporting "up to date" refers to node_modules, NOT the
  lockfile. It can rewrite package-lock.json without saying so.
- A green `npm run build` proves nothing about `api/` — `tsc -b` excludes it
  and Vite only bundles `src/`. Use `npm ci` and `test:stripe`.

NEW STANDING RULE — GATE STOPPING CONDITION. Once both gates return PASS with
zero must-fix, STOP and commit. After a passing verdict the only permitted
edits are ones resolving a must-fix; remaining warnings are recorded as "known
residuals" in the commit message. If a gate still returns must-fix items after
round three, stop and report rather than attempt a fourth fix. Rationale:
90aed01 ran six rounds where the code never changed after round 1 — reviewers
can always improve prose, so "could be better" must not be treated as "must
act". 7f3dac5 ran two rounds under this rule.

OPEN — DATED
- EARLY SEPT 2026: all five remaining sandbox subscriptions auto-cancel at
  90 days (6-9 Sept). Each WILL resolve a host row and send a real cancellation
  email — including anna.humalainen@gmail.com and yiftach@xn--gnai-8qa.com.
  Decide before then whether test fixtures should carry real addresses.

OPEN — UNDATED
- No `sub.id === hostRow.stripe_subscription_id` check before the `hosts`
  update in `api/stripe-webhook.ts` (~line 272). Host state is last-writer-wins
  from any Arrivly-metadata subscription carrying that `host_id`. THIS IS THE
  MECHANISM BEHIND THE 9 AUG INCIDENT. Currently unreachable — the guard
  prevents new duplicates and the existing ones are cancelled — but it should
  be closed with a `sub.id` equality or newest-wins rule.
- `DELETE` granted to `anon` and `authenticated` on `hosts` with NO delete
  policy. Blocked by RLS, so not exploitable, but the same shape as the INSERT
  grant with a much larger blast radius (cascades to apartments, bookings,
  picks). Found 10 Aug, deliberately untouched.
- 8 npm vulnerabilities (2 moderate, 6 high) — untriaged, dev-time vs shipped
  unknown. `npm audit fix` NOT run.
- Redundant root `as any` in `api/stripe-webhook.ts` blunts the compile-error
  canary a Basil-typed SDK bump would raise. One-token removal, no runtime
  effect.
- First real `invoice.payment_succeeded` after 7f3dac5 is worth watching in the
  Vercel logs — that path has never executed on this endpoint.
- `app_settings.trial_days` is 14; the original project brief says 30. Brief is
  stale, code and UI agree.

## Domain migration + rebrand (Jul 12-17 2026) — moved from CLAUDE.md

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

## Session — 9-10 Aug 2026 (HEAD 2b71fec)

Three commits: `c7ea052` (Groq rate-limit + token-usage observability), `874c26d` (events window
7 → 30 days + a read-time past-event filter), `2b71fec` (TPM/TPD docs correction). **Their commit
messages are unusually complete — git holds that detail and it is NOT restated here.**

**1. RECALL IS CORPUS-LIMITED, NOT WINDOW-LIMITED — WHICH FALSIFIES `874c26d`'s STATED PREMISE.**
It argued the 7-day window throttled recall and predicted 5-8 events; the first 30-day run
(10 Aug 09:01, fi:helsinki) returned **TWO**, and candidates ran **8, 10, 7 — FLAT across window
widths**. The limiter is the Tavily corpus, not the window. **Read that commit message with this
correction beside it.** Full item under OPEN ITEMS.

**2. A BOUND HANDED TO A PARSER IS PART OF THE PARSER.** The 400-day far bound made the read-time
filter structurally unable to return `false`. Both gates caught it — the **FOURTH SPEC defect (not
implementation defect) in two sessions.** Recorded under Lessons, with the bullet-diff trap.

**3. THE GATES KEEP CATCHING PROSE, NOT CODE.** `90aed01` ran **six** rounds with the code
unchanged after round 1; two failures were fixes for earlier fixes, and at round 5 the gates
DISAGREED about one clause — the signal to DELETE it rather than revise again. That produced the
GATE STOPPING CONDITION; `7f3dac5` then ran two rounds under it.

**4. GUEST-CHAT'S 40/HOUR BRAKE IS MIS-SIZED AGAINST TPD.** Its own commit, before Step 6, never
folded into the migration. Full item under OPEN ITEMS.

**NEXT ACTION: the CLAUDE.md restructuring session, ALONE — not Step 6.** Then, in order: the
guest-chat brake decision, Commit B (events staleness gate), Step 6. All "Step 6 is next" pointers
in this file have been updated.

## Session — 10 Aug 2026 (restructuring, HEAD e694e90)

**CLAUDE.md: 156,898 -> 97,532 chars (-38%).** Four docs-only commits, no source file touched.
`4f9ead5` hoist · `94d22e6` key-map consolidation · `bb32f51` deletions · `e694e90` moves.

**WHY ARCHIVING COULD NEVER HAVE WORKED, measured rather than argued.** ~22% of the file sat
inside blocks carrying a `~~strikethrough~~` or SUPERSEDED marker. The editorial convention was to
retain a wrong claim and explain why it was wrong — good epistemics, and invisible to archiving,
because superseded claims live INSIDE durable sections. Two disciplined closes in a row shrank the
record and still grew the file. **The fix was to split on LIFETIME, not topic:** invariants and
live work stay; reasoning trails move to purpose-named files under `docs/`.

**THE POINTER-COST FINDING WAS AN ARTEFACT.** The recorded "a move returns ~half its size once an
honest pointer is written" is true only when items move INDIVIDUALLY. One pointer per BLOCK makes
the cost fixed, not proportional — 44 blocks and 54,025 moved chars cost ~4,900 of pointers and
hoists, roughly 9%.

**A PROOF MUST NOT CLAIM MORE THAN THE CHECK SUPPORTS — and the commit type decides the check.**
Three different proofs were needed and they are not interchangeable. A PURE MOVE gets the exact
round-trip (`4f9ead5` also got an independent delta decomposition, arrived at from the other
direction). A DELETION gets neither — there is nothing to substitute back — so it gets a FORWARD
hoist check proving the content already exists elsewhere, run BEFORE removal. A MIXED commit gets
neither honestly: `e694e90` was therefore split into Phase A (move everything to sentinels, prove
byte-identical) and Phase B (collapse sentinels into pointers and hoists, verify forward), because
the compressed rules and the LAUNCH BLOCKERS spine are new text no round-trip can validate.

**THE THREE-COPIES PATTERN IS SYSTEMIC, not a one-off.** The Gemini key map existed in three
places, each partial, none wrong; consolidating required reconciling a 4-vs-5 surface list (the
fuller list wins — under-listing a shared key is the error that bites). The same pattern then
surfaced again: deleting one copy of the "re-test grounding on Gemini 3" claim left a second alive
elsewhere.

**LESSON — SIZE ESTIMATES BY EYE ARE UNRELIABLE; MEASURE REPRESENTATIVE LINES.** Chat-side
projections missed by +234 then by -14,500 (~13%). Both landed safe by luck, not method. Measure
before projecting.

**LAUNCH BLOCKERS is the substantive change.** Six launch-critical items were scattered across
four sections, which is why AI-pilot work kept reading as the next thing to do when none of it is
a launch blocker. They now sit in one ordered section.

**FOUND AND RECORDED, not fixed:** the npm-audit count is 8 in Known notes and 7 in OPEN ITEMS.
Reconcile by RUNNING it, never by picking.

**VERIFIED AGAINST LIVE DB this session:** five hosts carry sandbox subscriptions, confirming the
6-9 Sept auto-cancel item mails real addresses. Four of five billing-test host descriptions were
materially stale — notably Yiftach, named as the clean "Add card" test row, now HAS a
subscription. `ARR-EVT777` expires 11 Aug; re-roll before any guest-page test.

**NEXT ACTION: RETENTION CRONS.** They gate publishing every legal document, and the legal review
is the only external dependency, so it has a lead time nothing else has. Then: the 6-9 Sept fixture
decision, the guest-chat 40/h brake re-sizing (own commit, own arithmetic), Commit B, Step 6.

## Session — 11 Aug 2026 (retention crons + Viator ruling, HEAD 4d5ac2f)

**LAUNCH BLOCKER 1 CLOSED.** `1b7c3d7` code, `4d5ac2f` docs, after the restructuring commits
`4f9ead5` / `94d22e6` / `bb32f51` / `e694e90` / `2bcd076`. CLAUDE.md 156,898 -> ~100k the same day;
detail in docs/history.md.

**THE SEQUENCING TRAP IS RESOLVED.** The drafted guest notice §6 promised erasure periods the code
did not implement. Now matched: messages 30, guest identities 30, greetings 30, guest push 7, admin
audit 365. **Messages moved 90 -> 30 rather than the document moving to 90** — minimisation is the
defensible direction, and a notice is a promise, not a description of whatever the cron does. Four
of five "undecided" periods turned out to be already decided by notice §6; only `admin_audit` was
open, and 365 is a recommendation carrying `[CONFIRM]`.

**ERASURE MECHANISM.** `guests.first_name` is NOT NULL, so it cannot be nulled in place. The sweep
nulls `bookings.guest_id`, then deletes the `guests` row only when no booking still references it —
a repeat guest with a recent stay is never erased, and the booking survives nameless. Periods are
cron constants; the SECURITY DEFINER functions take `retention_days` as a parameter, so a change is
one line and no migration. A `< 7` guard refuses to run rather than let a near-zero constant wipe a
table. **First run 04:00 UTC 12 Aug** — the 11 Aug slot preceded the deploy by ~8h.

**MEASURED FIRST-RUN EFFECT:** 29 of 38 messages, 12 guest identities, 2 guest push subscriptions;
greetings and audit reap 0 (a zero is normal, not a broken sweep). All lapsed test/demo rows.

**STILL OPEN, DELIBERATELY:** the bookings<->guest LINK. The booking row is retained indefinitely on
a business-records rationale once the link is severed and it stops being personal data. **That is the
one retention decision still gating Art. 17 erasure.**

**THE VIATOR RULING — see PERMANENT PROVIDER CONSTRAINTS.** The reply arrived 4 Aug and was NEVER
RECORDED; three sessions since read "awaiting reply" as current. **A provider answer that changes a
launch dependency sat in an inbox this file cannot see.** The connected Gmail is `udy@tlv.capital`;
the Bemgu thread runs through `hello@bemgu.app`, which is NOT connected — so a Gmail search
returning nothing means "wrong inbox", never "no reply". **Ask Udy directly for provider replies.**

**FOUND 11 Aug — THE WELCOME PAGE IS LIVE AND INVISIBLE.** `/w/:code` is routed and rendering, and
**NO host component references `welcome_code` or `/w/`** — swept all thirteen under
`src/components/host`. There is no copy button, no link, nothing. (Dashboard's 14 "welcome" hits are
the onboarding modal.) The pre-arrival surface was shipped without the one control that makes it
usable, which is why it keeps feeling unsolved. **The share panel is therefore higher value than the
"upcoming" guest-page state**, which was over-rated: the welcome page already carries experiences,
so the "affiliate revenue is switched off pre-arrival" claim was FALSE.

**FOUND 11 Aug — CANONICAL CITY BACKFILL IS HALF DONE.** 4 of 10 apartments have a
`canonical_city_key`, all resolved 7 Aug 11:53-12:50; the other 6 have `canonical_resolved_at` NULL
= never attempted. `api/backfill-canonical-city.ts` is idempotent, CRON_SECRET-gated and **on no
schedule** — it must be called by hand. One ("Penthouse in the sky") is correctly excluded, being
invisible. Re-running takes the events cron from 9 units to ~7.

## Session — 11 Aug 2026 (Viator enforcement + earnings-copy sweep, HEAD 9fa4b7b)

**SHIPPED:** `52b196d` Viator host-own-PID removal · `6a2e180` evidence-class record · `5e6fe76`
`d1c1712` `e20ad7d` `f5b413e` `9fa4b7b` earnings-copy corrections. All gates PASS, most at round 1.
DB: `revoke update (viator_partner_id) on hosts from authenticated` and `revoke delete on hosts
from anon, authenticated`, both verified from the catalog.

**THE ONE-COMMIT FIX TOOK SIX.** The Viator code change was `52b196d` and it was correct first
time. The other five were all one task: finding every place the site claims "you earn commission."
**The cause was asking "did we get them all?" and answering with a PHRASE SEARCH** — first `100%`,
then more words, then headings, then mockup captions — widening the net while fishing the same
pond. The right question, never asked until the end, was WHERE DOES THIS CLAIM LIVE IN THE WHOLE
CODEBASE. That is a thirty-second search and it closed the list. See SWEEP STOPPING CONDITION.

**TWO REAL DEFECTS FOUND, NEITHER ABOUT VIATOR:**
- **Hosts below Tier 3 earn ZERO commission on ALL THREE providers** — `resolvePartnerId` returns
  Bemgu's id below `EXPERIENCES_TIER_GATE` — and the pricing page, hero and signup page carried
  no tier qualifier anywhere.
- **"2–3 bookings covers your fee" was arithmetically FALSE at Bemgu's own constants.**
  `config.ts` AOV 90 x commission 0.08 = **EUR 7.20/booking**; Portfolio EUR 25 needs **3.47**.
  Two bookings = 58% of the fee, three = 86%. The CLAUDE.md ~EUR 315/mo anchor independently gave
  3.5. Both internal sources agreed against the page. Now "3–4". **The copy moved to the
  arithmetic, never the reverse.** Known trade: only "about 4" is true at every point of the range.

**"PORTFOLIO" IS LOAD-BEARING BY ACCIDENT.** Tier names DIVERGE: the landing page says
**Host** and **Full booking**; `tierCopy.ts` and `BillingPanel` say **Growth** and **Pro**.
Portfolio is the only name matching all three surfaces, which is the sole reason every
"on Portfolio" qualifier survives from landing to dashboard. Rename it on one surface and they
all decouple at once.

**MECHANISM NOTE — SELF-QUALIFYING BEATS PARENT PROSE.** Landing scopes its hero figures with a
15px parent that precedes them in DOM order. AuthShell's DOM order is reversed, so the claim was
made self-qualifying instead ("and on Portfolio, you earn") — qualifier and claim in the SAME text
node at the same size. Prominence parity by construction; it cannot decouple under a later CSS
change. Prefer this. Also: fixing the shared `AUTH_POINTS` default covered all FIVE AuthShell
render surfaces; a per-caller fix would have left four stale.

**OPEN DECISIONS FOR UDY — recorded, not decided:**
- **`ExperiencesSheet.tsx:197` — the guest-facing disclosure names the WRONG BENEFICIARY.** It
  says "Your host may earn a commission." For Viator that is never true, and below Tier 3 it is
  never true for any provider — **Bemgu** earns. This is the only consumer-facing disclosure in
  the set and the highest-stakes one. **The defect is beneficiary identity, not tier scope**, so
  the fix is naming the beneficiary, not adding "on Portfolio". Suggested: "Your host or Bemgu
  may earn a commission…"
- **Tier names: one set or two?** See above.

**RESIDUALS:** `EarningsPanel.tsx ~301` is unqualified but sits in `confirmedCard`, which renders
only when `confirmedCount > 0` — never in production today. **`tierCopy.ts` is the file to watch:**
it feeds `/choose-plan`, the actual point of payment, and today carries NO earnings claim — any
bullet added there lands straight on the payment page. Non-code axes never swept: emails, push
copy, `index.html`, DB-stored copy.

**NEXT ACTION: the welcome share panel.** `/w/:code` is live and no host component links to it.
Mockup-first. Fresh surface, unrelated to this sweep.

## Session — 11-12 Aug 2026 (the Share panel, HEAD 5153bc4)

**SHIPPED:** `8ff40e5` the Share panel · `5153bc4` its residual fixes. Both gates PASS on both.
Two migrations applied chat-side: `apartments.welcome_message` + its CHECK, and
`revoke insert, update, delete on public.apartments from anon`.

**THE DEFECT CLOSED.** `/w/:code` had been live and rendering since 28 Jul and **no host
component referenced `welcome_code` or `/w/` anywhere**. The pre-arrival surface shipped without
the one control that made it usable, which is why it kept feeling unsolved. `QRCodePanel` became
`SharePanel`; `/dashboard/qr` became `/dashboard/share` with the old path kept as a redirect.

**THE SHAPE OF THE SCREEN IS THE POINT.** Step 1 SEND THIS is a copyable share message with the
welcome URL inside it — one button copies the WHOLE message, because a bare link is not what a
host pastes into Airbnb. Step 2 PRINT THIS carries an explicit "don't send this one to guests".
The two artefacts open DIFFERENT pages and confusing them is the failure the screen exists to
prevent. The old guest-page copy button is demoted to a collapsed disclosure.

**THE CHARACTER LIMIT TOOK TWO PASSES, AND THE SECOND IS THE LESSON.** Reserving `url.length + 2`
up front looked right and was not: **`maxLength` constrains TYPING, not a programmatic
assignment**, so a message saved at the reduced bound came back ~39 chars longer, and re-editing
showed **"1995 / 1958" in neutral grey while the textarea silently swallowed every keystroke** —
the same "the counter lies about the bound" defect, one step downstream. Fixed by pinning
`maxLength` to the DB ceiling and DERIVING the displayed bound from the draft (full 2000 when the
link is present, reduced when it is not, since only a draft missing the link pays for the append).
That made the over-limit state reachable for the first time instead of dead code.

**TWO GATE WARNINGS WERE PROMOTED TO MUST-FIX, DELIBERATELY.** Both round-1 gates returned PASS
with zero must-fix, and the GATE STOPPING CONDITION says stop there. Two warnings were fixed
anyway, on the ground that they were **the requested scope not landing, not optional extras** —
the counter still lied, and a FOURTH discarded `error` still collapsed failure into the
"No properties yet." empty state that the brief had explicitly forbidden. **That distinction is
the operative one: a warning that says "your fix does not do what it says" is not a residual.**
The other four warnings were left as residuals and are in the `5153bc4` message.

**THE COMMENT-ONLY EXEMPTION WAS BORN HERE** (now a standing rule in Agent policy). Round 2's
single must-fix was a comment that this session's own edit had FALSIFIED — it claimed a
draft-derived limit was deliberately rejected, which is exactly what the code now does. Deleted
rather than revised. Sending a five-line comment deletion back through two gates is the churn the
stopping condition exists to prevent, so it was not re-gated; the build was green after it.

**MEASURED FROM THE LIVE CATALOG, and one reading corrected:** `apartments` ACL is now
`anon=m`. **`m` is MAINTAIN, not SELECT** — `has_table_privilege` confirms anon holds NO read on
`apartments` either. Recorded in docs/schema.md so "anon has SELECT only" is not restated.

**FOUND STALE, NOT ASKED FOR:** the anon-read lockdown for `guide_recommendations` + `host_picks`
was carried in docs/design-backlog.md as PARKED with `USING(true)` policies. **Both policies were
dropped 28 Jul and the reader migration is complete** — verified from `pg_policies` and from the
absence of any read under `src/components/guest/`. The entry described work already done.

**NEXT ACTION: the picks-vs-message coupling, then Step 6.** The share message promises "our own
favourite places"; the panel nags when a property has zero `host_picks`, which is the first time
those two facts have met in the UI. Everything else stands as recorded in OPEN ITEMS.
