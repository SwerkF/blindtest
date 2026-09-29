import {
  ARTIST_HINT_AT,
  COUNTDOWN_MS,
  DISCONNECT_GRACE_MS,
  GamePhase,
  GuessMatch,
  HINT_AT,
  HintKind,
  REVEAL_MS,
  type LobbySettings,
  type PlayedTrack,
  type PlayerPublic,
  type RoundOutcome,
  type RoundPublic,
  type WsServerMessage,
} from "@blindmusic/shared"
import type { Track } from "@/deezer"
import { fetchTrackLyrics } from "@/lyrics"

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
  connected: boolean
  dropTimer: ReturnType<typeof setTimeout> | null
  /** One entry per finished round, in play order. */
  outcomes: RoundOutcome[]
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
    connected: false,
    dropTimer: null,
    outcomes: [],
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

function clearHintTimers(room: Room) {
  for (const timer of room.hintTimers) clearTimeout(timer)
  room.hintTimers = []
}

// ponytail: O(n*m) Levenshtein, fine for song name lengths
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[m][n]
}

/** Lowercase, strip accents, drop punctuation and bracketed extras. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
}

function similarity(a: string, b: string): number {
  if (a === b) return 100
  if (!a || !b) return 0
  return Math.round((1 - levenshtein(a, b) / Math.max(a.length, b.length)) * 100)
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
  if (room.hostId === playerId) room.hostId = room.players.keys().next().value!
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
    total: room.tracks.length,
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

export async function startGame(
  code: string,
  settings: LobbySettings,
  tracks: Track[],
  countdownMs: number = COUNTDOWN_MS
): Promise<boolean> {
  const room = rooms.get(code)
  // A finished game can be replayed straight from the lobby on the same code
  if (!room || (room.phase !== GamePhase.Lobby && room.phase !== GamePhase.End)) return false
  if (tracks.length === 0) return false
  room.settings = settings
  room.tracks = tracks
  room.currentRoundIndex = 0
  room.roundStartedAt = 0
  for (const p of room.players.values()) {
    p.score = 0
    p.outcomes = []
  }
  // Playing from the countdown onwards, so clients landing on the game page
  // during it are not bounced back to the lobby
  room.phase = GamePhase.Playing
  room.startsAt = Date.now() + countdownMs
  broadcast(room, { type: "game:start", startsAt: room.startsAt })
  room.roundTimer = setTimeout(() => startRound(room), countdownMs)
  return true
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
      total: room.tracks.length,
      previewUrl: track.previewUrl,
      startedAt: room.roundStartedAt,
      duration: s.roundDuration * 1000,
    },
  })
  room.roundTimer = setTimeout(() => endRound(room), s.roundDuration * 1000)

  clearHintTimers(room)
  const durationMs = s.roundDuration * 1000
  if (s.showArtistHint) {
    room.hintTimers.push(
      setTimeout(
        () => broadcast(room, { type: "round:hint", kind: HintKind.Artist, hint: buildHint(track.artist) }),
        durationMs * ARTIST_HINT_AT
      )
    )
  }
  if (s.showHint) {
    room.hintTimers.push(
      setTimeout(
        () => broadcast(room, { type: "round:hint", kind: HintKind.Title, hint: buildHint(track.title) }),
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

  const isLast = room.currentRoundIndex + 1 >= room.tracks.length
  broadcast(room, {
    type: "round:reveal",
    artist: track.artist,
    title: track.title,
    year: track.year,
    coverUrl: track.coverUrl,
    lyrics: room.settings?.showLyrics ? room.roundLyrics : null,
    scores: scores(room),
    outcomes: outcomes(room),
    nextAt: Date.now() + REVEAL_MS,
    isLast,
  })

  room.currentRoundIndex++
  room.roundTimer = setTimeout(() => {
    if (room.currentRoundIndex >= room.tracks.length) {
      room.phase = GamePhase.End
      // The room stays alive so everyone can replay on the same code
      broadcast(room, endMessage(room))
    } else {
      startRound(room)
    }
  }, REVEAL_MS)
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
  room.currentRoundIndex = 0
  room.roundStartedAt = 0
  room.startsAt = 0
  room.comboFoundCount = 0
  room.firstBothFoundBy = null
  room.roundLyrics = null
  for (const p of room.players.values()) {
    p.score = 0
    p.outcomes = []
    p.hasFoundArtist = false
    p.hasFoundTitle = false
    p.hasFoundBoth = false
    p.hasFoundYear = false
  }
  broadcastLobby(code)
}

/** Ends the round as soon as every connected player has the artist and the title. */
function endRoundIfAllFound(room: Room) {
  const active = [...room.players.values()].filter((p) => p.connected)
  if (active.length === 0) return
  if (active.every((p) => p.hasFoundBoth)) endRound(room)
}

export interface GuessResult {
  matched: GuessMatch
  pointsEarned: number
  firstBoth: boolean
  yearGuessesLeft: number
  scores: Record<string, number>
  revealedArtist?: string
  revealedTitle?: string
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
  const room = rooms.get(code)
  const player = room?.players.get(playerId)
  if (!room || !player || room.phase !== GamePhase.Playing) return null

  const raw = text.trim()
  if (!raw) return null

  const track = room.tracks[room.currentRoundIndex]

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

