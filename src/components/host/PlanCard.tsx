import type { ReactNode } from 'react'

interface PlanCardProps {
  tierName: string
  // Subordinate qualifier shown beside the tier label — e.g. Pro "(full booking)".
  // THE RULE, in one sentence: `PlanCard.tierName` gets the descriptor via THIS prop;
  // nothing else does. It must never be concatenated into `tierName`, which renders as an
  // uppercase wide-tracked eyebrow and would shout it at the same weight as the name, and
  // it must never reach `name` in TIER_COPY — that is what billing emails
  // (`api/_lib/email.ts` TIER_NAMES) and webhook alerts (`api/stripe-webhook.ts`
  // TIER_NAMES_W) mirror, and they stay plain "Pro".
  descriptor?: string
  price: string
  priceSuffix?: string
  valueProp: string
  capacityLabel: string
  bullets: string[]
  featured?: boolean
  currentTag?: boolean
  comingSoonTag?: boolean
  cta: ReactNode
}

// Shared presentational plan card. No data fetching, no business logic —
// parents pass display strings + a ready-rendered CTA node into the slot.
export default function PlanCard({
  tierName,
  descriptor,
  price,
  priceSuffix = '/mo',
  valueProp,
  capacityLabel,
  bullets,
  featured = false,
  currentTag = false,
  comingSoonTag = false,
  cta,
}: PlanCardProps) {
  const tag = currentTag ? 'Your plan' : comingSoonTag ? 'At launch' : null

  return (
    <div
      className={`relative flex flex-col h-full rounded-[16px] p-[22px_20px] font-['Inter'] ${
        featured
          ? 'bg-[#1c1c1a] border border-[#c8a24e] xl:-translate-y-2 xl:shadow-[0_20px_44px_rgba(20,16,13,0.20)]'
          : 'bg-[#fffdf9] border border-[#e4ddd0]'
      }`}
    >
      {featured && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#c8a24e] text-[#16100d] text-[10px] font-semibold uppercase tracking-[.1em] px-3 py-0.5 rounded-full whitespace-nowrap">
          Most popular
        </span>
      )}

      {/* Tier label + optional descriptor + optional pill.
          Crowding order at the xl 4-column width is deliberate: the name and the pill both
          hold their size, and the DESCRIPTOR is the only element allowed to shrink or
          truncate. Longest real combination is NON-FEATURED tier 4 on the cream card —
          "PRO" + "(full booking)" + the "At launch" pill — which measures ~168px inside a
          ~204px column, so truncate is a safety net rather than the shipped state.
          Re-measure for any descriptor longer than ~14 characters. `featured` is
          `!!copy.mostPopular`, which is tier 2 ONLY, so the dark-card colour below is
          defensive and unreachable today. */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`shrink-0 text-[11px] font-semibold tracking-[.14em] uppercase ${
            featured ? 'text-[#e7d6ad]' : 'text-[#a8842f]'
          }`}
        >
          {tierName}
        </span>
        {descriptor && (
          // Subordinate to the eyebrow on every axis — lowercase, lighter, no wide
          // tracking, muted — so it reads as a qualifier rather than part of the name.
          // `lowercase` is a guard, which means DESCRIPTORS MUST BE LOWERCASE-SAFE COMMON
          // NOUNS: a proper noun ("GetYourGuide sync") would render wrong here and look
          // right at the source. `-ml-0.5` is an optical correction, not a stray margin —
          // the name's `tracking-[.14em]` emits a trailing letter-space, so a raw `gap-2`
          // reads ~9.5px before the descriptor against a true 8px before the pill.
          //
          // COLOUR — `#6b6354`, which is now this file's muted token rather than a departure
          // from it. It was chosen here first, ahead of the 24 Aug 2026 sweep: the former
          // `#8a8276` is 3.73:1 on the `#fffdf9` card, below WCAG AA (4.5:1), and 12.5px
          // never qualified for the 3:1 large-text allowance either. At 10.5px there was not
          // even an argument to make. THE RESIDUAL THIS COMMENT ONCE NAMED — `valueProp`
          // carrying the failing token at 12.5px — WAS CLOSED BY THAT SWEEP.
          // `#6b6354` is 5.84:1 and already in the palette
          // (`src/components/demo/UpgradeWall.tsx:62`). This is the string that explains
          // the €49 tier, so it has to be readable.
          // Ratios measured, not estimated; the tier NAME beside it (`#a8842f`, 3.44:1)
          // is lower still and untouched — a card-wide contrast sweep is its own job.
          // The `featured` arm is UNREACHABLE and left alone rather than restyled:
          // `featured` is `!!copy.mostPopular` (tier 2 only) and tier 4 is the only tier
          // carrying a descriptor — disjoint, re-verified against tierCopy.ts.
          <span
            className={`min-w-0 truncate -ml-0.5 text-[10.5px] font-normal lowercase ${
              featured ? 'text-[#c8a24e]' : 'text-[#6b6354]'
            }`}
          >
            ({descriptor})
          </span>
        )}
        {tag && (
          <span
            className={`shrink-0 whitespace-nowrap text-[9px] font-semibold uppercase tracking-[.08em] px-2 py-0.5 rounded-full border ${
              featured ? 'text-[#e7d6ad] border-[#e7d6ad]/40' : 'text-[#a8842f] border-[#e7d6ad]'
            }`}
          >
            {tag}
          </span>
        )}
      </div>

      {/* Price */}
      <div className="mb-2">
        <span
          className={`font-['Fraunces'] font-light text-[35px] leading-none ${
            featured ? 'text-[#f7f3ec]' : 'text-[#231d17]'
          }`}
        >
          {price}
        </span>
        {priceSuffix && (
          <span
            className={`font-['Inter'] text-[13px] font-medium ml-1 ${
              featured ? 'text-[#c8a24e]' : 'text-[#a8842f]'
            }`}
          >
            {priceSuffix}
          </span>
        )}
      </div>

      {/* Value prop */}
      <p
        className={`text-[12.5px] leading-[1.5] min-h-[38px] mb-3 ${
          featured ? 'text-[#b9b2a4]' : 'text-[#6b6354]'
        }`}
      >
        {valueProp}
      </p>

      {/* Capacity chip */}
      <span
        className={`self-start inline-block px-3.5 py-[7px] rounded-[9px] text-[12px] font-semibold mb-4 ${
          featured ? 'bg-[rgba(200,162,78,0.16)] text-[#e7d6ad]' : 'bg-[#f3ecdb] text-[#8a5a14]'
        }`}
      >
        {capacityLabel}
      </span>

      {/* Bullets */}
      <ul className="flex-1 space-y-2 mb-4">
        {bullets.map((b, i) => (
          <li
            key={i}
            className={`flex items-start gap-2 text-[12.5px] ${
              featured ? 'text-[#d8d2c6]' : 'text-[#231d17]'
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              className="w-3.5 h-3.5 shrink-0 mt-0.5"
              fill="none"
              stroke={featured ? '#c8a24e' : '#a8842f'}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span>{b}</span>
          </li>
        ))}
      </ul>

      {/* CTA slot */}
      <div>{cta}</div>
    </div>
  )
}
