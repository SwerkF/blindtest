/**
 * Dev only: fills the catalogue with fake vinyls and optionally gives packs.
 *   bun run catalog:dev [-- --grant <userId> --packs 3 --rarity ultime]
 * Covers are not real (no md5), so the UI shows its generated fallback.
 */
import { PACK_RARITIES, isPackRarity, rarityFromPercentile } from "@blindmusic/shared"
import { prisma } from "@/db"
import { parseArgs } from "./args"
import { importEntries } from "./importer"
import type { CatalogEntry } from "./score"

const { values } = parseArgs(process.argv.slice(2), ["grant", "packs", "rarity", "count"])
const count = Number(values.get("count")) || 300

const ARTISTS = ["Aya Nova", "Les Marées", "DJ Cobalt", "Nelly Rose", "Kid Solaire", "Orchestre Lune", "Mahé", "Tom & Jade"]
const entries: CatalogEntry[] = Array.from({ length: count }, (_, i) => ({
  isrc: `DEVFX${String(i).padStart(7, "0")}`,
  recordingMbid: null,
  deezerTrackId: 900_000_000 + i,
  title: `Titre de test ${i + 1}`,
  artistName: ARTISTS[i % ARTISTS.length]!,
  deezerMd5Image: null,
  rarity: rarityFromPercentile(((i + 0.5) / count) * 100),
  popularityScore: Math.round(((i + 0.5) / count) * 10000) / 100,
  pools: [i % 2 === 0 ? "genre:pop" : "genre:rap", "decade:2010s"],
}))

console.log("[catalog:dev]", await importEntries(prisma, entries, { force: true }))

const userId = values.get("grant")
if (userId) {
  const rarity = values.get("rarity") ?? PACK_RARITIES[0]
  if (!isPackRarity(rarity)) throw new Error(`Rareté de pack inconnue : ${rarity}`)
  const packs = Number(values.get("packs")) || 1
  await prisma.userPack.createMany({ data: Array.from({ length: packs }, () => ({ userId, rarity })) })
  console.log(`[catalog:dev] ${packs} pack(s) ${rarity} donnés à ${userId}`)
}
await prisma.$disconnect()
