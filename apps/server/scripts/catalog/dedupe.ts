import { songKey } from "./filters"
import type { Candidate, CatalogEntry } from "./score"

export interface Collision {
  deezerTrackId: number
  kept: string
  dropped: string
}

/**
 * Several ISRCs or MBIDs can lead to the same Deezer track; the unique index on
 * deezerTrackId would reject the import. Keeps the best popularity score and
 * reports every collision so the run log shows what was merged.
 */
export function dedupeByDeezerTrack(
  entries: CatalogEntry[],
  log: (message: string) => void = console.warn
): { entries: CatalogEntry[]; collisions: Collision[] } {
  const best = new Map<number, CatalogEntry>()
  const collisions: Collision[] = []
  for (const entry of entries) {
    const current = best.get(entry.deezerTrackId)
    if (!current) {
      best.set(entry.deezerTrackId, entry)
      continue
    }
    const keep = entry.popularityScore > current.popularityScore ? entry : current
    const drop = keep === entry ? current : entry
    best.set(entry.deezerTrackId, keep)
    collisions.push({ deezerTrackId: entry.deezerTrackId, kept: keep.isrc, dropped: drop.isrc })
    log(`[catalog] collision deezerTrackId=${entry.deezerTrackId} gardé isrc=${keep.isrc} écarté isrc=${drop.isrc}`)
  }
  return { entries: [...best.values()], collisions }
}

/** One recording per song: the most listened version of a (title, artist) pair wins. */
export function dedupeBySong<T extends { title: string; artist: string; listens: number }>(rows: T[]): T[] {
  const best = new Map<string, T>()
  for (const row of rows) {
    const key = songKey(row.title, row.artist)
    const current = best.get(key)
    if (!current || row.listens > current.listens) best.set(key, row)
  }
  return [...best.values()]
}

/** Same ISRC seen from two sources: keep the candidate that has the most signals. */
export function dedupeByIsrc(candidates: Candidate[]): Candidate[] {
  const best = new Map<string, Candidate>()
  for (const c of candidates) {
    const current = best.get(c.isrc)
    const signals = (x: Candidate) => (x.listens !== null ? 1 : 0) + (x.deezerRank !== null ? 1 : 0)
    if (!current || signals(c) > signals(current)) best.set(c.isrc, c)
  }
  return [...best.values()]
}
