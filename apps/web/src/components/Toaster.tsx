import { X } from "@phosphor-icons/react"
import { dismissToast, useToasts } from "@/utils/toast"

/** Stack of notifications in the bottom-right corner (bottom, full width on phones). */
export default function Toaster() {
  const toasts = useToasts()
  if (toasts.length === 0) return null
  return (
    <div className="fixed z-[60] bottom-4 inset-x-4 sm:inset-x-auto sm:right-5 sm:bottom-5 flex flex-col gap-2 sm:w-80 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="pointer-events-auto flex items-start gap-3 bg-surface border border-edge rounded-2xl shadow-xl p-3 animate-pop"
        >
          {toast.imageUrl ? (
            <img src={toast.imageUrl} alt="" className="w-9 h-9 rounded-full shrink-0" />
          ) : toast.icon ? (
            <span className="w-9 h-9 shrink-0 rounded-full bg-accent/10 flex items-center justify-center text-lg">
              {toast.icon}
            </span>
          ) : null}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink">{toast.title}</p>
            {toast.text && <p className="text-xs text-muted mt-0.5">{toast.text}</p>}
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick()
                  dismissToast(toast.id)
                }}
                className="mt-2 text-xs font-semibold bg-accent text-white px-3 py-1.5 rounded-lg hover:opacity-90 transition-opacity"
              >
                {toast.action.label}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            aria-label="Fermer"
            className="p-1 -m-1 rounded-lg text-muted hover:text-ink transition-colors"
          >
            <X size={14} weight="bold" />
          </button>
        </div>
      ))}
    </div>
  )
}
