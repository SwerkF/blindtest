import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, useNavigate, Navigate } from "react-router-dom"
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query"
import {
  Users,
  Play,
  Copy,
  Check,
  MusicNotes,
  ShareNetwork,
  X,
  Television,
  CircleNotch,
  LockSimple,
  SignOut,
} from "@phosphor-icons/react"
import {
  ErrorCode,
  LOBBY_PASSWORD_MAX_LENGTH,
  GameMode,
  GamePhase,
  MAX_ROUND_DURATION,
  MAX_TRACK_COUNT,
  TRACK_COUNT_STEP,
  parseDeezerPlaylistId,
  type DeezerPlaylistMeta,
  type LobbySettings,
  type PlayerPublic,
} from "@blindmusic/shared"
import { useWs } from "@/hooks/useWs"
import { useProfile } from "@/hooks/useProfile"
import { api, clearSession, inviteUrl, loadSession, type PlaylistItem } from "@/utils/api"
import Avatar, { PlayerStatus } from "@/components/Avatar"
import AvatarEditor from "@/components/AvatarEditor"
import SettingsMenu from "@/components/SettingsMenu"
import LegalFooter from "@/components/LegalFooter"

const DEFAULT_SETTINGS: LobbySettings = {
  mode: GameMode.Classic,
  playlistIds: [],
  customDeezerPlaylistIds: [],
  trackCount: 10,
  roundDuration: 30,
  maxErrorPercent: 20,
  yearGuessAttempts: 2,
  showLyrics: false,
  showHint: true,
  showArtistHint: true,
}

function normalizeSettings(settings: LobbySettings): LobbySettings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    mode: settings.mode ?? GameMode.Classic,
    playlistIds: settings.playlistIds ?? [],
    customDeezerPlaylistIds: settings.customDeezerPlaylistIds ?? [],
  }
}

function fallbackMeta(id: string): DeezerPlaylistMeta {
  return { id, name: "Playlist Deezer", coverUrl: null, trackCount: 0 }
}

export default function Lobby() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const session = loadSession(code!)
  const { send, onMessage, connected } = useWs(code ?? "", session?.playerId ?? "")

  const [players, setPlayers] = useState<PlayerPublic[]>([])
  const [hostId, setHostId] = useState<string | null>(null)
  const [settings, setSettings] = useState<LobbySettings>(DEFAULT_SETTINGS)
  const [copied, setCopied] = useState<"code" | "link" | null>(null)
  const [error, setError] = useState("")
  const [playlistUrl, setPlaylistUrl] = useState("")
  const [addingPlaylist, setAddingPlaylist] = useState(false)
  const [editingAvatar, setEditingAvatar] = useState(false)
  /** The host started the game and the server is fetching the tracks. */
  const [preparing, setPreparing] = useState(false)
  const [access, setAccess] = useState({ hasPassword: false, allowLateJoin: true })
  /** Host-side draft of the password, committed on blur or Enter. */
  const [passwordDraft, setPasswordDraft] = useState("")
  /** The server has no settings yet and the host has to publish the initial ones. */
  const [needsInitialSync, setNeedsInitialSync] = useState(false)
  const { profile, setAvatar } = useProfile()

  const isHost = hostId !== null && hostId === session?.playerId
  // Refs so async handlers and callbacks always build on the latest state, never a stale closure
  const settingsRef = useRef(settings)
  const isHostRef = useRef(isHost)
  isHostRef.current = isHost
  /** Once the host has synced, their local settings win over echoes of older updates. */
  const hostSyncedRef = useRef(false)

  const { data: allPlaylists } = useQuery<PlaylistItem[]>({
    queryKey: ["playlists"],
    queryFn: api.playlists,
  })
  const isAnime = settings.mode === GameMode.Anime
  // Each mode only offers the curated playlists made for it
  const playlists = useMemo(
    () => allPlaylists?.filter((p) => (p.category ?? GameMode.Classic) === settings.mode),
    [allPlaylists, settings.mode]
  )

  // One query per playlist, so adding one never refetches (nor blanks) the others
  const customQueries = useQueries({
    queries: settings.customDeezerPlaylistIds.map((id) => ({
      queryKey: ["deezer-playlist", id],
      queryFn: () => api.deezerPlaylist(id).catch(() => fallbackMeta(id)),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  })
  const customMetas = customQueries.map((query) => query.data).filter((meta) => meta !== undefined)
  const customPending = customQueries.some((query) => query.isPending)

  const availableTracks = useMemo(() => {
    const curated =
      playlists
        ?.filter((p) => settings.playlistIds.includes(p.id))
        .reduce((sum, p) => sum + p.trackCount, 0) ?? 0
    const custom = customMetas.reduce((sum, p) => sum + p.trackCount, 0)
    return curated + custom
  }, [playlists, customMetas, settings.playlistIds])

  // Cap the slider to what the selected playlists can actually deliver
  const maxTracks = useMemo(() => {
    // Unknown sizes must not shrink the host's choice while they load
    const cap = customPending || !playlists ? MAX_TRACK_COUNT : Math.min(MAX_TRACK_COUNT, availableTracks)
    return Math.max(TRACK_COUNT_STEP, Math.floor(cap / TRACK_COUNT_STEP) * TRACK_COUNT_STEP)
  }, [availableTracks, customPending, playlists])
  const trackCount = Math.min(settings.trackCount, maxTracks)

  function commitSettings(next: LobbySettings) {
    settingsRef.current = next
    setSettings(next)
    if (isHostRef.current) send({ type: "lobby:settings", settings: next })
  }

  function updateSetting<K extends keyof LobbySettings>(key: K, value: LobbySettings[K]) {
    commitSettings({ ...settingsRef.current, [key]: value })
  }

  useEffect(() => {
    return onMessage((msg) => {
      switch (msg.type) {
        case "lobby:update": {
          setPlayers(msg.players)
          setHostId(msg.hostId)
          const amHost = msg.hostId === session?.playerId
          if (!amHost) hostSyncedRef.current = false
          if (msg.settings && !(amHost && hostSyncedRef.current)) {
            const next = normalizeSettings(msg.settings)
            settingsRef.current = next
            setSettings(next)
          }
          if (amHost && !hostSyncedRef.current) {
            hostSyncedRef.current = true
            if (!msg.settings) setNeedsInitialSync(true)
          }
          // Late joiners go straight into the running game
          if (msg.phase === GamePhase.Playing || msg.phase === GamePhase.Reveal) navigate(`/game/${code}`)
          break
        }
        case "game:start":
          // The game page picks the countdown back up from the same timestamp
          navigate(`/game/${code}`)
          break
        case "game:preparing":
          setPreparing(msg.active)
          if (msg.active) setError("")
          break
        case "lobby:access":
          setAccess({ hasPassword: msg.hasPassword, allowLateJoin: msg.allowLateJoin })
          if (msg.password !== undefined) setPasswordDraft(msg.password)
          break
        case "error":
          if (msg.code === ErrorCode.RoomNotFound) {
            clearSession(code!)
            navigate("/", { replace: true, state: { notice: "Cette partie n'existe pas ou plus." } })
            break
          }
          setError(msg.message)
          setPreparing(false)
          break
        default:
          break
      }
    })
  }, [onMessage, navigate, code, session?.playerId])

  // Fresh room: preselect the first playlist so the host can start immediately, and share it
  useEffect(() => {
    if (!needsInitialSync || !playlists || !isHost) return
    setNeedsInitialSync(false)
    const current = settingsRef.current
    const empty = !current.playlistIds.length && !current.customDeezerPlaylistIds.length
    commitSettings(empty && playlists.length ? { ...current, playlistIds: [playlists[0].id] } : current)
  }, [needsInitialSync, playlists, isHost])

  function switchMode(mode: GameMode) {
    if (!isHost) return
    const current = settingsRef.current
    if (current.mode === mode) return
    const inMode = allPlaylists?.filter((p) => (p.category ?? GameMode.Classic) === mode) ?? []
    const kept = current.playlistIds.filter((id) => inMode.some((p) => p.id === id))
    const needsOne = kept.length === 0 && current.customDeezerPlaylistIds.length === 0 && inMode.length > 0
    commitSettings({ ...current, mode, playlistIds: needsOne ? [inMode[0].id] : kept })
  }

  function playlistCount() {
    return settings.playlistIds.length + settings.customDeezerPlaylistIds.length
  }

  function togglePlaylist(id: string) {
    if (!isHost) return
    const current = settingsRef.current
    const has = current.playlistIds.includes(id)
    if (has && current.playlistIds.length === 1 && current.customDeezerPlaylistIds.length === 0) return
    updateSetting("playlistIds", has ? current.playlistIds.filter((p) => p !== id) : [...current.playlistIds, id])
  }

  function removeCustom(id: string) {
    if (!isHost) return
    const current = settingsRef.current
    const next = current.customDeezerPlaylistIds.filter((p) => p !== id)
    if (next.length === 0 && current.playlistIds.length === 0) return
    updateSetting("customDeezerPlaylistIds", next)
  }

  async function addCustomPlaylist() {
    if (!isHost || addingPlaylist) return
    const id = parseDeezerPlaylistId(playlistUrl)
    if (!id) {
      setError("Colle un lien de playlist Deezer")
      return
    }
    if (settingsRef.current.customDeezerPlaylistIds.includes(id)) {
      setPlaylistUrl("")
      return
    }
    setAddingPlaylist(true)
    setError("")
    try {
      const meta = await api.deezerPlaylist(id)
      queryClient.setQueryData(["deezer-playlist", id], meta)
      // Read the settings after the await: they may have changed while Deezer answered
      const current = settingsRef.current
      if (!current.customDeezerPlaylistIds.includes(id)) {
        updateSetting("customDeezerPlaylistIds", [...current.customDeezerPlaylistIds, id])
      }
      setPlaylistUrl("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Playlist introuvable")
    } finally {
      setAddingPlaylist(false)
    }
  }

  function commitAccess(password: string, allowLateJoin: boolean) {
    if (!isHostRef.current) return
    send({ type: "lobby:access", password, allowLateJoin })
  }

  function leaveLobby() {
    send({ type: "leave" })
    clearSession(code!)
    navigate("/", { replace: true })
  }

  function saveAvatar(avatarSeed: string) {
    setAvatar(avatarSeed)
    setEditingAvatar(false)
    setPlayers((prev) => prev.map((p) => (p.id === session?.playerId ? { ...p, avatarSeed } : p)))
    send({ type: "player:avatar", avatarSeed })
  }

  function handleStart() {
    if (!playlistCount() || preparing) return
    setError("")
    send({ type: "lobby:start", settings: { ...settingsRef.current, trackCount } })
  }

  function flashCopied(kind: "code" | "link") {
    setCopied(kind)
    setTimeout(() => setCopied(null), 1500)
  }

  function copyCode() {
    void navigator.clipboard.writeText(code ?? "")
    flashCopied("code")
  }

  async function shareInvite() {
    const url = inviteUrl(code ?? "")
    // Native share sheet on mobile, clipboard everywhere else
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Blindtest", text: "Rejoins ma partie de blindtest !", url })
        return
      } catch {
        // Dismissed or unsupported payload: fall back to the clipboard
      }
    }
    await navigator.clipboard.writeText(url).catch(() => {})
    flashCopied("link")
  }

  // Someone opening the lobby URL directly just needs a pseudo first
  if (!session) return <Navigate to={`/join/${code}`} replace />

  return (
    <div className="min-h-screen bg-canvas px-4 py-6 lg:py-8">
      <div className="w-full max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <p className="text-muted text-sm font-medium uppercase tracking-widest mb-1">Code du salon</p>
            <div className="flex items-center gap-3">
              <span className="text-5xl font-black text-ink tracking-widest font-mono">{code}</span>
              <button
                onClick={copyCode}
                aria-label="Copier le code"
                className="text-muted hover:text-accent transition-colors p-1"
              >
                {copied === "code" ? <Check size={20} /> : <Copy size={20} />}
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void shareInvite()}
                className="flex items-center gap-2 text-sm font-semibold bg-accent text-white px-4 py-2 rounded-xl hover:opacity-90 transition-opacity"
              >
                {copied === "link" ? <Check size={16} weight="bold" /> : <ShareNetwork size={16} weight="bold" />}
                {copied === "link" ? "Lien copié !" : "Inviter des amis"}
              </button>
              <button
                type="button"
                onClick={leaveLobby}
                className="inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-red-500 px-3 py-2 rounded-xl transition-colors"
              >
                <SignOut size={16} weight="bold" />
                Quitter
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-muted"}`} />
              <span className="text-muted">{connected ? "Connecté" : "Connexion..."}</span>
            </div>
            <SettingsMenu />
          </div>
        </div>

        <div className="grid gap-6 items-start lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.5fr)_minmax(0,0.85fr)_minmax(0,1fr)]">
        {/* Colonne 1 : mode et playlists */}
        <div className="min-w-0">
        {/* Mode de jeu */}
        <section className="mb-6">
          <div className="grid grid-cols-2 gap-2">
            {[
              {
                mode: GameMode.Classic,
                icon: <MusicNotes size={20} weight="bold" />,
                title: "Classique",
                text: "Trouve l'artiste et le titre",
              },
              {
                mode: GameMode.Anime,
                icon: <Television size={20} weight="bold" />,
                title: "Animé",
                text: "Trouve l'animé de l'opening / ending",
              },
            ].map((option) => {
              const active = settings.mode === option.mode
              return (
                <button
                  key={option.mode}
                  type="button"
                  onClick={() => switchMode(option.mode)}
                  disabled={!isHost}
                  className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all disabled:cursor-default ${
                    active
                      ? "border-accent bg-accent/5 text-accent"
                      : "border-edge bg-surface text-muted hover:border-muted disabled:hover:border-edge"
                  }`}
                >
                  {option.icon}
                  <div className="min-w-0">
                    <p className="font-semibold text-ink text-sm">{option.title}</p>
                    <p className="text-xs text-muted truncate">{option.text}</p>
                  </div>
                </button>
              )
            })}
          </div>
          {isAnime && (
            <p className="mt-2 text-xs text-muted">
              Seuls les titres reconnus comme opening ou ending sur AnimeThemes sont joués. Noms japonais, anglais,
              français et abréviations acceptés ; plus tu trouves vite, plus ça rapporte. Bonus pour l'auteur.
            </p>
          )}
        </section>

        {/* Playlists */}
        <section className="mb-6">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <MusicNotes size={18} className="text-accent" />
              Playlists
            </h3>
            <span className="text-xs text-muted">
              {playlistCount()} sélectionnée{playlistCount() > 1 ? "s" : ""} · {availableTracks} titres
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {playlists?.map((p) => {
              const active = settings.playlistIds.includes(p.id)
              return (
                <button
                  key={p.id}
                  onClick={() => togglePlaylist(p.id)}
                  disabled={!isHost}
                  className={`relative flex items-center gap-3 p-2 pr-3 rounded-xl border text-left transition-all disabled:cursor-default ${
                    active
                      ? "border-accent bg-accent/5"
                      : "border-edge bg-surface hover:border-muted disabled:hover:border-edge"
                  }`}
                >
                  <div className="w-11 h-11 shrink-0 rounded-lg bg-edge overflow-hidden">
                    {p.coverUrl ? (
                      <img src={p.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <MusicNotes size={18} className="text-muted" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink text-sm leading-tight truncate">{p.name}</p>
                    <p className="text-xs text-muted">{p.trackCount} titres</p>
                  </div>
                  {active && <Check size={15} weight="bold" className="text-accent shrink-0" />}
                </button>
              )
            })}
            {settings.customDeezerPlaylistIds.map((id) => {
              const meta = customMetas.find((p) => p.id === id)
              const removable = isHost && playlistCount() > 1
              return (
                <div
                  key={id}
                  className="relative flex items-center gap-3 p-2 pr-3 rounded-xl border text-left border-accent bg-accent/5"
                >
                  <div className="w-11 h-11 shrink-0 rounded-lg bg-edge overflow-hidden">
                    {meta?.coverUrl ? (
                      <img src={meta.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <MusicNotes size={18} className="text-muted" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink text-sm leading-tight truncate">
                      {meta?.name ?? "Playlist Deezer"}
                    </p>
                    <p className="text-xs text-muted">{meta ? `${meta.trackCount} titres` : "…"}</p>
                  </div>
                  {removable ? (
                    <button
                      type="button"
                      onClick={() => removeCustom(id)}
                      aria-label="Retirer la playlist"
                      title="Retirer la playlist"
                      className="text-muted hover:text-red-500 transition-colors shrink-0"
                    >
                      <X size={15} weight="bold" />
                    </button>
                  ) : (
                    <Check size={15} weight="bold" className="text-accent shrink-0" />
                  )}
                </div>
              )
            })}
          </div>

          {isHost && (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void addCustomPlaylist()
              }}
            >
              <input
                value={playlistUrl}
                onChange={(event) => setPlaylistUrl(event.target.value)}
                placeholder="https://www.deezer.com/playlist/..."
                className="flex-1 min-w-0 border-2 border-edge rounded-xl px-4 py-2.5 text-sm text-ink focus:outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={addingPlaylist || !playlistUrl.trim()}
                className="shrink-0 bg-inverse text-inverse-ink px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
              >
                {addingPlaylist ? "…" : "Ajouter"}
              </button>
            </form>
          )}
        </section>
        </div>

        {/* Colonnes 2 et 3 : empilées sur écran moyen, côte à côte sur grand écran */}
        <div className="flex flex-col gap-6 min-w-0 xl:contents">
          {/* Joueurs */}
          <div className="bg-surface rounded-2xl p-5 border border-edge">
            <div className="flex items-center gap-2 mb-4">
              <Users size={18} className="text-accent" />
              <h3 className="font-semibold text-ink">Joueurs ({players.length})</h3>
            </div>
            <ul className="flex flex-col gap-2">
              {players.map((p, i) => (
                <li key={p.id} className={`flex items-center gap-3 ${p.connected ? "" : "opacity-60"}`}>
                  <span className="text-xs text-muted w-4">{i + 1}</span>
                  <Avatar
                    name={p.avatarSeed || p.name}
                    size={48}
                    status={p.connected ? PlayerStatus.Online : PlayerStatus.Offline}
                    onEdit={p.id === session.playerId ? () => setEditingAvatar(true) : undefined}
                  />
                  <span className="font-medium text-ink">{p.name}</span>
                  {p.id === hostId && (
                    <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full ml-auto">Hôte</span>
                  )}
                  {p.id === session.playerId && p.id !== hostId && (
                    <span className="text-xs bg-edge text-muted px-2 py-0.5 rounded-full ml-auto">Vous</span>
                  )}
                </li>
              ))}
              {players.length === 0 && <li className="text-muted text-sm">En attente de connexion...</li>}
            </ul>
          </div>

          {/* Paramètres et lancement */}
          <div className="flex flex-col gap-4 min-w-0">
          <div className="bg-surface rounded-2xl p-5 border border-edge">
            <div className="flex items-center gap-2 mb-4">
              <h3 className="font-semibold text-ink">Paramètres</h3>
              {!isHost && <span className="text-xs text-muted ml-auto">Configuré par l'hôte</span>}
            </div>

            <div className="flex flex-col gap-4">
              <Setting
                label="Nombre de musiques"
                value={trackCount}
                display={`${trackCount}${trackCount >= maxTracks ? " (max)" : ""}`}
                min={TRACK_COUNT_STEP}
                max={maxTracks}
                step={TRACK_COUNT_STEP}
                disabled={!isHost}
                onChange={(v) => updateSetting("trackCount", v)}
              />
              <Setting
                label="Durée par manche"
                value={settings.roundDuration}
                display={`${settings.roundDuration}s`}
                min={5}
                max={MAX_ROUND_DURATION}
                step={5}
                disabled={!isHost}
                onChange={(v) => updateSetting("roundDuration", v)}
              />
              <Setting
                label="Erreur acceptée"
                value={settings.maxErrorPercent}
                display={`${settings.maxErrorPercent}%`}
                min={0}
                max={40}
                step={5}
                disabled={!isHost}
                onChange={(v) => updateSetting("maxErrorPercent", v)}
              />
              <Setting
                label="Essais année"
                value={settings.yearGuessAttempts}
                display={String(settings.yearGuessAttempts)}
                min={0}
                max={5}
                step={1}
                disabled={!isHost}
                onChange={(v) => updateSetting("yearGuessAttempts", v)}
              />

              {/* Anime mode has no early hint: it would give the airing year away */}
              {!isAnime && (
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={settings.showArtistHint}
                    disabled={!isHost}
                    onChange={(e) => updateSetting("showArtistHint", e.target.checked)}
                    className="w-4 h-4 accent-accent disabled:opacity-60"
                  />
                  <span className="text-xs text-muted font-medium uppercase tracking-wider transition-colors group-hover:text-ink">
                    Indice sur l'artiste en cours de manche
                  </span>
                </label>
              )}

              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={settings.showHint}
                  disabled={!isHost}
                  onChange={(e) => updateSetting("showHint", e.target.checked)}
                  className="w-4 h-4 accent-accent disabled:opacity-60"
                />
                <span className="text-xs text-muted font-medium uppercase tracking-wider transition-colors group-hover:text-ink">
                  {isAnime ? "Indice sur le nom de l'animé en fin de manche" : "Indice sur le titre en fin de manche"}
                </span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={settings.showLyrics}
                  disabled={!isHost}
                  onChange={(e) => updateSetting("showLyrics", e.target.checked)}
                  className="w-4 h-4 accent-accent disabled:opacity-60"
                />
                <span className="text-xs text-muted font-medium uppercase tracking-wider transition-colors group-hover:text-ink">
                  Afficher les paroles au résultat
                </span>
              </label>

              {/* Accès au salon */}
              <div className="pt-4 border-t border-edge flex flex-col gap-3">
                <p className="text-xs text-muted font-medium uppercase tracking-wider flex items-center gap-1.5">
                  <LockSimple size={13} weight="bold" />
                  Accès
                </p>
                {isHost ? (
                  <input
                    type="text"
                    value={passwordDraft}
                    onChange={(e) => setPasswordDraft(e.target.value)}
                    onBlur={() => commitAccess(passwordDraft, access.allowLateJoin)}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    placeholder="Mot de passe (vide = salon ouvert)"
                    maxLength={LOBBY_PASSWORD_MAX_LENGTH}
                    className="w-full border border-edge bg-surface rounded-xl px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
                  />
                ) : (
                  <p className="text-sm text-ink">{access.hasPassword ? "Protégé par mot de passe" : "Salon ouvert"}</p>
                )}
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={access.allowLateJoin}
                    disabled={!isHost}
                    onChange={(e) => commitAccess(passwordDraft, e.target.checked)}
                    className="w-4 h-4 accent-accent disabled:opacity-60"
                  />
                  <span className="text-xs text-muted font-medium uppercase tracking-wider transition-colors group-hover:text-ink">
                    Autoriser à rejoindre pendant la partie
                  </span>
                </label>
              </div>
            </div>
          </div>
    {error && <p className="text-center text-red-500 text-sm">{error}</p>}

    {isHost ? (
      <button
        onClick={handleStart}
        disabled={!playlistCount() || preparing}
        className="w-full flex items-center justify-center gap-3 bg-inverse text-inverse-ink py-4 rounded-2xl font-bold text-lg hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {preparing ? (
          <CircleNotch size={22} weight="bold" className="animate-spin" />
        ) : (
          <Play size={22} weight="fill" />
        )}
        {preparing ? "Préparation de la partie…" : "Lancer la partie"}
      </button>
    ) : (
      <p className="text-center text-muted text-sm flex items-center justify-center gap-2">
        {preparing && <CircleNotch size={16} weight="bold" className="animate-spin" />}
        {preparing ? "Préparation de la partie…" : "En attente que l'hôte lance la partie…"}
      </p>
    )}
    {preparing && isAnime && (
      <p className="-mt-2 text-center text-xs text-muted">
        Recherche des génériques d'animés, la partie démarre dès que le premier est prêt.
      </p>
    )}
          </div>
        </div>
        </div>

        {editingAvatar && (
          <AvatarEditor value={profile.avatarSeed} onClose={() => setEditingAvatar(false)} onSave={saveAvatar} />
        )}

        <LegalFooter className="mt-6" />
      </div>
    </div>
  )
}

function Setting({
  label,
  value,
  display,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  disabled: boolean
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-xs text-muted font-medium uppercase tracking-wider">{label}</label>
        <span className="text-sm font-bold text-ink tabular-nums">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent disabled:opacity-60"
      />
    </div>
  )
}
