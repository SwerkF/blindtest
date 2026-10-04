import Fastify from "fastify"
import cors from "@fastify/cors"
import websocket from "@fastify/websocket"
import playlistsRoute from "@/routes/playlists"
import lobbiesRoute from "@/routes/lobbies"
import wsRoute from "@/ws"
import accountModule from "@/account"
import feedbackRoutes from "@/feedback/routes"
import ogRoutes from "@/og/routes"

const fastify = Fastify({ logger: { level: "info" } })

// Credentials so the session cookie also works when the web app is served from another origin
await fastify.register(cors, {
  origin: process.env.WEB_ORIGIN?.trim() || true,
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PATCH", "DELETE"],
})
await fastify.register(websocket)
await fastify.register(playlistsRoute)
await fastify.register(lobbiesRoute)
await fastify.register(wsRoute)
await fastify.register(accountModule)
await fastify.register(feedbackRoutes)
await fastify.register(ogRoutes)

fastify.listen({ port: 3001, host: "0.0.0.0" }, (err) => {
  if (err) {
    fastify.log.error(err)
    process.exit(1)
  }
})
