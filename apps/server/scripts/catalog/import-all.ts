/**
 * bun run catalog:import-all -- --csv <file> [--limit N]
 * Loads the ~1M-title selection (recording_mbid,isrc,title,artist,length,popularity,rarity) into the database
 * without a single Deezer call: tracks are resolved lazily when a pack containing them is opened.
 */
import type { PrismaClient } from "@prisma/client"
import { isCardRarity } from "@blindmusic/shared"
import { parseArgs } from "./args"
import { readCsv } from "./csv"
import { isExcluded } from "./filters"

export const IMPORT_ALL_BATCH = 5000
export const LOG_EVERY = 50_000

export interface ImportAllSummary {
  created: number
  updated: number
  skipped: number
}

interface Row {
  isrc: string
  recordingMbid: string | null
  title: string
  artistName: string
  popularityScore: number
  rarity: string
}

/** A usable row of the CSV, or null (bad ISRC, empty field, unknown rarity, remix/live/karaoke/...). */
export function toRow(raw: Record<string, string>): Row | null {
  const isrc = (raw.isrc ?? "").replace(/-/g, "").trim().toUpperCase()
  const title = (raw.title ?? "").trim()
  const artistName = (raw.artist ?? "").trim()
  const popularityScore = Number(raw.popularity)
  const rarity = (raw.rarity ?? "").trim().toLowerCase()
  if (!/^[A-Z0-9]{12}$/.test(isrc) || !title || !artistName) return null
  if (!raw.popularity?.trim() || !Number.isFinite(popularityScore) || !isCardRarity(rarity)) return null
  if (isExcluded(title, artistName)) return null
  return { isrc, recordingMbid: raw.recording_mbid?.trim() || null, title, artistName, popularityScore, rarity }
}

/**
 * Entries that already carry a Deezer track (the charts imported before the lazy resolution) get
 * `resolvedAt = updatedAt`. Idempotent: only rows still without a date are touched.
 */
export async function backfillResolvedAt(prisma: PrismaClient): Promise<number> {
  return prisma.$executeRaw`UPDATE CardPoolEntry SET resolvedAt = updatedAt WHERE deezerTrackId IS NOT NULL AND resolvedAt IS NULL`
}

/** Faster bulk writes on SQLite. Best effort: a running server may hold the database and refuse the switch. */
async function tuneSqlite(prisma: PrismaClient, log: (message: string) => void) {
  try {
    await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL")
    await prisma.$executeRawUnsafe("PRAGMA synchronous=NORMAL")
  } catch (error) {
    log(`[catalog] PRAGMA ignorés : ${error instanceof Error ? error.message : error}`)
  }
}

/**
 * Upserts the CSV by ISRC in transactions of 5 000 rows. Existing entries only get their
 * title, artist, rarity, popularity, MBID and `available`: deezerTrackId, deezerMd5Image,
 * resolvedAt and unplayable are never touched. Entries missing from the file stay as they are.
 */
export async function importAll(
  prisma: PrismaClient,
  csvPath: string,
  options: { limit?: number; batchSize?: number; log?: (message: string) => void } = {}
): Promise<ImportAllSummary> {
  const log = options.log ?? console.log
  const batchSize = options.batchSize ?? IMPORT_ALL_BATCH
  const summary: ImportAllSummary = { created: 0, updated: 0, skipped: 0 }

  await tuneSqlite(prisma, log)
  const backfilled = await backfillResolvedAt(prisma)
  if (backfilled > 0) log(`[catalog] resolvedAt renseigné pour ${backfilled} entrées déjà résolues`)

  let batch = new Map<string, Row>()
  const flush = async () => {
    if (batch.size === 0) return
    const rows = [...batch.values()]
    batch = new Map()
    const known = new Set(
      (await prisma.cardPoolEntry.findMany({ where: { isrc: { in: rows.map((r) => r.isrc) } }, select: { isrc: true } })).map(
        (e) => e.isrc
      )
    )
    const fresh = rows.filter((r) => !known.has(r.isrc))
    // Interactive transaction: the engine handles one statement at a time instead of holding a 5 000-operation batch
    await prisma.$transaction(
      async (tx) => {
        await tx.cardPoolEntry.createMany({ data: fresh.map((r) => ({ ...r, available: true })) })
        for (const { isrc, recordingMbid, ...data } of rows) {
          if (!known.has(isrc)) continue
          // updateMany: no read-back of the row, twice as fast as update
          await tx.cardPoolEntry.updateMany({
            where: { isrc },
            // An empty MBID in the file never erases a known one
            data: { ...data, ...(recordingMbid ? { recordingMbid } : {}), available: true },
          })
        }
      },
      { maxWait: 60_000, timeout: 300_000 }
    )
    summary.created += fresh.length
    summary.updated += rows.length - fresh.length
  }

  let read = 0
  for await (const raw of readCsv(csvPath)) {
    if (options.limit !== undefined && read >= options.limit) break
    read++
    const row = toRow(raw)
    // A repeated ISRC inside a batch keeps the last line only
    if (!row || batch.has(row.isrc)) summary.skipped++
    if (row) batch.set(row.isrc, row)
    if (batch.size >= batchSize) await flush()
    if (read % LOG_EVERY === 0) {
      log(`[catalog] ${read} lignes lues : ${summary.created} créées, ${summary.updated} mises à jour, ${summary.skipped} ignorées`)
    }
  }
  await flush()
  log(`[catalog] import-all terminé, ${read} lignes lues : ${JSON.stringify(summary)}`)
  return summary
}

if (import.meta.main) {
  const { values } = parseArgs(process.argv.slice(2), ["csv", "limit"])
  const csv = values.get("csv")
  if (!csv) {
    console.error("Usage : bun run catalog:import-all -- --csv <fichier> [--limit N]")
    process.exit(1)
  }
  const limit = values.has("limit") ? Number(values.get("limit")) : undefined
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    console.error("--limit doit être un entier positif")
    process.exit(1)
  }
  const { prisma } = await import("@/db")
  try {
    await importAll(prisma, csv, { limit })
  } finally {
    await prisma.$disconnect()
  }
}
