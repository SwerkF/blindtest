import { rarityFromPercentile, type CardRarity } from "@blindmusic/shared"

/** A playable track, whatever source it came from. Titles and covers are as Deezer gives them. */
export interface Candidate {
  isrc: string
  recordingMbid: string | null
  deezerTrackId: number
  title: string
  artistName: string
  deezerMd5Image: string | null
  /** Deezer popularity rank (higher = more popular), null when unknown. */
  deezerRank: number | null
  /** ListenBrainz total listens, null when MusicBrainz/ListenBrainz do not know the track. */
  listens: number | null
  genre: string | null
  decade: string | null
}

export interface CatalogEntry {
  isrc: string
  recordingMbid: string | null
  deezerTrackId: number
  title: string
  artistName: string
  deezerMd5Image: string | null
  rarity: CardRarity
  popularityScore: number
  pools: string[]
}

export const MIN_POOL_SIZE = 200
export const GLOBAL_POOL = "global"
export const DEEZER_WEIGHT = 0.6
export const LISTENBRAINZ_WEIGHT = 0.4

/**
 * Percentile (0-100) of each value among all values; ties share the middle of
 * their range, so the best of 100 distinct values scores 99.5 and the worst 0.5.
 */
export function percentiles(values: number[]): number[] {
  const n = values.length
  if (n === 0) return []
  const sorted = [...values].sort((a, b) => a - b)
  const lower = (value: number) => {
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid]! < value) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const upper = (value: number) => {
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid]! <= value) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  return values.map((value) => {
    const below = lower(value)
    const equal = upper(value) - below
    return ((below + equal / 2) / n) * 100
  })
}

/**
 * Pool a candidate is ranked in: its genre, else its decade, else everything.
 * A pool smaller than MIN_POOL_SIZE has too few tracks for percentiles to mean anything.
 */
export function primaryPool(c: Candidate, sizes: Map<string, number>, minSize = MIN_POOL_SIZE): string {
  for (const pool of [c.genre ? `genre:${c.genre}` : null, c.decade ? `decade:${c.decade}` : null]) {
    if (pool && (sizes.get(pool) ?? 0) >= minSize) return pool
  }
  return GLOBAL_POOL
}

function poolsOf(c: Candidate): string[] {
  return [c.genre ? `genre:${c.genre}` : null, c.decade ? `decade:${c.decade}` : null].filter(
    (p): p is string => p !== null
  )
}

/**
 * Popularity score (0-100) of every candidate inside its pool: weighted mean of the
 * Deezer-rank percentile and the ListenBrainz-listens percentile. A missing
 * signal (recent French rap unknown to ListenBrainz) is left out, not counted as zero.
 */
export function popularityScores(candidates: Candidate[], pools: string[]): number[] {
  const scores = new Array<number>(candidates.length).fill(0)
  const byPool = new Map<string, number[]>()
  pools.forEach((pool, index) => byPool.set(pool, [...(byPool.get(pool) ?? []), index]))
  for (const indexes of byPool.values()) {
    const rankPct = signalPercentiles(indexes, (i) => candidates[i]!.deezerRank)
    const listenPct = signalPercentiles(indexes, (i) => {
      const listens = candidates[i]!.listens
      return listens === null ? null : Math.log1p(listens)
    })
    for (const i of indexes) {
      const parts: [number, number][] = []
      if (rankPct.has(i)) parts.push([rankPct.get(i)!, DEEZER_WEIGHT])
      if (listenPct.has(i)) parts.push([listenPct.get(i)!, LISTENBRAINZ_WEIGHT])
      const weight = parts.reduce((sum, [, w]) => sum + w, 0)
      scores[i] = weight > 0 ? parts.reduce((sum, [value, w]) => sum + value * w, 0) / weight : 0
    }
  }
  return scores
}

function signalPercentiles(indexes: number[], read: (index: number) => number | null): Map<number, number> {
  const known = indexes.filter((i) => read(i) !== null)
  const result = percentiles(known.map((i) => read(i)!))
  return new Map(known.map((index, position) => [index, result[position]!]))
}

/**
 * Catalogue entries with their frozen rarity: percentile of the popularity score
 * inside the primary pool, then the CARD_PERCENTILES thresholds.
 */
export function buildEntries(candidates: Candidate[], minPoolSize = MIN_POOL_SIZE): CatalogEntry[] {
  const sizes = new Map<string, number>()
  for (const c of candidates) for (const pool of poolsOf(c)) sizes.set(pool, (sizes.get(pool) ?? 0) + 1)
  const primary = candidates.map((c) => primaryPool(c, sizes, minPoolSize))
  const scores = popularityScores(candidates, primary)

  const rarityPct = new Array<number>(candidates.length).fill(0)
  const byPool = new Map<string, number[]>()
  primary.forEach((pool, index) => byPool.set(pool, [...(byPool.get(pool) ?? []), index]))
  for (const indexes of byPool.values()) {
    const result = percentiles(indexes.map((i) => scores[i]!))
    indexes.forEach((index, position) => (rarityPct[index] = result[position]!))
  }

  return candidates.map((c, i) => ({
    isrc: c.isrc,
    recordingMbid: c.recordingMbid,
    deezerTrackId: c.deezerTrackId,
    title: c.title,
    artistName: c.artistName,
    deezerMd5Image: c.deezerMd5Image,
    rarity: rarityFromPercentile(rarityPct[i]!),
    popularityScore: Math.round(scores[i]! * 100) / 100,
    pools: poolsOf(c),
  }))
}
