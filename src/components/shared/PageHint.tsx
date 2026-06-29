import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { X } from 'lucide-react'
import { moduleForPath } from '../../guide/content'
import { useGuide } from '../../guide/guideContext'

// Single, route-aware first-visit hint strip. Mounted once by Layout directly above
// the <Outlet/>. Resolves the current route's Guide module and shows a slim cream/brass
// strip the first time a host lands on that page; once dismissed it collapses to a quiet
// "Show page tips" button. Brass accent only — never a host accent_color (this is chrome).
export default function PageHint() {
  const location = useLocation()
  const { openGuide, isDismissed, dismissHint, restoreHint, uiReady } = useGuide()

  // Gentle enter animation, re-armed on each route change. prefers-reduced-motion
  // disables the transition via the motion-reduce: variant.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    setShown(false)
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [location.pathname])

  const module = moduleForPath(location.pathname)

  // Render nothing for: no module · Home (has its own welcome + next-step banner) ·
  // coming-soon previews · before ui_state has loaded.
  if (!uiReady) return null
  if (!module) return null
  if (location.pathname === '/dashboard') return null
  if (module.status === 'coming-soon') return null

  const enterClass = `transition-all duration-300 ease-out motion-reduce:transition-none ${
    shown ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'
  }`

  if (isDismissed(module.id)) {
    return (
      <div className={`mb-4 ${enterClass}`}>
        <button
          onClick={() => restoreHint(module.id)}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#8a8276] hover:text-[#a8842f] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e] rounded px-1 py-0.5"
        >
          <span aria-hidden="true">💡</span>
          Show page tips
        </button>
      </div>
    )
  }

  return (
    <div
      className={`mb-4 rounded-[12px] border border-[#e7d6ad] bg-[#fffdf9] px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${enterClass}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#a8842f] mb-1">
            First time here
          </div>
          <div className="font-['Fraunces'] text-[15px] text-[#231d17] leading-tight">
            {module.title}
          </div>
          <p className="mt-1 text-[12.5px] leading-[1.45] text-[#8a8276]">{module.summary}</p>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              onClick={() => openGuide(module.id)}
              className="inline-flex items-center rounded-[8px] bg-[#c8a24e] hover:bg-[#a8842f] text-[#16100d] text-[12px] font-semibold px-3 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a8842f] focus-visible:ring-offset-1 focus-visible:ring-offset-[#fffdf9]"
            >
              Show me in Guide
            </button>
            <button
              onClick={() => dismissHint(module.id)}
              className="inline-flex items-center rounded-[8px] border border-[#e7d6ad] text-[#8a8276] hover:text-[#231d17] hover:border-[#c8a24e] text-[12px] font-medium px-3 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]"
            >
              Got it
            </button>
          </div>
        </div>
        <button
          onClick={() => dismissHint(module.id)}
          aria-label="Dismiss page tip"
          className="shrink-0 p-1 rounded-[8px] text-[#b3aa9b] hover:text-[#231d17] hover:bg-[#f0ece3] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
