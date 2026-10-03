import { useSyncExternalStore } from "react"

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: number
  title: string
  text?: string
  icon?: string
  /** Optional avatar picture (Discord), shown instead of the icon. */
  imageUrl?: string
  action?: ToastAction
  durationMs: number
}

const DEFAULT_DURATION_MS = 6000

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

/** Global notifications, shown on any page by the Toaster mounted at the root. */
export function showToast(toast: Omit<Toast, "id" | "durationMs"> & { durationMs?: number }): number {
  const id = nextId++
  const full: Toast = { durationMs: DEFAULT_DURATION_MS, ...toast, id }
  toasts = [...toasts, full].slice(-4)
  emit()
  setTimeout(() => dismissToast(id), full.durationMs)
  return id
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, () => toasts)
}
