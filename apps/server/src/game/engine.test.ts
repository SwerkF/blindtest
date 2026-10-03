import { expect, test } from "bun:test"
import {
  GameMode,
  GamePhase,
  GuessMatch,
  Team,
  parseDeezerPlaylistId,
  teamTotals,
  winningTeam,
  type LobbySettings,
  type WsServerMessage,
} from "@blindmusic/shared"
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
  allowReaction,
  rooms,
  joinRefusal,
  JoinRefusal,
  setAccess,
  setTeam,
  shuffleTeams,
  getTeamScores,
  getEndSummary,
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

test("cleanTitle retire la mention A COLORS SHOW", () => {
  expect(cleanTitle({ title: "Gurenge - A COLORS SHOW" })).toBe("Gurenge")
  expect(cleanTitle({ title: "Bad Habits | A COLORS SHOW" })).toBe("Bad Habits")
  expect(cleanTitle({ title: "Idol (A COLORS SHOW)" })).toBe("Idol")
})

test("les points de la manche s'additionnent puis repartent a zero", async () => {
  const r = await room("RP1", ["a"])

  processGuess("RP1", "a", "Celine Dion")
  processGuess("RP1", "a", "2001")
  const player = rooms.get("RP1")!.players.get("a")!
  expect(player.roundPoints).toBe(7)
  expect(player.hasFoundYear).toBe(true)

  r.cleanup()
})

test("les reactions sont limitees contre le spam", async () => {
  const r = await room("RE1", ["a"])
  expect(allowReaction("RE1", "a")).toBe(true)
  expect(allowReaction("RE1", "a")).toBe(false)
  await Bun.sleep(420)
  expect(allowReaction("RE1", "a")).toBe(true)
  r.cleanup()
})

test("mot de passe et arrivee en cours de partie", async () => {
  const r = await room("AC1", ["a"])
  expect(joinRefusal("NOPE", undefined)).toBe(JoinRefusal.NotFound)
  // Partie en cours, retardataires acceptes par defaut
  expect(joinRefusal("AC1", undefined)).toBeNull()

  setAccess("AC1", " secret ", true)
  expect(joinRefusal("AC1", undefined)).toBe(JoinRefusal.WrongPassword)
  expect(joinRefusal("AC1", "faux")).toBe(JoinRefusal.WrongPassword)
  expect(joinRefusal("AC1", "secret")).toBeNull()

  setAccess("AC1", "", false)
  expect(joinRefusal("AC1", undefined)).toBe(JoinRefusal.InProgress)
  r.cleanup()
})

function teamsIn(code: string): Record<string, Team> {
  return Object.fromEntries([...rooms.get(code)!.players.values()].map((p) => [p.id, p.team]))
}

test("les nouveaux joueurs rejoignent l'equipe la plus petite", () => {
  createRoom("TM1", "a", "a", "a", () => {})
  addPlayer("TM1", "b", "b", "b", () => {})
  addPlayer("TM1", "c", "c", "c", () => {})
  expect(teamsIn("TM1")).toEqual({ a: Team.Blue, b: Team.Red, c: Team.Blue })

  // Bleu a deux joueurs, Rouge un seul : le suivant va chez les Rouges
  expect(setTeam("TM1", "c", Team.Red)).toBe(true)
  addPlayer("TM1", "d", "d", "d", () => {})
  expect(teamsIn("TM1").d).toBe(Team.Blue)
  ;["a", "b", "c", "d"].forEach((p) => removePlayer("TM1", p))
})

test("changer d'equipe passe par le serveur et est refuse en pleine manche", async () => {
  const inbox: WsServerMessage[] = []
  createRoom("TM2", "a", "a", "a", (m) => inbox.push(m))
  registerSocket("TM2", "a", (m) => inbox.push(m))
  expect(setTeam("TM2", "a", Team.Red)).toBe(true)
  const update = [...inbox].reverse().find((m) => m.type === "lobby:update")
  expect(update?.type === "lobby:update" && update.players[0].team).toBe(Team.Red)

  await startGame("TM2", { ...SETTINGS, teamMode: true }, [TRACK], { countdownMs: 0 })
  expect(setTeam("TM2", "a", Team.Blue)).toBe(false)
  expect(shuffleTeams("TM2")).toBe(false)
  expect(teamsIn("TM2").a).toBe(Team.Red)
  removePlayer("TM2", "a")
})

test("les equipes aleatoires sont equilibrees", () => {
  const ids = ["a", "b", "c", "d", "e"]
  createRoom("TM3", "a", "a", "a", () => {})
  for (const id of ids.slice(1)) addPlayer("TM3", id, id, id, () => {})
  ids.forEach((id) => setTeam("TM3", id, Team.Red))

  for (let round = 0; round < 20; round++) {
    expect(shuffleTeams("TM3")).toBe(true)
    const counts = Object.values(teamsIn("TM3")).reduce(
      (acc, team) => ({ ...acc, [team]: acc[team] + 1 }),
      { [Team.Blue]: 0, [Team.Red]: 0 }
    )
    expect(Math.abs(counts[Team.Blue] - counts[Team.Red])).toBeLessThanOrEqual(1)
  }
  ids.forEach((id) => removePlayer("TM3", id))
})

test("le score d'equipe est la somme des scores de ses membres", async () => {
  createRoom("TM4", "a", "a", "a", () => {})
  addPlayer("TM4", "b", "b", "b", () => {})
  addPlayer("TM4", "c", "c", "c", () => {})
  // a et c en Bleu, b en Rouge
  await startGame("TM4", { ...SETTINGS, teamMode: true }, [TRACK], { countdownMs: 0 })
  await Bun.sleep(5)

  processGuess("TM4", "a", "Céline Dion Sous le vent") // 20
  processGuess("TM4", "b", "Céline Dion Sous le vent") // 18
  processGuess("TM4", "c", "Céline Dion") // 5
  expect(getTeamScores("TM4")).toEqual({ [Team.Blue]: 25, [Team.Red]: 18 })
  ;["a", "b", "c"].forEach((p) => removePlayer("TM4", p))
})

test("un joueur qui quitte en cours de partie laisse ses points a son equipe", async () => {
  createRoom("TM5", "a", "a", "a", () => {})
  addPlayer("TM5", "b", "b", "b", () => {})
  await startGame("TM5", { ...SETTINGS, teamMode: true }, [TRACK], { countdownMs: 0 })
  await Bun.sleep(5)

  processGuess("TM5", "b", "Céline Dion Sous le vent")
  removePlayer("TM5", "b")
  expect(getTeamScores("TM5")).toEqual({ [Team.Blue]: 0, [Team.Red]: 20 })

  // La fin de partie annonce l'equipe gagnante, points des partants compris
  rooms.get("TM5")!.phase = GamePhase.End
  const end = getEndSummary("TM5")
  expect(end?.type === "game:end" && end.teamScores).toEqual({ [Team.Blue]: 0, [Team.Red]: 20 })
  expect(end?.type === "game:end" && end.teams).toEqual({ a: Team.Blue })

  // Une nouvelle partie repart de zero
  await startGame("TM5", { ...SETTINGS, teamMode: true }, [TRACK], { countdownMs: 0 })
  expect(getTeamScores("TM5")).toEqual({ [Team.Blue]: 0, [Team.Red]: 0 })
  removePlayer("TM5", "a")
})

test("sans mode equipe, la fin de partie ne parle pas d'equipes", async () => {
  createRoom("TM6", "a", "a", "a", () => {})
  await startGame("TM6", SETTINGS, [TRACK], { countdownMs: 0 })
  rooms.get("TM6")!.phase = GamePhase.End
  const end = getEndSummary("TM6")
  expect(end?.type === "game:end" && end.teamScores).toBeUndefined()
  removePlayer("TM6", "a")
})

test("teamTotals et winningTeam gerent l'egalite et une equipe vide", () => {
  const totals = teamTotals({ a: Team.Blue, b: Team.Blue }, { a: 10, b: 4 }, { [Team.Red]: 3 })
  expect(totals).toEqual({ [Team.Blue]: 14, [Team.Red]: 3 })
  expect(winningTeam(totals)).toBe(Team.Blue)
  expect(winningTeam({ [Team.Blue]: 7, [Team.Red]: 7 })).toBeNull()
  expect(winningTeam(teamTotals({}, {}))).toBeNull()
})
