import { useEffect, useRef, useState } from 'react'
import { MapPin, Download, Printer, Copy, Check } from 'lucide-react'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import { ARRIVLY_CONFIG } from '../../config'
import Loader from '../shared/Loader'

interface ApartmentQR {
  id: string
  name: string
  neighborhood: string | null
  qr_secret: string | null
}

function guestUrl(aptId: string, secret: string | null) {
  // Keyed URL unlocks the tokenless date-lookup in /api/guest-state. If the
  // secret is missing, fall back to the keyless URL so the card still renders.
  return secret
    ? `${ARRIVLY_CONFIG.appUrl}/guest?apt=${aptId}&key=${secret}`
    : `${ARRIVLY_CONFIG.appUrl}/guest?apt=${aptId}`
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'qr'
}

function PropertyQRCard({ apt }: { apt: ApartmentQR }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [copied, setCopied] = useState(false)
  const url = guestUrl(apt.id, apt.qr_secret)

  useEffect(() => {
    if (!canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, url, {
      width: 180,
      margin: 2,
      color: { dark: '#1a1a1a', light: '#ffffff' },
    })
  }, [url])

  // Reset the "copied" tick after a moment.
  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(t)
  }, [copied])

  function download() {
    if (!canvasRef.current) return
    const link = document.createElement('a')
    link.download = `arrivly-qr-${slugify(apt.name)}.png`
    link.href = canvasRef.current.toDataURL('image/png')
    link.click()
  }

  function printCard() {
    if (!canvasRef.current) return
    const w = window.open('', '_blank')
    if (!w) return
    const img = canvasRef.current.toDataURL('image/png')
    w.document.write(`<html><body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;"><img src="${img}" style="width:300px"/><p style="font-family:monospace;font-size:11px;text-align:center">${url}</p></body></html>`)
    w.document.close()
    w.print()
  }

  function copyUrl() {
    navigator.clipboard?.writeText(url).then(() => setCopied(true)).catch(() => {})
  }

  return (
    <div className="flex flex-col items-center bg-[#fffdf9] border border-[#e4ddd0] rounded-[14px] p-5 text-center">
      <div className="rounded-[12px] border border-[#e4ddd0] bg-white p-3">
        <canvas ref={canvasRef} aria-label={`QR code for ${apt.name}`} style={{ width: 148, height: 148 }} />
      </div>

      <div className="mt-4 text-[14px] font-semibold text-[#231d17] truncate max-w-full">{apt.name}</div>
      {apt.neighborhood && (
        <div className="mt-0.5 flex items-center gap-1 text-[12px] text-[#8a8276]">
          <MapPin size={12} className="shrink-0" />
          <span className="truncate">{apt.neighborhood}</span>
        </div>
      )}

      {/* URL row + copy */}
      <div className="mt-3.5 flex w-full items-center gap-2 rounded-[9px] border border-[#e4ddd0] bg-[#f7f3ec] px-2.5 py-2">
        <span className="flex-1 min-w-0 truncate text-left text-[11px] font-mono text-[#6b6354]">{url}</span>
        <button
          type="button"
          onClick={copyUrl}
          aria-label={copied ? 'Copied' : 'Copy guest page URL'}
          className="shrink-0 text-[#8a8276] hover:text-[#231d17] transition-colors"
        >
          {copied ? <Check size={15} className="text-[#5d7c34]" /> : <Copy size={15} />}
        </button>
      </div>

      {/* actions */}
      <div className="mt-4 flex w-full gap-2">
        <button
          onClick={download}
          className="flex-1 inline-flex items-center justify-center gap-1.5 bg-[#c8a24e] text-[#16100d] px-3 py-2 rounded-[9px] text-[12.5px] font-semibold hover:bg-[#e7d6ad] transition-colors"
        >
          <Download size={14} /> Download
        </button>
        <button
          onClick={printCard}
          className="flex-1 inline-flex items-center justify-center gap-1.5 border border-[#e4ddd0] text-[#6b6354] px-3 py-2 rounded-[9px] text-[12.5px] hover:bg-[#f0ede6] transition-colors"
        >
          <Printer size={14} /> Print
        </button>
      </div>
    </div>
  )
}

type RawApt = {
  id: string
  name: string
  neighborhood: string | null
}

export default function QRCodePanel() {
  const [apts, setApts] = useState<ApartmentQR[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const { data } = await supabase
        .from('apartments')
        .select('id, name, neighborhood')
        .eq('host_id', user.id)
        .order('created_at')
      const mapped: ApartmentQR[] = ((data ?? []) as RawApt[]).map(a => ({
        id: a.id,
        name: a.name,
        neighborhood: a.neighborhood,
        qr_secret: null,
      }))

      // Fetch per-apartment QR secrets (host-authenticated, own apartments only)
      // and merge each onto its apartment. Best-effort: if it fails, cards render
      // with the keyless fallback URL rather than crashing.
      try {
        const { secrets } = await api.post<{ secrets: Record<string, string> }>('/qr-secrets', {})
        for (const a of mapped) a.qr_secret = secrets[a.id] ?? null
      } catch { /* keep keyless fallback URLs */ }

      setApts(mapped)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <Loader />

  return (
    <div className="font-['Inter'] max-w-5xl">
      <header className="mb-7">
        <h1 className="text-[25px] font-['Fraunces'] font-light text-[#231d17]">QR codes</h1>
        <p className="text-[13px] text-[#8a8276] mt-1">
          One code per property. Print it, stick it up — every scan opens that guest page.
        </p>
      </header>

      {apts.length === 0 ? (
        <div className="text-center py-16 text-[#b3aa9b] text-[13px]">No properties yet.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {apts.map(apt => (
            <PropertyQRCard key={apt.id} apt={apt} />
          ))}
        </div>
      )}
    </div>
  )
}
