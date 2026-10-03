import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  GameMode,
  GuessMatch,
  ThemeType,
  type LobbySettings,
  type WsServerMessage,
} from "@blindmusic/shared"
import { buildMatch, pickSong, streamAnimeTracks, type AtSong } from "@/anime"
import { acronymOf, animeNameVariants, coreTitle, expandAnswers, matchesAnswer } from "@/animeNames"
import type { Track } from "@/deezer"
import {
  createRoom,
  addPlayer,
  animePoints,
  appendTracks,
  finishTrackLoading,
  startGame,
  processGuess,
  registerSocket,
  removePlayer,
} from "@/game/engine"

// Shaped like AnimeThemes /search?fields[search]=songs&include[song]=animethemes.anime,artists
const GURENGE: AtSong = {
  id: 1,
  title: "Gurenge",
  artists: [{ name: "LiSA" }],
  animethemes: [
    {
      type: "OP",
      sequence: 1,
      slug: "OP1",
      anime: { id: 10, name: "Kimetsu no Yaiba", year: 2019, season: "Spring" },
    },
  ],
}

const HERO: AtSong = {
  id: 2,
  title: "Hero",
  artists: [{ name: "Someone Else" }],
  animethemes: [{ type: "ED", sequence: 2, slug: "ED2", anime: { id: 20, name: "Other", year: 2010, season: null } }],
}

function track(id: number, title: string, artist: string): Track {
  return { id, title, fullTitle: title, artist, year: 0, previewUrl: "https://example.test/p.mp3", coverUrl: null }
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test("pickSong garde le titre dont l'artiste correspond", () => {
  expect(pickSong([HERO, GURENGE], track(1, "Gurenge", "LiSA"))?.id).toBe(1)
})

test("pickSong accepte un titre long exact sans artiste (reprise), refuse un titre court", () => {
  expect(pickSong([GURENGE], track(1, "Gurenge", "Anime Cover Band"))?.id).toBe(1)
  expect(pickSong([HERO], track(2, "Hero", "Mariah Carey"))).toBeNull()
})

test("pickSong lit la fin des titres 'Anime - Chanson'", () => {
  expect(pickSong([GURENGE], track(1, "Demon Slayer - Gurenge", "LiSA"))?.id).toBe(1)
})

test("les variantes retirent saisons et sous-titres", () => {
  const variants = animeNameVariants("Shingeki no Kyojin Season 3 Part 2")
  expect(variants).toContain("Shingeki no Kyojin")
  expect(animeNameVariants("Kimetsu no Yaiba: Yuukaku-hen")).toContain("Kimetsu no Yaiba")
  // "Re" est trop court pour devenir une reponse
  expect(animeNameVariants("Re:Zero kara Hajimeru Isekai Seikatsu")).not.toContain("Re")
})

test("buildMatch reunit noms, synonymes, theme et pochette", () => {
  const details = new Map([
    [
      10,
      {
        id: 10,
        name: "Kimetsu no Yaiba",
        year: 2019,
        season: "Spring",
        animesynonyms: [{ text: "Demon Slayer" }],
        images: [{ facet: "Large Cover", link: "https://img.test/large.jpg" }],
      },
    ],
  ])
  const match = buildMatch(GURENGE, details)!
  expect(match.names).toContain("Demon Slayer")
  expect(match.reveal).toEqual({
    name: "Kimetsu no Yaiba",
    themes: [{ type: ThemeType.Opening, sequence: 1, slug: "OP1" }],
    year: 2019,
    season: "Spring",
    imageUrl: "https://img.test/large.jpg",
  })
})

test("les abreviations viennent des initiales", () => {
  expect(acronymOf("Shingeki no Kyojin")).toBe("snk")
  expect(acronymOf("My Hero Academia")).toBe("mha")
  expect(acronymOf("Naruto")).toBeNull()
})

test("buildMatch ajoute les titres AniList (anglais, francais) via la ressource externe", () => {
  const details = new Map([
    [10, { ...GURENGE.animethemes![0].anime!, resources: [{ site: "AniList", external_id: 101922 }] }],
  ])
  const aniList = new Map([[10, ["Demon Slayer: Kimetsu no Yaiba", "Les Rôdeurs de la nuit"]]])
  const match = buildMatch(GURENGE, details, aniList, "LiSA")!
  expect(match.names).toContain("Demon Slayer")
  expect(match.names).toContain("Les Rôdeurs de la nuit")
  expect(match.acronyms).toContain("kny")
  expect(match.artists).toEqual(["LiSA"])
})

function mockApis() {
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.hostname === "graphql.anilist.co") {
      const media = [{ id: 101922, seasonYear: 2019, title: { english: "Demon Slayer" }, synonyms: [] }]
      return Response.json({ data: { ids: { media: [] }, s0: { media } } })
    }
    if (url.pathname === "/search") {
      const songs = url.searchParams.get("q") === "Gurenge" ? [GURENGE] : []
      return Response.json({ search: { songs } })
    }
    return Response.json({
      anime: [{ ...GURENGE.animethemes![0].anime, resources: [{ site: "AniList", external_id: 101922 }] }],
    })
  }) as unknown as typeof fetch
}

test("streamAnimeTracks livre le premier titre seul puis ne garde que les pistes reconnues", async () => {
  mockApis()
  const pool = [
    track(201, "Pas un anime", "Quelqu'un"),
    track(202, "Gurenge", "LiSA"),
    track(203, "Autre chose", "Personne"),
  ]
  const batches: Track[][] = []
  await streamAnimeTracks(pool, 5, (tracks) => {
    batches.push(tracks)
    return true
  })
  expect(batches).toHaveLength(1)
  expect(batches[0]).toHaveLength(1)
  expect(batches[0][0].year).toBe(2019)
  expect(batches[0][0].anime?.names).toContain("Demon Slayer")
})

test("les points de l'anime baissent avec le temps", () => {
  expect(animePoints(0, 30_000)).toBe(20)
  expect(animePoints(15_000, 30_000)).toBe(13)
  expect(animePoints(30_000, 30_000)).toBe(5)
})

const SETTINGS: LobbySettings = {
  mode: GameMode.Anime,
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

const ANIME_TRACK: Track = {
  ...track(1, "Gurenge", "LiSA"),
  year: 2019,
  anime: buildMatch(GURENGE, new Map([[10, { ...GURENGE.animethemes![0].anime!, animesynonyms: [{ text: "Demon Slayer" }] }]]))!,
}

async function animeRoom(code: string, players: string[]) {
  const inbox: WsServerMessage[] = []
  const collect = (msg: WsServerMessage) => inbox.push(msg)
  createRoom(code, players[0], players[0], players[0], collect)
  for (const p of players.slice(1)) addPlayer(code, p, p, p, collect)
  for (const p of players) registerSocket(code, p, collect)
  await startGame(code, SETTINGS, [ANIME_TRACK], { countdownMs: 0 })
  await Bun.sleep(5)
  return { inbox, cleanup: () => players.forEach((p) => removePlayer(code, p)) }
}

test("mode anime : le titre ne rapporte rien, l'anime (nom, synonyme, abreviation) oui", async () => {
  const r = await animeRoom("A1", ["a", "b", "c"])

  expect(processGuess("A1", "a", "Gurenge")?.matched).toBe(GuessMatch.None)

  const found = processGuess("A1", "a", "kimetsu no yaiba")
  expect(found?.matched).toBe(GuessMatch.Anime)
  // Trouve des la premiere seconde : quasi le maximum
  expect(found?.pointsEarned).toBeGreaterThanOrEqual(19)
  expect(found?.revealedAnime).toBe("Kimetsu no Yaiba")

  expect(processGuess("A1", "b", "demon slayer")?.matched).toBe(GuessMatch.Anime)
  expect(processGuess("A1", "c", "KNY")?.matched).toBe(GuessMatch.Anime)

  r.cleanup()
})

test("mode anime : l'auteur est un bonus, seul ou avec l'anime", async () => {
  const r = await animeRoom("A2", ["a", "b"])

  const artist = processGuess("A2", "a", "Lisa")
  expect(artist?.matched).toBe(GuessMatch.Artist)
  expect(artist?.pointsEarned).toBe(5)
  expect(processGuess("A2", "a", "lisa")?.pointsEarned).toBe(0)

  expect(processGuess("A2", "b", "Demon Slayer LiSA")?.matched).toBe(GuessMatch.AnimeAndArtist)

  r.cleanup()
})

test("mode anime : la manche finit quand tout le monde a l'anime, l'auteur et l'annee", async () => {
  const r = await animeRoom("A3", ["a"])

  processGuess("A3", "a", "Demon Slayer")
  expect(r.inbox.some((m) => m.type === "round:reveal")).toBe(false)

  processGuess("A3", "a", "LiSA")
  // L'annee reste jouable une fois l'anime et l'auteur trouves
  expect(r.inbox.some((m) => m.type === "round:reveal")).toBe(false)

  expect(processGuess("A3", "a", "2019")?.matched).toBe(GuessMatch.Year)
  const reveal = r.inbox.find((m) => m.type === "round:reveal")
  expect(reveal?.type === "round:reveal" && reveal.anime?.name).toBe("Kimetsu no Yaiba")

  r.cleanup()
})

test("chargement progressif : la partie attend le titre suivant puis se termine", async () => {
  const inbox: WsServerMessage[] = []
  const collect = (msg: WsServerMessage) => inbox.push(msg)
  createRoom("A4", "a", "a", "a", collect)
  registerSocket("A4", "a", collect)
  const gameId = await startGame("A4", { ...SETTINGS, trackCount: 2 }, [ANIME_TRACK], {
    countdownMs: 0,
    loadingMore: true,
  })
  await Bun.sleep(5)
  const first = inbox.find((m) => m.type === "round:start")
  expect(first?.type === "round:start" && first.round.total).toBe(2)

  processGuess("A4", "a", "Demon Slayer LiSA")
  processGuess("A4", "a", "2019")
  await Bun.sleep(5100)
  // Revelation finie mais rien de charge : on attend sans terminer
  expect(inbox.some((m) => m.type === "game:end")).toBe(false)

  expect(appendTracks("A4", gameId!, [{ ...ANIME_TRACK, id: 2 }])).toBe(false)
  const second = inbox.filter((m) => m.type === "round:start")
  expect(second).toHaveLength(2)

  finishTrackLoading("A4", gameId!)
  removePlayer("A4", "a")
}, 10_000)

test("les titres de saison se ramenent au nom de la serie", () => {
  expect(coreTitle("Shingeki no Kyojin: The Final Season Part 2")).toBe("Shingeki no Kyojin")
  expect(coreTitle("Attack on Titan Final Season Part 2")).toBe("Attack on Titan")
  expect(coreTitle("Boku no Hero Academia 2nd Season")).toBe("Boku no Hero Academia")
  expect(coreTitle("JoJo no Kimyou na Bouken Part 4: Diamond wa Kudakenai")).toBe("JoJo no Kimyou na Bouken")
  expect(coreTitle("Overlord III")).toBe("Overlord")
})

describe("reponses acceptees, sur les cas remontes en jeu", () => {
  // Ce que renvoient AnimeThemes + AniList pour chaque anime
  const cases: { titles: string[]; accepted: string[]; refused: string[] }[] = [
    {
      titles: ["Shingeki no Kyojin: The Final Season Part 2", "Attack on Titan Final Season Part 2"],
      accepted: ["snk", "SNK", "aot", "attack on titan", "attaque des titans", "l'attaque des titants", "shingeki no kyojin"],
      refused: ["one piece", "titan"],
    },
    {
      titles: ["Kimetsu no Yaiba"],
      accepted: ["demon slayer", "Demon Slayer", "DS", "kimetsu no yaiba", "kimetsu", "kny"],
      refused: ["jujutsu kaisen"],
    },
    {
      titles: ["Boku no Hero Academia 2nd Season"],
      accepted: ["my hero academia", "MHA", "bnha", "boku no hero academia", "boku no hero"],
      refused: ["hero"],
    },
    {
      titles: ["Ano Hi Mita Hana no Namae wo Bokutachi wa Mada Shiranai."],
      accepted: ["anohana", "ano hana"],
      refused: ["hana", "bokutachi"],
    },
    {
      titles: ["JoJo no Kimyou na Bouken Part 4: Diamond wa Kudakenai"],
      accepted: ["jojo", "jojo's bizarre adventure", "jojo no kimyou na bouken", "diamond is unbreakable"],
      refused: ["dio"],
    },
  ]
  for (const c of cases) {
    test(c.titles[0], () => {
      const answers = expandAnswers(c.titles)
      // "Diamond is Unbreakable" comes from the AniList English title
      const extra = c.titles[0].startsWith("JoJo")
        ? expandAnswers([...c.titles, "JoJo's Bizarre Adventure: Diamond is Unbreakable"])
        : answers
      for (const guess of c.accepted) {
        const ok = matchesAnswer(guess, extra, 20)
        expect({ guess, ok }).toEqual({ guess, ok: true })
      }
      for (const guess of c.refused) expect({ guess, ok: matchesAnswer(guess, extra, 20) }).toEqual({ guess, ok: false })
    })
  }
})

test("sans AniList, les classiques gardent leurs noms anglais, francais et abreviations", () => {
  const answers = expandAnswers(["Shingeki no Kyojin: The Final Season Part 2"])
  for (const guess of ["aot", "attack on titan", "attaque des titans", "snk"]) {
    expect({ guess, ok: matchesAnswer(guess, answers, 20) }).toEqual({ guess, ok: true })
  }
})
