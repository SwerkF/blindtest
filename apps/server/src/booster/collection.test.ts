import { afterAll, beforeEach, expect, test } from "bun:test"
import { CardRarity } from "@blindmusic/shared"
import { TOTALS_TTL_MS, catalogTotals, clearCatalogTotals } from "@/booster/collection"
import { createTestDb } from "@/booster/testDb"

const db = createTestDb()
const { client } = db
afterAll(() => db.close())

beforeEach(async () => {
  clearCatalogTotals()
  await client.cardPoolEntry.deleteMany()
})

let seq = 0
const add = (rarity: CardRarity, over: Record<string, unknown> = {}) =>
  client.cardPoolEntry.create({
    data: { isrc: `COL${++seq}`, title: "T", artistName: "A", rarity, popularityScore: 1, ...over },
  })

test("totaux du catalogue : entrées jouables et disponibles par rareté, gardés 10 minutes", async () => {
  await add(CardRarity.Commun)
  await add(CardRarity.Commun)
  await add(CardRarity.Rare)
  await add(CardRarity.Rare, { unplayable: true })
  await add(CardRarity.Epique, { available: false })
  const t0 = 1_000_000
  const first = await catalogTotals(client, t0)
  expect(Object.fromEntries(first)).toEqual({ commun: 2, rare: 1 })

  // Import entre-temps : le cache répond encore
  await add(CardRarity.Commun)
  expect(await catalogTotals(client, t0 + TOTALS_TTL_MS - 1)).toBe(first)
  // Expiré : relu
  expect((await catalogTotals(client, t0 + TOTALS_TTL_MS)).get(CardRarity.Commun)).toBe(3)
})

test("un catalogue vide n'est pas mis en cache", async () => {
  expect((await catalogTotals(client, 1)).size).toBe(0)
  await add(CardRarity.Commun)
  expect((await catalogTotals(client, 2)).get(CardRarity.Commun)).toBe(1)
})
