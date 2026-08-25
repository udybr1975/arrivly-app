import { useId } from 'react'

/**
 * Bemgu "Marker" mark — a brass map-pin with a negative-space "B".
 * The B is cut out with a real SVG <mask> (transparent, so it shows whatever is
 * behind the mark). Each instance gets a unique, colon-free mask id via useId().
 *
 * `withTagline` adds the "BE MY GUEST" lockup beneath the wordmark, with the
 * letters that spell the brand (BE · M · GU) picked out in brass. It is
 * opt-in: without it the markup is identical to the compact lockup the host
 * app header uses.
 */
type LogoProps = {
  size?: number
  withWordmark?: boolean
  withTagline?: boolean
  taglineTone?: 'dark' | 'light'
  wordmarkClassName?: string
  className?: string
}

export default function Logo({
  size = 28,
  withWordmark = false,
  withTagline = false,
  taglineTone = 'dark',
  wordmarkClassName = '',
  className = '',
}: LogoProps) {
  // useId() can contain ":" which is awkward in url(#…) refs — strip it.
  const maskId = `arrivly-mark-${useId().replace(/:/g, '')}`

  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      // When the wordmark is shown, the visible "Bemgu" text names the brand —
      // hide the mark from the a11y tree to avoid "Bemgu Bemgu".
      {...(withWordmark ? { 'aria-hidden': true } : { role: 'img', 'aria-label': 'Bemgu' })}
      className={withWordmark ? '' : className}
    >
      <defs>
        <mask id={maskId}>
          <rect width="64" height="64" fill="#fff" />
          <text
            x="32"
            y="34"
            textAnchor="middle"
            fontFamily="Fraunces, Georgia, serif"
            fontWeight="600"
            fontSize="26"
            fill="#000"
          >
            B
          </text>
        </mask>
      </defs>
      <path
        d="M32 7 C21 7 13 15 13 26 C13 38 32 57 32 57 C32 57 51 38 51 26 C51 15 43 7 32 7 Z"
        fill="#c8a24e"
        mask={`url(#${maskId})`}
      />
    </svg>
  )

  if (!withWordmark) return mark

  const wordmark = <span className={`font-['Fraunces'] font-medium ${wordmarkClassName}`}>Bemgu</span>

  if (!withTagline) {
    return (
      <span className={`inline-flex items-center gap-2 ${className}`}>
        {mark}
        {wordmark}
      </span>
    )
  }

  // Contrast measured on FLAT surfaces: on #1c1c1a muted is 5.28:1 and brass
  // 7.10:1; on #f7f3ec muted is 5.16:1 and brass 5.65:1 — all clear of the
  // 4.5:1 floor that 10px text needs. That covers the Landing nav and footer.
  // It does NOT cover AuthShell's dark panel, where the lockup sits over a
  // photograph under a partial scrim and every neighbouring string carries a
  // textShadow this one does not — treat that surface as unmeasured.
  const mutedClass = taglineTone === 'dark' ? 'text-[#f0ede6]/55' : 'text-[#6b665c]'
  const brassClass = taglineTone === 'dark' ? 'font-semibold text-[#c8a24e]' : 'font-semibold text-[#7a5c00]'

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {mark}
      <span className="inline-flex flex-col leading-none">
        {wordmark}
        {/* Decorative for AT: the wordmark above already names the brand. */}
        <span
          aria-hidden="true"
          className={`mt-[5px] font-['Inter'] text-[10px] font-semibold tracking-[.24em] ${mutedClass}`}
        >
          <b className={brassClass}>BE</b> <b className={brassClass}>M</b>Y <b className={brassClass}>GU</b>EST
        </span>
      </span>
    </span>
  )
}
