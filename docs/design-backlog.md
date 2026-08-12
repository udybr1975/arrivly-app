# Design backlog — scoped, not built

Moved out of CLAUDE.md, which keeps the live rules and points here.

### UX — NEEDS A DESIGN CONVERSATION FIRST (discussion list, NOT the build list — Jul 29 2026)

Three items raised this session. **Do not write a prompt for any of them until discussed.**
**STATUS 12 Aug 2026 — ALL THREE ARE NOW BUILT.** Kept as the record of what was decided and why,
not as a to-do list. Re-read before reopening any of them.

1. ~~**WELCOME LINK vs QR CODE placement.**~~ **SETTLED BY BUILDING IT — `8ff40e5`.** The
   concern was that side-by-side placement risks a host sending the printed code to a guest. The
   shipped Share panel keeps the two apart and labelled by JOB — "Step 1 — send this" (green,
   the welcome link inside a copyable message) above "Step 2 — print this" (the QR, carrying an
   explicit **"Don't send this one to guests — it's for the wall"** warning). The guest-page URL
   is demoted to a collapsed disclosure. The recorded agreement was upheld, not overturned.
2. ~~**PROPERTY NAME MISSING from the edit page.**~~ **BUILT — `a34af78`.** "Property setup"
   is now an eyebrow above an `<h1>` carrying the property name, from the `basic.name` already in
   state (no new query). Tracks the Basics field live rather than snapshotting, so the header
   cannot contradict the field being typed into; falls back to 'New property' / 'Untitled
   property'; `truncate` against the wrapper's `max-w-3xl` keeps the tab bar in place.
3. ~~**NO SCROLL RESET ON ROUTE CHANGE.**~~ **BUILT — `a34af78`**, in `Layout`, keyed on
   `pathname` only so a `?tab=` switch cannot jump a host to the top mid-edit. **Read the lesson
   in CLAUDE.md before touching it:** the first version targeted the `overflow-auto` `<main>` and
   was a SILENT NO-OP — the window is the scroller, because the root's `min-h-screen` is a
   minimum, so `<main>` stretches and can never overflow. (The old claim here that there is "no
   `scrollIntoView` anywhere in `src/`" was also wrong — there are five, all within-page panes.)

### Anon-read lockdown: guide_recommendations + host_picks — DONE, not parked (verified live 12 Aug 2026)

This item described `guide_guest_read` and `host_picks_guest_read` as live `USING(true)` anon policies that `GuestPage` depended on. **Both were dropped on 28 Jul 2026 and the reader migration was completed.** Verified from `pg_policies`: `guide_recommendations` now has only `guide_host_select`, and `host_picks` only `host_picks_host_all` — both scoped `apartment_id IN (select id from apartments where host_id = auth.uid())`. Verified from source: **no component under `src/components/guest/` reads either table**; guest-side access runs through service-role endpoints (`api/guest-bootstrap.ts`, `api/guest-preview.ts`, `api/welcome.ts`, `api/_lib/guide.ts`). The reader-migration-first pattern this entry called for is exactly what was done. Kept as a worked example of that pattern rather than deleted.

## PHASE H — COLOUR TOKENS FIRST, THEN CONTRAST (scoped 12 Aug 2026; ONE item, do NOT fix piecemeal)

**This is a SINGLE Phase H item, not four contrast bugs.** Four sub-AA colours were measured
while shipping unrelated work, and the instinct each time was to fix that one site. That was
considered and **REJECTED**: naming one colour in isolation leaves the codebase half-tokenised
with no rule about which colours have names, so the next person cannot tell whether a hex is
deliberate or unconverted.

**PREREQUISITE FINDING — there is NO token layer at all (measured 12 Aug 2026).** `src/` carries
**2,006 hardcoded hex occurrences across 143 distinct colours**. `tailwind.config.js` has an
**empty `theme.extend`** and `src/index.css` is **only the three `@tailwind` directives** — so
every colour in the app is a literal at its use site. Top by frequency: `#c8a24e` (217),
`#1c1c1a` (161), `#f0ede6` (130), `#231d17` (130), `#8a8276` (112), `#fffdf9` (92), `#e4ddd0`
(86), `#e7d6ad` (74), `#a79e8e` (52).

**ORDER IS LOAD-BEARING: introduce the token layer FIRST, then apply contrast corrections on top
of it.** Doing it the other way means correcting values that are about to move anyway, and
re-testing twice.

**Contrast failures — all COMPUTED (Tailwind v3, WCAG 2.x relative luminance), not estimated:**
| Colour | On | Ratio | Note |
|---|---|---|---|
| `#a79e8e` (LABEL token) | `#f0ede6` | **2.27:1** | the worst, and the most used — 52 sites |
| `#8a8276` (PlanCard valueProp) | `#fffdf9` | 3.73:1 | 12.5px, so not large text either |
| `#a8842f` (PlanCard tier name) | `#fffdf9` | 3.44:1 | lower than the descriptor beside it |
| `#f0ede6/45` (Landing descriptor) | `#23211d` | ~3.90:1 | 13px |
| reference: `#8a8276` | `#f0ede6` | 3.24:1 | still short of AA |
| reference: `#6b6354` | `#f0ede6` | 5.08:1 | passes; already in the palette |

**KNOWN EXCEPTION — DO NOT SWEEP BLINDLY.** `src/components/demo/UpgradeWall.tsx:21` uses
`#a79e8e` as **disabled-button text** (`BTN_DISABLED_CREAM`). Disabled controls are **exempt**
from WCAG contrast requirements, and raising it would make a disabled button read as enabled —
a worse defect than the one being fixed. Any sweep must classify by ROLE, not by hex value.

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
- ~~**Share panel**~~ — **SHIPPED `8ff40e5`** as `/dashboard/share` (`SharePanel.tsx`, replacing
  `QRCodePanel`; `/dashboard/qr` redirects). The "Step 1 you send it / Step 2 you print it" split
  and the "don't send this one" warning are live. **The stay timeline was NOT built** — that part
  of this bullet is still open.
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
