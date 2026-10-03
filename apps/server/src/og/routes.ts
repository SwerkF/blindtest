import type { FastifyInstance } from "fastify"
import { prisma } from "@/db"
import { achievementDef } from "@blindmusic/shared"
import { playerAvatarUrl } from "@/account/users"
import { cachedCard, cardHash, renderUserCard, storeCard, type UserCardData } from "@/og/userCard"

const USER_ID = /^[A-Za-z0-9_-]{1,64}$/
/** Link previews are refetched rarely; an hour keeps stats fresh enough. */
const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400"

async function loadCardData(userId: string): Promise<UserCardData | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return null
  const [gamesPlayed, wins, achievements] = await Promise.all([
    prisma.gameResult.count({ where: { userId } }),
    prisma.gameResult.count({ where: { userId, won: true } }),
    prisma.userAchievement.findMany({ where: { userId }, select: { achievementId: true } }),
  ])
  const pseudo = user.pseudo || user.username
  return {
    pseudo,
    username: user.username,
    avatarSeed: user.avatarSeed || pseudo,
    avatarUrl: playerAvatarUrl(user),
    gamesPlayed,
    wins,
    winRate: gamesPlayed ? Math.round((wins / gamesPlayed) * 100) : 0,
    achievements: achievements.filter((a) => achievementDef(a.achievementId)).length,
  }
}

/** GET /og/user/:id.png — share card of a public profile (og:image of /u/:id, see apps/web/nginx.conf). */
export default async function ogRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { file: string } }>("/og/user/:file", async (req, reply) => {
    const id = req.params.file.replace(/\.png$/, "")
    const data = USER_ID.test(id) ? await loadCardData(id) : null
    // Unknown or deleted account: fall back to the site-wide card served by the web app
    if (!data) return reply.redirect("/og-image.png")

    const hash = cardHash(data)
    const etag = `"${hash}"`
    if (req.headers["if-none-match"] === etag) {
      return reply.header("Cache-Control", CACHE_CONTROL).header("ETag", etag).status(304).send()
    }

    let png = cachedCard(id, hash)
    if (!png) {
      const rendered = await renderUserCard(data)
      png = rendered.png
      if (rendered.complete) storeCard(id, hash, png)
    }
    return reply.header("Cache-Control", CACHE_CONTROL).header("ETag", etag).type("image/png").send(Buffer.from(png))
  })
}
