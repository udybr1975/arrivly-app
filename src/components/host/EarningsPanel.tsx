import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Lock, MousePointerClick, ExternalLink, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ARRIVLY_CONFIG } from '../../config'
import { EXPERIENCE_PROVIDERS, type ProviderKey } from '../../lib/experienceProviders'
import Loader from '../shared/Loader'

// ── Phase H chrome tokens ────────────────────────────────────────────────────
const CARD = 'bg-[#fffdf9] border border-[#e4ddd0] rounded-[14px] p-5'
const EYEBROW = 'text-[10px] font-medium uppercase tracking-[.12em] text-[#a79e8e] mb-3'
const BTN_OUTLINE =
  'inline-flex items-center gap-1.5 bg-transparent border border-[#e4ddd0] text-[#231d17] px-4 py-2 rounded-[10px] text-xs font-semibold hover:bg-[#f0ede6] transition-colors'

interface HostRow {
  tier: number | null
  viator_partner_id: string | null
  gyg_partner_id: string | null
  tiqets_partner_id: string | null
}

type ClicksByProvider = Record<ProviderKey, number>
interface AptClicks {
  id: string
  name: string
  viator: number
  gyg: number
  tiqets: number
  total: number
}

const ZERO_PROVIDERS: ClicksByProvider = { viator: 0, gyg: 0, tiqets: 0 }

function eur(n: number): string {
  return `€${Math.round(n).toLocaleString('en-GB')}`
}

// Exact euros-and-cents for the CONFIRMED (real) commission figure. Separate from eur()
// (which rounds to whole euros for the estimate cards — do not merge them).
function eurExact(n: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }).format(n)
}

export default function EarningsPanel() {
  const [loading, setLoading] = useState(true)
  const [host, setHost] = useState<HostRow | null>(null)
  const [byProvider, setByProvider] = useState<ClicksByProvider>(ZERO_PROVIDERS)
  const [byApt, setByApt] = useState<AptClicks[]>([])
  const [total, setTotal] = useState(0)
  // Real Tiqets commission (EUR-only, fulfilled, last 30d) — powers the tier 1–2 tease card.
  const [confirmedEur, setConfirmedEur] = useState(0)
  const [confirmedCount, setConfirmedCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { if (!cancelled) setLoading(false); return }

      const { data: hostRow } = await supabase
        .from('hosts')
        .select('tier, viator_partner_id, gyg_partner_id, tiqets_partner_id')
        .eq('id', user.id)
        .maybeSingle()

      const { data: apts } = await supabase
        .from('apartments')
        .select('id, name')
        .eq('host_id', user.id)
        .order('created_at')

      const aList = (apts ?? []) as Array<{ id: string; name: string }>
      const aptIds = aList.map(a => a.id)

      const provTotals: ClicksByProvider = { ...ZERO_PROVIDERS }
      const perApt = new Map<string, AptClicks>()
      for (const a of aList) perApt.set(a.id, { id: a.id, name: a.name, viator: 0, gyg: 0, tiqets: 0, total: 0 })

      // Confirmed real-commission accumulators (EUR-only). Stay 0 when the host has no apartments.
      let confEur = 0
      let confCount = 0

      if (aptIds.length) {
        // Last 30 days. RLS (host_reads_own_clicks) already scopes to the host's own
        // apartments; the .in() filter is a belt-and-braces narrowing.
        const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
        const { data: clicks } = await supabase
          .from('experience_clicks')
          .select('apartment_id, provider')
          .in('apartment_id', aptIds)
          .gte('clicked_at', since)

        for (const c of (clicks ?? []) as Array<{ apartment_id: string; provider: string }>) {
          const p = c.provider as ProviderKey
          if (p !== 'viator' && p !== 'gyg' && p !== 'tiqets') continue
          provTotals[p] += 1
          const row = perApt.get(c.apartment_id)
          if (row) { row[p] += 1; row.total += 1 }
        }

        // Real Tiqets commissions (ingested by api/cron-refresh-earnings.ts). RLS
        // (hosts read own experience orders) scopes to the host's own apartments; the
        // .in() mirrors the clicks query. Same 30-day window (order_fulfilled_at column).
        // apartment_id-null rows (unattributed) are excluded by .in() — intended.
        const { data: orders } = await supabase
          .from('experience_orders')
          .select('commission_excl_vat, currency')
          .eq('provider', 'tiqets')
          .eq('status', 'fulfilled')
          .in('apartment_id', aptIds)
          .gte('order_fulfilled_at', since)

        for (const o of (orders ?? []) as Array<{ commission_excl_vat: number | null; currency: string | null }>) {
          // NEVER cross-sum currencies — count EUR rows only (locked project rule).
          if (o.currency !== 'EUR') continue
          const c = Number(o.commission_excl_vat)
          confEur += Number.isFinite(c) ? c : 0
          confCount += 1
        }
        // Round before formatting to avoid float artefacts (e.g. 6.4000000001).
        confEur = Math.round(confEur * 100) / 100
      }

      if (cancelled) return
      setHost(hostRow as HostRow | null)
      setByProvider(provTotals)
      setByApt([...perApt.values()].sort((a, b) => b.total - a.total))
      setTotal(provTotals.viator + provTotals.gyg + provTotals.tiqets)
      setConfirmedEur(confEur)
      setConfirmedCount(confCount)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading) return <Loader />

  const tier = host?.tier ?? 1
  const connectedTier = tier >= ARRIVLY_CONFIG.experiencesTierGate
  const connectedCount = EXPERIENCE_PROVIDERS.filter(p => !!host?.[p.column]).length

  return (
    <div className="max-w-4xl font-['Inter']">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-[22px] font-['Fraunces'] font-light text-[#231d17]">Earnings</h1>
          <p className="text-[12px] text-[#8a8276] mt-1 max-w-md">
            Guests can book tours &amp; tickets right from your guest page. Here's how often they tap through.
          </p>
        </div>
        {connectedTier && (
          <Link to="/dashboard/earnings/connect" className={`${BTN_OUTLINE} shrink-0`}>
            {connectedCount > 0 ? 'Manage marketplaces' : 'Connect marketplaces'}
          </Link>
        )}
      </div>

      {connectedTier
        ? <ConnectedState byProvider={byProvider} byApt={byApt} total={total} host={host} />
        : <TeaseState total={total} confirmedEur={confirmedEur} confirmedCount={confirmedCount} />}
    </div>
  )
}

// ── Tier 3+ : real click data + honest "reported in your dashboard" commission cells ──
function ConnectedState({
  byProvider, byApt, total, host,
}: { byProvider: ClicksByProvider; byApt: AptClicks[]; total: number; host: HostRow | null }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Summary: total taps */}
      <div className={CARD}>
        <div className={EYEBROW}>Last 30 days</div>
        <div className="flex items-baseline gap-2">
          <MousePointerClick size={20} className="text-[#c8a24e]" />
          <span className="text-[30px] font-['Fraunces'] font-light text-[#231d17] leading-none">{total}</span>
          <span className="text-[13px] text-[#8a8276]">experience {total === 1 ? 'tap' : 'taps'} from your guests</span>
        </div>
      </div>

      {/* Per-provider connection + commission (reported in the provider portal) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {EXPERIENCE_PROVIDERS.map(p => {
          const connected = !!host?.[p.column]
          return (
            <div key={p.key} className={CARD}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[13px] font-semibold text-[#231d17]">{p.label}</span>
                {connected ? (
                  <span className="text-[9.5px] font-semibold uppercase tracking-[.06em] bg-[#e4f0da] text-[#2a5c0a] px-2 py-0.5 rounded-full">Connected</span>
                ) : (
                  <span className="text-[9.5px] font-semibold uppercase tracking-[.06em] bg-[#f6efdd] border border-[#ecdfbe] text-[#b09a6a] px-2 py-0.5 rounded-full">Not connected</span>
                )}
              </div>
              <div className="text-[22px] font-['Fraunces'] font-light text-[#231d17] leading-none">{byProvider[p.key]}</div>
              <div className="text-[11px] text-[#8a8276] mt-0.5 mb-3">taps · 30 days</div>
              <div className="border-t border-[#e4ddd0] pt-2.5">
                {connected ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[#a79e8e]">Commission</span>
                      <span className="text-[15px] text-[#231d17] font-['Fraunces']">—</span>
                    </div>
                    <a
                      href={p.portalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-[#a8842f] hover:text-[#c8a24e] transition-colors mt-1"
                    >
                      Reported in your {p.label} dashboard
                      <ExternalLink size={11} />
                    </a>
                  </>
                ) : p.key === 'viator' ? (
                  // Viator is not connectable — a host PID may not ride on links served from
                  // bemgu.app (written ruling, 4 Aug 2026). No CTA, and no deep link to a
                  // section EarningsConnect no longer renders.
                  <span className="text-[11px] text-[#8a8276] leading-relaxed">
                    Earns for Bemgu — Viator does not permit host accounts on our pages.
                  </span>
                ) : (
                  <Link
                    to={`/dashboard/earnings/connect?provider=${p.key}`}
                    className="w-full justify-center inline-flex items-center gap-1.5 bg-[#c8a24e] text-[#16100d] px-4 py-2.5 rounded-[10px] text-xs font-semibold hover:bg-[#e7d6ad] transition-colors"
                  >
                    Connect {p.label} <ArrowUpRight size={14} />
                  </Link>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Per-property taps table */}
      <div className={CARD}>
        <div className={EYEBROW}>Taps by property · 30 days</div>
        {byApt.length === 0 ? (
          <p className="text-[12px] text-[#8a8276]">Add a property to start showing experiences to your guests.</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[10px] uppercase tracking-[.08em] text-[#a79e8e]">
                  <th className="font-medium py-1.5 px-1">Property</th>
                  <th className="font-medium py-1.5 px-1 text-right">Viator</th>
                  <th className="font-medium py-1.5 px-1 text-right">GetYourGuide</th>
                  <th className="font-medium py-1.5 px-1 text-right">Tiqets</th>
                  <th className="font-medium py-1.5 px-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {byApt.map(a => (
                  <tr key={a.id} className="border-t border-[#efe9dc] text-[12.5px] text-[#231d17]">
                    <td className="py-2 px-1 truncate max-w-[180px]">{a.name}</td>
                    <td className="py-2 px-1 text-right tabular-nums text-[#5b5853]">{a.viator}</td>
                    <td className="py-2 px-1 text-right tabular-nums text-[#5b5853]">{a.gyg}</td>
                    <td className="py-2 px-1 text-right tabular-nums text-[#5b5853]">{a.tiqets}</td>
                    <td className="py-2 px-1 text-right tabular-nums font-semibold">{a.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[10.5px] text-[#a79e8e] leading-relaxed mt-3">
          Viator commissions go to Bemgu — Viator does not permit host accounts on our pages. GetYourGuide and Tiqets can be connected to your own accounts.
        </p>
        <p className="text-[10.5px] text-[#a79e8e] leading-relaxed mt-3">
          Taps are guest clicks on experience links — a helpful signal, not a booking count. Actual bookings,
          commission and payouts are reported in each marketplace's own partner dashboard.
        </p>
      </div>
    </div>
  )
}

// ── Tier 1–2 : real taps + clearly-labelled estimate + upgrade path ───────────
function TeaseState({ total, confirmedEur, confirmedCount }: { total: number; confirmedEur: number; confirmedCount: number }) {
  const { conversionRate, avgBookingValueEuros, commissionRate } = ARRIVLY_CONFIG.experienceEstimate
  const estBookings = total * conversionRate
  const estCommission = estBookings * avgBookingValueEuros * commissionRate

  // Verified-euros card (gold border to distinguish REAL data from the estimate cards).
  // Rendered only when there is at least one confirmed EUR booking; otherwise null, so
  // the tease is byte-identical to before in the zero-orders production state.
  const confirmedCard = confirmedCount > 0 ? (
    <div className="bg-[#fffdf9] border border-[#dcc68f] rounded-[14px] p-5">
      <div className="flex items-center justify-between">
        <div className={EYEBROW}>Confirmed bookings · Tiqets · last 30 days</div>
        <span className="text-[9.5px] font-semibold uppercase tracking-[.06em] bg-[#f3ecdb] text-[#7a5c1a] px-2 py-0.5 rounded-full">EUR</span>
      </div>
      <div className="flex items-baseline gap-2">
        <CheckCircle2 size={20} aria-hidden="true" className="text-[#5c8a3a]" />
        <span className="text-[30px] font-['Fraunces'] font-light text-[#231d17] leading-none">{eurExact(confirmedEur)}</span>
        <span className="text-[13px] text-[#8a8276]">from {confirmedCount} fulfilled booking{confirmedCount === 1 ? '' : 's'}</span>
      </div>
      <p className="text-[10.5px] text-[#a79e8e] leading-relaxed mt-2">
        Real commission reported by Tiqets (excl. VAT, refunds excluded) — generated by your guests, currently
        paid to Bemgu. On Portfolio, the marketplaces pay <em>you</em> directly.
      </p>
    </div>
  ) : null

  if (total === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className={CARD}>
          <div className="flex flex-col items-center text-center py-6">
            <div className="w-11 h-11 rounded-full bg-[#f3ecdb] flex items-center justify-center mb-3">
              <MousePointerClick size={20} className="text-[#c8a24e]" />
            </div>
            <div className="text-[15px] font-semibold text-[#231d17] mb-1">No experience taps yet</div>
            <p className="text-[12px] text-[#8a8276] max-w-sm leading-relaxed">
              Your guest pages already show tours &amp; tickets. As guests start tapping through, you'll see the
              numbers here — and what you could earn by connecting your own marketplace accounts.
            </p>
          </div>
        </div>
        {confirmedCard}
        <UpgradeCard />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={CARD}>
        <div className={EYEBROW}>Last 30 days</div>
        <div className="flex items-baseline gap-2">
          <MousePointerClick size={20} className="text-[#c8a24e]" />
          <span className="text-[30px] font-['Fraunces'] font-light text-[#231d17] leading-none">{total}</span>
          <span className="text-[13px] text-[#8a8276]">
            {total === 1 ? 'time your guests clicked' : 'times your guests clicked'} an experience this month
          </span>
        </div>
      </div>

      {confirmedCard}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className={CARD}>
          <div className={EYEBROW}>Estimated bookings</div>
          <div className="text-[26px] font-['Fraunces'] font-light text-[#231d17] leading-none">
            ≈ {estBookings < 1 ? estBookings.toFixed(1) : Math.round(estBookings)}
          </div>
          <p className="text-[11px] text-[#8a8276] mt-1.5">Estimate only</p>
        </div>
        <div className={CARD}>
          <div className={EYEBROW}>Estimated commission</div>
          <div className="text-[26px] font-['Fraunces'] font-light text-[#231d17] leading-none">
            ≈ {eur(estCommission)}
          </div>
          <p className="text-[11px] text-[#8a8276] mt-1.5">Estimate only</p>
        </div>
      </div>

      <p className="text-[10.5px] text-[#a79e8e] leading-relaxed px-1">
        Estimates assume ~{Math.round(conversionRate * 100)}% of taps become bookings, a ~{eur(avgBookingValueEuros)}{' '}
        average booking, and a ~{Math.round(commissionRate * 100)}% commission. Real figures vary — these are
        illustrative, not actual earnings.
      </p>

      <UpgradeCard />
    </div>
  )
}

function UpgradeCard() {
  const gateTier = ARRIVLY_CONFIG.experiencesTierGate
  return (
    <div className="bg-[#1c1c1a] border border-[#322c25] rounded-[14px] p-5 relative overflow-hidden">
      {/* Blurred, locked provider row */}
      <div aria-hidden="true" className="flex gap-3 mb-4 blur-[3px] opacity-40 select-none pointer-events-none">
        {EXPERIENCE_PROVIDERS.map(p => (
          <div key={p.key} className="flex-1 rounded-[10px] border border-[#3a342c] bg-[#211f1c] px-3 py-4">
            <div className="text-[12px] font-semibold text-[#e9e3d7]">{p.label}</div>
            <div className="text-[18px] font-['Fraunces'] text-[#c8a24e] mt-1">€ ••</div>
          </div>
        ))}
      </div>
      <div className="flex items-start gap-2 mb-1">
        <Lock size={15} className="text-[#c8a24e] mt-0.5 shrink-0" />
        <div className="text-[15px] font-semibold text-[#f4ecdb]">Keep the commission yourself</div>
      </div>
      <p className="text-[12px] text-[#b6ad9e] leading-relaxed mb-4 max-w-lg">
        Right now these bookings earn a commission for Bemgu. On Portfolio (Tier {gateTier}) and above you connect
        your own GetYourGuide and Tiqets accounts — and the marketplaces pay <em>you</em> directly. Bemgu
        never touches your money.
      </p>
      <Link
        to="/dashboard/billing"
        className="inline-flex items-center gap-1.5 bg-[#c8a24e] text-[#16100d] px-4 py-2.5 rounded-[10px] text-xs font-semibold hover:bg-[#e7d6ad] transition-colors"
      >
        See plans <ArrowUpRight size={14} />
      </Link>
    </div>
  )
}
