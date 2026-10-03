import { AchievementId, FriendshipStatus } from "@blindmusic/shared"
import { prisma } from "@/db"
import { SWERK_DISCORD_ID } from "@/account/config"
import { notifyUser } from "@/account/presence"

/** Swerk's account id, resolved from his Discord id (null until he logs in once). */
export async function swerkUserId(): Promise<string | null> {
  const swerk = await prisma.user.findUnique({ where: { discordId: SWERK_DISCORD_ID }, select: { id: true } })
  return swerk?.id ?? null
}

/** The users among `userIds` (Swerk left out) who have Swerk as an accepted friend. */
export async function swerkFriendsAmong(userIds: string[], swerkId: string | null): Promise<Set<string>> {
  const others = userIds.filter((id) => id !== swerkId)
  if (!swerkId || others.length === 0) return new Set()
  const rows = await prisma.friendship.findMany({
    where: {
      status: FriendshipStatus.Accepted,
      OR: [
        { requesterId: swerkId, addresseeId: { in: others } },
        { addresseeId: swerkId, requesterId: { in: others } },
      ],
    },
    select: { requesterId: true, addresseeId: true },
  })
  return new Set(rows.map((r) => (r.requesterId === swerkId ? r.addresseeId : r.requesterId)))
}

/**
 * Unlocks « Ami de Swerk » for whichever of `userIds` is friends with Swerk.
 * Runs when a request is accepted and when achievements are listed, so
 * friendships made before the achievement existed count too.
 */
export async function syncSwerkFriendAchievement(userIds: string[]): Promise<void> {
  const friends = await swerkFriendsAmong(userIds, await swerkUserId())
  for (const userId of friends) {
    const owned = await prisma.userAchievement.findUnique({
      where: { userId_achievementId: { userId, achievementId: AchievementId.SwerkFriend } },
    })
    if (owned) continue
    try {
      await prisma.userAchievement.create({ data: { userId, achievementId: AchievementId.SwerkFriend } })
    } catch {
      // Two concurrent requests raced on the same row: already unlocked
      continue
    }
    notifyUser(userId, { type: "achievement:unlocked", ids: [AchievementId.SwerkFriend] })
  }
}
