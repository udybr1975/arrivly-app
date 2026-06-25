import { useEffect, useState, type ChangeEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { ARRIVLY_CONFIG } from '../../config'
import { useToast } from '../shared/Toast'
import Loader from '../shared/Loader'
import { resolveImageUrl, uploadImage, deleteImage } from '../../lib/imageUtils'

const DEFAULT_COLOR = '#1c1c1a'

export default function BrandingPanel() {
  const { toast } = useToast()
  const [hostId, setHostId] = useState<string | null>(null)
  const [brandName, setBrandName] = useState('')
  const [selectedColor, setSelectedColor] = useState(DEFAULT_COLOR)
  const [customHex, setCustomHex] = useState('')
  // Snapshot of the persisted values, used to disable Save when nothing changed.
  const [loadedBrandName, setLoadedBrandName] = useState('')
  const [loadedColor, setLoadedColor] = useState(DEFAULT_COLOR)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      setHostId(user.id)
      const { data: hostRow } = await supabase
        .from('hosts')
        .select('brand_name, logo_url, accent_color')
        .eq('id', user.id)
        .maybeSingle()
      if (hostRow) {
        const color = hostRow.accent_color ?? DEFAULT_COLOR
        setBrandName(hostRow.brand_name ?? '')
        setLoadedBrandName(hostRow.brand_name ?? '')
        setSelectedColor(color)
        setLoadedColor(color)
        if (hostRow.logo_url) setLogoUrl(hostRow.logo_url)
        const isPreset = ARRIVLY_CONFIG.colourPresets.some(p => p.hex === color)
        if (!isPreset) setCustomHex(color)
      }
      setLoading(false)
    }
    load()
  }, [])

  async function save() {
    if (!hostId) return
    const trimmed = brandName.trim()
    if (!trimmed) {
      toast("Brand name can't be empty.", 'error')
      return
    }
    setSaving(true)
    const { error } = await supabase
      .from('hosts')
      .update({ brand_name: trimmed, accent_color: selectedColor })
      .eq('id', hostId)
    if (error) {
      toast(error.message, 'error')
    } else {
      setBrandName(trimmed)
      setLoadedBrandName(trimmed)
      setLoadedColor(selectedColor)
      toast('Branding saved', 'success')
    }
    setSaving(false)
  }

  function applyCustomHex() {
    const hex = customHex.trim()
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) setSelectedColor(hex)
  }

  async function handleLogoFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !hostId) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { toast('Use a PNG, JPG or WebP image.', 'error'); return }
    if (file.size > 2 * 1024 * 1024) { toast('Logo must be under 2 MB.', 'error'); return }
    const previous = logoUrl
    setUploadingLogo(true)
    try {
      const path = await uploadImage(file, 'logo')
      const { error } = await supabase.from('hosts').update({ logo_url: path }).eq('id', hostId)
      if (error) throw error
      setLogoUrl(path)
      toast('Logo updated', 'success')
      if (previous && previous !== path) void deleteImage(previous)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Upload failed', 'error')
    } finally {
      setUploadingLogo(false)
    }
  }

  async function removeLogo() {
    if (!hostId) return
    const previous = logoUrl
    const { error } = await supabase.from('hosts').update({ logo_url: null }).eq('id', hostId)
    if (error) { toast(error.message, 'error'); return }
    setLogoUrl(null)
    toast('Logo removed', 'success')
    void deleteImage(previous)
  }

  if (loading) return <Loader />

  const LABEL = 'block text-[10px] font-medium uppercase tracking-[.12em] text-[#a79e8e] mb-1.5'
  const CARD = 'bg-[#fffdf9] border border-[#e4ddd0] rounded-[14px] p-5'
  const dirty = brandName.trim() !== loadedBrandName || selectedColor !== loadedColor
  const previewName = brandName.trim() || 'Your property'

  return (
    <div className="max-w-3xl font-['Inter']">
      <h1 className="text-[22px] font-['Fraunces'] font-light text-[#231d17] mb-1">Branding</h1>
      <p className="text-[13px] text-[#8a8276] mb-5">
        Your logo, name and default colour — applied across every guest page unless a property overrides it.
      </p>

      <div className="flex flex-col md:flex-row gap-5 items-start">
        {/* Left: controls */}
        <div className="flex-1 w-full space-y-4">
          {/* Logo */}
          <div className={CARD}>
            <label className={LABEL}>Logo</label>
            <div className="flex items-center gap-3.5 mt-1">
              <div className="w-16 h-16 rounded-[10px] border border-[#e4ddd0] bg-[#f0ede6] flex items-center justify-center overflow-hidden shrink-0">
                {logoUrl ? (
                  <img src={resolveImageUrl(logoUrl)} alt="Logo" className="w-full h-full object-contain" />
                ) : (
                  <span className="text-[9px] text-[#a79e8e] text-center px-1">No logo</span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="bg-transparent border border-[#e4ddd0] text-[#231d17] px-3.5 py-2 rounded-[9px] text-xs font-medium hover:bg-[#f0ede6] transition-colors cursor-pointer inline-block">
                  {uploadingLogo ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogoFile} disabled={uploadingLogo} />
                </label>
                {logoUrl && (
                  <button onClick={removeLogo} disabled={uploadingLogo} className="text-[11px] text-[#8a1a1a] hover:underline bg-transparent border-none cursor-pointer text-left disabled:opacity-40">Remove</button>
                )}
                <p className="text-[10.5px] text-[#8a8276]">PNG, JPG or WebP · under 2 MB · shown in your guest page header.</p>
              </div>
            </div>
          </div>

          {/* Brand name */}
          <div className={CARD}>
            <label className={LABEL} htmlFor="brand-name">Brand name</label>
            <input
              id="brand-name"
              value={brandName}
              onChange={e => setBrandName(e.target.value)}
              className="w-full bg-[#f0ede6] border border-[#e4ddd0] rounded-[9px] px-3.5 py-2.5 text-[13px] text-[#231d17] focus:outline-none focus:border-[#c8a24e] transition-colors"
              placeholder="Your property or business name"
              maxLength={80}
            />
            <p className="text-[10.5px] text-[#8a8276] mt-1.5">Signed at the bottom of every guest greeting.</p>
          </div>

          {/* Default colour */}
          <div className={CARD}>
            <label className={LABEL}>Default colour</label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {ARRIVLY_CONFIG.colourPresets.map(preset => {
                const active = selectedColor === preset.hex && !customHex
                return (
                  <button
                    key={preset.hex}
                    onClick={() => { setSelectedColor(preset.hex); setCustomHex('') }}
                    className={`flex items-center gap-2 rounded-[10px] p-2.5 border transition-colors text-left ${
                      active
                        ? 'border-[#c8a24e] bg-[rgba(200,162,78,0.08)] shadow-sm'
                        : 'border-[#e4ddd0] hover:border-[#a8842f]'
                    }`}
                  >
                    <div className="w-6 h-6 rounded-[6px] shrink-0" style={{ backgroundColor: preset.hex }} />
                    <span className="text-[11px] text-[#231d17]">{preset.name}</span>
                    {active && <span className="ml-auto text-[11px] text-[#a8842f]">✓</span>}
                  </button>
                )
              })}
            </div>

            {/* Custom hex */}
            <div className="mt-3.5">
              <label className={LABEL}>Custom hex</label>
              <div className="flex gap-2 items-center">
                <div className="w-8 h-8 rounded-[7px] border border-[#e4ddd0] shrink-0" style={{ backgroundColor: customHex || selectedColor }} />
                <input
                  value={customHex}
                  onChange={e => setCustomHex(e.target.value)}
                  onBlur={applyCustomHex}
                  className="flex-1 bg-[#f0ede6] border border-[#e4ddd0] rounded-[9px] px-3.5 py-2.5 text-xs text-[#231d17] font-mono focus:outline-none focus:border-[#c8a24e] transition-colors"
                  placeholder="#2c4a8a"
                  maxLength={7}
                />
                <button
                  onClick={applyCustomHex}
                  className="bg-transparent border border-[#e4ddd0] text-[#231d17] px-3.5 py-2.5 rounded-[9px] text-xs font-medium hover:bg-[#f0ede6] transition-colors"
                >
                  Apply
                </button>
              </div>
            </div>

            <p className="text-[10.5px] text-[#8a8276] mt-3">
              This is your account default. Any property can override it in its Look tab.
            </p>
          </div>

          <button
            onClick={save}
            disabled={saving || !dirty}
            className="bg-[#c8a24e] text-[#16100d] px-5 py-2.5 rounded-[10px] text-xs font-semibold hover:bg-[#a8842f] hover:text-white transition-colors disabled:opacity-40 disabled:hover:bg-[#c8a24e] disabled:hover:text-[#16100d]"
          >
            {saving ? 'Saving…' : 'Save branding'}
          </button>
        </div>

        {/* Right: phone preview */}
        <div className="shrink-0 mx-auto md:mx-0">
          <div className="text-[10px] font-medium uppercase tracking-[.12em] text-[#a79e8e] mb-2 text-center">Preview</div>
          <div
            className="relative rounded-[28px] overflow-hidden border-[3px]"
            style={{ width: 180, borderColor: '#2a2a2a' }}
          >
            {/* Status bar */}
            <div className="h-5 flex items-center justify-center" style={{ backgroundColor: selectedColor }}>
              <div className="w-10 h-1.5 bg-black/30 rounded-full" />
            </div>
            {/* Hero */}
            <div className="px-3 py-3" style={{ backgroundColor: selectedColor }}>
              {logoUrl && (
                <img src={resolveImageUrl(logoUrl)} alt="" className="h-5 mb-1.5 object-contain" />
              )}
              <div className="text-[10px] text-white/60 mb-0.5">Welcome</div>
              <div className="text-[14px] font-['Fraunces'] font-light text-white leading-tight">
                {previewName}
              </div>
            </div>
            {/* WiFi card */}
            <div className="bg-white px-3 py-2.5 border-b border-[#f0ede6]">
              <div className="text-[9px] uppercase tracking-[.06em] text-[#999] mb-0.5">WiFi</div>
              <div className="text-[10px] font-semibold text-[#1a1a1a]">SunnyBCN_WiFi</div>
              <div className="text-[10px] text-[#888]">SunnyBCN99!</div>
            </div>
            {/* Tabbar */}
            <div className="bg-white px-3 py-2 flex gap-2">
              {['Guide', 'Rules', 'Chat'].map((t, i) => (
                <div
                  key={t}
                  className={`text-[9px] px-2 py-0.5 rounded-full ${i === 0 ? 'text-white font-semibold' : 'text-[#888]'}`}
                  style={i === 0 ? { backgroundColor: selectedColor } : {}}
                >
                  {t}
                </div>
              ))}
            </div>
            {/* Share bar */}
            <div className="bg-[#f8f6f2] px-3 py-2 flex items-center gap-1.5">
              <div className="flex-1 h-4 bg-[#ede9e2] rounded-[3px]" />
              <div className="w-6 h-4 bg-[#ede9e2] rounded-[3px]" />
            </div>
            {/* Home bar */}
            <div className="bg-white h-4 flex items-center justify-center">
              <div className="w-8 h-1 bg-[#ddd] rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
