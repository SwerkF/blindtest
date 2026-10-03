import { useSyncExternalStore } from "react"

const HIDE_KEY = "blindtest:hide-reactions"

/** At most this many emotes float over the stage at once; extra ones are skipped. */
export const MAX_FLOATERS = 6

const listeners = new Set<() => void>()
let current: boolean | null = null

/** Hide the other players' emotes (your own still show). Stored per browser. */
export function getHideReactions(): boolean {
  if (current === null) {
    try {
      current = localStorage.getItem(HIDE_KEY) === "1"
    } catch {
      current = false
    }
  }
  return current
}

export function setHideReactions(hide: boolean) {
  current = hide
  try {
    if (hide) localStorage.setItem(HIDE_KEY, "1")
    else localStorage.removeItem(HIDE_KEY)
  } catch {
    // Storage blocked: the choice only lasts until reload
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useHideReactions(): boolean {
  return useSyncExternalStore(subscribe, getHideReactions)
}
