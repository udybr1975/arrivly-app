import { useEffect, useRef } from 'react'

// ── PolicyBlockToast ──────────────────────────────────────────────────────────────────────
//
// A red toast shown when a SAVE WAS REFUSED BY POLICY and an explanatory panel is already on
// screen. Clicking it scrolls to that panel.
//
// DELIBERATELY GENERIC, AND THE NAME IS PART OF THAT. The trigger is "a save was refused by
// policy and there is a panel explaining it", NOT "the address-swap trigger fired". The property
// cap, a tier ceiling, or any future rule must be able to use this with no change to this file —
// so it takes a message and a panel id, and knows nothing about what was refused or why.
//
// WHY A TOAST *AND* A PANEL, RATHER THAN EITHER ALONE: the panel carries the explanation and the
// actions (upgrade, contact), which a toast cannot hold. But the panel can render below the fold
// on a long form, so a host who pressed Save sees nothing happen. The toast is the acknowledgement
// that the press was received; the panel is the answer. They are ONE state, which is why dismissal
// clears both — see `onDismiss`.

interface Props {
  /** Truthy only while the blocked state is live. The caller owns this state; the panel below
   *  must be driven by the SAME value so the two can never disagree. */
  open: boolean
  /** One line. Say what was refused, not how to fix it — the panel does that. */
  message: string
  /** DOM id of the explanatory panel. Clicking the toast scrolls it into view. */
  panelId: string
  /** Clears the blocked state — dismissing the toast dismisses the panel with it. */
  onDismiss: () => void
}

export default function PolicyBlockToast({ open, message, panelId, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)

  // LOAD-BEARING, AND NOT ONLY FOR ACCESSIBILITY. Focusing the toast tells a keyboard or
  // screen-reader user the save was refused instead of leaving them on a Save button that
  // silently did nothing — AND the focus is what scrolls the toast into view. Both the toast and
  // the panel render at the top of the page while Save sits at the bottom of a long form, so
  // WITHOUT this focus the host presses Save and sees nothing at all. Do not add
  // `preventScroll: true` here (unlike the panel focus below, which must not fight its own
  // smooth scroll) and do not remove the focus without replacing the scroll another way.
  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])

  if (!open) return null

  function goToPanel() {
    const el = document.getElementById(panelId)
    if (!el) return
    // Honour the OS reduced-motion setting rather than always smooth-scrolling.
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
    // preventScroll IS REQUIRED: a focus() without it performs its own instant scroll, which
    // preempts and cancels the smooth animation started on the line above. ('auto' rather than
    // 'instant' for the reduced-motion branch — 'instant' throws on older Safari.)
    if (el instanceof HTMLElement) el.focus?.({ preventScroll: true })
  }

  return (
    <div
      ref={ref}
      tabIndex={-1}
      // `alert` + assertive: a refused save is the one thing the host must hear immediately.
      role="alert"
      aria-live="assertive"
      className="mb-3 rounded-[10px] bg-[#fde4e4] border border-[#f3c9c9] px-3.5 py-2.5 flex items-start gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8a1a1a]"
    >
      <button
        type="button"
        onClick={goToPanel}
        className="flex-1 text-left text-[11px] text-[#8a1a1a] leading-[1.6] underline decoration-transparent hover:decoration-current transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8a1a1a] rounded"
      >
        {message} <span className="whitespace-nowrap">— see details ↓</span>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-[#8a1a1a] text-[13px] leading-none px-1 rounded hover:bg-[#f8d4d4] transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8a1a1a]"
      >
        ✕
      </button>
    </div>
  )
}
