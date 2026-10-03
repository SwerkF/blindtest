/**
 * Vinyl boosters: single source of truth for the server draw and the rates
 * shown in the UI, so the two can never drift apart.
 */

export enum PackRarity {
  Normal = "normal",
  Rare = "rare",
  TresRare = "tres_rare",
  Ultime = "ultime",
}

export enum CardRarity {
  Commun = "commun",
  Rare = "rare",
  Epique = "epique",
  Legendaire = "legendaire",
}

export const PACK_RARITIES: PackRarity[] = [
  PackRarity.Normal,
  PackRarity.Rare,
  PackRarity.TresRare,
  PackRarity.Ultime,
]

/** From the most common to the rarest. */
export const CARD_RARITIES: CardRarity[] = [
  CardRarity.Commun,
  CardRarity.Rare,
  CardRarity.Epique,
  CardRarity.Legendaire,
]

export function isPackRarity(value: unknown): value is PackRarity {
  return typeof value === "string" && (PACK_RARITIES as string[]).includes(value)
}

export function isCardRarity(value: unknown): value is CardRarity {
  return typeof value === "string" && (CARD_RARITIES as string[]).includes(value)
}

/** Vinyls in one pack. */
export const PACK_SIZE = 5
/** A legendary vinyl is guaranteed once this many packs went by without one. */
export const PITY_THRESHOLD = 30
/** Collections are listed by pages of this size. */
export const COLLECTION_PAGE_SIZE = 24

/** Percentile (0-100) of the popularity score, inside its pool, from which a vinyl gets a rarity. */
export const CARD_PERCENTILES = { legendaire: 98, epique: 90, rare: 65 } as const

export function rarityFromPercentile(percentile: number): CardRarity {
  if (percentile >= CARD_PERCENTILES.legendaire) return CardRarity.Legendaire
  if (percentile >= CARD_PERCENTILES.epique) return CardRarity.Epique
  if (percentile >= CARD_PERCENTILES.rare) return CardRarity.Rare
  return CardRarity.Commun
}

/** Chance (in %) for each vinyl of a pack to have a given rarity. Every row sums to 100. */
export const PACK_CARD_RATES: Record<PackRarity, Record<CardRarity, number>> = {
  [PackRarity.Normal]: {
    [CardRarity.Commun]: 82,
    [CardRarity.Rare]: 15,
    [CardRarity.Epique]: 2.6,
    [CardRarity.Legendaire]: 0.4,
  },
  [PackRarity.Rare]: {
    [CardRarity.Commun]: 60,
    [CardRarity.Rare]: 30,
    [CardRarity.Epique]: 8,
    [CardRarity.Legendaire]: 2,
  },
  [PackRarity.TresRare]: {
    [CardRarity.Commun]: 35,
    [CardRarity.Rare]: 40,
    [CardRarity.Epique]: 20,
    [CardRarity.Legendaire]: 5,
  },
  [PackRarity.Ultime]: {
    [CardRarity.Commun]: 15,
    [CardRarity.Rare]: 35,
    [CardRarity.Epique]: 36,
    [CardRarity.Legendaire]: 14,
  },
}

/** Weights of the rarity of a dropped pack for a performance of 0. */
export const PACK_BASE_WEIGHTS: Record<PackRarity, number> = {
  [PackRarity.Normal]: 80,
  [PackRarity.Rare]: 15,
  [PackRarity.TresRare]: 4,
  [PackRarity.Ultime]: 1,
}

/** How much a perfect performance (1) multiplies the weight of each pack rarity: 1 + perf * bonus. */
export const PACK_PERFORMANCE_BONUS: Record<PackRarity, number> = {
  [PackRarity.Normal]: 0,
  [PackRarity.Rare]: 1,
  [PackRarity.TresRare]: 3,
  [PackRarity.Ultime]: 5,
}

/** A game needs at least this many rounds to have a chance of dropping a pack. */
export const MIN_ROUNDS_FOR_DROP = 3
/**
 * Floor on the round duration: games with shorter rounds never drop a pack,
 * so nobody can farm packs by chaining ultra-short rounds.
 */
export const MIN_ROUND_DURATION_SEC = 10
/** Time constant of the drop curve, in seconds of play. */
export const DROP_TIME_CONSTANT_SEC = 900
/** Playing alone is worth half of a game with other players. */
export const SOLO_DROP_FACTOR = 0.5
/** At most this many packs can be earned in a rolling 24 hours. */
export const MAX_PACKS_PER_DAY = 8

/** Seconds actually spent guessing during a game; 0 when the rounds are too short to count. */
export function playSeconds(roundCount: number, roundDurationSec: number): number {
  if (roundCount < MIN_ROUNDS_FOR_DROP || roundDurationSec < MIN_ROUND_DURATION_SEC) return 0
  return roundCount * roundDurationSec
}

/** Chance (0-1) that a game of `seconds` of play drops a pack: the more you play, the more likely. */
export function packDropChance(seconds: number, playerCount: number): number {
  if (seconds <= 0) return 0
  const chance = 1 - Math.exp(-seconds / DROP_TIME_CONSTANT_SEC)
  return playerCount >= 2 ? chance : chance * SOLO_DROP_FACTOR
}

export interface PerformanceInput {
  /** Rounds where the player found the title (or the anime). */
  titleFound: number
  roundCount: number
  rank: number
  playerCount: number
}

/** How well the player did, from 0 to 1: 60 % rounds found, 40 % ranking (0.5 when alone). */
export function performance({ titleFound, roundCount, rank, playerCount }: PerformanceInput): number {
  const found = roundCount > 0 ? Math.min(1, titleFound / roundCount) : 0
  const placement = playerCount > 1 ? 1 - (Math.max(1, rank) - 1) / (playerCount - 1) : 0.5
  return Math.min(1, Math.max(0, 0.6 * found + 0.4 * Math.min(1, Math.max(0, placement))))
}

/** Relative weights of the rarity of a dropped pack for a given performance (0-1). */
export function packRarityWeights(perf: number): Record<PackRarity, number> {
  const p = Math.min(1, Math.max(0, perf))
  const weights = {} as Record<PackRarity, number>
  for (const rarity of PACK_RARITIES) {
    weights[rarity] = PACK_BASE_WEIGHTS[rarity] * (1 + p * PACK_PERFORMANCE_BONUS[rarity])
  }
  return weights
}

/** Probabilities (in %) of the rarity of a dropped pack for a given performance (0-1). */
export function packRarityRates(perf: number): Record<PackRarity, number> {
  const weights = packRarityWeights(perf)
  const total = PACK_RARITIES.reduce((sum, rarity) => sum + weights[rarity], 0)
  const rates = {} as Record<PackRarity, number>
  for (const rarity of PACK_RARITIES) rates[rarity] = (weights[rarity] / total) * 100
  return rates
}

const COVER_CDN = "https://cdn-images.dzcdn.net/images/cover"

/** Deezer only gives the md5 of a cover: the image is loaded by the browser straight from their CDN. */
export function coverUrl(md5: string, size = 250): string {
  return `${COVER_CDN}/${md5}/${size}x${size}-000000-80-0-0.jpg`
}

export interface CardDto {
  entryId: string
  deezerTrackId: number
  title: string
  artistName: string
  deezerMd5Image: string | null
  /** Rarity frozen when the vinyl was first obtained. */
  rarity: CardRarity
  count: number
  firstObtainedAt: string
}

export interface PackStock {
  rarity: PackRarity
  count: number
}

export interface BoosterStateResponse {
  packs: PackStock[]
  packsSincePity: number
  pityThreshold: number
  /** Whether the catalogue has vinyls to draw, so the UI can say so. */
  catalogReady: boolean
}

export interface OpenedCard {
  card: CardDto
  /** First copy of this vinyl in the collection. */
  isNew: boolean
}

export interface OpenPackResponse {
  rarity: PackRarity
  cards: OpenedCard[]
  pityTriggered: boolean
  packsSincePity: number
  remaining: number
}

export interface RaritySummary {
  rarity: CardRarity
  /** Distinct vinyls owned with this rarity. */
  owned: number
  /** Vinyls of this rarity available in the catalogue. */
  total: number
}

export interface CollectionResponse {
  items: CardDto[]
  total: number
  page: number
  pageSize: number
  /** Distinct vinyls and total copies, whatever the filter. */
  unique: number
  copies: number
  summary: RaritySummary[]
}

export interface OpenPackBody {
  rarity: PackRarity
}
