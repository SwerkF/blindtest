import { expect, test } from "bun:test"
import { AchievementId, FriendshipStatus, GameMode, type LobbySettings, type RoundOutcome } from "@blindmusic/shared"
import { evaluateAchievements, isWin, type AchievementContext } from "@/account/achievements"
import {
  FriendAction,
  FriendError,
  friendshipTransition,
  generateFriendCode,
  normalizeFriendCode,
  otherUserId,
  FRIEND_CODE_LENGTH,
} from "@/account/friendship"
import { parseCookies, signValue, unsignValue } from "@/account/session"
import { safeReturnTo } from "@/account/authRoutes"
import { addUserSocket, isOnline, notifyUser, removeUserSocket } from "@/account/presence"
import {
  addPlayer,
  createRoom,
  gameSummary,
  isUserInRoom,
  linkUser,
  processGuess,
  removePlayer,
  rooms,
  startGame,
} from "@/game/engine"
import type { Track } from "@/deezer"

const MISS: RoundOutcome = { artist: false, title: false, year: false }
const BOTH: RoundOutcome = { artist: true, title: true, year: false }
const ALL: RoundOutcome = { artist: true, title: true, year: true }

function ctx(overrides: Partial<AchievementContext> = {}): AchievementContext {
  return {
    mode: GameMode.Classic,
    score: 10,
    rank: 2,
    playerCount: 3,
    roundCount: 3,
    outcomes: [MISS, BOTH, MISS],
    fastestFindMs: 8000,
    teamWon: null,
    gamesPlayed: 2,
    wins: 0,
    playedWithFriend: false,
    ...overrides,
  }
}

test("succès : une première partie banale ne débloque que Première écoute", () => {
  expect(evaluateAchievements(ctx({ gamesPlayed: 1 }), [])).toEqual([AchievementId.FirstGame])
})

test("succès : ceux déjà obtenus ne reviennent pas", () => {
  expect(evaluateAchievements(ctx({ gamesPlayed: 1 }), [AchievementId.FirstGame])).toEqual([])
})

test("succès : paliers de parties et de victoires", () => {
  const ids = evaluateAchievements(ctx({ gamesPlayed: 50, wins: 10 }), [])
  expect(ids).toContain(AchievementId.Regular)
  expect(ids).toContain(AchievementId.MusicLover)
  expect(ids).toContain(AchievementId.Unstoppable)
  expect(ids).not.toContain(AchievementId.Veteran)
})

test("succès : une victoire en solo n'en est pas une", () => {
  expect(isWin(1, 1)).toBe(false)
  expect(isWin(1, 2)).toBe(true)
  expect(isWin(2, 4)).toBe(false)
  const solo = evaluateAchievements(ctx({ mode: GameMode.Anime, rank: 1, playerCount: 1 }), [])
  expect(solo).not.toContain(AchievementId.Otaku)
  const duo = evaluateAchievements(ctx({ mode: GameMode.Anime, rank: 1, playerCount: 2, wins: 1 }), [])
  expect(duo).toContain(AchievementId.Otaku)
  expect(duo).toContain(AchievementId.FirstWin)
})

test("succès : éclair sous 3 secondes, pas à 3 pile", () => {
  expect(evaluateAchievements(ctx({ fastestFindMs: 2999 }), [])).toContain(AchievementId.Lightning)
  expect(evaluateAchievements(ctx({ fastestFindMs: 3000 }), [])).not.toContain(AchievementId.Lightning)
  expect(evaluateAchievements(ctx({ fastestFindMs: null }), [])).not.toContain(AchievementId.Lightning)
})

test("succès : manche parfaite, sans-faute et historien", () => {
  const perfect = evaluateAchievements(ctx({ outcomes: [MISS, ALL, MISS] }), [])
  expect(perfect).toContain(AchievementId.PerfectRound)
  expect(perfect).not.toContain(AchievementId.Flawless)

  const flawless = evaluateAchievements(ctx({ roundCount: 5, outcomes: [BOTH, BOTH, ALL, ALL, ALL] }), [])
  expect(flawless).toContain(AchievementId.Flawless)
  expect(flawless).not.toContain(AchievementId.Historian)

  // A missing outcome (round never played) breaks the streak
  expect(evaluateAchievements(ctx({ roundCount: 5, outcomes: [BOTH, BOTH, BOTH, BOTH] }), [])).not.toContain(
    AchievementId.Flawless
  )
  expect(evaluateAchievements(ctx({ outcomes: [ALL, ALL, ALL, ALL, ALL] }), [])).toContain(AchievementId.Historian)
})

test("succès : en mode anime le sans-faute ne demande que l'anime", () => {
  const animeOnly: RoundOutcome = { artist: false, title: true, year: false }
  const ids = evaluateAchievements(ctx({ mode: GameMode.Anime, roundCount: 5, outcomes: Array(5).fill(animeOnly) }), [])
  expect(ids).toContain(AchievementId.Flawless)
})

test("succès : score, marathon, amis et équipe", () => {
  const ids = evaluateAchievements(ctx({ score: 100, roundCount: 30, playedWithFriend: true, teamWon: true }), [])
  expect(ids).toEqual(
    expect.arrayContaining([
      AchievementId.Century,
      AchievementId.Marathon,
      AchievementId.WithFriends,
      AchievementId.TeamPlayer,
    ])
  )
  expect(evaluateAchievements(ctx({ teamWon: false }), [])).not.toContain(AchievementId.TeamPlayer)
})

test("amis : demande, acceptation, refus et suppression", () => {
  const request = friendshipTransition(null, "a", "b", FriendAction.Request)
  expect(request).toEqual({
    kind: "create",
    row: { requesterId: "a", addresseeId: "b", status: FriendshipStatus.Pending },
  })
  if (request.kind !== "create") throw new Error("unreachable")
  const pending = request.row

  expect(friendshipTransition(pending, "a", "b", FriendAction.Request)).toEqual({
    kind: "error",
    error: FriendError.AlreadyRequested,
  })
  // Only the addressee can accept
  expect(friendshipTransition(pending, "a", "b", FriendAction.Accept)).toEqual({
    kind: "error",
    error: FriendError.NoRequest,
  })
  const accepted = friendshipTransition(pending, "b", "a", FriendAction.Accept)
  expect(accepted).toEqual({ kind: "update", row: { ...pending, status: FriendshipStatus.Accepted } })

  // Either side can drop a pending request (refuse or cancel)
  expect(friendshipTransition(pending, "b", "a", FriendAction.Decline)).toEqual({ kind: "delete" })
  expect(friendshipTransition(pending, "a", "b", FriendAction.Decline)).toEqual({ kind: "delete" })
  expect(friendshipTransition(pending, "a", "b", FriendAction.Remove).kind).toBe("error")

  const friends = { ...pending, status: FriendshipStatus.Accepted }
  expect(friendshipTransition(friends, "b", "a", FriendAction.Request)).toEqual({
    kind: "error",
    error: FriendError.AlreadyFriends,
  })
  expect(friendshipTransition(friends, "b", "a", FriendAction.Remove)).toEqual({ kind: "delete" })
  expect(friendshipTransition(friends, "b", "a", FriendAction.Decline).kind).toBe("error")
})

test("amis : se demander mutuellement vaut acceptation, s'ajouter soi-même est refusé", () => {
  const pending = { requesterId: "a", addresseeId: "b", status: FriendshipStatus.Pending }
  expect(friendshipTransition(pending, "b", "a", FriendAction.Request)).toEqual({
    kind: "update",
    row: { ...pending, status: FriendshipStatus.Accepted },
  })
  expect(friendshipTransition(null, "a", "a", FriendAction.Request)).toEqual({ kind: "error", error: FriendError.Self })
  expect(otherUserId(pending, "a")).toBe("b")
  expect(otherUserId(pending, "b")).toBe("a")
})

test("amis : codes ami lisibles et normalisés", () => {
  const code = generateFriendCode()
  expect(code).toHaveLength(FRIEND_CODE_LENGTH)
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/)
  expect(normalizeFriendCode(" abcd-2345 ")).toBe("ABCD2345")
})

test("session : signature vérifiée, falsification refusée", () => {
  const signed = signValue("session-id", "secret")
  expect(unsignValue(signed, "secret")).toBe("session-id")
  expect(unsignValue(signed, "other")).toBeNull()
  expect(unsignValue(signed.replace("session-id", "session-ie"), "secret")).toBeNull()
  expect(unsignValue("nodot", "secret")).toBeNull()
  expect(unsignValue(undefined, "secret")).toBeNull()
  expect(parseCookies("a=1; bt_session=x.y%3D; a=2")).toEqual({ a: "1", bt_session: "x.y=" })
})

test("session : le retour après connexion reste sur le site", () => {
  expect(safeReturnTo("/profil")).toBe("/profil")
  expect(safeReturnTo("//evil.test")).toBe("/")
  expect(safeReturnTo("https://evil.test")).toBe("/")
  expect(safeReturnTo("/\\evil.test")).toBe("/")
  expect(safeReturnTo(undefined)).toBe("/")
})

test("présence : en ligne tant qu'un onglet reste ouvert", () => {
  const received: string[] = []
  const tab1 = () => received.push("tab1")
  const tab2 = () => received.push("tab2")
  expect(addUserSocket("u", tab1)).toBe(true)
  expect(addUserSocket("u", tab2)).toBe(false)
  expect(notifyUser("u", { type: "friend:changed" })).toBe(true)
  expect(received).toEqual(["tab1", "tab2"])
  expect(removeUserSocket("u", tab1)).toBe(false)
  expect(isOnline("u")).toBe(true)
  expect(removeUserSocket("u", tab2)).toBe(true)
  expect(isOnline("u")).toBe(false)
  expect(notifyUser("u", { type: "friend:changed" })).toBe(false)
})

const TRACK: Track = {
  id: 1,
  title: "Sous le vent",
  fullTitle: "Sous le vent",
  artist: "Céline Dion",
  year: 2001,
  previewUrl: "https://example.test/p.mp3",
  coverUrl: null,
}

const SETTINGS: LobbySettings = {
  mode: GameMode.Classic,
  playlistIds: ["p"],
  customDeezerPlaylistIds: [],
  trackCount: 1,
  roundDuration: 60,
  maxErrorPercent: 20,
  yearGuessAttempts: 2,
  showLyrics: false,
  showHint: false,
  showArtistHint: false,
}

test("fin de partie : résumé avec comptes, rangs ex aequo et trouvaille la plus rapide", async () => {
  createRoom("ACC1", "a", "Alice", "a", () => {})
  addPlayer("ACC1", "b", "Bob", "b", () => {})
  addPlayer("ACC1", "c", "Chloé", "c", () => {})
  linkUser("ACC1", "a", "user-a")
  expect(isUserInRoom("ACC1", "user-a")).toBe(true)
  expect(isUserInRoom("ACC1", "user-b")).toBe(false)

  await startGame("ACC1", SETTINGS, [TRACK], { countdownMs: 0 })
  await Bun.sleep(5)
  processGuess("ACC1", "a", "Sous le vent")
  processGuess("ACC1", "b", "Sous le vent")

  const summary = gameSummary(rooms.get("ACC1")!)
  expect(summary.mode).toBe(GameMode.Classic)
  expect(summary.roundCount).toBe(1)
  const alice = summary.players.find((p) => p.playerId === "a")!
  const bob = summary.players.find((p) => p.playerId === "b")!
  const chloe = summary.players.find((p) => p.playerId === "c")!
  expect(alice.userId).toBe("user-a")
  expect(bob.userId).toBeNull()
  expect(alice.rank).toBe(1)
  expect(bob.rank).toBe(1)
  expect(chloe.rank).toBe(3)
  expect(alice.fastestFindMs).not.toBeNull()
  expect(alice.fastestFindMs!).toBeLessThan(3000)
  expect(chloe.fastestFindMs).toBeNull()
  expect(alice.team).toBeNull()
  expect(alice.teamWon).toBeNull()

  for (const id of ["a", "b", "c"]) removePlayer("ACC1", id)
})
