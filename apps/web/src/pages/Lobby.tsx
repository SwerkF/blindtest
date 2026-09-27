import { useEffect, useMemo, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Users, Play, Copy, Check, MusicNotes } from "@phosphor-icons/react"
import {
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
import { api, loadSession, type PlaylistItem } from "@/utils/api"
import Avatar from "@/components/Avatar"
import ThemeToggle from "@/components/ThemeToggle"

const DEFAULT_SETTINGS: LobbySettings = {
  playlistIds: [],
  customDeezerPlaylistIds: [],
  trackCount: 10,
  roundDuration: 30,
  maxErrorPercent: 20,
  yearGuessAttempts: 2,
  showLyrics: false,
  showHint: true,
}

function normalizeSettings(settings: LobbySettings): LobbySettings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    playlistIds: settings.playlistIds ?? [],
    customDeezerPlaylistIds: settings.customDeezerPlaylistIds ?? [],
  }
}

export default function Lobby() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const session = loadSession(code!)
  const { send, onMessage, connected } = useWs(code ?? "", session?.playerId ?? "")

  const [players, setPlayers] = useState<PlayerPublic[]>([])
  const [settings, setSettings] = useState<LobbySettings>(DEFAULT_SETTINGS)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState("")
  const [playlistUrl, setPlaylistUrl] = useState("")
  const [addingPlaylist, setAddingPlaylist] = useState(false)
  const { reroll } = useProfile()

  const isHost = players[0]?.id === session?.playerId

  const { data: playlists } = useQuery<PlaylistItem[]>({
    queryKey: ["playlists"],
    queryFn: api.playlists,
  })

  const { data: customMetas } = useQuery<DeezerPlaylistMeta[]>({
    queryKey: ["deezer-playlists", settings.customDeezerPlaylistIds],
    enabled: settings.customDeezerPlaylistIds.length > 0,
    queryFn: async () => {
      const metas: DeezerPlaylistMeta[] = []
      for (const id of settings.customDeezerPlaylistIds) {
        try {
          metas.push(await api.deezerPlaylist(id))
        } catch {
          metas.push({ id, name: "Playlist Deezer", coverUrl: null, trackCount: 0 })
        }
      }
      return metas
    },
  })

  // Preselect the first playlist so a host can start immediately
  useEffect(() => {
    if (!playlists?.length) return
    setSettings((current) => {
      if (current.playlistIds.length || current.customDeezerPlaylistIds.length) return current
      return { ...current, playlistIds: [playlists[0].id] }
    })
  }, [playlists])

  const availableTracks = useMemo(() => {
    const curated =
      playlists
        ?.filter((p) => settings.playlistIds.includes(p.id))
        .reduce((sum, p) => sum + p.trackCount, 0) ?? 0
    const custom =
      customMetas
        ?.filter((p) => settings.customDeezerPlaylistIds.includes(p.id))
        .reduce((sum, p) => sum + p.trackCount, 0) ?? 0
    return curated + custom
  }, [playlists, customMetas, settings.playlistIds, settings.customDeezerPlaylistIds])

  // Cap the slider to what the selected playlists can actually deliver
  const maxTracks = useMemo(() => {
    const cap = Math.min(MAX_TRACK_COUNT, availableTracks)
    return Math.max(TRACK_COUNT_STEP, Math.floor(cap / TRACK_COUNT_STEP) * TRACK_COUNT_STEP)
  }, [availableTracks])

  useEffect(() => {
    if (settings.trackCount > maxTracks) updateSetting("trackCount", maxTracks)
  }, [maxTracks])

  useEffect(() => {
    return onMessage((msg) => {
      switch (msg.type) {
        case "lobby:update":
          setPlayers(msg.players)
          if (msg.settings) setSettings(normalizeSettings(msg.settings))
          if (msg.phase === GamePhase.Playing) navigate(`/game/${code}`)
          break
        case "game:start":
          // The game page picks the countdown back up from the same timestamp
          navigate(`/game/${code}`)
          break
        case "error":
          setError(msg.message)
          break
        default:
          break
      }
    })
  }, [onMessage, navigate, code])

  function updateSetting<K extends keyof LobbySettings>(key: K, value: LobbySettings[K]) {
    const next = { ...settings, [key]: value }
    setSettings(next)
    if (isHost) send({ type: "lobby:settings", settings: next })
  }

  function playlistCount() {
    return settings.playlistIds.length + settings.customDeezerPlaylistIds.length
  }

  function togglePlaylist(id: string) {
    if (!isHost) return
    const has = settings.playlistIds.includes(id)
    if (has && settings.playlistIds.length === 1 && settings.customDeezerPlaylistIds.length === 0) return
    updateSetting("playlistIds", has ? settings.playlistIds.filter((p) => p !== id) : [...settings.playlistIds, id])
  }

  function removeCustom(id: string) {
    if (!isHost) return
    const next = settings.customDeezerPlaylistIds.filter((p) => p !== id)
    if (next.length === 0 && settings.playlistIds.length === 0) return
    updateSetting("customDeezerPlaylistIds", next)
  }

  async function addCustomPlaylist() {
    if (!isHost || addingPlaylist) return
    const id = parseDeezerPlaylistId(playlistUrl)
    if (!id) {
      setError("Colle un lien de playlist Deezer")
      return
    }
    if (settings.customDeezerPlaylistIds.includes(id)) {
      setPlaylistUrl("")
      return
    }
    setAddingPlaylist(true)
    setError("")
    try {
      await api.deezerPlaylist(id)
      updateSetting("customDeezerPlaylistIds", [...settings.customDeezerPlaylistIds, id])
      setPlaylistUrl("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Playlist introuvable")
    } finally {
      setAddingPlaylist(false)
    }
  }

  function handleReroll() {
    const avatarSeed = reroll()
    setPlayers((prev) => prev.map((p) => (p.id === session?.playerId ? { ...p, avatarSeed } : p)))
    send({ type: "player:avatar", avatarSeed })
  }

  function handleStart() {
    if (!playlistCount()) return
    setError("")
    send({ type: "lobby:start", settings })
  }

  function copyCode() {
    navigator.clipboard.writeText(code ?? "")
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <p className="text-muted">
          Session expirée.{" "}
          <a href="/" className="text-accent">
            Retour à l'accueil
          </a>
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-canvas px-4 py-12">
      <div className="w-full max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-10">
          <div>
            <p className="text-muted text-sm font-medium uppercase tracking-widest mb-1">Code du salon</p>
            <div className="flex items-center gap-3">
              <span className="text-5xl font-black text-ink tracking-widest font-mono">{code}</span>
              <button onClick={copyCode} className="text-muted hover:text-accent transition-colors p-1">
                {copied ? <Check size={20} /> : <Copy size={20} />}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-muted"}`} />
              <span className="text-muted">{connected ? "Connecté" : "Connexion..."}</span>
            </div>
            <ThemeToggle />
          </div>
        </div>

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
              const meta = customMetas?.find((p) => p.id === id)
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => removeCustom(id)}
                  disabled={!isHost}
                  className="relative flex items-center gap-3 p-2 pr-3 rounded-xl border text-left border-accent bg-accent/5 disabled:cursor-default"
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
                  <Check size={15} weight="bold" className="text-accent shrink-0" />
                </button>
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Joueurs */}
          <div className="bg-surface rounded-2xl p-6 border border-edge">
            <div className="flex items-center gap-2 mb-4">
              <Users size={18} className="text-accent" />
              <h3 className="font-semibold text-ink">Joueurs ({players.length})</h3>
            </div>
            <ul className="flex flex-col gap-2">
              {players.map((p, i) => (
                <li key={p.id} className={`flex items-center gap-3 ${p.connected ? "" : "opacity-40"}`}>
                  <span className="text-xs text-muted w-4">{i + 1}</span>
                  <Avatar
                    name={p.avatarSeed || p.name}
                    size={48}
                    onReroll={p.id === session.playerId ? handleReroll : undefined}
                  />
                  <span className="font-medium text-ink">{p.name}</span>
                  {i === 0 && (
                    <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full ml-auto">Hôte</span>
                  )}
                  {p.id === session.playerId && i !== 0 && (
                    <span className="text-xs bg-edge text-muted px-2 py-0.5 rounded-full ml-auto">Vous</span>
                  )}
                </li>
              ))}
              {players.length === 0 && <li className="text-muted text-sm">En attente de connexion...</li>}
            </ul>
          </div>

          {/* Paramètres */}
          <div className="bg-surface rounded-2xl p-6 border border-edge">
            <div className="flex items-center gap-2 mb-4">
              <h3 className="font-semibold text-ink">Paramètres</h3>
              {!isHost && <span className="text-xs text-muted ml-auto">Configuré par l'hôte</span>}
            </div>

            <div className="flex flex-col gap-5">
              <Setting
                label="Nombre de musiques"
                value={settings.trackCount}
                display={`${settings.trackCount}${settings.trackCount >= maxTracks ? " (max)" : ""}`}
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

              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={settings.showHint}
                  disabled={!isHost}
                  onChange={(e) => updateSetting("showHint", e.target.checked)}
                  className="w-4 h-4 accent-accent disabled:opacity-60"
                />
                <span className="text-xs text-muted font-medium uppercase tracking-wider transition-colors group-hover:text-ink">
                  Indice sur le titre en fin de manche
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
            </div>
          </div>
        </div>

        {error && <p className="mt-4 text-center text-red-500 text-sm">{error}</p>}

        {isHost ? (
          <button
            onClick={handleStart}
            disabled={!playlistCount()}
            className="mt-6 w-full flex items-center justify-center gap-3 bg-inverse text-inverse-ink py-4 rounded-2xl font-bold text-lg hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            <Play size={22} weight="fill" />
            Lancer la partie
          </button>
        ) : (
          <p className="mt-6 text-center text-muted text-sm">En attente que l'hôte lance la partie…</p>
        )}
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
