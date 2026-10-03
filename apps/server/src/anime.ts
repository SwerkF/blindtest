import { ThemeType, type AnimeTheme } from "@blindmusic/shared"
import type { AnimeMatch, Track } from "@/deezer"
import { normalize, similarity } from "@/game/text"
import { bestKnownName, coreTitle, expandAnswers } from "@/animeNames"

/**
 * AnimeThemes.moe indexes every anime OP/ED with its song and artists.
 * Docs: https://api-docs.animethemes.moe — no auth, 90 requests per minute.
 */
const API = "https://api.animethemes.moe"
/** English, romaji and alternative titles (often French ones and abbreviations too). */
const ANILIST_API = "https://graphql.anilist.co"

/** Stay under the AnimeThemes quota, shared by every game of the process. */
const REQUESTS_PER_MINUTE = 80
const LOOKUP_CONCURRENCY = 4
/** Give up on playlists that are mostly not anime rather than scanning them whole. */
const LOOKUPS_PER_TRACK = 6
/** The first round starts as soon as one track is ready; the rest follows in batches. */
const BATCH_SIZE = 5
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

export interface AtResource {
  site: string | null
  external_id: number | null
}

export interface AtAnime {
  id: number
  name: string
  year: number | null
  season: string | null
  animesynonyms?: { text: string | null }[]
  images?: AtImage[]
  resources?: AtResource[]
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

// ponytail: in-process sliding window, one server instance
const recentRequests: number[] = []

async function throttle() {
  for (;;) {
    const now = Date.now()
    while (recentRequests.length && now - recentRequests[0] > 60_000) recentRequests.shift()
    if (recentRequests.length < REQUESTS_PER_MINUTE) {
      recentRequests.push(now)
      return
    }
    await Bun.sleep(60_000 - (now - recentRequests[0]) + 50)
  }
}

async function fetchAt<T>(path: string): Promise<T> {
  await throttle()
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

/**
 * Synonyms, cover art and external ids, in one request per batch. Includes
 * are dropped one by one if the API rejects them, so a schema change on their
 * side costs extra names, never the cover or the game.
 */
async function fetchAnimeDetails(ids: number[]): Promise<Map<number, AtAnime>> {
  const out = new Map<number, AtAnime>()
  if (ids.length === 0) return out
  for (const include of ["animesynonyms,images,resources", "images,resources", "images"]) {
    const params = new URLSearchParams({ "filter[id]": ids.join(","), include, "page[size]": "100" })
    try {
      const data = await fetchAt<{ anime?: AtAnime[] }>(`/anime?${params}`)
      for (const a of data.anime ?? []) out.set(a.id, a)
      return out
    } catch (err) {
      if (err instanceof RateLimited) return out
    }
  }
  return out
}

interface AniListMedia {
  id: number
  seasonYear?: number | null
  title?: { romaji?: string | null; english?: string | null; native?: string | null }
  synonyms?: (string | null)[]
}

/** What AniList knows about one anime: every title for answers, English/romaji for display. */
export interface AniListNames {
  titles: string[]
  english: string | null
  romaji: string | null
}

/** A search hit only names the anime for display when one of its titles is the query. */
const DISPLAY_MIN_SIMILARITY = 85

function titlesOf(m: AniListMedia): string[] {
  const titles = [m.title?.english, m.title?.romaji, ...(m.synonyms ?? [])]
  return titles.filter((t): t is string => Boolean(t?.trim()))
}

function aniListId(anime: AtAnime): number | null {
  const resource = anime.resources?.find((r) => r.site?.toLowerCase() === "anilist")
  return resource?.external_id ?? null
}

/**
 * AnimeThemes id -> English/romaji titles and synonyms from AniList (often the
 * French title and abbreviations like "SnK"). Each anime is searched by its
 * own name and by its franchise name ("Shingeki no Kyojin"), whose entry has
 * the richest synonyms; a known AniList id is looked up directly too.
 */
async function fetchAniListTitles(animes: AtAnime[]): Promise<Map<number, AniListNames>> {
  const out = new Map<number, AniListNames>()
  if (animes.length === 0) return out

  const searches: { animeId: number; year: number | null; query: string }[] = []
  for (const anime of animes) {
    for (const query of new Set([anime.name, coreTitle(anime.name)])) {
      if (query.trim()) searches.push({ animeId: anime.id, year: anime.year, query })
    }
  }
  const byAniListId = new Map<number, number>()
  for (const anime of animes) {
    const id = aniListId(anime)
    if (id !== null) byAniListId.set(id, anime.id)
  }

  const withIds = byAniListId.size > 0
  const vars = [...(withIds ? ["$ids: [Int]"] : []), ...searches.map((_, i) => `$q${i}: String`)].join(", ")
  const aliases = searches
    .map((_, i) => `s${i}: Page(perPage: 3) { media(search: $q${i}, type: ANIME, sort: SEARCH_MATCH) { ...m } }`)
    .join("\n")
  const idsAlias = withIds ? "ids: Page(perPage: 50) { media(id_in: $ids, type: ANIME) { ...m } }" : ""
  const query = `query (${vars}) {
${idsAlias}
${aliases}
}
fragment m on Media { id seasonYear title { romaji english native } synonyms }`
  const variables: Record<string, unknown> = withIds ? { ids: [...byAniListId.keys()] } : {}
  searches.forEach((s, i) => (variables[`q${i}`] = s.query))

  // The first trusted entry names the anime: the AniList id lookup, then the full-name search
  const add = (animeId: number, m: AniListMedia, trusted: boolean) => {
    const entry = out.get(animeId) ?? { titles: [], english: null, romaji: null }
    entry.titles.push(...titlesOf(m))
    if (trusted && !entry.english && !entry.romaji) {
      entry.english = m.title?.english?.trim() || null
      entry.romaji = m.title?.romaji?.trim() || null
    }
    out.set(animeId, entry)
  }
  try {
    const res = await fetch(ANILIST_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    })
    if (!res.ok) return out
    const data = (await res.json()) as { data?: Record<string, { media?: AniListMedia[] } | null> }
    for (const m of data.data?.ids?.media ?? []) {
      const animeId = byAniListId.get(m.id)
      if (animeId !== undefined) add(animeId, m, true)
    }
    searches.forEach((s, i) => {
      const media = data.data?.[`s${i}`]?.media ?? []
      // Prefer the entry that aired the same year, the search can surface a sequel first
      const best = media.find((m) => s.year !== null && m.seasonYear === s.year) ?? media[0]
      if (!best) return
      const query = normalize(s.query)
      const trusted = titlesOf(best).some((t) => similarity(normalize(t), query) >= DISPLAY_MIN_SIMILARITY)
      add(s.animeId, best, trusted)
    })
  } catch {
    // AniList down: AnimeThemes names and the built-in French titles still work
  }
  return out
}

const THEME_TYPES = new Set<string>(Object.values(ThemeType))

function toTheme(theme: AtTheme): AnimeTheme | null {
  if (!theme.type || !THEME_TYPES.has(theme.type)) return null
  return { type: theme.type as ThemeType, sequence: theme.sequence ?? null, slug: theme.slug }
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
export function buildMatch(
  song: AtSong,
  details: Map<number, AtAnime>,
  aniListTitles: Map<number, AniListNames> = new Map(),
  deezerArtist?: string
): AnimeMatch | null {
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

  const titles: string[] = []
  for (const { anime } of entries) {
    titles.push(anime.name)
    for (const syn of anime.animesynonyms ?? []) if (syn.text) titles.push(syn.text)
    titles.push(...(aniListTitles.get(anime.id)?.titles ?? []))
  }
  const { names, acronyms } = expandAnswers(titles)

  const artists = new Set((song.artists ?? []).map((a) => a.name).filter(Boolean))
  if (deezerArtist) artists.add(deezerArtist)

  const name = bestKnownName(primary.anime.name, aniListTitles.get(primary.anime.id))
  const originalName = normalize(name) === normalize(primary.anime.name) ? undefined : primary.anime.name

  return {
    names: names.includes(name) ? names : [name, ...names],
    acronyms,
    artists: [...artists],
    reveal: {
      name,
      ...(originalName ? { originalName } : {}),
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

/** Resolves every name of the batch's anime and turns the matches into playable tracks. */
async function enrich(matched: { track: Track; song: AtSong }[]): Promise<Track[]> {
  const animeIds = new Set<number>()
  for (const { song } of matched) {
    for (const t of song.animethemes ?? []) if (t.anime) animeIds.add(t.anime.id)
  }
  const details = await fetchAnimeDetails([...animeIds].slice(0, 100))
  // Fall back to the anime embedded in the search result when details failed
  const animes = new Map<number, AtAnime>()
  for (const { song } of matched) {
    for (const t of song.animethemes ?? []) if (t.anime) animes.set(t.anime.id, details.get(t.anime.id) ?? t.anime)
  }
  const aniListTitles = await fetchAniListTitles([...animes.values()])

  return matched.flatMap(({ track, song }) => {
    const anime = buildMatch(song, details, aniListTitles, track.artist)
    return anime ? [{ ...track, year: anime.reveal.year ?? 0, anime }] : []
  })
}

/**
 * Keeps only the pool tracks that are known anime themes, up to `count`, and
 * hands them over as they are ready: the first one alone so the game can start
 * right away, then in batches. `onTracks` returns false once nobody needs more
 * (game restarted, room closed). The anime premiere year replaces Deezer's.
 */
export async function streamAnimeTracks(
  pool: Track[],
  count: number,
  onTracks: (tracks: Track[]) => boolean | Promise<boolean>
): Promise<void> {
  const maxLookups = count * LOOKUPS_PER_TRACK
  let cursor = 0
  let lookups = 0
  let delivered = 0
  let blocked = false
  let wanted = true

  async function nextMatches(size: number): Promise<{ track: Track; song: AtSong }[]> {
    const matched: { track: Track; song: AtSong }[] = []
    async function worker() {
      while (!blocked && matched.length < size && cursor < pool.length) {
        const track = pool[cursor++]
        const cached = songCache.has(track.id)
        if (!cached && lookups >= maxLookups) return
        if (!cached) lookups++
        try {
          const song = await lookupSong(track)
          if (song && matched.length < size) matched.push({ track, song })
        } catch (err) {
          if (err instanceof RateLimited) blocked = true
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, size + 1) }, worker))
    return matched
  }

  while (wanted && delivered < count) {
    const size = delivered === 0 ? 1 : Math.min(BATCH_SIZE, count - delivered)
    const matched = await nextMatches(size)
    if (matched.length === 0) return
    const tracks = await enrich(matched)
    delivered += tracks.length
    if (tracks.length) wanted = await onTracks(tracks)
  }
}
