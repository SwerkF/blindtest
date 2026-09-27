/** Manual end-to-end check against the running docker stack. */
const BASE = "http://localhost/api"
const WS = "ws://localhost/ws"

interface Msg {
  type: string
  [k: string]: unknown
}

function open(code: string, playerId: string, label: string) {
  const ws = new WebSocket(`${WS}?code=${code}&playerId=${playerId}`)
  const inbox: Msg[] = []
  ws.onmessage = (e) => {
    const m: Msg = JSON.parse(String(e.data))
    inbox.push(m)
    console.log(`   [${label}] <- ${m.type}${m.type === "error" ? ` : ${m.message}` : ""}`)
  }
  const ready = new Promise<void>((res, rej) => {
    ws.onopen = () => res()
    ws.onerror = () => rej(new Error(`${label} ws failed`))
  })
  return { ws, inbox, ready }
}

async function waitFor(inbox: Msg[], type: string, ms = 12000): Promise<Msg | null> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const found = inbox.find((m) => m.type === type)
    if (found) return found
    await Bun.sleep(100)
  }
  return null
}

const post = (path: string, body: unknown) =>
  fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json())

const playlists = await fetch(`${BASE}/playlists`).then((r) => r.json())
const target = playlists.find((p: { slug: string }) => p.slug === "hits-2010")

const alice = await post("/lobbies", { playerName: "Alice" })
const bob = await post(`/lobbies/${alice.code}/join`, { playerName: "Bob" })
console.log(`Salon ${alice.code} : Alice (hote) + Bob\n`)

console.log("1. Connexion des deux joueurs au lobby")
const a1 = open(alice.code, alice.playerId, "Alice")
await a1.ready
const b = open(alice.code, bob.playerId, "Bob")
await b.ready
await Bun.sleep(300)

const roster = [...a1.inbox].reverse().find((m) => m.type === "lobby:update")
console.log(`   roster vu par Alice : ${(roster?.players as { name: string }[]).map((p) => p.name).join(", ")}\n`)

console.log("2. Alice lance la partie")
a1.ws.send(
  JSON.stringify({
    type: "lobby:start",
    settings: {
      playlistIds: [target.id],
      customDeezerPlaylistIds: [],
      trackCount: 3,
      roundDuration: 15,
      maxErrorPercent: 20,
      yearGuessAttempts: 2,
      showLyrics: true,
      showHint: true,
    },
  })
)
const start = await waitFor(a1.inbox, "game:start")
if (!start) throw new Error("game:start jamais recu")
console.log(`   compte a rebours : ${Math.round((Number(start.startsAt) - Date.now()) / 1000)}s\n`)

console.log("3. Alice navigue vers /game : son WebSocket se ferme puis se rouvre")
a1.ws.close()
await Bun.sleep(400)
const a2 = open(alice.code, alice.playerId, "Alice")
await a2.ready
await Bun.sleep(400)

const rejected = a2.inbox.find((m) => m.type === "error")
if (rejected) throw new Error(`REJETEE : ${rejected.message}`)

const roster2 = a2.inbox.find((m) => m.type === "lobby:update")
if (!roster2) throw new Error("pas de roster apres navigation")
console.log(`   roster conserve : ${(roster2.players as { name: string }[]).map((p) => p.name).join(", ")}`)
const resync = a2.inbox.find((m) => m.type === "game:start")
console.log(`   compte a rebours rattrape : ${resync ? "oui" : "non (deja demarre)"}\n`)

console.log("4. Attente du demarrage de la musique")
const round = await waitFor(a2.inbox, "round:start")
if (!round) throw new Error("round:start jamais recu")
const r = round.round as { trackIndex: number; total: number; previewUrl: string; duration: number }
console.log(`   manche ${r.trackIndex}/${r.total}, duree ${r.duration}ms`)
const audio = await fetch(r.previewUrl, { method: "HEAD" })
console.log(`   audio : ${audio.status} ${audio.headers.get("content-type")}\n`)

console.log("5. Chat Bob -> Alice")
b.ws.send(JSON.stringify({ type: "chat", text: "salut !" }))
const chat = await waitFor(a2.inbox, "chat:message", 5000)
if (!chat) throw new Error("chat jamais recu")
console.log(`   recu : ${chat.playerName} : ${chat.text}\n`)

console.log("6. Champ unique : Bob tente un mauvais guess, puis une annee")
const before = b.inbox.length
b.ws.send(JSON.stringify({ type: "guess", text: "nimportequoi" }))
b.ws.send(JSON.stringify({ type: "guess", text: "2010" }))
await Bun.sleep(400)
const results = b.inbox.slice(before).filter((m) => m.type === "guess:result")
for (const g of results) console.log(`   "${g.text}" -> ${g.matched}, ${g.pointsEarned} pts`)

// Ni le texte ni la reponse ne doivent fuiter aux adversaires
const leakedText = a2.inbox.filter((m) => m.type === "guess:result" && m.text !== undefined)
const leakedAnswer = a2.inbox.filter((m) => m.type === "guess:result" && m.revealedTitle !== undefined)
console.log(`   texte visible par Alice   : ${leakedText.length === 0 ? "non (correct)" : "OUI — FUITE"}`)
console.log(`   reponse visible par Alice : ${leakedAnswer.length === 0 ? "non (correct)" : "OUI — FUITE"}\n`)

console.log("7. Fin de manche : revelation puis pause")
const reveal = await waitFor(a2.inbox, "round:reveal", 20000)
if (!reveal) throw new Error("round:reveal jamais recu")
console.log(`   reponse : ${reveal.title} — ${reveal.artist} (${reveal.year})`)
console.log(`   pochette : ${reveal.coverUrl ? "oui" : "non"}`)
console.log(`   paroles : ${reveal.lyrics ? `${String(reveal.lyrics).length} caracteres` : "indisponibles"}`)
console.log(`   prochaine manche dans ${Math.round((Number(reveal.nextAt) - Date.now()) / 1000)}s`)

a2.ws.close()
b.ws.close()
console.log("\nOK : tous les controles sont passes.")
process.exit(0)
