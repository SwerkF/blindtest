import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"
import { CardRarity, MAX_PACKS_PER_DAY, PITY_THRESHOLD, PACK_SIZE, PackRarity } from "@blindmusic/shared"
import { BoosterError, openPack, openPackTx } from "@/booster/open"
import { grantDrop } from "@/booster/drop"
import { createTestDb } from "@/booster/testDb"

const db = createTestDb()
const { client } = db

beforeAll(async () => {
  await client.$connect()
})
afterAll(() => db.close())

let seq = 0
let catalogRun = 0
async function makeUser(packsSincePity = 0) {
  seq++
  return client.user.create({
    data: { discordId: `d${seq}-${Date.now()}`, username: `user${seq}`, friendCode: `FC${seq}${Date.now()}`, packsSincePity },
  })
}

async function seedCatalog(perRarity = 12) {
  await client.userCard.deleteMany()
  await client.cardPoolEntry.deleteMany()
  const rarities: CardRarity[] = [CardRarity.Commun, CardRarity.Rare, CardRarity.Epique, CardRarity.Legendaire]
  let n = 0
  catalogRun++
  for (const rarity of rarities) {
    for (let i = 0; i < perRarity; i++) {
      n++
      await client.cardPoolEntry.create({
        data: {
          isrc: `ISRC${catalogRun}-${n}`,
          deezerTrackId: catalogRun * 10_000 + n,
          title: `Titre ${n}`,
          artistName: `Artiste ${n}`,
          deezerMd5Image: `md5${n}`,
          rarity,
          popularityScore: n,
        },
      })
    }
  }
}

async function givePacks(userId: string, rarity: PackRarity, count: number) {
  for (let i = 0; i < count; i++) await client.userPack.create({ data: { userId, rarity } })
}

beforeEach(() => seedCatalog())

/** Scripted randomness: always the first value of the range. */
const first = () => 0

test("ouvrir un pack : consomme le pack, crée 5 vinyles distincts", async () => {
  const user = await makeUser()
  await givePacks(user.id, PackRarity.Normal, 2)
  const result = await openPack(user.id, PackRarity.Normal, undefined, client)
  expect(result.cards).toHaveLength(PACK_SIZE)
  expect(new Set(result.cards.map((c) => c.card.entryId)).size).toBe(PACK_SIZE)
  expect(result.cards.every((c) => c.isNew)).toBe(true)
  expect(result.remaining).toBe(1)
  expect(await client.userPack.count({ where: { userId: user.id, openedAt: null } })).toBe(1)
  expect(await client.userCard.count({ where: { userId: user.id } })).toBe(PACK_SIZE)
})

test("sans pack : 409 et rien d'inséré", async () => {
  const user = await makeUser()
  const error = await openPack(user.id, PackRarity.Ultime, undefined, client).catch((e) => e)
  expect(error).toBeInstanceOf(BoosterError)
  expect(error.status).toBe(409)
  expect(await client.userCard.count({ where: { userId: user.id } })).toBe(0)
})

test("doublons : le compteur monte, la rareté reste celle du premier tirage", async () => {
  const user = await makeUser()
  await givePacks(user.id, PackRarity.Rare, 2)
  // RNG figé : les deux packs contiennent exactement les mêmes vinyles
  const one = await openPack(user.id, PackRarity.Rare, first, client)
  const target = one.cards[0]!.card
  expect(target.rarity).toBe(CardRarity.Commun)
  const two = await openPack(user.id, PackRarity.Rare, first, client)
  expect(two.cards.every((c) => !c.isNew && c.card.count === 2)).toBe(true)
  expect(await client.userCard.count({ where: { userId: user.id } })).toBe(PACK_SIZE)

  // Le run suivant du catalogue change la rareté du titre : la collection ne bouge pas
  await client.cardPoolEntry.update({ where: { id: target.entryId }, data: { rarity: CardRarity.Legendaire } })
  const row = await client.userCard.findUnique({ where: { userId_entryId: { userId: user.id, entryId: target.entryId } } })
  expect(row?.rarityAtObtain).toBe(CardRarity.Commun)
  expect(row?.count).toBe(2)
})

test("pity : le Nᵉ pack sans légendaire en contient un, puis le compteur repart de zéro", async () => {
  const user = await makeUser(PITY_THRESHOLD - 1)
  await givePacks(user.id, PackRarity.Normal, 2)
  // RNG figé sur 0 : toutes les cartes tirées sont communes sans la garantie
  const result = await openPack(user.id, PackRarity.Normal, first, client)
  expect(result.pityTriggered).toBe(true)
  expect(result.cards.some((c) => c.card.rarity === CardRarity.Legendaire)).toBe(true)
  expect(result.packsSincePity).toBe(0)
  expect((await client.user.findUnique({ where: { id: user.id } }))?.packsSincePity).toBe(0)

  // Sans légendaire, le compteur monte d'un cran
  const next = await openPack(user.id, PackRarity.Normal, first, client)
  expect(next.pityTriggered).toBe(false)
  expect(next.cards.some((c) => c.card.rarity === CardRarity.Legendaire)).toBe(false)
  expect(next.packsSincePity).toBe(1)
})

test("catalogue vide : 503 et le pack n'est pas consommé (rollback)", async () => {
  const user = await makeUser()
  await givePacks(user.id, PackRarity.Normal, 1)
  await client.userCard.deleteMany()
  await client.cardPoolEntry.deleteMany()
  const error = await openPack(user.id, PackRarity.Normal, undefined, client).catch((e) => e)
  expect(error).toBeInstanceOf(BoosterError)
  expect(error.status).toBe(503)
  expect(await client.userPack.count({ where: { userId: user.id, openedAt: null } })).toBe(1)
  expect((await client.user.findUnique({ where: { id: user.id } }))?.packsSincePity).toBe(0)
})

test("échec au milieu de l'insertion : rien n'est gardé, le pack reste ouvrable", async () => {
  const user = await makeUser()
  await givePacks(user.id, PackRarity.Normal, 1)
  let calls = 0
  const flaky = (max: number) => {
    // Plante pendant le tirage des vinyles, après la consommation du pack
    if (++calls > PACK_SIZE + 2) throw new Error("boom")
    return 0 % max
  }
  await expect(openPack(user.id, PackRarity.Normal, flaky, client)).rejects.toThrow("boom")
  expect(await client.userPack.count({ where: { userId: user.id, openedAt: null } })).toBe(1)
  expect(await client.userCard.count({ where: { userId: user.id } })).toBe(0)
})

test("transaction appelée en parallèle SANS le verrou mémoire : un seul gagnant", async () => {
  const user = await makeUser()
  await givePacks(user.id, PackRarity.Normal, 1)
  const attempts = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      client.$transaction((tx) => openPackTx(tx, user.id, PackRarity.Normal), { maxWait: 15000, timeout: 20000 })
    )
  )
  const wins = attempts.filter((a) => a.status === "fulfilled")
  expect(wins).toHaveLength(1)
  expect(await client.userPack.count({ where: { userId: user.id, openedAt: null } })).toBe(0)
  expect(await client.userPack.count({ where: { userId: user.id, openedAt: { not: null } } })).toBe(1)
  const cards = await client.userCard.findMany({ where: { userId: user.id } })
  expect(cards).toHaveLength(PACK_SIZE)
  expect(cards.reduce((sum, c) => sum + c.count, 0)).toBe(PACK_SIZE)
  expect((await client.user.findUnique({ where: { id: user.id } }))?.packsSincePity).toBe(1)
})

test("transaction en parallèle avec N packs : exactement N ouvertures, jamais de double comptage", async () => {
  const user = await makeUser()
  await givePacks(user.id, PackRarity.Rare, 3)
  const attempts = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      client.$transaction((tx) => openPackTx(tx, user.id, PackRarity.Rare), { maxWait: 15000, timeout: 20000 })
    )
  )
  const wins = attempts.filter((a) => a.status === "fulfilled").length
  expect(wins).toBe(3)
  expect(await client.userPack.count({ where: { userId: user.id, openedAt: null } })).toBe(0)
  const copies = await client.userCard.aggregate({ where: { userId: user.id }, _sum: { count: true } })
  expect(copies._sum.count).toBe(3 * PACK_SIZE)
})

test("spam via openPack (avec verrou) : un seul pack consommé", async () => {
  const user = await makeUser()
  await givePacks(user.id, PackRarity.Normal, 5)
  const attempts = await Promise.allSettled(
    Array.from({ length: 10 }, () => openPack(user.id, PackRarity.Normal, undefined, client))
  )
  const wins = attempts.filter((a) => a.status === "fulfilled").length
  expect(wins).toBeGreaterThanOrEqual(1)
  const opened = await client.userPack.count({ where: { userId: user.id, openedAt: { not: null } } })
  expect(opened).toBe(wins)
  const copies = await client.userCard.aggregate({ where: { userId: user.id }, _sum: { count: true } })
  expect(copies._sum.count).toBe(wins * PACK_SIZE)
})

test("grantDrop : un pack par partie, rejouer la même partie ne double pas", async () => {
  const user = await makeUser()
  const ctx = { playerCount: 4, roundCount: 20, roundDurationSec: 30, score: 100, titleFound: 15, rank: 1 }
  const game = await client.gameResult.create({
    data: { userId: user.id, roomCode: "ABCD", mode: "classic", score: 100, rank: 1, playerCount: 4, roundCount: 20, won: true },
  })
  const never = (max: number) => max - 1
  expect(await grantDrop(user.id, game.id, ctx, never, client)).toBeNull()
  const rarity = await grantDrop(user.id, game.id, ctx, () => 0, client)
  expect(rarity).not.toBeNull()
  // Même partie : la contrainte d'unicité empêche le doublon, sans exception
  expect(await grantDrop(user.id, game.id, ctx, () => 0, client)).toBeNull()
  expect(await client.userPack.count({ where: { userId: user.id } })).toBe(1)
})

test("grantDrop : le plafond journalier bloque les packs en trop", async () => {
  const user = await makeUser()
  await givePacks(user.id, PackRarity.Normal, MAX_PACKS_PER_DAY)
  const game = await client.gameResult.create({
    data: { userId: user.id, roomCode: "EFGH", mode: "classic", score: 100, rank: 1, playerCount: 4, roundCount: 20, won: true },
  })
  const ctx = { playerCount: 4, roundCount: 20, roundDurationSec: 30, score: 100, titleFound: 15, rank: 1 }
  expect(await grantDrop(user.id, game.id, ctx, () => 0, client)).toBeNull()
})

test("ids Deezer au-delà de 2^31 : le DTO reste un number et se sérialise en JSON", async () => {
  const BIG = 3_000_000_000
  const user = await makeUser()
  await givePacks(user.id, PackRarity.Normal, 1)
  await client.userCard.deleteMany()
  await client.cardPoolEntry.deleteMany()
  for (let i = 0; i < PACK_SIZE; i++) {
    await client.cardPoolEntry.create({
      data: { isrc: `BIG${i}`, deezerTrackId: BIG + i, title: `T${i}`, artistName: "A", rarity: CardRarity.Commun, popularityScore: i },
    })
  }
  const opened = await openPack(user.id, PackRarity.Normal, first, client)
  // JSON.stringify plante sur un bigint : le DTO doit déjà contenir des number
  const json = JSON.parse(JSON.stringify(opened)) as typeof opened
  expect(json.cards).toHaveLength(PACK_SIZE)
  for (const { card } of json.cards) {
    expect(typeof card.deezerTrackId).toBe("number")
    expect(card.deezerTrackId).toBeGreaterThanOrEqual(BIG)
  }
})
