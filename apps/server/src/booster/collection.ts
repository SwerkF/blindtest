import type { PrismaClient } from "@prisma/client"
import {
  CARD_RARITIES,
  COLLECTION_PAGE_SIZE,
  type CardRarity,
  type CollectionResponse,
  type RaritySummary,
} from "@blindmusic/shared"
import { prisma } from "@/db"
import { toCardDto } from "@/booster/open"

export const TOTALS_TTL_MS = 10 * 60 * 1000
let totalsCache: { at: number; totals: Map<string, number> } | null = null

/** Drawable entries per rarity. Counting a million rows takes a moment, so the answer is kept 10 minutes. */
export async function catalogTotals(client: PrismaClient = prisma, now = Date.now()): Promise<Map<string, number>> {
  if (totalsCache && now - totalsCache.at < TOTALS_TTL_MS) return totalsCache.totals
  const rows = await client.cardPoolEntry.groupBy({
    by: ["rarity"],
    where: { available: true, unplayable: false },
    _count: { _all: true },
  })
  const totals = new Map(rows.map((r) => [r.rarity, r._count._all]))
  // An empty catalogue is not kept: the import may land right after
  if (totals.size > 0) totalsCache = { at: now, totals }
  return totals
}

export function clearCatalogTotals() {
  totalsCache = null
}

/**
 * One page of a player's collection, most recent first. Filters and counters use
 * the rarity frozen when each vinyl was obtained; only the catalogue totals use
 * the current rarity of the pool entries.
 */
export async function loadCollection(
  userId: string,
  page: number,
  rarity: CardRarity | null
): Promise<CollectionResponse> {
  const where = { userId, ...(rarity ? { rarityAtObtain: rarity } : {}) }
  const [rows, total, owned, totals, sums] = await Promise.all([
    prisma.userCard.findMany({
      where,
      orderBy: [{ lastObtainedAt: "desc" }, { entryId: "asc" }],
      skip: (page - 1) * COLLECTION_PAGE_SIZE,
      take: COLLECTION_PAGE_SIZE,
      include: { entry: true },
    }),
    prisma.userCard.count({ where }),
    prisma.userCard.groupBy({ by: ["rarityAtObtain"], where: { userId }, _count: { _all: true } }),
    catalogTotals(),
    prisma.userCard.aggregate({ where: { userId }, _sum: { count: true } }),
  ])

  const summary: RaritySummary[] = CARD_RARITIES.map((r) => ({
    rarity: r,
    owned: owned.find((o) => o.rarityAtObtain === r)?._count._all ?? 0,
    total: totals.get(r) ?? 0,
  }))
  return {
    items: rows.map((row) => toCardDto(row.entry, row)),
    total,
    page,
    pageSize: COLLECTION_PAGE_SIZE,
    unique: summary.reduce((sum, s) => sum + s.owned, 0),
    copies: sums._sum.count ?? 0,
    summary,
  }
}
