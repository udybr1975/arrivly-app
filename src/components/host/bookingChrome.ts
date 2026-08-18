// Booking chrome shared by BookingManager and AvailabilityPicker.
//
// WHY THIS FILE EXISTS: three consumers now share one contract — what a colour MEANS and what
// counts as a feed source. The picker's cells and the calendar's cells must never disagree.
// Exporting from BookingManager instead would close an import cycle (BookingManager imports the
// picker); that cycle would very likely still work, since nothing is read at module-evaluation
// time, so the argument for extracting is the shared contract, NOT an imminent runtime failure.
//
// Nothing here is new: every function is the definition previously inlined in BookingManager.tsx,
// moved verbatim.
//
// ⚠ DO NOT "HARMONISE" isManualSource WITH isBlockSource. They answer different questions and
// only one of them is authorization-adjacent:
//   isBlockSource  — a SUBSTRING test, purely cosmetic (does this row draw as a block strip?)
//   isManualSource — STRICT EQUALITY, and it has a server twin in api/cancel-booking.ts
//                    (isFeedOwned). It decides whether a CANCEL affordance is offered.
// Making the manual test a substring check would let a source named `manual-airbnb` pass the
// client rule. The server would still refuse it, but the UI would be lying about what is possible.

export const BLOCK_GREY = '#b8b0a2'

export function isBlockSource(source: string | null): boolean {
  return source?.includes('block') ?? false
}

// Manual bookings are the only ones a host may cancel. A legacy NULL source is manual —
// the same assumption sourceLabel() already makes when it renders NULL as 'Manual'.
// MUST stay in step with isFeedOwned() in api/cancel-booking.ts, which is the enforcing copy.
export function isManualSource(source: string | null): boolean {
  return !source || source.toLowerCase() === 'manual'
}

export function sourceColor(source: string | null): string {
  if (!source) return '#c97c14'
  const s = source.toLowerCase()
  if (s.includes('airbnb')) return '#3b6d11'
  if (s.includes('vrbo')) return '#185fa5'
  if (s.includes('booking')) return '#003580'
  if (s.includes('tripadvisor')) return '#00aa6c'
  if (s.includes('guesty') || s.includes('hostaway') || s.includes('lodgify')) return '#7c3aed'
  return '#c97c14'
}

export function sourceLabel(source: string | null): string {
  if (!source) return 'Manual'
  const s = source.toLowerCase()
  if (s === 'manual') return 'Manual'
  if (s.includes('airbnb') && s.includes('block')) return 'Airbnb block'
  if (s.includes('airbnb')) return 'Airbnb'
  if (s.includes('vrbo') && s.includes('block')) return 'VRBO block'
  if (s.includes('vrbo')) return 'VRBO'
  if (s.includes('booking') && s.includes('block')) return 'Booking block'
  if (s.includes('booking')) return 'Booking.com'
  if (s.includes('tripadvisor')) return 'TripAdvisor'
  if (s.includes('guesty')) return 'Guesty'
  if (s.includes('hostaway')) return 'Hostaway'
  if (s.includes('lodgify')) return 'Lodgify'
  if (s.includes('block')) return 'Blocked'
  return 'iCal'
}

// Compact legend category for the calendar (groups all reservation channels).
export function calLegendLabel(source: string | null): string {
  if (!source) return 'Manual'
  const s = source.toLowerCase()
  if (s === 'manual') return 'Manual'
  if (s.includes('airbnb')) return 'Airbnb'
  if (s.includes('vrbo')) return 'VRBO'
  if (s.includes('booking')) return 'Booking.com'
  return 'Other'
}
