import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CardRarity } from "@blindmusic/shared"
import { createTestDb } from "../../src/booster/testDb"
import { parseCsvLine, readCsv } from "./csv"
import { dedupeByDeezerTrack, dedupeByIsrc, dedupeBySong } from "./dedupe"
import { decadeOf, isExcluded, macroGenre, songKey } from "./filters"
import { IMPORT_BATCH, importEntries } from "./importer"
import { parsePopularity } from "./listenbrainz"
import { buildEntries, percentiles, primaryPool, type Candidate, type CatalogEntry } from "./score"
import { isPlayable, toCandidate } from "./deezer"

test("CSV : guillemets, virgules et guillemets doublés", () => {
  expect(parseCsvLine('a,"b,c","d ""x"""')).toEqual(["a", "b,c", 'd "x"'])
  expect(parseCsvLine("a,,c")).toEqual(["a", "", "c"])
})

test("CSV : lecture en flux avec en-tête et BOM", async () => {
  const dir = mkdtempSync(join(tmpdir(), "csv-"))
  const file = join(dir, "mb.csv")
  writeFileSync(file, '﻿recording_mbid,isrc,title,artist,length,tags\nm1,FR123,"Titre, long",Artiste,200000,rap:5|pop:1\n\n')
  const rows: Record<string, string>[] = []
  for await (const row of readCsv(file)) rows.push(row)
  rmSync(dir, { recursive: true, force: true })
  expect(rows).toEqual([
    { recording_mbid: "m1", isrc: "FR123", title: "Titre, long", artist: "Artiste", length: "200000", tags: "rap:5|pop:1" },
  ])
})

test("filtres : remix, live, instrumental, karaoke, tribute, cover exclus ; vrais titres gardés", () => {
  for (const title of ["Song (Remix)", "Song - Live at Wembley", "Song [Instrumental]", "Song (Cover)", "Karaoke Hit", "Song - Radio Remix"]) {
    expect(isExcluded(title, "Artiste")).toBe(true)
  }
  expect(isExcluded("Hit", "Karaoke Kings")).toBe(true)
  expect(isExcluded("Hit", "Tribute Band")).toBe(true)
  // Le mot « live » dans le vrai titre ne suffit pas
  expect(isExcluded("Live and Let Die", "Paul McCartney")).toBe(false)
  expect(isExcluded("Alive", "Daft Punk")).toBe(false)
  expect(isExcluded("Bohemian Rhapsody", "Queen")).toBe(false)
})

test("clé de chanson : accents, parenthèses et suffixes ignorés", () => {
  expect(songKey("Été (Radio Edit)", "Michel  Fugain")).toBe(songKey("ete", "michel fugain"))
  expect(songKey("Song - Remastered 2011", "Queen")).toBe(songKey("Song", "Queen"))
})

test("genre macro : tag le plus voté, rap avant pop, null sinon", () => {
  expect(macroGenre("pop:2|hip hop:9")).toBe("rap")
  expect(macroGenre("chanson française")).toBe("chanson")
  expect(macroGenre("indie rock;pop")).toBe("rock")
  expect(macroGenre("seen live|favorites")).toBeNull()
  expect(decadeOf("1999-05-01")).toBe("1990s")
  expect(decadeOf("0000-00-00")).toBeNull()
})

test("percentiles : rangs moyens, égalités au milieu", () => {
  expect(percentiles([10, 20, 30, 40])).toEqual([12.5, 37.5, 62.5, 87.5])
  expect(percentiles([5, 5])).toEqual([50, 50])
  expect(percentiles([])).toEqual([])
})

function candidate(i: number, over: Partial<Candidate> = {}): Candidate {
  return {
    isrc: `ISRC${i}`,
    recordingMbid: null,
    deezerTrackId: i,
    title: `T${i}`,
    artistName: "A",
    deezerMd5Image: "md5",
    deezerRank: i,
    listens: null,
    genre: "rap",
    decade: "2010s",
    ...over,
  }
}

test("rareté : ≈2 % légendaire, 8 % épique, 25 % rare, 65 % commun dans un pool", () => {
  const entries = buildEntries(Array.from({ length: 1000 }, (_, i) => candidate(i + 1)), 200)
  const counts = { commun: 0, rare: 0, epique: 0, legendaire: 0 } as Record<string, number>
  for (const e of entries) counts[e.rarity]!++
  expect(counts.legendaire).toBe(20)
  expect(counts.epique).toBe(80)
  expect(counts.rare).toBe(250)
  expect(counts.commun).toBe(650)
  // Le plus écouté est légendaire, le moins écouté est commun
  expect(entries.find((e) => e.deezerTrackId === 1000)?.rarity).toBe(CardRarity.Legendaire)
  expect(entries.find((e) => e.deezerTrackId === 1)?.rarity).toBe(CardRarity.Commun)
})

test("un signal manquant (pas d'écoutes ListenBrainz) ne pénalise pas le titre", () => {
  const entries = buildEntries(
    Array.from({ length: 400 }, (_, i) =>
      candidate(i + 1, { listens: i % 2 === 0 ? (i + 1) * 100 : null })
    ),
    200
  )
  // Le meilleur rang Deezer sans écoutes reste dans les épiques+
  const best = entries.find((e) => e.deezerTrackId === 399)!
  expect([CardRarity.Epique, CardRarity.Legendaire]).toContain(best.rarity)
})

test("pool trop petit : repli genre → décennie → global", () => {
  const sizes = new Map([
    ["genre:rap", 50],
    ["decade:2010s", 300],
  ])
  expect(primaryPool(candidate(1), sizes, 200)).toBe("decade:2010s")
  expect(primaryPool(candidate(1, { decade: "1980s" }), sizes, 200)).toBe("global")
  sizes.set("genre:rap", 500)
  expect(primaryPool(candidate(1), sizes, 200)).toBe("genre:rap")
})

test("les percentiles sont calculés par pool, pas globalement", () => {
  const rap = Array.from({ length: 300 }, (_, i) => candidate(i + 1, { genre: "rap", deezerRank: 1_000_000 + i }))
  const jazz = Array.from({ length: 300 }, (_, i) => candidate(1000 + i, { genre: "jazz", decade: "1960s", deezerRank: 10 + i }))
  const entries = buildEntries([...rap, ...jazz], 200)
  const legendary = (genre: string) => entries.filter((e) => e.pools.includes(`genre:${genre}`) && e.rarity === CardRarity.Legendaire).length
  // Le jazz peu écouté a ses propres légendaires malgré des rangs Deezer bien plus faibles
  expect(legendary("rap")).toBe(6)
  expect(legendary("jazz")).toBe(6)
})

test("dédoublonnage par deezerTrackId : meilleur score gardé, collisions loguées", () => {
  const base = (isrc: string, score: number): CatalogEntry => ({
    isrc, recordingMbid: null, deezerTrackId: 42, title: "t", artistName: "a", deezerMd5Image: null,
    rarity: CardRarity.Commun, popularityScore: score, pools: [],
  })
  const logs: string[] = []
  const { entries, collisions } = dedupeByDeezerTrack([base("A", 10), base("B", 70), base("C", 30)], (m) => logs.push(m))
  expect(entries).toHaveLength(1)
  expect(entries[0]!.isrc).toBe("B")
  expect(collisions).toHaveLength(2)
  expect(logs).toHaveLength(2)
  expect(logs[0]).toContain("collision deezerTrackId=42 gardé isrc=B écarté isrc=A")
})

test("dédoublonnage titre/artiste : l'enregistrement le plus écouté gagne", () => {
  const rows = [
    { title: "Hit (Remastered)", artist: "Queen", listens: 5 },
    { title: "Hit", artist: "Queen", listens: 50 },
    { title: "Other", artist: "Queen", listens: 1 },
  ]
  const kept = dedupeBySong(rows)
  expect(kept.map((r) => r.listens).sort((a, b) => a - b)).toEqual([1, 50])
  const merged = dedupeByIsrc([candidate(1, { isrc: "X", listens: null, deezerRank: null }), candidate(2, { isrc: "X", listens: 4 })])
  expect(merged).toHaveLength(1)
  expect(merged[0]!.listens).toBe(4)
})

test("ListenBrainz : réponse en liste ou enveloppée, lignes invalides ignorées", () => {
  const rows = [{ recording_mbid: "a", total_listen_count: 12, total_user_count: 3 }, { nope: true }]
  expect(parsePopularity(rows).get("a")).toEqual({ listens: 12, users: 3 })
  expect(parsePopularity({ payload: rows }).size).toBe(1)
  expect(parsePopularity("x").size).toBe(0)
})

test("Deezer : seuls les titres lisibles avec preview comptent, md5 de cover seul gardé", () => {
  expect(isPlayable({ id: 1, readable: true, preview: "https://p", title: "t", artist: { name: "a" } })).toBe(true)
  expect(isPlayable({ id: 1, readable: false, preview: "https://p", title: "t", artist: { name: "a" } })).toBe(false)
  expect(isPlayable({ id: 1, readable: true, preview: "", title: "t", artist: { name: "a" } })).toBe(false)
  const c = toCandidate(
    { id: 7, title: "Full (Remix)", title_short: "Full", rank: 812345, md5_image: "abc", release_date: "2014-03-02", artist: { name: "X" } },
    { isrc: "FR1" }
  )
  expect(c).toMatchObject({ title: "Full", deezerRank: 812345, deezerMd5Image: "abc", decade: "2010s", genre: null })
  expect(JSON.stringify(c)).not.toContain("http")
})

const db = createTestDb()
afterAll(() => db.close())

function entry(i: number, over: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    isrc: `IMP${i}`, recordingMbid: null, deezerTrackId: 5000 + i, title: `T${i}`, artistName: "A",
    deezerMd5Image: "md5", rarity: CardRarity.Commun, popularityScore: i, pools: ["genre:rap"], ...over,
  }
}

test("import : crée, met à jour la rareté, désactive les absents sans rien supprimer", async () => {
  const quiet = () => {}
  expect(IMPORT_BATCH).toBe(500)
  const first = await importEntries(db.client, [entry(1), entry(2), entry(3), entry(4)], { log: quiet })
  expect(first).toEqual({ created: 4, updated: 0, disabled: 0, skipped: 0 })

  // Deuxième run : 1 absent, 1 rareté changée, 1 titre dont l'ISRC a changé (même piste Deezer), 1 nouveau
  await db.client.cardPoolEntry.updateMany({ where: { isrc: "IMP2" }, data: { needsRefresh: true } })
  const second = await importEntries(
    db.client,
    [entry(1, { rarity: CardRarity.Legendaire }), entry(2), entry(3, { isrc: "IMP3-NEW" }), entry(9)],
    { log: quiet }
  )
  expect(second).toEqual({ created: 1, updated: 3, disabled: 1, skipped: 0 })
  const rows = await db.client.cardPoolEntry.findMany()
  expect(rows).toHaveLength(5)
  expect(rows.find((r) => r.isrc === "IMP1")?.rarity).toBe(CardRarity.Legendaire)
  expect(rows.find((r) => r.isrc === "IMP2")?.needsRefresh).toBe(false)
  expect(Number(rows.find((r) => r.isrc === "IMP3-NEW")?.deezerTrackId)).toBe(5003)
  expect(rows.find((r) => r.isrc === "IMP4")?.available).toBe(false)
  expect(JSON.parse(rows[0]!.pools)).toEqual(["genre:rap"])
})

test("import : garde-fou contre un run qui vide le catalogue", async () => {
  const quiet = () => {}
  await expect(importEntries(db.client, [], { log: quiet })).rejects.toThrow("vide")
  await expect(importEntries(db.client, [entry(1)], { log: quiet })).rejects.toThrow("--force")
  expect((await importEntries(db.client, [entry(1)], { force: true, log: quiet })).disabled).toBe(3)
})

test("ids Deezer au-delà de 2^31 : importés, relus et sérialisables en JSON", async () => {
  const quiet = () => {}
  const BIG = 3_000_000_000
  await importEntries(db.client, [entry(1), entry(2, { deezerTrackId: BIG })], { force: true, log: quiet })
  const row = await db.client.cardPoolEntry.findUnique({ where: { deezerTrackId: BIG } })
  expect(row?.deezerTrackId).toBe(BigInt(BIG))
  // Réimport : l'entrée est retrouvée par sa piste (clé Number) et mise à jour, pas dupliquée
  const again = await importEntries(db.client, [entry(1), entry(2, { deezerTrackId: BIG, rarity: CardRarity.Epique })], {
    force: true,
    log: quiet,
  })
  expect(again).toMatchObject({ created: 0, updated: 2, skipped: 0 })
  expect(await db.client.cardPoolEntry.count({ where: { deezerTrackId: BIG } })).toBe(1)
})
