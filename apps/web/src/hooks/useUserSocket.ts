import { useEffect, useRef } from "react"
import type { UserWsServerMessage } from "@blindmusic/shared"
import { userSocketUrl } from "@/utils/accountApi"

/** Matches the server close code for a missing or expired session. */
const UNAUTHORIZED_CLOSE = 4401
const PING_MS = 30_000
const MAX_RETRY_MS = 15_000

function isUserMessage(value: unknown): value is UserWsServerMessage {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string"
}

/**
 * Keeps the per-account socket open while logged in (presence, invites,
 * friend requests, achievements). Does nothing for guests.
 */
export function useUserSocket(
  userId: string | null,
  onMessage: (msg: UserWsServerMessage) => void,
  onUnauthorized: () => void
) {
  const handlerRef = useRef(onMessage)
  handlerRef.current = onMessage
  const unauthorizedRef = useRef(onUnauthorized)
  unauthorizedRef.current = onUnauthorized

  useEffect(() => {
    if (!userId) return
    let stopped = false
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let ping: ReturnType<typeof setInterval> | null = null
    let attempts = 0

    const connect = () => {
      const ws = new WebSocket(userSocketUrl())
      socket = ws
      ws.onopen = () => {
        attempts = 0
        ping = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }))
        }, PING_MS)
      }
      ws.onmessage = (event) => {
        if (typeof event.data !== "string") return
        let parsed: unknown
        try {
          parsed = JSON.parse(event.data)
        } catch {
          return
        }
        if (isUserMessage(parsed)) handlerRef.current(parsed)
      }
      ws.onclose = (event) => {
        if (ping) clearInterval(ping)
        ping = null
        if (stopped) return
        if (event.code === UNAUTHORIZED_CLOSE) {
          unauthorizedRef.current()
          return
        }
        attempts++
        retry = setTimeout(connect, Math.min(MAX_RETRY_MS, 1000 * 2 ** Math.min(attempts, 4)))
      }
    }

    connect()
    return () => {
      stopped = true
      if (retry) clearTimeout(retry)
      if (ping) clearInterval(ping)
      socket?.close()
    }
  }, [userId])
}
