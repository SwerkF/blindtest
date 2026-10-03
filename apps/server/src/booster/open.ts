import type { Prisma, PrismaClient } from "@prisma/client"
import {
  CARD_RARITIES,
  CardRarity,
  PACK_CARD_RATES,
  PACK_SIZE,
  PITY_THRESHOLD,
  isCardRarity,
  type CardDto,
  type OpenPackResponse,
  type OpenedCard,
  type PackRarity,
} from "@blindmusic/shared"
import { prisma } from "@/db"
import { rngInt, weightedPick, type RandomInt } from "@/booster/rng"

/** Expected failure of an opening, mapped to an HTTP status by the route. */
export class BoosterError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

type Tx = Prisma.TransactionClient
type Entry = Prisma.CardPoolEntryGetPayload<object>

export function toCardDto(
  entry: Pick<Entry, "id" | "deezerTrackId" | "title" | "artistName" | "deezerMd5Image">,
  card: { rarityAtObtain: string; count: number; firstObtainedAt: Date }
): CardDto {
  return {
    entryId: entry.id,
    // BigInt in the database (recent Deezer ids exceed 2^31) but far below 2^53: a number in the DTO and the JSON
    deezerTrackId: Number(entry.deezerTrackId),
    title: entry.title,
    artistName: entry.artistName,
    deezerMd5Image: entry.deezerMd5Image,
    rarity: isCardRarity(card.rarityAtObtain) ? card.rarityAtObtain : CardRarity.Commun,
    count: card.count,
    firstObtainedAt: card.firstObtainedAt.toISOString(),
  }
}

/** The rarity first, then the lower ones (best effort), then the higher ones, when a pool is empty. */
function fallbackOrder(rarity: CardRarity): CardRarity[] {
  const index = CARD_RARITIES.indexOf(rarity)
  return [rarity, ...CARD_RARITIES.slice(0, index).reverse(), ...CARD_RARITIES.slice(index + 1)]
}

/** Uniform pick among the available entries of a rarity, none twice in the same pack. */
async function pickEntry(tx: Tx, rarity: CardRarity, taken: string[], random: RandomInt): Promise<Entry | null> {
  for (const candidate of fallbackOrder(rarity)) {
    const where = { available: true, rarity: candidate, id: { notIn: taken } }
    const count = await tx.cardPoolEntry.count({ where })
    if (count === 0) continue
    return tx.cardPoolEntry.findFirst({ where, orderBy: { id: "asc" }, skip: random(count) })
  }
  return null
}

/**
 * The whole opening in one transaction: the pack is consumed and the vinyls are
 * inserted together, so spamming the button cannot open the same pack twice.
 * Exported without the in-memory lock so the concurrency tests can hit it directly.
 */
export async function openPackTx(
  tx: Tx,
  userId: string,
  packRarity: PackRarity,
  random: RandomInt = rngInt
): Promise<OpenPackResponse> {
  // First write of the transaction: takes the SQLite write lock before anything is read
  await tx.user.updateMany({ where: { id: userId }, data: { packsSincePity: { increment: 0 } } })

  const pack = await tx.userPack.findFirst({
    where: { userId, rarity: packRarity, openedAt: null },
    orderBy: { earnedAt: "asc" },
  })
  if (!pack) throw new BoosterError("Aucun booster de ce type à ouvrir", 409)
  // Conditional update: only one concurrent opening can flip openedAt
  const claimed = await tx.userPack.updateMany({
    where: { id: pack.id, openedAt: null },
    data: { openedAt: new Date() },
  })
  if (claimed.count !== 1) throw new BoosterError("Ce booster est déjà ouvert", 409)

  const user = await tx.user.findUnique({ where: { id: userId }, select: { packsSincePity: true } })
  if (!user) throw new BoosterError("Compte introuvable", 404)

  const slots = Array.from({ length: PACK_SIZE }, () => weightedPick(PACK_CARD_RATES[packRarity], random))
  // Pity timer: the Nth pack without a legendary vinyl always has one
  let pityForced = false
  if (user.packsSincePity + 1 >= PITY_THRESHOLD && !slots.includes(CardRarity.Legendaire)) {
    slots[random(PACK_SIZE)] = CardRarity.Legendaire
    pityForced = true
  }

  const entries: Entry[] = []
  for (const slot of slots) {
    const entry = await pickEntry(
      tx,
      slot,
      entries.map((e) => e.id),
      random
    )
    if (!entry) throw new BoosterError("Le catalogue de vinyles est vide pour le moment", 503)
    entries.push(entry)
  }

  const cards: OpenedCard[] = []
  for (const entry of entries) {
    const existing = await tx.userCard.findUnique({ where: { userId_entryId: { userId, entryId: entry.id } } })
    const now = new Date()
    const card = existing
      ? await tx.userCard.update({
          where: { userId_entryId: { userId, entryId: entry.id } },
          // rarityAtObtain stays the one of the first draw
          data: { count: { increment: 1 }, lastObtainedAt: now },
        })
      : await tx.userCard.create({
          data: { userId, entryId: entry.id, rarityAtObtain: entry.rarity, lastObtainedAt: now },
        })
    cards.push({ card: toCardDto(entry, card), isNew: !existing })
  }

  const gotLegendary = entries.some((e) => e.rarity === CardRarity.Legendaire)
  const packsSincePity = gotLegendary ? 0 : user.packsSincePity + 1
  await tx.user.update({ where: { id: userId }, data: { packsSincePity } })

  const remaining = await tx.userPack.count({ where: { userId, rarity: packRarity, openedAt: null } })
  return {
    rarity: packRarity,
    cards,
    pityTriggered: pityForced && gotLegendary,
    packsSincePity,
    remaining,
  }
}

/** Only one opening per account at a time (single process); the transaction is the real guard. */
const opening = new Set<string>()

// Write conflict, transaction timeout, database busy
const CONTENTION_CODES = new Set(["P2034", "P2028", "P1008"])

export async function openPack(
  userId: string,
  packRarity: PackRarity,
  random: RandomInt = rngInt,
  client: PrismaClient = prisma
): Promise<OpenPackResponse> {
  if (opening.has(userId)) throw new BoosterError("Ouverture déjà en cours", 409)
  opening.add(userId)
  try {
    return await client.$transaction((tx) => openPackTx(tx, userId, packRarity, random), {
      maxWait: 5000,
      timeout: 10000,
    })
  } catch (error) {
    const code = (error as { code?: unknown })?.code
    if (typeof code === "string" && CONTENTION_CODES.has(code)) {
      throw new BoosterError("Ouverture déjà en cours", 409)
    }
    throw error
  } finally {
    opening.delete(userId)
  }
}
