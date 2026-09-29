import { afterEach, expect, mock, test } from "bun:test"
import {
  GameMode,
  GuessMatch,
  ThemeType,
  type LobbySettings,
  type WsServerMessage,
} from "@blindmusic/shared"
import { animeNameVariants, buildMatch, pickAnimeTracks, pickSong, type AtSong } from "@/anime"
import type { Track } from "@/deezer"
import { createRoom, addPlayer, startGame, processGuess, registerSocket, removePlayer } from "@/game/engine"

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

test("pickAnimeTracks ne garde que les pistes reconnues et prend l'annee de l'anime", async () => {
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname === "/search") {
      const songs = url.searchParams.get("q") === "Gurenge" ? [GURENGE] : []
      return Response.json({ search: { songs } })
    }
    return Response.json({ anime: [{ ...GURENGE.animethemes![0].anime, animesynonyms: [{ text: "Demon Slayer" }] }] })
  }) as unknown as typeof fetch

  const pool = [track(101, "Pas un anime", "Quelqu'un"), track(102, "Gurenge", "LiSA")]
  const tracks = await pickAnimeTracks(pool, 5)
  expect(tracks).toHaveLength(1)
  expect(tracks[0].year).toBe(2019)
  expect(tracks[0].anime?.names).toContain("Demon Slayer")
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
  await startGame(code, SETTINGS, [ANIME_TRACK], 0)
  await Bun.sleep(5)
  return { inbox, cleanup: () => players.forEach((p) => removePlayer(code, p)) }
}

test("mode anime : le titre ou l'artiste ne rapportent rien, l'anime rapporte le combo", async () => {
  const r = await animeRoom("A1", ["a", "b"])

  expect(processGuess("A1", "a", "LiSA")?.matched).toBe(GuessMatch.None)
  expect(processGuess("A1", "a", "Gurenge")?.matched).toBe(GuessMatch.None)

  const found = processGuess("A1", "a", "kimetsu no yaiba")
  expect(found?.matched).toBe(GuessMatch.Anime)
  expect(found?.pointsEarned).toBe(20)
  expect(found?.revealedAnime).toBe("Kimetsu no Yaiba")

  // Le synonyme anglais marche aussi, avec la decroissance du combo
  expect(processGuess("A1", "b", "demon slayer")?.pointsEarned).toBe(18)

  r.cleanup()
})

test("mode anime : le numero d'opening est un bonus a essais limites", async () => {
  const r = await animeRoom("A2", ["a", "b"])

  const wrong = processGuess("A2", "a", "ED1")
  expect(wrong?.matched).toBe(GuessMatch.ThemeWrong)
  expect(wrong?.themeGuessesLeft).toBe(1)

  const right = processGuess("A2", "a", "opening 1")
  expect(right?.matched).toBe(GuessMatch.Theme)
  expect(right?.pointsEarned).toBe(3)

  expect(processGuess("A2", "a", "op1")?.matched).toBe(GuessMatch.ThemeAlreadyFound)

  r.cleanup()
})

test("mode anime : la manche continue tant que le bonus d'opening reste jouable", async () => {
  const r = await animeRoom("A3", ["a"])

  processGuess("A3", "a", "Demon Slayer")
  expect(r.inbox.some((m) => m.type === "round:reveal")).toBe(false)

  processGuess("A3", "a", "OP1")
  const reveal = r.inbox.find((m) => m.type === "round:reveal")
  expect(reveal?.type === "round:reveal" && reveal.anime?.name).toBe("Kimetsu no Yaiba")

  r.cleanup()
})
