import {
  ARTIST_HINT_AT,
  COUNTDOWN_MS,
  DISCONNECT_GRACE_MS,
  GameMode,
  GamePhase,
  GuessMatch,
  HINT_AT,
  HintKind,
  REVEAL_MS,
  ANIME_ARTIST_POINTS,
  ANIME_MAX_POINTS,
  ANIME_MIN_POINTS,
  type LobbySettings,
  type PlayedTrack,
  type PlayerPublic,
  type RoundOutcome,
  type RoundPublic,
  type WsServerMessage,
  LOBBY_PASSWORD_MAX_LENGTH,
} from "@blindmusic/shared"
import type { Track } from "@/deezer"
import { isCloseToAnswer, matchesAnswer } from "@/animeNames"
import { fetchTrackLyrics } from "@/lyrics"
import { normalize, similarity } from "@/game/text"

interface PlayerState {
  id: string
  name: string
  avatarSeed: string
  score: number
  hasFoundArtist: boolean
  hasFoundTitle: boolean
  hasFoundBoth: boolean
  hasFoundYear: boolean
  yearGuessesLeft: number
  roundPoints: number
  /** Last reaction time, to keep emote spam in check. */
  lastReactionAt: number
  connected: boolean
  dropTimer: ReturnType<typeof setTimeout> | null
  /** One entry per finished round, in play order. */
  outcomes: RoundOutcome[]
  /** Discord account behind this player, null for guests. */
  userId: string | null
  /** Quickest title (or anime) find this game, for achievements. */
  fastestFindMs: number | null
  send: (msg: WsServerMessage) => void
}

interface Room {
  code: string
  hostId: string
  phase: GamePhase
  settings: LobbySettings | null
  players: Map<string, PlayerState>
  tracks: Track[]
  currentRoundIndex: number
  roundStartedAt: number
  startsAt: number
  roundTimer: ReturnType<typeof setTimeout> | null
  comboFoundCount: number
  firstBothFoundBy: string | null
  /** Prefetched during the round so the reveal never waits on the network. */
  roundLyrics: string | null
  hintTimers: ReturnType<typeof setTimeout>[]
  /** Bumped on every start, so a background track loader never feeds a newer game. */
  gameId: number
  /** Tracks are still being fetched in the background (anime mode). */
  loadingMore: boolean
  /** How many rounds the host asked for, shown while tracks keep arriving. */
  expectedTotal: number
  /** The reveal is over but the next track is not loaded yet. */
  waitingForTrack: boolean
  /** Tracks for the first round are being fetched, the game has not started yet. */
  preparing: boolean
  /** Required to join through the invite code; null when the room is open. */
  password: string | null
  /** Whether newcomers may join once the game has started. */
  allowLateJoin: boolean
}

/** Avatar strings carry the seed plus the customisation, see the web avatar codec. */
const AVATAR_MAX_LENGTH = 160

function newPlayer(
  id: string,
  name: string,
  avatarSeed: string,
  yearGuessesLeft: number,
  send: (msg: WsServerMessage) => void
): PlayerState {
  return {
    id,
    name,
    avatarSeed: avatarSeed.trim().slice(0, AVATAR_MAX_LENGTH) || name,
    score: 0,
    hasFoundArtist: false,
    hasFoundTitle: false,
    hasFoundBoth: false,
    hasFoundYear: false,
    yearGuessesLeft,
    roundPoints: 0,
    lastReactionAt: 0,
    connected: false,
    dropTimer: null,
    outcomes: [],
    userId: null,
    fastestFindMs: null,
    send,
  }
}

// ponytail: in-memory, single-process; use Redis for multi-instance
export const rooms = new Map<string, Room>()

function broadcast(room: Room, msg: WsServerMessage) {
  for (const p of room.players.values()) {
    try {
      p.send(msg)
    } catch {}
  }
}

function scores(room: Room): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, p] of room.players) out[id] = p.score
  return out
}

function playerNames(room: Room): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [id, p] of room.players) out[id] = p.name
  return out
}

function toPublic(room: Room): PlayerPublic[] {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    avatarSeed: p.avatarSeed,
    score: p.score,
    hasFoundArtist: p.hasFoundArtist,
    hasFoundTitle: p.hasFoundTitle,
    hasFoundBoth: p.hasFoundBoth,
    hasFoundYear: p.hasFoundYear,
    roundPoints: p.roundPoints,
    connected: p.connected,
  }))
}

function lobbyUpdate(room: Room): WsServerMessage {
  return {
    type: "lobby:update",
    players: toPublic(room),
    settings: room.settings,
    phase: room.phase,
    hostId: room.hostId,
  }
}

/** Rounds still loading count towards what the host asked for. */
function roundTotal(room: Room): number {
  return room.loadingMore ? Math.max(room.expectedTotal, room.tracks.length) : room.tracks.length
}

function isAnimeMode(room: Room): boolean {
  return room.settings?.mode === GameMode.Anime
}

function clearHintTimers(room: Room) {
  for (const timer of room.hintTimers) clearTimeout(timer)
  room.hintTimers = []
}

/**
 * With a single input field a player may type just the artist, just the title,
 * or both at once, so a containment hit counts alongside the fuzzy ratio.
 */
function isMatch(normalizedGuess: string, target: string, maxErrorPercent: number): boolean {
  const t = normalize(target)
  if (!normalizedGuess || !t) return false
  if (t.length >= 4 && normalizedGuess.includes(t)) return true
  return similarity(normalizedGuess, t) >= 100 - maxErrorPercent
}

/** How far below the accept threshold still counts as "getting warm". */
const CLOSE_BAND = 22

function isClose(normalizedGuess: string, target: string, maxErrorPercent: number): boolean {
  const accept = 100 - maxErrorPercent
  const sim = similarity(normalizedGuess, normalize(target))
  return sim < accept && sim >= accept - CLOSE_BAND
}

/**
 * Keeps the first letters and masks the rest, preserving word breaks so the
 * shape of the title still reads.
 */
export function buildHint(title: string): string {
  const revealed = Math.max(1, Math.min(4, Math.ceil(title.length / 5)))
  return [...title]
    .map((ch, i) => (i < revealed || ch === " " || ch === "-" ? ch : "•"))
    .join("")
}

export function createRoom(
  code: string,
  hostId: string,
  hostName: string,
  avatarSeed: string,
  send: (msg: WsServerMessage) => void
): Room {
  const room: Room = {
    code,
    hostId,
    phase: GamePhase.Lobby,
    settings: null,
    players: new Map(),
    tracks: [],
    currentRoundIndex: 0,
    roundStartedAt: 0,
    startsAt: 0,
    roundTimer: null,
    comboFoundCount: 0,
    firstBothFoundBy: null,
    roundLyrics: null,
    hintTimers: [],
    gameId: 0,
    loadingMore: false,
    expectedTotal: 0,
    waitingForTrack: false,
    preparing: false,
    password: null,
    allowLateJoin: true,
  }
  room.players.set(hostId, newPlayer(hostId, hostName, avatarSeed, 0, send))
  rooms.set(code, room)
  return room
}

export function addPlayer(
  code: string,
  playerId: string,
  playerName: string,
  avatarSeed: string,
  send: (msg: WsServerMessage) => void
): Room | null {
  const room = rooms.get(code)
  if (!room) return null
  // Late joiners slot in mid-game: they start at zero and play from the current round
  room.players.set(
    playerId,
    newPlayer(playerId, playerName, avatarSeed, room.settings?.yearGuessAttempts ?? 2, send)
  )
  return room
}

export function updateAvatar(code: string, playerId: string, avatarSeed: string) {
  const room = rooms.get(code)
  const player = room?.players.get(playerId)
  if (!room || !player) return
  const seed = avatarSeed.trim().slice(0, AVATAR_MAX_LENGTH)
  if (!seed) return
  player.avatarSeed = seed
  broadcastLobby(code)
}

export function registerSocket(code: string, playerId: string, send: (msg: WsServerMessage) => void): boolean {
  const room = rooms.get(code)
  const player = room?.players.get(playerId)
  if (!player) return false
  // A pending drop means this is a reconnect (lobby -> game navigation, refresh)
  if (player.dropTimer) {
    clearTimeout(player.dropTimer)
    player.dropTimer = null
  }
  player.send = send
  player.connected = true
  return true
}

/**
 * Keeps the player's slot for a grace period instead of dropping them outright,
 * so navigating between pages or refreshing does not kick them out of the game.
 */
export function markDisconnected(
  code: string,
  playerId: string,
  send?: (msg: WsServerMessage) => void
) {
  const room = rooms.get(code)
  const player = room?.players.get(playerId)
  if (!room || !player) return
  // A newer socket already replaced this one (page change, StrictMode, reconnect)
  if (send && player.send !== send) return
  player.connected = false
  player.send = () => {}
  if (player.dropTimer) clearTimeout(player.dropTimer)
  player.dropTimer = setTimeout(() => removePlayer(code, playerId), DISCONNECT_GRACE_MS)
  broadcastLobby(code)
}

export function removePlayer(code: string, playerId: string) {
  const room = rooms.get(code)
  if (!room) return
  const player = room.players.get(playerId)
  if (player?.dropTimer) clearTimeout(player.dropTimer)
  room.players.delete(playerId)
  if (room.players.size === 0) {
    if (room.roundTimer) clearTimeout(room.roundTimer)
    clearHintTimers(room)
    rooms.delete(code)
    return
  }
  // Hand the room over so it never ends up without anyone able to start a game
  if (room.hostId === playerId) {
    room.hostId = room.players.keys().next().value!
    // The new host now manages the password, so they need to see it
    try {
      room.players.get(room.hostId)?.send(accessMessage(room, true))
    } catch {}
  }
  broadcast(room, lobbyUpdate(room))
}

/** Lets a reconnecting client resume mid-round instead of waiting for the next one. */
export function getCurrentRound(code: string): RoundPublic | null {
  const room = rooms.get(code)
  if (!room || room.phase !== GamePhase.Playing || !room.settings) return null
  // Zero means the countdown is still running, no round to resume yet
  if (room.roundStartedAt === 0) return null
  const track = room.tracks[room.currentRoundIndex]
  if (!track) return null
  return {
    trackIndex: room.currentRoundIndex + 1,
    total: roundTotal(room),
    previewUrl: track.previewUrl,
    startedAt: room.roundStartedAt,
    duration: room.settings.roundDuration * 1000,
  }
}

/** Countdown target if the game is starting but the first round has not begun. */
export function getPendingStart(code: string): number | null {
  const room = rooms.get(code)
  if (!room || room.startsAt <= Date.now()) return null
  return room.startsAt
}

export function broadcastLobby(code: string) {
  const room = rooms.get(code)
  if (!room) return
  broadcast(room, lobbyUpdate(room))
}

export function updateSettings(code: string, settings: LobbySettings) {
  const room = rooms.get(code)
  if (!room) return
  room.settings = settings
  broadcast(room, lobbyUpdate(room))
}

export interface StartOptions {
  countdownMs?: number
  /** More tracks will come through appendTracks, until finishTrackLoading. */
  loadingMore?: boolean
}

/** Returns the id of the started game (for appendTracks), or null if it could not start. */
export async function startGame(
  code: string,
  settings: LobbySettings,
  tracks: Track[],
  { countdownMs = COUNTDOWN_MS, loadingMore = false }: StartOptions = {}
): Promise<number | null> {
  const room = rooms.get(code)
  // A finished game can be replayed straight from the lobby on the same code
  if (!room || (room.phase !== GamePhase.Lobby && room.phase !== GamePhase.End)) return null
  if (tracks.length === 0) return null
  room.settings = settings
  room.tracks = tracks
  room.gameId++
  room.loadingMore = loadingMore
  room.expectedTotal = settings.trackCount
  room.waitingForTrack = false
  room.preparing = false
  room.currentRoundIndex = 0
  room.roundStartedAt = 0
  for (const p of room.players.values()) {
    p.score = 0
    p.outcomes = []
    p.fastestFindMs = null
  }
  // Playing from the countdown onwards, so clients landing on the game page
  // during it are not bounced back to the lobby
  room.phase = GamePhase.Playing
  room.startsAt = Date.now() + countdownMs
  broadcast(room, { type: "game:start", startsAt: room.startsAt })
  room.roundTimer = setTimeout(() => startRound(room), countdownMs)
  return room.gameId
}

function accessMessage(room: Room, forHost: boolean): WsServerMessage {
  return {
    type: "lobby:access",
    hasPassword: room.password !== null,
    allowLateJoin: room.allowLateJoin,
    password: forHost ? (room.password ?? "") : undefined,
  }
}

/** Access settings as one player should see them (the host also gets the password). */
export function getAccess(code: string, playerId: string): WsServerMessage | null {
  const room = rooms.get(code)
  return room ? accessMessage(room, room.hostId === playerId) : null
}

export function setAccess(code: string, password: string, allowLateJoin: boolean) {
  const room = rooms.get(code)
  if (!room) return
  const trimmed = password.trim().slice(0, LOBBY_PASSWORD_MAX_LENGTH)
  room.password = trimmed || null
  room.allowLateJoin = allowLateJoin
  for (const p of room.players.values()) {
    try {
      p.send(accessMessage(room, p.id === room.hostId))
    } catch {}
  }
}

export enum JoinRefusal {
  NotFound = "not_found",
  WrongPassword = "wrong_password",
  InProgress = "in_progress",
}

/** Why a newcomer may not join right now, or null if they may. */
export function joinRefusal(code: string, password: string | undefined): JoinRefusal | null {
  const room = rooms.get(code)
  if (!room) return JoinRefusal.NotFound
  if (room.password !== null && (password ?? "") !== room.password) return JoinRefusal.WrongPassword
  const started = room.phase !== GamePhase.Lobby && room.phase !== GamePhase.End
  if (started && !room.allowLateJoin) return JoinRefusal.InProgress
  return null
}

/** Lobby-wide "loading" state while the host's start request fetches tracks. */
export function setPreparing(code: string, active: boolean): boolean {
  const room = rooms.get(code)
  if (!room) return false
  if (active && room.preparing) return false
  room.preparing = active
  broadcast(room, { type: "game:preparing", active })
  return true
}

/** Feeds tracks loaded in the background; false once that game is over or replaced. */
export function appendTracks(code: string, gameId: number, tracks: Track[]): boolean {
  const room = rooms.get(code)
  if (!room || room.gameId !== gameId || !room.loadingMore) return false
  room.tracks.push(...tracks.slice(0, Math.max(0, room.expectedTotal - room.tracks.length)))
  if (room.waitingForTrack) nextRound(room)
  return room.tracks.length < room.expectedTotal
}

/** The background loader is done: the game ends with the tracks it got. */
export function finishTrackLoading(code: string, gameId: number) {
  const room = rooms.get(code)
  if (!room || room.gameId !== gameId || !room.loadingMore) return
  room.loadingMore = false
  if (room.waitingForTrack) nextRound(room)
}

function nextRound(room: Room) {
  room.waitingForTrack = false
  if (room.currentRoundIndex < room.tracks.length) {
    startRound(room)
  } else if (room.loadingMore) {
    // Picked up again by appendTracks or finishTrackLoading
    room.waitingForTrack = true
  } else {
    room.phase = GamePhase.End
    // The room stays alive so everyone can replay on the same code
    broadcast(room, endMessage(room))
    notifyGameEnd(room)
  }
}

function startRound(room: Room) {
  room.phase = GamePhase.Playing
  room.comboFoundCount = 0
  room.firstBothFoundBy = null
  const s = room.settings!
  for (const p of room.players.values()) {
    p.hasFoundArtist = false
    p.hasFoundTitle = false
    p.hasFoundBoth = false
    p.hasFoundYear = false
    p.roundPoints = 0
    p.yearGuessesLeft = s.yearGuessAttempts
  }
  const track = room.tracks[room.currentRoundIndex]
  room.roundStartedAt = Date.now()

  // Warm the lyrics in the background; the answer is only sent at reveal time
  room.roundLyrics = null
  if (s.showLyrics) {
    const requestedIndex = room.currentRoundIndex
    void fetchTrackLyrics(track.artist, track.fullTitle, track.title).then((text) => {
      if (room.currentRoundIndex === requestedIndex) room.roundLyrics = text
    })
  }

  broadcast(room, {
    type: "round:start",
    round: {
      trackIndex: room.currentRoundIndex + 1,
      total: roundTotal(room),
      previewUrl: track.previewUrl,
      startedAt: room.roundStartedAt,
      duration: s.roundDuration * 1000,
    },
  })
  room.roundTimer = setTimeout(() => endRound(room), s.roundDuration * 1000)

  clearHintTimers(room)
  const durationMs = s.roundDuration * 1000
  // Anime mode: no early hint (it would give the year away), the late one masks the anime
  const anime = isAnimeMode(room) ? track.anime : undefined
  const earlyHint = anime ? null : buildHint(track.artist)
  const lateHint = buildHint(anime ? anime.reveal.name : track.title)
  if (s.showArtistHint && earlyHint) {
    room.hintTimers.push(
      setTimeout(
        () => broadcast(room, { type: "round:hint", kind: HintKind.Artist, hint: earlyHint }),
        durationMs * ARTIST_HINT_AT
      )
    )
  }
  if (s.showHint) {
    room.hintTimers.push(
      setTimeout(
        () => broadcast(room, { type: "round:hint", kind: HintKind.Title, hint: lateHint }),
        durationMs * HINT_AT
      )
    )
  }

  // Found markers were just cleared, so refresh what clients display
  broadcastLobby(room.code)
}

function outcomes(room: Room): Record<string, RoundOutcome[]> {
  const out: Record<string, RoundOutcome[]> = {}
  for (const [id, p] of room.players) out[id] = p.outcomes
  return out
}

function playedTracks(room: Room): PlayedTrack[] {
  return room.tracks.map((t) => ({
    title: t.title,
    artist: t.artist,
    year: t.year,
    coverUrl: t.coverUrl,
    anime: t.anime?.reveal,
  }))
}

function endRound(room: Room) {
  // Guard against ending twice (timer firing alongside an early finish)
  if (room.phase !== GamePhase.Playing) return
  if (room.roundTimer) {
    clearTimeout(room.roundTimer)
    room.roundTimer = null
  }
  clearHintTimers(room)

  const track = room.tracks[room.currentRoundIndex]
  room.phase = GamePhase.Reveal

  // Freeze what everyone found, for the dot row and the end-of-game recap
  for (const p of room.players.values()) {
    p.outcomes[room.currentRoundIndex] = {
      artist: p.hasFoundArtist,
      title: p.hasFoundTitle,
      year: p.hasFoundYear,
    }
  }

  const isLast = !room.loadingMore && room.currentRoundIndex + 1 >= room.tracks.length
  broadcast(room, {
    type: "round:reveal",
    artist: track.artist,
    title: track.title,
    year: track.year,
    coverUrl: track.coverUrl,
    lyrics: room.settings?.showLyrics ? room.roundLyrics : null,
    anime: isAnimeMode(room) ? (track.anime?.reveal ?? null) : null,
    scores: scores(room),
    outcomes: outcomes(room),
    nextAt: Date.now() + REVEAL_MS,
    isLast,
  })

  room.currentRoundIndex++
  room.roundTimer = setTimeout(() => nextRound(room), REVEAL_MS)
}

function endMessage(room: Room): WsServerMessage {
  return {
    type: "game:end",
    scores: scores(room),
    playerNames: playerNames(room),
    tracks: playedTracks(room),
    outcomes: outcomes(room),
  }
}

/** Final recap for someone reconnecting after the last round. */
export function getEndSummary(code: string): WsServerMessage | null {
  const room = rooms.get(code)
  if (!room || room.phase !== GamePhase.End) return null
  return endMessage(room)
}

/** Sends everyone back to the lobby, keeping the room and its invite code. */
export function restartToLobby(code: string) {
  const room = rooms.get(code)
  if (!room) return
  if (room.roundTimer) clearTimeout(room.roundTimer)
  clearHintTimers(room)
  room.roundTimer = null
  room.phase = GamePhase.Lobby
  room.tracks = []
  // Detaches any background loader still feeding the previous game
  room.gameId++
  room.loadingMore = false
  room.waitingForTrack = false
  room.currentRoundIndex = 0
  room.roundStartedAt = 0
  room.startsAt = 0
  room.comboFoundCount = 0
  room.firstBothFoundBy = null
  room.roundLyrics = null
  for (const p of room.players.values()) {
    p.score = 0
    p.outcomes = []
    p.fastestFindMs = null
    p.hasFoundArtist = false
    p.hasFoundTitle = false
    p.hasFoundBoth = false
    p.hasFoundYear = false
    p.roundPoints = 0
  }
  broadcastLobby(code)
}

/** Ends the round as soon as every connected player has the artist and the title. */
function endRoundIfAllFound(room: Room) {
  const active = [...room.players.values()].filter((p) => p.connected)
  if (active.length === 0) return
  // Anime mode: the anime alone sets hasFoundBoth, the round waits for the singer bonus too
  const done = (p: PlayerState) => p.hasFoundBoth && (!isAnimeMode(room) || p.hasFoundArtist)
  if (active.every(done)) endRound(room)
}

export interface GuessResult {
  matched: GuessMatch
  pointsEarned: number
  firstBoth: boolean
  yearGuessesLeft: number
  scores: Record<string, number>
  revealedArtist?: string
  revealedTitle?: string
  revealedAnime?: string
}

const ARTIST_POINTS = 5
const TITLE_POINTS = 5
const COMBO_POINTS = 20
const COMBO_DECAY = 2
const YEAR_POINTS = 2

/**
 * Single free-text entry: a 4-digit number is read as a year attempt, anything
 * else is matched against the artist and the title.
 */
export function processGuess(code: string, playerId: string, text: string): GuessResult | null {
  const result = evaluateGuess(code, playerId, text)
  const player = rooms.get(code)?.players.get(playerId)
  if (result && player) player.roundPoints += result.pointsEarned
  return result
}

const REACTION_COOLDOWN_MS = 400

/** True when the player may send a reaction now (a light anti-spam). */
export function allowReaction(code: string, playerId: string): boolean {
  const player = rooms.get(code)?.players.get(playerId)
  if (!player) return false
  const now = Date.now()
  if (now - player.lastReactionAt < REACTION_COOLDOWN_MS) return false
  player.lastReactionAt = now
  return true
}

function evaluateGuess(code: string, playerId: string, text: string): GuessResult | null {
  const room = rooms.get(code)
  const player = room?.players.get(playerId)
  if (!room || !player || room.phase !== GamePhase.Playing) return null

  const raw = text.trim()
  if (!raw) return null

  const track = room.tracks[room.currentRoundIndex]

  if (isAnimeMode(room) && track.anime) return guessAnime(room, player, track, raw)

  if (/^\d{4}$/.test(raw)) {
    return guessYear(room, player, track, Number.parseInt(raw, 10))
  }

  const maxErr = room.settings!.maxErrorPercent
  const guess = normalize(raw)
  const artistMatch = !player.hasFoundArtist && isMatch(guess, track.artist, maxErr)
  const titleMatch = !player.hasFoundTitle && isMatch(guess, track.title, maxErr)

  let pointsEarned = 0
  if (artistMatch) {
    player.hasFoundArtist = true
    pointsEarned += ARTIST_POINTS
  }
  if (titleMatch) {
    player.hasFoundTitle = true
    pointsEarned += TITLE_POINTS
    recordFind(room, player)
  }

  // Completing the pair tops the round up to the combo value, whether the two
  // halves arrived together or across separate guesses.
  let firstBoth = false
  if (player.hasFoundArtist && player.hasFoundTitle && !player.hasFoundBoth) {
    player.hasFoundBoth = true
    const combo = Math.max(0, COMBO_POINTS - room.comboFoundCount * COMBO_DECAY)
    room.comboFoundCount++
    pointsEarned += Math.max(0, combo - ARTIST_POINTS - TITLE_POINTS)
    if (!room.firstBothFoundBy) {
      room.firstBothFoundBy = playerId
      firstBoth = true
    }
  }
  player.score += pointsEarned

  let matched: GuessMatch
  if (artistMatch && titleMatch) matched = GuessMatch.Both
  else if (artistMatch) matched = GuessMatch.Artist
  else if (titleMatch) matched = GuessMatch.Title
  else if (
    (!player.hasFoundArtist && isClose(guess, track.artist, maxErr)) ||
    (!player.hasFoundTitle && isClose(guess, track.title, maxErr))
  ) {
    matched = GuessMatch.Close
  } else matched = GuessMatch.None

  const result: GuessResult = {
    matched,
    pointsEarned,
    firstBoth,
    yearGuessesLeft: player.yearGuessesLeft,
    scores: scores(room),
    revealedArtist: firstBoth ? track.artist : undefined,
    revealedTitle: firstBoth ? track.title : undefined,
  }

  endRoundIfAllFound(room)
  return result
}

function guessYear(room: Room, player: PlayerState, track: Track, year: number): GuessResult {
  const base = {
    firstBoth: false,
    revealedArtist: undefined,
    revealedTitle: undefined,
  }

  // Re-sending the right year must not score again
  if (player.hasFoundYear) {
    return {
      ...base,
      matched: GuessMatch.YearAlreadyFound,
      pointsEarned: 0,
      yearGuessesLeft: player.yearGuessesLeft,
      scores: scores(room),
    }
  }

  if (player.yearGuessesLeft <= 0) {
    return {
      ...base,
      matched: GuessMatch.YearExhausted,
      pointsEarned: 0,
      yearGuessesLeft: 0,
      scores: scores(room),
    }
  }

  player.yearGuessesLeft--
  const correct = year === track.year
  if (correct) {
    player.score += YEAR_POINTS
    player.hasFoundYear = true
  }

  return {
    ...base,
    matched: correct ? GuessMatch.Year : GuessMatch.YearWrong,
    pointsEarned: correct ? YEAR_POINTS : 0,
    yearGuessesLeft: player.yearGuessesLeft,
    scores: scores(room),
  }
}


/** Anime mode: the sooner the anime is found, the more it is worth. */
export function animePoints(elapsedMs: number, durationMs: number): number {
  const left = Math.max(0, Math.min(1, 1 - elapsedMs / durationMs))
  return Math.round(ANIME_MIN_POINTS + (ANIME_MAX_POINTS - ANIME_MIN_POINTS) * left)
}


/**
 * Anime mode: the answer is the anime, worth more the faster it is found.
 * Naming the singer is a bonus, and a 4-digit number is a year attempt.
 */
function guessAnime(room: Room, player: PlayerState, track: Track, raw: string): GuessResult {
  const anime = track.anime!
  if (/^\d{4}$/.test(raw)) {
    return guessYear(room, player, track, Number.parseInt(raw, 10))
  }

  const maxErr = room.settings!.maxErrorPercent
  const guess = normalize(raw)
  const animeMatch = !player.hasFoundBoth && matchesAnswer(raw, anime, maxErr)
  const artistMatch = !player.hasFoundArtist && anime.artists.some((a) => isMatch(guess, a, maxErr))

  let pointsEarned = 0
  let firstBoth = false
  if (animeMatch) {
    // hasFoundBoth carries "found the answer" so the shared round logic keeps working
    player.hasFoundTitle = true
    player.hasFoundBoth = true
    pointsEarned += animePoints(Date.now() - room.roundStartedAt, room.settings!.roundDuration * 1000)
    if (!room.firstBothFoundBy) {
      room.firstBothFoundBy = player.id
      firstBoth = true
    }
    recordFind(room, player)
  }
  if (artistMatch) {
    player.hasFoundArtist = true
    pointsEarned += ANIME_ARTIST_POINTS
  }
  player.score += pointsEarned

  let matched: GuessMatch
  if (animeMatch && artistMatch) matched = GuessMatch.AnimeAndArtist
  else if (animeMatch) matched = GuessMatch.Anime
  else if (artistMatch) matched = GuessMatch.Artist
  else if (
    (!player.hasFoundBoth && isCloseToAnswer(raw, anime, maxErr)) ||
    (!player.hasFoundArtist && anime.artists.some((a) => isClose(guess, a, maxErr)))
  ) {
    matched = GuessMatch.Close
  } else matched = GuessMatch.None

  const result: GuessResult = {
    matched,
    pointsEarned,
    firstBoth,
    yearGuessesLeft: player.yearGuessesLeft,
    scores: scores(room),
    revealedAnime: animeMatch ? anime.reveal.name : undefined,
    revealedArtist: artistMatch ? track.artist : undefined,
  }
  endRoundIfAllFound(room)
  return result
}

function recordFind(room: Room, player: PlayerState) {
  const elapsed = Date.now() - room.roundStartedAt
  if (player.fastestFindMs === null || elapsed < player.fastestFindMs) player.fastestFindMs = elapsed
}

/** Ties the player to a logged-in account so the game lands in their history. */
export function linkUser(code: string, playerId: string, userId: string | null) {
  const player = rooms.get(code)?.players.get(playerId)
  if (player) player.userId = userId
}

/** Room membership of an account, to check that an inviter is really in the lobby. */
export function isUserInRoom(code: string, userId: string): boolean {
  const room = rooms.get(code)
  if (!room) return false
  for (const p of room.players.values()) if (p.userId === userId) return true
  return false
}

export interface GameEndPlayer {
  playerId: string
  userId: string | null
  name: string
  score: number
  /** 1 for the best score, ties share a rank. */
  rank: number
  outcomes: RoundOutcome[]
  fastestFindMs: number | null
  team: string | null
  teamWon: boolean | null
}

export interface GameEndSummary {
  code: string
  mode: GameMode
  roundCount: number
  players: GameEndPlayer[]
}

/** Team mode lives on another branch: read the team duck-typed so this keeps compiling either way. */
function teamOf(player: PlayerState): string | null {
  const team = (player as { team?: unknown }).team
  if (typeof team === "string" && team) return team
  return typeof team === "number" ? String(team) : null
}

export function gameSummary(room: Room): GameEndSummary {
  const players = [...room.players.values()]
  const teamScores = new Map<string, number>()
  for (const p of players) {
    const team = teamOf(p)
    if (team) teamScores.set(team, (teamScores.get(team) ?? 0) + p.score)
  }
  const bestTeamScore = Math.max(...teamScores.values())
  const winningTeams = [...teamScores].filter(([, score]) => score === bestTeamScore).map(([team]) => team)
  const winningTeam = teamScores.size >= 2 && winningTeams.length === 1 ? winningTeams[0] : null
  return {
    code: room.code,
    mode: room.settings?.mode ?? GameMode.Classic,
    roundCount: room.tracks.length,
    players: players.map((p) => {
      const team = teamOf(p)
      return {
        playerId: p.id,
        userId: p.userId,
        name: p.name,
        score: p.score,
        rank: 1 + players.filter((other) => other.score > p.score).length,
        outcomes: [...p.outcomes],
        fastestFindMs: p.fastestFindMs,
        team,
        teamWon: team && teamScores.size >= 2 ? team === winningTeam : null,
      }
    }),
  }
}

type GameEndListener = (summary: GameEndSummary) => void
const gameEndListeners: GameEndListener[] = []

/** Called once per finished game (accounts persist history and achievements from it). */
export function onGameEnd(listener: GameEndListener): () => void {
  gameEndListeners.push(listener)
  return () => {
    const index = gameEndListeners.indexOf(listener)
    if (index >= 0) gameEndListeners.splice(index, 1)
  }
}

function notifyGameEnd(room: Room) {
  if (gameEndListeners.length === 0) return
  const summary = gameSummary(room)
  for (const listener of gameEndListeners) {
    try {
      listener(summary)
    } catch {}
  }
}
