import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { ARRIVLY_CONFIG } from '../../config'

interface S1 {
  brandName: string
  whatsapp: string
  logoFileName: string
}

interface S2 {
  country: string
  city: string
  neighborhood: string
  street: string
  streetNumber: string
}

const INPUT = 'w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-white/50 transition-colors'

const s2Required = (s: S2) =>
  s.country.trim() && s.city.trim() && s.neighborhood.trim() && s.street.trim() && s.streetNumber.trim()

export default function OnboardingFlow() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [firstName, setFirstName] = useState('')
  const [s1, setS1] = useState<S1>({ brandName: '', whatsapp: '', logoFileName: '' })
  const [s2, setS2] = useState<S2>({ country: '', city: '', neighborhood: '', street: '', streetNumber: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setFirstName(user.user_metadata?.first_name ?? '')
    })
  }, [])

  async function finish() {
    setSaving(true)
    setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not logged in')

      const { error: updateErr } = await supabase
        .from('hosts')
        .update({
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
        .eq('id', user.id)

      if (updateErr) throw updateErr

      navigate('/dashboard/property')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setSaving(false)
    }
  }

  const accent = ARRIVLY_CONFIG.colourPresets[0].hex

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1c1c1a] text-white p-4">
      <div className="w-full max-w-lg">
        {/* Progress bar */}
        <div className="flex gap-1.5 mb-10">
          {[1, 2, 3].map(n => (
            <div
              key={n}
              className={`h-1 flex-1 rounded-full transition-colors ${n <= step ? 'bg-white' : 'bg-white/20'}`}
            />
          ))}
        </div>

        {/* ── Step 1: Brand ── */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              {firstName && (
                <p className="text-gray-400 text-sm mb-2">Welcome, {firstName}</p>
              )}
              <p className="text-xs text-gray-500 mb-1">Step 1 of 3</p>
              <h2 className="text-2xl font-bold">Your brand</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1.5">
                  Brand name <span className="text-red-400">*</span>
                </label>
                <input
                  value={s1.brandName}
                  onChange={e => setS1(p => ({ ...p, brandName: e.target.value }))}
                  className={INPUT}
                  placeholder="Marco's Barcelona Stays"
                  required
                />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1.5">
                  WhatsApp <span className="text-gray-500 font-normal">(optional)</span>
                </label>
                <input
                  type="tel"
                  value={s1.whatsapp}
                  onChange={e => setS1(p => ({ ...p, whatsapp: e.target.value }))}
                  className={INPUT}
                  placeholder="+358 44 123 4567"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1.5">
                  Logo <span className="text-gray-500 font-normal">(optional · PNG or SVG · max 2 MB)</span>
                </label>
                <input
                  type="file"
                  accept=".png,.svg,image/png,image/svg+xml"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file && file.size <= 2 * 1024 * 1024) {
                      setS1(p => ({ ...p, logoFileName: file.name }))
                    }
                  }}
                  className="w-full text-sm text-gray-400 cursor-pointer file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-white/10 file:text-white file:text-sm file:cursor-pointer hover:file:bg-white/20 transition-colors"
                />
                {s1.logoFileName && (
                  <p className="text-xs text-gray-500 mt-1">{s1.logoFileName}</p>
                )}
              </div>
            </div>

            <button
              onClick={() => s1.brandName.trim() && setStep(2)}
              disabled={!s1.brandName.trim()}
              className="w-full bg-white text-[#1c1c1a] py-2.5 rounded-lg font-semibold hover:bg-gray-100 transition-colors disabled:opacity-40"
            >
              Continue
            </button>
          </div>
        )}

        {/* ── Step 2: Location ── */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <p className="text-xs text-gray-500 mb-1">Step 2 of 3</p>
              <h2 className="text-2xl font-bold">Your location</h2>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">
                    Country <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={s2.country}
                    onChange={e => setS2(p => ({ ...p, country: e.target.value }))}
                    className={INPUT}
                    placeholder="Spain"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">
                    City <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={s2.city}
                    onChange={e => setS2(p => ({ ...p, city: e.target.value }))}
                    className={INPUT}
                    placeholder="Barcelona"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1.5">
                  Neighbourhood <span className="text-red-400">*</span>
                </label>
                <input
                  value={s2.neighborhood}
                  onChange={e => setS2(p => ({ ...p, neighborhood: e.target.value }))}
                  className={INPUT}
                  placeholder="Eixample"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">
                    Street name <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={s2.street}
                    onChange={e => setS2(p => ({ ...p, street: e.target.value }))}
                    className={INPUT}
                    placeholder="Carrer de Mallorca"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">
                    Number <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={s2.streetNumber}
                    onChange={e => setS2(p => ({ ...p, streetNumber: e.target.value }))}
                    className={INPUT}
                    placeholder="218"
                    required
                  />
                </div>
              </div>

              <p className="text-xs text-gray-500">
                Your address is used for the AI neighbourhood guide. It is never shown to guests.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="flex-1 border border-white/20 py-2.5 rounded-lg font-semibold hover:bg-white/5 transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => s2Required(s2) && setStep(3)}
                disabled={!s2Required(s2)}
                className="flex-1 bg-white text-[#1c1c1a] py-2.5 rounded-lg font-semibold hover:bg-gray-100 transition-colors disabled:opacity-40"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Preview ── */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <p className="text-xs text-gray-500 mb-1">Step 3 of 3</p>
              <h2 className="text-2xl font-bold">Preview</h2>
            </div>

            {/* Branded preview card */}
            <div className="rounded-2xl p-6" style={{ backgroundColor: accent }}>
              <p className="text-white font-bold text-xl mb-1">{s1.brandName}</p>
              <p className="text-white/60 text-sm mb-4">
                {s2.neighborhood}, {s2.city}
              </p>
              <div className="border-t border-white/10 pt-4">
                <p className="text-white/50 text-xs">Your guest page is ready to personalise</p>
              </div>
            </div>

            {error && (
              <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setStep(2)}
                className="flex-1 border border-white/20 py-2.5 rounded-lg font-semibold hover:bg-white/5 transition-colors"
              >
                Back
              </button>
              <button
                onClick={finish}
                disabled={saving}
                className="flex-1 bg-white text-[#1c1c1a] py-2.5 rounded-lg font-semibold hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                {saving ? 'Setting up…' : 'Add my first property →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
