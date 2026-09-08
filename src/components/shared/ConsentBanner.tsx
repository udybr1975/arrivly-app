/**
 * Analytics consent banner.
 *
 * Renders ONLY on tracked routes (never on a guest page or a welcome page — a guest is
 * never asked, because nothing is ever loaded for them) and ONLY while no choice is stored.
 *
 * Accept stores 'granted' and calls initAnalytics() so the script loads immediately on this
 * page rather than on the next navigation. Decline stores 'denied' and nothing ever loads.
 * The two buttons are deliberately EQUAL WEIGHT — same size, same type scale, no dark
 * pattern nudging one over the other.
 */
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { getConsent, setConsent, initAnalytics, isTrackedRoute, trackPageView } from '../../lib/analytics'

const BTN =
  'rounded-[10px] px-4 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1c1c1a]'

export default function ConsentBanner() {
  const { pathname } = useLocation()
  const [choiceMade, setChoiceMade] = useState(() => getConsent() !== null)

  if (choiceMade) return null
  if (!isTrackedRoute(pathname)) return null

  function decide(choice: 'granted' | 'denied') {
    setConsent(choice)
    setChoiceMade(true)
    if (choice === 'granted') {
      initAnalytics()
      // The accepting session would otherwise contribute no page view at all: AnalyticsTracker's
      // effect already ran for this pathname and will not re-run until the next navigation, so
      // without this the single most valuable hit in a landing funnel — the page the visitor
      // accepted ON — is lost.
      trackPageView(pathname)
    }
  }

  return (
    <div
      role="region"
      aria-label="Analytics cookies"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-white/20 bg-[#1c1c1a]/95 backdrop-blur px-4 py-4"
    >
      <div className="mx-auto flex max-w-[860px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-relaxed text-[#f0ede6]">
          We use analytics cookies to understand how the product is used. Guest pages are never
          tracked, and declining changes nothing about the service.{' '}
          <a
            href="/legal/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded underline underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            Privacy policy
          </a>
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => decide('denied')}
            className={`${BTN} border border-white/20 bg-white/10 text-[#f0ede6] hover:bg-white/20`}
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => decide('granted')}
            className={`${BTN} border border-white/20 bg-white/10 text-[#f0ede6] hover:bg-white/20`}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
