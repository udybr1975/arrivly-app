import { useId } from 'react'

/**
 * Arrivly "Marker" mark — a brass map-pin with a negative-space "A".
 * The A is cut out with a real SVG <mask> (transparent, so it shows whatever is
 * behind the mark). Each instance gets a unique, colon-free mask id via useId().
 */
type LogoProps = {
  size?: number
  withWordmark?: boolean
  wordmarkClassName?: string
  className?: string
}

export default function Logo({
  size = 28,
  withWordmark = false,
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
      // When the wordmark is shown, the visible "Arrivly" text names the brand —
      // hide the mark from the a11y tree to avoid "Arrivly Arrivly".
      {...(withWordmark ? { 'aria-hidden': true } : { role: 'img', 'aria-label': 'Arrivly' })}
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
            A
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

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {mark}
      <span className={`font-['Fraunces'] font-medium ${wordmarkClassName}`}>Arrivly</span>
    </span>
  )
}
