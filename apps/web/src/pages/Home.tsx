import { useEffect, useState } from "react"
import { useLocation, useNavigate, useParams, Link } from "react-router-dom"
import {
  MusicNote,
  ArrowRight,
  Link as LinkIcon,
  PaintBrush,
  LockSimple,
  Info,
  ClockCounterClockwise,
} from "@phosphor-icons/react"
import { ApiError, api, loadSession, saveSession } from "@/utils/api"
import { loadHistory, type GameHistoryEntry } from "@/utils/storage"
import { GamePhase, TEAM_LABEL } from "@blindmusic/shared"
import { TEAM_RESULT_LABEL, TEAM_STYLE } from "@/utils/teams"
import { useProfile } from "@/hooks/useProfile"
import Avatar from "@/components/Avatar"
import AvatarEditor from "@/components/AvatarEditor"
import SettingsMenu from "@/components/SettingsMenu"
import LegalFooter from "@/components/LegalFooter"
import Modal from "@/components/Modal"

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return "Erreur"
}

function formatPlayedAt(playedAt: number): string {
  return new Date(playedAt).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function Home() {
  const navigate = useNavigate()
  // Set when arriving from an invite link (/join/:code)
  const { code: invitedCode } = useParams<{ code: string }>()
  const { profile, setName, setAvatar } = useProfile()
  const [history] = useState<GameHistoryEntry[]>(loadHistory)
  const [showHistory, setShowHistory] = useState(false)
  const [code, setCode] = useState((invitedCode ?? "").toUpperCase())
  const [loading, setLoading] = useState<"create" | "join" | null>(null)
  const [error, setError] = useState("")
  const [editingAvatar, setEditingAvatar] = useState(false)
  const [inviteInfo, setInviteInfo] = useState<string | null>(null)
  const [password, setPassword] = useState("")
  const [needsPassword, setNeedsPassword] = useState(false)
  // Set when bounced here from a room that no longer exists, or after leaving one
  const notice = (useLocation().state as { notice?: string } | null)?.notice

  useEffect(() => {
    if (!invitedCode) return
    const upper = invitedCode.toUpperCase()
    // Already in this room in this tab: skip straight back to it
    if (loadSession(upper)) {
      navigate(`/lobby/${upper}`, { replace: true })
      return
    }
    api
      .lobbyInfo(upper)
      .then((info) => {
        setNeedsPassword(info.hasPassword)
        const inGame = info.phase !== GamePhase.Lobby && info.phase !== GamePhase.End
        setInviteInfo(
          !inGame
            ? `${info.playerCount} joueur${info.playerCount > 1 ? "s" : ""} dans le salon`
            : info.allowLateJoin
              ? "Partie en cours, tu rejoins en direct"
              : "Partie en cours, l'hôte n'accepte pas de nouveaux joueurs"
        )
      })
      .catch((caught: unknown) => {
        if (caught instanceof ApiError && caught.status === 404) {
          // Same page instance on "/": drop the dead code along with the invite
          setCode("")
          navigate("/", { replace: true, state: { notice: "Cette partie n'existe pas ou plus." } })
          return
        }
        setError(errorMessage(caught))
      })
  }, [invitedCode, navigate])

  async function handleCreate() {
    if (!profile.name.trim()) return setError("Entre ton pseudo")
    setLoading("create")
    setError("")
    try {
      const res = await api.createLobby(profile.name.trim(), profile.avatarSeed)
      saveSession(res.code, res.playerId, res.playerName)
      navigate(`/lobby/${res.code}`)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setLoading(null)
    }
  }

  async function handleJoin() {
    if (!profile.name.trim()) return setError("Entre ton pseudo")
    if (!code.trim()) return setError("Entre un code")
    setLoading("join")
    setError("")
    try {
      const res = await api.joinLobby(
        code.trim().toUpperCase(),
        profile.name.trim(),
        profile.avatarSeed,
        password || undefined
      )
      saveSession(res.code, res.playerId, res.playerName)
      navigate(`/lobby/${res.code}`)
    } catch (error) {
      if (error instanceof ApiError && error.needsPassword) setNeedsPassword(true)
      setError(errorMessage(error))
    } finally {
      setLoading(null)
    }
  }

  const inputClass =
    "w-full border-2 border-edge bg-surface rounded-xl px-4 py-3 text-ink font-medium focus:outline-none focus:border-accent transition-colors"

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-4 py-8 relative">
      <div className="absolute top-5 right-5">
        <SettingsMenu />
      </div>

      {notice && (
        <div className="mb-5 flex items-center gap-2 text-sm bg-surface border border-edge rounded-xl px-4 py-3 text-ink animate-pop">
          <Info size={16} weight="bold" className="text-accent shrink-0" />
          {notice}
        </div>
      )}

      <div className="mb-8 text-center">
        <div className="flex items-center justify-center gap-3 mb-2">
          <MusicNote size={36} weight="duotone" className="text-accent" />
          <h1 className="text-5xl font-black tracking-tight text-ink">BLINDTEST</h1>
        </div>
        <p className="text-muted text-sm font-medium tracking-widest uppercase">Devine l'artiste · le titre · l'année</p>
      </div>

      <div className="w-full max-w-4xl grid md:grid-cols-2 bg-surface border border-edge rounded-3xl shadow-sm overflow-hidden">
        {/* Profil */}
        <div className="p-8 flex flex-col items-center gap-4 md:border-r border-b md:border-b-0 border-edge">
          <Avatar name={profile.avatarSeed} size={140} animate="always" onEdit={() => setEditingAvatar(true)} />
          <button
            type="button"
            onClick={() => setEditingAvatar(true)}
            className="flex items-center gap-1.5 text-sm text-muted hover:text-accent transition-colors"
          >
            <PaintBrush size={16} />
            Personnaliser l'avatar
          </button>
          <div className="w-full mt-2">
            <label className="block text-sm font-medium text-muted mb-2">Pseudo</label>
            <input
              value={profile.name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ton pseudo..."
              maxLength={20}
              autoFocus
              className={inputClass}
            />
          </div>
        </div>

        {/* Jouer */}
        <div className="p-8 flex flex-col justify-center gap-5">
          {invitedCode && (
            <p className="text-sm text-muted -mb-1">
              Invitation au salon <span className="font-mono font-bold text-ink">{code}</span>
              {inviteInfo ? ` · ${inviteInfo}` : ""}
            </p>
          )}

          {!invitedCode && (
            <>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={loading !== null}
                className="group flex items-center justify-between bg-inverse text-inverse-ink px-6 py-4 rounded-2xl font-semibold text-lg hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <span>{loading === "create" ? "Création…" : "Créer une partie"}</span>
                <ArrowRight size={22} className="group-hover:translate-x-1 transition-transform" />
              </button>

              <div className="flex items-center gap-3 text-xs text-muted uppercase tracking-widest">
                <span className="flex-1 h-px bg-edge" />
                ou rejoindre
                <span className="flex-1 h-px bg-edge" />
              </div>
            </>
          )}

          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void handleJoin()
            }}
          >
            {!invitedCode && (
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Code d'invitation"
                aria-label="Code d'invitation"
                maxLength={6}
                className={`${inputClass} font-mono font-bold text-lg tracking-widest placeholder:font-sans placeholder:font-medium placeholder:text-base placeholder:tracking-normal`}
              />
            )}
            {needsPassword && (
              <div className="relative">
                <LockSimple size={16} weight="bold" className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mot de passe du salon"
                  aria-label="Mot de passe du salon"
                  maxLength={32}
                  className={`${inputClass} pl-10`}
                />
              </div>
            )}
            <button
              type="submit"
              disabled={loading !== null || !code.trim()}
              className={`px-6 py-3 rounded-xl font-semibold transition-opacity disabled:opacity-50 ${
                invitedCode
                  ? "bg-inverse text-inverse-ink text-lg py-4 hover:opacity-90"
                  : "bg-accent text-white hover:opacity-90"
              }`}
            >
              {loading === "join" ? "Connexion…" : "Rejoindre"}
            </button>
            {invitedCode && (
              <button
                type="button"
                onClick={() => {
                  setCode("")
                  setError("")
                  navigate("/", { replace: true })
                }}
                className="text-sm text-muted hover:text-ink transition-colors"
              >
                Créer ma propre partie
              </button>
            )}
          </form>

          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>
      </div>

      <div className="mt-6 flex items-center gap-5 text-sm text-muted">
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-2 hover:text-accent transition-colors"
          >
            <ClockCounterClockwise size={15} />
            Mes dernières parties ({history.length})
          </button>
        )}
        <Link to="/suggest" className="flex items-center gap-2 hover:text-accent transition-colors">
          <LinkIcon size={14} />
          Soumettre une playlist
        </Link>
      </div>

      <LegalFooter className="mt-6" />

      {editingAvatar && (
        <AvatarEditor
          value={profile.avatarSeed}
          onClose={() => setEditingAvatar(false)}
          onSave={(avatar) => {
            setAvatar(avatar)
            setEditingAvatar(false)
          }}
        />
      )}

      {showHistory && (
        <Modal title="Mes dernières parties" size="md" onClose={() => setShowHistory(false)}>
          <ul className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto -mr-2 pr-2">
            {history.map((entry) => (
              <li key={`${entry.playedAt}-${entry.code}`}>
                <details className="bg-canvas/60 border border-edge rounded-xl px-4 py-3">
                  <summary className="cursor-pointer text-sm text-ink font-medium">
                    {formatPlayedAt(entry.playedAt)} · #{entry.rank}/{entry.playerCount} · {entry.score} pts
                    {entry.team && (
                      <span className={`ml-1 font-semibold ${TEAM_STYLE[entry.team.team].text}`}>
                        · Équipe {TEAM_LABEL[entry.team.team]} : {TEAM_RESULT_LABEL[entry.team.result]} (
                        {entry.team.blue} – {entry.team.red})
                      </span>
                    )}
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1">
                    {entry.tracks.map((track, index) => (
                      <li key={`${track.title}-${index}`} className="text-xs text-muted truncate">
                        {index + 1}. {track.title} — {track.artist}
                        {track.year ? ` · ${track.year}` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  )
}
