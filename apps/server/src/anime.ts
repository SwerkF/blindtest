import { ThemeType, type AnimeTheme } from "@blindmusic/shared"
import type { AnimeMatch, Track } from "@/deezer"
import { normalize, similarity } from "@/game/text"

/**
 * AnimeThemes.moe indexes every anime OP/ED with its song and artists.
 * Docs: https://api-docs.animethemes.moe — no auth, 90 requests per minute.
 */
const API = "https://api.animethemes.moe"

/** Stay under the 90/min quota even when a game needs many lookups. */
const MAX_LOOKUPS_PER_GAME = 70
const LOOKUP_CONCURRENCY = 4
/** A Deezer title must be this close to the AnimeThemes song title. */
const TITLE_MIN_SIMILARITY = 85
/** Without an artist match, only long exact titles are trusted (covers, romaji credits). */
const TITLE_ONLY_MIN_LENGTH = 5

export interface AtArtist {
  name: string
}

export interface AtImage {
  facet: string | null
  link: string
}

export interface AtAnime {
  id: number
  name: string
  year: number | null
  season: string | null
  animesynonyms?: { text: string | null }[]
  images?: AtImage[]
}

export interface AtTheme {
  type: string | null
  sequence: number | null
  slug: string
  anime?: AtAnime
}

export interface AtSong {
  id: number
  title: string | null
  artists?: AtArtist[]
  animethemes?: AtTheme[]
}

class RateLimited extends Error {}

async function fetchAt<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Accept: "application/json" } })
  if (res.status === 429) throw new RateLimited()
  if (!res.ok) throw new Error(`AnimeThemes ${res.status} on ${path}`)
  return res.json() as Promise<T>
}

async function searchSongs(query: string): Promise<AtSong[]> {
  const params = new URLSearchParams({
    q: query,
    "fields[search]": "songs",
    "include[song]": "animethemes.anime,artists",
    "page[limit]": "8",
  })
  const data = await fetchAt<{ search?: { songs?: AtSong[] } }>(`/search?${params}`)
  return data.search?.songs ?? []
}

/** Synonyms and cover art, in one request for the whole game. */
async function fetchAnimeDetails(ids: number[]): Promise<Map<number, AtAnime>> {
  const out = new Map<number, AtAnime>()
  if (ids.length === 0) return out
  const params = new URLSearchParams({
    "filter[id]": ids.join(","),
    include: "animesynonyms,images",
    "page[size]": "100",
  })
  try {
    const data = await fetchAt<{ anime?: AtAnime[] }>(`/anime?${params}`)
    for (const a of data.anime ?? []) out.set(a.id, a)
  } catch {
    // Synonyms are a nice-to-have: canonical names still make the game playable
  }
  return out
}

const THEME_TYPES = new Set<string>(Object.values(ThemeType))

function toTheme(theme: AtTheme): AnimeTheme | null {
  if (!theme.type || !THEME_TYPES.has(theme.type)) return null
  return { type: theme.type as ThemeType, sequence: theme.sequence ?? null, slug: theme.slug }
}

/**
 * "Shingeki no Kyojin Season 3 Part 2" should also accept "Shingeki no Kyojin",
 * so season/part suffixes and colon subtitles are peeled into extra answers.
 */
export function animeNameVariants(name: string): string[] {
  const variants = new Set<string>([name.trim()])
  const base = name
    .replace(/\s*\((tv|movie|ova|ona)\)\s*$/i, "")
    .replace(/\s*(:|-)?\s*(season|saison|part|cour)\s*\d+.*$/i, "")
    .replace(/\s*\d+(st|nd|rd|th)\s+season.*$/i, "")
    .replace(/\s+(ii|iii|iv|\d+)\s*$/i, "")
    .trim()
  if (base.length >= 4) variants.add(base)
  const beforeColon = name.split(":")[0].trim()
  if (beforeColon.length >= 4) variants.add(beforeColon)
  return [...variants].filter(Boolean)
}

function artistMatches(song: AtSong, deezerArtist: string): boolean {
  const target = normalize(deezerArtist)
  if (!target) return false
  return (song.artists ?? []).some((a) => {
    const name = normalize(a.name)
    if (!name) return false
    return target.includes(name) || name.includes(target) || similarity(name, target) >= 80
  })
}

/** Titles worth searching for: the cleaned title, and the tail of "Anime - Song" style titles. */
export function searchQueries(track: Pick<Track, "title">): string[] {
  const queries = [track.title]
  const parts = track.title.split(/\s+[-–—|]\s+/)
  if (parts.length > 1) queries.push(parts[parts.length - 1])
  return [...new Set(queries.map((q) => q.trim()).filter((q) => q.length >= 2))]
}

/**
 * Picks the AnimeThemes song a Deezer track actually is. The artist has to
 * agree, unless the title is a long exact match with a single candidate
 * (covers and romanised credits rarely spell the artist the same way).
 */
export function pickSong(songs: AtSong[], track: Pick<Track, "title" | "artist">): AtSong | null {
  const withThemes = songs.filter((s) => s.title && s.animethemes?.some((t) => t.anime && toTheme(t)))
  const titles = searchQueries(track).map(normalize)
  const scored = withThemes
    .map((song) => ({
      song,
      sim: Math.max(...titles.map((t) => similarity(normalize(song.title!), t))),
      artist: artistMatches(song, track.artist),
    }))
    .filter((c) => c.sim >= TITLE_MIN_SIMILARITY)
    .sort((a, b) => Number(b.artist) - Number(a.artist) || b.sim - a.sim)

  const best = scored[0]
  if (!best) return null
  if (best.artist) return best.song
  const exact = scored.filter((c) => c.sim === 100)
  const title = normalize(best.song.title!)
  if (exact.length === 1 && best.sim === 100 && title.length >= TITLE_ONLY_MIN_LENGTH) return best.song
  return null
}

function coverOf(anime: AtAnime | undefined): string | null {
  const images = anime?.images ?? []
  const large = images.find((i) => i.facet?.toLowerCase().includes("large"))
  return (large ?? images[0])?.link ?? null
}

/** Folds a matched song into what the game needs: accepted answers and the reveal card. */
export function buildMatch(song: AtSong, details: Map<number, AtAnime>): AnimeMatch | null {
  const themes = (song.animethemes ?? []).filter((t) => t.anime && toTheme(t))
  if (themes.length === 0) return null

  // The earliest anime is usually the original series the song was written for
  const byAnime = new Map<number, { anime: AtAnime; themes: AnimeTheme[] }>()
  for (const t of themes) {
    const anime = details.get(t.anime!.id) ?? t.anime!
    const entry = byAnime.get(anime.id) ?? { anime, themes: [] }
    entry.themes.push(toTheme(t)!)
    byAnime.set(anime.id, entry)
  }
  const entries = [...byAnime.values()].sort(
    (a, b) => (a.anime.year ?? 9999) - (b.anime.year ?? 9999) || a.anime.id - b.anime.id
  )
  const primary = entries[0]

  const names = new Set<string>()
  for (const { anime } of entries) {
    for (const v of animeNameVariants(anime.name)) names.add(v)
    for (const syn of anime.animesynonyms ?? []) {
      if (syn.text) for (const v of animeNameVariants(syn.text)) names.add(v)
    }
  }

  return {
    names: [...names].filter((n) => normalize(n).length > 0),
    reveal: {
      name: primary.anime.name,
      themes: primary.themes,
      year: primary.anime.year ?? null,
      season: primary.anime.season ?? null,
      imageUrl: coverOf(primary.anime),
    },
  }
}

// ponytail: per-process memo, playlists get replayed so most lookups hit it
const songCache = new Map<number, AtSong | null>()

async function lookupSong(track: Track): Promise<AtSong | null> {
  if (songCache.has(track.id)) return songCache.get(track.id)!
  let found: AtSong | null = null
  for (const query of searchQueries(track)) {
    found = pickSong(await searchSongs(query), track)
    if (found) break
  }
  songCache.set(track.id, found)
  return found
}

/**
 * Keeps only the pool tracks that are known anime themes, up to `count`, and
 * attaches the anime to guess. The anime premiere year replaces Deezer's.
 */
export async function pickAnimeTracks(pool: Track[], count: number): Promise<Track[]> {
  const matched: { track: Track; song: AtSong }[] = []
  let cursor = 0
  let lookups = 0
  let blocked = false

  async function worker() {
    while (!blocked && matched.length < count && cursor < pool.length) {
      const track = pool[cursor++]
      const cached = songCache.has(track.id)
      if (!cached && lookups >= MAX_LOOKUPS_PER_GAME) return
      if (!cached) lookups++
      try {
        const song = await lookupSong(track)
        if (song && matched.length < count) matched.push({ track, song })
      } catch (err) {
        if (err instanceof RateLimited) blocked = true
      }
    }
  }
  await Promise.all(Array.from({ length: LOOKUP_CONCURRENCY }, worker))

  const animeIds = new Set<number>()
  for (const { song } of matched) {
    for (const t of song.animethemes ?? []) if (t.anime) animeIds.add(t.anime.id)
  }
  const details = await fetchAnimeDetails([...animeIds].slice(0, 100))

  return matched.flatMap(({ track, song }) => {
    const anime = buildMatch(song, details)
    return anime ? [{ ...track, year: anime.reveal.year ?? 0, anime }] : []
  })
}
