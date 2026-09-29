import type { AnimeReveal, DeezerPlaylistMeta } from "@blindmusic/shared"

export interface Track {
  id: number
  /** Cleaned title: what players have to guess and what is displayed. */
  title: string
  /** Original Deezer title, kept because lyrics providers index it. */
  fullTitle: string
  artist: string
  year: number
  previewUrl: string
  coverUrl: string | null
  /** Anime mode: the anime this theme song was matched to on AnimeThemes. */
  anime?: AnimeMatch
}

export interface AnimeMatch {
  /** Every accepted answer: canonical names, synonyms and their base titles. */
  names: string[]
  reveal: AnimeReveal
}

interface DeezerArtist {
  name: string
}

interface DeezerAlbum {
  cover_medium?: string
  cover_big?: string
}

interface DeezerPlaylistTrack {
  id: number
  title: string
  title_short?: string
  preview: string
  artist: DeezerArtist
  album?: DeezerAlbum
}

interface DeezerPlaylistPage {
  data: DeezerPlaylistTrack[]
  next?: string
}

interface DeezerTrackDetail {
  release_date?: string
  album?: { release_date?: string }
}

const API = "https://api.deezer.com"

/**
 * Turns "Alors on danse (Radio Edit)" into "Alors on danse" so the answer is
 * actually guessable. Deezer's title_short drops the version suffix; bracketed
 * groups and "feat."/remix tails are stripped on top of that.
 */
export function cleanTitle(track: { title: string; title_short?: string }): string {
  const base = track.title_short?.trim() || track.title

  // Peel bracket groups from the innermost outwards, so nested ones like
  // "[The Official ... (TM) Song]" do not leave dangling fragments behind.
  let stripped = base
  for (let pass = 0; pass < 5; pass++) {
    const next = stripped.replace(/\s*[([{][^()[\]{}]*[)\]}]/g, "")
    if (next === stripped) break
    stripped = next
  }

  stripped = stripped
    .replace(/\s*[-–—]\s*(radio edit|remix|remaster(ed)?|version|edit|live|single|mix|bonus track).*$/i, "")
    .replace(/\s*\b(feat|ft|featuring)\b\.?\s.*$/i, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()

  return stripped || base.trim()
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Deezer ${res.status} on ${url}`)
  return res.json() as Promise<T>
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

interface DeezerPlaylistInfo {
  id?: number
  title?: string
  nb_tracks?: number
  picture_medium?: string
  picture_big?: string
  error?: { message?: string }
}

export async function fetchPlaylistMeta(playlistId: string): Promise<DeezerPlaylistMeta | null> {
  if (!/^\d+$/.test(playlistId)) return null
  try {
    const data = await fetchJson<DeezerPlaylistInfo>(`${API}/playlist/${playlistId}`)
    if (data.error || data.id === undefined || !data.title) return null
    return {
      id: String(data.id),
      name: data.title,
      coverUrl: data.picture_medium ?? data.picture_big ?? null,
      trackCount: data.nb_tracks ?? 0,
    }
  } catch {
    return null
  }
}

async function fetchYear(trackId: number): Promise<number> {
  const detail = await fetchJson<DeezerTrackDetail>(`${API}/track/${trackId}`)
  const raw = detail.release_date ?? detail.album?.release_date
  const year = raw ? Number.parseInt(raw.slice(0, 4), 10) : Number.NaN
  return Number.isFinite(year) ? year : 0
}

async function fetchPlayableTracks(playlistId: string): Promise<DeezerPlaylistTrack[]> {
  const playable: DeezerPlaylistTrack[] = []
  let url: string | undefined = `${API}/playlist/${playlistId}/tracks?limit=100`

  while (url) {
    const page: DeezerPlaylistPage = await fetchJson<DeezerPlaylistPage>(url)
    for (const t of page.data) {
      if (t.preview && t.title && t.artist?.name) playable.push(t)
    }
    url = page.next
  }
  return playable
}

function toTrack(t: DeezerPlaylistTrack, year: number): Track {
  return {
    id: t.id,
    title: cleanTitle(t),
    fullTitle: t.title,
    artist: t.artist.name,
    year,
    previewUrl: t.preview,
    coverUrl: t.album?.cover_big ?? t.album?.cover_medium ?? null,
  }
}

/** Every playable track of the playlists, deduplicated and shuffled, year left unresolved. */
export async function fetchTrackPool(playlistIds: string[]): Promise<Track[]> {
  const pages = await Promise.all(playlistIds.map((id) => fetchPlayableTracks(id).catch(() => [])))

  const byId = new Map<number, DeezerPlaylistTrack>()
  for (const page of pages) {
    for (const t of page) byId.set(t.id, t)
  }
  return shuffle([...byId.values()]).map((t) => toTrack(t, 0))
}

/**
 * Returns up to `count` tracks pooled from every playlist. Preview URLs are
 * signed and expire after ~20min, so they are fetched at game start rather
 * than cached.
 */
export async function pickRandomTracks(playlistIds: string[], count: number): Promise<Track[]> {
  const selected = (await fetchTrackPool(playlistIds)).slice(0, count)
  const years = await Promise.all(selected.map((t) => fetchYear(t.id).catch(() => 0)))
  return selected.map((t, i) => ({ ...t, year: years[i] }))
}
