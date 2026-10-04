import type {
  AccountUser,
  BoosterStateResponse,
  CardRarity,
  CollectionResponse,
  FeedbackBody,
  FeedbackResponse,
  FeedbackStatusResponse,
  OpenPackResponse,
  PackRarity,
  FriendRequestOutcome,
  FriendsResponse,
  HistoryResponse,
  MeResponse,
  PublicProfileResponse,
  PublicUser,
  UnlockedAchievement,
} from "@blindmusic/shared"
import { req } from "@/utils/api"

export enum AccountQueryKey {
  Me = "account:me",
  Friends = "account:friends",
  History = "account:history",
  Achievements = "account:achievements",
  /** Followed by the user id. */
  PublicProfile = "account:public-profile",
  Boosters = "account:boosters",
  /** Followed by the owner ("me" or a user id), the rarity filter and the page. */
  Collection = "account:collection",
  FeedbackStatus = "account:feedback-status",
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

  publicProfile: (userId: string) => req<PublicProfileResponse>(`/users/${encodeURIComponent(userId)}`),

  boosters: () => req<BoosterStateResponse>("/me/boosters"),

  openPack: (rarity: PackRarity) =>
    req<OpenPackResponse>("/me/boosters/open", { method: "POST", body: JSON.stringify({ rarity }) }),

  /** `userId` null = my own collection. */
  collection: (userId: string | null, page: number, rarity: CardRarity | null) => {
    const query = new URLSearchParams({ page: String(page), ...(rarity ? { rarity } : {}) })
    const base = userId ? `/users/${encodeURIComponent(userId)}/collection` : "/me/collection"
    return req<CollectionResponse>(`${base}?${query}`)
  },

  /** A cover failed to load from the Deezer CDN: the next catalogue run refreshes it. */
  reportCover: (entryId: string) =>
    req<void>(`/cards/${encodeURIComponent(entryId)}/cover-missing`, { method: "POST", body: "{}" }),

  feedbackStatus: () => req<FeedbackStatusResponse>("/feedback/status"),

  sendFeedback: (body: FeedbackBody) => req<FeedbackResponse>("/feedback", { method: "POST", body: JSON.stringify(body) }),

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
