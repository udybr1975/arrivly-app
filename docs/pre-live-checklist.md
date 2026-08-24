# Pre-live checklist — the argument behind each item

WHAT THIS IS: the reasoning behind the pre-live additions. Moved VERBATIM out of CLAUDE.md's
"PRE-LIVE ADDITIONS from this session" on 24 Aug 2026 during the restructure. Nothing was
edited, summarised or reordered.

WHAT STAYED IN CLAUDE.md: every item's one-line statement, and both RULES this block contains —
(1) a paste-back checker MUST run entirely client-side, never sent to the server, never stored,
never logged, because a resolved paste carries a real guest's name AND their booking credential;
and (2) the SHARE PANEL holds the authoritative STEPS (data in `sharePlatforms.ts`) while the
DRAWER explains what/why — two copies of the steps drift within a session. **No rule was moved
here.**

---

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

