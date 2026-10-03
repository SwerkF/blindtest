import { useSyncExternalStore } from "react"

export enum ProfileTab {
  History = "historique",
  Achievements = "succes",
  Friends = "amis",
}

export function readProfileTab(value: string | null | undefined): ProfileTab {
  return Object.values(ProfileTab).find((tab) => tab === value) ?? ProfileTab.History
}

/** Tab shown by the profile drawer, or null while it is closed. */
let current: ProfileTab | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/**
 * Opens the profile as a drawer over the current page instead of navigating to /profil,
 * so a player in a lobby or a game keeps their room socket (and their place).
 */
export function openProfile(tab: ProfileTab = ProfileTab.History) {
  current = tab
  emit()
}

export function closeProfile() {
  if (current === null) return
  current = null
  emit()
}

export function setProfileTab(tab: ProfileTab) {
  if (current === null) return
  current = tab
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useProfileDrawer(): ProfileTab | null {
  return useSyncExternalStore(subscribe, () => current)
}
