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
  label: string
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
  trial_days: number
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

interface ManageDraft {
  tier: number
  subscription_status: string
  price_override_cents: string
  discount_percent: string
  discount_until: string
  property_cap_override: string
  extend_days: string
}

interface AuditEntry {
  id: string
  actor_email: string
  action: string
  target_host_id: string | null
  detail: Record<string, unknown> | null
  created_at: string
}

interface AuditResponse {
  entries: AuditEntry[]
  hostNames: Record<string, string>
}

interface PlanSettingsTier {
  tier: number
  price: string
  cap: string
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

function auditSummary(action: string, detail: Record<string, unknown> | null): string {
  if (!detail) return ''
  if (action === 'update_host') {
    const patch = (detail.patch as Record<string, unknown>) ?? {}
    const fields = Object.keys(patch).filter(k => k !== 'trial_ends_at').map(k => k.replace(/_/g, ' '))
    const trialPatch = 'trial_ends_at' in patch ? ['trial extended'] : []
    const ext = detail.extend_trial_days ? [`+${detail.extend_trial_days}d`] : []
    return [...fields, ...trialPatch, ...ext].join(', ') || '—'
  }
  if (action === 'update_plans') {
    const n  = Array.isArray(detail.plans) ? detail.plans.length : 0
    const td = typeof detail.trial_days === 'number' ? ` · trial: ${detail.trial_days}d` : ''
    return `${n} tier${n !== 1 ? 's' : ''}${td}`
  }
  if (action === 'impersonate_view') {
    return `${detail.apartments ?? '?'} propert${Number(detail.apartments) !== 1 ? 'ies' : 'y'}`
  }
  if (action === 'subscription_event') {
    const from = detail.from_tier != null ? `T${detail.from_tier}→` : ''
    return `${detail.event ?? '?'} · ${from}T${detail.to_tier ?? '?'} · ${detail.status ?? '?'}`
  }
  return ''
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

  // Manage drawer state
  const [manageHostId, setManageHostId]   = useState<string | null>(null)
  const [manageDraft, setManageDraft]     = useState<ManageDraft | null>(null)
  const [manageLoading, setManageLoading] = useState(false)
  const [manageErr, setManageErr]         = useState('')

  // Plan settings state
  const [showPlanSettings, setShowPlanSettings] = useState(false)
  const [planTierDrafts, setPlanTierDrafts]     = useState<PlanSettingsTier[]>([])
  const [trialDaysDraft, setTrialDaysDraft]     = useState('')
  const [plansLoading, setPlansLoading]         = useState(false)
  const [plansErr, setPlansErr]                 = useState('')
  const [plansSaved, setPlansSaved]             = useState(false)

  // Audit log state
  const [showAudit, setShowAudit]       = useState(false)
  const [auditData, setAuditData]       = useState<AuditResponse | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditErr, setAuditErr]         = useState('')

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

  function openManage(h: HostEntry) {
    setManageHostId(h.id)
    setManageDraft({
      tier:                   h.tier ?? 1,
      subscription_status:    h.subscription_status ?? 'trial',
      price_override_cents:   h.price_override_cents !== null ? String(h.price_override_cents / 100) : '',
      discount_percent:       h.discount_percent !== null ? String(h.discount_percent) : '',
      discount_until:         h.discount_until ? h.discount_until.slice(0, 10) : '',
      property_cap_override:  h.property_cap_override !== null ? String(h.property_cap_override) : '',
      extend_days:            '',
    })
    setManageErr('')
  }

  function closeManage() {
    setManageHostId(null)
    setManageDraft(null)
    setManageErr('')
  }

  async function saveManage() {
    if (!manageHostId || !manageDraft || !data) return
    const original = data.hosts.find(h => h.id === manageHostId)
    if (!original) return

    const patch: Record<string, unknown> = {}

    if (manageDraft.tier !== (original.tier ?? 1)) patch.tier = manageDraft.tier
    if (manageDraft.subscription_status !== original.subscription_status) {
      patch.subscription_status = manageDraft.subscription_status
    }

    const newPrice = manageDraft.price_override_cents.trim() === ''
      ? null
      : Math.round(parseFloat(manageDraft.price_override_cents) * 100)
    if (newPrice !== null && !Number.isFinite(newPrice)) {
      setManageErr('Enter a valid price or leave blank'); return
    }
    if (newPrice !== original.price_override_cents) patch.price_override_cents = newPrice

    const newDiscount = manageDraft.discount_percent.trim() === ''
      ? null
      : parseInt(manageDraft.discount_percent, 10)
    if (newDiscount !== null && (!Number.isFinite(newDiscount) || newDiscount < 0 || newDiscount > 100)) {
      setManageErr('Discount must be 0–100'); return
    }
    if (newDiscount !== original.discount_percent) patch.discount_percent = newDiscount

    const newUntil  = manageDraft.discount_until.trim() || null
    const origUntil = original.discount_until ? original.discount_until.slice(0, 10) : null
    if (newUntil !== origUntil) patch.discount_until = newUntil

    const newCap = manageDraft.property_cap_override.trim() === ''
      ? null
      : parseInt(manageDraft.property_cap_override, 10)
    if (newCap !== null && !Number.isFinite(newCap)) {
      setManageErr('Enter a valid property cap or leave blank'); return
    }
    if (newCap !== original.property_cap_override) patch.property_cap_override = newCap

    const rawExtend  = manageDraft.extend_days.trim()
    const extendDays = rawExtend !== '' ? parseInt(rawExtend, 10) : undefined
    if (extendDays !== undefined && (!Number.isFinite(extendDays) || extendDays < 1)) {
      setManageErr('Extend days must be a positive number'); return
    }

    if (Object.keys(patch).length === 0 && !extendDays) { closeManage(); return }

    setManageLoading(true)
    setManageErr('')
    try {
      await api.post('/admin-update-host', {
        host_id: manageHostId,
        patch,
        ...(extendDays ? { extend_trial_days: extendDays } : {}),
      })
      closeManage()
      // Re-fetch to refresh totals, MRR, and days_left (best-effort; stale on failure)
      try {
        const fresh = await api.get<AdminOverview>('/admin-overview')
        setData(fresh)
      } catch {}
    } catch (e: unknown) {
      setManageErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setManageLoading(false)
    }
  }

  function togglePlanSettings() {
    if (!showPlanSettings && data) {
      setPlanTierDrafts(data.plans.map(p => ({
        tier:  p.tier,
        price: p.price_cents % 100 === 0
          ? String(p.price_cents / 100)
          : (p.price_cents / 100).toFixed(2),
        cap:   p.max_properties !== null ? String(p.max_properties) : '',
      })))
      setTrialDaysDraft(String(data.trial_days))
      setPlansErr('')
      setPlansSaved(false)
    }
    setShowPlanSettings(s => !s)
  }

  async function savePlans() {
    setPlansErr('')
    setPlansSaved(false)
    for (const t of planTierDrafts) {
      const priceNum = parseFloat(t.price)
      if (!Number.isFinite(priceNum) || priceNum < 0 || priceNum > 1000) {
        setPlansErr(`Tier ${t.tier}: price must be 0–1000`); return
      }
      if (t.cap.trim() !== '') {
        const capNum = parseInt(t.cap, 10)
        if (!Number.isFinite(capNum) || capNum < 1) {
          setPlansErr(`Tier ${t.tier}: property cap must be at least 1`); return
        }
      }
    }
    const trialNum = parseInt(trialDaysDraft, 10)
    if (!Number.isFinite(trialNum) || trialNum < 1 || trialNum > 365) {
      setPlansErr('Trial days must be 1–365'); return
    }
    const plansPayload = planTierDrafts.map(t => ({
      tier:           t.tier,
      price_cents:    Math.round(parseFloat(t.price) * 100),
      max_properties: t.cap.trim() !== '' ? parseInt(t.cap, 10) : null,
    }))
    setPlansLoading(true)
    try {
      const result = await api.post<{ plans: PlanRow[]; trial_days: number }>(
        '/admin-plans',
        { plans: plansPayload, trial_days: trialNum }
      )
      setData(prev => prev ? { ...prev, plans: result.plans, trial_days: result.trial_days } : prev)
      setPlansSaved(true)
      setTimeout(() => setPlansSaved(false), 3000)
    } catch (e: unknown) {
      setPlansErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setPlansLoading(false)
    }
  }

  async function loadAudit() {
    setAuditLoading(true)
    setAuditErr('')
    try {
      const result = await api.get<AuditResponse>('/admin-audit')
      setAuditData(result)
    } catch (e: unknown) {
      setAuditErr(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setAuditLoading(false)
    }
  }

  if (loading) return <Loader />

  if (loadErr || !data) {
    return (
      <div className="min-h-screen bg-[#f0ede6] p-8 flex items-center justify-center">
        <div className="text-[13px] text-[#8a1a1a]">Failed to load: {loadErr}</div>
      </div>
    )
  }

  // ── Manage overlay (normal-flow faux-viewport, not position:fixed) ────────
  if (manageHostId && manageDraft) {
    const manageHost   = data.hosts.find(h => h.id === manageHostId)
    const brand        = manageHost ? (manageHost.brand_name ?? manageHost.name ?? '—') : '—'
    const previewPlan  = data.plans.find(p => p.tier === manageDraft.tier)

    // Live effective price preview
    const previewBase  = manageDraft.price_override_cents.trim() !== ''
      ? Math.round(parseFloat(manageDraft.price_override_cents) * 100)
      : (previewPlan?.price_cents ?? 1900)
    const rawPct       = manageDraft.discount_percent.trim() !== '' ? parseInt(manageDraft.discount_percent, 10) : 0
    const previewPct   = Number.isFinite(rawPct) ? Math.max(0, Math.min(100, rawPct)) : 0
    const discActive   = previewPct > 0 &&
      (!manageDraft.discount_until || new Date(manageDraft.discount_until) >= new Date())
    const previewEff   = discActive ? Math.round(previewBase * (1 - previewPct / 100)) : previewBase
    const previewEuros = previewEff / 100
    const previewStr   = previewEuros % 1 === 0 ? previewEuros.toFixed(0) : previewEuros.toFixed(2)

    const inputCls = 'bg-[#f8f6f2] border border-[#ddd8ce] rounded-[8px] px-3 py-2 text-xs text-[#444] focus:border-[#1a1a1a] focus:outline-none w-full'

    return (
      <div className="min-h-screen bg-[#f0ede6]">
        <div className="sticky top-0 z-10 bg-white border-b border-[#ddd8ce] px-4 md:px-8 py-2.5 flex items-center gap-3 shadow-sm">
          <span className="text-[12px] font-medium text-[#1a1a1a] flex-1 truncate">
            Manage — <strong>{brand}</strong>
          </span>
          <button
            onClick={closeManage}
            className="bg-transparent border border-[#ddd8ce] text-[#444] px-3 py-1 rounded-[6px] text-[11px] hover:bg-[#f0ede6] transition-colors shrink-0"
          >
            Cancel
          </button>
        </div>

        <div className="p-4 md:p-8">
          <div className="max-w-2xl mx-auto space-y-4">

            {/* Tier & Status */}
            <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-[.06em] text-[#999]">Account</div>
              <div>
                <label className="text-[11px] text-[#666] block mb-1">Tier</label>
                <select
                  value={manageDraft.tier}
                  onChange={e => setManageDraft(d => d && { ...d, tier: parseInt(e.target.value, 10) })}
                  className={inputCls}
                >
                  {[1, 2, 3, 4].map(t => {
                    const p       = data.plans.find(pl => pl.tier === t)
                    const capStr  = p?.max_properties ? `${p.max_properties} prop` : 'unlimited'
                    const priceStr = p ? ` · €${(p.price_cents / 100).toFixed(0)}/mo` : ''
                    return (
                      <option key={t} value={t}>
                        {`Tier ${t}${p ? ` — ${p.label} · ${capStr}${priceStr}` : ''}`}
                      </option>
                    )
                  })}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-[#666] block mb-1">Lifecycle status</label>
                <select
                  value={manageDraft.subscription_status}
                  onChange={e => setManageDraft(d => d && { ...d, subscription_status: e.target.value })}
                  className={inputCls}
                >
                  {['trial', 'active', 'grace', 'expired'].map(s => (
                    <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
                <div className="text-[10px] text-[#aaa] mt-1">Stripe will drive this automatically once billing is live</div>
              </div>
            </div>

            {/* Pricing */}
            <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-[.06em] text-[#999]">Pricing</div>
              <div>
                <label className="text-[11px] text-[#666] block mb-1">Price override</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[#888] pointer-events-none">{ARRIVLY_CONFIG.currencySymbol}</span>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    step="0.01"
                    placeholder={previewPlan ? `${(previewPlan.price_cents / 100).toFixed(0)} (tier default)` : 'Tier default'}
                    value={manageDraft.price_override_cents}
                    onChange={e => setManageDraft(d => d && { ...d, price_override_cents: e.target.value })}
                    className="bg-[#f8f6f2] border border-[#ddd8ce] rounded-[8px] pl-6 pr-3 py-2 text-xs text-[#444] focus:border-[#1a1a1a] focus:outline-none w-full"
                  />
                </div>
                <div className="text-[10px] text-[#aaa] mt-0.5">Leave blank to use tier default</div>
              </div>
              <div>
                <label className="text-[11px] text-[#666] block mb-1">Discount</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="0"
                      value={manageDraft.discount_percent}
                      onChange={e => setManageDraft(d => d && { ...d, discount_percent: e.target.value })}
                      className={inputCls}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#aaa] pointer-events-none">%</span>
                  </div>
                  <span className="text-[11px] text-[#aaa] self-center whitespace-nowrap">off until</span>
                  <div className="flex-1">
                    <input
                      type="date"
                      value={manageDraft.discount_until}
                      onChange={e => setManageDraft(d => d && { ...d, discount_until: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                </div>
                <div className="text-[10px] text-[#aaa] mt-0.5">Leave date blank for no expiry</div>
              </div>
              <div className="text-[11px] font-medium text-[#1a1a1a]">
                Effective: {ARRIVLY_CONFIG.currencySymbol}{previewStr}/mo
                {discActive && (
                  <span className="text-[#7a4800]"> (after {previewPct}% off)</span>
                )}
              </div>
            </div>

            {/* Limits */}
            <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-[.06em] text-[#999]">Limits</div>
              <div>
                <label className="text-[11px] text-[#666] block mb-1">Property cap override</label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  placeholder={previewPlan?.max_properties ? String(previewPlan.max_properties) : 'Unlimited (tier default)'}
                  value={manageDraft.property_cap_override}
                  onChange={e => setManageDraft(d => d && { ...d, property_cap_override: e.target.value })}
                  className={inputCls}
                />
                <div className="text-[10px] text-[#aaa] mt-0.5">Leave blank to use tier default</div>
              </div>
            </div>

            {/* Trial extension */}
            <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-[.06em] text-[#999]">Trial</div>
              <div className="text-[11px] text-[#666]">
                Ends: <strong>{manageHost?.trial_ends_at ? fmtDate(manageHost.trial_ends_at) : '—'}</strong>
              </div>
              <div>
                <label className="text-[11px] text-[#666] block mb-1">Extend by</label>
                <div className="flex gap-2 items-center">
                  <button
                    type="button"
                    onClick={() => setManageDraft(d => d && { ...d, extend_days: '7' })}
                    className="bg-[#f8f6f2] border border-[#ddd8ce] text-[#444] px-3 py-2 rounded-[8px] text-xs hover:bg-[#f0ede6] transition-colors whitespace-nowrap"
                  >
                    +7 days
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    placeholder="N"
                    value={manageDraft.extend_days}
                    onChange={e => setManageDraft(d => d && { ...d, extend_days: e.target.value })}
                    className="bg-[#f8f6f2] border border-[#ddd8ce] rounded-[8px] px-3 py-2 text-xs text-[#444] focus:border-[#1a1a1a] focus:outline-none w-20"
                  />
                  <span className="text-[11px] text-[#aaa]">days (applied on Save)</span>
                </div>
              </div>
            </div>

            {/* Intent note */}
            <div className="bg-[#faeeda] rounded-[9px] p-3 text-[11px] text-[#7a4800]">
              Changes set intent and update MRR — they don't charge the host until billing is live.
            </div>

            {manageErr && (
              <div className="bg-[#fde4e4] text-[#8a1a1a] text-[11px] rounded-[8px] px-3 py-2">
                {manageErr}
              </div>
            )}

            <div className="flex gap-2 pb-8">
              <button
                onClick={saveManage}
                disabled={manageLoading}
                className={`bg-[#1a1a1a] text-white px-4 py-2 rounded-[8px] text-xs font-semibold transition-opacity ${manageLoading ? 'opacity-50 cursor-wait' : 'hover:opacity-80'}`}
              >
                {manageLoading ? 'Saving…' : 'Save changes'}
              </button>
              <button
                onClick={closeManage}
                disabled={manageLoading}
                className="bg-transparent border border-[#ddd8ce] text-[#444] px-4 py-2 rounded-[8px] text-xs hover:bg-[#f0ede6] transition-colors"
              >
                Cancel
              </button>
            </div>

          </div>
        </div>
      </div>
    )
  }
  // ── End manage overlay ───────────────────────────────────────────────────

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
                            {/* Owner/admin preview — real full page (incl. private details), ?preview=1 server-gated */}
                            <a
                              href={`${ARRIVLY_CONFIG.appUrl}/guest?apt=${apt.id}&preview=1`}
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
                  <div className="flex gap-1.5 shrink-0 mt-0.5">
                    {!h.is_exempt && (
                      <button
                        onClick={() => openManage(h)}
                        disabled={impersonateLoading || manageLoading}
                        className="bg-transparent border border-[#ddd8ce] text-[#444] px-3 py-1 rounded-[6px] text-[10px] hover:bg-[#f0ede6] transition-colors disabled:text-[#aaa] disabled:cursor-not-allowed"
                      >
                        Manage
                      </button>
                    )}
                    <button
                      onClick={() => viewAs(h.id)}
                      disabled={impersonateLoading || manageLoading}
                      className={`bg-transparent border border-[#ddd8ce] px-3 py-1 rounded-[6px] text-[10px] transition-colors ${
                        isThisLoading
                          ? 'text-[#aaa] cursor-wait'
                          : (impersonateLoading || manageLoading)
                            ? 'text-[#aaa] cursor-not-allowed'
                            : 'text-[#444] hover:bg-[#f0ede6] cursor-pointer'
                      }`}
                    >
                      {isThisLoading ? 'Loading…' : 'View as'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Plan settings section */}
        <div className="mt-6">
          <button
            onClick={togglePlanSettings}
            className="text-[11px] text-[#666] hover:text-[#1a1a1a] transition-colors flex items-center gap-1"
          >
            {showPlanSettings ? '▲' : '▼'} Plan settings
          </button>
          {showPlanSettings && (
            <div className="mt-3 bg-white border border-[#ddd8ce] rounded-[10px] p-4">
              <div className="text-[10px] uppercase tracking-[.06em] text-[#999] mb-3">Plan catalog</div>
              <div className="space-y-3">
                {planTierDrafts.map(t => {
                  const p = plans.find(pl => pl.tier === t.tier)
                  return (
                    <div key={t.tier} className="grid grid-cols-[80px_1fr_1fr_64px] items-center gap-2">
                      <div className="text-[11px] text-[#666]">
                        Tier {t.tier}
                        {p?.label && <span className="text-[#aaa] ml-1">({p.label})</span>}
                      </div>
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[#888] pointer-events-none">{ARRIVLY_CONFIG.currencySymbol}</span>
                        <input
                          type="number" min={0} max={1000} step="0.01"
                          value={t.price}
                          onChange={e => setPlanTierDrafts(prev => prev.map(d => d.tier === t.tier ? { ...d, price: e.target.value } : d))}
                          className="bg-[#f8f6f2] border border-[#ddd8ce] rounded-[8px] pl-5 pr-2 py-1.5 text-xs text-[#444] focus:border-[#1a1a1a] focus:outline-none w-full"
                        />
                      </div>
                      <input
                        type="number" min={1} placeholder="Unlimited"
                        value={t.cap}
                        onChange={e => setPlanTierDrafts(prev => prev.map(d => d.tier === t.tier ? { ...d, cap: e.target.value } : d))}
                        className="bg-[#f8f6f2] border border-[#ddd8ce] rounded-[8px] px-2.5 py-1.5 text-xs text-[#444] focus:border-[#1a1a1a] focus:outline-none w-full"
                      />
                      <div className="text-[10px] text-[#aaa]">props cap</div>
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center gap-2.5 mt-3 pt-3 border-t border-[#f0ede6]">
                <span className="text-[11px] text-[#666] shrink-0">Default trial</span>
                <input
                  type="number" min={1} max={365}
                  value={trialDaysDraft}
                  onChange={e => setTrialDaysDraft(e.target.value)}
                  className="bg-[#f8f6f2] border border-[#ddd8ce] rounded-[8px] px-2.5 py-1.5 text-xs text-[#444] focus:border-[#1a1a1a] focus:outline-none w-20"
                />
                <span className="text-[11px] text-[#aaa]">days (new signups only)</span>
              </div>
              <div className="text-[10px] text-[#aaa] mt-2">
                Price and cap changes affect projections and future trial length. Existing hosts keep their current dates.
              </div>
              {plansErr && (
                <div className="bg-[#fde4e4] text-[#8a1a1a] text-[11px] rounded-[8px] px-3 py-2 mt-2">{plansErr}</div>
              )}
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={savePlans}
                  disabled={plansLoading}
                  className={`bg-[#1a1a1a] text-white px-4 py-1.5 rounded-[7px] text-xs font-semibold transition-opacity ${plansLoading ? 'opacity-50 cursor-wait' : 'hover:opacity-80'}`}
                >
                  {plansLoading ? 'Saving…' : 'Save plan settings'}
                </button>
                {plansSaved && <span className="text-[11px] text-[#2a5c0a]">Saved</span>}
              </div>
            </div>
          )}
        </div>

        {/* Activity log section */}
        <div className="mt-4 pb-8">
          <button
            onClick={() => {
              const opening = !showAudit
              setShowAudit(opening)
              if (opening && !auditData && !auditLoading) loadAudit()
            }}
            className="text-[11px] text-[#666] hover:text-[#1a1a1a] transition-colors flex items-center gap-1"
          >
            {showAudit ? '▲' : '▼'} Activity log
          </button>
          {showAudit && (
            <div className="mt-3">
              {auditLoading && (
                <div className="text-[11px] text-[#aaa] text-center py-4">Loading…</div>
              )}
              {auditErr && (
                <div className="bg-[#fde4e4] text-[#8a1a1a] text-[11px] rounded-[8px] px-3 py-2">{auditErr}</div>
              )}
              {auditData && auditData.entries.length === 0 && (
                <div className="text-[11px] text-[#aaa] text-center py-4">No activity yet.</div>
              )}
              {auditData && auditData.entries.length > 0 && (
                <div className="space-y-1.5">
                  {auditData.entries.map(entry => {
                    const ACTION_LABEL: Record<string, string> = {
                      update_host:         'Updated host',
                      impersonate_view:    'Viewed as',
                      update_plans:        'Updated plans',
                      subscription_event:  'Stripe event',
                    }
                    const label    = ACTION_LABEL[entry.action] ?? entry.action
                    const hostName = entry.target_host_id
                      ? (auditData.hostNames[entry.target_host_id] ?? entry.target_host_id.slice(0, 8))
                      : '—'
                    const summary  = auditSummary(entry.action, entry.detail)
                    const ts       = new Date(entry.created_at)
                    const timeStr  = ts.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                    return (
                      <div key={entry.id} className="bg-white border border-[#ddd8ce] rounded-[9px] px-3 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <span className="text-[11px] font-medium text-[#1a1a1a]">{label}</span>
                            <span className="text-[10px] text-[#888] ml-1.5">{hostName}</span>
                            {summary && (
                              <div className="text-[10px] text-[#aaa] mt-0.5 truncate">{summary}</div>
                            )}
                          </div>
                          <div className="text-[10px] text-[#aaa] shrink-0 whitespace-nowrap">
                            {fmtDate(entry.created_at)} {timeStr}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
