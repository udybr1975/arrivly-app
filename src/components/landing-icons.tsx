// Thin-line (≈1.5 stroke) marketing icons for the Landing page.
// All use `currentColor` so they inherit the brass tint from the parent's CSS color.
// Recreated as inline SVG (sharper + lighter than a raster sprite). Keep them simple
// and consistent — they are presentational only.
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { className?: string }

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export function QrIcon({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1.2" />
      <rect x="14" y="3" width="7" height="7" rx="1.2" />
      <rect x="3" y="14" width="7" height="7" rx="1.2" />
      <path d="M14 14h3v3M21 14v3.5M17.5 21H21M14 21v-1.5" />
    </svg>
  )
}

export function PinIcon({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p}>
      <path d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  )
}

export function SparkleIcon({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p}>
      <path d="M12 2.5l2 5.6 5.6 2-5.6 2-2 5.6-2-5.6-5.6-2 5.6-2 2-5.6Z" />
      <path d="M18.6 14.6l.85 2 2 .85-2 .85-.85 2-.85-2-2-.85 2-.85.85-2Z" />
    </svg>
  )
}

export function HandIcon({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p}>
      <path d="M7 11.5V6.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M10 11V5a1.5 1.5 0 0 1 3 0v6" />
      <path d="M13 11V6a1.5 1.5 0 0 1 3 0v5" />
      <path d="M16 8.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5.2-3l-2.2-3.8a1.5 1.5 0 0 1 2.6-1.5L7.6 13" />
    </svg>
  )
}

export function CityMapIcon({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p}>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  )
}

export function ChatIcon({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p}>
      <path d="M20.5 11.4a8 8 0 0 1-8.5 8 8.4 8.4 0 0 1-3.7-.85L3.5 20l1.45-4.8A8 8 0 0 1 4 11.4 8 8 0 0 1 12 3.5a8 8 0 0 1 8.5 7.9Z" />
      <path d="M9 11.5h.01M12 11.5h.01M15 11.5h.01" />
    </svg>
  )
}

export function KeyIcon({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p}>
      <circle cx="8" cy="8" r="4.5" />
      <path d="M11.3 11.3 20 20M16.5 16.5l2-2M14 14l2-2" />
    </svg>
  )
}

export function WifiIcon({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p}>
      <path d="M4.5 12.2a11 11 0 0 1 15 0" />
      <path d="M7.5 15.3a6.5 6.5 0 0 1 9 0" />
      <path d="M10.5 18.4a2.2 2.2 0 0 1 3 0" />
      <circle cx="12" cy="20.5" r="0.4" />
    </svg>
  )
}

export function TicketIcon({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p}>
      <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4 2 2 0 0 0 0-4Z" />
      <path d="M14 6.5v11" />
    </svg>
  )
}

export function ArrowRightIcon({ className, ...p }: IconProps) {
  return (
    <svg {...base} className={className} {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}
