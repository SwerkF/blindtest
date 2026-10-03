import { expect, test } from "bun:test"
import type { User } from "@prisma/client"
import { FriendshipState, FriendshipStatus } from "@blindmusic/shared"
import { friendshipStateFor, toPublicProfileUser } from "@/account/profileRoutes"

const USER: User = {
  id: "user-1",
  discordId: "80351110224678912",
  username: "Nelly",
  discordAvatar: "abc123",
  pseudo: "nelly_music",
  avatarSeed: "v1|nelly|sun|30||happy",
  useDiscordAvatar: false,
  friendCode: "ABCD2345",
  packsSincePity: 0,
  createdAt: new Date("2026-01-02T03:04:05Z"),
  updatedAt: new Date("2026-01-02T03:04:05Z"),
}

test("profil public : jamais d'id Discord ni de code ami", () => {
  const pub = toPublicProfileUser(USER)
  expect(pub).toEqual({
    id: "user-1",
    pseudo: "nelly_music",
    username: "Nelly",
    avatarSeed: "v1|nelly|sun|30||happy",
    avatarUrl: null,
    createdAt: "2026-01-02T03:04:05.000Z",
  })
  expect(JSON.stringify(pub)).not.toContain(USER.discordId)
  expect(JSON.stringify(pub)).not.toContain(USER.friendCode)
})

test("profil public : photo Discord seulement si le joueur l'a choisie", () => {
  expect(toPublicProfileUser({ ...USER, useDiscordAvatar: true }).avatarUrl).toContain("cdn.discordapp.com")
  expect(toPublicProfileUser({ ...USER, pseudo: null }).pseudo).toBe("Nelly")
})

test("profil public : état d'amitié vu par le visiteur", () => {
  const pending = { requesterId: "a", addresseeId: "b", status: FriendshipStatus.Pending }
  const accepted = { ...pending, status: FriendshipStatus.Accepted }
  expect(friendshipStateFor(null, "b", null)).toBe(FriendshipState.Guest)
  expect(friendshipStateFor("b", "b", null)).toBe(FriendshipState.Self)
  expect(friendshipStateFor("a", "b", null)).toBe(FriendshipState.None)
  expect(friendshipStateFor("a", "b", pending)).toBe(FriendshipState.Outgoing)
  expect(friendshipStateFor("b", "a", pending)).toBe(FriendshipState.Incoming)
  expect(friendshipStateFor("b", "a", accepted)).toBe(FriendshipState.Friends)
})
