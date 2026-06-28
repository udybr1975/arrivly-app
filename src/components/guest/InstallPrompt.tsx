import { useEffect, useRef, useState } from 'react'
import { Download, Share } from 'lucide-react'
import { useInstallPrompt } from '../../lib/useInstallPrompt'

interface Props {
  accentColor: string
}

const DISMISSED_KEY = 'arrivly_install_dismissed'

export default function InstallPrompt({ accentColor }: Props) {
  const [visible, setVisible] = useState(false)
  const { canInstall, isIOSSafari, standalone, install } = useInstallPrompt()
  // Mirror canInstall to a ref so the 15s timer reads the current value at fire time
  // rather than the stale value captured when the effect ran.
  const canInstallRef = useRef(false)
  useEffect(() => { canInstallRef.current = canInstall }, [canInstall])

  useEffect(() => {
    if (standalone) return
    if (localStorage.getItem(DISMISSED_KEY) === '1') return

    const timer = setTimeout(() => {
      if (canInstallRef.current || isIOSSafari) setVisible(true)
    }, 15000)

    return () => clearTimeout(timer)
  }, [standalone, isIOSSafari])

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, '1')
    setVisible(false)
  }

  async function handleInstall() {
    await install()
    dismiss()
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-16 left-4 right-4 z-[35] bg-[#fffdf9] border border-[#e9e4d9] rounded-2xl p-4 shadow-lg">
      {isIOSSafari ? (
        <>
          <div className="flex items-start gap-3 mb-3">
            <Share size={18} className="shrink-0 mt-0.5" style={{ color: accentColor }} />
            <div>
              <p className="text-[13px] font-semibold text-[#1c1c1a] mb-0.5">
                Add this guide to your home screen
              </p>
              <p className="text-[11px] text-[#5b5853] leading-relaxed">
                Tap the Share icon below, then choose &ldquo;Add to Home Screen&rdquo;.
              </p>
            </div>
          </div>
          <button
            onClick={dismiss}
            className="text-[11px] text-[#9a958c] hover:text-[#1c1c1a] transition-colors"
          >
            Not now
          </button>
        </>
      ) : (
        <>
          <div className="flex items-start gap-3 mb-3">
            <Download size={18} className="shrink-0 mt-0.5" style={{ color: accentColor }} />
            <div>
              <p className="text-[13px] font-semibold text-[#1c1c1a] mb-0.5">
                Add this guide to your home screen
              </p>
              <p className="text-[11px] text-[#5b5853] leading-relaxed">
                One tap — open it like an app, even offline.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleInstall}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white hover:opacity-80 transition-opacity"
              style={{ backgroundColor: accentColor }}
            >
              Add to home screen
            </button>
            <button
              onClick={dismiss}
              className="px-4 py-1.5 rounded-lg text-xs text-[#9a958c] hover:text-[#1c1c1a] transition-colors"
            >
              Not now
            </button>
          </div>
        </>
      )}
    </div>
  )
}
