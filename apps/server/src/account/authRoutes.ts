import { randomBytes } from "node:crypto"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { User } from "@prisma/client"
import type { MeResponse } from "@blindmusic/shared"
import { prisma } from "@/db"
import { authConfig, discordEnabled } from "@/account/config"
import { discordAuthorizeUrl, exchangeDiscordCode, fetchDiscordUser } from "@/account/discord"
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  createSession,
  destroySession,
  parseCookies,
  serializeCookie,
  signValue,
  unsignValue,
  userFromCookies,
} from "@/account/session"
import {
  AVATAR_SEED_MAX_LENGTH,
  PSEUDO_MAX_LENGTH,
  playerAvatarUrl,
  friendIds,
  toAccountUser,
  upsertDiscordUser,
} from "@/account/users"
import { syncSwerkFriendAchievement } from "@/account/swerk"
import { setUserAvatarUrl } from "@/game/engine"

const STATE_TTL_SECONDS = 600

/** Only same-site paths, so the login flow cannot be turned into an open redirect. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/"
  return value.slice(0, 200)
}

function webUrl(path: string): string {
  return `${authConfig.webOrigin ?? ""}${path}`
}

/** Replies 401 and returns null for guests. */
export async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<User | null> {
  const user = await userFromCookies(req.headers.cookie)
  if (!user) {
    reply.status(401).send({ error: "Connexion requise" })
    return null
  }
  return user
}

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { returnTo?: string } }>("/auth/discord", async (req, reply) => {
    if (!discordEnabled()) return reply.status(503).send({ error: "Connexion Discord indisponible" })
    const state = randomBytes(16).toString("base64url")
    const returnTo = safeReturnTo(req.query.returnTo)
    reply.header("set-cookie", serializeCookie(OAUTH_STATE_COOKIE, signValue(`${state}|${returnTo}`), STATE_TTL_SECONDS))
    return reply.redirect(discordAuthorizeUrl(state))
  })

  fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/discord/callback",
    async (req, reply) => {
      const stored = unsignValue(parseCookies(req.headers.cookie)[OAUTH_STATE_COOKIE])
      const [expectedState, storedReturnTo] = stored?.split("|") ?? []
      const returnTo = safeReturnTo(storedReturnTo)
      const fail = (reason: string) => {
        reply.header("set-cookie", clearCookie(OAUTH_STATE_COOKIE))
        return reply.redirect(webUrl(`${returnTo}${returnTo.includes("?") ? "&" : "?"}authError=${reason}`))
      }
      if (!discordEnabled()) return fail("unavailable")
      if (req.query.error) return fail("denied")
      if (!req.query.code || !expectedState || req.query.state !== expectedState) return fail("state")

      try {
        const token = await exchangeDiscordCode(req.query.code)
        const discordUser = await fetchDiscordUser(token)
        const user = await upsertDiscordUser(discordUser)
        const sessionCookie = await createSession(user.id)
        // Retroactive « Ami de Swerk », also for Swerk's friends when he logs in for the first time
        void friendIds(user.id)
          .then((ids) => syncSwerkFriendAchievement([user.id, ...ids]))
          .catch((error) => req.log.error(error, "Swerk achievement sync failed"))
        reply.header("set-cookie", [sessionCookie, clearCookie(OAUTH_STATE_COOKIE)])
        return reply.redirect(webUrl(returnTo))
      } catch (error) {
        req.log.error(error, "Discord login failed")
        return fail("discord")
      }
    }
  )

  fastify.get("/auth/me", async (req): Promise<MeResponse> => {
    const user = await userFromCookies(req.headers.cookie)
    return { user: user ? toAccountUser(user) : null, discordEnabled: discordEnabled() }
  })

  fastify.patch<{ Body: { pseudo?: unknown; avatarSeed?: unknown; useDiscordAvatar?: unknown } }>("/auth/me", async (req, reply) => {
    const user = await requireUser(req, reply)
    if (!user) return
    const data: { pseudo?: string; avatarSeed?: string; useDiscordAvatar?: boolean } = {}
    if (typeof req.body?.useDiscordAvatar === "boolean") data.useDiscordAvatar = req.body.useDiscordAvatar
    if (typeof req.body?.pseudo === "string") {
      const pseudo = req.body.pseudo.trim().slice(0, PSEUDO_MAX_LENGTH)
      if (pseudo) data.pseudo = pseudo
    }
    if (typeof req.body?.avatarSeed === "string") {
      const seed = req.body.avatarSeed.trim().slice(0, AVATAR_SEED_MAX_LENGTH)
      if (seed) data.avatarSeed = seed
    }
    const updated = await prisma.user.update({ where: { id: user.id }, data })
    if (updated.useDiscordAvatar !== user.useDiscordAvatar) setUserAvatarUrl(updated.id, playerAvatarUrl(updated))
    return toAccountUser(updated)
  })

  /** Deletes the account and everything tied to it (sessions, history, achievements, friends). */
  fastify.delete("/auth/me", async (req, reply) => {
    const user = await requireUser(req, reply)
    if (!user) return
    await prisma.user.delete({ where: { id: user.id } })
    reply.header("set-cookie", clearCookie(SESSION_COOKIE))
    return reply.status(204).send()
  })

  fastify.post("/auth/logout", async (req, reply) => {
    await destroySession(req.headers.cookie)
    reply.header("set-cookie", clearCookie(SESSION_COOKIE))
    return reply.status(204).send()
  })
}
