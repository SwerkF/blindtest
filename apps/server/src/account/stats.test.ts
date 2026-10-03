import { expect, test } from "bun:test"
import type { RoundOutcome } from "@blindmusic/shared"
import { buildProfileStats, roundCounters, type StatsTotals } from "@/account/stats"

const MISS: RoundOutcome = { artist: false, title: false, year: false }
const ARTIST: RoundOutcome = { artist: true, title: false, year: false }
const TITLE: RoundOutcome = { artist: false, title: true, year: false }
const BOTH: RoundOutcome = { artist: true, title: true, year: false }
const ALL: RoundOutcome = { artist: true, title: true, year: true }

function totals(overrides: Partial<StatsTotals> = {}): StatsTotals {
  return {
    gamesPlayed: 0,
    wins: 0,
    bestScore: null,
    ...roundCounters([], []),
    ...overrides,
  }
}

test("stats : compteurs d'une partie (perfect = artiste + titre, ultimate = + année)", () => {
  const counters = roundCounters([MISS, ARTIST, TITLE, BOTH, ALL], [4000, 2000, 9000])
  expect(counters).toEqual({
    roundsTracked: 5,
    artistFound: 3,
    titleFound: 3,
    yearFound: 1,
    perfectRounds: 2,
    ultimateRounds: 1,
    titleTimeTotalMs: 15000,
    titleTimeCount: 3,
  })
})

test("stats : les manches manquées (arrivée en cours de partie) ne comptent pas", () => {
  const outcomes: (RoundOutcome | undefined)[] = []
  outcomes[2] = BOTH
  const counters = roundCounters(outcomes, [1234.6, Number.NaN, -1])
  expect(counters.roundsTracked).toBe(1)
  expect(counters.perfectRounds).toBe(1)
  expect(counters.titleTimeTotalMs).toBe(1235)
  expect(counters.titleTimeCount).toBe(1)
})

test("stats : profil vide", () => {
  expect(buildProfileStats(totals())).toEqual({
    gamesPlayed: 0,
    wins: 0,
    winRate: 0,
    bestScore: null,
    roundsTracked: 0,
    averageFound: null,
    titleRate: null,
    perfectRounds: 0,
    ultimateRounds: 0,
    averageTitleMs: null,
  })
})

test("stats : agrégat sur plusieurs parties", () => {
  // Summing per-game counters is what the SQL aggregate does
  const a = roundCounters([MISS, BOTH, ALL], [3000, 5000])
  const b = roundCounters([ARTIST, TITLE], [10000])
  const sum = { ...a }
  for (const key of Object.keys(a) as (keyof typeof a)[]) sum[key] = a[key] + b[key]
  const stats = buildProfileStats(totals({ gamesPlayed: 3, wins: 1, bestScore: 87, ...sum }))
  expect(stats.winRate).toBe(33)
  expect(stats.bestScore).toBe(87)
  expect(stats.roundsTracked).toBe(5)
  // (3 artists + 3 titles + 1 year) / 5 rounds
  expect(stats.averageFound).toBe(1.4)
  expect(stats.titleRate).toBe(60)
  expect(stats.perfectRounds).toBe(2)
  expect(stats.ultimateRounds).toBe(1)
  expect(stats.averageTitleMs).toBe(6000)
})

test("stats : anciennes parties sans détail → stats de manche vides", () => {
  const stats = buildProfileStats(totals({ gamesPlayed: 4, wins: 4, bestScore: 40 }))
  expect(stats.winRate).toBe(100)
  expect(stats.averageFound).toBeNull()
  expect(stats.titleRate).toBeNull()
  expect(stats.averageTitleMs).toBeNull()
})
