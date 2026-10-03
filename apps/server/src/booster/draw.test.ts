import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"
import { CardRarity } from "@blindmusic/shared"
import { createTestDb } from "@/booster/testDb"
import { RowidRanges, drawEntry } from "@/booster/draw"

const db = createTestDb()
const { client } = db

beforeAll(() => client.$connect())
afterAll(() => db.close())

const RARITIES = [CardRarity.Commun, CardRarity.Rare, CardRarity.Epique]
let run = 0

/** Rarities interleaved one after the other, so each rarity has one entry every third rowid. */
async function seed(count: number, over: (i: number) => Record<string, unknown> = () => ({})) {
  await client.cardPoolEntry.deleteMany()
  run++
  await client.cardPoolEntry.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      isrc: `DRW${run}-${i}`,
      title: `T${i}`,
      artistName: "A",
      rarity: RARITIES[i % RARITIES.length]!,
      popularityScore: i,
      ...over(i),
    })),
  })
}

/** Seeded generator: deterministic, so the distribution test cannot flake. */
function mulberry32(seed: number) {
  let a = seed
  return (max: number) => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max)
  }
}

let ranges: RowidRanges
beforeEach(() => {
  ranges = new RowidRanges()
})

test("tirage par rowid : approximativement uniforme sur une rareté (RNG injecté)", async () => {
  await seed(900) // 300 communs
  const random = mulberry32(42)
  const hits = new Map<string, number>()
  const DRAWS = 6000
  for (let i = 0; i < DRAWS; i++) {
    const entry = await drawEntry(client, CardRarity.Commun, [], random, ranges)
    expect(entry?.rarity).toBe(CardRarity.Commun)
    hits.set(entry!.id, (hits.get(entry!.id) ?? 0) + 1)
  }
  // 300 entrées, 20 tirages attendus chacune : toutes sortent, aucune n'écrase les autres
  expect(hits.size).toBe(300)
  expect(Math.min(...hits.values())).toBeGreaterThanOrEqual(3)
  expect(Math.max(...hits.values())).toBeLessThanOrEqual(50)
})

test("balayage exact de la plage : chaque entrée sort autant de fois (la première, au bord, un peu moins)", async () => {
  await seed(60) // 20 communs, un tous les 3 rowids
  const range = (await client.$queryRaw<{ min: bigint; max: bigint }[]>`
    SELECT MIN(rowid) AS min, MAX(rowid) AS max FROM CardPoolEntry WHERE rarity = 'commun'`)[0]!
  const span = Number(range.max) - Number(range.min) + 1
  let next = 0
  const sweep = () => next++ % span
  const hits = new Map<string, number>()
  for (let i = 0; i < span; i++) {
    const entry = await drawEntry(client, CardRarity.Commun, [], sweep, ranges)
    hits.set(entry!.id, (hits.get(entry!.id) ?? 0) + 1)
  }
  expect(hits.size).toBe(20)
  const counts = [...hits.values()].sort((a, b) => a - b)
  // Une entrée sort pour chaque pivot de l'intervalle qui la précède (3 rowids) ; la première n'en a qu'un
  expect(counts[0]).toBe(1)
  expect(new Set(counts.slice(1))).toEqual(new Set([3]))
})

test("le rowid tiré après la dernière entrée de la rareté revient au début (repli rowid <)", async () => {
  await seed(30)
  const entries = await client.cardPoolEntry.findMany({ where: { rarity: CardRarity.Rare }, orderBy: { isrc: "asc" } })
  // Exclure la dernière rare pousse le pivot au-delà de toutes les candidates
  const last = entries[entries.length - 1]!
  const picked = await drawEntry(client, CardRarity.Rare, [last.id], (max) => max - 1, ranges)
  expect(picked).not.toBeNull()
  expect(picked!.rarity).toBe(CardRarity.Rare)
  expect(picked!.id).not.toBe(last.id)
})

test("exclut les entrées déjà prises, les injouables et les indisponibles", async () => {
  await seed(30, (i) => (i === 0 ? { unplayable: true } : i === 3 ? { available: false } : {}))
  const communs = await client.cardPoolEntry.findMany({
    where: { rarity: CardRarity.Commun, unplayable: false, available: true },
  })
  expect(communs).toHaveLength(8)
  const taken: string[] = []
  const random = mulberry32(7)
  for (let i = 0; i < communs.length; i++) {
    const entry = await drawEntry(client, CardRarity.Commun, taken, random, ranges)
    expect(entry).not.toBeNull()
    expect(taken).not.toContain(entry!.id)
    expect(communs.map((c) => c.id)).toContain(entry!.id)
    taken.push(entry!.id)
  }
  // Plus rien à tirer
  expect(await drawEntry(client, CardRarity.Commun, taken, random, ranges)).toBeNull()
})

test("rareté sans entrée : null", async () => {
  await seed(30)
  expect(await drawEntry(client, CardRarity.Legendaire, [], mulberry32(1), ranges)).toBeNull()
})

test("la plage par rareté est mise en cache 10 minutes, la rareté absente est relue après 10 s", async () => {
  await seed(30)
  let clock = 1_000_000
  const cached = new RowidRanges(10 * 60_000, () => clock)
  const first = await cached.get(client, CardRarity.Commun)
  expect(first).not.toBeNull()

  // Des entrées arrivent : le cache ne bouge pas avant l'expiration
  await client.cardPoolEntry.createMany({
    data: Array.from({ length: 5 }, (_, i) => ({
      isrc: `LATE${run}-${i}`, title: "T", artistName: "A", rarity: CardRarity.Commun, popularityScore: 1,
    })),
  })
  clock += 60_000
  expect((await cached.get(client, CardRarity.Commun))!.max).toBe(first!.max)
  clock += 10 * 60_000
  expect((await cached.get(client, CardRarity.Commun))!.max).toBe(30 + 5)

  // Catalogue importé après un premier tirage à vide : la rareté manquante est relue sans attendre 10 minutes
  expect(await cached.get(client, CardRarity.Legendaire)).toBeNull()
  await client.cardPoolEntry.create({
    data: { isrc: `LEG${run}`, title: "T", artistName: "A", rarity: CardRarity.Legendaire, popularityScore: 1 },
  })
  expect(await cached.get(client, CardRarity.Legendaire)).toBeNull()
  clock += 11_000
  expect(await cached.get(client, CardRarity.Legendaire)).not.toBeNull()
})

test("la requête de tirage passe par l'index (available, unplayable, rarity) sans parcourir la table", async () => {
  await seed(30)
  const plan = await client.$queryRawUnsafe<{ detail: string }[]>(
    `EXPLAIN QUERY PLAN SELECT id FROM CardPoolEntry
     WHERE rarity = 'commun' AND available = 1 AND unplayable = 0 AND rowid >= 5 ORDER BY rowid LIMIT 1`
  )
  const detail = plan.map((p) => p.detail).join(" | ")
  expect(detail).toContain("CardPoolEntry_available_unplayable_rarity_idx")
  expect(detail).not.toContain("USE TEMP B-TREE")
})
