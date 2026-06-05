import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'

interface S1 { brandName: string; whatsapp: string; logoFileName: string }
interface S2 { country: string; city: string; neighborhood: string; street: string; streetNumber: string }

const INPUT = 'w-full bg-[#f8f6f2] border border-[#ddd8ce] rounded-[8px] px-3 py-2 text-xs text-[#444] focus:outline-none focus:border-[#1a1a1a] transition-colors'
const INPUT_RO = 'w-full bg-[#ede9e2] border border-[#ddd8ce] rounded-[8px] px-3 py-2 text-xs text-[#888] cursor-not-allowed'
const LABEL = 'block text-[10px] uppercase tracking-[.06em] text-[#999] mb-[3px]'
const BTN_DARK = 'bg-[#1a1a1a] text-white px-4 py-2.5 rounded-[8px] text-xs font-semibold hover:opacity-80 transition-opacity disabled:opacity-40'
const BTN_OUT = 'bg-transparent border border-[#ddd8ce] text-[#444] px-4 py-2.5 rounded-[8px] text-xs hover:bg-[#f0ede6] transition-colors'

const s2ok = (s: S2) =>
  s.country.trim() && s.city.trim() && s.neighborhood.trim() && s.street.trim() && s.streetNumber.trim()

export default function OnboardingFlow() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [s1, setS1] = useState<S1>({ brandName: '', whatsapp: '', logoFileName: '' })
  const [s2, setS2] = useState<S2>({ country: '', city: '', neighborhood: '', street: '', streetNumber: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setFirstName(user.user_metadata?.first_name ?? '')
        setEmail(user.email ?? '')
      }
    })
  }, [])

  async function finish() {
    setSaving(true)
    setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not logged in')

      const { error: hostErr } = await supabase
        .from('hosts')
        .upsert({
          id: user.id,
          name: firstName,
          brand_name: s1.brandName,
          whatsapp: s1.whatsapp || null,
          contact_email: user.email,
          country: s2.country,
          city: s2.city,
          neighborhood: s2.neighborhood,
          street: s2.street,
          street_number: s2.streetNumber,
        })
      if (hostErr) throw hostErr

      void api.post('/api/send-welcome', {}).catch(() => {})

      const { data: existing } = await supabase
        .from('apartments')
        .select('id')
        .eq('host_id', user.id)
        .limit(1)
        .maybeSingle()

      let newAptId: string | null = null
      if (!existing) {
        const { data: newApt, error: aptErr } = await supabase.from('apartments').insert({
          host_id: user.id,
          name: s1.brandName,
          country: s2.country,
          city: s2.city,
          neighborhood: s2.neighborhood,
          street: s2.street,
          street_number: s2.streetNumber,
          is_visible: false,
        }).select('id').maybeSingle()
        if (aptErr) throw aptErr
        newAptId = newApt?.id ?? null
      }

      navigate(newAptId ? `/dashboard/property/${newAptId}` : '/dashboard')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f0ede6] flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white border border-[#ddd8ce] rounded-[12px] p-[22px_28px]">
        {/* Progress bar */}
        <div className="h-1 bg-[#ede9e2] rounded-full overflow-hidden mb-[14px]">
          <div
            className="h-full bg-[#1a1a1a] rounded-full transition-all duration-300"
            style={{ width: `${(step / 3) * 100}%` }}
          />
        </div>

        {/* ── Step 1 ── */}
        {step === 1 && (
          <div>
            <p className="text-[15px] font-serif font-light text-[#1a1a1a] mb-0.5">Step 1 of 3 — Your brand</p>
            <p className="text-[11px] text-[#888] mb-4">What guests will see when they scan your QR code.</p>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className={LABEL}>Your first name</label>
                <input value={firstName} readOnly className={INPUT_RO} />
              </div>
              <div>
                <label className={LABEL}>Brand name <span className="text-red-500 normal-case">*</span></label>
                <input
                  value={s1.brandName}
                  onChange={e => setS1(p => ({ ...p, brandName: e.target.value }))}
                  className={INPUT}
                  placeholder="Marco's Barcelona Stays"
                  required
                />
              </div>
              <div>
                <label className={LABEL}>Contact email</label>
                <input value={email} readOnly className={INPUT_RO} />
              </div>
              <div>
                <label className={LABEL}>WhatsApp (optional)</label>
                <input
                  type="tel"
                  value={s1.whatsapp}
                  onChange={e => setS1(p => ({ ...p, whatsapp: e.target.value }))}
                  className={INPUT}
                  placeholder="+34 612 345 678"
                />
              </div>
            </div>

            <label className={LABEL}>Logo (optional)</label>
            <div className="flex items-center gap-3 mb-4">
              <label className="w-14 h-14 rounded-[10px] border border-dashed border-[#ccc] flex items-center justify-center bg-[#f8f6f2] cursor-pointer text-xl text-[#aaa] hover:bg-[#ede9e2] transition-colors shrink-0">
                {s1.logoFileName ? <span className="text-[#2a5c0a] text-base">✓</span> : '+'}
                <input
                  type="file"
                  accept=".png,.svg,image/png,image/svg+xml"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file && file.size <= 2 * 1024 * 1024) setS1(p => ({ ...p, logoFileName: file.name }))
                  }}
                />
              </label>
              <div className="text-[11px] text-[#888] leading-[1.6]">
                Upload PNG or SVG.<br />
                {s1.logoFileName
                  ? <span className="text-[#2a5c0a]">{s1.logoFileName}</span>
                  : 'Shown in guest page header alongside your brand name.'}
              </div>
            </div>

            <div className="flex justify-end">
              <button onClick={() => s1.brandName.trim() && setStep(2)} disabled={!s1.brandName.trim()} className={BTN_DARK}>
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2 ── */}
        {step === 2 && (
          <div>
            <p className="text-[15px] font-serif font-light text-[#1a1a1a] mb-0.5">Step 2 of 3 — Your location</p>
            <p className="text-[11px] text-[#888] mb-3.5">Full address gives Gemini the context for a hyper-local guest guide. Never shown to guests.</p>

            <div className="grid grid-cols-2 gap-2 mb-2.5">
              <div>
                <label className={LABEL}>Country</label>
                <input value={s2.country} onChange={e => setS2(p => ({ ...p, country: e.target.value }))} className={INPUT} placeholder="Spain" />
              </div>
              <div>
                <label className={LABEL}>City</label>
                <input value={s2.city} onChange={e => setS2(p => ({ ...p, city: e.target.value }))} className={INPUT} placeholder="Barcelona" />
              </div>
              <div className="col-span-2">
                <label className={LABEL}>Neighbourhood</label>
                <input value={s2.neighborhood} onChange={e => setS2(p => ({ ...p, neighborhood: e.target.value }))} className={INPUT} placeholder="El Born" />
              </div>
              <div>
                <label className={LABEL}>Street name</label>
                <input value={s2.street} onChange={e => setS2(p => ({ ...p, street: e.target.value }))} className={INPUT} placeholder="Carrer del Rec" />
              </div>
              <div>
                <label className={LABEL}>Street number</label>
                <input value={s2.streetNumber} onChange={e => setS2(p => ({ ...p, streetNumber: e.target.value }))} className={INPUT} placeholder="42" />
              </div>
            </div>

            <div className="bg-[#dceef8] rounded-[7px] px-3 py-2.5 text-[11px] text-[#0c3d70] leading-[1.6] mb-4">
              Full address = hyper-local Gemini guide. "Tapas bars on Carrer del Rec, El Born" beats "restaurants in Barcelona" every time.
            </div>

            <div className="flex justify-between">
              <button onClick={() => setStep(1)} className={BTN_OUT}>← Back</button>
              <button onClick={() => s2ok(s2) && setStep(3)} disabled={!s2ok(s2)} className={BTN_DARK}>Continue →</button>
            </div>
          </div>
        )}

        {/* ── Step 3 ── */}
        {step === 3 && (
          <div>
            <p className="text-[15px] font-serif font-light text-[#1a1a1a] mb-0.5">Step 3 of 3 — Preview</p>
            <p className="text-[11px] text-[#888] mb-3.5">This is what your guests will see. Customise colours in Branding after setup.</p>

            <div className="bg-[#f8f6f2] rounded-[10px] p-3.5 mb-4 border border-[#ddd8ce]">
              <div className="text-[10px] text-[#aaa] uppercase tracking-[.07em] mb-1.5">Guest page preview</div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-[6px] bg-[#1c1c1a] flex items-center justify-center text-[11px] text-white font-semibold shrink-0">
                  {(s1.brandName.trim().charAt(0) || 'A').toUpperCase()}
                </div>
                <div className="text-[13px] font-semibold text-[#1a1a1a]">{s1.brandName || 'Your brand'}</div>
              </div>
              <div className="text-[13px] text-[#555] italic leading-relaxed font-serif">
                "Welcome to {s2.neighborhood || 'your city'}, dear guest."
              </div>
              <div className="text-[11px] text-[#aaa] mt-1.5">WiFi, house rules, city guide and chatbot appear once you add your property.</div>
            </div>

            {error && (
              <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">{error}</p>
            )}

            <div className="flex justify-between">
              <button onClick={() => setStep(2)} className={BTN_OUT}>← Back</button>
              <button onClick={finish} disabled={saving} className={BTN_DARK}>
                {saving ? 'Setting up…' : 'Add my first property →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
