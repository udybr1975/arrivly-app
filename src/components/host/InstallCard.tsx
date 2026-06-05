import { useState } from 'react'
import { useInstallPrompt } from '../../lib/useInstallPrompt'

export default function InstallCard() {
  const { canInstall, isIOSSafari, standalone, install, installed } = useInstallPrompt()
  const [copiedLink, setCopiedLink] = useState(false)
  const [busy, setBusy] = useState(false)

  if (standalone) return null

  return (
    <div className="bg-[#1c1c1a] rounded-[10px] p-5 mb-4">
      <div className="text-[11px] uppercase tracking-[.08em] text-gray-400 mb-3">Install</div>

      {isIOSSafari ? (
        <>
          <div className="text-[15px] font-semibold text-white mb-1">Install Arrivly on this device</div>
          <p className="text-[12px] text-gray-400 leading-relaxed">
            Tap the Share icon in Safari, then choose &lsquo;Add to Home Screen&rsquo;.
          </p>
        </>
      ) : canInstall ? (
        <>
          <div className="text-[15px] font-semibold text-white mb-1">Install Arrivly on this device</div>
          <p className="text-[12px] text-gray-400 leading-relaxed mb-4">
            Install it like an app — faster access and reliable notifications.
          </p>
          <button
            onClick={async () => { setBusy(true); await install(); setBusy(false) }}
            disabled={busy}
            className="bg-white text-[#1c1c1a] px-4 py-2 rounded-[8px] text-xs font-semibold hover:opacity-80 transition-opacity disabled:opacity-40"
          >
            {busy ? 'Installing…' : 'Install Arrivly'}
          </button>
        </>
      ) : installed ? (
        <>
          <div className="text-[15px] font-semibold text-white mb-1">Arrivly is installed on this device</div>
          <p className="text-[12px] text-gray-400 leading-relaxed">
            You're all set — open Arrivly from your home screen. You can turn on notifications below.
          </p>
        </>
      ) : (
        <>
          <div className="text-[15px] font-semibold text-white mb-1">Install Arrivly on this device</div>
          <p className="text-[12px] text-gray-400 leading-relaxed mb-4">
            For one-tap install, open this dashboard in Chrome or Edge, then use the browser menu → Install.
          </p>
          <button
            onClick={() => {
              navigator.clipboard.writeText(window.location.href).then(() => {
                setCopiedLink(true)
                setTimeout(() => setCopiedLink(false), 2000)
              }).catch(() => {})
            }}
            className="bg-white text-[#1c1c1a] px-4 py-2 rounded-[8px] text-xs font-semibold hover:opacity-80 transition-opacity"
          >
            {copiedLink ? 'Link copied ✓' : 'Copy link'}
          </button>
          <p className="text-[11px] text-gray-500 mt-2">In Firefox: tap the ⋮ menu, then &lsquo;Install&rsquo;.</p>
        </>
      )}
    </div>
  )
}
