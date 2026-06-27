import { useState } from 'react'
import { useInstallPrompt } from '../../lib/useInstallPrompt'

export default function InstallCard() {
  const { canInstall, isIOSSafari, isChromium, standalone, install, installed } = useInstallPrompt()
  const [copiedLink, setCopiedLink] = useState(false)
  const [busy, setBusy] = useState(false)

  if (standalone) return null

  return (
    <div className="bg-[#fffdf9] border border-[#e4ddd0] rounded-[14px] p-5 mb-4">
      <div className="text-[10px] font-medium uppercase tracking-[.12em] text-[#a79e8e] mb-3">This device</div>

      {isIOSSafari ? (
        <>
          <div className="text-[14px] font-semibold text-[#231d17] mb-1">Install Arrivly on this device</div>
          <p className="text-[12px] text-[#8a8276] leading-relaxed">
            Tap the Share icon in Safari, then choose &lsquo;Add to Home Screen&rsquo;.
          </p>
        </>
      ) : canInstall ? (
        <>
          <div className="text-[14px] font-semibold text-[#231d17] mb-1">Install Arrivly on this device</div>
          <p className="text-[12px] text-[#8a8276] leading-relaxed mb-4">
            Install it like an app — faster access and reliable notifications.
          </p>
          <button
            onClick={async () => { setBusy(true); await install(); setBusy(false) }}
            disabled={busy}
            className="bg-[#c8a24e] text-[#16100d] px-4 py-2 rounded-[10px] text-xs font-semibold hover:bg-[#e7d6ad] transition-colors disabled:opacity-40"
          >
            {busy ? 'Installing…' : 'Install Arrivly'}
          </button>
        </>
      ) : installed ? (
        <>
          <div className="text-[14px] font-semibold text-[#231d17] mb-1">Arrivly is installed on this device</div>
          <p className="text-[12px] text-[#8a8276] leading-relaxed">
            You&rsquo;re all set — open Arrivly from your home screen. You can turn on notifications below.
          </p>
        </>
      ) : isChromium ? (
        <>
          <div className="text-[14px] font-semibold text-[#231d17] mb-1">Install Arrivly on this device</div>
          <p className="text-[12px] text-[#8a8276] leading-relaxed mb-4">
            If you don&rsquo;t see an install prompt here, open the browser menu (&lsquo;⋮&rsquo;, top-right) and
            choose &lsquo;Add to Home screen&rsquo; or &lsquo;Install app&rsquo;. That installs Arrivly the same way.
          </p>
          <button
            onClick={() => {
              navigator.clipboard.writeText(window.location.href).then(() => {
                setCopiedLink(true)
                setTimeout(() => setCopiedLink(false), 2000)
              }).catch(() => {})
            }}
            className="bg-[#c8a24e] text-[#16100d] px-4 py-2 rounded-[10px] text-xs font-semibold hover:bg-[#e7d6ad] transition-colors disabled:opacity-40"
          >
            {copiedLink ? 'Link copied ✓' : 'Copy link'}
          </button>
          <p className="text-[11px] text-[#a79e8e] mt-2">Copying the link lets you install on another device.</p>
        </>
      ) : (
        <>
          <div className="text-[14px] font-semibold text-[#231d17] mb-1">Install Arrivly on this device</div>
          <p className="text-[12px] text-[#8a8276] leading-relaxed mb-4">
            For one-tap install, open this dashboard in Chrome or Edge, then use the browser menu → Install.
          </p>
          <button
            onClick={() => {
              navigator.clipboard.writeText(window.location.href).then(() => {
                setCopiedLink(true)
                setTimeout(() => setCopiedLink(false), 2000)
              }).catch(() => {})
            }}
            className="bg-[#c8a24e] text-[#16100d] px-4 py-2 rounded-[10px] text-xs font-semibold hover:bg-[#e7d6ad] transition-colors disabled:opacity-40"
          >
            {copiedLink ? 'Link copied ✓' : 'Copy link'}
          </button>
          <p className="text-[11px] text-[#a79e8e] mt-2">In Firefox: tap the ⋮ menu, then &lsquo;Install&rsquo;.</p>
        </>
      )}
    </div>
  )
}
