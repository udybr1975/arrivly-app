import { useEffect, useState } from 'react'
import { isStandalone } from './webpush'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface Window {
    __arrivlyInstall?: { prompt: BeforeInstallPromptEvent | null; installed: boolean }
  }
}

// UA checks are pure functions of a constant string — hoist to avoid recomputing on every render.
const ua = navigator.userAgent
const isIOSSafari = /iphone|ipad|ipod/i.test(ua) && !/crios|fxios/i.test(ua)
// Chrome, Chromium-based Edge, Opera, Samsung Internet, Chrome iOS — but NOT Firefox iOS.
// Firefox desktop/Android UA doesn't contain any of these tokens, so it falls to the non-Chromium
// else-branch in InstallCard even though Firefox Android also supports beforeinstallprompt.
// Accepted gap: the else-branch steers those users to Chrome/Edge, which is the recommended path.
const isChromium = /chrome|chromium|crios|edg|edga|edgios|opr|samsungbrowser/i.test(ua) && !/fxios/i.test(ua)

export function useInstallPrompt() {
  const [canInstall, setCanInstall] = useState(() => !!window.__arrivlyInstall?.prompt)
  const [installed, setInstalled] = useState(() => {
    if (window.__arrivlyInstall?.installed === true) return true
    try { return localStorage.getItem('arrivly_installed') === '1' } catch { return false }
  })

  useEffect(() => {
    function onPrompt() {
      setCanInstall(!!window.__arrivlyInstall?.prompt)
    }
    function onInstalled() {
      try { localStorage.setItem('arrivly_installed', '1') } catch {}
      setInstalled(true)
      setCanInstall(false)
    }

    window.addEventListener('arrivly:installprompt', onPrompt)
    window.addEventListener('arrivly:installed', onInstalled)

    // Re-sync in case the event fired between module load and effect registration.
    setCanInstall(!!window.__arrivlyInstall?.prompt)

    return () => {
      window.removeEventListener('arrivly:installprompt', onPrompt)
      window.removeEventListener('arrivly:installed', onInstalled)
    }
  }, [])

  async function install(): Promise<void> {
    const p = window.__arrivlyInstall?.prompt
    if (!p) return
    // Chrome fires beforeinstallprompt once per session; clearing it means a dismissed
    // dialog cannot be retried without a page reload. That is the browser-spec behaviour.
    if (window.__arrivlyInstall) window.__arrivlyInstall.prompt = null
    setCanInstall(false)
    try {
      await p.prompt()
      const choice = await p.userChoice
      if (choice.outcome === 'accepted') {
        try { localStorage.setItem('arrivly_installed', '1') } catch {}
        setInstalled(true)
      }
    } catch {
      // prompt() rejected (e.g. browser cancelled mid-show) — no-op; canInstall stays false.
    }
  }

  return {
    canInstall,
    isIOSSafari,
    isChromium,
    standalone: isStandalone(),
    install,
    installed,
  }
}
