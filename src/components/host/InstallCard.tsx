import { useState } from 'react'
import { useInstallPrompt } from '../../lib/useInstallPrompt'

export default function InstallCard() {
  const { canInstall, isIOSSafari, standalone, install } = useInstallPrompt()
  const [copiedLink, setCopiedLink] = useState(false)
  const [busy, setBusy] = useState(false)
  // Hide the card after install() resolves so isStandalone() stale-snapshot
  // doesn't flip us into the wrong branch (standalone re-evaluates on next page load).
  const [done, setDone] = useState(false)

  if (standalone || done) return null

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
            onClick={async () => { setBusy(true); await install(); setDone(true) }}
            disabled={busy}
            className="bg-white text-[#1c1c1a] px-4 py-2 rounded-[8px] text-xs font-semibold hover:opacity-80 transition-opacity disabled:opacity-40"
          >
            {busy ? 'Installing…' : 'Install Arrivly'}
          </button>
        </>
      ) : (
        <>
          <div className="text-[15px] font-semibold text-white mb-1">Install Arrivly on this device</div>
          <p className="text-[12px] text-gray-400 leading-relaxed mb-4">
            For the best experience and reliable notifications, open this dashboard in Chrome, then use the browser menu to Install.
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
