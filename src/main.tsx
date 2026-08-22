import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Sampled at module evaluation, BEFORE registration can resolve: reading
// navigator.serviceWorker.controller inside the handler would always see the NEW
// controller and the guard below could never fire.
let hasController =
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  navigator.serviceWorker.controller !== null

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING')
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        if (!newWorker) return
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            newWorker.postMessage('SKIP_WAITING')
          }
        })
      })
    }).catch(() => {})

    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Reload only when a NEW worker REPLACED a previous one. No controller at startup
      // means this page was not served by an older worker (first visit, or a hard reload
      // that bypassed the SW) — it already has the current bundle from the network, so
      // the reload buys nothing and costs everything in flight. Concretely: it aborted the
      // pre-arrival POST /api/welcome-claim, and the reloaded URL no longer carried the
      // #c=…&g=… hints (WelcomePage strips them during first render, by design), so the
      // claim could never be retried and the guest never reached their page.
      // Latch instead of returning forever: this page IS controlled from here on, so a
      // genuine update later in the same tab's life must still reload it.
      // Do not "simplify" this guard away.
      if (!hasController) { hasController = true; return }
      if (refreshing) return
      refreshing = true
      window.location.reload()
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
