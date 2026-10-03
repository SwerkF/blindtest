import type {
  AccountUser,
  FriendRequestOutcome,
  FriendsResponse,
  HistoryResponse,
  MeResponse,
  PublicUser,
  UnlockedAchievement,
} from "@blindmusic/shared"
import { req } from "@/utils/api"

export enum AccountQueryKey {
  Me = "account:me",
  Friends = "account:friends",
  History = "account:history",
  Achievements = "account:achievements",
}

/** Full-page redirect: the server sends the browser to Discord and back. */
export function discordLoginUrl(returnTo = location.pathname + location.search): string {
  return `/api/auth/discord?returnTo=${encodeURIComponent(returnTo)}`
}

export const accountApi = {
  me: () => req<MeResponse>("/auth/me"),

  updateProfile: (pseudo: string, avatarSeed: string) =>
    req<AccountUser>("/auth/me", { method: "PATCH", body: JSON.stringify({ pseudo, avatarSeed }) }),

  setUseDiscordAvatar: (useDiscordAvatar: boolean) =>
    req<AccountUser>("/auth/me", { method: "PATCH", body: JSON.stringify({ useDiscordAvatar }) }),

  logout: () => req<void>("/auth/logout", { method: "POST", body: "{}" }),

  deleteAccount: () => req<void>("/auth/me", { method: "DELETE", body: "{}" }),

  history: () => req<HistoryResponse>("/me/history"),

  achievements: () => req<UnlockedAchievement[]>("/me/achievements"),

  friends: () => req<FriendsResponse>("/friends"),

  searchUsers: (q: string) => req<PublicUser[]>(`/friends/search?q=${encodeURIComponent(q)}`),

  sendRequest: (target: { userId: string } | { friendCode: string }) =>
    req<{ outcome: FriendRequestOutcome }>("/friends/requests", { method: "POST", body: JSON.stringify(target) }),

  accept: (friendshipId: string) => req<void>(`/friends/${friendshipId}/accept`, { method: "POST", body: "{}" }),

  decline: (friendshipId: string) => req<void>(`/friends/${friendshipId}/decline`, { method: "POST", body: "{}" }),

  remove: (friendshipId: string) => req<void>(`/friends/${friendshipId}`, { method: "DELETE", body: "{}" }),

  invite: (userId: string, code: string) =>
    req<{ delivered: boolean }>("/friends/invite", { method: "POST", body: JSON.stringify({ userId, code }) }),
}

export function userSocketUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws"
  return `${proto}://${location.host}/ws/user`
}
