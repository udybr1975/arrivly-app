import { useEffect, useState, type ChangeEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { ARRIVLY_CONFIG } from '../../config'
import { useToast } from '../shared/Toast'
import Loader from '../shared/Loader'
import { resolveImageUrl, uploadImage } from '../../lib/imageUtils'

interface Apartment {
  id: string
  name: string
  accent_color: string | null
}

export default function BrandingPanel() {
  const { toast } = useToast()
  const [apt, setApt] = useState<Apartment | null>(null)
  const [hostId, setHostId] = useState<string | null>(null)
  const [selectedColor, setSelectedColor] = useState('#1c1c1a')
  const [customHex, setCustomHex] = useState('')
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
        .select('logo_url')
        .eq('id', user.id)
        .maybeSingle()
      if (hostRow?.logo_url) setLogoUrl(hostRow.logo_url)
      const { data } = await supabase
        .from('apartments')
        .select('id, name, accent_color')
        .eq('host_id', user.id)
        .order('created_at')
        .limit(1)
        .maybeSingle()
      if (data) {
        setApt(data)
        setSelectedColor(data.accent_color ?? '#1c1c1a')
        const isPreset = ARRIVLY_CONFIG.colourPresets.some(p => p.hex === (data.accent_color ?? '#1c1c1a'))
        if (!isPreset && data.accent_color) setCustomHex(data.accent_color)
      }
      setLoading(false)
    }
    load()
  }, [])

  async function save() {
    if (!apt || !hostId) {
      toast('Set up a property first before saving branding.', 'error')
      return
    }
    setSaving(true)
    const { error } = await supabase
      .from('apartments')
      .update({ accent_color: selectedColor })
      .eq('id', apt.id)
      .eq('host_id', hostId)
    if (error) toast(error.message, 'error')
    else { setApt(p => p ? { ...p, accent_color: selectedColor } : p); toast('Branding saved', 'success') }
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
    const mimeToExt: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
    if (!mimeToExt[file.type]) { toast('Use a PNG, JPG or WebP image.', 'error'); return }
    if (file.size > 2 * 1024 * 1024) { toast('Logo must be under 2 MB.', 'error'); return }
    setUploadingLogo(true)
    try {
      const ext = mimeToExt[file.type]
      const path = `${hostId}/logo-${Date.now()}.${ext}`
      await uploadImage(file, path)
      const { error } = await supabase.from('hosts').update({ logo_url: path }).eq('id', hostId)
      if (error) throw error
      setLogoUrl(path)
      toast('Logo updated', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Upload failed', 'error')
    } finally {
      setUploadingLogo(false)
    }
  }

  async function removeLogo() {
    if (!hostId) return
    const { error } = await supabase.from('hosts').update({ logo_url: null }).eq('id', hostId)
    if (error) { toast(error.message, 'error'); return }
    setLogoUrl(null)
    toast('Logo removed', 'success')
  }

  if (loading) return <Loader />

  const LABEL = 'block text-[10px] uppercase tracking-[.06em] text-[#999] mb-[3px]'

  return (
    <div className="max-w-2xl">
      <h1 className="text-[17px] font-serif font-light text-[#1a1a1a] mb-4">Branding</h1>

      <div className="flex gap-4 items-start">
        {/* Left: controls */}
        <div className="flex-1 space-y-4">
          <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4">
            <label className={LABEL}>Logo</label>
            <div className="flex items-center gap-3 mt-2">
              <div className="w-16 h-16 rounded-[8px] border border-[#ddd8ce] bg-[#f8f6f2] flex items-center justify-center overflow-hidden shrink-0">
                {logoUrl ? (
                  <img src={resolveImageUrl(logoUrl)} alt="Logo" className="w-full h-full object-contain" />
                ) : (
                  <span className="text-[9px] text-[#999] text-center px-1">No logo</span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="bg-transparent border border-[#ddd8ce] text-[#444] px-3 py-2 rounded-[7px] text-xs hover:bg-[#f0ede6] transition-colors cursor-pointer inline-block">
                  {uploadingLogo ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogoFile} disabled={uploadingLogo} />
                </label>
                {logoUrl && (
                  <button onClick={removeLogo} disabled={uploadingLogo} className="text-[11px] text-[#a33] hover:underline bg-transparent border-none cursor-pointer text-left disabled:opacity-40">Remove</button>
                )}
                <p className="text-[10px] text-[#999]">PNG, JPG or WebP · under 2 MB · shown in your guest page header.</p>
              </div>
            </div>
          </div>
          <div className="bg-white border border-[#ddd8ce] rounded-[10px] p-4">
            <label className={LABEL}>Brand colour</label>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {ARRIVLY_CONFIG.colourPresets.map(preset => (
                <button
                  key={preset.hex}
                  onClick={() => { setSelectedColor(preset.hex); setCustomHex('') }}
                  className={`flex items-center gap-2 rounded-[8px] p-2.5 border transition-colors text-left ${
                    selectedColor === preset.hex && !customHex
                      ? 'border-[#1a1a1a] shadow-sm'
                      : 'border-[#ddd8ce] hover:border-[#aaa]'
                  }`}
                >
                  <div
                    className="w-6 h-6 rounded-[5px] shrink-0"
                    style={{ backgroundColor: preset.hex }}
                  />
                  <span className="text-[11px] text-[#444]">{preset.name}</span>
                  {selectedColor === preset.hex && !customHex && (
                    <span className="ml-auto text-[10px] text-[#1a1a1a]">✓</span>
                  )}
                </button>
              ))}
            </div>

            {/* Custom hex */}
            <div className="mt-3">
              <label className={LABEL}>Custom hex</label>
              <div className="flex gap-2 items-center">
                <div className="w-8 h-8 rounded-[6px] border border-[#ddd8ce] shrink-0" style={{ backgroundColor: customHex || selectedColor }} />
                <input
                  value={customHex}
                  onChange={e => setCustomHex(e.target.value)}
                  onBlur={applyCustomHex}
                  className="flex-1 bg-[#f8f6f2] border border-[#ddd8ce] rounded-[8px] px-3 py-2 text-xs text-[#444] font-mono focus:outline-none focus:border-[#1a1a1a] transition-colors"
                  placeholder="#2c4a8a"
                  maxLength={7}
                />
                <button
                  onClick={applyCustomHex}
                  className="bg-transparent border border-[#ddd8ce] text-[#444] px-3 py-2 rounded-[7px] text-xs hover:bg-[#f0ede6] transition-colors"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={save}
            disabled={saving || selectedColor === apt?.accent_color}
            className="bg-[#1a1a1a] text-white px-4 py-2.5 rounded-[8px] text-xs font-semibold hover:opacity-80 transition-opacity disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save branding'}
          </button>
        </div>

        {/* Right: phone preview */}
        <div className="shrink-0">
          <div className="text-[10px] uppercase tracking-[.06em] text-[#999] mb-2 text-center">Preview</div>
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
              <div className="text-[10px] text-white/60 mb-0.5">Welcome</div>
              <div className="text-[14px] font-serif font-light text-white leading-tight">
                {apt?.name ?? 'Your property'}
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
