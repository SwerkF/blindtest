import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, useNavigate, Navigate } from "react-router-dom"
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
  Smiley,
  SignOut,
  X,
} from "@phosphor-icons/react"
import type {
  AnimeReveal,
  LobbySettings,
  PlayedTrack,
  PlayerPublic,
  RoundOutcome,
  RoundPublic,
  Reaction,
  TeamScores,
  WsServerMessage,
} from "@blindmusic/shared"
import {
  ANIME_ARTIST_POINTS,
  ANIME_MAX_POINTS,
  ANIME_MIN_POINTS,
  GameMode,
  GamePhase,
  GuessMatch,
  ErrorCode,
  HintKind,
  REACTIONS,
  TEAMS,
  TEAM_LABEL,
  Team,
  teamTotals,
  themeLabel,
  winningTeam,
} from "@blindmusic/shared"
import { useWs } from "@/hooks/useWs"
import { useProfile } from "@/hooks/useProfile"
import { clearSession, loadSession } from "@/utils/api"
import { appendHistory } from "@/utils/storage"
import { Cue, playCue } from "@/utils/audio"
import Visualizer from "@/components/Visualizer"
import Avatar, { PlayerStatus } from "@/components/Avatar"
import { DiscordBadge } from "@/components/DiscordIcon"
import AvatarEditor from "@/components/AvatarEditor"
import SettingsMenu from "@/components/SettingsMenu"
import Modal from "@/components/Modal"
import { TEAM_PLURAL, TEAM_STYLE, TeamResult } from "@/utils/teams"

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
  teams?: Record<string, Team>
  teamScores?: TeamScores
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
  [GuessMatch.AnimeAndArtist]: "Animé + auteur",
}

function matchLabel(matched: GuessMatch, anime: boolean): string {
  if (anime && matched === GuessMatch.Artist) return "Auteur trouvé"
  return MATCH_LABEL[matched]
}

/** "Opening 1 · Printemps 2019" style caption under an anime name. */
function animeCaption(anime: AnimeReveal): string {
  const themes = anime.themes.map(themeLabel).join(" / ")
  return [themes, anime.year].filter(Boolean).join(" · ")
}

interface Floater {
  key: number
  emoji: Reaction
  /** Horizontal position on the stage, in percent. */
  left: number
}

/** Guesses are shown with a leading capital, whatever the player typed. */
function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase("fr") + text.slice(1)
}

function withoutId(set: Set<string>, id: string): Set<string> {
  if (!set.has(id)) return set
  const next = new Set(set)
  next.delete(id)
  return next
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
      return <XCircle size={16} className="text-muted shrink-0" />
    case GuessMatch.Close:
      return <TrendUp size={16} weight="bold" className="text-amber-500 shrink-0" />
    case GuessMatch.Year:
      return <Calendar size={16} weight="fill" className="text-accent shrink-0" />
    case GuessMatch.Anime:
    case GuessMatch.AnimeAndArtist:
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
    // title carries the anime, artist the singer bonus
    if (both) return { cls: "bg-blue-500 text-white", label: "Animé + auteur", glyph: "✓" }
    if (o.title) return { cls: "bg-green-500 text-white", label: "Animé trouvé", glyph: "✓" }
    if (o.artist) return { cls: "bg-lime-400 text-lime-950", label: "Auteur seulement", glyph: "~" }
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

/** What the player found this round: artist / title / year (anime / singer / year in anime mode). */
function FoundBadges({ player, anime }: { player: PlayerPublic; anime: boolean }) {
  const items = anime
    ? [
        { found: player.hasFoundTitle, label: "Animé", Icon: Television },
        { found: player.hasFoundArtist, label: "Auteur", Icon: Microphone },
        { found: player.hasFoundYear, label: "Année", Icon: Calendar },
      ]
    : [
        { found: player.hasFoundArtist, label: "Artiste", Icon: Microphone },
        { found: player.hasFoundTitle, label: "Titre", Icon: MusicNotes },
        { found: player.hasFoundYear, label: "Année", Icon: Calendar },
      ]
  return (
    <div className="flex gap-1 mt-1">
      {items.map(({ found, label, Icon }) => (
        <span
          key={label}
          title={`${label}${found ? " trouvé" : " pas encore trouvé"}`}
          aria-label={`${label}${found ? " trouvé" : " pas encore trouvé"}`}
          className={`inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors duration-300 ${
            found ? "bg-accent text-white animate-pop" : "bg-edge/70 text-muted"
          }`}
        >
          <Icon size={13} weight={found ? "fill" : "bold"} />
        </span>
      ))}
    </div>
  )
}

/** Blue vs red totals, the side ahead drawn bolder. */
function TeamScoreboard({ totals }: { totals: TeamScores }) {
  const leader = winningTeam(totals)
  return (
    <div className="grid grid-cols-2 gap-2">
      {TEAMS.map((team) => (
        <div
          key={team}
          className={`rounded-xl border px-3 py-2 text-center transition-opacity ${TEAM_STYLE[team].border} ${
            TEAM_STYLE[team].soft
          } ${leader && leader !== team ? "opacity-70" : ""}`}
        >
          <p className={`text-[11px] font-bold uppercase tracking-wider ${TEAM_STYLE[team].text}`}>
            {TEAM_LABEL[team]}
          </p>
          <p key={totals[team]} className="text-2xl font-black text-ink tabular-nums animate-pop">
            {totals[team]}
          </p>
        </div>
      ))}
    </div>
  )
}

/** Gold crown with a glint, for the player in the lead. */
function LeaderCrown() {
  return (
    <span className="absolute -top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none" title="En tête">
      <span className="crown w-6 h-6" />
    </span>
  )
}

/** End-of-game headline for team mode: who won, or a draw. */
function TeamVerdict({ totals }: { totals: TeamScores }) {
  const winner = winningTeam(totals)
  return (
    <div className="mt-4 w-full max-w-md flex flex-col items-center gap-3 animate-rise">
      <p className={`text-xl font-black ${winner ? TEAM_STYLE[winner].text : "text-ink"}`}>
        {winner ? `Victoire des ${TEAM_PLURAL[winner]} !` : "Égalité parfaite !"}
      </p>
      <div className="w-full">
        <TeamScoreboard totals={totals} />
      </div>
    </div>
  )
}

/** What the history keeps about our team, when the game was played in teams. */
function myTeamResult(
  teams: Record<string, Team> | undefined,
  totals: TeamScores | undefined,
  playerId: string
) {
  const team = teams?.[playerId]
  if (!team || !totals) return undefined
  const winner = winningTeam(totals)
  const result = winner === null ? TeamResult.Draw : winner === team ? TeamResult.Win : TeamResult.Loss
  return { team, result, blue: totals[Team.Blue], red: totals[Team.Red] }
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
  const [endState, setEndState] = useState<EndState | null>(null)
  const [now, setNow] = useState(() => Date.now())
  /** Players currently typing a guess or a chat message. */
  const [typingIds, setTypingIds] = useState<Set<string>>(() => new Set())
  /** Latest emote per player, shown as a bubble on their avatar. */
  const [bubbles, setBubbles] = useState<Record<string, { emoji: Reaction; key: number }>>({})
  /** Emotes drifting up the stage for everyone to see. */
  const [floaters, setFloaters] = useState<Floater[]>([])
  const [confirmLeave, setConfirmLeave] = useState(false)
  /** Team mode: points kept from players who left mid-game. */
  const [teamBank, setTeamBank] = useState<TeamScores | null>(null)
  /** Phones and tablets: the chat and reactions live in a bottom drawer. */
  const [chatOpen, setChatOpen] = useState(false)
  const [chatSeen, setChatSeen] = useState(0)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const guessInputRef = useRef<HTMLInputElement>(null)
  const idRef = useRef(0)
  const settingsRef = useRef<LobbySettings | null>(null)
  const historySaved = useRef(false)
  /** Only games followed live end up in the history, not a recap seen after a refresh. */
  const playedLive = useRef(false)
  const typingSentRef = useRef(false)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Countdown second the tick was last played for, so each of 3, 2, 1 beeps once. */
  const tickedRef = useRef<number | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chat])

  useEffect(() => {
    if (chatOpen) setChatSeen(chat.length)
  }, [chatOpen, chat.length])
  const unreadChat = chatOpen ? 0 : chat.length - chatSeen

  useEffect(() => {
    return onMessage((msg: WsServerMessage) => {
      switch (msg.type) {
        case "error":
          if (msg.code === ErrorCode.RoomNotFound) {
            clearSession(code!)
            navigate("/", { replace: true, state: { notice: "Cette partie n'existe pas ou plus." } })
          }
          break

        case "lobby:update":
          setPlayers(msg.players)
          setScores(Object.fromEntries(msg.players.map((p) => [p.id, p.score])))
          setTeamBank(msg.teamBank ?? null)
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
          setTeamBank(null)
          setReveal(null)
          setRound(null)
          setPhase(GamePhase.Playing)
          historySaved.current = false
          tickedRef.current = null
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
          // Clear the per-round found markers; the server already reset them
          setPlayers((prev) =>
            prev.map((p) => ({
              ...p,
              hasFoundArtist: false,
              hasFoundTitle: false,
              hasFoundBoth: false,
              hasFoundYear: false,
              roundPoints: 0,
            }))
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
                      msg.matched === GuessMatch.AnimeAndArtist,
                    hasFoundTitle:
                      p.hasFoundTitle ||
                      msg.matched === GuessMatch.Title ||
                      msg.matched === GuessMatch.Both ||
                      msg.matched === GuessMatch.Anime ||
                      msg.matched === GuessMatch.AnimeAndArtist,
                    hasFoundBoth:
                      p.hasFoundBoth ||
                      msg.matched === GuessMatch.Both ||
                      msg.matched === GuessMatch.Anime ||
                      msg.matched === GuessMatch.AnimeAndArtist,
                    hasFoundYear: p.hasFoundYear || msg.matched === GuessMatch.Year,
                    roundPoints: p.roundPoints + msg.pointsEarned,
                  }
                : p
            )
          )

          if (msg.playerId === session?.playerId && msg.text !== undefined) {
            setYearGuessesLeft(msg.yearGuessesLeft)
            setGuesses((prev) => [
              ...prev,
              { id: idRef.current++, text: msg.text!, matched: msg.matched, points: msg.pointsEarned },
            ])
            // Only we get the answer echoed back
            if (msg.revealedAnime) setMyFind(msg.revealedAnime)
            else if (msg.revealedArtist && msg.revealedTitle) {
              setMyFind(`${msg.revealedTitle} — ${msg.revealedArtist}`)
            }
            if (
              msg.firstBoth ||
              msg.matched === GuessMatch.Both ||
              msg.matched === GuessMatch.Anime ||
              msg.matched === GuessMatch.AnimeAndArtist
            ) {
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
          setTypingIds((prev) => withoutId(prev, msg.playerId))
          break

        case "player:typing":
          setTypingIds((prev) => (msg.typing ? new Set(prev).add(msg.playerId) : withoutId(prev, msg.playerId)))
          break

        case "reaction": {
          const key = idRef.current++
          setBubbles((prev) => ({ ...prev, [msg.playerId]: { emoji: msg.emoji, key } }))
          setFloaters((prev) => [...prev.slice(-11), { key, emoji: msg.emoji, left: 10 + Math.random() * 80 }])
          setTimeout(() => {
            setFloaters((prev) => prev.filter((f) => f.key !== key))
            setBubbles((prev) => {
              if (prev[msg.playerId]?.key !== key) return prev
              const next = { ...prev }
              delete next[msg.playerId]
              return next
            })
          }, 2600)
          break
        }

        case "game:end":
          setEndState({
            scores: msg.scores,
            playerNames: msg.playerNames,
            tracks: msg.tracks,
            teams: msg.teams,
            teamScores: msg.teamScores,
          })
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
              team: myTeamResult(msg.teams, msg.teamScores, session.playerId),
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

  // Beep on 3, 2, 1 rather than once when the countdown starts
  useEffect(() => {
    if (!countdownTo || countdownLeft < 1 || countdownLeft > 3) return
    if (tickedRef.current === countdownLeft) return
    tickedRef.current = countdownLeft
    playCue(Cue.Countdown)
  }, [countdownTo, countdownLeft])
  const revealLeft = reveal ? secondsUntil(reveal.nextAt, now) : 0
  const isCountdown = countdownTo !== null && countdownLeft > 0
  const canGuess = phase === GamePhase.Playing && !isCountdown && round !== null

  const me = players.find((p) => p.id === session?.playerId)
  const isAnime = settings?.mode === GameMode.Anime
  // Artist and title (anime and singer) found: the input stays open for the year bonus
  const onlyYearLeft =
    !!me &&
    (isAnime ? me.hasFoundTitle && me.hasFoundArtist : me.hasFoundBoth) &&
    !me.hasFoundYear &&
    yearGuessesLeft > 0
  const myOutcomes = session ? (outcomes[session.playerId] ?? []) : []
  const totalRounds = endState?.tracks.length ?? round?.total ?? 0

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0)),
    [players, scores]
  )
  const teamMode = settings?.teamMode === true
  // Team mode groups each side together, best first within it
  const listedPlayers = useMemo(
    () =>
      teamMode
        ? TEAMS.flatMap((team) => sortedPlayers.filter((p) => p.team === team))
        : sortedPlayers,
    [teamMode, sortedPlayers]
  )
  const liveTeamScores = useMemo(
    () => teamTotals(Object.fromEntries(players.map((p) => [p.id, p.team])), scores, teamBank),
    [players, scores, teamBank]
  )
  // The crown only goes to a clear, scoring leader
  const leaderId = useMemo(() => {
    const [first, second] = sortedPlayers
    const top = first ? (scores[first.id] ?? 0) : 0
    if (!first || top <= 0) return null
    return second && (scores[second.id] ?? 0) === top ? null : first.id
  }, [sortedPlayers, scores])

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

  /** Tells the others we are typing, then that we stopped once idle for a moment. */
  function signalTyping(text: string) {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    if (!text.trim()) {
      stopTyping()
      return
    }
    if (!typingSentRef.current) {
      typingSentRef.current = true
      send({ type: "typing", typing: true })
    }
    typingTimerRef.current = setTimeout(stopTyping, 2500)
  }

  function stopTyping() {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingTimerRef.current = null
    if (!typingSentRef.current) return
    typingSentRef.current = false
    send({ type: "typing", typing: false })
  }

  function sendReaction(emoji: Reaction) {
    send({ type: "reaction", emoji })
  }

  function leaveGame() {
    setConfirmLeave(false)
    stopTyping()
    send({ type: "leave" })
    clearSession(code!)
    navigate("/", { replace: true })
  }

  function submitGuess() {
    const text = guessInput.trim()
    if (!canGuess || !text) return
    send({ type: "guess", text })
    setGuessInput("")
    stopTyping()
  }

  function submitChat() {
    if (!chatInput.trim()) return
    send({ type: "chat", text: chatInput.trim() })
    setChatInput("")
    stopTyping()
  }

  // No seat in this room from this tab: the join page checks the room exists and asks for a pseudo
  if (!session) return <Navigate to={`/join/${code}`} replace />

  const ranking = endState ? Object.entries(endState.scores).sort((a, b) => b[1] - a[1]) : []

  return (
    <div className="h-dvh bg-canvas flex flex-col lg:grid lg:grid-cols-[290px_1fr_310px] overflow-hidden">
      {/* Joueurs */}
      {/* Mobile : bandeau horizontal en haut ; grand écran : colonne de gauche */}
      <aside className="shrink-0 bg-surface border-b lg:border-b-0 lg:border-r border-edge flex flex-wrap lg:flex-col lg:flex-nowrap overflow-hidden pt-[env(safe-area-inset-top)] lg:pt-0">
        <div className="order-2 lg:order-none px-1.5 lg:p-4 lg:border-b border-edge flex items-center justify-between">
          <h3 className="hidden lg:block font-bold text-ink text-sm uppercase tracking-wider">Joueurs</h3>
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            aria-label="Ouvrir le chat et les réactions"
            className="lg:hidden relative p-3 rounded-xl text-muted hover:text-accent hover:bg-edge/50 transition-colors"
          >
            <ChatCircle size={18} weight="duotone" />
            {unreadChat > 0 && (
              <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-accent text-white text-[10px] font-bold leading-4 text-center animate-pop">
                {unreadChat > 9 ? "9+" : unreadChat}
              </span>
            )}
          </button>
          <SettingsMenu />
        </div>
        {teamMode && (
          <div className="order-3 lg:order-none w-full px-3 pt-2 lg:p-3 lg:border-b border-edge">
            <TeamScoreboard totals={liveTeamScores} />
          </div>
        )}
        <ul className="order-4 lg:order-none w-full lg:flex-1 flex lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible lg:overflow-y-auto px-3 pt-2 pb-3 short:pb-2 lg:p-3 snap-x lg:snap-none">
          {listedPlayers.map((p, i) => {
            const total = scores[p.id] ?? 0
            const status = !p.connected
              ? PlayerStatus.Offline
              : typingIds.has(p.id)
                ? PlayerStatus.Typing
                : PlayerStatus.Online
            const bubble = bubbles[p.id]
            // Ranks restart within each team
            const rank = teamMode ? listedPlayers.slice(0, i).filter((o) => o.team === p.team).length : i
            const isMe = p.id === session.playerId
            return (
              <li
                key={p.id}
                className={`relative shrink-0 lg:shrink max-w-[230px] lg:max-w-none snap-start flex items-center gap-2.5 lg:gap-3 px-3 py-2.5 short:py-1.5 transition-all duration-200 animate-rise hover:brightness-105 ${
                  teamMode ? "rounded-r-xl pl-4" : "rounded-xl"
                } ${isMe ? "bg-accent/10 border border-accent/20" : "bg-edge/40"} ${p.connected ? "" : "opacity-60"}`}
              >
                {teamMode && (
                  // Straight team stripe over the card's left edge (and its border, if any)
                  <span
                    aria-hidden="true"
                    className={`absolute w-1 ${isMe ? "-left-px -inset-y-px" : "left-0 inset-y-0"}`}
                    style={{ backgroundColor: TEAM_STYLE[p.team].color }}
                  />
                )}
                <span
                  className={`text-xs font-mono w-4 text-center ${teamMode ? `font-bold ${TEAM_STYLE[p.team].text}` : "text-muted"}`}
                  title={teamMode ? `Équipe ${TEAM_LABEL[p.team]}` : undefined}
                >
                  {rank + 1}
                </span>
                <div className="relative shrink-0">
                  {p.id === leaderId && <LeaderCrown />}
                  <Avatar
                    name={p.avatarSeed || p.name}
                    size={52}
                    status={status}
                    imageUrl={p.avatarUrl}
                    onEdit={p.id === session.playerId ? () => setEditingAvatar(true) : undefined}
                  />
                  {bubble && (
                    <span
                      key={bubble.key}
                      className="absolute -bottom-2 -left-3 text-2xl leading-none animate-reaction pointer-events-none"
                    >
                      {bubble.emoji}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-ink text-sm flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{p.name}</span>
                    {p.discord && <DiscordBadge size={13} />}
                  </p>
                  {status === PlayerStatus.Typing ? (
                    <p className="text-[11px] text-amber-500 mt-1">écrit…</p>
                  ) : (
                    <FoundBadges player={p} anime={isAnime} />
                  )}
                </div>
                <div className="flex items-baseline gap-1.5 shrink-0">
                  {p.roundPoints > 0 && (
                    <span key={p.roundPoints} className="text-xs font-bold text-accent tabular-nums animate-pop">
                      +{p.roundPoints}
                    </span>
                  )}
                  <span className="font-bold text-ink text-lg tabular-nums">{total}</span>
                </div>
              </li>
            )
          })}
        </ul>
        <div className="order-1 lg:order-none flex-1 lg:flex-none pl-3 lg:p-3 lg:border-t border-edge flex items-center justify-between gap-2">
          <p className="text-xs text-muted">
            {round && phase !== GamePhase.End ? `Manche ${round.trackIndex} / ${round.total}` : ""}
          </p>
          <button
            type="button"
            onClick={() => setConfirmLeave(true)}
            className="flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-red-500 px-3 py-3 lg:px-2.5 lg:py-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
          >
            <SignOut size={14} weight="bold" />
            Quitter
          </button>
        </div>
      </aside>

      {/* Centre */}
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
        {/* Réactions qui s'envolent sur la scène */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-20">
          {floaters.map((f) => (
            <span
              key={f.key}
              className="absolute bottom-28 text-5xl animate-float-up"
              style={{ left: `${f.left}%` }}
            >
              {f.emoji}
            </span>
          ))}
        </div>
        {!connected && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 text-xs text-muted bg-surface px-3 py-1.5 rounded-full border border-edge animate-fade">
            <span className="w-2 h-2 rounded-full bg-muted animate-pulse" />
            Reconnexion…
          </div>
        )}

        {phase === GamePhase.End && endState ? (
          /* ── Fin de partie ── */
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] animate-fade">
            <div className="flex flex-col items-center mb-6 sm:mb-8">
              <Trophy size={44} weight="duotone" className="text-accent mb-3 animate-pop" />
              <h2 className="text-3xl font-black text-ink">Partie terminée</h2>
              {endState.teamScores && <TeamVerdict totals={endState.teamScores} />}
            </div>

            <div className="max-w-md mx-auto flex flex-col gap-2 mb-10">
              {ranking.map(([id, score], i) => (
                <div
                  key={id}
                  style={{ animationDelay: `${i * 60}ms` }}
                  className={`flex items-center gap-3 sm:gap-4 px-3 sm:px-5 py-3 sm:py-3.5 rounded-xl animate-rise ${
                    i === 0 ? "bg-inverse text-inverse-ink" : "bg-surface border border-edge text-ink"
                  }`}
                >
                  <span className="text-xl font-black w-7">{i + 1}</span>
                  <Avatar
                    name={players.find((p) => p.id === id)?.avatarSeed || endState.playerNames[id] || id}
                    size={48}
                    imageUrl={players.find((p) => p.id === id)?.avatarUrl}
                  />
                  <span className="font-semibold flex-1 min-w-0 flex items-center gap-1.5">
                    <span className="truncate">{endState.playerNames[id]}</span>
                    {players.find((p) => p.id === id)?.discord && <DiscordBadge />}
                  </span>
                  {endState.teams?.[id] && (
                    <span
                      title={`Équipe ${TEAM_LABEL[endState.teams[id]]}`}
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${TEAM_STYLE[endState.teams[id]].dot}`}
                    />
                  )}
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
                        <p className="font-semibold text-ink text-sm truncate" title={t.anime.originalName}>
                          {t.anime.name}
                        </p>
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
                className="w-full sm:w-auto justify-center flex items-center gap-2 bg-inverse text-inverse-ink px-6 py-3 rounded-xl font-semibold hover:opacity-90 hover:scale-[1.02] active:scale-100 transition-all"
              >
                <ArrowCounterClockwise size={18} weight="bold" />
                Retour au lobby
              </button>
            </div>
          </div>
        ) : (
          /* ── Partie en cours ── */
          <>
            <div className="px-3 sm:px-6 pt-3 sm:pt-4 flex flex-col gap-2">
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
                    {reveal.isLast
                      ? "Scores finaux…"
                      : revealLeft > 0
                        ? `Suivante dans ${revealLeft}s`
                        : "Chargement de la suivante…"}
                  </span>
                )}
              </div>

              <div className="h-20 sm:h-24 short:h-12 shrink-0 relative">
                <Visualizer previewUrl={round?.previewUrl ?? null} isPlaying={canGuess} seekTo={seekTo} />
                {isCountdown && (
                  <div className="absolute inset-0 flex items-center justify-center bg-stage/90 rounded-xl gap-4 animate-fade">
                    <span className="text-white/70 text-xs uppercase tracking-widest">Départ dans</span>
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

            <div className="flex-1 min-h-0 px-3 sm:px-6 py-3 sm:py-4 flex flex-col">
              {reveal ? (
                <div className="flex-1 min-h-0 overflow-y-auto flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 text-center sm:text-left animate-fade">
                  {(reveal.anime?.imageUrl ?? reveal.coverUrl) ? (
                    <img
                      src={reveal.anime?.imageUrl ?? reveal.coverUrl ?? ""}
                      alt=""
                      className="w-28 h-28 sm:w-40 sm:h-40 rounded-2xl object-cover shadow-lg shrink-0 animate-pop"
                    />
                  ) : (
                    <div className="w-28 h-28 sm:w-40 sm:h-40 rounded-2xl bg-edge flex items-center justify-center shrink-0">
                      <MusicNotes size={40} weight="duotone" className="text-muted" />
                    </div>
                  )}
                  <div className="min-w-0 sm:flex-1 w-full max-w-md animate-rise">
                    {reveal.anime ? (
                      <>
                        <p className="font-black text-2xl sm:text-3xl text-ink leading-tight break-words">{reveal.anime.name}</p>
                        {reveal.anime.originalName && (
                          <p className="text-muted/70 text-xs italic mt-0.5 break-words">{reveal.anime.originalName}</p>
                        )}
                        <p className="text-accent font-semibold mt-1">{animeCaption(reveal.anime)}</p>
                        <p className="text-muted text-sm mt-1">
                          {reveal.title} — {reveal.artist}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-black text-2xl sm:text-3xl text-ink leading-tight break-words">{reveal.title}</p>
                        <p className="text-muted text-lg mt-1">{reveal.artist}</p>
                        {reveal.year ? <p className="text-muted/70 text-sm mt-0.5">{reveal.year}</p> : null}
                      </>
                    )}
                    {reveal.lyrics && (
                      <pre className="mt-3 max-h-28 overflow-y-auto whitespace-pre-wrap text-left font-sans text-xs text-muted leading-relaxed border-l-2 border-edge pl-3">
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
                              Plus tu es rapide, plus ça rapporte. Bonus : l'auteur du générique ou l'année.
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
                      <div className="grid grid-cols-2 xl:grid-cols-3 gap-2 auto-rows-min">
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
                                  {capitalize(g.text)}
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
                                {matchLabel(g.matched, isAnime)}
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

            {/* Barre de saisie collée en bas, au-dessus du clavier sur mobile */}
            <div className="shrink-0 px-3 sm:px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-edge bg-surface/60">
              {(hints[HintKind.Artist] || hints[HintKind.Title]) && (
                <div className="mb-2.5 flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
                  {hints[HintKind.Artist] && (
                    <div
                      className="flex items-center gap-2 animate-rise"
                      title="Indice artiste"
                    >
                      <Microphone size={15} weight="fill" className="text-amber-500" />
                      <span className="font-mono font-bold text-ink tracking-[0.25em] break-all">{hints[HintKind.Artist]}</span>
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
                      <span className="font-mono font-bold text-ink tracking-[0.25em] break-all">{hints[HintKind.Title]}</span>
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-2 sm:gap-3">
                <input
                  ref={guessInputRef}
                  value={guessInput}
                  onChange={(e) => {
                    setGuessInput(e.target.value)
                    signalTyping(e.target.value)
                  }}
                  onKeyDown={(e) => e.key === "Enter" && submitGuess()}
                  placeholder={
                    onlyYearLeft
                      ? "Et l'année ? (4 chiffres)"
                      : isAnime
                        ? "Nom de l'animé, auteur ou année…"
                        : "Artiste, titre ou année…"
                  }
                  disabled={!canGuess}
                  enterKeyHint="send"
                  autoComplete="off"
                  autoCorrect="off"
                  className="flex-1 min-w-0 border border-edge bg-surface rounded-xl px-3 sm:px-4 py-3 text-base text-ink focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
                />
                <button
                  onClick={submitGuess}
                  disabled={!canGuess}
                  className="shrink-0 bg-inverse text-inverse-ink px-4 sm:px-6 py-3 rounded-xl font-semibold hover:opacity-90 hover:scale-[1.02] active:scale-100 transition-all disabled:opacity-40 disabled:hover:scale-100"
                >
                  Deviner
                </button>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-2 text-xs text-muted short:hidden">
                {isAnime ? (
                  <>
                    <span>Animé {me?.hasFoundTitle ? "✓" : `— ${ANIME_MAX_POINTS} à ${ANIME_MIN_POINTS} pts`}</span>
                    <span>Auteur {me?.hasFoundArtist ? "✓" : `— ${ANIME_ARTIST_POINTS} pts`}</span>
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

      {/* Chat : reste disponible après la partie ; tiroir du bas sur mobile */}
      {chatOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-pitch/50 animate-fade" onClick={() => setChatOpen(false)} />
      )}
      <aside
        className={`bg-surface border-edge flex-col overflow-hidden lg:static lg:z-auto lg:flex lg:h-auto lg:border-l lg:border-t-0 lg:rounded-none lg:shadow-none lg:animate-none ${
          chatOpen ? "flex fixed inset-x-0 bottom-0 z-50 h-[75dvh] border-t rounded-t-2xl shadow-xl animate-rise" : "hidden"
        }`}
      >
        <div className="px-4 py-1 lg:py-4 border-b border-edge flex items-center gap-2">
          <ChatCircle size={18} className="text-accent" />
          <h3 className="font-bold text-ink text-sm uppercase tracking-wider">Chat</h3>
          <button
            type="button"
            onClick={() => setChatOpen(false)}
            aria-label="Fermer le chat"
            className="lg:hidden ml-auto -mr-2 p-3 rounded-xl text-muted hover:text-ink hover:bg-edge/60 transition-colors"
          >
            <X size={18} weight="bold" />
          </button>
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

        {/* Réactions : visibles par tout le monde */}
        <div className="px-4 pt-3 border-t border-edge">
          <p className="text-[11px] text-muted font-medium uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Smiley size={13} weight="bold" />
            Réagir
          </p>
          <div className="grid grid-cols-8 gap-1">
            {REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => sendReaction(emoji)}
                aria-label={`Réagir ${emoji}`}
                className="aspect-square min-h-11 lg:min-h-0 flex items-center justify-center text-2xl lg:text-xl rounded-lg hover:bg-edge/70 hover:scale-125 active:scale-95 transition-transform"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex items-center gap-2">
          <input
            value={chatInput}
            onChange={(e) => {
              setChatInput(e.target.value)
              signalTyping(e.target.value)
            }}
            onKeyDown={(e) => e.key === "Enter" && submitChat()}
            placeholder="Message…"
            maxLength={200}
            enterKeyHint="send"
            className="flex-1 min-w-0 border border-edge bg-surface rounded-xl px-3 py-2.5 lg:py-2 text-base lg:text-sm text-ink focus:outline-none focus:border-accent transition-colors"
          />
          <button
            onClick={submitChat}
            aria-label="Envoyer"
            className="shrink-0 w-11 h-11 lg:w-9 lg:h-9 flex items-center justify-center bg-accent text-white rounded-xl hover:opacity-90 hover:scale-105 active:scale-100 transition-all"
          >
            <PaperPlaneRight size={15} weight="fill" />
          </button>
        </div>
      </aside>

      {editingAvatar && (
        <AvatarEditor value={profile.avatarSeed} onClose={() => setEditingAvatar(false)} onSave={saveAvatar} />
      )}

      {confirmLeave && (
        <Modal
          title="Quitter la partie ?"
          onClose={() => setConfirmLeave(false)}
          actions={
            <>
              <button
                type="button"
                onClick={() => setConfirmLeave(false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-muted hover:text-ink hover:bg-edge/60 transition-colors"
              >
                Rester
              </button>
              <button
                type="button"
                onClick={leaveGame}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                <SignOut size={16} weight="bold" />
                Quitter
              </button>
            </>
          }
        >
          Tu quittes le salon et ton score de cette partie est perdu. Tu pourras revenir avec le code si l'hôte
          accepte les nouveaux joueurs.
        </Modal>
      )}
    </div>
  )
}
