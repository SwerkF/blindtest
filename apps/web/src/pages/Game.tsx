import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import {
  ChatCircle,
  Trophy,
  MusicNotes,
  PaperPlaneRight,
  CheckCircle,
  XCircle,
  Calendar,
  Lightbulb,
  TrendUp,
  ArrowCounterClockwise,
  Microphone,
  Television,
  Hash,
} from "@phosphor-icons/react"
import type {
  AnimeReveal,
  LobbySettings,
  PlayedTrack,
  PlayerPublic,
  RoundOutcome,
  RoundPublic,
  WsServerMessage,
} from "@blindmusic/shared"
import { GameMode, GamePhase, GuessMatch, HintKind, themeLabel } from "@blindmusic/shared"
import { useWs } from "@/hooks/useWs"
import { useProfile } from "@/hooks/useProfile"
import { loadSession } from "@/utils/api"
import { appendHistory } from "@/utils/storage"
import { Cue, playCue } from "@/utils/audio"
import Visualizer from "@/components/Visualizer"
import Avatar from "@/components/Avatar"
import AvatarEditor from "@/components/AvatarEditor"
import ThemeToggle from "@/components/ThemeToggle"

interface ChatMsg {
  id: number
  playerId: string
  playerName: string
  text: string
  at: number
}

interface GuessEntry {
  id: number
  text: string
  matched: GuessMatch
  points: number
}

interface RevealState {
  artist: string
  title: string
  year: number
  coverUrl: string | null
  lyrics: string | null
  anime: AnimeReveal | null
  nextAt: number
  isLast: boolean
}

interface EndState {
  scores: Record<string, number>
  playerNames: Record<string, string>
  tracks: PlayedTrack[]
}

const MATCH_LABEL: Record<GuessMatch, string> = {
  [GuessMatch.None]: "Non trouvé",
  [GuessMatch.Close]: "Tout proche",
  [GuessMatch.Artist]: "Artiste trouvé",
  [GuessMatch.Title]: "Titre trouvé",
  [GuessMatch.Both]: "Artiste + titre",
  [GuessMatch.Year]: "Bonne année",
  [GuessMatch.YearWrong]: "Mauvaise année",
  [GuessMatch.YearExhausted]: "Plus d'essais pour l'année",
  [GuessMatch.YearAlreadyFound]: "Année déjà trouvée",
  [GuessMatch.Anime]: "Animé trouvé",
  [GuessMatch.Theme]: "Bon générique",
  [GuessMatch.ThemeWrong]: "Mauvais générique",
  [GuessMatch.ThemeExhausted]: "Plus d'essais pour le générique",
  [GuessMatch.ThemeAlreadyFound]: "Générique déjà trouvé",
}

/** "Opening 1 · Printemps 2019" style caption under an anime name. */
function animeCaption(anime: AnimeReveal): string {
  const themes = anime.themes.map(themeLabel).join(" / ")
  return [themes, anime.year].filter(Boolean).join(" · ")
}

function secondsUntil(target: number, now: number): number {
  return Math.max(0, Math.ceil((target - now) / 1000))
}

function GuessIcon({ matched }: { matched: GuessMatch }) {
  switch (matched) {
    case GuessMatch.None:
    case GuessMatch.YearWrong:
    case GuessMatch.YearExhausted:
    case GuessMatch.YearAlreadyFound:
    case GuessMatch.ThemeWrong:
    case GuessMatch.ThemeExhausted:
    case GuessMatch.ThemeAlreadyFound:
      return <XCircle size={16} className="text-muted shrink-0" />
    case GuessMatch.Close:
      return <TrendUp size={16} weight="bold" className="text-amber-500 shrink-0" />
    case GuessMatch.Year:
      return <Calendar size={16} weight="fill" className="text-accent shrink-0" />
    case GuessMatch.Theme:
      return <Hash size={16} weight="bold" className="text-accent shrink-0" />
    case GuessMatch.Anime:
    case GuessMatch.Artist:
    case GuessMatch.Title:
    case GuessMatch.Both:
      return <CheckCircle size={16} weight="fill" className="text-accent shrink-0" />
    default: {
      const exhaustive: never = matched
      return exhaustive
    }
  }
}

/** Colour-codes how well a finished round went. */
function outcomeStyle(o: RoundOutcome | undefined, anime = false) {
  if (!o) return { cls: "bg-edge/60 text-transparent", label: "À venir", glyph: "" }
  const both = o.artist && o.title
  if (anime) {
    if (both && (o.theme || o.year)) return { cls: "bg-blue-500 text-white", label: "Animé + bonus", glyph: "✓" }
    if (both) return { cls: "bg-green-500 text-white", label: "Animé trouvé", glyph: "✓" }
    return { cls: "bg-red-400/80 text-white", label: "Rien trouvé", glyph: "✕" }
  }
  if (both && o.year) return { cls: "bg-blue-500 text-white", label: "Tout trouvé", glyph: "✓" }
  if (both) return { cls: "bg-green-500 text-white", label: "Artiste + titre", glyph: "✓" }
  if (o.artist || o.title) return { cls: "bg-lime-400 text-lime-950", label: "Moitié", glyph: "~" }
  return { cls: "bg-red-400/80 text-white", label: "Rien trouvé", glyph: "✕" }
}

function TrackScore({ outcome, anime }: { outcome: RoundOutcome | undefined; anime: boolean }) {
  const s = outcomeStyle(outcome, anime)
  return (
    <span
      title={s.label}
      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0 ${s.cls}`}
    >
      {s.glyph}
    </span>
  )
}

export default function Game() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const session = loadSession(code!)
  const { send, onMessage, connected } = useWs(code ?? "", session?.playerId ?? "")
  const { profile, setAvatar } = useProfile()
  const [editingAvatar, setEditingAvatar] = useState(false)

  const [phase, setPhase] = useState<GamePhase>(GamePhase.Playing)
  const [settings, setSettings] = useState<LobbySettings | null>(null)
  const [players, setPlayers] = useState<PlayerPublic[]>([])
  const [scores, setScores] = useState<Record<string, number>>({})
  const [outcomes, setOutcomes] = useState<Record<string, RoundOutcome[]>>({})
  const [round, setRound] = useState<RoundPublic | null>(null)
  const [seekTo, setSeekTo] = useState(0)
  const [reveal, setReveal] = useState<RevealState | null>(null)
  const [hints, setHints] = useState<Partial<Record<HintKind, string>>>({})
  const [foundBy, setFoundBy] = useState<string | null>(null)
  const [myFind, setMyFind] = useState<string | null>(null)
  const [countdownTo, setCountdownTo] = useState<number | null>(null)
  const [guesses, setGuesses] = useState<GuessEntry[]>([])
  const [chat, setChat] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState("")
  const [guessInput, setGuessInput] = useState("")
  const [yearGuessesLeft, setYearGuessesLeft] = useState(0)
  const [themeGuessesLeft, setThemeGuessesLeft] = useState(0)
  const [hasFoundTheme, setHasFoundTheme] = useState(false)
  const [endState, setEndState] = useState<EndState | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const chatEndRef = useRef<HTMLDivElement>(null)
  const guessInputRef = useRef<HTMLInputElement>(null)
  const idRef = useRef(0)
  const settingsRef = useRef<LobbySettings | null>(null)
  const historySaved = useRef(false)
  /** Only games followed live end up in the history, not a recap seen after a refresh. */
  const playedLive = useRef(false)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chat])

  useEffect(() => {
    return onMessage((msg: WsServerMessage) => {
      switch (msg.type) {
        case "lobby:update":
          setPlayers(msg.players)
          setScores(Object.fromEntries(msg.players.map((p) => [p.id, p.score])))
          if (msg.settings) {
            settingsRef.current = msg.settings
            setSettings(msg.settings)
          }
          // Nothing has started in this room yet
          if (msg.phase === GamePhase.Lobby) navigate(`/lobby/${code}`)
          break

        case "game:start":
          setCountdownTo(msg.startsAt)
          setEndState(null)
          setOutcomes({})
          setScores({})
          setReveal(null)
          setRound(null)
          setPhase(GamePhase.Playing)
          historySaved.current = false
          playCue(Cue.Countdown)
          break

        case "round:start":
          setRound(msg.round)
          setSeekTo(Math.max(0, (Date.now() - msg.round.startedAt) / 1000))
          setCountdownTo(null)
          setReveal(null)
          setHints({})
          playedLive.current = true
          setFoundBy(null)
          setMyFind(null)
          setGuesses([])
          setGuessInput("")
          setPhase(GamePhase.Playing)
          setYearGuessesLeft(settingsRef.current?.yearGuessAttempts ?? 0)
          setThemeGuessesLeft(settingsRef.current?.yearGuessAttempts ?? 0)
          setHasFoundTheme(false)
          // Clear the per-round found markers; the server already reset them
          setPlayers((prev) =>
            prev.map((p) => ({ ...p, hasFoundArtist: false, hasFoundTitle: false, hasFoundBoth: false }))
          )
          break

        case "round:hint":
          setHints((prev) => ({ ...prev, [msg.kind]: msg.hint }))
          break

        case "guess:result":
          setScores(msg.scores)
          setPlayers((prev) =>
            prev.map((p) =>
              p.id === msg.playerId
                ? {
                    ...p,
                    score: msg.scores[p.id] ?? p.score,
                    hasFoundArtist:
                      p.hasFoundArtist ||
                      msg.matched === GuessMatch.Artist ||
                      msg.matched === GuessMatch.Both ||
                      msg.matched === GuessMatch.Anime,
                    hasFoundTitle:
                      p.hasFoundTitle ||
                      msg.matched === GuessMatch.Title ||
                      msg.matched === GuessMatch.Both ||
                      msg.matched === GuessMatch.Anime,
                  }
                : p
            )
          )

          if (msg.playerId === session?.playerId && msg.text !== undefined) {
            setYearGuessesLeft(msg.yearGuessesLeft)
            setThemeGuessesLeft(msg.themeGuessesLeft)
            if (msg.matched === GuessMatch.Theme) setHasFoundTheme(true)
            setGuesses((prev) => [
              ...prev,
              { id: idRef.current++, text: msg.text!, matched: msg.matched, points: msg.pointsEarned },
            ])
            // Only we get the answer echoed back
            if (msg.revealedAnime) setMyFind(msg.revealedAnime)
            else if (msg.revealedArtist && msg.revealedTitle) {
              setMyFind(`${msg.revealedTitle} — ${msg.revealedArtist}`)
            }
            if (msg.firstBoth || msg.matched === GuessMatch.Both || msg.matched === GuessMatch.Anime) {
              playCue(Cue.Complete)
            }
            else if (msg.pointsEarned > 0) playCue(Cue.Match)
            else playCue(Cue.Miss)
          } else if (msg.firstBoth) {
            setFoundBy(msg.playerName)
            playCue(Cue.Rival)
          }
          break

        case "round:reveal":
          setReveal({
            artist: msg.artist,
            title: msg.title,
            year: msg.year,
            coverUrl: msg.coverUrl,
            lyrics: msg.lyrics,
            anime: msg.anime,
            nextAt: msg.nextAt,
            isLast: msg.isLast,
          })
          setScores(msg.scores)
          setOutcomes(msg.outcomes)
          setPhase(GamePhase.Reveal)
          break

        case "chat:message":
          setChat((prev) => [...prev, { id: idRef.current++, ...msg }])
          break

        case "game:end":
          setEndState({ scores: msg.scores, playerNames: msg.playerNames, tracks: msg.tracks })
          setOutcomes(msg.outcomes)
          setScores(msg.scores)
          setPhase(GamePhase.End)
          if (!historySaved.current && playedLive.current && session && code) {
            historySaved.current = true
            const ranking = Object.entries(msg.scores).sort((a, b) => b[1] - a[1])
            const place = ranking.findIndex(([id]) => id === session.playerId) + 1
            appendHistory({
              playedAt: Date.now(),
              code,
              rank: place > 0 ? place : ranking.length,
              score: msg.scores[session.playerId] ?? 0,
              playerCount: ranking.length,
              tracks: msg.tracks.map((track) => ({
                title: track.anime?.name ?? track.title,
                artist: track.anime ? `${track.title} — ${track.artist}` : track.artist,
                year: track.year,
              })),
            })
          }
          break

        default:
          break
      }
    })
  }, [onMessage, session?.playerId, navigate, code])

  const roundEndsAt = round ? round.startedAt + round.duration : 0
  const secondsLeft = phase === GamePhase.Playing && round ? secondsUntil(roundEndsAt, now) : 0
  const timerPct =
    phase === GamePhase.Playing && round
      ? Math.max(0, Math.min(100, ((roundEndsAt - now) / round.duration) * 100))
      : 0
  const countdownLeft = countdownTo ? secondsUntil(countdownTo, now) : 0
  const revealLeft = reveal ? secondsUntil(reveal.nextAt, now) : 0
  const isCountdown = countdownTo !== null && countdownLeft > 0
  const canGuess = phase === GamePhase.Playing && !isCountdown && round !== null

  const me = players.find((p) => p.id === session?.playerId)
  const isAnime = settings?.mode === GameMode.Anime
  const myOutcomes = session ? (outcomes[session.playerId] ?? []) : []
  const totalRounds = endState?.tracks.length ?? round?.total ?? 0

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0)),
    [players, scores]
  )

  useEffect(() => {
    if (canGuess) guessInputRef.current?.focus()
  }, [canGuess])

  function saveAvatar(avatarSeed: string) {
    setAvatar(avatarSeed)
    setEditingAvatar(false)
    setPlayers((prev) => prev.map((p) => (p.id === session?.playerId ? { ...p, avatarSeed } : p)))
    send({ type: "player:avatar", avatarSeed })
  }

  /** Only this player heads back; the others stay on the recap until the host relaunches. */
  function backToLobby() {
    navigate(`/lobby/${code}`)
  }

  function submitGuess() {
    const text = guessInput.trim()
    if (!canGuess || !text) return
    send({ type: "guess", text })
    setGuessInput("")
  }

  function submitChat() {
    if (!chatInput.trim()) return
    send({ type: "chat", text: chatInput.trim() })
    setChatInput("")
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <p className="text-muted animate-fade">
          Session expirée.{" "}
          <a href="/" className="text-accent hover:underline">
            Retour à l'accueil
          </a>
        </p>
      </div>
    )
  }

  const ranking = endState ? Object.entries(endState.scores).sort((a, b) => b[1] - a[1]) : []

  return (
    <div className="h-screen bg-canvas grid grid-cols-[240px_1fr_260px] overflow-hidden">
      {/* Joueurs */}
      <aside className="bg-surface border-r border-edge flex flex-col overflow-hidden">
        <div className="p-4 border-b border-edge flex items-center justify-between">
          <h3 className="font-bold text-ink text-sm uppercase tracking-wider">Joueurs</h3>
          <ThemeToggle />
        </div>
        <ul className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {sortedPlayers.map((p, i) => (
            <li
              key={p.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 animate-rise hover:brightness-105 ${
                p.id === session.playerId ? "bg-accent/10 border border-accent/20" : "bg-edge/40"
              } ${p.connected ? "" : "opacity-40"}`}
            >
              <span className="text-xs text-muted font-mono w-4 text-center">{i + 1}</span>
              <Avatar
                name={p.avatarSeed || p.name}
                size={48}
                onEdit={p.id === session.playerId ? () => setEditingAvatar(true) : undefined}
              />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink text-sm truncate">{p.name}</p>
                <div className="flex gap-1 mt-1">
                  {isAnime ? (
                    <span
                      className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                        p.hasFoundBoth ? "bg-accent" : "bg-edge"
                      }`}
                      title="Animé"
                    />
                  ) : (
                    <>
                      <span
                        className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                          p.hasFoundArtist ? "bg-accent" : "bg-edge"
                        }`}
                        title="Artiste"
                      />
                      <span
                        className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                          p.hasFoundTitle ? "bg-accent" : "bg-edge"
                        }`}
                        title="Titre"
                      />
                    </>
                  )}
                </div>
              </div>
              <span className="font-bold text-ink text-lg tabular-nums">{scores[p.id] ?? 0}</span>
            </li>
          ))}
        </ul>
        {round && phase !== GamePhase.End && (
          <div className="p-3 border-t border-edge text-center">
            <p className="text-xs text-muted">
              Manche {round.trackIndex} / {round.total}
            </p>
          </div>
        )}
      </aside>

      {/* Centre */}
      <main className="flex flex-col overflow-hidden relative">
        {!connected && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 text-xs text-muted bg-surface/90 backdrop-blur px-3 py-1.5 rounded-full border border-edge animate-fade">
            <span className="w-2 h-2 rounded-full bg-muted animate-pulse" />
            Reconnexion…
          </div>
        )}

        {phase === GamePhase.End && endState ? (
          /* ── Fin de partie ── */
          <div className="flex-1 overflow-y-auto p-6 animate-fade">
            <div className="flex flex-col items-center mb-8">
              <Trophy size={44} weight="duotone" className="text-accent mb-3 animate-pop" />
              <h2 className="text-3xl font-black text-ink">Partie terminée</h2>
            </div>

            <div className="max-w-md mx-auto flex flex-col gap-2 mb-10">
              {ranking.map(([id, score], i) => (
                <div
                  key={id}
                  style={{ animationDelay: `${i * 60}ms` }}
                  className={`flex items-center gap-4 px-5 py-3.5 rounded-xl animate-rise ${
                    i === 0 ? "bg-inverse text-inverse-ink" : "bg-surface border border-edge text-ink"
                  }`}
                >
                  <span className="text-xl font-black w-7">{i + 1}</span>
                  <Avatar name={players.find((p) => p.id === id)?.avatarSeed || endState.playerNames[id] || id} size={48} />
                  <span className="font-semibold flex-1 truncate">{endState.playerNames[id]}</span>
                  <span className="font-bold text-lg tabular-nums">{score}</span>
                </div>
              ))}
            </div>

            <h3 className="text-sm font-bold text-ink uppercase tracking-wider mb-3">
              {isAnime ? `Les ${endState.tracks.length} génériques joués` : `Les ${endState.tracks.length} musiques jouées`}
            </h3>
            <div className="flex flex-col gap-2 mb-8">
              {endState.tracks.map((t, i) => (
                <div
                  key={`${t.title}-${i}`}
                  style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
                  className="flex items-center gap-3 p-2 rounded-xl bg-surface border border-edge animate-rise transition-colors hover:border-muted"
                >
                  <span className="text-xs text-muted font-mono w-6 text-center shrink-0">{i + 1}</span>
                  {(t.anime?.imageUrl ?? t.coverUrl) ? (
                    <img
                      src={t.anime?.imageUrl ?? t.coverUrl ?? ""}
                      alt=""
                      className="w-10 h-10 rounded-lg object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-edge flex items-center justify-center shrink-0">
                      <MusicNotes size={16} className="text-muted" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    {t.anime ? (
                      <>
                        <p className="font-semibold text-ink text-sm truncate">{t.anime.name}</p>
                        <p className="text-xs text-muted truncate">
                          {animeCaption(t.anime)} · {t.title} — {t.artist}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-semibold text-ink text-sm truncate">{t.title}</p>
                        <p className="text-xs text-muted truncate">
                          {t.artist}
                          {t.year ? ` · ${t.year}` : ""}
                        </p>
                      </>
                    )}
                  </div>
                  <TrackScore outcome={myOutcomes[i]} anime={isAnime} />
                </div>
              ))}
            </div>

            <div className="flex justify-center pb-4">
              <button
                type="button"
                onClick={backToLobby}
                className="flex items-center gap-2 bg-inverse text-inverse-ink px-6 py-3 rounded-xl font-semibold hover:opacity-90 hover:scale-[1.02] active:scale-100 transition-all"
              >
                <ArrowCounterClockwise size={18} weight="bold" />
                Retour au lobby
              </button>
            </div>
          </div>
        ) : (
          /* ── Partie en cours ── */
          <>
            <div className="px-6 pt-4 flex flex-col gap-2">
              {/* Pastilles de progression */}
              {totalRounds > 0 && (
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {Array.from({ length: totalRounds }, (_, i) => {
                    const isCurrent = round ? i === round.trackIndex - 1 : false
                    const done = myOutcomes[i]
                    const s = outcomeStyle(done, isAnime)
                    return (
                      <span
                        key={i}
                        title={`Manche ${i + 1} — ${s.label}`}
                        className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold transition-all duration-300 ${
                          done ? `${s.cls} animate-pop` : "bg-edge/60 text-transparent"
                        } ${isCurrent && !done ? "ring-2 ring-accent ring-offset-1 ring-offset-transparent" : ""}`}
                      >
                        {s.glyph}
                      </span>
                    )
                  })}
                </div>
              )}

              <div className="flex items-center justify-between h-7">
                <span className="text-xs text-muted uppercase tracking-widest">
                  {isCountdown
                    ? "Préparez-vous"
                    : phase === GamePhase.Reveal
                      ? "Résultat"
                      : round
                        ? "À vous de jouer"
                        : "Tu rejoins en cours, prochaine manche…"}
                </span>
                {phase === GamePhase.Playing && !isCountdown && (
                  <span
                    className={`font-black tabular-nums text-2xl transition-colors ${
                      secondsLeft <= 5 ? "text-red-500" : "text-ink"
                    }`}
                  >
                    {secondsLeft}s
                  </span>
                )}
                {phase === GamePhase.Reveal && reveal && (
                  <span className="text-sm text-muted tabular-nums">
                    {reveal.isLast ? "Scores finaux…" : `Suivante dans ${revealLeft}s`}
                  </span>
                )}
              </div>

              <div className="h-24 shrink-0 relative">
                <Visualizer previewUrl={round?.previewUrl ?? null} isPlaying={canGuess} seekTo={seekTo} />
                {isCountdown && (
                  <div className="absolute inset-0 flex items-center justify-center bg-pitch/85 backdrop-blur-sm rounded-xl gap-4 animate-fade">
                    <span className="text-khaki text-xs uppercase tracking-widest">Départ dans</span>
                    <span className="text-toffee text-4xl font-black tabular-nums leading-none animate-pop">
                      {countdownLeft}
                    </span>
                  </div>
                )}
              </div>

              <div className="h-1.5 bg-edge rounded-full overflow-hidden shrink-0">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-200"
                  style={{ width: `${timerPct}%` }}
                />
              </div>
            </div>

            <div className="flex-1 min-h-0 px-6 py-4 flex flex-col">
              {reveal ? (
                <div className="flex-1 min-h-0 flex items-center justify-center gap-6 animate-fade">
                  {(reveal.anime?.imageUrl ?? reveal.coverUrl) ? (
                    <img
                      src={reveal.anime?.imageUrl ?? reveal.coverUrl ?? ""}
                      alt=""
                      className="w-40 h-40 rounded-2xl object-cover shadow-lg shrink-0 animate-pop"
                    />
                  ) : (
                    <div className="w-40 h-40 rounded-2xl bg-edge flex items-center justify-center shrink-0">
                      <MusicNotes size={40} weight="duotone" className="text-muted" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 max-w-md animate-rise">
                    {reveal.anime ? (
                      <>
                        <p className="font-black text-3xl text-ink leading-tight">{reveal.anime.name}</p>
                        <p className="text-accent font-semibold mt-1">{animeCaption(reveal.anime)}</p>
                        <p className="text-muted text-sm mt-1">
                          {reveal.title} — {reveal.artist}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-black text-3xl text-ink leading-tight">{reveal.title}</p>
                        <p className="text-muted text-lg mt-1">{reveal.artist}</p>
                        {reveal.year ? <p className="text-muted/70 text-sm mt-0.5">{reveal.year}</p> : null}
                      </>
                    )}
                    {reveal.lyrics && (
                      <pre className="mt-3 max-h-28 overflow-y-auto whitespace-pre-wrap font-sans text-xs text-muted leading-relaxed border-l-2 border-edge pl-3">
                        {reveal.lyrics}
                      </pre>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {/* Ce que nous avons trouvé : visible par nous seuls */}
                  {myFind && (
                    <div className="mb-3 rounded-xl bg-accent/10 border border-accent/25 px-4 py-3 text-center shrink-0 animate-pop">
                      <p className="text-accent text-xs font-semibold uppercase tracking-widest">Trouvé</p>
                      <p className="font-bold text-ink mt-1">{myFind}</p>
                    </div>
                  )}

                  {/* Un adversaire a trouvé : pas de titre, sinon on spoile */}
                  {!myFind && foundBy && (
                    <div className="mb-3 rounded-xl bg-edge/50 border border-edge px-4 py-2.5 text-center shrink-0 animate-rise">
                      <p className="text-sm text-muted">
                        <span className="font-semibold text-ink">{foundBy}</span>{" "}
                        {isAnime ? "a trouvé l'animé" : "a trouvé artiste + titre"}
                      </p>
                    </div>
                  )}

                  <div className="flex-1 overflow-y-auto min-h-0">
                    {guesses.length === 0 && !myFind && !foundBy ? (
                      <div className="h-full flex flex-col items-center justify-center text-center animate-fade">
                        {isAnime ? (
                          <>
                            <p className="text-muted text-sm">De quel animé vient ce générique ?</p>
                            <p className="text-muted/70 text-xs mt-1">
                              Bonus : « OP2 », « ED1 » pour le numéro, ou l'année de diffusion.
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-muted text-sm">
                              Écris l'artiste, le titre ou l'année dans le champ ci-dessous.
                            </p>
                            <p className="text-muted/70 text-xs mt-1">Les deux dans le même message comptent aussi.</p>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 auto-rows-min">
                        {guesses.map((g) => {
                          const hit = g.points > 0
                          const warm = g.matched === GuessMatch.Close
                          return (
                            <div
                              key={g.id}
                              className={`flex flex-col gap-1 px-3 py-2.5 rounded-xl border animate-pop transition-colors ${
                                hit
                                  ? "bg-accent/10 border-accent/25"
                                  : warm
                                    ? "bg-amber-400/10 border-amber-400/40"
                                    : "bg-edge/30 border-edge"
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <GuessIcon matched={g.matched} />
                                <span
                                  className={`flex-1 truncate text-sm ${
                                    hit ? "text-ink font-semibold" : warm ? "text-ink" : "text-muted"
                                  }`}
                                >
                                  {g.text}
                                </span>
                                {g.points > 0 && (
                                  <span className="text-sm font-bold text-accent tabular-nums shrink-0">
                                    +{g.points}
                                  </span>
                                )}
                              </div>
                              <span
                                className={`text-xs truncate ${warm ? "text-amber-600 font-medium" : "text-muted"}`}
                              >
                                {MATCH_LABEL[g.matched]}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="p-5 pt-3 border-t border-edge bg-surface/60 backdrop-blur">
              {(hints[HintKind.Artist] || hints[HintKind.Title]) && (
                <div className="mb-2.5 flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
                  {hints[HintKind.Artist] && (
                    <div
                      className="flex items-center gap-2 animate-rise"
                      title={isAnime ? "Saison de diffusion" : "Indice artiste"}
                    >
                      {isAnime ? (
                        <Calendar size={15} weight="fill" className="text-amber-500" />
                      ) : (
                        <Microphone size={15} weight="fill" className="text-amber-500" />
                      )}
                      <span className="font-mono font-bold text-ink tracking-[0.25em]">{hints[HintKind.Artist]}</span>
                    </div>
                  )}
                  {hints[HintKind.Title] && (
                    <div
                      className="flex items-center gap-2 animate-rise"
                      title={isAnime ? "Indice animé" : "Indice titre"}
                    >
                      {isAnime ? (
                        <Television size={15} weight="fill" className="text-amber-500" />
                      ) : (
                        <Lightbulb size={15} weight="fill" className="text-amber-500" />
                      )}
                      <span className="font-mono font-bold text-ink tracking-[0.25em]">{hints[HintKind.Title]}</span>
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-3">
                <input
                  ref={guessInputRef}
                  value={guessInput}
                  onChange={(e) => setGuessInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitGuess()}
                  placeholder={isAnime ? "Nom de l'animé, OP/ED ou année…" : "Artiste, titre ou année…"}
                  disabled={!canGuess}
                  className="flex-1 min-w-0 border border-edge bg-surface rounded-xl px-4 py-3 text-ink focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
                />
                <button
                  onClick={submitGuess}
                  disabled={!canGuess}
                  className="shrink-0 bg-inverse text-inverse-ink px-6 py-3 rounded-xl font-semibold hover:opacity-90 hover:scale-[1.02] active:scale-100 transition-all disabled:opacity-40 disabled:hover:scale-100"
                >
                  Deviner
                </button>
              </div>
              <div className="flex gap-4 mt-2 text-xs text-muted">
                {isAnime ? (
                  <>
                    <span>Animé {me?.hasFoundBoth ? "✓" : "— 20 pts"}</span>
                    <span>
                      N° générique —{" "}
                      {hasFoundTheme
                        ? "✓"
                        : themeGuessesLeft > 0
                          ? `${themeGuessesLeft} essai${themeGuessesLeft > 1 ? "s" : ""}`
                          : "épuisés"}
                    </span>
                  </>
                ) : (
                  <>
                    <span>Artiste {me?.hasFoundArtist ? "✓" : "— 5 pts"}</span>
                    <span>Titre {me?.hasFoundTitle ? "✓" : "— 5 pts"}</span>
                  </>
                )}
                <span>
                  Année —{" "}
                  {yearGuessesLeft > 0 ? `${yearGuessesLeft} essai${yearGuessesLeft > 1 ? "s" : ""}` : "épuisés"}
                </span>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Chat : reste disponible après la partie */}
      <aside className="bg-surface border-l border-edge flex flex-col overflow-hidden">
        <div className="p-4 border-b border-edge flex items-center gap-2">
          <ChatCircle size={18} className="text-accent" />
          <h3 className="font-bold text-ink text-sm uppercase tracking-wider">Chat</h3>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
          {chat.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col animate-rise ${
                m.playerId === session.playerId ? "items-end" : "items-start"
              }`}
            >
              <span className="text-xs text-muted mb-0.5">{m.playerName}</span>
              <span
                className={`px-3 py-2 rounded-xl text-sm max-w-[90%] break-words ${
                  m.playerId === session.playerId ? "bg-inverse text-inverse-ink" : "bg-edge text-ink"
                }`}
              >
                {m.text}
              </span>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div className="p-4 border-t border-edge flex items-center gap-2">
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitChat()}
            placeholder="Message…"
            maxLength={200}
            className="flex-1 min-w-0 border border-edge bg-surface rounded-xl px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent transition-colors"
          />
          <button
            onClick={submitChat}
            aria-label="Envoyer"
            className="shrink-0 w-9 h-9 flex items-center justify-center bg-accent text-white rounded-xl hover:opacity-90 hover:scale-105 active:scale-100 transition-all"
          >
            <PaperPlaneRight size={15} weight="fill" />
          </button>
        </div>
      </aside>

      {editingAvatar && (
        <AvatarEditor value={profile.avatarSeed} onClose={() => setEditingAvatar(false)} onSave={saveAvatar} />
      )}
    </div>
  )
}
