import type { ProfileStats, RoundOutcome } from "@blindmusic/shared"
import { prisma } from "@/db"

/** Per-game round counters stored on GameResult. */
export interface RoundCounters {
  roundsTracked: number
  artistFound: number
  titleFound: number
  yearFound: number
  perfectRounds: number
  ultimateRounds: number
  titleTimeTotalMs: number
  titleTimeCount: number
}

/**
 * Folds one player's rounds into counters. Rounds the player missed (joined late)
 * are holes in the array and are skipped. In anime mode "title" is the anime name.
 */
export function roundCounters(outcomes: (RoundOutcome | undefined)[], titleFindMs: number[]): RoundCounters {
  const counters: RoundCounters = {
    roundsTracked: 0,
    artistFound: 0,
    titleFound: 0,
    yearFound: 0,
    perfectRounds: 0,
    ultimateRounds: 0,
    titleTimeTotalMs: 0,
    titleTimeCount: 0,
  }
  for (const outcome of outcomes) {
    if (!outcome) continue
    counters.roundsTracked++
    if (outcome.artist) counters.artistFound++
    if (outcome.title) counters.titleFound++
    if (outcome.year) counters.yearFound++
    if (outcome.artist && outcome.title) {
      counters.perfectRounds++
      if (outcome.year) counters.ultimateRounds++
    }
  }
  for (const ms of titleFindMs) {
    if (!Number.isFinite(ms) || ms < 0) continue
    counters.titleTimeTotalMs += Math.round(ms)
    counters.titleTimeCount++
  }
  return counters
}

/** Totals over every saved game of a user, as returned by the aggregate query. */
export interface StatsTotals extends RoundCounters {
  gamesPlayed: number
  wins: number
  bestScore: number | null
}

const round1 = (value: number) => Math.round(value * 10) / 10

export function buildProfileStats(totals: StatsTotals): ProfileStats {
  const rounds = totals.roundsTracked
  return {
    gamesPlayed: totals.gamesPlayed,
    wins: totals.wins,
    winRate: totals.gamesPlayed ? Math.round((totals.wins / totals.gamesPlayed) * 100) : 0,
    bestScore: totals.gamesPlayed ? totals.bestScore : null,
    roundsTracked: rounds,
    averageFound: rounds ? round1((totals.artistFound + totals.titleFound + totals.yearFound) / rounds) : null,
    titleRate: rounds ? Math.round((totals.titleFound / rounds) * 100) : null,
    perfectRounds: totals.perfectRounds,
    ultimateRounds: totals.ultimateRounds,
    averageTitleMs: totals.titleTimeCount ? Math.round(totals.titleTimeTotalMs / totals.titleTimeCount) : null,
  }
}

export async function loadProfileStats(userId: string): Promise<ProfileStats> {
  const [all, wins] = await Promise.all([
    prisma.gameResult.aggregate({
      where: { userId },
      _count: { _all: true },
      _max: { score: true },
      _sum: {
        roundsTracked: true,
        artistFound: true,
        titleFound: true,
        yearFound: true,
        perfectRounds: true,
        ultimateRounds: true,
        titleTimeTotalMs: true,
        titleTimeCount: true,
      },
    }),
    prisma.gameResult.count({ where: { userId, won: true } }),
  ])
  const sum = all._sum
  return buildProfileStats({
    gamesPlayed: all._count._all,
    wins,
    bestScore: all._max.score,
    roundsTracked: sum.roundsTracked ?? 0,
    artistFound: sum.artistFound ?? 0,
    titleFound: sum.titleFound ?? 0,
    yearFound: sum.yearFound ?? 0,
    perfectRounds: sum.perfectRounds ?? 0,
    ultimateRounds: sum.ultimateRounds ?? 0,
    titleTimeTotalMs: sum.titleTimeTotalMs ?? 0,
    titleTimeCount: sum.titleTimeCount ?? 0,
  })
}
