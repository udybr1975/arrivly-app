import { useEffect, useRef, useState } from 'react'
import { isStandalone } from './webpush'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Both the guest toast (InstallPrompt.tsx) and the host card (InstallCard.tsx) capture
// beforeinstallprompt via this hook. A deferred prompt can only be .prompt()-ed once —
// whichever surface the user taps first consumes it; the other falls back to instructions.
export function useInstallPrompt() {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null)
  const [canInstall, setCanInstall] = useState(false)
  const [installed, setInstalled] = useState(() => {
    try { return localStorage.getItem('arrivly_installed') === '1' } catch { return false }
  })

  const ua = navigator.userAgent
  const isIOSSafari = /iphone|ipad|ipod/i.test(ua) && !/crios|fxios/i.test(ua)

  useEffect(() => {
    function handlePrompt(e: Event) {
      e.preventDefault()
      deferredPrompt.current = e as BeforeInstallPromptEvent
      setCanInstall(true)
    }
    window.addEventListener('beforeinstallprompt', handlePrompt)
    return () => window.removeEventListener('beforeinstallprompt', handlePrompt)
  }, [])

  useEffect(() => {
    function handleAppInstalled() {
      try { localStorage.setItem('arrivly_installed', '1') } catch {}
      setInstalled(true)
    }
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => window.removeEventListener('appinstalled', handleAppInstalled)
  }, [])

  async function install(): Promise<void> {
    if (!deferredPrompt.current) return
    const prompt = deferredPrompt.current
    deferredPrompt.current = null
    setCanInstall(false)
    prompt.prompt()
    const choice = await prompt.userChoice
    if (choice.outcome === 'accepted') {
      try { localStorage.setItem('arrivly_installed', '1') } catch {}
      setInstalled(true)
    }
  }

  return {
    canInstall,
    isIOSSafari,
    standalone: isStandalone(),
    install,
    installed,
  }
}
