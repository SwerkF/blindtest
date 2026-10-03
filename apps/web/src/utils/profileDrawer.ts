import { useSyncExternalStore } from "react"

export enum ProfileTab {
  History = "historique",
  Achievements = "succes",
  Friends = "amis",
  Collection = "collection",
}

export function readProfileTab(value: string | null | undefined): ProfileTab {
  return Object.values(ProfileTab).find((tab) => tab === value) ?? ProfileTab.History
}

/** What the drawer shows: my own profile on a tab, or someone's public profile. */
export type ProfileDrawerView =
  | { kind: "me"; tab: ProfileTab }
  /** `back` is the tab of my profile it was opened from, to return to it. */
  | { kind: "user"; userId: string; back: ProfileTab | null }

/** Null while the drawer is closed. */
let current: ProfileDrawerView | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/**
 * Opens the profile as a drawer over the current page instead of navigating to /profil,
 * so a player in a lobby or a game keeps their room socket (and their place).
 */
export function openProfile(tab: ProfileTab = ProfileTab.History) {
  current = { kind: "me", tab }
  emit()
}

/** Someone's public profile in the drawer (from a lobby or a game, where leaving the page leaves the room). */
export function openUserProfileDrawer(userId: string) {
  current = { kind: "user", userId, back: current?.kind === "me" ? current.tab : null }
  emit()
}

export function closeProfile() {
  if (current === null) return
  current = null
  emit()
}

export function setProfileTab(tab: ProfileTab) {
  if (current === null) return
  current = { kind: "me", tab }
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useProfileDrawer(): ProfileDrawerView | null {
  return useSyncExternalStore(subscribe, () => current)
}

/** Pages where navigating away would drop the room socket: profiles open in the drawer there. */
export function isRoomPath(pathname: string): boolean {
  return /^\/(lobby|game)\//.test(pathname)
}
