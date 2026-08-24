import { useMemo, useState } from 'react'
import { BLOCK_GREY, isBlockSource, sourceColor, sourceLabel } from './bookingChrome'

// ── AvailabilityPicker ────────────────────────────────────────────────────────────────────
//
// Replaces the two native `type="date"` inputs in BookingManager's New manual booking form.
//
// THE RULE THIS WHOLE COMPONENT ENCODES — HALF-OPEN INTERVALS [check_in, check_out), the same
// semantics the server guard in api/create-booking.ts enforces. Getting these two out of step
// would show a host a green cell that the server then rejects with a 409, so read them together:
//
//   A NIGHT (identified by the date it STARTS) is occupied iff some booking b satisfies
//       date >= b.check_in && date < b.check_out
//   A DAY's state is derived from the TWO NIGHTS THAT TOUCH IT:
//       night ending that morning   = the night starting on D-1
//       night starting that afternoon = the night starting on D
//       both occupied  -> FULL       (no check-in, no check-out)
//       morning only   -> DEPARTURE  (legal check-IN,  illegal check-out)
//       afternoon only -> ARRIVAL    (legal check-OUT, illegal check-in)
//       neither        -> FREE
//   A check-out on D is legal iff EVERY night from the chosen check-in through D-1 is free.
//
// WHY DEPARTURE ALLOWS A CHECK-IN: the departing guest's last night was D-1; night D is free, so
// a new stay may begin that afternoon. Same-day turnover is normal STR operation and the server
// deliberately permits it — blocking it here would contradict the guard.
//
// THE PICKER IS A COURTESY, NEVER A GATE. The 409 overlap guard (fc35d69) remains the source of
// truth. A calendar sync can land while this form is open, so the client can be stale by seconds;
// the server check is what makes a double booking impossible. Nothing here may weaken that path.

export interface PickerBooking {
  id: string
  check_in: string
  check_out: string
  reference_number: string | null
  source: string | null
  guests: { first_name: string; last_name: string } | null
}

interface Props {
  bookings: PickerBooking[]
  checkIn: string
  checkOut: string
  onChange: (next: { checkIn: string; checkOut: string }) => void
}

// DATE MATH — THE TRAP THIS REPO HAS ALREADY BEEN BITTEN BY. Every date string is built from
// LOCAL y/m/d parts. `new Date(y, m, d)` is local midnight and `.toISOString()` then converts to
// UTC, shifting the day back for every positive-UTC host — which is the entire market
// (Helsinki/Barcelona/Paris). `dayColor()` in CalendarView already does it this way; this matches.
function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
function todayLocal(): string {
  const n = new Date()
  return ymd(n.getFullYear(), n.getMonth(), n.getDate())
}
// Day arithmetic on the local calendar, never on a UTC timestamp.
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return ymd(dt.getFullYear(), dt.getMonth(), dt.getDate())
}
function fmtShort(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

type DayState = 'free' | 'full' | 'departure' | 'arrival'

export default function AvailabilityPicker({ bookings, checkIn, checkOut, onChange }: Props) {
  const today = todayLocal()
  const [cursor, setCursor] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })

  // Night index: date-that-the-night-STARTS -> the booking occupying it. A reservation wins over
  // a block when both cover the night, mirroring dayColor()'s precedence in CalendarView so the
  // two surfaces never disagree about what a colour means.
  const nightMap = useMemo(() => {
    const map = new Map<string, PickerBooking>()
    for (const b of bookings) {
      if (!b.check_in || !b.check_out) continue
      // Bounded at ~2 years: check_out comes from an iCal feed and a malformed far-future value
      // would otherwise spin this loop for the lifetime of the tab.
      for (let d = b.check_in, guard = 0; d < b.check_out && guard < 800; d = addDays(d, 1), guard++) {
        const held = map.get(d)
        if (!held || (isBlockSource(held.source) && !isBlockSource(b.source))) map.set(d, b)
      }
    }
    return map
  }, [bookings])

  const nightOf = (iso: string) => nightMap.get(iso) ?? null

  function stateOf(iso: string): DayState {
    const morning = nightOf(addDays(iso, -1)) // the night that ENDS this morning
    const afternoon = nightOf(iso)            // the night that STARTS this afternoon
    if (morning && afternoon) return 'full'
    if (morning) return 'departure'
    if (afternoon) return 'arrival'
    return 'free'
  }

  // LAST LEGAL CHECK-OUT from the chosen check-in: the first occupied night at or after it ends
  // the run, and that night's start date is itself a legal check-out (the stay's last night is
  // the day before it). Null means no booking lies ahead — unbounded.
  // HORIZON: 400 days. Beyond it this returns null and check-out becomes unbounded, so a booking
  // further out than that is offered and the server 409s. Courtesy-only degradation, and the
  // arrows page indefinitely, so the bound is real — stated rather than left to be discovered.
  const maxCheckout = useMemo(() => {
    if (!checkIn) return null
    for (let d = checkIn, i = 0; i < 400; d = addDays(d, 1), i++) {
      if (nightOf(d)) return d
    }
    return null
  }, [checkIn, nightMap]) // eslint-disable-line react-hooks/exhaustive-deps

  const picking: 'in' | 'out' = !checkIn || (checkIn && checkOut) ? 'in' : 'out'

  function legalCheckIn(iso: string): boolean {
    if (iso < today) return false
    const s = stateOf(iso)
    return s === 'free' || s === 'departure' // night starting today must be free
  }
  function legalCheckOut(iso: string): boolean {
    if (!checkIn || iso <= checkIn) return false
    return maxCheckout === null || iso <= maxCheckout
  }

  function reasonFor(iso: string): string {
    const afternoon = nightOf(iso)
    const who = (b: PickerBooking) =>
      isBlockSource(b.source)
        ? `${sourceLabel(b.source)} (blocked)`
        : `${b.guests?.first_name ?? 'Guest'}${b.reference_number?.startsWith('ARR-') ? ` · ${b.reference_number}` : ''}`

    if (iso < today) return 'In the past'
    if (picking === 'in') {
      if (afternoon) return `Night of ${fmtShort(iso)} is taken by ${who(afternoon)}`
      return `Check in on ${fmtShort(iso)}`
    }
    if (iso <= (checkIn || '')) return 'Check-out must be after check-in'
    if (maxCheckout && iso > maxCheckout) {
      const b = nightOf(maxCheckout)
      return `${b ? who(b) : 'A booking'} starts ${fmtShort(maxCheckout)} — latest check-out from ${fmtShort(checkIn)} is ${fmtShort(maxCheckout)}`
    }
    return `Check out on ${fmtShort(iso)}`
  }

  function onPick(iso: string) {
    if (picking === 'in') {
      // Choosing a new check-in always restarts the range; a stale check-out could otherwise
      // survive across a booking and describe a span the server would reject.
      onChange({ checkIn: iso, checkOut: '' })
    } else {
      onChange({ checkIn, checkOut: iso })
    }
  }

  function monthGrid(base: Date) {
    const y = base.getFullYear()
    const m = base.getMonth()
    const firstDay = new Date(y, m, 1).getDay()
    const days = new Date(y, m + 1, 0).getDate()
    const cells: (number | null)[] = []
    for (let i = 0; i < firstDay; i++) cells.push(null)
    for (let d = 1; d <= days; d++) cells.push(d)
    return { y, m, cells }
  }

  const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

  function renderMonth(base: Date, key: string) {
    const { y, m, cells } = monthGrid(base)
    return (
      <div key={key} className="flex-1 min-w-0">
        <div className="text-center text-[12px] font-semibold text-[#231d17] mb-2">
          {base.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        </div>
        <div className="grid grid-cols-7 gap-1 mb-1" aria-hidden="true">
          {DOW.map(d => (
            <div key={d} className="text-center text-[10px] uppercase tracking-[.05em] text-[#a79e8e]">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (day === null) return <div key={i} className="aspect-square" />
            const iso = ymd(y, m, day)
            const st = stateOf(iso)
            const past = iso < today
            const enabled = picking === 'in' ? legalCheckIn(iso) : legalCheckOut(iso)
            const isIn = iso === checkIn
            const isOut = iso === checkOut
            const inRange = !!checkIn && !!checkOut && iso > checkIn && iso < checkOut

            const morningB = nightOf(addDays(iso, -1))
            const afternoonB = nightOf(iso)
            const colOf = (b: PickerBooking | null) =>
              b ? (isBlockSource(b.source) ? BLOCK_GREY : sourceColor(b.source)) : null
            const mC = colOf(morningB)
            const aC = colOf(afternoonB)

            // The cell splits corner to corner with the MORNING half upper-left and the AFTERNOON
            // half lower-right, so the shading always points at the half that is taken. `to bottom
            // right` puts the first stop in the upper-left triangle, which is exactly that.
            let bg: string | undefined
            if (st === 'full' && mC && aC) bg = mC === aC ? mC : `linear-gradient(to bottom right, ${mC} 0 50%, ${aC} 50% 100%)`
            else if (st === 'departure' && mC) bg = `linear-gradient(to bottom right, ${mC} 0 50%, transparent 50% 100%)`
            else if (st === 'arrival' && aC) bg = `linear-gradient(to bottom right, transparent 0 50%, ${aC} 50% 100%)`

            const selected = isIn || isOut
            const label =
              `${new Date(y, m, day).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}. ` +
              `${st === 'full' ? 'Fully booked. ' : st === 'departure' ? 'Guest departs this morning. ' : st === 'arrival' ? 'Guest arrives this afternoon. ' : ''}` +
              reasonFor(iso)

            return (
              // THE TOOLTIP LIVES ON THE WRAPPER, NOT THE BUTTON. A disabled button receives no
              // pointer events, so a `title` on it never renders in Chrome or Safari — the
              // explanation would have been missing from precisely the cells that need it. The
              // aria-label on the button carries the same text for assistive tech.
              //
              // THE WRAPPER MUST GENERATE A BOX — `aspect-square block`, NOT `contents`. With
              // `display:contents` the span has no box of its own, and whether a browser resolves
              // `title` up to a boxless ancestor after retargeting a disabled control's hit test
              // is UA behaviour, not spec. This form is hoverable by construction: the span is
              // now the grid item and the button fills it with `w-full h-full`.
              <span key={i} title={reasonFor(iso)} className="aspect-square block">
              <button
                type="button"
                disabled={!enabled}
                onClick={() => onPick(iso)}
                aria-label={label}
                // aria-current, not aria-pressed: this is a date selection, not a toggle button.
                // A screen reader announcing "pressed" for a date is the wrong mental model.
                aria-current={selected ? 'date' : undefined}
                className={[
                  'relative w-full h-full rounded-[6px] text-[11px] flex items-center justify-center',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e] focus-visible:ring-offset-1',
                  // Reduced motion respected: the transition is dropped, never the state change.
                  'transition-colors motion-reduce:transition-none',
                  enabled ? 'cursor-pointer' : 'cursor-not-allowed',
                  past || !enabled ? 'opacity-55' : '',
                  selected ? 'ring-2 ring-[#1c1c1a]' : '',
                  inRange ? 'bg-[#e7d6ad]' : '',
                  st === 'free' && !inRange && !selected ? 'hover:bg-[#f0ede6]' : '',
                  st === 'full' ? 'text-white font-semibold' : 'text-[#231d17]',
                ].join(' ')}
                style={bg ? { backgroundImage: bg.startsWith('linear') ? bg : undefined, backgroundColor: bg.startsWith('linear') ? undefined : bg } : undefined}
              >
                {/* CONTRAST, NOT DECORATION. On a departure/arrival cell the digit would
                    otherwise sit on the source-colour wedge — #231d17 on #003580 is 1.46:1
                    against a 4.5:1 requirement (11px is not large text). These are the ENABLED
                    cells, so they are not exempt the way a disabled FULL cell is. The solid chip
                    restores AA while leaving the diagonal shading visible around it. */}
                <span
                  className={
                    st === 'full'
                      ? 'line-through decoration-2'
                      : st === 'departure' || st === 'arrival'
                        ? 'relative z-[1] rounded-[3px] bg-[#fffdf9] px-1 leading-none'
                        : ''
                  }
                >
                  {day}
                </span>
              </button>
              </span>
            )
          })}
        </div>
      </div>
    )
  }

  const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
          className="w-7 h-7 flex items-center justify-center rounded-[8px] border border-[#e4ddd0] text-[#231d17] hover:bg-[#f0ede6] transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]"
          aria-label="Previous month"
        >‹</button>
        <div className="text-[11px] text-[#6b6354]">
          {picking === 'in' ? 'Pick a check-in date' : `Pick a check-out date${maxCheckout ? ` — latest ${fmtShort(maxCheckout)}` : ''}`}
        </div>
        <button
          type="button"
          onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
          className="w-7 h-7 flex items-center justify-center rounded-[8px] border border-[#e4ddd0] text-[#231d17] hover:bg-[#f0ede6] transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]"
          aria-label="Next month"
        >›</button>
      </div>

      {/* Two months side by side; under 640px the second is hidden and the arrows page the first. */}
      <div className="flex gap-4">
        {renderMonth(cursor, 'a')}
        <div className="hidden sm:flex flex-1 min-w-0">{renderMonth(next, 'b')}</div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3 pt-3 border-t border-[#f0ede6] text-[10px] text-[#6b6354]">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-[3px] border border-[#e4ddd0]" /> Free
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-[3px]" style={{ backgroundImage: `linear-gradient(to bottom right, ${BLOCK_GREY} 0 50%, transparent 50% 100%)`, border: '1px solid #e4ddd0' }} />
          Departure — check-in OK
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-[3px]" style={{ backgroundImage: `linear-gradient(to bottom right, transparent 0 50%, ${BLOCK_GREY} 50% 100%)`, border: '1px solid #e4ddd0' }} />
          Arrival — check-out OK
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-[3px]" style={{ backgroundColor: BLOCK_GREY }} /> Blocked / booked
        </span>
      </div>

      {(checkIn || checkOut) && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="text-[11px] text-[#231d17]">
            {checkIn ? fmtShort(checkIn) : '—'} → {checkOut ? fmtShort(checkOut) : '—'}
          </div>
          <button
            type="button"
            onClick={() => onChange({ checkIn: '', checkOut: '' })}
            className="text-[11px] text-[#6b6354] underline hover:text-[#231d17] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e] rounded"
          >
            Clear dates
          </button>
        </div>
      )}
    </div>
  )
}
