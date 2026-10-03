import { isTeam, Team } from "@blindmusic/shared"
import { TeamResult } from "@/utils/teams"

export interface UserProfile {
  name: string
  avatarSeed: string
}

export interface HistoryTrack {
  title: string
  artist: string
  year: number
}

export interface GameHistoryEntry {
  playedAt: number
  code: string
  rank: number
  score: number
  playerCount: number
  tracks: HistoryTrack[]
  /** Team mode only: the side played for and how it ended. */
  team?: HistoryTeam
}

export interface HistoryTeam {
  team: Team
  result: TeamResult
  blue: number
  red: number
}

enum StorageKey {
  Profile = "blindtest:profile",
  History = "blindtest:history",
}

const HISTORY_LIMIT = 20

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readJson(key: StorageKey): unknown {
  const raw = localStorage.getItem(key)
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    return value
  } catch {
    return null
  }
}

export function loadProfile(): UserProfile {
  const value = readJson(StorageKey.Profile)
  const name = isRecord(value) && typeof value.name === "string" ? value.name : ""
  const storedSeed = isRecord(value) && typeof value.avatarSeed === "string" ? value.avatarSeed : ""
  const profile = { name, avatarSeed: storedSeed || crypto.randomUUID() }
  localStorage.setItem(StorageKey.Profile, JSON.stringify(profile))
  return profile
}

export function saveProfile(profile: UserProfile) {
  localStorage.setItem(StorageKey.Profile, JSON.stringify(profile))
}

function readTrack(value: unknown): HistoryTrack | null {
  if (!isRecord(value)) return null
  if (typeof value.title !== "string" || typeof value.artist !== "string" || typeof value.year !== "number") return null
  return { title: value.title, artist: value.artist, year: value.year }
}

function readTeam(value: unknown): HistoryTeam | undefined {
  if (!isRecord(value) || !isTeam(value.team)) return undefined
  const result = Object.values(TeamResult).find((r) => r === value.result)
  if (!result || typeof value.blue !== "number" || typeof value.red !== "number") return undefined
  return { team: value.team, result, blue: value.blue, red: value.red }
}

function readEntry(value: unknown): GameHistoryEntry | null {
  if (!isRecord(value)) return null
  if (typeof value.playedAt !== "number" || typeof value.code !== "string") return null
  if (typeof value.rank !== "number" || typeof value.score !== "number" || typeof value.playerCount !== "number") {
    return null
  }
  if (!Array.isArray(value.tracks)) return null
  const tracks: HistoryTrack[] = []
  for (const item of value.tracks) {
    const track = readTrack(item)
    if (track) tracks.push(track)
  }
  return {
    playedAt: value.playedAt,
    code: value.code,
    rank: value.rank,
    score: value.score,
    playerCount: value.playerCount,
    tracks,
    team: readTeam(value.team),
  }
}

export function loadHistory(): GameHistoryEntry[] {
  const value = readJson(StorageKey.History)
  if (!Array.isArray(value)) return []
  const entries: GameHistoryEntry[] = []
  for (const item of value) {
    const entry = readEntry(item)
    if (entry) entries.push(entry)
  }
  return entries
}

export function appendHistory(entry: GameHistoryEntry) {
  const next = [entry, ...loadHistory()].slice(0, HISTORY_LIMIT)
  localStorage.setItem(StorageKey.History, JSON.stringify(next))
}
