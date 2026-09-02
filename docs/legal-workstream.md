# Legal & compliance workstream — full detail

Moved out of CLAUDE.md, which keeps the live rules and points here.

## LAUNCH DECISION — 1 Sep 2026 (Udy, in chat): OPTION B

**Resolve the `[CONFIRM]` markers in a working session, publish the drafted documents as v1 on
bemgu.app — a legal page plus REAL links under the Signup consent checkbox, which today links to
NOTHING (a freeze-lifted code change, both gates) — BEFORE the first marketing spend.
Finnish-lawyer review becomes a FAST-FOLLOW on the published v1, not a gate.**

**LAUNCH BLOCKER #2 IS THEREBY SCHEDULED, NOT WAIVED.** The documents still get reviewed; what
changed is the ORDER, so the external dependency stops blocking a launch that is otherwise
ready. Everything below stands unchanged — the `[CONFIRM]`/`[BUILD]` markers are still the
to-do list and are still never to be resolved, tidied, renumbered or removed except in that
working session.

## PART 1 DECISIONS (1-2 Sep 2026, Udy in chat)

**Nothing in the drafts was edited tonight. The markers stay PHYSICALLY INTACT and are resolved
in the v1 editing pass**, against the decisions below. This section is the input to that pass,
not the pass itself — recorded separately so that if the pass is interrupted, the decisions
survive without a half-edited document.

### VERIFIED AT SOURCE (chat, 1 Sep 2026)

- **Server logs.** Supabase free tier **1 day**; Vercel Pro runtime logs **1 day** (Vercel
  pricing page). The guest-notice section 6 row reads *"held briefly by our hosting providers
  for security and debugging (currently up to 7 days)"* **once Supabase Pro lands (D1)** —
  otherwise **"~1 day"**. **The two versions are not interchangeable: publish the one that
  matches the plan actually in force on the day of publication**, or section 6 is false the
  moment it ships.
- **ntfy.sh.** Operator **Philipp C. Heckel (US)**, published privacy policy; messages cached
  **~12 h** then deleted; app delivery via **Google FCM**. Fills the section 6 ping row and the
  DPA Annex 2 ntfy location (**United States**).
- **LocationIQ.** **Unwired Labs (India) Pvt Ltd, Hyderabad**; Bemgu calls the **EU endpoint**
  (`eu1.locationiq.com`); the provider publishes a DPA (`locationiq.com/dpa`). Annex 2 location
  → **"India (EU endpoint used)"**. **Property addresses only, never guest identities.**
- **Entity (Finnish register).** U & A Investment and Consultancy Oy, osakeyhtiö, Y-tunnus
  **3234935-4**, Runeberginkatu 17 A [x], 00100 Helsinki. **PENDING Udy's address-letter
  confirmation of A3 vs 4** — the only unresolved character, and it must be settled before
  publication because a company's registered address is a statutory disclosure.

### DECIDED (each: Udy in chat, on planner recommendation)

- **D1 — Supabase Pro (EUR 25/mo): TAKEN.** **Decided on BACKUPS for a live paying product**,
  not on the password toggle. Side effects, all of which are consequences rather than reasons:
  the backups sentence in guest-notice section 6 becomes TRUE with **"7 days"**; log retention
  becomes 7 days; and the leaked-password toggle unblocks, so **post-runbook (e) closes when the
  toggle is actually flipped AND advisor-verified** — not when Pro is purchased.
- **D2 — `admin_audit` retention CONFIRMED at 365 days** as the v1 number; the lawyer flag stays.
- **D3 — `guest_optins`: keep the table, mark it DORMANT in the inventory, OMIT from the guest
  notice v1.** **No disclosure of processing that never occurs** — describing a dormant table
  would make the notice inaccurate in the direction of over-claiming.
- **D4 — wttr.in weather: PROXY SERVER-SIDE** (the workstream's own 30 Jul recommendation), in
  the v1 build commit. **This DELETES the guest-IP disclosure and the subprocessor row rather
  than documenting them** — the cheapest compliance work is the processing you stop doing.
- **D5 — `bookings` row indefinite retention CONFIRMED** on the business-records rationale for
  v1; lawyer flag stays. **The guest link is still auto-severed at 30 days**, which is what keeps
  this consistent with the published retention promise.
- **D6 — Entity details: as verified above**, subject to the A3-vs-4 confirmation.
- **D7 — ntfy DPA row amended** to *"pseudonymous property and host identifiers, never guest
  identities"* — host account UUIDs now ride the alarm topic. **THIS DECIDES post-runbook (h),
  which CLOSES when the v1 DPA text ships** (not when this decision is recorded).
- **D8 — US transfers, v1 generic clause:** providers outside the EEA are engaged under **EU SCCs
  or DPF certification**; the lawyer refines per-provider.
- **D9 — nods.** DPA **v1.0 effective on publication**; subprocessor annex at a **stable URL**;
  the three Gemini-era markers resolve against the **CURRENT** provider set — the table gains
  **Groq (US, ZDR enabled)**, **Tavily (US)** and **Geoapify**, and the guest-chat paragraph
  states **Google's 30-day grounding storage**. **The Gemini grounding-cache question stays
  UNRESOLVED and lawyer-flagged**, per this workstream's own instruction — it is not swept up by
  D9.

### REMAINING FOR THE EXECUTION SESSION

1. **ToS v1 draft — none exists**, and the Signup consent checkbox already names it.
2. **The v1 editing pass**, resolving the markers against the decisions above.
3. **ONE freeze-lifted build commit, both gates:** legal page + guest-notice links + brand-name
   injection + the wttr proxy (D4).
4. **Lawyer review as the fast-follow** on the published v1.

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

**SEQUENCING TRAP — CLOSED 11 Aug 2026.** It read: the retention crons must ship BEFORE
publication and BEFORE the lawyer review, because the drafts state guest names and messages are
erased **30 days after check-out** while the code did not do it (messages were on 90 days; the
guest-name, greeting and push sweeps did not exist at all). Publishing first would have put a
**FALSE STATEMENT into a privacy notice** — materially worse than having no notice.
**Now shipped:** `cron-cleanup-messages` moved 90 → 30 (the CODE moved, not the document —
minimisation is the defensible direction) and `cron-retention` sweeps guest identities 30d,
greetings 30d, guest push 7d, admin audit 365d. The code matches §6, so the documents are
publishable and the lawyer review can start. **The trap itself is permanent, only its instance is
closed:** these periods are now a two-sided contract — change a constant and the notice AND the
Art. 30 record in the SAME commit, or none of them.

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
4. **Retention — DECIDED AND IMPLEMENTED 11 Aug 2026** for `guests` (30d), `daily_greetings`
   (30d) and guest `push_subscriptions` (7d), matching guest notice §6. `admin_audit` runs at
   365d but **[CONFIRM] — that period is the founder's recommendation, NOT counsel's.**
   **STILL OPEN: the booking ROW.** The guest LINK is severed automatically (the identity sweep
   nulls `bookings.guest_id` at 30 days, so the row stops being personal data), but the row
   itself is retained INDEFINITELY and deliberately, on a business-records rationale. That is
   the one retention decision still gating the Art. 17 erasure feature.
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
   All remain **DRAFT, NOT published, NOT in force**. ~~pending the retention crons shipping~~
   — **those SHIPPED 11 Aug 2026 (SEQUENCING TRAP above is CLOSED), so the only remaining
   condition is the Finnish lawyer review**, which is now the longest-lead item on the launch
   path and should start first. Every `[CONFIRM]` / `[BUILD]` marker
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
