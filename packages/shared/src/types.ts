/** Classic guesses artist + title; anime asks which anime a theme song comes from. */
export enum GameMode {
  Classic = "classic",
  Anime = "anime",
}

/** Team mode: two sides whose score is the sum of their members' scores. */
export enum Team {
  Blue = "blue",
  Red = "red",
}

export const TEAMS: readonly Team[] = [Team.Blue, Team.Red]

export const TEAM_LABEL: Record<Team, string> = {
  [Team.Blue]: "Bleu",
  [Team.Red]: "Rouge",
}

export function isTeam(value: unknown): value is Team {
  return value === Team.Blue || value === Team.Red
}

export type TeamScores = Record<Team, number>

/**
 * Team totals: members' current scores plus what players who left mid-game
 * had banked for their side.
 */
export function teamTotals(
  teams: Record<string, Team>,
  scores: Record<string, number>,
  banked?: Partial<TeamScores> | null
): TeamScores {
  const out: TeamScores = { [Team.Blue]: banked?.[Team.Blue] ?? 0, [Team.Red]: banked?.[Team.Red] ?? 0 }
  for (const [id, team] of Object.entries(teams)) out[team] += scores[id] ?? 0
  return out
}

/** The team ahead, or null on a draw. */
export function winningTeam(totals: TeamScores): Team | null {
  if (totals[Team.Blue] === totals[Team.Red]) return null
  return totals[Team.Blue] > totals[Team.Red] ? Team.Blue : Team.Red
}

export enum ErrorCode {
  RoomNotFound = "room_not_found",
}

export const LOBBY_PASSWORD_MAX_LENGTH = 32

export enum GamePhase {
  Lobby = "lobby",
  Playing = "playing",
  Reveal = "reveal",
  End = "end",
}

/** What a single free-text guess turned out to be. */
export enum GuessMatch {
  None = "none",
  /** Wrong, but within reach of the artist or the title. */
  Close = "close",
  Artist = "artist",
  Title = "title",
  Both = "both",
  Year = "year",
  YearWrong = "year_wrong",
  YearExhausted = "year_exhausted",
  /** The year was already found this round: no extra points. */
  YearAlreadyFound = "year_already_found",
  /** Anime mode: the anime the theme song belongs to. */
  Anime = "anime",
  /** Anime mode: the anime and its singer in the same guess. */
  AnimeAndArtist = "anime_artist",
}

export enum ThemeType {
  Opening = "OP",
  Ending = "ED",
  Insert = "IN",
}

/** One OP/ED slot a song fills, as listed by AnimeThemes. */
export interface AnimeTheme {
  type: ThemeType
  /** Null when the anime has a single theme of that type. */
  sequence: number | null
  /** e.g. "OP2", "ED1". */
  slug: string
}

/** What the reveal shows about the anime behind a track. */
export interface AnimeReveal {
  name: string
  themes: AnimeTheme[]
  year: number | null
  season: string | null
  imageUrl: string | null
}

export interface LobbySettings {
  mode: GameMode
  playlistIds: string[]
  /** Deezer playlist ids pasted by the host, not stored in the catalogue. */
  customDeezerPlaylistIds: string[]
  trackCount: number
  roundDuration: number
  maxErrorPercent: number
  yearGuessAttempts: number
  /** Show the lyrics alongside the answer once the round is over. */
  showLyrics: boolean
  /** Reveal the first letters of the title late in the round. */
  showHint: boolean
  /** Reveal the first letters of the artist a bit earlier in the round. */
  showArtistHint: boolean
  /** Bleu vs Rouge: team score is the sum of its members' scores. */
  teamMode?: boolean
}

/** Human label for a theme slot: "Opening 2", "Ending", ... */
export function themeLabel(theme: AnimeTheme): string {
  const kind =
    theme.type === ThemeType.Opening ? "Opening" : theme.type === ThemeType.Ending ? "Ending" : "Insert"
  return theme.sequence ? `${kind} ${theme.sequence}` : kind
}

export interface DeezerPlaylistMeta {
  id: string
  name: string
  coverUrl: string | null
  trackCount: number
}

export const MAX_ROUND_DURATION = 30
export const MAX_TRACK_COUNT = 200
export const TRACK_COUNT_STEP = 5

/** Pause before the first round so players can get ready. */
export const COUNTDOWN_MS = 5000
/** How long the answer stays on screen between rounds. */
export const REVEAL_MS = 5000
/** Players keep their slot this long after a disconnect (page navigation, refresh). */
export const DISCONNECT_GRACE_MS = 15000
/** Fraction of the round elapsed before the title hint appears. */
export const HINT_AT = 0.8
/** Fraction of the round elapsed before the artist hint appears. */
export const ARTIST_HINT_AT = 0.6

/** Anime mode: finding the anime is worth this at the first second... */
export const ANIME_MAX_POINTS = 20
/** ...and shrinks linearly down to this at the buzzer. */
export const ANIME_MIN_POINTS = 5
/** Anime mode bonus for naming who sings the theme. */
export const ANIME_ARTIST_POINTS = 5

export enum HintKind {
  Artist = "artist",
  Title = "title",
}

export interface PlayerPublic {
  id: string
  name: string
  avatarSeed: string
  score: number
  hasFoundArtist: boolean
  hasFoundTitle: boolean
  hasFoundBoth: boolean
  hasFoundYear: boolean
  /** Points earned in the current round, shown next to the total. */
  roundPoints: number
  connected: boolean
  /** Always set; only shown when the lobby plays in team mode. */
  team: Team
  /** Logged in with a Discord account. */
  discord: boolean
  /** App account id (User.id, not the Discord id) to open the public profile, null for guests. */
  userId: string | null
  /** Discord profile picture, when the player chose it over the Blobatar. */
  avatarUrl: string | null
}

export interface RoundPublic {
  trackIndex: number
  total: number
  previewUrl: string
  startedAt: number
  duration: number
}

/** What a player managed to find on a given round. */
export interface RoundOutcome {
  artist: boolean
  title: boolean
  year: boolean
}

export interface PlayedTrack {
  title: string
  artist: string
  year: number
  coverUrl: string | null
  anime?: AnimeReveal
}

export type WsServerMessage =
  | {
      type: "lobby:update"
      players: PlayerPublic[]
      settings: LobbySettings | null
      phase: GamePhase
      hostId: string
      /** Points each team keeps from players who left during the game. */
      teamBank: TeamScores
    }
  | { type: "game:start"; startsAt: number }
  /** The host hit start and tracks are being fetched (can take a few seconds). */
  | { type: "game:preparing"; active: boolean }
  | { type: "round:start"; round: RoundPublic }
  | {
      type: "guess:result"
      playerId: string
      playerName: string
      matched: GuessMatch
      pointsEarned: number
      scores: Record<string, number>
      firstBoth: boolean
      yearGuessesLeft: number
      /** Only echoed back to the author, so guesses never leak to opponents. */
      text?: string
      /** Only sent to the author, otherwise finding would spoil the answer. */
      revealedArtist?: string
      revealedTitle?: string
      revealedAnime?: string
    }
  | { type: "round:hint"; kind: HintKind; hint: string }
  | {
      type: "round:reveal"
      artist: string
      title: string
      year: number
      coverUrl: string | null
      lyrics: string | null
      anime: AnimeReveal | null
      scores: Record<string, number>
      outcomes: Record<string, RoundOutcome[]>
      nextAt: number
      isLast: boolean
    }
  | { type: "chat:message"; playerId: string; playerName: string; text: string; at: number }
  | { type: "reaction"; playerId: string; emoji: Reaction; at: number }
  | { type: "player:typing"; playerId: string; typing: boolean }
  | {
      type: "game:end"
      scores: Record<string, number>
      playerNames: Record<string, string>
      tracks: PlayedTrack[]
      outcomes: Record<string, RoundOutcome[]>
      /** Team mode only: each player's side and the final team totals. */
      teams?: Record<string, Team>
      teamScores?: TeamScores
    }
  /** Who may join: sent to everyone, the password itself only to the host. */
  | { type: "lobby:access"; hasPassword: boolean; allowLateJoin: boolean; password?: string }
  | { type: "error"; message: string; code?: ErrorCode }

export type WsClientMessage =
  | { type: "lobby:settings"; settings: LobbySettings }
  | { type: "lobby:start"; settings: LobbySettings }
  | { type: "player:avatar"; avatarSeed: string }
  | { type: "guess"; text: string }
  | { type: "chat"; text: string }
  | { type: "reaction"; emoji: Reaction }
  | { type: "typing"; typing: boolean }
  /** Host only: empty password removes it. */
  | { type: "lobby:access"; password: string; allowLateJoin: boolean }
  /** Team mode: moves yourself to that team (lobby only). */
  | { type: "team:join"; team: Team }
  /** Host only: deals everyone into balanced random teams (lobby only). */
  | { type: "team:shuffle" }
  /** Leaves the room for good, without the reconnection grace period. */
  | { type: "leave" }

/** Emotes players can throw at everyone during a game. */
export const REACTIONS = ["🔥", "😂", "😮", "😭", "👏", "🤯", "😡", "❤️"] as const
export type Reaction = (typeof REACTIONS)[number]

export function isReaction(value: unknown): value is Reaction {
  return typeof value === "string" && (REACTIONS as readonly string[]).includes(value)
}

/** Accepts a Deezer playlist URL or a numeric id. Spotify links are rejected. */
export function parseDeezerPlaylistId(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d{5,}$/.test(trimmed)) return trimmed
  const match = trimmed.match(/playlist\/(\d{5,})/)
  return match?.[1] ?? null
}

export * from "./account"
export * from "./avatar"
