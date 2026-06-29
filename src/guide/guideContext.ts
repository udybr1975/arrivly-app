import { createContext, useContext } from 'react'

// Context for the host Guide. Layout owns the underlying state (drawer open/close,
// the requested module, and the dismissed-hint map persisted to hosts.ui_state) and
// provides this value around the routed <Outlet/> so any page — and the single
// route-aware <PageHint/> — can open the drawer or read/toggle its first-visit hint.
export type GuideContextValue = {
  // Open the drawer. With a moduleId, jump straight to that article; without one,
  // open to the current route's section.
  openGuide: (moduleId?: string) => void
  isDismissed: (moduleId: string) => boolean
  dismissHint: (moduleId: string) => void
  restoreHint: (moduleId: string) => void
  // false until hosts.ui_state has loaded — used to avoid a flash of hints/dots.
  uiReady: boolean
}

export const GuideContext = createContext<GuideContextValue | null>(null)

export function useGuide(): GuideContextValue {
  const ctx = useContext(GuideContext)
  if (!ctx) throw new Error('useGuide must be used within the Guide context provider')
  return ctx
}
