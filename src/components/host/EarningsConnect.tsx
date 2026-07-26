import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Check, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ARRIVLY_CONFIG } from '../../config'
import { useToast } from '../shared/Toast'
import {
  EXPERIENCE_PROVIDERS,
  normalizePartnerId,
  validatePartnerId,
  type ProviderKey,
  type ProviderMeta,
} from '../../lib/experienceProviders'
import Loader from '../shared/Loader'

// ── Phase H chrome tokens ────────────────────────────────────────────────────
const CARD = 'bg-[#fffdf9] border border-[#e4ddd0] rounded-[14px] p-5 mb-4'
const INPUT =
  'w-full bg-[#faf8f3] border border-[#e4ddd0] rounded-[9px] px-3 py-2 text-[13px] text-[#231d17] placeholder:text-[#b3aa9b] focus:outline-none focus:border-[#c8a24e] transition-colors'
const BTN_BRASS =
  'inline-flex items-center gap-1.5 bg-[#c8a24e] text-[#16100d] px-4 py-2 rounded-[10px] text-xs font-semibold hover:bg-[#e7d6ad] transition-colors disabled:opacity-40 disabled:hover:bg-[#c8a24e]'
const BTN_OUTLINE =
  'inline-flex items-center gap-1.5 bg-transparent border border-[#e4ddd0] text-[#231d17] px-4 py-2 rounded-[10px] text-xs font-semibold hover:bg-[#f0ede6] transition-colors disabled:opacity-40'
const BTN_LINK = 'text-[11px] font-medium text-[#a8842f] hover:text-[#c8a24e] transition-colors'

interface HostRow {
  tier: number | null
  viator_partner_id: string | null
  gyg_partner_id: string | null
  tiqets_partner_id: string | null
  ui_state: any
}

// hosts.ui_state.experiencesConnect[provider] = { appliedAt: ISO }
type AppliedState = Record<string, { appliedAt?: string }>

export default function EarningsConnect() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [host, setHost] = useState<HostRow | null>(null)
  const [applied, setApplied] = useState<AppliedState>({})
  const [searchParams] = useSearchParams()
  // ?provider=viator|gyg|tiqets deep-links from the Earnings panel's per-card Connect CTA.
  const requestedProvider = searchParams.get('provider')
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const scrolledRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { if (!cancelled) setLoading(false); return }
      const { data } = await supabase
        .from('hosts')
        .select('tier, viator_partner_id, gyg_partner_id, tiqets_partner_id, ui_state')
        .eq('id', user.id)
        .maybeSingle()
      if (cancelled) return
      setUserId(user.id)
      setHost(data as HostRow | null)
      const ui = (data as HostRow | null)?.ui_state
      const ec = ui && typeof ui === 'object' && ui.experiencesConnect && typeof ui.experiencesConnect === 'object'
        ? (ui.experiencesConnect as AppliedState)
        : {}
      setApplied(ec)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Scroll the deep-linked provider section into view ONCE, after content renders.
  // Invalid/absent param → no-op; guarded so it never re-fires.
  useEffect(() => {
    if (scrolledRef.current || loading) return
    if (requestedProvider !== 'viator' && requestedProvider !== 'gyg' && requestedProvider !== 'tiqets') return
    const el = sectionRefs.current[requestedProvider]
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    scrolledRef.current = true
  }, [loading, requestedProvider])

  // Read-modify-write ui_state, preserving sibling keys (e.g. guideHints). Best-effort.
  async function persistApplied(next: AppliedState) {
    if (!userId) return
    setApplied(next)
    try {
      const { data } = await supabase.from('hosts').select('ui_state').eq('id', userId).maybeSingle()
      const current = data?.ui_state && typeof data.ui_state === 'object' ? data.ui_state : {}
      await supabase.from('hosts').update({ ui_state: { ...current, experiencesConnect: next } }).eq('id', userId)
    } catch {
      /* swallow — application-progress is a convenience marker, not load-bearing */
    }
  }

  function markApplied(key: ProviderKey) {
    // No Date.now() concerns here — this is client UI state, not a workflow.
    persistApplied({ ...applied, [key]: { appliedAt: new Date().toISOString() } })
  }

  async function savePartnerId(meta: ProviderMeta, normalized: string): Promise<boolean> {
    if (!userId) return false
    const { error } = await supabase
      .from('hosts')
      .update({ [meta.column]: normalized })
      .eq('id', userId)
    if (error) {
      toast('Could not save — please try again.', 'error')
      return false
    }
    setHost(prev => (prev ? { ...prev, [meta.column]: normalized } as HostRow : prev))
    toast(`${meta.label} connected — new links take effect immediately.`, 'success')
    return true
  }

  async function disconnect(meta: ProviderMeta): Promise<void> {
    if (!userId) return
    const { error } = await supabase
      .from('hosts')
      .update({ [meta.column]: null })
      .eq('id', userId)
    if (error) {
      toast('Could not disconnect — please try again.', 'error')
      return
    }
    setHost(prev => (prev ? { ...prev, [meta.column]: null } as HostRow : prev))
    toast(`${meta.label} disconnected — pages revert to Bemgu's links.`, 'success')
  }

  if (loading) return <Loader />

  // Tier gate — T1/2 never see this page.
  const tier = host?.tier ?? 1
  if (tier < ARRIVLY_CONFIG.experiencesTierGate) {
    return <Navigate to="/dashboard/earnings" replace />
  }

  return (
    <div className="max-w-2xl font-['Inter']">
      <Link to="/dashboard/earnings" className="inline-flex items-center gap-1 text-[12px] text-[#8a8276] hover:text-[#231d17] transition-colors mb-3">
        <ArrowLeft size={14} /> Back to Earnings
      </Link>
      <h1 className="text-[22px] font-['Fraunces'] font-light text-[#231d17]">Connect your marketplaces</h1>
      <p className="text-[12px] text-[#8a8276] mt-1 mb-5 max-w-lg leading-relaxed">
        Connect your own Viator, GetYourGuide and Tiqets accounts and the marketplaces pay you directly. Until
        you connect one, your pages keep working on Bemgu's links — nothing breaks.
      </p>

      {EXPERIENCE_PROVIDERS.map(meta => (
        <div
          key={meta.key}
          id={`provider-${meta.key}`}
          ref={(el) => { sectionRefs.current[meta.key] = el }}
        >
          <ProviderSection
            meta={meta}
            connectedId={host?.[meta.column] ?? null}
            appliedAt={applied[meta.key]?.appliedAt ?? null}
            onMarkApplied={() => markApplied(meta.key)}
            onSave={(normalized) => savePartnerId(meta, normalized)}
            onDisconnect={() => disconnect(meta)}
          />
        </div>
      ))}

      {/* Reassurance footer */}
      <div className="bg-[#fbf7ee] border border-[#ecdfbe] rounded-[14px] p-4 flex items-start gap-2.5">
        <ShieldCheck size={16} className="text-[#a8842f] mt-0.5 shrink-0" />
        <p className="text-[11.5px] text-[#7d6a3f] leading-relaxed">
          Bemgu never handles your money. Commissions, payouts and tax are managed entirely inside each
          marketplace's own partner portal — connecting here only decides whose partner ID your guest links carry.
        </p>
      </div>
    </div>
  )
}

function ProviderSection({
  meta, connectedId, appliedAt, onMarkApplied, onSave, onDisconnect,
}: {
  meta: ProviderMeta
  connectedId: string | null
  appliedAt: string | null
  onMarkApplied: () => void
  onSave: (normalized: string) => Promise<boolean>
  onDisconnect: () => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const normalized = useMemo(() => normalizePartnerId(meta.key, value), [meta.key, value])
  // Live validation — only surface an error once the host has typed something.
  const validation = value.trim() ? validatePartnerId(meta.key, normalized) : null
  const hardBlocked = validation && !validation.ok && validation.hard
  const warnOnly = validation && !validation.ok && !validation.hard

  async function handleSave() {
    const v = validatePartnerId(meta.key, normalized)
    if (!v.ok && v.hard) return // hard-blocked: button is disabled anyway
    setSaving(true)
    const ok = await onSave(normalized)
    setSaving(false)
    if (ok) setValue('')
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    await onDisconnect()
    setDisconnecting(false)
    setConfirmDisconnect(false)
  }

  const appliedDate = appliedAt
    ? new Date(appliedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-2 mb-4">
        <span className="text-[15px] font-semibold text-[#231d17]">{meta.label}</span>
        {connectedId ? (
          <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[.06em] bg-[#e4f0da] text-[#2a5c0a] px-2 py-0.5 rounded-full">
            <Check size={11} /> Connected
          </span>
        ) : (
          <span className="text-[9.5px] font-semibold uppercase tracking-[.06em] bg-[#efece5] text-[#8a8276] px-2 py-0.5 rounded-full">
            Not connected
          </span>
        )}
      </div>

      {connectedId ? (
        // ── Connected state: show id + change/disconnect ──
        <div>
          <div className="flex items-center justify-between gap-3 bg-[#f6f3ec] border border-[#e4ddd0] rounded-[9px] px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[.08em] text-[#a79e8e]">Your partner ID</div>
              <div className="text-[13px] font-medium text-[#231d17] truncate">{connectedId}</div>
            </div>
            <a href={meta.portalUrl} target="_blank" rel="noopener noreferrer" className={`${BTN_LINK} inline-flex items-center gap-1 shrink-0`}>
              Open portal <ExternalLink size={11} />
            </a>
          </div>
          <p className="text-[11px] text-[#8a8276] mt-2.5">
            Your guest links now carry this ID and {meta.label} pays you directly.
          </p>
          {!confirmDisconnect ? (
            <button onClick={() => setConfirmDisconnect(true)} className="text-[11px] font-medium text-[#a23b32] hover:underline mt-3">
              Disconnect
            </button>
          ) : (
            <div className="mt-3 bg-[#fbf1ef] border border-[#e6c9c4] rounded-[9px] p-3">
              <p className="text-[11.5px] text-[#8a1a1a] leading-relaxed mb-2.5">
                Disconnect {meta.label}? Your pages will revert to Bemgu's links and the commission goes to Bemgu
                until you reconnect.
              </p>
              <div className="flex gap-2">
                <button onClick={handleDisconnect} disabled={disconnecting}
                  className="bg-[#8a1a1a] text-white px-3 py-1.5 rounded-[8px] text-[11px] font-semibold hover:bg-[#a02020] transition-colors disabled:opacity-50">
                  {disconnecting ? 'Disconnecting…' : 'Yes, disconnect'}
                </button>
                <button onClick={() => setConfirmDisconnect(false)} disabled={disconnecting} className={BTN_OUTLINE}>
                  Keep connected
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        // ── Not connected: guided checklist ──
        <div className="flex flex-col gap-4">
          {/* Step 1 — Apply */}
          <Step n={1} title="Apply to the affiliate programme">
            <p className="text-[11.5px] text-[#8a8276] leading-relaxed mb-2">
              Approval usually takes 2–5 business days. You can come back and finish this once you're approved.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <a href={meta.applyUrl} target="_blank" rel="noopener noreferrer" className={BTN_OUTLINE}>
                Apply on {meta.label} <ExternalLink size={12} />
              </a>
              {appliedDate ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-[#2a5c0a]">
                  <Check size={12} /> Marked applied · {appliedDate}
                </span>
              ) : (
                <button onClick={onMarkApplied} className={BTN_LINK}>Mark as applied</button>
              )}
            </div>
          </Step>

          {/* Step 2 — Find your ID */}
          <Step n={2} title="Find your partner ID">
            <p className="text-[11.5px] text-[#8a8276] leading-relaxed">{meta.findIdCopy}</p>
          </Step>

          {/* Step 3 — Paste & connect */}
          <Step n={3} title="Paste it here to connect">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={meta.placeholder}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className={INPUT}
              aria-invalid={!!hardBlocked}
            />
            {hardBlocked && <p className="text-[11px] text-[#8a1a1a] mt-1.5">{validation!.message}</p>}
            {warnOnly && <p className="text-[11px] text-[#8a5a14] mt-1.5">{validation!.message}</p>}
            <div className="mt-3">
              <button onClick={handleSave} disabled={saving || !value.trim() || !!hardBlocked} className={BTN_BRASS}>
                {saving ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </Step>
        </div>
      )}
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-6 h-6 rounded-full bg-[#f3ecdb] text-[#a8842f] text-[11px] font-semibold flex items-center justify-center">
        {n}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-[#231d17] mb-1.5">{title}</div>
        {children}
      </div>
    </div>
  )
}
