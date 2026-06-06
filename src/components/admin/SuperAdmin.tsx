import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import { ARRIVLY_CONFIG } from '../../config'
import { resolveImageUrl } from '../../lib/imageUtils'
import Loader from '../shared/Loader'
import InstallCard from '../host/InstallCard'

interface PlanRow {
  tier: number
  price_cents: number
  max_properties: number | null
  includes_booking: boolean
}

interface HostEntry {
  id: string
  brand_name: string | null
  name: string | null
  contact_email: string | null
  city: string | null
  subscription_status: string | null
  tier: number | null
  is_exempt: boolean
  trial_ends_at: string | null
  created_at: string
  price_override_cents: number | null
  discount_percent: number | null
  discount_until: string | null
  property_cap_override: number | null
  apartments_count: number
  bookings_count: number
  effective_price_cents: number
  days_left: number | null
}

interface AdminOverview {
  hosts: HostEntry[]
  totals: {
    total_hosts: number
    on_trial: number
    paid_active: number
    grace: number
    expired: number
    mrr_cents: number
  }
  plans: PlanRow[]
}

interface ImpersonateApt {
  id: string
  name: string | null
  city: string | null
  is_visible: boolean
  hero_image_url: string | null
  accent_color: string | null
  bookings_count: number
  host_picks_count: number
}

interface ImpersonateHost {
  brand_name: string | null
  name: string | null
  contact_email: string | null
  city: string | null
  tier: number | null
  subscription_status: string | null
  trial_ends_at: string | null
  accent_color: string | null
  logo_url: string | null
  is_exempt: boolean
  created_at: string
  price_override_cents: number | null
  discount_percent: number | null
  discount_until: string | null
  property_cap_override: number | null
  effective_price_cents: number
  plan_label: string | null
  plan_max_properties: number | null
}

interface ImpersonateSnapshot {
  host: ImpersonateHost
  apartments: ImpersonateApt[]
}

type StatusFilter = 'all' | 'trial' | 'active' | 'grace' | 'expired'
type SortKey = 'expiring' | 'newest' | 'name'

const STATUS_PILL: Record<string, string> = {
  trial:   'bg-[#dceef8] text-[#0c3d70]',
  active:  'bg-[#e4f0da] text-[#2a5c0a]',
  grace:   'bg-[#faeeda] text-[#7a4800]',
  expired: 'bg-[#fde4e4] text-[#8a1a1a]',
}

function StatusPill({ status }: { status: string | null }) {
  const s = status ?? 'trial'
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_PILL[s] ?? STATUS_PILL.trial}`}>
      {s.charAt(0).toUpperCase() + s.slice(1)}
    </span>
  )
}

function TierPill({ tier }: { tier: number | null }) {
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-[#f0e8ff] text-[#4a0e8f]">
      Tier {tier ?? 1}
    </span>
  )
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

export default function SuperAdmin() {
  const navigate = useNavigate()
  const [data, setData] = useState<AdminOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<SortKey>('expiring')
  const [showExempt, setShowExempt] = useState(false)

  // "View as" impersonate state
  const [impersonateData, setImpersonateData]       = useState<ImpersonateSnapshot | null>(null)
  const [impersonateLoading, setImpersonateLoading] = useState(false)
  const [impersonateId, setImpersonateId]           = useState<string | null>(null)
  const [impersonateErr, setImpersonateErr]         = useState('')

  useEffect(() => {
    let cancelled = false
    api.get<AdminOverview>('/admin-overview')
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : 'Failed to load')
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) await supabase.auth.signOut({ scope: 'local' })
    navigate('/login', { replace: true })
  }

  async function viewAs(hostId: string) {
    setImpersonateLoading(true)
    setImpersonateErr('')
    setImpersonateId(hostId)
    try {
      const snap = await api.get<ImpersonateSnapshot>(`/admin-impersonate?host_id=${encodeURIComponent(hostId)}`)
      setImpersonateData(snap)
    } catch (e: unknown) {
      setImpersonateErr(e instanceof Error ? e.message : 'Failed to load snapshot')
    } finally {
      setImpersonateLoading(false)
    }
  }

  function exitImpersonate() {
    setImpersonateData(null)
    setImpersonateId(null)
    setImpersonateErr('')
  }

  if (loading) return <Loader />

  if (loadErr || !data) {
    return (
      <div className="min-h-screen bg-[#f0ede6] p-8 flex items-center justify-center">
        <div className="text-[13px] text-[#8a1a1a]">Failed to load: {loadErr}</div>
      </div>
    )
  }

  // ── Impersonate overlay (normal-flow faux-viewport, not position:fixed) ──
  if (impersonateData) {
    const { host, apartments } = impersonateData
    const brand = host.brand_name ?? host.name ?? '—'
    return (
      <div className="min-h-screen bg-[#f0ede6]">
        {/* Persistent read-only banner — sticky relative to page scroll (not fixed) */}
        <div className="sticky top-0 z-10 bg-[#faeeda] border-b border-[#d4a847] px-4 md:px-8 py-2.5 flex items-center gap-3 shadow-sm">
          <span className="text-[12px] font-medium text-[#7a4800] flex-1 min-w-0 truncate">
            Viewing <strong>{brand}</strong> — read only
          </span>
          <button
            onClick={exitImpersonate}
            className="bg-[#1a1a1a] text-white px-3 py-1 rounded-[6px] text-[11px] font-semibold hover:opacity-80 transition-opacity shrink-0"
          >
            Exit
          </button>
        </div>

        <div className="p-4 md:p-8">
          <div className="max-w-5xl mx-auto space-y-4">

            {/* Host summary — read only, no mutating controls */}
            <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4">
              <div className="text-[10px] uppercase tracking-[.06em] text-[#999] mb-2">Host account</div>
              <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                <span className="text-[14px] font-semibold text-[#1a1a1a]">{brand}</span>
                <TierPill tier={host.tier} />
                <StatusPill status={host.subscription_status} />
                {host.is_exempt && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-[#faeeda] text-[#7a4800]">Exempt</span>
                )}
              </div>
              <div className="text-[11px] text-[#666] space-y-0.5">
                {host.contact_email && <div>{host.contact_email}</div>}
                {host.city && <div>{host.city}</div>}
                <div>Joined {fmtDate(host.created_at)}</div>
                {host.trial_ends_at && (
                  <div>Trial ends {fmtDate(host.trial_ends_at)}</div>
                )}
                {!host.is_exempt && (() => {
                  const euros = host.effective_price_cents / 100
                  const amt   = euros % 1 === 0 ? euros.toFixed(0) : euros.toFixed(2)
                  const discountActive = !!host.discount_percent &&
                    (!host.discount_until || new Date(host.discount_until) >= new Date())
                  const until = host.discount_until ? ` until ${fmtDate(host.discount_until)}` : ''
                  return (
                    <div>
                      {ARRIVLY_CONFIG.currencySymbol}{amt}/mo
                      {discountActive && (
                        <span className="text-[#7a4800]">
                          {' '}({host.discount_percent}% off{until})
                        </span>
                      )}
                      {host.plan_label && (
                        <span className="text-[#aaa]"> · {host.plan_label}</span>
                      )}
                    </div>
                  )
                })()}
                {(() => {
                  const cap = host.property_cap_override ?? host.plan_max_properties
                  if (cap === null) return <div className="text-[#aaa]">Unlimited properties</div>
                  return <div className="text-[#aaa]">{cap} {cap === 1 ? 'property' : 'properties'} max</div>
                })()}
              </div>
            </div>

            {/* Apartments — read only */}
            <div>
              <div className="text-[10px] uppercase tracking-[.06em] text-[#999] mb-2">
                {apartments.length} propert{apartments.length !== 1 ? 'ies' : 'y'}
              </div>
              {apartments.length === 0 ? (
                <div className="text-[12px] text-[#aaa] text-center py-6 bg-white border border-[#ddd8ce] rounded-[10px]">
                  No properties yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {apartments.map(apt => (
                    <div key={apt.id} className="bg-white border border-[#ddd8ce] rounded-[10px] p-3.5">
                      <div className="flex items-center gap-3">
                        {apt.hero_image_url ? (
                          <img src={resolveImageUrl(apt.hero_image_url)} alt="" className="w-10 h-10 rounded-[7px] object-cover shrink-0" />
                        ) : (
                          <div
                            className="w-10 h-10 rounded-[7px] shrink-0"
                            style={{ background: apt.accent_color ?? '#1c1c1a' }}
                          />
                        )}
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                              <span className="text-[12px] font-semibold text-[#1a1a1a] truncate">{apt.name ?? '—'}</span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${apt.is_visible ? 'bg-[#e4f0da] text-[#2a5c0a]' : 'bg-[#ede9e2] text-[#888]'}`}>
                                {apt.is_visible ? 'Active' : 'Draft'}
                              </span>
                            </div>
                            <div className="text-[10px] text-[#888]">
                              {apt.city ? `${apt.city} · ` : ''}
                              {apt.bookings_count} booking{apt.bookings_count !== 1 ? 's' : ''} · {apt.host_picks_count} pick{apt.host_picks_count !== 1 ? 's' : ''}
                            </div>
                            {/* Public guest page — NO token, opens neutral/no-token state; private check-in details stay gated */}
                            <a
                              href={`${ARRIVLY_CONFIG.appUrl}/guest?apt=${apt.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-[#0c3d70] hover:underline mt-0.5 inline-block"
                            >
                              Preview guest page ↗
                            </a>
                          </div>
                        </div>
                      </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    )
  }
  // ── End overlay ───────────────────────────────────────────────────────────

  // Filter + sort
  let visible = showExempt ? data.hosts : data.hosts.filter(h => !h.is_exempt)
  if (statusFilter !== 'all') visible = visible.filter(h => h.subscription_status === statusFilter)

  const sorted = [...visible].sort((a, b) => {
    if (sort === 'expiring') {
      if (a.trial_ends_at == null && b.trial_ends_at == null) return 0
      if (a.trial_ends_at == null) return 1
      if (b.trial_ends_at == null) return -1
      return new Date(a.trial_ends_at).getTime() - new Date(b.trial_ends_at).getTime()
    }
    if (sort === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    return (a.brand_name ?? a.name ?? '').localeCompare(b.brand_name ?? b.name ?? '')
  })

  const { totals, plans } = data

  const METRICS = [
    { label: 'Total hosts',     value: totals.total_hosts },
    { label: 'On trial',        value: totals.on_trial },
    { label: 'Paid active',     value: totals.paid_active },
    { label: 'MRR (projected)', value: `${ARRIVLY_CONFIG.currencySymbol}${(totals.mrr_cents / 100).toFixed(0)}` },
    { label: 'Grace',           value: totals.grace },
    { label: 'Expired',         value: totals.expired },
  ]

  const FILTER_BTNS: { key: StatusFilter; label: string }[] = [
    { key: 'all',     label: 'All'     },
    { key: 'trial',   label: 'Trial'   },
    { key: 'active',  label: 'Active'  },
    { key: 'grace',   label: 'Grace'   },
    { key: 'expired', label: 'Expired' },
  ]

  return (
    <div className="min-h-screen bg-[#f0ede6] p-4 md:p-8">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-5 flex-wrap gap-y-2 gap-x-3">
          <div className="flex items-center gap-2.5">
            <h1 className="text-[18px] font-serif font-light text-[#1a1a1a]">Superadmin — Arrivly</h1>
            <span className="text-[10px] bg-[#fde4e4] text-[#8a1a1a] px-2 py-0.5 rounded-full font-medium">🔒 Locked</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/dashboard"
              className="bg-white border border-[#ddd8ce] text-[#444] px-3 py-1.5 rounded-[7px] text-xs hover:bg-[#f0ede6] transition-colors"
            >
              Open my host dashboard →
            </Link>
            <button
              onClick={signOut}
              className="bg-transparent border border-[#ddd8ce] text-[#444] px-3 py-1.5 rounded-[7px] text-xs hover:bg-white transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* View-as error (shown above metrics, auto-clears on next action) */}
        {impersonateErr && (
          <div className="bg-[#fde4e4] text-[#8a1a1a] text-[11px] rounded-[8px] px-3 py-2 mb-3">
            View as failed: {impersonateErr}
          </div>
        )}

        {/* PWA install card — hidden automatically when standalone */}
        <InstallCard />

        {/* Metrics */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-5">
          {METRICS.map(m => (
            <div key={m.label} className="bg-white border border-[#ddd8ce] rounded-[10px] p-3">
              <div className="text-[22px] font-serif font-light text-[#1a1a1a]">{m.value}</div>
              <div className="text-[10px] uppercase tracking-[.06em] text-[#999] mt-0.5 leading-tight">{m.label}</div>
            </div>
          ))}
        </div>

        {/* Filter + sort + exempt toggle */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="flex items-center gap-1 flex-wrap">
            {FILTER_BTNS.map(f => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`px-2.5 py-1 rounded-[6px] text-[11px] transition-colors ${
                  statusFilter === f.key
                    ? 'bg-[#1a1a1a] text-white'
                    : 'bg-white border border-[#ddd8ce] text-[#666] hover:bg-[#f0ede6]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            className="bg-white border border-[#ddd8ce] rounded-[6px] px-2 py-1 text-[11px] text-[#444] focus:outline-none focus:border-[#1a1a1a]"
          >
            <option value="expiring">Expiring soon</option>
            <option value="newest">Newest</option>
            <option value="name">Name</option>
          </select>
          <label className="flex items-center gap-1.5 ml-auto text-[11px] text-[#666] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showExempt}
              onChange={e => setShowExempt(e.target.checked)}
              className="w-3 h-3"
            />
            Show my account
          </label>
        </div>

        {/* Host list */}
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-[.06em] text-[#999] mb-2">
            {sorted.length} host{sorted.length !== 1 ? 's' : ''}
          </div>
          {sorted.length === 0 && (
            <div className="text-[12px] text-[#aaa] text-center py-8">No hosts match this filter.</div>
          )}
          {sorted.map(h => {
            const plan = plans.find(p => p.tier === (h.tier ?? 1))
            const cap = h.property_cap_override ?? plan?.max_properties
            const capStr = cap == null ? '∞' : String(cap)
            const daysRed = h.days_left !== null && h.days_left <= 7
            const isThisLoading = impersonateLoading && impersonateId === h.id

            return (
              <div key={h.id} className="bg-white border border-[#ddd8ce] rounded-[10px] p-3.5">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-[7px] bg-[#1a1a1a] flex items-center justify-center text-[11px] text-white font-semibold shrink-0 mt-0.5">
                    {(h.brand_name ?? h.name ?? '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* Name + pills */}
                    <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                      <span className="text-[12px] font-semibold text-[#1a1a1a]">
                        {h.brand_name ?? h.name ?? '—'}
                      </span>
                      <TierPill tier={h.tier} />
                      <StatusPill status={h.subscription_status} />
                      {h.is_exempt && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-[#faeeda] text-[#7a4800]">Exempt</span>
                      )}
                    </div>
                    {/* Email · city · properties · bookings */}
                    <div className="text-[10px] text-[#888] truncate">
                      {h.contact_email ?? '—'}
                      {h.city ? ` · ${h.city}` : ''}
                      {` · ${h.apartments_count}/${capStr} ${h.apartments_count === 1 ? 'property' : 'properties'}`}
                      {` · ${h.bookings_count} booking${h.bookings_count !== 1 ? 's' : ''}`}
                    </div>
                    {/* Dates + days left */}
                    <div className="text-[10px] text-[#aaa] mt-0.5">
                      Joined {fmtDate(h.created_at)}
                      {h.trial_ends_at && (
                        <>
                          {' · Trial ends '}{fmtDate(h.trial_ends_at)}
                          {' · '}
                          <span className={daysRed ? 'text-[#8a1a1a] font-medium' : ''}>
                            {h.days_left !== null ? `${h.days_left}d` : '—'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => viewAs(h.id)}
                    disabled={impersonateLoading}
                    className={`bg-transparent border border-[#ddd8ce] px-3 py-1 rounded-[6px] text-[10px] shrink-0 mt-0.5 transition-colors ${
                      isThisLoading
                        ? 'text-[#aaa] cursor-wait'
                        : impersonateLoading
                          ? 'text-[#aaa] cursor-not-allowed'
                          : 'text-[#444] hover:bg-[#f0ede6] cursor-pointer'
                    }`}
                  >
                    {isThisLoading ? 'Loading…' : 'View as'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

      </div>
    </div>
  )
}
