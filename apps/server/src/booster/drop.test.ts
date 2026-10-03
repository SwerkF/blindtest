import { expect, test } from "bun:test"
import {
  CARD_RARITIES,
  CARD_PERCENTILES,
  CardRarity,
  MAX_PACKS_PER_DAY,
  PACK_CARD_RATES,
  PACK_RARITIES,
  PackRarity,
  coverUrl,
  packDropChance,
  packRarityRates,
  performance,
  playSeconds,
  rarityFromPercentile,
} from "@blindmusic/shared"
import { evaluateDrop, type DropContext } from "@/booster/drop"

const GAME: DropContext = {
  playerCount: 4,
  roundCount: 10,
  roundDurationSec: 30,
  score: 120,
  titleFound: 8,
  rank: 1,
  recentPacks: 0,
}

test("plus on joue longtemps, plus la chance de drop monte", () => {
  const short = packDropChance(playSeconds(5, 10), 4)
  const medium = packDropChance(playSeconds(10, 30), 4)
  const long = packDropChance(playSeconds(20, 30), 4)
  expect(short).toBeGreaterThan(0)
  expect(short).toBeLessThan(0.07)
  expect(medium).toBeGreaterThan(short)
  expect(long).toBeGreaterThan(medium)
  expect(long).toBeLessThan(0.7)
})

test("plancher : des manches ultra-courtes ou trop peu de manches ne rapportent rien", () => {
  expect(playSeconds(10, 5)).toBe(0)
  expect(playSeconds(2, 30)).toBe(0)
  expect(packDropChance(playSeconds(40, 5), 4)).toBe(0)
  expect(evaluateDrop({ ...GAME, roundDurationSec: 5 }, () => 0)).toBeNull()
})

test("jouer seul vaut la moitié", () => {
  const seconds = playSeconds(10, 30)
  expect(packDropChance(seconds, 1)).toBeCloseTo(packDropChance(seconds, 2) / 2, 10)
})

test("evaluateDrop : tirage bas = pack, tirage haut = rien", () => {
  expect(evaluateDrop(GAME, () => 0)).not.toBeNull()
  expect(evaluateDrop(GAME, (max) => max - 1)).toBeNull()
})

test("evaluateDrop : score nul ou plafond journalier = rien", () => {
  expect(evaluateDrop({ ...GAME, score: 0 }, () => 0)).toBeNull()
  expect(evaluateDrop({ ...GAME, recentPacks: MAX_PACKS_PER_DAY }, () => 0)).toBeNull()
  expect(evaluateDrop({ ...GAME, recentPacks: MAX_PACKS_PER_DAY - 1 }, () => 0)).not.toBeNull()
})

test("la performance fait monter la rareté des packs sans les rendre communs", () => {
  const worst = packRarityRates(0)
  const best = packRarityRates(1)
  expect(best[PackRarity.Ultime]).toBeGreaterThan(worst[PackRarity.Ultime])
  expect(best[PackRarity.Normal]).toBeLessThan(worst[PackRarity.Normal])
  // Reste rare : l'ultime ne dépasse jamais 5 %, le pack normal reste le plus fréquent
  expect(best[PackRarity.Ultime]).toBeLessThanOrEqual(5)
  expect(worst[PackRarity.Ultime]).toBeGreaterThanOrEqual(0.5)
  for (const rates of [worst, best]) {
    expect(PACK_RARITIES.reduce((sum, r) => sum + rates[r], 0)).toBeCloseTo(100, 6)
    expect(rates[PackRarity.Normal]).toBeGreaterThan(rates[PackRarity.Rare])
  }
})

test("performance bornée à [0, 1]", () => {
  expect(performance({ titleFound: 10, roundCount: 10, rank: 1, playerCount: 5 })).toBe(1)
  expect(performance({ titleFound: 0, roundCount: 10, rank: 5, playerCount: 5 })).toBe(0)
  expect(performance({ titleFound: 99, roundCount: 10, rank: 0, playerCount: 1 })).toBeLessThanOrEqual(1)
})

test("taux de cartes : chaque pack somme à 100 % et plus il est rare, plus les légendaires abondent", () => {
  for (const pack of PACK_RARITIES) {
    expect(CARD_RARITIES.reduce((sum, r) => sum + PACK_CARD_RATES[pack][r], 0)).toBeCloseTo(100, 6)
  }
  let previous = 0
  for (const pack of PACK_RARITIES) {
    const legendary = PACK_CARD_RATES[pack][CardRarity.Legendaire]
    expect(legendary).toBeGreaterThan(previous)
    previous = legendary
  }
})

test("seuils de percentile : ≥98 légendaire, ≥90 épique, ≥65 rare, sinon commun", () => {
  expect(CARD_PERCENTILES).toEqual({ legendaire: 98, epique: 90, rare: 65 })
  expect(rarityFromPercentile(100)).toBe(CardRarity.Legendaire)
  expect(rarityFromPercentile(98)).toBe(CardRarity.Legendaire)
  expect(rarityFromPercentile(97.99)).toBe(CardRarity.Epique)
  expect(rarityFromPercentile(90)).toBe(CardRarity.Epique)
  expect(rarityFromPercentile(65)).toBe(CardRarity.Rare)
  expect(rarityFromPercentile(64.9)).toBe(CardRarity.Commun)
  expect(rarityFromPercentile(0)).toBe(CardRarity.Commun)
})

test("la cover est reconstruite depuis le md5, jamais stockée", () => {
  expect(coverUrl("abc123", 250)).toBe("https://cdn-images.dzcdn.net/images/cover/abc123/250x250-000000-80-0-0.jpg")
})
