import { readFileSync } from "node:fs"
import type { PrismaClient } from "@prisma/client"
import type { CatalogEntry } from "./score"

export const IMPORT_BATCH = 500
/** A run that shrinks the catalogue below this share of the current one is refused without --force. */
export const MIN_CATALOG_RATIO = 0.5

export interface ImportSummary {
  created: number
  updated: number
  disabled: number
  skipped: number
}

export function readEntries(path: string): CatalogEntry[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CatalogEntry)
}

/**
 * Upserts the catalogue by ISRC (or Deezer track when the ISRC changed), in
 * transactions of 500. Entries missing from the run become unavailable but are
 * never deleted: owned vinyls must keep their row.
 */
export async function importEntries(
  prisma: PrismaClient,
  entries: CatalogEntry[],
  options: { force?: boolean; log?: (message: string) => void } = {}
): Promise<ImportSummary> {
  const log = options.log ?? console.log
  if (entries.length === 0) throw new Error("Catalogue vide : import refusé")

  const existing = await prisma.cardPoolEntry.findMany({
    select: { id: true, isrc: true, deezerTrackId: true, available: true },
  })
  const byIsrc = new Map(existing.map((e) => [e.isrc, e]))
  const byTrack = new Map(existing.map((e) => [Number(e.deezerTrackId), e]))
  const availableBefore = existing.filter((e) => e.available).length
  if (!options.force && availableBefore > 0 && entries.length < availableBefore * MIN_CATALOG_RATIO) {
    throw new Error(
      `Le nouveau catalogue (${entries.length}) fait moins de ${MIN_CATALOG_RATIO * 100} % de l'actuel (${availableBefore}) : import refusé, utilise --force si c'est voulu`
    )
  }

  const summary: ImportSummary = { created: 0, updated: 0, disabled: 0, skipped: 0 }
  const touched = new Set<string>()
  const claimedIsrc = new Set<string>()
  const claimedTrack = new Set<number>()
  const operations: (() => ReturnType<PrismaClient["cardPoolEntry"]["create"]>)[] = []

  for (const entry of entries) {
    const data = {
      isrc: entry.isrc,
      recordingMbid: entry.recordingMbid,
      deezerTrackId: entry.deezerTrackId,
      title: entry.title,
      artistName: entry.artistName,
      deezerMd5Image: entry.deezerMd5Image,
      rarity: entry.rarity,
      popularityScore: entry.popularityScore,
      pools: JSON.stringify(entry.pools),
      available: true,
      needsRefresh: false,
    }
    const a = byIsrc.get(entry.isrc)
    const b = byTrack.get(entry.deezerTrackId)
    // Both keys match two different rows: updating either would break the other unique index
    if ((a && b && a.id !== b.id) || claimedIsrc.has(entry.isrc) || claimedTrack.has(entry.deezerTrackId)) {
      summary.skipped++
      log(`[catalog] ignoré isrc=${entry.isrc} deezerTrackId=${entry.deezerTrackId} : conflit d'unicité`)
      continue
    }
    claimedIsrc.add(entry.isrc)
    claimedTrack.add(entry.deezerTrackId)
    const row = a ?? b
    if (row) {
      touched.add(row.id)
      summary.updated++
      operations.push(() => prisma.cardPoolEntry.update({ where: { id: row.id }, data }))
    } else {
      summary.created++
      operations.push(() => prisma.cardPoolEntry.create({ data }))
    }
  }

  for (let i = 0; i < operations.length; i += IMPORT_BATCH) {
    await prisma.$transaction(operations.slice(i, i + IMPORT_BATCH).map((run) => run()))
    log(`[catalog] import ${Math.min(i + IMPORT_BATCH, operations.length)}/${operations.length}`)
  }

  const gone = existing.filter((e) => e.available && !touched.has(e.id)).map((e) => e.id)
  for (let i = 0; i < gone.length; i += IMPORT_BATCH) {
    await prisma.cardPoolEntry.updateMany({
      where: { id: { in: gone.slice(i, i + IMPORT_BATCH) } },
      data: { available: false },
    })
  }
  summary.disabled = gone.length
  return summary
}
