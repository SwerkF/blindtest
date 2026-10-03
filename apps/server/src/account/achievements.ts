import { AchievementId, GameMode, type RoundOutcome } from "@blindmusic/shared"

export const LIGHTNING_MS = 3000
export const FLAWLESS_MIN_ROUNDS = 10
const MARATHON_ROUNDS = 30
const HISTORIAN_YEARS = 5
const CENTURY_SCORE = 100

/** Everything achievements look at, for one player at the end of one game. */
export interface AchievementContext {
  mode: GameMode
  score: number
  rank: number
  playerCount: number
  roundCount: number
  outcomes: RoundOutcome[]
  fastestFindMs: number | null
  teamWon: boolean | null
  /** Totals including this game. */
  gamesPlayed: number
  wins: number
  /** Another participant is an accepted friend. */
  playedWithFriend: boolean
  /** Swerk (see SWERK_DISCORD_ID) is an accepted friend; never true for Swerk himself. */
  friendOfSwerk: boolean
  /** Swerk finished this game in the same lobby; never true for Swerk himself. */
  playedWithSwerk: boolean
}

/** A win needs opponents, otherwise solo games would hand it out. */
export function isWin(rank: number, playerCount: number): boolean {
  return rank === 1 && playerCount >= 2
}

/**
 * "Sans faute" tiers: every round of a game of at least FLAWLESS_MIN_ROUNDS
 * tracks passes `found`. A round never played (no outcome) breaks the streak.
 *
 * Anime mode needs no special case: the engine stores the anime in
 * `outcome.title` and the singer bonus in `outcome.artist`, so "title" is the
 * anime, "artist" the singer, and the year stays the year.
 */
function flawless(ctx: AchievementContext, found: (o: RoundOutcome) => boolean): boolean {
  if (ctx.roundCount < FLAWLESS_MIN_ROUNDS) return false
  for (let i = 0; i < ctx.roundCount; i++) {
    const outcome = ctx.outcomes[i]
    if (!outcome || !found(outcome)) return false
  }
  return true
}

const RULES: Record<AchievementId, (ctx: AchievementContext) => boolean> = {
  [AchievementId.FirstGame]: (ctx) => ctx.gamesPlayed >= 1,
  [AchievementId.FirstWin]: (ctx) => ctx.wins >= 1,
  [AchievementId.Regular]: (ctx) => ctx.gamesPlayed >= 10,
  [AchievementId.MusicLover]: (ctx) => ctx.gamesPlayed >= 50,
  [AchievementId.Veteran]: (ctx) => ctx.gamesPlayed >= 100,
  [AchievementId.Unstoppable]: (ctx) => ctx.wins >= 10,
  [AchievementId.Lightning]: (ctx) => ctx.fastestFindMs !== null && ctx.fastestFindMs < LIGHTNING_MS,
  [AchievementId.PerfectRound]: (ctx) => ctx.outcomes.some((o) => o && o.artist && o.title && o.year),
  [AchievementId.Flawless]: (ctx) => flawless(ctx, (o) => o.title),
  [AchievementId.FlawlessPerfect]: (ctx) => flawless(ctx, (o) => o.title && o.artist),
  [AchievementId.FlawlessUltimate]: (ctx) => flawless(ctx, (o) => o.title && o.artist && o.year),
  [AchievementId.Historian]: (ctx) => ctx.outcomes.filter((o) => o?.year).length >= HISTORIAN_YEARS,
  [AchievementId.Century]: (ctx) => ctx.score >= CENTURY_SCORE,
  [AchievementId.Otaku]: (ctx) => ctx.mode === GameMode.Anime && isWin(ctx.rank, ctx.playerCount),
  [AchievementId.Marathon]: (ctx) => ctx.roundCount >= MARATHON_ROUNDS,
  [AchievementId.WithFriends]: (ctx) => ctx.playedWithFriend,
  [AchievementId.TeamPlayer]: (ctx) => ctx.teamWon === true,
  [AchievementId.SwerkFriend]: (ctx) => ctx.friendOfSwerk,
  [AchievementId.SwerkGame]: (ctx) => ctx.playedWithSwerk,
}

/** Achievements this game unlocks, leaving out the ones already owned. */
export function evaluateAchievements(ctx: AchievementContext, alreadyUnlocked: Iterable<string>): AchievementId[] {
  const owned = new Set(alreadyUnlocked)
  return (Object.keys(RULES) as AchievementId[]).filter((id) => !owned.has(id) && RULES[id](ctx))
}
