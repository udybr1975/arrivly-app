import { Link } from 'react-router-dom'

/**
 * The guest-facing link to the published Privacy Notice for Guests.
 *
 * IT APPEARS ON EVERY GUEST SURFACE AND IN EVERY STATE — active, pre-arrival/welcome,
 * thank-you, neutral, expired and unavailable. That is not a style preference: a
 * transparency notice a guest can only reach from one state is not reachable at the
 * moment they need it, and the notice is linked from the pages it describes by design.
 * It is deliberately NOT tied to `showPoweredBy`, which is a trial-only marketing
 * footer — the obligation does not end when the host starts paying.
 *
 * IT PASSES THE APARTMENT ID, NEVER THE BRAND NAME. The notice page reads the host's
 * name from the database itself, so the name it prints is asserted by us. Passing the
 * name in the URL would let anyone hand-craft a bemgu.app link that puts their own copy
 * inside a first-party callout on a legal page. Omit `apartmentId` where no apartment
 * context exists (the welcome page's expired and unavailable screens); the notice then
 * renders without the host line rather than naming a placeholder as the controller.
 */
export default function GuestLegalLink({
  apartmentId,
  tone = 'light',
  className = '',
}: {
  apartmentId?: string | null
  tone?: 'light' | 'dark'
  className?: string
}) {
  const href = apartmentId
    ? `/legal/guest-notice?apt=${encodeURIComponent(apartmentId)}`
    : '/legal/guest-notice'

  // `tone` is the BACKGROUND the link sits on: 'light' = the cream guest surfaces,
  // 'dark' = the accent-filled thank-you screen. Both are fixed inks, never the host's
  // accent — a host-typed hex has no verifiable contrast ratio.
  const ink = tone === 'dark' ? 'text-white/75 hover:text-white' : 'text-[#6b6354] hover:text-[#1c1c1a]'

  return (
    <Link
      to={href}
      className={`inline-block rounded text-[11px] underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 ${
        tone === 'dark' ? 'focus-visible:ring-white/70' : 'focus-visible:ring-[#7a5c00]'
      } ${ink} ${className}`}
    >
      Privacy notice for guests
    </Link>
  )
}
