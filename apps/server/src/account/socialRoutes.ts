import type { FastifyInstance, FastifyReply } from "fastify"
import type { Friendship, User } from "@prisma/client"
import {
  FriendRequestOutcome,
  FriendshipStatus,
  GameMode,
  type AchievementId,
  type FriendsResponse,
  type HistoryResponse,
  type UnlockedAchievement,
} from "@blindmusic/shared"
import { prisma } from "@/db"
import { requireUser } from "@/account/authRoutes"
import {
  FRIEND_ERROR_MESSAGE,
  FriendAction,
  FriendError,
  friendshipTransition,
  normalizeFriendCode,
  otherUserId,
  type FriendshipRow,
} from "@/account/friendship"
import { isOnline, notifyUser } from "@/account/presence"
import { toPublicUser } from "@/account/users"
import { syncSwerkFriendAchievement } from "@/account/swerk"
import { isUserInRoom, rooms } from "@/game/engine"

const HISTORY_LIMIT = 50
const SEARCH_LIMIT = 10

function toRow(friendship: Friendship): FriendshipRow {
  return {
    requesterId: friendship.requesterId,
    addresseeId: friendship.addresseeId,
    status: friendship.status === FriendshipStatus.Accepted ? FriendshipStatus.Accepted : FriendshipStatus.Pending,
  }
}

function findPair(a: string, b: string) {
  return prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
  })
}

export default async function socialRoutes(fastify: FastifyInstance) {
  fastify.get("/me/history", async (req, reply): Promise<HistoryResponse | undefined> => {
    const user = await requireUser(req, reply)
    if (!user) return
    const [rows, gamesPlayed, wins] = await Promise.all([
      prisma.gameResult.findMany({ where: { userId: user.id }, orderBy: { playedAt: "desc" }, take: HISTORY_LIMIT }),
      prisma.gameResult.count({ where: { userId: user.id } }),
      prisma.gameResult.count({ where: { userId: user.id, won: true } }),
    ])
    return {
      gamesPlayed,
      wins,
      items: rows.map((r) => ({
        id: r.id,
        roomCode: r.roomCode,
        mode: r.mode === GameMode.Anime ? GameMode.Anime : GameMode.Classic,
        score: r.score,
        rank: r.rank,
        playerCount: r.playerCount,
        roundCount: r.roundCount,
        won: r.won,
        team: r.team,
        teamWon: r.teamWon,
        playedAt: r.playedAt.toISOString(),
      })),
    }
  })

  fastify.get("/me/achievements", async (req, reply): Promise<UnlockedAchievement[] | undefined> => {
    const user = await requireUser(req, reply)
    if (!user) return
    // Retroactive « Ami de Swerk » for friendships older than the achievement
    await syncSwerkFriendAchievement([user.id])
    const rows = await prisma.userAchievement.findMany({ where: { userId: user.id }, orderBy: { unlockedAt: "asc" } })
    return rows.map((r) => ({ id: r.achievementId as AchievementId, unlockedAt: r.unlockedAt.toISOString() }))
  })

  fastify.get("/friends", async (req, reply): Promise<FriendsResponse | undefined> => {
    const user = await requireUser(req, reply)
    if (!user) return
    const rows = await prisma.friendship.findMany({
      where: { OR: [{ requesterId: user.id }, { addresseeId: user.id }] },
      include: { requester: true, addressee: true },
      orderBy: { updatedAt: "desc" },
    })
    const other = (row: (typeof rows)[number]) => (row.requesterId === user.id ? row.addressee : row.requester)
    const response: FriendsResponse = { friends: [], incoming: [], outgoing: [] }
    for (const row of rows) {
      const friend = toPublicUser(other(row))
      if (row.status === FriendshipStatus.Accepted) {
        response.friends.push({ friendshipId: row.id, user: friend, online: isOnline(friend.id) })
        continue
      }
      const entry = { friendshipId: row.id, user: friend, createdAt: row.createdAt.toISOString() }
      if (row.addresseeId === user.id) response.incoming.push(entry)
      else response.outgoing.push(entry)
    }
    // Online friends first, then alphabetical
    response.friends.sort((a, b) => Number(b.online) - Number(a.online) || a.user.pseudo.localeCompare(b.user.pseudo))
    return response
  })

  fastify.get<{ Querystring: { q?: string } }>("/friends/search", async (req, reply) => {
    const user = await requireUser(req, reply)
    if (!user) return
    const q = (req.query.q ?? "").trim().slice(0, 40)
    if (q.length < 2) return []
    const code = normalizeFriendCode(q)
    const found = await prisma.user.findMany({
      where: {
        id: { not: user.id },
        OR: [
          { username: { contains: q } },
          { pseudo: { contains: q } },
          ...(code.length >= 4 ? [{ friendCode: code }] : []),
        ],
      },
      take: SEARCH_LIMIT,
    })
    return found.map(toPublicUser)
  })

  /** Body takes a user id (from search) or a friend code. */
  fastify.post<{ Body: { userId?: unknown; friendCode?: unknown } }>("/friends/requests", async (req, reply) => {
    const user = await requireUser(req, reply)
    if (!user) return
    let target: User | null = null
    if (typeof req.body?.userId === "string") {
      target = await prisma.user.findUnique({ where: { id: req.body.userId } })
    } else if (typeof req.body?.friendCode === "string") {
      target = await prisma.user.findUnique({ where: { friendCode: normalizeFriendCode(req.body.friendCode) } })
    }
    if (!target) return reply.status(404).send({ error: "Joueur introuvable" })

    const existing = await findPair(user.id, target.id)
    const transition = friendshipTransition(existing && toRow(existing), user.id, target.id, FriendAction.Request)
    const me = toPublicUser(user)
    switch (transition.kind) {
      case "error":
        return reply.status(409).send({ error: FRIEND_ERROR_MESSAGE[transition.error] })
      case "create":
        await prisma.friendship.create({ data: transition.row })
        notifyUser(target.id, { type: "friend:request", from: me })
        return { outcome: FriendRequestOutcome.Sent }
      case "update":
        await prisma.friendship.update({ where: { id: existing!.id }, data: { status: transition.row.status } })
        notifyUser(target.id, { type: "friend:accepted", from: me })
        await syncSwerkFriendAchievement([user.id, target.id])
        return { outcome: FriendRequestOutcome.Accepted }
      case "delete":
        return reply.status(400).send({ error: "Action impossible" })
    }
  })

  async function applyAction(user: User, friendshipId: string, action: FriendAction, reply: FastifyReply) {
    const row = await prisma.friendship.findUnique({ where: { id: friendshipId } })
    if (!row || (row.requesterId !== user.id && row.addresseeId !== user.id)) {
      return reply.status(404).send({ error: "Demande introuvable" })
    }
    const targetId = otherUserId(row, user.id)
    const transition = friendshipTransition(toRow(row), user.id, targetId, action)
    if (transition.kind === "error") return reply.status(409).send({ error: FRIEND_ERROR_MESSAGE[transition.error] })
    if (transition.kind === "delete") {
      await prisma.friendship.delete({ where: { id: row.id } })
      notifyUser(targetId, { type: "friend:changed" })
    } else if (transition.kind === "update") {
      await prisma.friendship.update({ where: { id: row.id }, data: { status: transition.row.status } })
      notifyUser(targetId, { type: "friend:accepted", from: toPublicUser(user) })
      await syncSwerkFriendAchievement([user.id, targetId])
    }
    return reply.status(204).send()
  }

  fastify.post<{ Params: { id: string } }>("/friends/:id/accept", async (req, reply) => {
    const user = await requireUser(req, reply)
    if (user) return applyAction(user, req.params.id, FriendAction.Accept, reply)
  })

  fastify.post<{ Params: { id: string } }>("/friends/:id/decline", async (req, reply) => {
    const user = await requireUser(req, reply)
    if (user) return applyAction(user, req.params.id, FriendAction.Decline, reply)
  })

  fastify.delete<{ Params: { id: string } }>("/friends/:id", async (req, reply) => {
    const user = await requireUser(req, reply)
    if (user) return applyAction(user, req.params.id, FriendAction.Remove, reply)
  })

  /** Pings an online friend with the lobby code; the inviter must be in that lobby. */
  fastify.post<{ Body: { userId?: unknown; code?: unknown } }>("/friends/invite", async (req, reply) => {
    const user = await requireUser(req, reply)
    if (!user) return
    const friendId = typeof req.body?.userId === "string" ? req.body.userId : ""
    const code = typeof req.body?.code === "string" ? req.body.code.toUpperCase() : ""
    if (!rooms.has(code)) return reply.status(404).send({ error: "Salon introuvable" })
    if (!isUserInRoom(code, user.id)) return reply.status(403).send({ error: "Tu n'es pas dans ce salon" })
    const friendship = await findPair(user.id, friendId)
    if (friendship?.status !== FriendshipStatus.Accepted) {
      return reply.status(403).send({ error: FRIEND_ERROR_MESSAGE[FriendError.NotFriends] })
    }
    const delivered = notifyUser(friendId, { type: "lobby:invite", from: toPublicUser(user), code })
    if (!delivered) return reply.status(409).send({ error: "Ton ami n'est pas connecté" })
    return { delivered }
  })
}
