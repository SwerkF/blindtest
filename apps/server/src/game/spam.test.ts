import { afterAll, beforeAll, expect, test } from "bun:test"
import Fastify, { type FastifyInstance } from "fastify"
import websocket from "@fastify/websocket"
import { SpamKind, SpamReason, type WsServerMessage } from "@blindmusic/shared"
import {
  DUPLICATE_WINDOW_MS,
  NOTICE_INTERVAL_MS,
  REACTION_COOLDOWN_MS,
  SPAM_MAX_EVENTS,
  SPAM_MUTE_MS,
  SPAM_WINDOW_MS,
  checkSpam,
  newSpamState,
} from "@/game/spam"
import { addPlayer, createRoom, registerSocket, removePlayer } from "@/game/engine"
import wsRoute from "@/ws"

test("chat : 5 messages par fenetre, puis muet quelques secondes", () => {
  const s = newSpamState()
  let t = 1000
  for (let i = 0; i < SPAM_MAX_EVENTS; i++) expect(checkSpam(s, SpamKind.Chat, (t += 100), `msg ${i}`).ok).toBe(true)

  const muted = checkSpam(s, SpamKind.Chat, (t += 100), "encore")
  expect(muted).toEqual({ ok: false, reason: SpamReason.Rate, retryInMs: SPAM_MUTE_MS, notify: true })
  // Toujours muet, et le joueur n'est pas re-prevenu tout de suite
  expect(checkSpam(s, SpamKind.Chat, t + 500, "x")).toMatchObject({ ok: false, notify: false })
  // Prevenu de nouveau apres l'intervalle s'il insiste
  expect(checkSpam(s, SpamKind.Chat, t + NOTICE_INTERVAL_MS, "y")).toMatchObject({ ok: false, notify: true })

  expect(checkSpam(s, SpamKind.Chat, t + SPAM_MUTE_MS, "de retour").ok).toBe(true)
})

test("chat : la fenetre glisse, un rythme raisonnable n'est jamais bloque", () => {
  const s = newSpamState()
  const step = SPAM_WINDOW_MS / SPAM_MAX_EVENTS
  for (let i = 0; i < 30; i++) expect(checkSpam(s, SpamKind.Chat, i * step, `m${i}`).ok).toBe(true)
})

test("chat : un message identique repete est ignore", () => {
  const s = newSpamState()
  expect(checkSpam(s, SpamKind.Chat, 0, "GG").ok).toBe(true)
  expect(checkSpam(s, SpamKind.Chat, 1000, "  gg ")).toMatchObject({ ok: false, reason: SpamReason.Duplicate, notify: true })
  expect(checkSpam(s, SpamKind.Chat, 1500, "gg bien joue").ok).toBe(true)
  expect(checkSpam(s, SpamKind.Chat, 2000, "gg bien joue").ok).toBe(false)
  expect(checkSpam(s, SpamKind.Chat, 2000 + DUPLICATE_WINDOW_MS, "gg bien joue").ok).toBe(true)
})

test("reactions : cooldown silencieux, puis muet au-dela du budget", () => {
  const s = newSpamState()
  expect(checkSpam(s, SpamKind.Reaction, 0).ok).toBe(true)
  expect(checkSpam(s, SpamKind.Reaction, REACTION_COOLDOWN_MS - 1)).toMatchObject({ ok: false, notify: false })

  let t = 0
  for (let i = 1; i < SPAM_MAX_EVENTS; i++) expect(checkSpam(s, SpamKind.Reaction, (t += REACTION_COOLDOWN_MS)).ok).toBe(true)
  expect(checkSpam(s, SpamKind.Reaction, (t += REACTION_COOLDOWN_MS))).toMatchObject({
    ok: false,
    reason: SpamReason.Rate,
    notify: true,
  })
  // Le chat garde son propre budget
  expect(checkSpam(s, SpamKind.Chat, t, "toujours la").ok).toBe(true)
  expect(checkSpam(s, SpamKind.Reaction, t + SPAM_MUTE_MS).ok).toBe(true)
})

// Bout en bout par le WebSocket : le spammeur est prevenu, les autres ne recoivent rien de plus
let app: FastifyInstance
let base = ""
beforeAll(async () => {
  app = Fastify({ forceCloseConnections: true })
  await app.register(websocket)
  await app.register(wsRoute)
  const address = await app.listen({ port: 0, host: "127.0.0.1" })
  base = address.replace(/^http/, "ws")
})
afterAll(() => app.close())

test("ws : le chat au-dela du budget n'est plus diffuse et l'auteur recoit un avertissement", async () => {
  const other: WsServerMessage[] = []
  createRoom("SP1", "a", "a", "a", () => {})
  registerSocket("SP1", "a", () => {})
  // A second player, wired straight into the engine like a socket would be
  addPlayer("SP1", "b", "b", "b", (m) => other.push(m))
  registerSocket("SP1", "b", (m) => other.push(m))

  const received: WsServerMessage[] = []
  const ws = new WebSocket(`${base}/ws?code=SP1&playerId=a`)
  ws.onmessage = (event) => received.push(JSON.parse(String(event.data)))
  await new Promise((resolve) => (ws.onopen = resolve))
  for (let i = 0; i < SPAM_MAX_EVENTS + 2; i++) ws.send(JSON.stringify({ type: "chat", text: `message ${i}` }))
  ws.send(JSON.stringify({ type: "reaction", emoji: "🔥" }))
  await Bun.sleep(150)

  const chats = other.filter((m) => m.type === "chat:message")
  expect(chats).toHaveLength(SPAM_MAX_EVENTS)
  // Les reactions ont leur budget a part
  expect(other.filter((m) => m.type === "reaction")).toHaveLength(1)
  const notices = received.filter((m) => m.type === "spam:notice")
  expect(notices).toEqual([{ type: "spam:notice", kind: SpamKind.Chat, reason: SpamReason.Rate, retryInMs: SPAM_MUTE_MS }])

  await new Promise((resolve) => {
    ws.onclose = resolve
    ws.close()
  })
  removePlayer("SP1", "b")
  removePlayer("SP1", "a")
})
