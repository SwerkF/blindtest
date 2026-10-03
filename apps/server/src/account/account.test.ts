import { expect, test } from "bun:test"
import { AchievementId, achievementDef, FriendshipStatus, GameMode, type LobbySettings, type RoundOutcome } from "@blindmusic/shared"
import { evaluateAchievements, FLAWLESS_MIN_ROUNDS, isWin, type AchievementContext } from "@/account/achievements"
import { SWERK_DISCORD_ID } from "@/account/config"
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
    friendOfSwerk: false,
    playedWithSwerk: false,
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

test("succès : manche parfaite et historien", () => {
  const perfect = evaluateAchievements(ctx({ outcomes: [MISS, ALL, MISS] }), [])
  expect(perfect).toContain(AchievementId.PerfectRound)
  expect(perfect).not.toContain(AchievementId.Flawless)
  expect(evaluateAchievements(ctx({ outcomes: [ALL, ALL, ALL, ALL, ALL] }), [])).toContain(AchievementId.Historian)
  expect(evaluateAchievements(ctx({ outcomes: [ALL, ALL, ALL, ALL] }), [])).not.toContain(AchievementId.Historian)
})

const TITLE: RoundOutcome = { artist: false, title: true, year: false }
const TITLE_YEAR: RoundOutcome = { artist: false, title: true, year: true }
const SANS_FAUTE = [AchievementId.Flawless, AchievementId.FlawlessPerfect, AchievementId.FlawlessUltimate]

function sansFaute(outcomes: RoundOutcome[], overrides: Partial<AchievementContext> = {}): AchievementId[] {
  const ids = evaluateAchievements(ctx({ roundCount: outcomes.length, outcomes, ...overrides }), [])
  return SANS_FAUTE.filter((id) => ids.includes(id))
}

test("succès : paliers sans faute selon ce qui est trouvé à chaque manche", () => {
  expect(FLAWLESS_MIN_ROUNDS).toBe(10)
  expect(sansFaute(Array(10).fill(TITLE))).toEqual([AchievementId.Flawless])
  expect(sansFaute(Array(10).fill(TITLE_YEAR))).toEqual([AchievementId.Flawless])
  expect(sansFaute(Array(10).fill(BOTH))).toEqual([AchievementId.Flawless, AchievementId.FlawlessPerfect])
  expect(sansFaute(Array(10).fill(ALL))).toEqual(SANS_FAUTE)
  // The weakest round sets the tier
  expect(sansFaute([...Array(9).fill(ALL), BOTH])).toEqual([AchievementId.Flawless, AchievementId.FlawlessPerfect])
  expect(sansFaute([...Array(9).fill(ALL), TITLE])).toEqual([AchievementId.Flawless])
  // The artist alone is not the title
  expect(sansFaute([...Array(9).fill(ALL), { artist: true, title: false, year: true }])).toEqual([])
  expect(sansFaute([...Array(9).fill(ALL), MISS])).toEqual([])
})

test("succès : sans faute demande au moins 10 titres, tous joués", () => {
  expect(sansFaute(Array(9).fill(ALL))).toEqual([])
  expect(sansFaute(Array(30).fill(ALL))).toEqual(SANS_FAUTE)
  // A missing outcome (round never played) breaks the streak
  expect(sansFaute(Array(9).fill(ALL), { roundCount: 10 })).toEqual([])
  expect(sansFaute([...Array(4).fill(ALL), undefined as unknown as RoundOutcome, ...Array(5).fill(ALL)])).toEqual([])
})

test("succès : en mode anime, l'anime compte comme le titre et l'interprète comme l'artiste", () => {
  const anime = { mode: GameMode.Anime }
  expect(sansFaute(Array(10).fill(TITLE), anime)).toEqual([AchievementId.Flawless])
  expect(sansFaute(Array(10).fill(BOTH), anime)).toEqual([AchievementId.Flawless, AchievementId.FlawlessPerfect])
  expect(sansFaute(Array(10).fill(ALL), anime)).toEqual(SANS_FAUTE)
  expect(sansFaute(Array(10).fill({ artist: true, title: false, year: false }), anime)).toEqual([])
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

test("succès secrets : Swerk, uniquement via le contexte et marqués secrets", () => {
  const ids = evaluateAchievements(ctx(), [])
  expect(ids).not.toContain(AchievementId.SwerkFriend)
  expect(ids).not.toContain(AchievementId.SwerkGame)
  expect(evaluateAchievements(ctx({ friendOfSwerk: true }), [])).toContain(AchievementId.SwerkFriend)
  expect(evaluateAchievements(ctx({ playedWithSwerk: true }), [])).toContain(AchievementId.SwerkGame)
  expect(evaluateAchievements(ctx({ playedWithSwerk: true }), [AchievementId.SwerkGame])).not.toContain(
    AchievementId.SwerkGame
  )
  expect(achievementDef(AchievementId.SwerkFriend)?.secret).toBe(true)
  expect(achievementDef(AchievementId.SwerkGame)?.secret).toBe(true)
  expect(SWERK_DISCORD_ID).toBe(process.env.SWERK_DISCORD_ID?.trim() || "317411645129490435")
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

test("fin de partie en équipes : victoire d'équipe seulement en mode équipe", async () => {
  createRoom("ACC2", "a", "Alice", "a", () => {})
  addPlayer("ACC2", "b", "Bob", "b", () => {})

  await startGame("ACC2", { ...SETTINGS, teamMode: true }, [TRACK], { countdownMs: 0 })
  await Bun.sleep(5)
  processGuess("ACC2", "a", "Sous le vent")

  const room = rooms.get("ACC2")!
  const summary = gameSummary(room)
  const alice = summary.players.find((p) => p.playerId === "a")!
  const bob = summary.players.find((p) => p.playerId === "b")!
  expect(alice.team).not.toBe(bob.team)
  expect(alice.teamWon).toBe(true)
  expect(bob.teamWon).toBe(false)

  room.settings = { ...room.settings!, teamMode: false }
  expect(gameSummary(room).players.every((p) => p.team === null && p.teamWon === null)).toBe(true)

  for (const id of ["a", "b"]) removePlayer("ACC2", id)
})
