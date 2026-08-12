# Design backlog — scoped, not built

Moved out of CLAUDE.md, which keeps the live rules and points here.

### UX — NEEDS A DESIGN CONVERSATION FIRST (discussion list, NOT the build list — Jul 29 2026)

Three items raised this session. **Do not write a prompt for any of them until discussed.**

1. **WELCOME LINK vs QR CODE placement.** The agreed Phase-a mockup puts the welcome link
   side by side with the QR code. Udy wants to revisit: the two have **completely different
   jobs** — the link is **SENT** to a guest who has just booked, the QR is **PRINTED** and left
   in the flat — and side-by-side placement risks a host sending the wrong one. **NOTE: this
   REOPENS an already-agreed and recorded design decision** (the "Step 1 you send it / Step 2
   you print it" split under WELCOME PAGE Part 2), so that recorded agreement **must not be
   treated as settled** at the start of the Phase-a build.
2. **PROPERTY NAME MISSING from the edit page.** `PropertySetup.tsx` renders a hard-coded
   `<h1>Property setup</h1>`; the property name **is loaded into state but never displayed**.
   With several properties every edit page looks identical, so a host cannot tell which one
   they are editing.
3. **NO SCROLL RESET ON ROUTE CHANGE — global, not local.** Verified: **no `ScrollRestoration`,
   no scroll-to-top handler, no `autoFocus`, no `scrollIntoView` anywhere in `src/`.** React
   Router does not reset scroll position by default, so navigating from a scrolled page lands
   the next page mid-content — e.g. scrolling the dashboard to reach a property card and
   clicking Edit opens the setup page **below its own tab bar**. Surfaced on the property edit
   page, but it affects **EVERY route**.

### Anon-read lockdown: guide_recommendations + host_picks — DONE, not parked (verified live 12 Aug 2026)

This item described `guide_guest_read` and `host_picks_guest_read` as live `USING(true)` anon policies that `GuestPage` depended on. **Both were dropped on 28 Jul 2026 and the reader migration was completed.** Verified from `pg_policies`: `guide_recommendations` now has only `guide_host_select`, and `host_picks` only `host_picks_host_all` — both scoped `apartment_id IN (select id from apartments where host_id = auth.uid())`. Verified from source: **no component under `src/components/guest/` reads either table**; guest-side access runs through service-role endpoints (`api/guest-bootstrap.ts`, `api/guest-preview.ts`, `api/welcome.ts`, `api/_lib/guide.ts`). The reader-migration-first pattern this entry called for is exactly what was done. Kept as a worked example of that pattern rather than deleted.

## WELCOME PAGE — Phase 1 SHIPPED (Jul 28–29 2026); Part 2 NOT BUILT

Public per-apartment page at **`/w/:code`** — the pre-arrival surface the guest can be sent
BEFORE they arrive (the QR is physical and only reachable at the property).

**Decisions locked:** full address shown, host-toggleable via `apartments.welcome_show_address`
(**default true**); **8-char code from a 30-char unambiguous alphabet**; public AI concierge
branded with the **host's** name; **no in-app messaging** — WhatsApp instead, so **no guest
PII is collected**; experiences framed as **host advice, not a storefront**; an expired host
shows brand + one neutral line + WhatsApp only and **never** billing state; **noindex**
(Viator licence).

**Migrations — ALREADY RUN by the operator. DO NOT RE-RUN:** `welcome_page_columns`
(`welcome_code` unique, backfilled + BEFORE INSERT trigger, `welcome_show_address`,
`welcome_note`), `welcome_views_counter` (day-bucketed, service-role write, host SELECT
only, TRUNCATE/TRIGGER/REFERENCES revoked).

**Code:** `82fd0dc` (page + `api/welcome.ts` + `api/welcome-chat.ts`), `5f16b42` / `ff444a0`
(model selection), `aa446d2` (grounding removed), `d79fd9e` (no-live-info prompt bullet).

**PART 2 REMAINING (not built):**
- **Share panel** — rename the QR panel: "**Step 1, you send it**" (welcome link) vs
  "**Step 2, you print it**" (QR), with a stay timeline and an explicit "do not send this
  one" line on the QR card.
- **AI-drafted, editable welcome note.**
- **Three copy-ready message variants** (Airbnb / WhatsApp / email) with 2–3 language options.
- **View-count display.**
- **Point `GuestPage`'s dead neutral state at the welcome renderer.**

## PRE-ARRIVAL GUEST REACHABILITY — DESIGN SESSION SCOPED (Jul 28 2026; do NOT build yet)

**The problem.** The guest page is binary today: active during the stay, neutral
otherwise. A guest who opens the link before arrival gets the neutral page, and a host
message sent pre-arrival is never seen.

**The reframe:** this is not one feature, it is a THIRD PAGE STATE — "upcoming" — with
its own content rules. It cannot be a simple date-condition change, because check-in
secrets (door code, entry instructions) are deliberately gated, and "previous guest
protection" exists to stop a departed guest seeing the next booking. Opening the page
early without a content model would leak door codes weeks ahead.

**Five questions the design session must answer, in order:**
1. **What shows in the upcoming state?** Starting proposal: everything EXCEPT check-in
   secrets — greeting, dates, getting-here directions, city guide, host picks,
   experiences, house rules, message-the-host. Withheld: door code, entry instructions.
2. **When do the secrets unlock?** Fixed rule (e.g. 24h before check-in) vs a host
   setting. Hosts differ genuinely here, which argues for a setting — but that is more
   surface to build and to get wrong.
3. **How does the link reach the guest?** The QR is physical and AT the property, so
   pre-arrival access depends entirely on the host sending a link. A prominent "copy
   guest link" affordance in Bookings is therefore a hard dependency, not a nicety.
4. **AI spend and the security gates — handle with care.** `guest-chat` is verify-gated
   on an **in-dates** token (Phase G security work); pre-arrival access requires changing
   that gate. The daily greeting is built around stay-days that do not exist pre-arrival.
   Neither is a quick condition flip.
5. **Cache targeting.** `cron-refresh-experiences` is booking-targeted on ACTIVE stays;
   pre-arrival guests would hit cold cache unless upcoming bookings are included.

**Why it is worth doing.** (a) A guest can only subscribe to push AFTER opening the page
— so pre-arrival access is the PRECONDITION for pre-arrival messaging working at all.
(b) Commercially: someone planning two weeks out is far likelier to book a tour than
someone who has just dropped their bags. The Phase I affiliate revenue is currently
switched OFF during the window with the highest booking intent.
