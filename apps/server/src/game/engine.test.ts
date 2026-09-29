import { expect, test } from "bun:test"
import { GameMode, GamePhase, GuessMatch, parseDeezerPlaylistId, type LobbySettings, type WsServerMessage } from "@blindmusic/shared"
import { cleanTitle, type Track } from "@/deezer"
import {
  createRoom,
  addPlayer,
  startGame,
  registerSocket,
  markDisconnected,
  processGuess,
  removePlayer,
  restartToLobby,
  buildHint,
} from "@/game/engine"

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

async function room(code: string, players: string[]) {
  const inbox: WsServerMessage[] = []
  const collect = (msg: WsServerMessage) => inbox.push(msg)

  createRoom(code, players[0], players[0], players[0], collect)
  for (const p of players.slice(1)) addPlayer(code, p, p, p, collect)
  // No countdown in tests; the round still starts on a timer tick
  await startGame(code, SETTINGS, [TRACK], { countdownMs: 0 })
  await Bun.sleep(5)
  return {
    inbox,
    last: <T extends WsServerMessage["type"]>(type: T) =>
      [...inbox].reverse().find((m): m is Extract<WsServerMessage, { type: T }> => m.type === type),
    cleanup: () => players.forEach((p) => removePlayer(code, p)),
  }
}

test("artiste seul puis titre seul totalisent la valeur du combo", async () => {
  const r = await room("T1", ["a"])

  const artist = processGuess("T1", "a", "Celine Dion")
  expect(artist?.matched).toBe(GuessMatch.Artist)
  expect(artist?.pointsEarned).toBe(5)

  // Re-soumettre l'artiste ne rapporte plus rien
  expect(processGuess("T1", "a", "Celine Dion")?.pointsEarned).toBe(0)

  // Completer la paire complete le total jusqu'a 20
  const title = processGuess("T1", "a", "Sous le vent")
  expect(title?.matched).toBe(GuessMatch.Title)
  expect(title?.pointsEarned).toBe(15)
  expect(title?.firstBoth).toBe(true)

  r.cleanup()
})

test("artiste et titre dans un seul message donnent 20 d'un coup", async () => {
  const r = await room("T2", ["a"])

  const res = processGuess("T2", "a", "celine dion sous le vent")
  expect(res?.matched).toBe(GuessMatch.Both)
  expect(res?.pointsEarned).toBe(20)

  r.cleanup()
})

test("le combo decroit de 2 pour chaque joueur suivant", async () => {
  const r = await room("T3", ["a", "b", "c"])

  expect(processGuess("T3", "a", "Céline Dion Sous le vent")?.pointsEarned).toBe(20)
  expect(processGuess("T3", "b", "Céline Dion Sous le vent")?.pointsEarned).toBe(18)
  expect(processGuess("T3", "c", "Céline Dion Sous le vent")?.pointsEarned).toBe(16)

  r.cleanup()
})

test("le matching ignore accents, casse, ponctuation et petites fautes", async () => {
  const r = await room("T4", ["a"])

  // "Celinne Dion" : 1 faute sur 12 caracteres, sous les 20% autorises
  expect(processGuess("T4", "a", "celinne dion!")?.matched).toBe(GuessMatch.Artist)

  r.cleanup()
})

test("un guess trop eloigne ne rapporte rien", async () => {
  const r = await room("T5", ["a"])

  const res = processGuess("T5", "a", "Johnny Hallyday")
  expect(res?.matched).toBe(GuessMatch.None)
  expect(res?.pointsEarned).toBe(0)

  r.cleanup()
})

test("un nombre a 4 chiffres est lu comme une annee et consomme les essais", async () => {
  const r = await room("T6", ["a"])

  const wrong = processGuess("T6", "a", "1999")
  expect(wrong?.matched).toBe(GuessMatch.YearWrong)
  expect(wrong?.yearGuessesLeft).toBe(1)

  const right = processGuess("T6", "a", "2001")
  expect(right?.matched).toBe(GuessMatch.Year)
  expect(right?.pointsEarned).toBe(2)
  expect(right?.yearGuessesLeft).toBe(0)

  const exhausted = processGuess("T6", "a", "2002")
  expect(exhausted?.matched).toBe(GuessMatch.YearAlreadyFound)
  expect(exhausted?.pointsEarned).toBe(0)

  r.cleanup()
})

test("renvoyer la bonne annee deja trouvee ne rapporte plus rien", async () => {
  const r = await room("T6b", ["a"])

  expect(processGuess("T6b", "a", "2001")?.pointsEarned).toBe(2)

  const again = processGuess("T6b", "a", "2001")
  expect(again?.matched).toBe(GuessMatch.YearAlreadyFound)
  expect(again?.pointsEarned).toBe(0)
  // Aucun essai consomme pour rien
  expect(again?.yearGuessesLeft).toBe(1)

  expect(processGuess("T6b", "a", "Céline Dion")?.pointsEarned).toBe(5)

  r.cleanup()
})

test("un joueur peut rejoindre une partie en cours et jouer la manche", async () => {
  const r = await room("T11", ["a"])

  expect(addPlayer("T11", "late", "late", "late", () => {})).not.toBeNull()
  expect(processGuess("T11", "late", "Céline Dion Sous le vent")?.pointsEarned).toBe(20)

  removePlayer("T11", "late")
  r.cleanup()
})

test("l'hote est transfere quand il quitte la salle", async () => {
  const r = await room("T12", ["a", "b"])

  removePlayer("T12", "a")
  expect(r.last("lobby:update")?.hostId).toBe("b")

  r.cleanup()
})

test("la manche se termine des que tous les joueurs connectes ont tout trouve", async () => {
  const r = await room("T7", ["a", "b"])
  registerSocket("T7", "a", () => {})
  registerSocket("T7", "b", () => {})

  processGuess("T7", "a", "Céline Dion Sous le vent")
  // b n'a pas encore repondu, la manche doit rester ouverte
  expect(processGuess("T7", "b", "Céline Dion Sous le vent")?.pointsEarned).toBe(18)

  // Manche terminee : les guess suivants sont rejetes
  expect(processGuess("T7", "a", "Céline Dion")).toBeNull()

  r.cleanup()
})

test("un guess presque bon est signale comme tel", async () => {
  const r = await room("T8", ["a"])

  // Assez proche pour chauffer, trop loin pour valider
  const warm = processGuess("T8", "a", "sous le vend ete")
  expect(warm?.matched).toBe(GuessMatch.Close)
  expect(warm?.pointsEarned).toBe(0)

  r.cleanup()
})

test("restartToLobby remet la salle a zero en gardant le code et les joueurs", async () => {
  const r = await room("T9", ["a", "b"])
  processGuess("T9", "a", "Céline Dion")

  restartToLobby("T9")

  const update = r.last("lobby:update")
  expect(update?.phase).toBe(GamePhase.Lobby)
  expect(update?.players.map((p) => p.name).sort()).toEqual(["a", "b"])
  expect(update?.players.every((p) => p.score === 0)).toBe(true)

  r.cleanup()
})

test("buildHint devoile le debut et masque le reste en gardant les espaces", () => {
  expect(buildHint("Sous le vent")).toBe("Sou• •• ••••")
  expect(buildHint("OMG")).toBe("O••")
  // Plus le titre est long, plus on devoile, sans depasser 4 lettres
  expect(buildHint("Bohemian Rhapsody")).toBe("Bohe•••• ••••••••")
})

test("une fermeture de socket perimee ne coupe pas le socket courant", () => {
  const inbox: WsServerMessage[] = []
  createRoom("T10", "a", "a", "a", () => {})
  const first = () => {}
  const second = (msg: WsServerMessage) => {
    inbox.push(msg)
  }
  registerSocket("T10", "a", first)
  registerSocket("T10", "a", second)
  markDisconnected("T10", "a", first)
  restartToLobby("T10")
  expect(inbox.some((msg) => msg.type === "lobby:update")).toBe(true)
  removePlayer("T10", "a")
})

test("parseDeezerPlaylistId lit un lien Deezer et refuse Spotify", () => {
  expect(parseDeezerPlaylistId("https://www.deezer.com/fr/playlist/123456789")).toBe("123456789")
  expect(parseDeezerPlaylistId("123456789")).toBe("123456789")
  expect(parseDeezerPlaylistId("https://open.spotify.com/playlist/abc")).toBeNull()
  expect(parseDeezerPlaylistId("")).toBeNull()
})

test("cleanTitle retire les mentions impossibles a deviner", () => {
  expect(cleanTitle({ title: "Alors on danse (Radio Edit)", title_short: "Alors on danse" })).toBe("Alors on danse")
  expect(cleanTitle({ title: "Mine (POP Mix)", title_short: "Mine" })).toBe("Mine")
  expect(
    cleanTitle({
      title: "Club Can't Handle Me (feat. David Guetta) (From Step Up 3D)",
      title_short: "Club Can't Handle Me (feat. David Guetta)",
    })
  ).toBe("Club Can't Handle Me")
  expect(cleanTitle({ title: "One (Your Name) (Radio Edit)", title_short: "One (Your Name)" })).toBe("One")
  expect(cleanTitle({ title: "Titanium - Radio Edit" })).toBe("Titanium")
  // Groupes imbriques : ne doit laisser aucun fragment
  expect(
    cleanTitle({
      title: "Waka Waka (This Time for Africa) [The Official 2010 FIFA World Cup (TM) Song] (Single)",
      title_short: "Waka Waka (This Time for Africa) [The Official 2010 FIFA World Cup (TM) Song]",
    })
  ).toBe("Waka Waka")
  expect(cleanTitle({ title: "If We Ever Meet Again (Featuring Katy Perry)" })).toBe("If We Ever Meet Again")
  // Un titre entierement parenthese ne doit pas disparaitre
  expect(cleanTitle({ title: "(I Can't Get No) Satisfaction", title_short: "(I Can't Get No) Satisfaction" })).toBe(
    "Satisfaction"
  )
})
