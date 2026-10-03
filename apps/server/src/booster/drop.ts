import {
  MAX_PACKS_PER_DAY,
  PackRarity,
  packDropChance,
  packRarityWeights,
  performance,
  playSeconds,
} from "@blindmusic/shared"
import type { PrismaClient } from "@prisma/client"
import { prisma } from "@/db"
import { notifyUser } from "@/account/presence"
import { rngInt, weightedPick, type RandomInt } from "@/booster/rng"

export interface DropContext {
  playerCount: number
  roundCount: number
  roundDurationSec: number
  score: number
  /** Rounds where the title (or the anime) was found. */
  titleFound: number
  rank: number
  /** Packs already earned in the last 24 hours. */
  recentPacks: number
}

const ROLL_PRECISION = 1_000_000

/**
 * Decides whether a finished game drops a pack and of which rarity: the chance
 * grows with the time played, the rarity with how well the player did.
 */
export function evaluateDrop(ctx: DropContext, random: RandomInt = rngInt): PackRarity | null {
  // Idle players get nothing, and the daily cap keeps packs rare
  if (ctx.score <= 0 || ctx.recentPacks >= MAX_PACKS_PER_DAY) return null
  const chance = packDropChance(playSeconds(ctx.roundCount, ctx.roundDurationSec), ctx.playerCount)
  if (chance <= 0 || random(ROLL_PRECISION) >= chance * ROLL_PRECISION) return null
  return weightedPick(packRarityWeights(performance(ctx)), random)
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Rolls the drop of one player after a game and stores the pack. The unique
 * gameResultId makes a replay of the same game a no-op. Never throws: a failed
 * drop must not cost the player their game history.
 */
export async function grantDrop(
  userId: string,
  gameResultId: string,
  ctx: Omit<DropContext, "recentPacks">,
  random: RandomInt = rngInt,
  client: PrismaClient = prisma
): Promise<PackRarity | null> {
  try {
    const recentPacks = await client.userPack.count({
      where: { userId, earnedAt: { gte: new Date(Date.now() - DAY_MS) } },
    })
    const rarity = evaluateDrop({ ...ctx, recentPacks }, random)
    if (!rarity) return null
    await client.userPack.create({ data: { userId, rarity, gameResultId } })
    notifyUser(userId, { type: "booster:earned", rarity })
    return rarity
  } catch (error) {
    // P2002: this game already granted its pack, which is the expected replay case
    if ((error as { code?: unknown })?.code !== "P2002") console.error("Booster drop failed", error)
    return null
  }
}
