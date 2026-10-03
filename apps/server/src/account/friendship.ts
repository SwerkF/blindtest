import { FriendshipStatus } from "@blindmusic/shared"

/** The single row linking two users, as far as the transition rules care. */
export interface FriendshipRow {
  requesterId: string
  addresseeId: string
  status: FriendshipStatus
}

export enum FriendAction {
  Request = "request",
  Accept = "accept",
  /** Addressee refuses, or requester cancels, a pending request. */
  Decline = "decline",
  Remove = "remove",
}

export enum FriendError {
  Self = "self",
  AlreadyFriends = "already_friends",
  AlreadyRequested = "already_requested",
  NoRequest = "no_request",
  NotFriends = "not_friends",
}

export const FRIEND_ERROR_MESSAGE: Record<FriendError, string> = {
  [FriendError.Self]: "Tu ne peux pas t'ajouter toi-même",
  [FriendError.AlreadyFriends]: "Vous êtes déjà amis",
  [FriendError.AlreadyRequested]: "Demande déjà envoyée",
  [FriendError.NoRequest]: "Aucune demande en attente",
  [FriendError.NotFriends]: "Vous n'êtes pas amis",
}

export type FriendTransition =
  | { kind: "create"; row: FriendshipRow }
  | { kind: "update"; row: FriendshipRow }
  | { kind: "delete" }
  | { kind: "error"; error: FriendError }

/**
 * What an action by `actorId` towards `targetId` does to their friendship row.
 * Requesting someone who already asked you accepts their request, so two
 * people adding each other at the same time simply become friends.
 */
export function friendshipTransition(
  existing: FriendshipRow | null,
  actorId: string,
  targetId: string,
  action: FriendAction
): FriendTransition {
  if (actorId === targetId) return { kind: "error", error: FriendError.Self }
  const accepted = existing?.status === FriendshipStatus.Accepted
  const pending = existing?.status === FriendshipStatus.Pending
  const sentByActor = existing?.requesterId === actorId

  switch (action) {
    case FriendAction.Request:
      if (!existing) {
        return {
          kind: "create",
          row: { requesterId: actorId, addresseeId: targetId, status: FriendshipStatus.Pending },
        }
      }
      if (accepted) return { kind: "error", error: FriendError.AlreadyFriends }
      if (sentByActor) return { kind: "error", error: FriendError.AlreadyRequested }
      return { kind: "update", row: { ...existing, status: FriendshipStatus.Accepted } }

    case FriendAction.Accept:
      if (accepted) return { kind: "error", error: FriendError.AlreadyFriends }
      if (!existing || !pending || sentByActor) return { kind: "error", error: FriendError.NoRequest }
      return { kind: "update", row: { ...existing, status: FriendshipStatus.Accepted } }

    case FriendAction.Decline:
      if (!existing || !pending) return { kind: "error", error: FriendError.NoRequest }
      return { kind: "delete" }

    case FriendAction.Remove:
      if (!existing || !accepted) return { kind: "error", error: FriendError.NotFriends }
      return { kind: "delete" }
  }
}

/** The other side of a friendship row, seen from `userId`. */
export function otherUserId(row: Pick<FriendshipRow, "requesterId" | "addresseeId">, userId: string): string {
  return row.requesterId === userId ? row.addresseeId : row.requesterId
}

/** Friend codes avoid look-alike characters (0/O, 1/I/L) since people read them out. */
const FRIEND_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
export const FRIEND_CODE_LENGTH = 8

export function generateFriendCode(random: () => number = Math.random): string {
  let code = ""
  for (let i = 0; i < FRIEND_CODE_LENGTH; i++) {
    code += FRIEND_CODE_ALPHABET[Math.floor(random() * FRIEND_CODE_ALPHABET.length)]
  }
  return code
}

export function normalizeFriendCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "")
}
