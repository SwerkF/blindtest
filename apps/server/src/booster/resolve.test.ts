import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"
import { CardRarity } from "@blindmusic/shared"
import { createTestDb } from "@/booster/testDb"
import { resolveEntry } from "@/booster/resolve"

const db = createTestDb()
const { client } = db

beforeAll(() => client.$connect())
afterAll(() => db.close())

let seq = 0
async function makeEntry(over: Record<string, unknown> = {}) {
  seq++
  return client.cardPoolEntry.create({
    data: { isrc: `RES${seq}`, title: `T${seq}`, artistName: "A", rarity: CardRarity.Commun, popularityScore: 1, ...over },
  })
}

interface Call {
  url: string
  signal: AbortSignal | null | undefined
}
let calls: Call[] = []
beforeEach(() => {
  calls = []
})

/** A fetch that answers every call with the given status and JSON body. */
function answer(status: number, body: unknown): typeof fetch {
  return (async (input: Request | string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), signal: init?.signal })
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  }) as typeof fetch
}

const refuse = (async (input: Request | string | URL, init?: RequestInit) => {
  calls.push({ url: String(input), signal: init?.signal })
  throw new TypeError("fetch failed")
}) as unknown as typeof fetch

const good = { id: 3_000_000_123, readable: true, preview: "https://cdn.example/p.mp3", md5_image: "abc123" }

test("succès : appelle Deezer par ISRC avec un timeout, écrit l'id (BigInt), le md5 et resolvedAt", async () => {
  const entry = await makeEntry()
  const before = Date.now()
  const resolved = await resolveEntry(entry, { client, fetch: answer(200, good) })
  expect(calls).toHaveLength(1)
  expect(calls[0]!.url).toBe(`https://api.deezer.com/track/isrc:${entry.isrc}`)
  expect(calls[0]!.signal).toBeInstanceOf(AbortSignal)
  expect(resolved?.deezerTrackId).toBe(3_000_000_123n)
  expect(resolved?.deezerMd5Image).toBe("abc123")
  const row = await client.cardPoolEntry.findUniqueOrThrow({ where: { id: entry.id } })
  expect(row.deezerTrackId).toBe(3_000_000_123n)
  expect(row.deezerMd5Image).toBe("abc123")
  expect(row.resolvedAt!.getTime()).toBeGreaterThanOrEqual(before)
  expect(row.unplayable).toBe(false)
})

test("entrée déjà résolue : retournée telle quelle, aucun appel", async () => {
  const entry = await makeEntry({ deezerTrackId: 77, deezerMd5Image: "old", resolvedAt: new Date(1000) })
  const resolved = await resolveEntry(entry, { client, fetch: answer(200, good) })
  expect(calls).toHaveLength(0)
  expect(resolved as unknown).toEqual(entry)
})

test("404 : injouable, null", async () => {
  const entry = await makeEntry()
  expect(await resolveEntry(entry, { client, fetch: answer(404, {}) })).toBeNull()
  const row = await client.cardPoolEntry.findUniqueOrThrow({ where: { id: entry.id } })
  expect(row.unplayable).toBe(true)
  expect(row.deezerTrackId).toBeNull()
  expect(row.resolvedAt).toBeNull()
})

test("réponse error de Deezer (200 + error) : injouable", async () => {
  const entry = await makeEntry()
  const fetchError = answer(200, { error: { type: "DataException", message: "no data", code: 800 } })
  expect(await resolveEntry(entry, { client, fetch: fetchError })).toBeNull()
  expect((await client.cardPoolEntry.findUniqueOrThrow({ where: { id: entry.id } })).unplayable).toBe(true)
})

test("non readable : injouable", async () => {
  const entry = await makeEntry()
  expect(await resolveEntry(entry, { client, fetch: answer(200, { ...good, readable: false }) })).toBeNull()
  const row = await client.cardPoolEntry.findUniqueOrThrow({ where: { id: entry.id } })
  expect(row.unplayable).toBe(true)
  expect(row.deezerTrackId).toBeNull()
})

test("sans preview : injouable", async () => {
  const entry = await makeEntry()
  expect(await resolveEntry(entry, { client, fetch: answer(200, { ...good, preview: "" }) })).toBeNull()
  expect((await client.cardPoolEntry.findUniqueOrThrow({ where: { id: entry.id } })).unplayable).toBe(true)
})

test("P2002 : l'id Deezer appartient déjà à une autre entrée → injouable, null", async () => {
  await makeEntry({ deezerTrackId: 4242, resolvedAt: new Date() })
  const entry = await makeEntry()
  expect(await resolveEntry(entry, { client, fetch: answer(200, { ...good, id: 4242 }) })).toBeNull()
  const row = await client.cardPoolEntry.findUniqueOrThrow({ where: { id: entry.id } })
  expect(row.unplayable).toBe(true)
  expect(row.deezerTrackId).toBeNull()
  expect(row.resolvedAt).toBeNull()
})

test("erreur réseau : null, l'entrée n'est PAS marquée injouable", async () => {
  const entry = await makeEntry()
  expect(await resolveEntry(entry, { client, fetch: refuse })).toBeNull()
  // Un essai de plus après une courte pause, puis on abandonne
  expect(calls).toHaveLength(2)
  const row = await client.cardPoolEntry.findUniqueOrThrow({ where: { id: entry.id } })
  expect(row.unplayable).toBe(false)
  expect(row.resolvedAt).toBeNull()
})

test("timeout : l'annulation de la requête compte comme une erreur réseau", async () => {
  const entry = await makeEntry()
  const aborted = (async () => {
    throw new DOMException("The operation timed out.", "TimeoutError")
  }) as unknown as typeof fetch
  expect(await resolveEntry(entry, { client, fetch: aborted })).toBeNull()
  expect((await client.cardPoolEntry.findUniqueOrThrow({ where: { id: entry.id } })).unplayable).toBe(false)
})

test("erreur serveur ou quota Deezer : null sans marquer injouable", async () => {
  const entry = await makeEntry()
  expect(await resolveEntry(entry, { client, fetch: answer(503, {}) })).toBeNull()
  expect(await resolveEntry(entry, { client, fetch: answer(200, { error: { code: 4, message: "Quota limit exceeded" } }) })).toBeNull()
  expect((await client.cardPoolEntry.findUniqueOrThrow({ where: { id: entry.id } })).unplayable).toBe(false)
})

test("entrée déjà injouable : pas d'appel", async () => {
  const entry = await makeEntry({ unplayable: true })
  expect(await resolveEntry(entry, { client, fetch: answer(200, good) })).toBeNull()
  expect(calls).toHaveLength(0)
})
