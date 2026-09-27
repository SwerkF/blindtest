import type { FastifyInstance } from "fastify"
import { prisma } from "@/db"
import { fetchPlaylistMeta } from "@/deezer"

export default async function playlistsRoute(fastify: FastifyInstance) {
  fastify.get("/playlists", async () => {
    return prisma.playlist.findMany({
      select: { id: true, name: true, slug: true, description: true, coverUrl: true, trackCount: true },
      orderBy: { name: "asc" },
    })
  })

  fastify.get<{ Params: { id: string } }>("/deezer/playlists/:id", async (req, reply) => {
    const meta = await fetchPlaylistMeta(req.params.id)
    if (!meta) return reply.status(404).send({ error: "Playlist introuvable" })
    return meta
  })
}
