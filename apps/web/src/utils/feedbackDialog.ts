import { useSyncExternalStore } from "react"

let open = false
const listeners = new Set<() => void>()

function set(value: boolean) {
  if (open === value) return
  open = value
  for (const listener of listeners) listener()
}

/** Modale « Donner un retour », ouverte depuis le menu des paramètres et montée une seule fois à la racine. */
export const openFeedback = () => set(true)
export const closeFeedback = () => set(false)

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useFeedbackOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open)
}
