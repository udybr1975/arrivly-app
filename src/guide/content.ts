// Bemgu host Guide — content module (PURE DATA, zero imports).
// Sourced from docs/arrivly-host-guide-content-v1.md. Each `##` section there
// maps to one module here: heading → title, "In one line:" → summary, the rest
// of the prose → body (markdown), and the `live` / `coming-soon` heading tag → status.
// Kept import-free on purpose so it can later be consumed from both src/ and api/.

export type GuideStatus = 'live' | 'coming-soon'
export type GuideCategoryId = 'get-set-up' | 'guest-page' | 'run-stays' | 'plan-account' | 'fix'

export type GuideModule = {
  id: string
  category: GuideCategoryId
  title: string
  summary: string // one line — will feed the per-page hint strip in a later prompt
  body: string // markdown
  status: GuideStatus
  related?: string[] // module ids
  page?: string // route this module is the default help for
  tags?: string[]
}

export const GUIDE_CATEGORIES: { id: GuideCategoryId; label: string; order: number }[] = [
  { id: 'get-set-up', label: 'Get set up', order: 1 },
  { id: 'guest-page', label: 'Your guest page', order: 2 },
  { id: 'run-stays', label: 'Run your stays', order: 3 },
  { id: 'plan-account', label: 'Plan & account', order: 4 },
  { id: 'fix', label: 'Fix a problem', order: 5 },
]

export const GUIDE_MODULES: GuideModule[] = [
  {
    id: 'getting-started',
    category: 'get-set-up',
    title: 'Getting started',
    summary:
      'From sign-up to a live guest page in four moves — create your account, add a property, fill the essentials, share the QR.',
    status: 'live',
    related: ['property', 'guest-page-qr'],
    tags: ['signup', 'welcome', 'trial', 'first property'],
    body: `A new host goes: **Sign up → Welcome → add first property → fill the essentials → share the QR.** Here's each control on that path.

### Sign-up (Step 1 of 2 — "Create your account")
- **First name** — your name, used to greet you in the dashboard. *Why:* it personalises the app and signs your guest page ("— Marco"). You're never asked for it again.
- **Brand name** (e.g. *Marco's Barcelona Stays*) — the name guests see at the top of their page. *Why:* it's your identity to guests; it also becomes the default name of your first property so you can go live faster.
- **Email** — your login and where Bemgu sends trial reminders and billing notices. *Why:* it's your account identity; it's never shown to guests.
- **Password** (at least 8 characters) — secures your account. *Why:* protects your guest data and billing.
- **Agree to terms** checkbox — confirms you accept the terms. *Why:* required to create the account.
- **Create account** — creates your login and starts your **14-day free trial**. *Why:* no card is needed to begin; you're charged nothing until you choose a plan.

> The trial badge in the sidebar counts your remaining days. Your guest page is fully live during the trial, with a small "Powered by Bemgu" footer that disappears once you add a card.

### Welcome (shown once)
- **Add my first property →** — jumps you straight into the property editor. *Why:* the guest page only exists once there's a property to attach it to; this is the one thing to do first.
- **I'll look around first** — dismisses the welcome and lets you explore. *Why:* not everyone wants to start immediately; you can add a property any time from Home.

### Finishing setup
- **Finish setup / next-step card** (on Home) — points at the property closest to ready and lists what's still missing (WiFi, House rules, Check-in, city guide). *Why:* it removes the guesswork about "what do I do next" and takes you straight to the right tab.`,
  },
  {
    id: 'property',
    category: 'get-set-up',
    title: 'Your property — the editor',
    summary: 'Build your guest page tab by tab. Save the Basics first and the rest unlock.',
    status: 'live',
    page: '/dashboard/property',
    related: ['branding', 'bookings', 'guest-page-qr'],
    tags: ['editor', 'wifi', 'check-in', 'house rules', 'extras', 'picks', 'guide', 'events', 'calendars', 'look'],
    body: `Opened from the **Edit / Finish setup** button on your property card on Home. The editor is a row of tabs. **Only Basics is open at first** — the others unlock the moment you save the basics, because every later tab needs a saved property to attach to.

> **Why the locked tabs?** Until the property is saved, there's nothing to store WiFi or a door code *against*. Saving Basics creates the property; that's why it comes first.

### Tab: Basics
- **Property name** — the apartment's name. *Why:* labels it across the dashboard and on the guest page header.
- **Country / City / Neighbourhood / Street / Street number** — the full address. *Why:* it's used to place the apartment on the map (for guest walking directions), and to generate the **hyper-local** city guide and events. The exact street is **never shown to guests** on the public page — only verified guests in their stay see it.
- **Floor note** (e.g. "3rd floor, no lift") — a short access note. *Why:* helps guests find the door; optional.
- **Max guests** — how many the place sleeps. *Why:* sets expectations and supports later booking features.
- **Cover photo · Upload / Remove** — your own hero image for the guest page. *Why:* a real photo makes the page feel like *your* place; if you skip it, Bemgu uses a tasteful city image automatically.
- **Save** — stores the basics and (in the background) looks up the map coordinates. *Why:* this is the save that creates the property and unlocks every other tab. If the address can't be placed, the save still works and you'll see a gentle note to fix it.

### Tab: WiFi
- **Network name (SSID)** and **Password** — your WiFi credentials. *Why:* they appear as a big one-tap-to-copy card on the guest page — usually the very first thing a guest wants.
- **Save WiFi** — stores them. *Why:* nothing shows to guests until it's saved.

### Tab: Check-in  *(private)*
- **Check-in time / Check-out time** (e.g. 15:00 / 11:00) — your standard times. *Why:* sets arrival/departure expectations.
- **Door code** (e.g. \`1234#\`) — the entry code. *Why:* lets guests in without you being there.
- **Entry instructions** — step-by-step how to get in. *Why:* removes arrival-day confusion.
- **Save** — stores the check-in details. *Why:* **these are private** — shown only to a guest with a valid booking during their stay, never on the public page or to a random scanner. That's the whole point of this tab being separate.

### Tab: House rules
- **House rules** (free text, e.g. "No smoking inside. Quiet after 10pm…") — your rules in your own words. *Why:* guests need to know them.
- **Save** — stores the rules **and rewrites them** into a warm, friendly paragraph automatically. *Why:* AI-polishing on save turns a blunt list into welcoming prose without you having to wordsmith. If the rewrite ever fails, your original text is kept.

### Tab: Extras
- **Bulk paste box** — dump everything else a guest should know (parking, bins, appliances, transport…). *Why:* one paste instead of many forms.
- **Add with AI** (the import button) — sorts your paste into tidy categories (Parking, Recycling & Bins, Appliances, Transport, Amenities, Safety, Good to know). *Why:* it organises a messy blob into a clean "Good to know" section on the guest page. **Importing replaces your current extras**, so it's one authoritative list, not duplicates.

### Tab: My picks
- **Free-text places box** (e.g. "Mercadona on Carrer del Rec, Bar Marsella…") — your personal recommendations. *Why:* your local picks are what make the guide *yours*, not generic.
- **✦ Add places with AI / Identify** — finds each place, looks up its address, drops a map pin, and guesses a category. *Why:* you type names, Bemgu does the geocoding and tagging so each pick gets a working **Navigate** button for guests.
- **Re-locate** (per place) — re-runs the address lookup after you edit it. *Why:* if a pin landed on the wrong "Bar Marsella", fix the address and re-locate to correct it.
- **Remove** (per place) — drops a candidate before saving. *Why:* you review everything before it goes live.
- **Confirm & add** — saves the reviewed picks to the guest page. *Why:* nothing is published until you confirm, so a wrong AI guess never reaches guests.

### Tab: Guide & events
- **Refresh guide** — regenerates the AI neighbourhood guide for this property. *Why:* keeps recommendations current; it also refreshes on its own each month, so you rarely need this.
- **Refresh events** — refreshes the "this week" local-events list. *Why:* events go stale fast; this pulls the latest. It refreshes automatically while a guest is staying.

> *Known nicety being improved:* these two buttons sit close together and read alike — a visual fix is on the backlog so they're harder to mix up.

### Tab: Calendars
- **iCal feed links** (one URL per line) — your Airbnb / Vrbo / Booking.com calendar links. *Why:* Bemgu syncs blocked and booked **dates** automatically so your availability stays in step without manual entry.
- **Save** — stores the feed links. *Why:* sync has nothing to read until they're saved.
- **Sync now** — pulls the feeds immediately. *Why:* you don't have to wait for the automatic sync to confirm it's working.
- **Import names** (Airbnb CSV) — uploads your Airbnb reservations export to attach guest **names** to the synced dates. *Why:* iCal feeds carry dates but not names; this is how an Airbnb guest's page greets them by name. Names attach to matching dates and **survive every future sync**.
- **Manage calendars →** — jumps here from the Bookings page. *Why:* one place to manage feeds.

### Tab: Look
- **Preset colour swatches** — pick your accent from the brand palette. *Why:* it tints this property's guest page (hero, headings, buttons).
- **Custom hex + Apply** (e.g. \`#2c4a8a\`) — set an exact colour. *Why:* match a specific brand colour.
- **Reset to brand** — clears the override so this property inherits your account default colour. *Why:* lets one property differ, or fall back to the brand default, without retyping a colour.`,
  },
  {
    id: 'home',
    category: 'get-set-up',
    title: 'Home (Overview)',
    summary: "Your command centre — what's happening today and the next thing to finish.",
    status: 'live',
    page: '/dashboard',
    related: ['property', 'guest-page-qr', 'billing'],
    tags: ['overview', 'dashboard', 'today', 'next step'],
    body: `- **Next-step banner** — the property closest to ready, with what's left and a **Finish setup** button. *Why:* always points you at the highest-value next action.
- **Operational strip — Staying now / Checking in today / Checking out today / Unread messages** — today at a glance; each tile is clickable. *Why:* the daily pulse of your places without digging.
- **Property card** — one card per property showing **Live/Draft**, a completeness %, and booking count, with **QR · Preview · Edit** actions and an overflow menu (show/hide on the guest page, discard a draft). *Why:* manage each place from one tile. *Preview* opens the guest page as a guest sees it; *Edit* opens the editor above.
- **Add my first property / Add property** — creates a new property (and shows the +price per month for extra properties). *Why:* grow to more listings; nothing is created or charged until you save its basics.`,
  },
  {
    id: 'guest-page-qr',
    category: 'guest-page',
    title: 'Guest page & QR',
    summary: 'One QR, one link — it never changes, even when guests do.',
    status: 'live',
    page: '/dashboard/qr',
    related: ['property', 'branding'],
    tags: ['qr', 'guest page', 'share', 'print', 'url'],
    body: `- **The QR code** — the scannable code for this property. *Why:* guests scan it on arrival to open their page; one code per property, forever.
- **Copy guest page URL** — copies the link. *Why:* share it in a message or your listing without printing anything.
- **Download** (PNG) — saves the QR as an image. *Why:* drop it into a welcome card, sign, or printout.
- **Print card** — prints a ready-made QR card. *Why:* a physical code to leave in the apartment.

> **What guests see when they scan:** their name and a welcome, WiFi, house rules, the live city guide and local events, a chatbot that knows your apartment, and — during their stay only — the private check-in details. After checkout the page becomes a friendly "till next time" goodbye; with no valid booking it shows a neutral page (no private data ever leaks).`,
  },
  {
    id: 'branding',
    category: 'guest-page',
    title: 'Branding',
    summary: 'Your logo, brand name and default colour — applied across all your guest pages.',
    status: 'live',
    page: '/dashboard/branding',
    related: ['property'],
    tags: ['logo', 'brand name', 'colour', 'accent'],
    body: `- **Logo · Upload / Remove** — your logo for the guest-page header. *Why:* it's your identity to guests; replaces the text-only header.
- **Brand name** — your business name. *Why:* the name guests see; editable here account-wide.
- **Default colour** (presets + custom hex + Apply) — your account-wide accent. *Why:* sets the look of every guest page at once; a single property can still override it in its **Look** tab.
- **Save** — stores your branding. *Why:* changes apply to your live pages on save.`,
  },
  {
    id: 'earning-more',
    category: 'guest-page',
    title: 'Earning more',
    summary:
      'Surface tours, tickets and restaurant reservations on your guest page — and earn from what guests book. (Preview — not live yet.)',
    status: 'coming-soon',
    related: ['billing'],
    tags: ['experiences', 'affiliate', 'monetisation'],
    body: `This module exists now so the structure is ready. When it ships, it explains the experiences your guests can book from Explore, how earnings work, and which plan unlocks them. Until then it shows as a preview, and the assistant will say it's not yet available rather than promise it.`,
  },
  {
    id: 'bookings',
    category: 'run-stays',
    title: 'Bookings',
    summary: 'Every stay lives here — added by hand, synced from a calendar, or a channel block.',
    status: 'live',
    page: '/dashboard/bookings',
    related: ['property', 'guest-page-qr'],
    tags: ['bookings', 'calendar', 'manual booking', 'ical', 'blocks'],
    body: `- **List / Cal** toggle — switch between the booking list and the month calendar. *Why:* scan details as a list, or see occupancy at a glance.
- **+ Add booking** → **New manual booking** — opens a small form. *Why:* for direct guests not coming from a connected calendar.
  - **Guest first name** (required) — who's staying. *Why:* greets them by name on their page.
  - **Check-in** / **Check-out** (required) — the dates. *Why:* these decide when the guest page is live and when it flips to the goodbye state.
  - *A booking reference (ARR-XXXXXX) is generated automatically* and becomes the guest's QR token. *Why:* it's the secure key that ties a guest to their page; you don't create it yourself.
- **Filters: All / Guests / Blocks** — narrow the list. *Why:* separate real guests from channel-blocked dates.
- **Search guest name** — find a stay fast. *Why:* useful once the list grows.
- **Card colours / left edge** — colour-coded by source (Airbnb, Vrbo, manual, block). A green **In-house** pill = staying right now. *Why:* read the source and status of a stay at a glance.
- **+ add name** (on an unnamed stay) — attach a guest name. *Why:* synced Airbnb stays arrive without names; this fills the gap so their page personalises.
- **Guest page ↗** (on an active stay) — open that guest's live page. *Why:* see exactly what your current guest sees, or grab their link.
- **Manage calendars →** — jumps to the property's Calendars tab. *Why:* connect or fix feeds without hunting for them.`,
  },
  {
    id: 'messages',
    category: 'run-stays',
    title: 'Messages',
    summary: 'Guest conversations land here — reply inline, finished chats move to Past.',
    status: 'live',
    page: '/dashboard/messages',
    related: ['bookings', 'guest-page-qr'],
    tags: ['messages', 'chat', 'reply', 'inbox'],
    body: `- **Open / Past / All** tabs — your conversations by state (Open = in-house or recent/unread). *Why:* focus on who needs a reply now.
- **Property filter** (when you have more than one) — show one place's chats. *Why:* cut noise across listings.
- **Search guest name** — find a thread. *Why:* jump straight to a conversation.
- **A conversation row** — shows the guest, an in-house / checked-out chip, an "Awaiting reply" flag, and unread count. *Why:* triage at a glance; rows sort attention-first.
- **Reply box** (send with the button or ⌘/Ctrl+Enter) — answer the guest. *Why:* the reply lands on their guest page. Opening a thread marks it read.
- **Open guest page ↗** — open the guest's page from the thread. *Why:* check context while you reply.`,
  },
  {
    id: 'full-booking',
    category: 'run-stays',
    title: 'Full booking',
    summary:
      'Take real bookings end-to-end — availability, request, approve, pay — on the top plan. (Preview — not live yet.)',
    status: 'coming-soon',
    related: ['billing'],
    tags: ['booking', 'tier 4', 'availability', 'payments'],
    body: `Placeholder module for the Tier-4 booking system. Present in the Guide so the day it launches it switches from preview to full instructions with no restructuring.`,
  },
  {
    id: 'billing',
    category: 'plan-account',
    title: 'Billing & plans',
    summary: "Start free, pick a plan when you're ready — your page stays live through any change.",
    status: 'live',
    page: '/dashboard/billing',
    related: ['settings'],
    tags: ['billing', 'plans', 'tiers', 'subscription', 'checkout'],
    body: `- **Plan cards (tiers)** — the four plans, differing mainly by how many properties they include. *Why:* choose the capacity you need; "Most popular" flags the common pick.
- **Add a card / Choose plan** — starts checkout for a plan. *Why:* required to continue past the trial; the card is captured but not charged until the trial ends.
- **Current plan** — marks the plan you're on. *Why:* clarity on where you stand.
- **Manage subscription** — opens the billing portal (update card, invoices). *Why:* self-serve card and receipts.
- **Change plan** — move up or down a tier. *Why:* scale with your listings; upgrades apply immediately (prorated), downgrades at period end.
- **Cancel / Resume** — stop or restore the subscription. *Why:* you stay in control; cancelling keeps the page live until the period ends and loses no data.
- **Dismiss** (on a billing notice) — clears a plan-change banner. *Why:* acknowledge a change you've seen.

> **Good to know:** the price shown on a plan card is the price you're charged. Changing trial length or seeing a number move never charges you by itself — only choosing/altering a plan does.`,
  },
  {
    id: 'settings',
    category: 'plan-account',
    title: 'Settings',
    summary: 'Notifications, installing the app on this device, and your account.',
    status: 'live',
    page: '/dashboard/settings',
    related: ['branding', 'billing'],
    tags: ['settings', 'notifications', 'install', 'account', 'sign out'],
    body: `- **Notifications · Enable / Turn off** — host push alerts (new booking, guest scan, trial ending, guest message, checkout reminder). *Why:* know what's happening without watching the dashboard. States shown: on / off / **blocked** (if blocked, you've denied permission in the browser and must re-allow it there).
- **This device · Install** — add Bemgu to your phone or desktop home screen. *Why:* faster access and reliable push; on iOS, installing to the home screen is what enables alerts.
- **Edit in Branding → / Manage in Billing →** — shortcuts to those pages. *Why:* one obvious place to change name/colour or plan.
- **Email & password** *(coming soon)* — change your login details.
- **Delete account & data** *(coming soon)* — remove your account.
- **Sign out** — signs you out on this browser. *Why:* secure a shared device.
- **Terms / Privacy / Support** — the footer links. *Why:* the legal and help destinations *(real URLs being finalised)*.`,
  },
  {
    id: 'troubleshooting',
    category: 'fix',
    title: 'Troubleshooting & errors',
    summary: 'Plain answers to the things hosts actually hit.',
    status: 'live',
    related: ['bookings', 'property', 'settings'],
    tags: ['troubleshooting', 'errors', 'help', 'fixes'],
    body: `- **"My guest sees a 'Till next time' goodbye page."** That page shows after the checkout day passes (after 11:00 on the check-out date). *Fix:* extend the stay's **check-out** date in Bookings and the live page returns.
- **"A guest sees a neutral page with no details."** There's no valid booking matched to that scan, or it's outside the stay dates. *Fix:* check the booking exists, is confirmed, and the dates cover today. Private details are hidden by design until a real stay matches — this is the safety net working.
- **"'No coordinates found' when I save a property."** The address couldn't be placed on the map. *Fix:* the save still worked; correct the street and number, then save again to enable directions and the local guide.
- **"The city guide came back empty."** A one-off hiccup. *Fix:* press **Refresh guide** once more — it almost always fills on the second try.
- **"Notifications won't turn on."** They're blocked at the browser/OS level. *Fix:* re-allow notifications for the site in your browser settings, then toggle Enable again. On iPhone, install the app to your home screen first.
- **"My Airbnb stays have no guest names."** iCal feeds don't carry names. *Fix:* use **Calendars → Import names** with your Airbnb CSV; names then stick through future syncs.
- **"An old blocked range I don't recognise is on my calendar."** It's a synced channel block, not a guest. *Fix:* it's harmless; if it's stale, remove the block in the source channel and re-sync.`,
  },
]

// Longest-prefix match on `page`: `/dashboard/property/abc` → property; `/dashboard` (exact) → home.
export function moduleForPath(pathname: string): GuideModule | undefined {
  let best: GuideModule | undefined
  for (const m of GUIDE_MODULES) {
    if (!m.page) continue
    const page = m.page
    const matches = pathname === page || pathname.startsWith(page.endsWith('/') ? page : page + '/')
    if (matches && (!best || best.page!.length < page.length)) best = m
  }
  return best
}
