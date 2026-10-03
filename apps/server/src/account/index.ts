import type { FastifyInstance } from "fastify"
import { onGameEnd } from "@/game/engine"
import authRoutes from "@/account/authRoutes"
import socialRoutes from "@/account/socialRoutes"
import userWsRoute from "@/account/userWs"
import { persistGameResults } from "@/account/results"

/** Optional Discord accounts: auth, history, achievements, friends and the per-user socket. */
export default async function accountModule(fastify: FastifyInstance) {
  await fastify.register(authRoutes)
  await fastify.register(socialRoutes)
  await fastify.register(userWsRoute)
  onGameEnd((summary) => {
    persistGameResults(summary).catch((error: unknown) => fastify.log.error(error, "Saving game results failed"))
  })
}
