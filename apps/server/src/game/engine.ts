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
  ThemeType,
  type AnimeReveal,
  type LobbySettings,
  type PlayedTrack,
  type PlayerPublic,
  type RoundOutcome,
  type RoundPublic,
  type WsServerMessage,
} from "@blindmusic/shared"
import type { Track } from "@/deezer"
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
  /** Anime mode: the OP/ED number bonus. */
  hasFoundTheme: boolean
  themeGuessesLeft: number
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
    hasFoundTheme: false,
    themeGuessesLeft: yearGuessesLeft,
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
    p.hasFoundTheme = false
    p.themeGuessesLeft = s.yearGuessAttempts
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
  // Anime mode: the early hint is when the anime aired, the late one masks its name
  const anime = isAnimeMode(room) ? track.anime : undefined
  const earlyHint = anime ? airedHint(anime.reveal) : buildHint(track.artist)
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

const SEASON_LABEL: Record<string, string> = {
  winter: "Hiver",
  spring: "Printemps",
  summer: "Été",
  fall: "Automne",
}

function airedHint(anime: AnimeReveal): string {
  const season = anime.season ? SEASON_LABEL[anime.season.toLowerCase()] : undefined
  return [season, anime.year].filter(Boolean).join(" ")
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
      theme: p.hasFoundTheme,
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
    anime: isAnimeMode(room) ? (track.anime?.reveal ?? null) : null,
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
    p.hasFoundTheme = false
  }
  broadcastLobby(code)
}

/** Ends the round as soon as every connected player has the artist and the title. */
function endRoundIfAllFound(room: Room) {
  const active = [...room.players.values()].filter((p) => p.connected)
  if (active.length === 0) return
  // Anime mode leaves room for the OP/ED number bonus once the anime is found
  const done = (p: PlayerState) =>
    p.hasFoundBoth && (!isAnimeMode(room) || p.hasFoundTheme || p.themeGuessesLeft <= 0)
  if (active.every(done)) endRound(room)
}

export interface GuessResult {
  matched: GuessMatch
  pointsEarned: number
  firstBoth: boolean
  yearGuessesLeft: number
  themeGuessesLeft: number
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
const THEME_POINTS = 3

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
    themeGuessesLeft: player.themeGuessesLeft,
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
    themeGuessesLeft: player.themeGuessesLeft,
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


/** "op2", "opening 2", "ED", "ending #1"... */
const THEME_GUESS = /^(op|opening|ed|ending)\s*(?:n°|no\.?|#)?\s*(\d{1,2})?$/i

/**
 * Anime mode: the answer is the anime, whatever the song or singer. A theme
 * number ("OP2") is a limited-try bonus, and the year a regular bonus.
 */
function guessAnime(room: Room, player: PlayerState, track: Track, raw: string): GuessResult {
  const anime = track.anime!
  const themeGuess = raw.match(THEME_GUESS)
  if (themeGuess) {
    const type = themeGuess[1].toLowerCase().startsWith("o") ? ThemeType.Opening : ThemeType.Ending
    return guessTheme(room, player, anime.reveal, type, themeGuess[2] ? Number(themeGuess[2]) : null)
  }
  if (/^\d{4}$/.test(raw)) {
    return guessYear(room, player, track, Number.parseInt(raw, 10))
  }

  const maxErr = room.settings!.maxErrorPercent
  const guess = normalize(raw)
  const base = {
    yearGuessesLeft: player.yearGuessesLeft,
    themeGuessesLeft: player.themeGuessesLeft,
  }

  if (player.hasFoundBoth) {
    return { ...base, matched: GuessMatch.None, pointsEarned: 0, firstBoth: false, scores: scores(room) }
  }

  if (anime.names.some((name) => isMatch(guess, name, maxErr))) {
    // Finding the anime is the whole round: it fills both found markers
    player.hasFoundArtist = true
    player.hasFoundTitle = true
    player.hasFoundBoth = true
    const pointsEarned = Math.max(0, COMBO_POINTS - room.comboFoundCount * COMBO_DECAY)
    room.comboFoundCount++
    player.score += pointsEarned
    const firstBoth = !room.firstBothFoundBy
    if (firstBoth) room.firstBothFoundBy = player.id
    const result: GuessResult = {
      ...base,
      matched: GuessMatch.Anime,
      pointsEarned,
      firstBoth,
      scores: scores(room),
      revealedAnime: anime.reveal.name,
    }
    endRoundIfAllFound(room)
    return result
  }

  const close = anime.names.some((name) => isClose(guess, name, maxErr))
  return {
    ...base,
    matched: close ? GuessMatch.Close : GuessMatch.None,
    pointsEarned: 0,
    firstBoth: false,
    scores: scores(room),
  }
}

function guessTheme(
  room: Room,
  player: PlayerState,
  anime: AnimeReveal,
  type: ThemeType,
  sequence: number | null
): GuessResult {
  const base = { firstBoth: false, yearGuessesLeft: player.yearGuessesLeft, scores: scores(room) }
  if (player.hasFoundTheme) {
    return { ...base, matched: GuessMatch.ThemeAlreadyFound, pointsEarned: 0, themeGuessesLeft: player.themeGuessesLeft }
  }
  if (player.themeGuessesLeft <= 0) {
    return { ...base, matched: GuessMatch.ThemeExhausted, pointsEarned: 0, themeGuessesLeft: 0 }
  }

  player.themeGuessesLeft--
  // An unnumbered theme is the anime's only one of its kind, so "OP" and "OP1" both fit it
  const correct = anime.themes.some(
    (t) => t.type === type && (t.sequence === sequence || (t.sequence === null && (sequence ?? 1) === 1))
  )
  if (correct) {
    player.hasFoundTheme = true
    player.score += THEME_POINTS
  }
  const result: GuessResult = {
    ...base,
    matched: correct ? GuessMatch.Theme : GuessMatch.ThemeWrong,
    pointsEarned: correct ? THEME_POINTS : 0,
    themeGuessesLeft: player.themeGuessesLeft,
    scores: scores(room),
  }
  endRoundIfAllFound(room)
  return result
}
