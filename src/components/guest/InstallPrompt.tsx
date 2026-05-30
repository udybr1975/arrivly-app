import { useEffect, useRef, useState } from 'react'
import { Download, Share } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface Props {
  accentColor: string
}

const DISMISSED_KEY = 'arrivly_install_dismissed'

export default function InstallPrompt({ accentColor }: Props) {
  const [visible, setVisible] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true
    ) return

    if (localStorage.getItem(DISMISSED_KEY) === '1') return

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const iosSafari = ios && !/crios|fxios/i.test(navigator.userAgent)
    setIsIOS(iosSafari)

    const handlePrompt = (e: Event) => {
      e.preventDefault()
      deferredPrompt.current = e as BeforeInstallPromptEvent
    }
    window.addEventListener('beforeinstallprompt', handlePrompt as EventListener)

    const timer = setTimeout(() => {
      if (deferredPrompt.current || iosSafari) setVisible(true)
    }, 15000)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('beforeinstallprompt', handlePrompt as EventListener)
    }
  }, [])

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, '1')
    setVisible(false)
  }

  async function install() {
    if (!deferredPrompt.current) return
    deferredPrompt.current.prompt()
    await deferredPrompt.current.userChoice
    dismiss()
    deferredPrompt.current = null
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-16 left-4 right-4 z-[35] bg-white border border-[#ddd8ce] rounded-[10px] p-4 shadow-lg">
      {isIOS ? (
        <>
          <div className="flex items-start gap-3 mb-3">
            <Share size={18} className="shrink-0 mt-0.5" style={{ color: accentColor }} />
            <div>
              <p className="text-[13px] font-semibold text-[#1a1a1a] mb-0.5">
                Add this guide to your home screen
              </p>
              <p className="text-[11px] text-[#888] leading-relaxed">
                Tap the Share icon below, then choose &ldquo;Add to Home Screen&rdquo;.
              </p>
            </div>
          </div>
          <button
            onClick={dismiss}
            className="text-[11px] text-[#888] hover:text-[#1a1a1a] transition-colors"
          >
            Not now
          </button>
        </>
      ) : (
        <>
          <div className="flex items-start gap-3 mb-3">
            <Download size={18} className="shrink-0 mt-0.5" style={{ color: accentColor }} />
            <div>
              <p className="text-[13px] font-semibold text-[#1a1a1a] mb-0.5">
                Add this guide to your home screen
              </p>
              <p className="text-[11px] text-[#888] leading-relaxed">
                One tap — open it like an app, even offline.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={install}
              className="px-4 py-1.5 rounded-[7px] text-xs font-semibold text-white hover:opacity-80 transition-opacity"
              style={{ backgroundColor: accentColor }}
            >
              Add to home screen
            </button>
            <button
              onClick={dismiss}
              className="px-4 py-1.5 rounded-[7px] text-xs text-[#888] hover:text-[#1a1a1a] transition-colors"
            >
              Not now
            </button>
          </div>
        </>
      )}
    </div>
  )
}
