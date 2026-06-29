import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { ExternalLink, Smartphone } from 'lucide-react'

// Demo "Be your guest" spotlight — the signature moment: the host opens / scans the
// SAME live guest page their seeded guest sees. `url` is the token guest URL (built by
// the caller with the same shape QRCodePanel/BookingManager use). Reuses the existing
// `qrcode` generator. Presentational only.
export default function BeYourGuestCard({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, url, {
      width: 156,
      margin: 2,
      color: { dark: '#1a1a1a', light: '#ffffff' },
    }).catch(() => { /* render failure is non-fatal — the Open link still works */ })
  }, [url])

  return (
    <div className="rounded-[16px] border border-[#e4ddd0] bg-gradient-to-br from-[#fffdf9] to-[#fbf6ea] p-5 sm:p-6">
      <div className="text-[10.5px] font-semibold uppercase tracking-[.1em] text-[#a8842f]">Be your guest</div>
      <h2 className="mt-1 font-['Fraunces'] font-light text-[20px] text-[#231d17]">See exactly what your guest sees</h2>
      <p className="mt-1 text-[12.5px] leading-[1.5] text-[#6b6354]">
        This is your live guest page, with a sample stay already checked in — open it, or scan it with your phone.
      </p>

      <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-5">
        <div className="flex shrink-0 flex-col items-center gap-2">
          <div className="rounded-[12px] border border-[#e4ddd0] bg-white p-3">
            <canvas ref={canvasRef} aria-label="QR code for your demo guest page" style={{ width: 132, height: 132 }} />
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] text-[#8a8276]">
            <Smartphone size={12} className="shrink-0" />
            Scan with your phone
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-[#c8a24e] text-[#16100d] px-4 py-2.5 rounded-[10px] text-[13px] font-semibold hover:bg-[#e7d6ad] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffdf9]"
          >
            Open my guest page
            <ExternalLink size={15} />
          </a>
          <p className="mt-3 text-[11.5px] leading-[1.5] text-[#b3aa9b]">
            Everything you add in the editor — WiFi, check-in, your picks — appears here instantly.
          </p>
        </div>
      </div>
    </div>
  )
}
