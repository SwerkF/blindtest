import type { DeezerPlaylistMeta, GameMode, GamePhase } from "@blindmusic/shared"

const BASE = "/api"

export interface PlaylistItem {
  id: string
  name: string
  slug: string
  description: string | null
  coverUrl: string | null
  trackCount: number
  category: GameMode
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The room is password protected and the given one was missing or wrong. */
    readonly needsPassword = false
  ) {
    super(message)
  }
}

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: "Erreur réseau" }))) as {
      error?: string
      needsPassword?: boolean
    }
    throw new ApiError(err.error ?? "Erreur", res.status, Boolean(err.needsPassword))
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  playlists: () => req<PlaylistItem[]>("/playlists"),

  createLobby: (playerName: string, avatarSeed: string) =>
    req<{ code: string; playerId: string; playerName: string }>("/lobbies", {
      method: "POST",
      body: JSON.stringify({ playerName, avatarSeed }),
    }),

  joinLobby: (code: string, playerName: string, avatarSeed: string, password?: string) =>
    req<{ code: string; playerId: string; playerName: string }>(`/lobbies/${code}/join`, {
      method: "POST",
      body: JSON.stringify({ playerName, avatarSeed, password }),
    }),

  lobbyInfo: (code: string) =>
    req<{ code: string; phase: GamePhase; playerCount: number; hasPassword: boolean; allowLateJoin: boolean }>(
      `/lobbies/${code}`
    ),

  deezerPlaylist: (id: string) => req<DeezerPlaylistMeta>(`/deezer/playlists/${id}`),

  suggestPlaylist: (name: string, url: string) =>
    req<void>("/playlist-suggestions", {
      method: "POST",
      body: JSON.stringify({ name, url }),
    }),
}

export function wsUrl(code: string, playerId: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws"
  return `${proto}://${location.host}/ws?code=${code}&playerId=${playerId}`
}

export function inviteUrl(code: string): string {
  return `${location.origin}/join/${code}`
}

export function saveSession(code: string, playerId: string, playerName: string) {
  sessionStorage.setItem(`blindtest:${code}`, JSON.stringify({ playerId, playerName }))
}

export function clearSession(code: string) {
  sessionStorage.removeItem(`blindtest:${code}`)
}

export function loadSession(code: string): { playerId: string; playerName: string } | null {
  const raw = sessionStorage.getItem(`blindtest:${code}`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as { playerId: string; playerName: string }
  } catch {
    return null
  }
}
