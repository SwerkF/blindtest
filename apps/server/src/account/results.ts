import { FriendshipStatus } from "@blindmusic/shared"
import { prisma } from "@/db"
import type { GameEndSummary } from "@/game/engine"
import { evaluateAchievements, isWin } from "@/account/achievements"
import { notifyUser } from "@/account/presence"
import { swerkFriendsAmong, swerkUserId } from "@/account/swerk"

/**
 * Stores the game in the history of every logged-in participant and unlocks
 * their achievements. Guests are skipped: their history stays in localStorage.
 */
export async function persistGameResults(summary: GameEndSummary) {
  const playerCount = summary.players.length
  const accounts = summary.players.filter((p): p is typeof p & { userId: string } => p.userId !== null)
  if (accounts.length === 0 || summary.roundCount === 0) return

  const userIds = [...new Set(accounts.map((p) => p.userId))]
  const friendships = await prisma.friendship.findMany({
    where: { status: FriendshipStatus.Accepted, requesterId: { in: userIds }, addresseeId: { in: userIds } },
    select: { requesterId: true, addresseeId: true },
  })
  const hasFriendInGame = new Set(friendships.flatMap((f) => [f.requesterId, f.addresseeId]))
  const swerkId = await swerkUserId()
  const swerkInGame = swerkId !== null && userIds.includes(swerkId)
  const swerkFriends = await swerkFriendsAmong(userIds, swerkId)

  // The same account in two tabs only counts once, with its best result
  const seen = new Set<string>()
  for (const player of [...accounts].sort((a, b) => a.rank - b.rank)) {
    if (seen.has(player.userId)) continue
    seen.add(player.userId)
    const won = isWin(player.rank, playerCount)
    const [, gamesPlayed, wins, unlocked] = await prisma.$transaction([
      prisma.gameResult.create({
        data: {
          userId: player.userId,
          roomCode: summary.code,
          mode: summary.mode,
          score: player.score,
          rank: player.rank,
          playerCount,
          roundCount: summary.roundCount,
          won,
          team: player.team,
          teamWon: player.teamWon,
        },
      }),
      prisma.gameResult.count({ where: { userId: player.userId } }),
      prisma.gameResult.count({ where: { userId: player.userId, won: true } }),
      prisma.userAchievement.findMany({ where: { userId: player.userId }, select: { achievementId: true } }),
    ])

    const ids = evaluateAchievements(
      {
        mode: summary.mode,
        score: player.score,
        rank: player.rank,
        playerCount,
        roundCount: summary.roundCount,
        outcomes: player.outcomes,
        fastestFindMs: player.fastestFindMs,
        teamWon: player.teamWon,
        gamesPlayed,
        wins,
        playedWithFriend: hasFriendInGame.has(player.userId),
        friendOfSwerk: swerkFriends.has(player.userId),
        playedWithSwerk: swerkInGame && player.userId !== swerkId,
      },
      unlocked.map((u) => u.achievementId)
    )
    if (ids.length === 0) continue
    await prisma.userAchievement.createMany({
      data: ids.map((achievementId) => ({ userId: player.userId, achievementId })),
    })
    notifyUser(player.userId, { type: "achievement:unlocked", ids })
  }
}
