# Phase I — affiliate connectors, detail and provider terms review

Moved out of CLAUDE.md, which keeps the live rules and points here.

**Scope — v1 providers: Viator + GetYourGuide + Tiqets** (maximum city coverage; all three have open/free affiliate signup — Viator grants Basic API access instantly, Tiqets grants Content+Availability APIs at signup, GYG partner-portal review takes days). **Restaurants (OpenTable/TheFork) DROPPED from Phase I:** per-booking fees are pennies, access gates are slow, EU coverage is weak (OpenTable), and Host Picks already covers restaurants editorially. **Holibob** (B2B white-label experiences API, 500k+ products, negotiated margin) = the **Phase-2 embedded-checkout target** once volume justifies a BD conversation.

**Revenue model DECIDED — variant "c-full" ("show everywhere, earn at Tier 3"):**
- Guest pages on ALL tiers show IDENTICAL experience cards; outbound links are **server-built deep links (NOT provider embed widgets** — widgets set cookies and would drag GDPR consent obligations onto the guest page).
- Every link stamped with campaign tag **`arrivly-{apartmentId}`**.
- **Tier 1–2:** links carry ARRIVLY's OWN partner IDs → Arrivly earns the ~8% commission on lower-tier traffic; per-campaign provider reporting powers a personalised, factual upgrade tease in the Earnings panel ("Guests at your properties booked €X last month — on Tier 3 that commission is yours"). **Transparent copy is MANDATORY:** the panel must state plainly that on T1–T2 commissions go to Arrivly and on T3 to the host.
- **Tier 3+:** host pastes their OWN partner IDs (per provider) and links switch to the host's IDs → provider pays the host directly (~8%); Arrivly never touches host money.
- **Gating rationale (verified Jul 10 2026):** Hostfully includes Viator earning FREE on all plans incl. free tier; Hostaway ships GYG as a standard integration. c-full keeps guests unharmed, monetises low tiers, and turns the gate into a personalised upgrade ad.

**Host UX:** new account-level **"Earnings" sidebar section** (partner IDs are per-host, NOT per-property). Per provider: signup deep link, ID input with format validation (Viator ID = `P` + 8 digits), connected state. **Guest UX:** experience cards render in the Explore tab via the existing `SHOW_EXPERIENCES_SLOT` flag-gated slots.

**Marketing anchor numbers (for the landing page later):** ~8% commission → ~**€315/month** of guest bookings covers the full **€25 Tier-3** fee (~2–3 tour bookings); comps charge per property (Hostfully Guidebooks $9.99/1 → $24.99/5 → $49.99/10 → $75+; Touch Stay ~$15/property, no free plan) vs Arrivly **flat €25 unlimited**.

**Open verification items / external threads:** (a) exact commission rates are account-level and change — product copy must say "typically ~8%", **never promise a number**; (b) **Viator multi-tenant / host-own-ID permission — REPLIED ~Jul 29, NO APPROVAL GIVEN, still OPEN and now a TIER 3 LAUNCH DEPENDENCY** (sent Jul 24; see "SESSION Aug 4 2026" for what the reply did and did not say, and for the drafted-unsent response); (c) **Tiqets image pipeline — VERIFIED LIVE Jul 27 for partner `bemgu-188668`** (cache invalidated via MCP → lazy-fill returned real Tiqets CDN image URLs on all Sweet home cards; ratings + `imageCredit` mapping shipped). Only a final visual caption eyeball on a live card remains (if not already done). **DONE this session (was item d):** the Tiqets `reviewCount`-null bug is fixed (`146173f` — `ratings.total`/`ratings.average` mapping) and the temporary `[experiences:tiqets:debug]` log is removed.

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

> ITEMS 2 and 3 moved to "PERMANENT PROVIDER CONSTRAINTS" — they are binding obligations, not review findings. ITEM 1 stays here because it is an unresolved verification with a data gap.

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
