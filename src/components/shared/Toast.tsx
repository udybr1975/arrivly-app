import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

let nextId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++nextId
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500)
  }, [])

  const remove = (id: number) => setToasts(prev => prev.filter(t => t.id !== id))

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg pointer-events-auto text-white text-sm transition-all duration-200 ${
              t.type === 'success' ? 'bg-green-700' : t.type === 'error' ? 'bg-red-700' : 'bg-gray-700'
            }`}
          >
            <span className="flex-1">{t.message}</span>
            <button onClick={() => remove(t.id)} className="mt-0.5 opacity-60 hover:opacity-100 transition shrink-0">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export default ToastProvider
