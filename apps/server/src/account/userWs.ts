import type { FastifyInstance } from "fastify"
import type { UserWsServerMessage } from "@blindmusic/shared"
import { userFromCookies } from "@/account/session"
import { addUserSocket, removeUserSocket } from "@/account/presence"
import { notifyFriends } from "@/account/users"

/** Close code telling the client it is not logged in, so it does not retry. */
export const UNAUTHORIZED_CLOSE = 4401

/**
 * Per-account socket, open on every page while logged in: presence for friends,
 * friend requests, lobby invites and achievement unlocks.
 */
export default async function userWsRoute(fastify: FastifyInstance) {
  fastify.get("/ws/user", { websocket: true }, async function (socket, req) {
    const user = await userFromCookies(req.headers.cookie).catch(() => null)
    if (!user) {
      socket.close(UNAUTHORIZED_CLOSE, "unauthorized")
      return
    }
    // The tab may have gone while the session was looked up
    if (socket.readyState !== socket.OPEN) return
    const send = (msg: UserWsServerMessage) => socket.send(JSON.stringify(msg))
    if (addUserSocket(user.id, send)) {
      void notifyFriends(user.id, { type: "friend:presence", userId: user.id, online: true }).catch(() => {})
    }
    // Client pings only keep proxies from idling the connection out
    socket.on("message", () => {})
    socket.on("close", () => {
      if (removeUserSocket(user.id, send)) {
        void notifyFriends(user.id, { type: "friend:presence", userId: user.id, online: false }).catch(() => {})
      }
    })
  })
}
