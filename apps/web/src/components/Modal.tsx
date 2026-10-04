import { useEffect, useRef, type ReactNode } from "react"
import { X } from "@phosphor-icons/react"

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  /** Buttons row at the bottom. */
  actions?: ReactNode
  size?: "sm" | "md"
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Centred dialog over a dimmed page; closes on Escape or a click outside, Tab stays inside. */
export default function Modal({ title, onClose, children, actions, size = "sm" }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  // Callers pass inline handlers: keep the latest one without re-running the effect (and refocusing)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current()
        return
      }
      if (event.key !== "Tab") return
      const panel = panelRef.current
      if (!panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) {
        event.preventDefault()
        return
      }
      const active = document.activeElement
      if (!panel.contains(active) || (event.shiftKey && (active === first || active === panel))) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    panelRef.current?.focus()
    return () => {
      document.removeEventListener("keydown", onKey)
      // Rend le focus au bouton qui a ouvert la modale, s'il existe encore
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-pitch/60 p-3 sm:p-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] animate-fade"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`w-full ${size === "sm" ? "max-w-sm" : "max-w-lg"} bg-surface border border-edge rounded-2xl shadow-xl p-5 sm:p-6 max-h-full overflow-y-auto overscroll-contain outline-none animate-pop`}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="p-2.5 -m-2.5 rounded-lg text-muted hover:text-ink hover:bg-edge/60 transition-colors"
          >
            <X size={18} weight="bold" />
          </button>
        </div>
        <div className="text-sm text-ink/85">{children}</div>
        {actions && <div className="mt-6 flex flex-wrap justify-end gap-2 [&>button]:min-h-11 sm:[&>button]:min-h-0">{actions}</div>}
      </div>
    </div>
  )
}
