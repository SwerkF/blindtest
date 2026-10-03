import type { GameMode } from "./types"

/** Optional Discord accounts: guests keep playing with a pseudo only. */

export enum AchievementId {
  FirstGame = "first_game",
  FirstWin = "first_win",
  Regular = "games_10",
  MusicLover = "games_50",
  Veteran = "games_100",
  Unstoppable = "wins_10",
  Lightning = "title_under_3s",
  PerfectRound = "perfect_round",
  Flawless = "flawless_game",
  Historian = "years_5",
  Century = "score_100",
  Otaku = "anime_win",
  Marathon = "marathon",
  WithFriends = "with_friends",
  TeamPlayer = "team_win",
}

export interface AchievementDef {
  id: AchievementId
  name: string
  description: string
  icon: string
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: AchievementId.FirstGame, name: "Première écoute", description: "Termine ta première partie", icon: "🎧" },
  { id: AchievementId.FirstWin, name: "Premier de la classe", description: "Gagne une partie à plusieurs", icon: "🥇" },
  { id: AchievementId.Regular, name: "Habitué", description: "Joue 10 parties", icon: "🎶" },
  { id: AchievementId.MusicLover, name: "Mélomane", description: "Joue 50 parties", icon: "📻" },
  { id: AchievementId.Veteran, name: "Disque de platine", description: "Joue 100 parties", icon: "💿" },
  { id: AchievementId.Unstoppable, name: "Inarrêtable", description: "Gagne 10 parties", icon: "🏆" },
  { id: AchievementId.Lightning, name: "Éclair", description: "Trouve un titre en moins de 3 secondes", icon: "⚡" },
  {
    id: AchievementId.PerfectRound,
    name: "Manche parfaite",
    description: "Trouve l'artiste, le titre et l'année sur une même manche",
    icon: "🎯",
  },
  {
    id: AchievementId.Flawless,
    name: "Sans-faute",
    description: "Trouve la réponse à chaque manche d'une partie d'au moins 5 titres",
    icon: "💎",
  },
  { id: AchievementId.Historian, name: "Historien", description: "Trouve 5 années dans une même partie", icon: "📅" },
  { id: AchievementId.Century, name: "Centurion", description: "Marque 100 points dans une partie", icon: "💯" },
  { id: AchievementId.Otaku, name: "Otaku", description: "Gagne une partie en mode anime", icon: "🍙" },
  { id: AchievementId.Marathon, name: "Marathonien", description: "Termine une partie d'au moins 30 titres", icon: "🏃" },
  { id: AchievementId.WithFriends, name: "Entre amis", description: "Joue une partie avec un ami", icon: "🤝" },
  { id: AchievementId.TeamPlayer, name: "Esprit d'équipe", description: "Gagne une partie en équipe", icon: "🛡️" },
]

export function achievementDef(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id)
}

export enum FriendshipStatus {
  Pending = "pending",
  Accepted = "accepted",
}

export interface PublicUser {
  id: string
  username: string
  /** Pseudo chosen in the app, falls back to the Discord name. */
  pseudo: string
  avatarSeed: string | null
  discordAvatarUrl: string
  /** Shows the Discord profile picture instead of the Blobatar. */
  useDiscordAvatar: boolean
}

export interface AccountUser extends PublicUser {
  /** Short code friends can type to send a request. */
  friendCode: string
  /** Whether the pseudo/avatar were ever set from the app (first login syncs the local profile). */
  hasProfile: boolean
}

export interface MeResponse {
  user: AccountUser | null
  /** False when the server has no Discord credentials configured. */
  discordEnabled: boolean
}

export interface FriendEntry {
  friendshipId: string
  user: PublicUser
  online: boolean
}

export interface FriendRequestEntry {
  friendshipId: string
  user: PublicUser
  createdAt: string
}

export interface FriendsResponse {
  friends: FriendEntry[]
  incoming: FriendRequestEntry[]
  outgoing: FriendRequestEntry[]
}

export interface GameHistoryItem {
  id: string
  roomCode: string
  mode: GameMode
  score: number
  rank: number
  playerCount: number
  roundCount: number
  won: boolean
  team: string | null
  teamWon: boolean | null
  playedAt: string
}

/**
 * Profile stats over every saved game. Round stats only cover games saved with
 * round detail (`roundsTracked`); older games count for games/wins/best score only.
 */
export interface ProfileStats {
  gamesPlayed: number
  wins: number
  /** Share of games won, 0–100, rounded. */
  winRate: number
  bestScore: number | null
  /** Rounds that carry detail; round stats are null when it is 0. */
  roundsTracked: number
  /**
   * "Guess moyen": average number of answers found per round, out of 3
   * (artist, title, year), e.g. 1.4.
   */
  averageFound: number | null
  /** Share of rounds where the title (or the anime) was found, 0–100. */
  titleRate: number | null
  /** "Guess perfect": rounds with the artist and the title found. */
  perfectRounds: number
  /** "Guess ultimate": rounds with the artist, the title and the year found. */
  ultimateRounds: number
  /** Average time to find the title, in milliseconds. */
  averageTitleMs: number | null
}

export interface HistoryResponse {
  items: GameHistoryItem[]
  gamesPlayed: number
  wins: number
  stats: ProfileStats
}

/** How the viewer of a public profile relates to its owner. */
export enum FriendshipState {
  /** The viewer is a guest: no friend button. */
  Guest = "guest",
  Self = "self",
  None = "none",
  /** The viewer sent a request that is still pending. */
  Outgoing = "outgoing",
  /** The profile owner asked the viewer. */
  Incoming = "incoming",
  Friends = "friends",
}

/** What anyone can see of an account. Never carries the Discord id, friend code or sessions. */
export interface PublicProfileUser {
  id: string
  pseudo: string
  /** Discord display name. */
  username: string
  avatarSeed: string | null
  /** Discord picture, only when the owner chose it over the Blobatar. */
  avatarUrl: string | null
  createdAt: string
}

/** GET /users/:id — public profile (/u/:id page, profile drawer in rooms). */
export interface PublicProfileResponse {
  user: PublicProfileUser
  stats: ProfileStats
  /** Unlocked achievements only: locked (and secret) ones are never listed. */
  achievements: UnlockedAchievement[]
  recentGames: GameHistoryItem[]
  friendship: FriendshipState
  /** Pending or accepted row between the viewer and the owner, to accept/cancel/remove it. */
  friendshipId: string | null
}

/** Whether an achievement stays hidden until unlocked (when the definition says so). */
export function isSecretAchievement(def: AchievementDef): boolean {
  return (def as AchievementDef & { secret?: boolean }).secret === true
}

export enum FriendRequestOutcome {
  Sent = "sent",
  /** The other person had already asked: you are now friends. */
  Accepted = "accepted",
}

export interface UnlockedAchievement {
  id: AchievementId
  unlockedAt: string
}

/** Pushed on the per-user socket (/ws/user), whatever page the player is on. */
export type UserWsServerMessage =
  | { type: "friend:presence"; userId: string; online: boolean }
  | { type: "friend:request"; from: PublicUser }
  | { type: "friend:accepted"; from: PublicUser }
  | { type: "friend:changed" }
  | { type: "lobby:invite"; from: PublicUser; code: string }
  | { type: "achievement:unlocked"; ids: AchievementId[] }

export type UserWsClientMessage = { type: "ping" }
