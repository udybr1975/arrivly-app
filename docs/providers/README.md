# AI Pilot Provider Legal Documents — Bemgu

Collected 2026-08-05/06 during Pilot Step 1 (provider checks) and Part A (account creation).
Zero-Google AI pilot plan: see CLAUDE.md section "ZERO-GOOGLE AI PILOT".

## groq/  (account: hello@bemgu.app, org "Bemgu", key name "bemgu-production", free tier, no card)
- Groq_services_agreement (.docx + .pdf) — EEA customers contract with **Groq UK Limited**;
  no-training clause is contractual (§ "Groq is not permitted to use Inputs or Outputs for
  training"); ZDR setting contractually referenced. No free-tier commercial/EEA restriction found.
- DATA_PROCESSING_ADDENDUM_FOR_GROQCLOUD_SERVICES (.docx + .pdf) — EU SCCs Module 2 deemed
  signed on contracting; GDPR/CCPA/UK GDPR scoped; deletion ≤180 days post-termination.
- GROQ_ACCEPTABLE_USE___RESPONSIBLE_AI_POLICY (.docx + .pdf) — "circumvent" clause targets
  abuse/safety bypasses, not separate business accounts.
- **ZDR STATUS — UNVERIFIED, DO NOT RELY ON IT (flagged 2026-08-06 by the security-auditor).**
  This line previously asserted "Console setting applied: Inference APIs ZDR = Enabled". Its own
  evidence contradicts that: `screenshots/groq_data_controls_zdr_page.png` shows **Global ZDR =
  Disabled AND Inference APIs ZDR = Disabled**, and the breadcrumb reads **"Personal / Default
  Project"** — not the **"Bemgu"** org the production key belongs to (see the account line
  above). So the screenshot may simply be of the wrong project, or ZDR may genuinely be off.
  **If ZDR is off, Groq retains inputs and outputs for 30 days**, which is a guest-notice and
  Art. 30 disclosure obligation — structurally the same finding as the Gemini grounding 30-day
  storage (legal Gap 5). **ACTION: check Data Controls inside the Bemgu org, re-capture a dated
  screenshot, then restate this line as fact.** It is also the only screenshot without a date
  suffix.

## tavily/  (account: hello@bemgu.app, Researcher free plan, no card, PAYG prohibited by policy)
- Tavily_Platform_Terms_of_Service.pdf — fetched from tavily.com/terms (contracting party:
  AlphaAI Technologies Inc. dba Tavily; owner since Feb 2026: Nebius Group N.V., Amsterdam).
- Tavily_Privacy_Policy.pdf — fetched from tavily.com/privacy.
- **No self-serve DPA exists** (confirmed in Trust Center 2026-08-06). Compliance mechanism is
  the hard build rule: no guest text / no personal data ever enters a Tavily query.
- Subprocessors (10, all United States) include **Groq, Cohere, OpenAI** as application
  functionality providers — see screenshots. ISO 27001:2022 + SOC2 Type II certified
  (reports requestable via Trust Center).

## geoapify/  (account: hello@bemgu.app, project "bemgu", Free plan 3,000 credits/day, no card)
- Geoapify_Pricing_Page.pdf — fetched from geoapify.com/pricing; Free plan: 3,000 credits/day,
  "Limited Commercial Use", max 5 requests/second (guide POI queries must run sequentially).
  Upgrade path if outgrown: API-10, €49/mo fixed.

## screenshots/
Dated console/Trust-Center evidence backing the notes above.

## Wallet policy (applies to all three)
No-card free tier or fixed prepaid plans only. No postpaid meter may ever be attached.
LLM ladder: Groq free → Groq Developer + hard spend limit → (per surface, ≥50 hosts, only if
earned) Google.
