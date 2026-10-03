import type { FastifyInstance } from "fastify"
import type { User } from "@prisma/client"
import {
  FriendshipState,
  FriendshipStatus,
  achievementDef,
  type AchievementId,
  type PublicProfileResponse,
  type PublicProfileUser,
} from "@blindmusic/shared"
import { prisma } from "@/db"
import { userFromCookies } from "@/account/session"
import { playerAvatarUrl } from "@/account/users"
import { loadProfileStats } from "@/account/stats"
import { findPair, toHistoryItem } from "@/account/socialRoutes"
import type { FriendshipRow } from "@/account/friendship"

export const RECENT_GAMES_LIMIT = 10

/** Public face of an account: no Discord id, friend code or session. */
export function toPublicProfileUser(user: User): PublicProfileUser {
  return {
    id: user.id,
    pseudo: user.pseudo || user.username,
    username: user.username,
    avatarSeed: user.avatarSeed,
    avatarUrl: playerAvatarUrl(user),
    createdAt: user.createdAt.toISOString(),
  }
}

/** Relation between the viewer and the profile owner, seen from the viewer. */
export function friendshipStateFor(
  viewerId: string | null,
  ownerId: string,
  row: FriendshipRow | null
): FriendshipState {
  if (viewerId === null) return FriendshipState.Guest
  if (viewerId === ownerId) return FriendshipState.Self
  if (!row) return FriendshipState.None
  if (row.status === FriendshipStatus.Accepted) return FriendshipState.Friends
  return row.requesterId === viewerId ? FriendshipState.Outgoing : FriendshipState.Incoming
}

export default async function profileRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { id: string } }>(
    "/users/:id",
    async (req, reply): Promise<PublicProfileResponse | undefined> => {
      const id = req.params.id.slice(0, 64)
      const owner = await prisma.user.findUnique({ where: { id } })
      if (!owner) return reply.status(404).send({ error: "Joueur introuvable" })

      const viewer = await userFromCookies(req.headers.cookie)
      const [stats, achievements, games, pair] = await Promise.all([
        loadProfileStats(owner.id),
        prisma.userAchievement.findMany({ where: { userId: owner.id }, orderBy: { unlockedAt: "asc" } }),
        prisma.gameResult.findMany({
          where: { userId: owner.id },
          orderBy: { playedAt: "desc" },
          take: RECENT_GAMES_LIMIT,
        }),
        viewer && viewer.id !== owner.id ? findPair(viewer.id, owner.id) : null,
      ])
      const row: FriendshipRow | null = pair && {
        requesterId: pair.requesterId,
        addresseeId: pair.addresseeId,
        status: pair.status === FriendshipStatus.Accepted ? FriendshipStatus.Accepted : FriendshipStatus.Pending,
      }

      reply.header("Cache-Control", "private, no-store")
      return {
        user: toPublicProfileUser(owner),
        stats,
        // Retired ids are dropped; secret ones only ever show here once unlocked
        achievements: achievements
          .filter((a) => achievementDef(a.achievementId))
          .map((a) => ({ id: a.achievementId as AchievementId, unlockedAt: a.unlockedAt.toISOString() })),
        // Room codes stay private: an old lobby may still be open
        recentGames: games.map((game) => ({ ...toHistoryItem(game), roomCode: "" })),
        friendship: friendshipStateFor(viewer?.id ?? null, owner.id, row),
        friendshipId: pair?.id ?? null,
      }
    }
  )
}
