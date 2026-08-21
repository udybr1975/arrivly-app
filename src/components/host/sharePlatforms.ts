// ONE RECORD PER PLATFORM for the Share panel's welcome-message card.
//
// WHY THIS IS DATA AND NOT PROSE IN THE COMPONENT: Booking.com and Vrbo are UNVERIFIED.
// When someone finally tests one, adding it must be CONTENT — a record in this array — and
// never a component rewrite. If the differences between platforms live in JSX, the second
// platform costs what the first one did.
//
// WHAT WAS VERIFIED LIVE ON AIRBNB, 21 Aug 2026. Do not re-derive any of this from memory,
// and do not "improve" it:
//  1. Airbnb's personalisation tags CANNOT BE TYPED OR PASTED. They are inserted from an
//     "Add details" menu inside Airbnb's own editor, so a pasted template arrives as dead
//     literal text. THAT is why there is no copy-the-whole-thing button for Airbnb, and why
//     the Airbnb record is 'guided' rather than 'paste-all'.
//  2. The CHECK-IN DATE tag renders as a human-readable string with spaces and a comma,
//     which TERMINATES A URL — and it is localised, so it breaks differently per language.
//     The date is dead. It must not appear anywhere in this UI, in any form.
//  3. The CONFIRMATION CODE tag renders as an unbroken run of uppercase letters and digits
//     and inserts mid-URL cleanly. That is what the link carries.
//  4. The hint rides in a URL FRAGMENT (#), NEVER a query string (?). This is load-bearing,
//     not stylistic: vercel.json rewrites /(.*) to index.html, so a query string is written
//     into Vercel's edge access log before any of our code runs, while a fragment is never
//     sent to a server at all. NEVER render a `?` form of this URL anywhere.

export type PlatformId = 'airbnb' | 'generic' | 'unverified'
export type PlatformMode = 'paste-all' | 'guided'

export interface PlatformStep {
  /** The instruction, in the host's language. */
  text: string
  /**
   * A copyable fragment for this step, built from the apartment's OWN welcome URL. Only
   * step 1 has one — steps 2 and 3 are actions inside the platform's editor, and a copy
   * button on an action would be a lie.
   */
  copy?: string
}

export interface PlatformRecord {
  id: PlatformId
  label: string
  /**
   * FALSE MEANS WE HAVE NOT TESTED IT, and the card then renders the honest panel — no
   * steps, no target line, no message. This is STRUCTURAL, not cosmetic: there is
   * deliberately no per-render override, so an untested platform cannot be shipped looking
   * tested by a caller passing a flag.
   */
  verified: boolean
  mode: PlatformMode
  /** One-line orientation under the tabs. */
  blurb: string
  /**
   * The copyable prose. On 'guided' it ENDS ON ITS LEAD-IN LINE AND CONTAINS NO URL — that
   * is deliberate: the paste leaves the host's cursor exactly where the link goes, so they
   * never hunt for a spot mid-paragraph.
   */
  message: (welcomeUrl: string) => string
  /** Ordered, for 'guided' only. */
  steps: (welcomeUrl: string) => PlatformStep[]
  /**
   * The sentence above the steps. A RECORD FIELD, not component prose: "its tags have to be
   * inserted from its own menu, they can't be typed or pasted" is a VERIFIED-ABOUT-AIRBNB
   * claim, and templating it with `label` would print it as fact under the name of a
   * platform where it may be false.
   */
  stepsIntro: string | null
  /**
   * The sentence under the target line. Also a record field, for the same reason plus a
   * narrower one: it describes how many placeholders that platform's target line has and
   * how they are written, which the component cannot know.
   */
  targetNote: string | null
  /** The "it should look like this" line the host checks their own work against. */
  targetLine: (welcomeUrl: string) => string | null
  /** Rendered INSTEAD of everything else when `verified` is false. */
  unavailableNote: string | null
}

// The one place a message body lives. Both variants say the same thing; they differ only in
// whether the link is inside the prose or added afterwards by hand.
const BODY = `You'll find our own favourite places to eat and drink nearby, tours and tickets you can book ahead, and a chat that answers questions any time of day.

Worth opening now rather than on arrival — the best tables and tours go early.

See you soon.`

const LEAD_IN = "Before you travel, here's your guide to the flat and the neighbourhood:"

export const PLATFORMS: PlatformRecord[] = [
  {
    id: 'airbnb',
    label: 'Airbnb',
    verified: true,
    mode: 'guided',
    blurb: 'Two parts: paste the message, then build the link with Airbnb’s own tags.',
    // ENDS ON THE LEAD-IN. No URL, no trailing newline past it — see PlatformRecord.message.
    message: () => `Hi — we're really glad you're coming.

${BODY}

${LEAD_IN}`,
    // THE CONFIRMATION CODE COMES FIRST IN THE FRAGMENT, AND THAT ORDER IS LOAD-BEARING.
    // Only the code tag was verified to render as an unbroken run; a first name can contain
    // a SPACE ("Anna Maria"), and a space terminates an auto-linked URL. With the code first,
    // such a link arrives as `...#c=CODE&g=Anna` — both values present, the name merely
    // shortened to its first word, and the claim still succeeds. With the name first it
    // arrives as `...#g=Anna`, the code is gone, and the feature silently never fires for
    // that guest while the host's own self-check still looks correct. Do not reorder these.
    steps: (welcomeUrl) => [
      {
        text: 'With your cursor still at the end of what you pasted, press return and type your address — stopping right after the =.',
        copy: `${welcomeUrl}#c=`,
      },
      {
        text: 'Click “Add details” and choose the confirmation code. It has to be inserted from that menu — an Airbnb tag cannot be typed or pasted.',
      },
      {
        text: 'Type &g= and add the guest’s first name from the same menu.',
      },
    ],
    stepsIntro:
      'Airbnb’s tags have to be inserted from its own menu — they can’t be typed or pasted — so this part is three short steps in Airbnb’s message editor.',
    // What the host should SEE in Airbnb's composer when they are done. The two tags appear
    // as Airbnb's own inserted tags rather than as typed words, so they are shown here in
    // braces to be compared by shape, not character for character.
    targetLine: (welcomeUrl) => `${welcomeUrl}#c={confirmation code}&g={guest first name}`,
    targetNote:
      'The two pieces in braces are Airbnb’s own tags — in the editor they look like tags, not like typed words. Everything else is typed exactly as shown.',
    unavailableNote: null,
  },
  {
    id: 'generic',
    label: 'Anywhere else',
    verified: true,
    mode: 'paste-all',
    blurb: 'Email, WhatsApp, or your own booking system. One copy, one paste, nothing to build.',
    message: (welcomeUrl) => `Hi — we're really glad you're coming.

${LEAD_IN}
${welcomeUrl}

${BODY}`,
    steps: () => [],
    stepsIntro: null,
    targetLine: () => null,
    targetNote: null,
    unavailableNote: null,
  },
  {
    id: 'unverified',
    label: 'Booking.com & Vrbo',
    verified: false,
    mode: 'paste-all',
    blurb: 'Not tested yet.',
    message: () => '',
    steps: () => [],
    stepsIntro: null,
    targetLine: () => null,
    targetNote: null,
    // Says only what is known. No invented tag syntax, no guess about WHICH platform blocks
    // links, and no claim that either works.
    unavailableNote:
      'We haven’t confirmed how these handle a personalised link yet — one of them may block links in messages altogether. Rather than guess at instructions that might not work, we’ll add them here once they’ve been tested properly. Nothing is missing meanwhile: the QR code inside the flat does the whole job on its own.',
  },
]

export const DEFAULT_PLATFORM: PlatformId = 'airbnb'

export function platformById(id: PlatformId): PlatformRecord {
  return PLATFORMS.find((p) => p.id === id) ?? PLATFORMS[0]
}
