import { decadeOf } from "./filters"
import { JsonlCache, Throttle, fetchRetry, sleep } from "@/http"
import type { Candidate } from "./score"

const API = "https://api.deezer.com"
/** Deezer allows about 50 calls per 5 seconds; stay well under. */
const throttle = new Throttle(150)

export interface DeezerTrack {
  id: number
  readable?: boolean
  title?: string
  title_short?: string
  isrc?: string
  rank?: number
  preview?: string
  release_date?: string
  md5_image?: string
  artist?: { name?: string }
  album?: { md5_image?: string; release_date?: string }
  error?: { code?: number; type?: string; message?: string }
}

/** Deezer reports errors with a 200 status and an `error` object. */
async function getJson<T>(path: string, attempt = 0): Promise<T | null> {
  const response = await fetchRetry(`${API}${path}`, { throttle, retries: 4 })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Deezer ${response.status} on ${path}`)
  const body = (await response.json()) as T & { error?: { code?: number } }
  if (body?.error) {
    // 4 = quota exceeded: wait and retry; 800 = no data; anything else is a miss
    if (body.error.code === 4 && attempt < 5) {
      await sleep(5000 * (attempt + 1))
      return getJson(path, attempt + 1)
    }
    return null
  }
  return body
}

/** Only tracks a player can actually hear: readable and with a preview. */
export function isPlayable(track: DeezerTrack | null): track is DeezerTrack & { isrc: string } {
  return !!track && track.readable === true && !!track.preview && !!track.title && !!track.artist?.name
}

export function toCandidate(
  track: DeezerTrack,
  extra: { isrc: string; recordingMbid?: string | null; listens?: number | null; genre?: string | null }
): Candidate {
  return {
    isrc: extra.isrc,
    recordingMbid: extra.recordingMbid ?? null,
    deezerTrackId: track.id,
    title: track.title_short || track.title || "",
    artistName: track.artist?.name ?? "",
    deezerMd5Image: track.md5_image || track.album?.md5_image || null,
    deezerRank: typeof track.rank === "number" && track.rank > 0 ? track.rank : null,
    listens: extra.listens ?? null,
    genre: extra.genre ?? null,
    decade: decadeOf(track.release_date ?? track.album?.release_date),
  }
}

export async function trackByIsrc(isrc: string, cache: JsonlCache<DeezerTrack>): Promise<DeezerTrack | null> {
  const key = `isrc:${isrc}`
  if (cache.has(key)) return cache.get(key)
  const track = await getJson<DeezerTrack>(`/track/isrc:${encodeURIComponent(isrc)}`)
  cache.set(key, track)
  return track
}

export async function trackById(id: number, cache: JsonlCache<DeezerTrack>): Promise<DeezerTrack | null> {
  const key = `id:${id}`
  if (cache.has(key)) return cache.get(key)
  const track = await getJson<DeezerTrack>(`/track/${id}`)
  cache.set(key, track)
  return track
}

interface TrackList {
  data?: DeezerTrack[]
  next?: string
}

/** Track ids of a chart or a playlist, following Deezer's pagination. */
export async function listTrackIds(path: string, max = 500): Promise<number[]> {
  const ids: number[] = []
  let next: string | null = `${path}${path.includes("?") ? "&" : "?"}limit=100`
  while (next && ids.length < max) {
    const page: TrackList | null = await getJson<TrackList>(next)
    if (!page?.data) break
    for (const track of page.data) ids.push(track.id)
    next = page.next ? page.next.replace(API, "") : null
  }
  return ids
}
