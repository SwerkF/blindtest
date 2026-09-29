import type { FastifyInstance } from "fastify"
import { rooms, createRoom, addPlayer } from "@/game/engine"

function genCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

function genId(): string {
  return crypto.randomUUID()
}

function avatarSeedFrom(body: { playerName?: string; avatarSeed?: string }): string {
  const seed = body.avatarSeed?.trim().slice(0, 160)
  return seed || body.playerName?.trim() || "joueur"
}

export default async function lobbiesRoute(fastify: FastifyInstance) {
  fastify.post<{ Body: { playerName: string; avatarSeed?: string } }>("/lobbies", async (req, reply) => {
    const { playerName } = req.body
    if (!playerName?.trim()) return reply.status(400).send({ error: "playerName requis" })
    let code = genCode()
    while (rooms.has(code)) code = genCode()
    const playerId = genId()
    // send is a no-op here; the real send is registered on WS connect
    createRoom(code, playerId, playerName.trim(), avatarSeedFrom(req.body), () => {})
    return { code, playerId, playerName: playerName.trim() }
  })

  /** Lets an invite link check the room before asking for a pseudo. */
  fastify.get<{ Params: { code: string } }>("/lobbies/:code", async (req, reply) => {
    const room = rooms.get(req.params.code.toUpperCase())
    if (!room) return reply.status(404).send({ error: "Salon introuvable" })
    return { code: room.code, phase: room.phase, playerCount: room.players.size }
  })

  fastify.post<{ Params: { code: string }; Body: { playerName: string; avatarSeed?: string } }>(
    "/lobbies/:code/join",
    async (req, reply) => {
      const { code } = req.params
      const { playerName } = req.body
      if (!playerName?.trim()) return reply.status(400).send({ error: "playerName requis" })
      const room = rooms.get(code.toUpperCase())
      if (!room) return reply.status(404).send({ error: "Salon introuvable" })
      const playerId = genId()
      const joined = addPlayer(code.toUpperCase(), playerId, playerName.trim(), avatarSeedFrom(req.body), () => {})
      if (!joined) return reply.status(409).send({ error: "Impossible de rejoindre" })
      return { code: code.toUpperCase(), playerId, playerName: playerName.trim() }
    }
  )

  fastify.post("/playlist-suggestions", async (_req, reply) => {
    reply.status(204).send()
  })
}
