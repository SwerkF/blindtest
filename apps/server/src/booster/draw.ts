import { Prisma, type PrismaClient } from "@prisma/client"
import type { CardRarity } from "@blindmusic/shared"
import { rngInt, type RandomInt } from "@/booster/rng"
import type { PoolEntry } from "@/booster/resolve"

export const RANGES_TTL_MS = 10 * 60 * 1000
/** A rarity missing from the cache is looked up again after this delay: the catalogue may just have been imported. */
const MISS_REFRESH_MS = 10_000

export interface RowidRange {
  min: number
  max: number
}

/**
 * Smallest and largest rowid of the drawable entries of each rarity, cached for 10 minutes.
 * Drawing inside the range of the rarity (not of the whole table) keeps the pick uniform
 * when the import wrote the rarities in blocks, e.g. a CSV sorted by popularity.
 */
export class RowidRanges {
  private loadedAt = 0
  private ranges = new Map<string, RowidRange>()

  constructor(
    private readonly ttlMs = RANGES_TTL_MS,
    private readonly now: () => number = Date.now
  ) {}

  clear() {
    this.loadedAt = 0
    this.ranges.clear()
  }

  async get(client: PrismaClient, rarity: CardRarity): Promise<RowidRange | null> {
    const age = this.now() - this.loadedAt
    if (this.loadedAt === 0 || age >= this.ttlMs || (!this.ranges.has(rarity) && age >= MISS_REFRESH_MS)) {
      await this.load(client)
    }
    return this.ranges.get(rarity) ?? null
  }

  private async load(client: PrismaClient) {
    const rows = await client.$queryRaw<{ rarity: string; min: bigint | number; max: bigint | number }[]>`
      SELECT rarity, MIN(rowid) AS min, MAX(rowid) AS max
      FROM CardPoolEntry
      WHERE available = 1 AND unplayable = 0
      GROUP BY rarity`
    this.ranges = new Map(rows.map((r) => [r.rarity, { min: Number(r.min), max: Number(r.max) }]))
    this.loadedAt = this.now()
  }
}

export const defaultRanges = new RowidRanges()

/**
 * Uniform-ish pick of one drawable entry of a rarity, without count + skip (a full scan on a million rows):
 * a random rowid in the range of the rarity, then the first matching row at or after it, wrapping around
 * to the first row of the rarity when there is none. `exclude` holds entry ids not to return.
 * Null when the rarity has no drawable entry left.
 */
export async function drawEntry(
  client: PrismaClient,
  rarity: CardRarity,
  exclude: readonly string[],
  random: RandomInt = rngInt,
  ranges: RowidRanges = defaultRanges
): Promise<PoolEntry | null> {
  const range = await ranges.get(client, rarity)
  if (!range) return null
  const pivot = range.min + random(range.max - range.min + 1)
  const excluded = exclude.length > 0 ? Prisma.sql`AND id NOT IN (${Prisma.join(exclude)})` : Prisma.empty
  const where = Prisma.sql`rarity = ${rarity} AND available = 1 AND unplayable = 0 ${excluded}`

  let rows = await client.$queryRaw<{ id: string }[]>`
    SELECT id FROM CardPoolEntry WHERE ${where} AND rowid >= ${pivot} ORDER BY rowid LIMIT 1`
  if (rows.length === 0) {
    rows = await client.$queryRaw<{ id: string }[]>`
      SELECT id FROM CardPoolEntry WHERE ${where} AND rowid < ${pivot} ORDER BY rowid LIMIT 1`
  }
  const id = rows[0]?.id
  return id ? client.cardPoolEntry.findUnique({ where: { id } }) : null
}
