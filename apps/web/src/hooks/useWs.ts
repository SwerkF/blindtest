import { useCallback, useEffect, useRef, useState } from "react"
import type { WsClientMessage, WsServerMessage } from "@blindmusic/shared"
import { wsUrl } from "@/utils/api"

type Handler = (msg: WsServerMessage) => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isServerMessage(value: unknown): value is WsServerMessage {
  return isRecord(value) && typeof value.type === "string"
}

export function useWs(code: string, playerId: string) {
  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef<Handler[]>([])
  const queueRef = useRef<WsClientMessage[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!code || !playerId) return
    let stopped = false
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      const ws = new WebSocket(wsUrl(code, playerId))
      socket = ws
      wsRef.current = ws

      ws.onopen = () => {
        if (stopped || wsRef.current !== ws) return
        setConnected(true)
        const pending = queueRef.current.splice(0)
        for (const msg of pending) ws.send(JSON.stringify(msg))
      }

      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null
          setConnected(false)
        }
        if (!stopped) retry = setTimeout(connect, 800)
      }

      ws.onmessage = (event) => {
        if (typeof event.data !== "string") return
        let parsed: unknown
        try {
          parsed = JSON.parse(event.data)
        } catch {
          return
        }
        if (!isServerMessage(parsed)) return
        if (parsed.type === "error" && typeof parsed.message === "string" && parsed.message.includes("introuvable")) {
          stopped = true
        }
        for (const handler of [...handlersRef.current]) handler(parsed)
      }
    }

    connect()

    return () => {
      stopped = true
      if (retry) clearTimeout(retry)
      socket?.close()
      if (wsRef.current === socket) wsRef.current = null
      setConnected(false)
    }
  }, [code, playerId])

  const send = useCallback((msg: WsClientMessage) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
      return
    }
    queueRef.current.push(msg)
    if (queueRef.current.length > 20) queueRef.current.shift()
  }, [])

  const onMessage = useCallback((handler: Handler) => {
    handlersRef.current.push(handler)
    return () => {
      handlersRef.current = handlersRef.current.filter((item) => item !== handler)
    }
  }, [])

  return { send, onMessage, connected }
}
