/**
 * Quarterly catalogue build (never run in live):
 *   bun run catalog:build -- --csv musicbrainz.csv [--out file] [--skip-lb] [--charts-only] [--limit N] [--dry-run]
 * MusicBrainz CSV -> ListenBrainz popularity -> Deezer (ISRC lookup, charts, editorial playlists)
 * -> popularity score and rarity per pool -> JSONL file read by `catalog:import`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "./args"
import { readCsv } from "./csv"
import { dedupeByDeezerTrack, dedupeByIsrc, dedupeBySong } from "./dedupe"
import {
  isPlayable,
  listTrackIds,
  toCandidate,
  trackById,
  trackByIsrc,
  type DeezerTrack,
} from "./deezer"
import { genreFromLabel, isExcluded, macroGenre } from "./filters"
import { JsonlCache } from "@/http"
import { fetchPopularity, type Popularity } from "./listenbrainz"
import { buildEntries, type Candidate } from "./score"

const HERE = import.meta.dir
/** Resumable caches and the output; point it at the db volume (/data) to keep them between `docker compose run`s. */
const CACHE_DIR = process.env.CATALOG_CACHE_DIR || join(HERE, ".cache")

interface MbRow {
  mbid: string
  isrc: string
  title: string
  artist: string
  genre: string | null
  listens: number
}

interface Config {
  charts: { path: string; genre: string | null }[]
  playlists: { id: number; genre: string | null }[]
  maxTracksPerSource: number
}

const { flags, values } = parseArgs(process.argv.slice(2), ["csv", "out", "limit", "lb-batch"])
const out = values.get("out") ?? join(CACHE_DIR, "catalog.jsonl")
const limit = Number(values.get("limit")) || Infinity
mkdirSync(CACHE_DIR, { recursive: true })

const config = JSON.parse(readFileSync(join(HERE, "catalog.config.json"), "utf8")) as Config
const deezerCache = new JsonlCache<DeezerTrack>(join(CACHE_DIR, "deezer.jsonl"))
const listenCache = new JsonlCache<Popularity>(join(CACHE_DIR, "listenbrainz.jsonl"))
const candidates: Candidate[] = []

async function fromMusicBrainz(csv: string) {
  const rows: Omit<MbRow, "listens">[] = []
  for await (const row of readCsv(csv)) {
    const isrc = (row["isrc"] ?? "").trim().toUpperCase()
    const mbid = (row["recording_mbid"] ?? "").trim()
    const title = (row["title"] ?? "").trim()
    const artist = (row["artist"] ?? "").trim()
    if (!isrc || !mbid || !title || !artist || isExcluded(title, artist)) continue
    rows.push({ mbid, isrc, title, artist, genre: macroGenre(row["tags"] ?? "") })
    if (rows.length >= limit) break
  }
  console.log(`[catalog] MusicBrainz : ${rows.length} enregistrements retenus`)

  let kept: MbRow[]
  if (flags.has("skip-lb")) {
    kept = dedupeBySong(rows.map((r) => ({ ...r, listens: 0 })))
  } else {
    const popularity = await fetchPopularity(
      rows.map((r) => r.mbid),
      listenCache,
      Number(values.get("lb-batch")) || 500,
      (done, total) => console.log(`[catalog] ListenBrainz ${done}/${total}`)
    )
    // No listens at all: dropped. One recording per song: the most listened wins
    const listened = rows
      .map((r) => ({ ...r, listens: popularity.get(r.mbid)?.listens ?? 0 }))
      .filter((r) => r.listens > 0)
    kept = dedupeBySong(listened)
  }
  console.log(`[catalog] après écoutes et dédoublonnage titre/artiste : ${kept.length}`)

  let done = 0
  for (const row of kept) {
    const track = await trackByIsrc(row.isrc, deezerCache)
    if (isPlayable(track)) {
      candidates.push(
        toCandidate(track, {
          isrc: row.isrc,
          recordingMbid: row.mbid,
          listens: flags.has("skip-lb") ? null : row.listens,
          genre: row.genre,
        })
      )
    }
    if (++done % 500 === 0) console.log(`[catalog] Deezer ISRC ${done}/${kept.length}`)
  }
}

async function fromDeezerSources() {
  const sources = [
    ...config.charts.map((c) => ({ path: c.path, genre: genreFromLabel(c.genre ?? undefined) })),
    ...config.playlists.map((p) => ({ path: `/playlist/${p.id}/tracks`, genre: genreFromLabel(p.genre ?? undefined) })),
  ]
  for (const source of sources) {
    const ids = await listTrackIds(source.path, Math.min(config.maxTracksPerSource, limit))
    let added = 0
    for (const id of ids) {
      const track = await trackById(id, deezerCache)
      if (!isPlayable(track) || !track.isrc || isExcluded(track.title ?? "", track.artist?.name ?? "")) continue
      candidates.push(toCandidate(track, { isrc: track.isrc.toUpperCase(), genre: source.genre }))
      added++
    }
    console.log(`[catalog] Deezer ${source.path} : ${added}/${ids.length} titres jouables`)
  }
}

const csv = values.get("csv")
if (!flags.has("charts-only")) {
  if (!csv) {
    console.error("Usage : catalog:build --csv <musicbrainz.csv> [--charts-only] [--skip-lb] [--limit N] [--dry-run]")
    process.exit(1)
  }
  await fromMusicBrainz(csv)
}
await fromDeezerSources()

const unique = dedupeByIsrc(candidates)
const { entries, collisions } = dedupeByDeezerTrack(buildEntries(unique))
const byRarity = new Map<string, number>()
for (const e of entries) byRarity.set(e.rarity, (byRarity.get(e.rarity) ?? 0) + 1)
console.log(
  `[catalog] ${entries.length} titres, ${collisions.length} collisions deezerTrackId, répartition :`,
  Object.fromEntries(byRarity)
)

if (flags.has("dry-run")) {
  console.log("[catalog] --dry-run : rien d'écrit")
} else {
  writeFileSync(out, entries.map((e) => JSON.stringify(e)).join("\n") + "\n")
  console.log(`[catalog] écrit dans ${out} — lance ensuite : bun run catalog:import`)
}
