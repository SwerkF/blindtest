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
import { defaultRanges, drawEntry, type RowidRanges } from "@/booster/draw"
import { resolveEntry, type PoolEntry, type ResolvedEntry, type Resolver } from "@/booster/resolve"

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

/** Tries per slot and rarity before falling back to another rarity. */
export const MAX_ATTEMPTS_PER_SLOT = 8
/** Beyond this, a Deezer that keeps failing makes the opening give up (the pack is not consumed). */
export const RESOLVE_BUDGET_MS = 25_000

export function toCardDto(
  entry: Pick<PoolEntry, "id" | "deezerTrackId" | "title" | "artistName" | "deezerMd5Image">,
  card: { rarityAtObtain: string; count: number; firstObtainedAt: Date }
): CardDto {
  return {
    entryId: entry.id,
    // BigInt in the database (recent Deezer ids exceed 2^31) but far below 2^53: a number in the DTO and the JSON.
    // Owned vinyls are always resolved, null only exists for entries nobody drew yet.
    deezerTrackId: Number(entry.deezerTrackId ?? 0),
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

export interface DrawDeps {
  client: PrismaClient
  random: RandomInt
  resolve: Resolver
  ranges: RowidRanges
  now?: () => number
}

/** What phase 1 decided: the vinyls to hand out and whether the pity timer forced a legendary slot. */
export interface Draw {
  entries: ResolvedEntry[]
  pityForced: boolean
}

/**
 * One playable entry for a slot, resolved on Deezer, none twice in the same pack. Candidates that
 * cannot be resolved are dropped for this opening and replaced (8 tries per rarity, then a neighbour
 * rarity). Null when no rarity could provide one.
 */
async function pickResolved(
  deps: DrawDeps,
  rarity: CardRarity,
  seen: Set<string>,
  deadline: number
): Promise<ResolvedEntry | null> {
  const now = deps.now ?? Date.now
  for (const candidateRarity of fallbackOrder(rarity)) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_SLOT; attempt++) {
      if (now() > deadline) throw new BoosterError("Deezer met trop de temps à répondre, réessaie dans un instant", 503)
      const candidate = await drawEntry(deps.client, candidateRarity, [...seen], deps.random, deps.ranges)
      if (!candidate) break
      seen.add(candidate.id)
      const resolved = await deps.resolve(candidate)
      if (resolved) return resolved
    }
  }
  return null
}

/**
 * Phase 1, outside any transaction: checks a pack is waiting, rolls the rarities (pity included)
 * and picks the vinyls, which may call Deezer. Nothing is written for the player here.
 */
export async function drawCards(deps: DrawDeps, userId: string, packRarity: PackRarity): Promise<Draw> {
  const { client, random } = deps
  const pack = await client.userPack.findFirst({ where: { userId, rarity: packRarity, openedAt: null }, select: { id: true } })
  if (!pack) throw new BoosterError("Aucun booster de ce type à ouvrir", 409)
  const user = await client.user.findUnique({ where: { id: userId }, select: { packsSincePity: true } })
  if (!user) throw new BoosterError("Compte introuvable", 404)

  const slots = Array.from({ length: PACK_SIZE }, () => weightedPick(PACK_CARD_RATES[packRarity], random))
  // Pity timer: the Nth pack without a legendary vinyl always has one
  let pityForced = false
  if (user.packsSincePity + 1 >= PITY_THRESHOLD && !slots.includes(CardRarity.Legendaire)) {
    slots[random(PACK_SIZE)] = CardRarity.Legendaire
    pityForced = true
  }

  const now = deps.now ?? Date.now
  const deadline = now() + RESOLVE_BUDGET_MS
  const seen = new Set<string>()
  const entries: ResolvedEntry[] = []
  for (const slot of slots) {
    const entry = await pickResolved(deps, slot, seen, deadline)
    if (!entry) {
      // Nothing was ever drawn: the catalogue is empty. Otherwise every candidate failed on Deezer.
      throw new BoosterError(
        seen.size === 0
          ? "Le catalogue de vinyles est vide pour le moment"
          : "Impossible de préparer les vinyles pour le moment, réessaie dans un instant",
        503
      )
    }
    entries.push(entry)
  }
  return { entries, pityForced }
}

/**
 * Phase 2, one short transaction without any network call: the pack is consumed and the vinyls are
 * inserted together, so spamming the button cannot open the same pack twice.
 * Exported without the in-memory lock so the concurrency tests can hit it directly.
 */
export async function openPackTx(
  tx: Tx,
  userId: string,
  packRarity: PackRarity,
  draw: Draw
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

  const cards: OpenedCard[] = []
  for (const entry of draw.entries) {
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

  // Counted on the vinyls really obtained (a rarity may have fallen back), from the value read in the transaction
  const gotLegendary = draw.entries.some((e) => e.rarity === CardRarity.Legendaire)
  const packsSincePity = gotLegendary ? 0 : user.packsSincePity + 1
  await tx.user.update({ where: { id: userId }, data: { packsSincePity } })

  const remaining = await tx.userPack.count({ where: { userId, rarity: packRarity, openedAt: null } })
  return {
    rarity: packRarity,
    cards,
    pityTriggered: draw.pityForced && gotLegendary,
    packsSincePity,
    remaining,
  }
}

/** Only one opening per account at a time (single process); the transaction is the real guard. */
const opening = new Set<string>()

// Write conflict, transaction timeout, database busy
const CONTENTION_CODES = new Set(["P2034", "P2028", "P1008"])

export interface OpenDeps {
  resolve?: Resolver
  ranges?: RowidRanges
  now?: () => number
}

export async function openPack(
  userId: string,
  packRarity: PackRarity,
  random: RandomInt = rngInt,
  client: PrismaClient = prisma,
  deps: OpenDeps = {}
): Promise<OpenPackResponse> {
  if (opening.has(userId)) throw new BoosterError("Ouverture déjà en cours", 409)
  opening.add(userId)
  try {
    const draw = await drawCards(
      {
        client,
        random,
        resolve: deps.resolve ?? ((entry) => resolveEntry(entry, { client })),
        ranges: deps.ranges ?? defaultRanges,
        now: deps.now,
      },
      userId,
      packRarity
    )
    return await client.$transaction((tx) => openPackTx(tx, userId, packRarity, draw), {
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
