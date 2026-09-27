import { useState } from "react"
import { useNavigate, Link } from "react-router-dom"
import { MusicNote, ArrowRight, Link as LinkIcon, Shuffle } from "@phosphor-icons/react"
import { api, saveSession } from "@/utils/api"
import { loadHistory, type GameHistoryEntry } from "@/utils/storage"
import { useProfile } from "@/hooks/useProfile"
import Avatar from "@/components/Avatar"
import ThemeToggle from "@/components/ThemeToggle"

type Mode = "idle" | "create" | "join"

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
  const { profile, setName, reroll } = useProfile()
  const [history] = useState<GameHistoryEntry[]>(loadHistory)
  const [mode, setMode] = useState<Mode>("idle")
  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleCreate() {
    if (!profile.name.trim()) return setError("Entre ton pseudo")
    setLoading(true)
    setError("")
    try {
      const res = await api.createLobby(profile.name.trim(), profile.avatarSeed)
      saveSession(res.code, res.playerId, res.playerName)
      navigate(`/lobby/${res.code}`)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  async function handleJoin() {
    if (!profile.name.trim()) return setError("Entre ton pseudo")
    if (!code.trim()) return setError("Entre un code")
    setLoading(true)
    setError("")
    try {
      const res = await api.joinLobby(code.trim().toUpperCase(), profile.name.trim(), profile.avatarSeed)
      saveSession(res.code, res.playerId, res.playerName)
      navigate(`/lobby/${res.code}`)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-4 py-12 relative">
      <div className="absolute top-5 right-5">
        <ThemeToggle />
      </div>

      <div className="mb-10 text-center">
        <div className="flex items-center justify-center gap-3 mb-4">
          <MusicNote size={40} weight="duotone" className="text-accent" />
          <h1 className="text-6xl font-black tracking-tight text-ink">BLINDTEST</h1>
        </div>
        <p className="text-muted text-lg font-medium tracking-widest uppercase">Devine l'artiste · le titre · l'année</p>
      </div>

      <div className="w-full max-w-md">
        {mode === "idle" && (
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => setMode("create")}
              className="group flex items-center justify-between bg-inverse text-inverse-ink px-8 py-5 rounded-2xl font-semibold text-lg hover:opacity-90 transition-opacity"
            >
              <span>Créer une partie</span>
              <ArrowRight size={22} className="group-hover:translate-x-1 transition-transform" />
            </button>
            <button
              type="button"
              onClick={() => setMode("join")}
              className="group flex items-center justify-between border-2 border-muted text-ink px-8 py-5 rounded-2xl font-semibold text-lg hover:border-accent hover:text-accent transition-colors"
            >
              <span>Rejoindre une partie</span>
              <ArrowRight size={22} className="group-hover:translate-x-1 transition-transform" />
            </button>
            <Link
              to="/suggest"
              className="flex items-center justify-center gap-2 text-muted text-sm mt-4 hover:text-accent transition-colors"
            >
              <LinkIcon size={14} />
              Soumettre une playlist
            </Link>
          </div>
        )}

        {(mode === "create" || mode === "join") && (
          <div className="bg-surface rounded-2xl p-8 shadow-sm border border-edge">
            <button
              type="button"
              onClick={() => {
                setMode("idle")
                setError("")
              }}
              className="text-muted text-sm mb-6 hover:text-ink transition-colors"
            >
              ← Retour
            </button>

            <h2 className="text-2xl font-bold text-ink mb-6">
              {mode === "create" ? "Créer une partie" : "Rejoindre une partie"}
            </h2>

            <div className="flex flex-col items-center gap-3 mb-6">
              <Avatar name={profile.avatarSeed} size={160} onReroll={reroll} />
              <button
                type="button"
                onClick={reroll}
                className="flex items-center gap-1.5 text-sm text-muted hover:text-accent transition-colors"
              >
                <Shuffle size={16} />
                Changer d'avatar
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-muted mb-2">Pseudo</label>
                <input
                  value={profile.name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (mode === "create" ? handleCreate() : handleJoin())}
                  placeholder="Ton pseudo..."
                  maxLength={20}
                  autoFocus
                  className="w-full border-2 border-edge rounded-xl px-4 py-3 text-ink font-medium focus:outline-none focus:border-accent transition-colors"
                />
              </div>

              {mode === "join" && (
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">Code du salon</label>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                    placeholder="ABC123"
                    maxLength={6}
                    className="w-full border-2 border-edge rounded-xl px-4 py-3 text-ink font-mono font-bold text-lg tracking-widest focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
              )}

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <button
                type="button"
                onClick={mode === "create" ? handleCreate : handleJoin}
                disabled={loading}
                className="bg-accent text-white px-6 py-3 rounded-xl font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 mt-2"
              >
                {loading ? "..." : mode === "create" ? "Créer le salon" : "Rejoindre"}
              </button>
            </div>
          </div>
        )}

        {history.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xs font-semibold text-muted uppercase tracking-widest mb-3">Historique</h2>
            <ul className="flex flex-col gap-2">
              {history.map((entry) => (
                <li key={`${entry.playedAt}-${entry.code}`}>
                  <details className="bg-surface border border-edge rounded-xl px-4 py-3">
                    <summary className="cursor-pointer text-sm text-ink font-medium">
                      {formatPlayedAt(entry.playedAt)} · #{entry.rank}/{entry.playerCount} · {entry.score} pts
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
          </section>
        )}
      </div>
    </div>
  )
}
