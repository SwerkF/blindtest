import { afterAll, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CardRarity } from "@blindmusic/shared"
import { createTestDb } from "../../src/booster/testDb"
import { backfillResolvedAt, importAll, toRow } from "./import-all"

const db = createTestDb()
const dir = mkdtempSync(join(tmpdir(), "import-all-"))
afterAll(async () => {
  await db.close()
  rmSync(dir, { recursive: true, force: true })
})

const quiet = () => {}
const HEADER = "recording_mbid,isrc,title,artist,length,popularity,rarity"

function csv(name: string, lines: string[]): string {
  const path = join(dir, name)
  writeFileSync(path, [HEADER, ...lines].join("\n") + "\n")
  return path
}

const FIXTURE = [
  "m1,FRZ031000001,Alors on danse,Stromae,206000,98.5,legendaire",
  'm2,FRZ031000002,"Comme un boomerang, version longue","Serge Gainsbourg, Dani",180000,64.2,epique',
  'm3,FRZ031000003,"Le ""Grand"" Bleu",Éric Serra,250000,12.1,rare',
  "m4,FRZ031000004,Dernière danse,Indila,213000,3.3,commun",
  // filtrés par filters.ts
  "m5,FRZ031000005,Alors on danse (Remix),Stromae,200000,90,legendaire",
  "m6,FRZ031000006,Song (Live at Wembley),Queen,200000,80,epique",
  "m7,FRZ031000007,Hit Instrumental Version - Instrumental,Someone,200000,5,commun",
  "m8,FRZ031000008,Alors on danse,Karaoke Stars,200000,5,commun",
  "m9,FRZ031000009,A Tribute to Queen,Tribute Band,200000,5,commun",
  // invalides
  "m10,,Sans ISRC,Artiste,1000,5,commun",
  "m11,FRZ031000011,Rareté inconnue,Artiste,1000,5,mythique",
  "m12,FRZ031000012,Sans score,Artiste,1000,,commun",
  "m13,FRZ031000013,,Sans titre,1000,5,commun",
]

beforeEach(async () => {
  await db.client.cardPoolEntry.deleteMany()
})

const count = () => db.client.cardPoolEntry.count()

test("toRow : normalise l'ISRC, lit la rareté, rejette les lignes inutilisables", () => {
  expect(toRow({ isrc: "fr-z03-10-00001", title: " T ", artist: "A", popularity: "1.5", rarity: "Rare", recording_mbid: "" })).toEqual({
    isrc: "FRZ031000001", recordingMbid: null, title: "T", artistName: "A", popularityScore: 1.5, rarity: CardRarity.Rare,
  })
  expect(toRow({ isrc: "XX", title: "T", artist: "A", popularity: "1", rarity: "rare" })).toBeNull()
  expect(toRow({ isrc: "FRZ031000001", title: "T", artist: "A", popularity: "abc", rarity: "rare" })).toBeNull()
})

test("import : crée les titres (guillemets et virgules compris), filtre remix/live/karaoke/tribute, sans Deezer", async () => {
  const summary = await importAll(db.client, csv("a.csv", FIXTURE), { log: quiet })
  expect(summary).toEqual({ created: 4, updated: 0, skipped: 9 })
  expect(await count()).toBe(4)

  const boomerang = await db.client.cardPoolEntry.findUniqueOrThrow({ where: { isrc: "FRZ031000002" } })
  expect(boomerang.title).toBe("Comme un boomerang, version longue")
  expect(boomerang.artistName).toBe("Serge Gainsbourg, Dani")
  expect(boomerang.rarity).toBe(CardRarity.Epique)
  expect(boomerang.popularityScore).toBe(64.2)
  expect(boomerang.recordingMbid).toBe("m2")
  expect(boomerang.available).toBe(true)
  // Rien de Deezer à l'import
  expect(boomerang.deezerTrackId).toBeNull()
  expect(boomerang.deezerMd5Image).toBeNull()
  expect(boomerang.resolvedAt).toBeNull()
  expect(boomerang.unplayable).toBe(false)
  expect((await db.client.cardPoolEntry.findUniqueOrThrow({ where: { isrc: "FRZ031000003" } })).title).toBe('Le "Grand" Bleu')
  expect(await db.client.cardPoolEntry.count({ where: { isrc: { in: ["FRZ031000005", "FRZ031000006", "FRZ031000007", "FRZ031000008", "FRZ031000009"] } } })).toBe(0)
})

test("import idempotent : deux runs donnent les mêmes lignes, le second met tout à jour", async () => {
  const file = csv("b.csv", FIXTURE)
  await importAll(db.client, file, { log: quiet })
  const before = await db.client.cardPoolEntry.findMany({ orderBy: { isrc: "asc" } })
  const again = await importAll(db.client, file, { log: quiet })
  expect(again).toEqual({ created: 0, updated: 4, skipped: 9 })
  const after = await db.client.cardPoolEntry.findMany({ orderBy: { isrc: "asc" } })
  expect(after.map((e) => e.id)).toEqual(before.map((e) => e.id))
  expect(after.map((e) => [e.isrc, e.title, e.rarity, e.popularityScore])).toEqual(
    before.map((e) => [e.isrc, e.title, e.rarity, e.popularityScore])
  )
})

test("import : une entrée résolue garde ses champs Deezer, le reste est mis à jour", async () => {
  const resolvedAt = new Date("2026-01-02T03:04:05Z")
  await db.client.cardPoolEntry.create({
    data: {
      isrc: "FRZ031000001", title: "Ancien titre", artistName: "Ancien", rarity: CardRarity.Commun, popularityScore: 1,
      available: false, deezerTrackId: 3_000_000_001n, deezerMd5Image: "md5-chart", resolvedAt, unplayable: false,
    },
  })
  await db.client.cardPoolEntry.create({
    data: {
      isrc: "FRZ031000002", title: "Boomerang", artistName: "X", rarity: CardRarity.Commun, popularityScore: 1,
      deezerTrackId: 3_000_000_002n, resolvedAt: new Date(), unplayable: true, recordingMbid: "garde-moi",
    },
  })
  await importAll(db.client, csv("c.csv", ["m1,FRZ031000001,Alors on danse,Stromae,206000,98.5,legendaire", "m2x,FRZ031000002,Boomerang,Gainsbourg,1,40,rare"]), { log: quiet })

  const one = await db.client.cardPoolEntry.findUniqueOrThrow({ where: { isrc: "FRZ031000001" } })
  expect(one).toMatchObject({ title: "Alors on danse", artistName: "Stromae", rarity: CardRarity.Legendaire, popularityScore: 98.5, recordingMbid: "m1", available: true })
  expect(one.deezerTrackId).toBe(3_000_000_001n)
  expect(one.deezerMd5Image).toBe("md5-chart")
  expect(one.resolvedAt).toEqual(resolvedAt)
  expect(one.unplayable).toBe(false)

  // Un titre marqué injouable le reste
  const two = await db.client.cardPoolEntry.findUniqueOrThrow({ where: { isrc: "FRZ031000002" } })
  expect(two.unplayable).toBe(true)
  expect(two.deezerTrackId).toBe(3_000_000_002n)
  expect(two.recordingMbid).toBe("m2x")
})

test("import : un MBID vide dans le fichier n'efface pas celui qu'on connaît", async () => {
  await db.client.cardPoolEntry.create({
    data: { isrc: "FRZ031000001", title: "T", artistName: "A", rarity: CardRarity.Commun, popularityScore: 1, recordingMbid: "connu" },
  })
  await importAll(db.client, csv("d.csv", [",FRZ031000001,T2,A,1,5,rare"]), { log: quiet })
  expect((await db.client.cardPoolEntry.findUniqueOrThrow({ where: { isrc: "FRZ031000001" } })).recordingMbid).toBe("connu")
})

test("import : les entrées absentes du CSV restent disponibles (charts Deezer)", async () => {
  await db.client.cardPoolEntry.create({
    data: { isrc: "USCHART00001", title: "Chart", artistName: "A", rarity: CardRarity.Rare, popularityScore: 1, deezerTrackId: 55n, resolvedAt: new Date() },
  })
  await importAll(db.client, csv("e.csv", FIXTURE), { log: quiet })
  const chart = await db.client.cardPoolEntry.findUniqueOrThrow({ where: { isrc: "USCHART00001" } })
  expect(chart.available).toBe(true)
  expect(await count()).toBe(5)
})

test("import : lots multiples, ISRC répété dans un lot (dernière ligne) ou entre lots (mise à jour), --limit", async () => {
  const lines = [
    "a,FRZ031000001,Un,A,1,1,commun",
    "b,FRZ031000002,Deux,A,1,2,commun",
    "c,FRZ031000003,Trois,A,1,3,commun",
    "d,FRZ031000001,Un bis,A,1,4,rare", // lot précédent déjà écrit : mise à jour
    "e,FRZ031000004,Quatre,A,1,5,commun",
    "f,FRZ031000004,Quatre bis,A,1,6,epique", // même lot que la ligne précédente
  ]
  const summary = await importAll(db.client, csv("f.csv", lines), { log: quiet, batchSize: 2 })
  expect(await count()).toBe(4)
  // 1 doublon de lot ignoré ; le doublon entre lots met à jour la ligne déjà créée
  expect(summary).toEqual({ created: 4, updated: 1, skipped: 1 })
  expect((await db.client.cardPoolEntry.findUniqueOrThrow({ where: { isrc: "FRZ031000001" } })).title).toBe("Un bis")
  expect((await db.client.cardPoolEntry.findUniqueOrThrow({ where: { isrc: "FRZ031000004" } })).title).toBe("Quatre bis")

  await db.client.cardPoolEntry.deleteMany()
  const limited = await importAll(db.client, csv("g.csv", lines), { log: quiet, limit: 2 })
  expect(limited).toEqual({ created: 2, updated: 0, skipped: 0 })
})

test("import : journal toutes les 50 000 lignes et résumé final", async () => {
  const lines = Array.from({ length: 50_001 }, (_, i) => `,FRZ${String(i).padStart(9, "0")},T${i},A,1,${i},commun`)
  const logs: string[] = []
  const summary = await importAll(db.client, csv("h.csv", lines), { log: (m) => logs.push(m) })
  expect(summary.created).toBe(50_001)
  expect(logs.filter((l) => l.includes("50000 lignes lues"))).toHaveLength(1)
  expect(logs.at(-1)).toContain("import-all terminé")
})

test("backfill : resolvedAt = updatedAt pour les entrées déjà résolues, idempotent", async () => {
  await db.client.cardPoolEntry.create({
    data: { isrc: "USCHART00001", title: "Chart", artistName: "A", rarity: CardRarity.Rare, popularityScore: 1, deezerTrackId: 55n },
  })
  await db.client.cardPoolEntry.create({
    data: { isrc: "USCHART00002", title: "Pas résolue", artistName: "A", rarity: CardRarity.Rare, popularityScore: 1 },
  })
  expect(await backfillResolvedAt(db.client)).toBe(1)
  const resolved = await db.client.cardPoolEntry.findUniqueOrThrow({ where: { isrc: "USCHART00001" } })
  expect(resolved.resolvedAt).toEqual(resolved.updatedAt)
  expect((await db.client.cardPoolEntry.findUniqueOrThrow({ where: { isrc: "USCHART00002" } })).resolvedAt).toBeNull()
  // Deuxième passage : plus rien à faire
  expect(await backfillResolvedAt(db.client)).toBe(0)
  expect((await db.client.cardPoolEntry.findUniqueOrThrow({ where: { isrc: "USCHART00001" } })).resolvedAt).toEqual(resolved.resolvedAt)
})
