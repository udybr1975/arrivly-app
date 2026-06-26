import type { ReactNode } from 'react'

interface PlanCardProps {
  tierName: string
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

      {/* Tier label + optional pill */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`text-[11px] font-semibold tracking-[.14em] uppercase ${
            featured ? 'text-[#e7d6ad]' : 'text-[#a8842f]'
          }`}
        >
          {tierName}
        </span>
        {tag && (
          <span
            className={`text-[9px] font-semibold uppercase tracking-[.08em] px-2 py-0.5 rounded-full border ${
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
          featured ? 'text-[#b9b2a4]' : 'text-[#8a8276]'
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
