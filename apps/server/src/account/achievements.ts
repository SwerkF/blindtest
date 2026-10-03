import { AchievementId, GameMode, type RoundOutcome } from "@blindmusic/shared"

export const LIGHTNING_MS = 3000
const FLAWLESS_MIN_ROUNDS = 5
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
}

/** A win needs opponents, otherwise solo games would hand it out. */
export function isWin(rank: number, playerCount: number): boolean {
  return rank === 1 && playerCount >= 2
}

/** Found "the answer" of a round: artist + title in classic, the anime in anime mode. */
function foundAnswer(outcome: RoundOutcome | undefined, mode: GameMode): boolean {
  if (!outcome) return false
  return mode === GameMode.Anime ? outcome.title : outcome.artist && outcome.title
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
  [AchievementId.Flawless]: (ctx) =>
    ctx.roundCount >= FLAWLESS_MIN_ROUNDS &&
    Array.from({ length: ctx.roundCount }, (_, i) => ctx.outcomes[i]).every((o) => foundAnswer(o, ctx.mode)),
  [AchievementId.Historian]: (ctx) => ctx.outcomes.filter((o) => o?.year).length >= HISTORIAN_YEARS,
  [AchievementId.Century]: (ctx) => ctx.score >= CENTURY_SCORE,
  [AchievementId.Otaku]: (ctx) => ctx.mode === GameMode.Anime && isWin(ctx.rank, ctx.playerCount),
  [AchievementId.Marathon]: (ctx) => ctx.roundCount >= MARATHON_ROUNDS,
  [AchievementId.WithFriends]: (ctx) => ctx.playedWithFriend,
  [AchievementId.TeamPlayer]: (ctx) => ctx.teamWon === true,
}

/** Achievements this game unlocks, leaving out the ones already owned. */
export function evaluateAchievements(ctx: AchievementContext, alreadyUnlocked: Iterable<string>): AchievementId[] {
  const owned = new Set(alreadyUnlocked)
  return (Object.keys(RULES) as AchievementId[]).filter((id) => !owned.has(id) && RULES[id](ctx))
}
