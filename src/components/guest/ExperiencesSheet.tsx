import { ARRIVLY_CONFIG } from '../../config'

export interface ExperienceItem {
  provider: 'viator' | 'gyg' | 'tiqets'
  productId: string
  title: string
  imageUrl: string | null
  rating: number | null
  reviewCount: number | null
  priceAmount: number | null
  priceCurrency: 'EUR' | 'USD'
  durationLabel: string | null
  url: string
}

interface Props {
  apartmentId: string
  accentColor: string
  brandName: string
  isOnTrial: boolean
  experiences: ExperienceItem[]
  gygCityLink: string | null
  loading: boolean
  onClose: () => void
}

const PROVIDER_LABEL: Record<ExperienceItem['provider'], string> = {
  viator: 'Viator',
  gyg: 'GetYourGuide',
  tiqets: 'Tiqets',
}

function formatAmount(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2)
}

// Fire-and-forget click beacon — never blocks navigation, never throws.
function fireClick(apartmentId: string, provider: string, productId: string): void {
  try {
    fetch('/api/experience-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ apartmentId, provider, productId }),
    }).catch(() => {})
  } catch {
    /* ignore */
  }
}

export default function ExperiencesSheet({
  apartmentId,
  accentColor,
  brandName,
  isOnTrial,
  experiences,
  gygCityLink,
  loading,
  onClose,
}: Props) {
  // Defensive re-sort (server already ranks): rating desc, then reviewCount desc.
  const items = [...experiences].sort(
    (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.reviewCount ?? 0) - (a.reviewCount ?? 0)
  )

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#fffdf9] w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl shadow-2xl relative p-7 md:p-9"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-5 right-5 text-[#9a958c] hover:text-[#1c1c1a] text-2xl leading-none bg-transparent border-none cursor-pointer"
        >
          ✕
        </button>

        <header className="mb-8">
          <p className="text-[10px] tracking-[0.2em] uppercase font-semibold mb-1.5" style={{ color: accentColor }}>
            Plan your time
          </p>
          <h2 className="font-['Fraunces'] font-light text-2xl tracking-tight text-[#1c1c1a]">Tours & tickets</h2>
        </header>

        {loading && (
          <div className="py-16 text-center flex flex-col items-center">
            <div
              className="w-9 h-9 border-2 border-[#e9e4d9] rounded-full animate-spin mb-4"
              style={{ borderTopColor: accentColor }}
            />
            <p className="text-sm text-[#5b5853] italic">Loading experiences…</p>
          </div>
        )}

        {!loading && (
          <div className="space-y-3">
            {items.map((ex) => (
              <a
                key={`${ex.provider}:${ex.productId}`}
                href={ex.url}
                target="_blank"
                rel="noopener noreferrer nofollow sponsored"
                onClick={() => fireClick(apartmentId, ex.provider, ex.productId)}
                className="block bg-[#fffdf9] border border-[#e9e4d9] rounded-[14px] overflow-hidden no-underline hover:border-[#d8d2c5] transition-colors shadow-[0_1px_5px_rgba(0,0,0,0.04)]"
              >
                {ex.imageUrl && (
                  <img
                    src={ex.imageUrl}
                    alt=""
                    loading="lazy"
                    className="w-full h-36 object-cover"
                  />
                )}
                <div className="p-4">
                  <h3 className="text-sm font-medium text-[#1c1c1a] leading-snug break-words">{ex.title}</h3>

                  <div className="flex items-center gap-3 mt-2 text-[11px] text-[#9a958c]">
                    {ex.rating != null && (
                      <span className="inline-flex items-center gap-1" style={{ color: accentColor }}>
                        ★ {ex.rating.toFixed(1)}
                        {ex.reviewCount != null && (
                          <span className="text-[#9a958c]">({ex.reviewCount})</span>
                        )}
                      </span>
                    )}
                    {ex.durationLabel && <span>{ex.durationLabel}</span>}
                  </div>

                  <div className="flex items-center justify-between gap-3 mt-3">
                    <div className="min-w-0">
                      {ex.priceAmount != null ? (
                        <span className="inline-flex items-baseline gap-1.5">
                          <span className="text-[10px] uppercase tracking-widest text-[#9a958c]">From</span>
                          <span className="font-['Fraunces'] text-lg text-[#1c1c1a]">
                            {ex.priceCurrency === 'USD' ? '$' : '€'}
                            {formatAmount(ex.priceAmount)}
                          </span>
                          {ex.priceCurrency === 'USD' && (
                            <span className="text-[9px] uppercase tracking-widest text-[#9a958c] border border-[#e9e4d9] rounded px-1 py-0.5">
                              USD
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-[#9a958c]">See price</span>
                      )}
                    </div>
                    <span
                      className="shrink-0 text-[10px] uppercase tracking-widest px-3 py-1.5 rounded text-white"
                      style={{ background: accentColor }}
                    >
                      Book ↗
                    </span>
                  </div>

                  <p className="text-[10px] text-[#9a958c] mt-2.5">Bookable with {PROVIDER_LABEL[ex.provider]}</p>
                </div>
              </a>
            ))}

            {gygCityLink && (
              <a
                href={gygCityLink}
                target="_blank"
                rel="noopener noreferrer nofollow sponsored"
                onClick={() => fireClick(apartmentId, 'gyg', 'city')}
                className="flex items-center justify-between w-full p-4 rounded-[14px] no-underline bg-[#fffdf9] border border-[#e9e4d9] hover:border-[#d8d2c5] transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-[#1c1c1a]">See more on GetYourGuide</p>
                  <p className="text-[11px] text-[#9a958c]">Browse more tours & tickets nearby</p>
                </div>
                <span style={{ color: accentColor }}>→</span>
              </a>
            )}

            {items.length === 0 && !gygCityLink && (
              <p className="text-sm text-[#5b5853] italic py-8 text-center">
                No experiences available right now — try the neighbourhood picks below.
              </p>
            )}

            <p className="text-[10px] text-[#9a958c] leading-relaxed pt-4 text-center">
              Your host may earn a commission when you book through these links. Prices shown are set by the
              booking partner.
            </p>
            <p className="text-[10px] text-[#9a958c] uppercase tracking-widest text-center pt-1">
              {isOnTrial ? ARRIVLY_CONFIG.poweredByText : `Curated for ${brandName}`}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
