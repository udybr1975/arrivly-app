# Legal & compliance workstream — full detail

Moved out of CLAUDE.md, which keeps the live rules and points here.

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
