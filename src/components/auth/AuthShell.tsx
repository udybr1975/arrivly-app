import type { ReactNode } from 'react'
import Logo from '../shared/Logo'

/**
 * Shared split-screen wrapper for the auth pages (Login / Signup / ResetPassword).
 * LEFT: warm charcoal showcase panel over /auth/arrivly-auth-arrival.jpg with a
 * legibility scrim, a floating "earning" lift-out, headline + checklist.
 * RIGHT: cream form column that renders {children}.
 *
 * The lift-out, checklist and footer line are decorative and hidden on mobile,
 * where the panel collapses to a short banner (wordmark + headline only).
 */
const SHOWCASE_IMAGE = '/auth/arrivly-auth-arrival.jpg'

const SCRIM_BACKGROUND = [
  'linear-gradient(180deg, rgba(20,15,12,.82) 0%, rgba(20,15,12,.32) 12%, rgba(20,15,12,0) 25%, rgba(20,15,12,0) 40%, rgba(20,15,12,.40) 55%, rgba(20,15,12,.84) 78%, rgba(20,15,12,.96) 100%)',
  'linear-gradient(90deg, rgba(20,15,12,.42) 0%, rgba(20,15,12,.10) 40%, transparent 62%)',
].join(', ')

const TEXT_SHADOW = '0 1px 18px rgba(20,15,12,.7)'

const DEFAULT_POINTS = [
  'Personalised the moment they scan',
  'A live guide that refreshes itself',
  'Experiences they book — and you earn',
]

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

type AuthShellProps = {
  headline: ReactNode
  sub: string
  points?: string[]
  children: ReactNode
}

export default function AuthShell({ headline, sub, points = DEFAULT_POINTS, children }: AuthShellProps) {
  return (
    <div className="min-h-screen grid md:grid-cols-[1.04fr_1fr] font-['Inter'] bg-[#f7f3ec]">
      {/* ── LEFT: showcase panel ── */}
      <aside className="relative h-[300px] md:h-auto overflow-hidden bg-[#1c1c1a]">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ backgroundImage: `url(${SHOWCASE_IMAGE})`, backgroundSize: 'cover', backgroundPosition: 'center 40%' }}
        />
        <div aria-hidden className="absolute inset-0" style={{ background: SCRIM_BACKGROUND }} />

        {/* floating earning lift-out (decorative, desktop only) */}
        <div
          aria-hidden
          className="hidden md:block absolute top-9 right-9 w-44 rounded-[15px] border border-[#2c2925] p-3.5 backdrop-blur"
          style={{ background: 'rgba(24,20,17,.74)' }}
        >
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#c8a24e] opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#c8a24e]" />
            </span>
            <span className="text-[9px] uppercase tracking-[.14em] text-[#f0ede6]/55">Table booked</span>
          </div>
          <div className="mt-1 font-['Fraunces'] text-[22px] font-light text-[#e7d6ad]">+€6.40</div>
          <div className="text-[8px] leading-tight text-[#f0ede6]/40">example earning · from a guest tap</div>
        </div>

        <div className="relative z-10 flex h-full flex-col justify-between p-9 md:p-10">
          {/* top: wordmark */}
          <Logo size={30} withWordmark wordmarkClassName="text-[#f0ede6] text-[19px]" />

          {/* bottom: headline + checklist */}
          <div>
            <span
              className="mb-4 hidden md:inline-flex items-center gap-2 rounded-full border border-[#2c2925] bg-[#23211d]/70 px-3 py-1 text-[10px] uppercase tracking-[.16em] text-[#e7d6ad]"
            >
              ✦ For short-term rental hosts
            </span>
            <h2
              className="font-['Fraunces'] font-light text-[38px] leading-[1.08] text-[#fdfaf3]"
              style={{ textShadow: TEXT_SHADOW }}
            >
              {headline}
            </h2>
            <p
              className="mt-4 max-w-[392px] text-[14.5px] leading-[1.65] text-[rgba(245,242,235,.92)]"
              style={{ textShadow: TEXT_SHADOW }}
            >
              {sub}
            </p>

            <ul className="mt-6 hidden md:block space-y-3">
              {points.map(point => (
                <li
                  key={point}
                  className="flex items-center gap-3 text-[13.5px] text-[rgba(245,242,235,.92)]"
                  style={{ textShadow: TEXT_SHADOW }}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#c8a24e]/20 text-[#e7d6ad]">
                    <CheckIcon className="h-2.5 w-2.5" />
                  </span>
                  {point}
                </li>
              ))}
            </ul>

            <div
              className="mt-8 hidden md:block text-[11px] tracking-wide text-[#f0ede6]/35"
              style={{ textShadow: TEXT_SHADOW }}
            >
              bemgu.app
            </div>
          </div>
        </div>
      </aside>

      {/* ── RIGHT: form column ── */}
      <main className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[368px]">
          {/* mobile-only brand row */}
          <div className="mb-8 md:hidden">
            <Logo size={26} withWordmark wordmarkClassName="text-[#1c1c1a] text-[17px]" />
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}
