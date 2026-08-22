# Pre-arrival personal guest link — the design record

WHAT THIS IS: the full design of the pre-arrival personal guest link — the original locked
decision of 20 Aug 2026, the 22 Aug amendment marked in place with its strike-through, and the
reasoning behind both. Shipped in `13eaaf3` / `c0848d8` / `ed92ad2`.

WHAT THIS IS NOT: the binding rules. Those live in CLAUDE.md, under "PRE-ARRIVAL PERSONAL GUEST
LINK — the binding rules". If you are about to change this code, read CLAUDE.md; read this file
only when you need to know WHY a rule is shaped the way it is, or what was decided and then
falsified.

---

### PRE-ARRIVAL PERSONAL GUEST LINK — LOCKED 20 Aug 2026, AMENDED 22 Aug 2026, SHIPPED

**SHIPPED** across `13eaaf3` / `c0848d8` / `ed92ad2`, all deploy-verified. The design below is
the record of what was decided and what CHANGED; the amendments are marked in place rather than
rewritten over, so the original decision and its correction can both be read.
**This feature is still the centre of the pentest gate.**

**WHY AMENDING A LOCKED DESIGN WAS LEGITIMATE, and the precedent matters more than this
feature:** the design carried its own invariant — *verify the platform's variable syntax
against live behaviour at build time, never from memory*. Doing exactly that, on 21 Aug, is
what FALSIFIED the check-in date. **The lock held and the invariant overrode it.** A lock that
survives contact with evidence it told you to go and collect is not a lock, it is a wish.

**THE MECHANISM.** ONE STATIC host template, pasted ONCE into the booking platform's automated
welcome message, carrying **the PLATFORM'S OWN variables** ~~(guest first name + check-in
date)~~ **— AMENDED 22 Aug 2026: guest first name + CONFIRMATION CODE, and the order is
`#c={code}&g={name}`, CODE FIRST —** appended to the existing welcome link.

**WHY THE DATE IS GONE (verified live, 21 Aug 2026):** Airbnb's check-in date chip renders as a
human-readable string containing spaces and a comma, which TERMINATES a URL, and it is
LOCALISED, so it breaks differently per language. It was never going to work.

**THE CONFIRMATION CODE IS NOT A CONSOLATION PRIZE — IT IS BETTER ON EVERY AXIS THAT MATTERS,
which is why the amendment improved the design rather than merely rescuing it.** A date is
AMBIGUOUS (two bookings can share one check-in date), TRIVIALLY GUESSABLE (there are only so
many plausible dates, and a guesser knows the season), and LOCALISED. A confirmation code is
unambiguous, unguessable at ~3.7e15, and locale-independent.

**CODE FIRST IS THE LEAST OBVIOUS AND MOST CONSEQUENTIAL DETAIL IN THE WHOLE FEATURE.** A first
name can contain a SPACE, and a space TERMINATES an auto-linked URL. Name-first, the link
arrives as `…#g=Anna` — the code is GONE, the claim fails, and the feature silently never fires
while the host's own self-check still looks perfectly correct. Code-first, the same link
arrives as `…#c=CODE&g=Anna`: both values present, only the NAME shortened, claim succeeds.
**And under the old order those truncated links registered as FAILED claims** — feeding the
brake and the victim-keyed counter against a real guest's own host. Do not reorder these.

**THE HINT RIDES IN A URL FRAGMENT (`#`), NEVER A QUERY STRING (`?`), AND THAT IS WHAT MAKES
THE "NEVER LOGGED" INVARIANT STRUCTURAL RATHER THAN MERELY INTENDED.** `vercel.json` rewrites
`/(.*)` to `index.html`, so a query string is written into Vercel's EDGE ACCESS LOG **before a
line of our JavaScript runs** — stripping it client-side afterwards would have been theatre.
Browsers never transmit a fragment to a server and never place it in a `Referer` header, so the
values exist only in the tab until we POST them in a body. **Never move them into a query
string, a GET, a fetched URL, or a redirect target.** Click → the server reads the hints → attaches the name to
the matching booking, **including an iCal booking that has no name** (Airbnb iCal carries none).

**ONE LINK, TWO STATES, SELF-TRANSFORMING.** Pre-arrival it is a BROCHURE: the guest's name and a
countdown. On check-in day, after the **11:00 cutoff**, the SAME link becomes the full guest page —
**our server reveals the `ARR-` token at first claim, plus a host push.** No location gate. No
question box.

**ONE DELIBERATE DEVIATION FROM THE LOCKED DESIGN — `link_claimed_at` IS A PING MARKER, NOT A
FIRST-CLAIM LOCKOUT.** The design said "first-claim-wins, identical machinery to the QR flow",
and the machinery is deliberately NOT identical. **The QR proves PHYSICAL PRESENCE, so a
lockout is safe there. A confirmation code is a SHARED CREDENTIAL** — two travellers on one
booking both legitimately hold it — **so a lockout would lock out the second traveller.** The
marker exists so the HOST is told once that their paste worked: the push fires ONCE, decided by
rows returned from a conditional update, and the token is never withheld from a later device.
**Also note the token is REVEALED, not minted** — every feed booking already carries an `ARR-`
reference from `reconcile_ical_bookings`, so nothing is generated at claim time.

**THE INVARIANTS — these are what a future change could break:**
- **The link is the DEFAULT; the QR is the PERMANENT FALLBACK and the SOLE PRESENCE-PROOF path.**
  QR semantics are unchanged by this feature.
- **THE PRODUCT MUST WORK 100% FOR A HOST WHO DOES NOTHING.** The template is an upgrade, never a
  precondition.
- **A PLAIN LINK NEVER SELF-TRANSFORMS ("Tom protection")** — without the hints, arrival day shows
  a QR pointer line instead. The transformation is a property of a CLAIMED link, not of the date.
- **THE NAME HINT IS READ ONCE, STRIPPED FROM THE URL IMMEDIATELY, NEVER LOGGED, FIRST NAME ONLY.**
  A few-tries-then-QR brake plus a host ping covers guessing. **AMENDED 22 Aug 2026: the name is
  an ALLOWLIST (letters, marks, spaces, apostrophes, hyphens, full stops), not a
  control-character strip** — because `guests.first_name` is interpolated RAW into the
  guest-chat system instruction, outside the nonce fence, and this endpoint moved that write
  from "authenticated host only" to "anyone holding a confirmation code". **A STORED NAME ALWAYS
  WINS: the hint fills a blank, never corrects one**, or the endpoint is a rename primitive.
- **THE REAL SPEND/GUESSING CONTROL IS `platform_ref` ENTROPY, NOT THE BRAKE.** Both in-memory
  brakes are per-Lambda-instance; the persistent victim-keyed counter is the detector that
  survives an attack. **No second writer of `platform_ref` may be added without redoing that
  analysis** — the 8-char floor the validator accepts is only 1e8.
- **VERIFY THE PLATFORM'S VARIABLE SYNTAX AGAINST LIVE DOCS AT BUILD TIME, NEVER FROM MEMORY.**

**SURFACES THAT MOVED (`ed92ad2`):** the Share panel already rendered the message before the QR,
so only the "Step 1 / Step 2" headings went — they are no longer a sequence. **Platforms are now
DATA** (`src/components/host/sharePlatforms.ts`), so adding Booking.com later is a record rather
than a component rewrite, and `verified: false` STRUCTURALLY cannot render steps. Bookings shows
**"guest identified via link"** on both the list row and the calendar day-detail, never on a
block, with no "not identified" counterpart — absence is the normal case, not a warning.

  
