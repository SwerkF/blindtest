import type { UserWsServerMessage } from "@blindmusic/shared"

type Send = (msg: UserWsServerMessage) => void

// ponytail: in-memory, single-process like the rooms
const sockets = new Map<string, Set<Send>>()

export function isOnline(userId: string): boolean {
  return (sockets.get(userId)?.size ?? 0) > 0
}

/** Returns true when this is the user's first open tab (they just came online). */
export function addUserSocket(userId: string, send: Send): boolean {
  let set = sockets.get(userId)
  if (!set) {
    set = new Set()
    sockets.set(userId, set)
  }
  set.add(send)
  return set.size === 1
}

/** Returns true when the user has no tab left (they just went offline). */
export function removeUserSocket(userId: string, send: Send): boolean {
  const set = sockets.get(userId)
  if (!set) return false
  set.delete(send)
  if (set.size > 0) return false
  sockets.delete(userId)
  return true
}

/** Pushes to every open tab of the user; false when they are offline. */
export function notifyUser(userId: string, msg: UserWsServerMessage): boolean {
  const set = sockets.get(userId)
  if (!set?.size) return false
  for (const send of set) {
    try {
      send(msg)
    } catch {}
  }
  return true
}
