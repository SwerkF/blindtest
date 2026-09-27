import Fastify from "fastify"
import cors from "@fastify/cors"
import websocket from "@fastify/websocket"
import playlistsRoute from "@/routes/playlists"
import lobbiesRoute from "@/routes/lobbies"
import wsRoute from "@/ws"

const fastify = Fastify({ logger: { level: "info" } })

await fastify.register(cors, { origin: true })
await fastify.register(websocket)
await fastify.register(playlistsRoute)
await fastify.register(lobbiesRoute)
await fastify.register(wsRoute)

fastify.listen({ port: 3001, host: "0.0.0.0" }, (err) => {
  if (err) {
    fastify.log.error(err)
    process.exit(1)
  }
})
