import type { User } from "@prisma/client"
import { FriendshipStatus, type AccountUser, type PublicUser, type UserWsServerMessage } from "@blindmusic/shared"
import { prisma } from "@/db"
import { discordAvatarUrl, type DiscordUser } from "@/account/discord"
import { generateFriendCode, otherUserId } from "@/account/friendship"
import { notifyUser } from "@/account/presence"

export const PSEUDO_MAX_LENGTH = 20
export const AVATAR_SEED_MAX_LENGTH = 160

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    pseudo: user.pseudo || user.username,
    avatarSeed: user.avatarSeed,
    discordAvatarUrl: discordAvatarUrl(user.discordId, user.discordAvatar),
  }
}

export function toAccountUser(user: User): AccountUser {
  return { ...toPublicUser(user), friendCode: user.friendCode, hasProfile: user.pseudo !== null }
}

/** Creates the account on first login, refreshes the Discord name and avatar afterwards. */
export async function upsertDiscordUser(discord: DiscordUser): Promise<User> {
  const username = discord.globalName || discord.username
  const existing = await prisma.user.findUnique({ where: { discordId: discord.id } })
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: { username, discordAvatar: discord.avatar },
    })
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.user.create({
        data: { discordId: discord.id, username, discordAvatar: discord.avatar, friendCode: generateFriendCode() },
      })
    } catch (error) {
      // A friend code collision is the only expected failure: retry a few times
      if (attempt >= 4) throw error
    }
  }
}

export async function friendIds(userId: string): Promise<string[]> {
  const rows = await prisma.friendship.findMany({
    where: {
      status: FriendshipStatus.Accepted,
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    select: { requesterId: true, addresseeId: true },
  })
  return rows.map((row) => otherUserId(row, userId))
}

export async function notifyFriends(userId: string, msg: UserWsServerMessage) {
  for (const id of await friendIds(userId)) notifyUser(id, msg)
}
