// THE PUBLIC PEEK — the scripted half of the two-tier demo (CLAUDE.md, "DEMO — APPROVED
// DESIGN", 25 Aug 2026). One apartment carries `apartments.is_public_demo` (Sweet home,
// d9614d11-…); a QR/link on the landing page hands anyone its public booking token and the
// guest page renders for real. Everything on that page stays LIVE — Explore, marketplaces,
// events, the guide — EXCEPT the assistant, which is scripted here, and messaging, which is
// off. The whole point is a zero-spend surface: no model call, no counter bump, no inbox.
//
// TWO FLAGS, NEVER CONFLATED: `apartments.is_public_demo` is THIS — one shared, public,
// scripted fixture. `hosts.is_demo` is the 48-hour SANDBOX host, who gets real AI and real
// two-way messaging in their own account. A change to one is never a change to the other.
//
// THE INVARIANT THAT IS EASIEST TO BREAK WITHOUT NOTICING — read this before flagging any
// apartment: setting `is_public_demo` makes EVERY confirmed/completed booking on that
// apartment a PERMANENT verified credential, not just the one token the landing page prints.
// `resolveGuestAccess` skips the date bound for the flagged apartment, so any token ever
// issued there redeems private check-in rows, the coordinates and the guest's stored first
// name, forever. Therefore: A FLAGGED APARTMENT MUST NEVER TAKE A REAL STAY, and everything
// already on it — bookings, guest names, private details, the address — is published by the
// act of setting the flag. The flag does exactly what it says: publish this apartment.
//
// WHY THE ANSWERS LIVE SERVER-SIDE: a client-side script map would let anyone edit the
// bubbles in devtools and screenshot Bemgu saying anything. It is also the only place that
// can guarantee the model is never reached.

// NOTE: the apartment's UUID deliberately does NOT live here. Nothing on the server needs it —
// every branch reads `is_public_demo` off the row it already fetched — and a second copy beside
// ARRIVLY_CONFIG.publicDemo (which the landing page's QR needs) would be an unasserted
// duplicate of a value that is load-bearing in exactly one direction.

// The exact strings ChatBot sends when a demo starter chip is tapped. The DISPLAY labels on
// those chips are shorter and live in the client — these are the wire values, and the map
// below is keyed by them. If a chip's wire string changes, this map must change in the same
// commit or that chip silently falls through to the fallback line.
export const DEMO_QUESTIONS = [
  "What's the WiFi password?",
  'Where do I leave the keys at checkout?',
  'Is there a good bakery nearby?',
  'Can I check out late tomorrow?',
] as const

// Returned for anything that is not one of the four. Says plainly that the limit is the DEMO,
// not the assistant — the sandbox at /demo is where the real thing answers freely.
export const DEMO_FALLBACK_REPLY =
  'This is a demo page, so I can only answer the sample questions above. In a real guest page I answer anything about the stay.'

const SCRIPT = new Map<string, string>(Object.entries({
  "What's the WiFi password?":
    'The network is SweetHome and the password is on your Home tab — tap the WiFi card and it copies in one tap. If it drops, the router is on the shelf by the door; give it 30 seconds after a restart.',
  'Where do I leave the keys at checkout?':
    'Leave both keys on the kitchen table and pull the door shut behind you — it locks on its own. Check-out is by 11:00. No need to message me unless something’s wrong.',
  'Is there a good bakery nearby?':
    'Two minutes away on the corner there’s a small bakery that opens at 7:00 — the cardamom buns go fast. Your host’s picks on the Explore tab have a couple more, with directions.',
  'Can I check out late tomorrow?':
    'Late checkout depends on who’s arriving next, so that’s a question for your host. In a real guest page you’d tap Message host and they’d reply here on the page.',
}))

// EXACT match only, after a trim. Deliberately not fuzzy: a near-match heuristic on free text
// is a second, unreviewed answer-selection surface, and the fallback line is a good answer to
// everything it would have guessed at.
//
// A MAP, NOT A PLAIN OBJECT, and that is load-bearing: the lookup key is untrusted request
// input, so `SCRIPT[message]` on an object literal would resolve inherited keys — 'toString'
// and 'constructor' return functions, which are truthy and would sail past a `?? fallback`.
// A Map has no prototype chain to walk. Pinned by a test.
export function scriptedReply(message: unknown): string {
  if (typeof message !== 'string') return DEMO_FALLBACK_REPLY
  return SCRIPT.get(message.trim()) ?? DEMO_FALLBACK_REPLY
}

// --- guest-state's demo branch, as a pure decision ---------------------------------
//
// A real booking resolves 'active' only INSIDE its dates and flips to 'thankyou' after 11:00
// on checkout day. The public demo must not expire: the landing page links one fixed token,
// and a visitor who arrives the day after checkout would otherwise be shown a thank-you
// screen for a stay they never had. So for the demo apartment ONLY, a token that matches its
// confirmed booking resolves 'active' regardless of the date window.
//
// WHAT THIS DOES NOT DO, and must never be widened to do: it does not accept an unknown
// token, a cancelled booking, or a booking on another apartment. The token still has to be
// the real reference_number of a confirmed/completed booking on THAT apartment — the demo
// changes the DATE rule and nothing else.
export function decideDemoTokenState(
  isPublicDemo: boolean,
  booking: { check_in: string; check_out: string } | null,
  helsinkiNow: string,
): 'active' | 'thankyou' | 'neutral' {
  if (!booking) return 'neutral'
  if (isPublicDemo) return 'active'
  const helsinkiToday = helsinkiNow.split(' ')[0]
  if (helsinkiNow >= booking.check_out + ' 11:00:00') return 'thankyou'
  if (helsinkiToday >= booking.check_in && helsinkiToday <= booking.check_out) return 'active'
  return 'neutral'
}
