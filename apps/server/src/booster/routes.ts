import type { FastifyInstance } from "fastify"
import {
  PACK_RARITIES,
  PITY_THRESHOLD,
  isCardRarity,
  isPackRarity,
  type BoosterStateResponse,
  type CollectionResponse,
  type OpenPackBody,
  type OpenPackResponse,
} from "@blindmusic/shared"
import { prisma } from "@/db"
import { requireUser } from "@/account/authRoutes"
import { BoosterError, openPack } from "@/booster/open"
import { loadCollection } from "@/booster/collection"

const MAX_PAGE = 10_000
const FLAG_LIMIT_PER_MINUTE = 30
const flagHits = new Map<string, { count: number; resetAt: number }>()

/** Tiny per-account limiter for the cover reports (single process). */
function allowFlag(userId: string): boolean {
  const now = Date.now()
  const hit = flagHits.get(userId)
  if (!hit || hit.resetAt <= now) {
    flagHits.set(userId, { count: 1, resetAt: now + 60_000 })
    return true
  }
  hit.count++
  return hit.count <= FLAG_LIMIT_PER_MINUTE
}

function parsePage(value: unknown): number {
  const page = Math.floor(Number(value))
  return Number.isFinite(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1
}

/** Vinyl boosters: inventory, opening, collections (public) and cover reports. */
export default async function boosterRoutes(fastify: FastifyInstance) {
  fastify.get("/me/boosters", async (req, reply): Promise<BoosterStateResponse | undefined> => {
    const user = await requireUser(req, reply)
    if (!user) return
    const [grouped, fresh, available] = await Promise.all([
      prisma.userPack.groupBy({
        by: ["rarity"],
        where: { userId: user.id, openedAt: null },
        _count: { _all: true },
      }),
      prisma.user.findUnique({ where: { id: user.id }, select: { packsSincePity: true } }),
      prisma.cardPoolEntry.count({ where: { available: true } }),
    ])
    reply.header("Cache-Control", "private, no-store")
    return {
      packs: PACK_RARITIES.map((rarity) => ({
        rarity,
        count: grouped.find((g) => g.rarity === rarity)?._count._all ?? 0,
      })),
      packsSincePity: fresh?.packsSincePity ?? 0,
      pityThreshold: PITY_THRESHOLD,
      catalogReady: available > 0,
    }
  })

  fastify.post<{ Body: Partial<OpenPackBody> | undefined }>(
    "/me/boosters/open",
    async (req, reply): Promise<OpenPackResponse | undefined> => {
      const user = await requireUser(req, reply)
      if (!user) return
      const rarity = req.body?.rarity
      if (!isPackRarity(rarity)) return reply.status(400).send({ error: "Rareté de booster invalide" })
      try {
        const result = await openPack(user.id, rarity)
        reply.header("Cache-Control", "private, no-store")
        return result
      } catch (error) {
        if (error instanceof BoosterError) return reply.status(error.status).send({ error: error.message })
        throw error
      }
    }
  )

  fastify.get<{ Querystring: { page?: string; rarity?: string } }>(
    "/me/collection",
    async (req, reply): Promise<CollectionResponse | undefined> => {
      const user = await requireUser(req, reply)
      if (!user) return
      reply.header("Cache-Control", "private, no-store")
      return loadCollection(user.id, parsePage(req.query.page), isCardRarity(req.query.rarity) ? req.query.rarity : null)
    }
  )

  // Collections are public, like the rest of a profile
  fastify.get<{ Params: { id: string }; Querystring: { page?: string; rarity?: string } }>(
    "/users/:id/collection",
    async (req, reply): Promise<CollectionResponse | undefined> => {
      const owner = await prisma.user.findUnique({ where: { id: req.params.id.slice(0, 64) }, select: { id: true } })
      if (!owner) return reply.status(404).send({ error: "Joueur introuvable" })
      reply.header("Cache-Control", "private, no-store")
      return loadCollection(owner.id, parsePage(req.query.page), isCardRarity(req.query.rarity) ? req.query.rarity : null)
    }
  )

  // A browser could not load a cover from the Deezer CDN: refresh it on the next catalogue run
  fastify.post<{ Params: { entryId: string } }>("/cards/:entryId/cover-missing", async (req, reply) => {
    const user = await requireUser(req, reply)
    if (!user) return
    if (!allowFlag(user.id)) return reply.status(429).send({ error: "Trop de signalements, réessaie dans une minute" })
    await prisma.cardPoolEntry.updateMany({
      where: { id: req.params.entryId.slice(0, 64) },
      data: { needsRefresh: true },
    })
    return reply.status(204).send()
  })
}
