import { useState } from "react"
import { Link } from "react-router-dom"
import { MusicNote, CheckCircle } from "@phosphor-icons/react"
import { api } from "@/utils/api"

export default function Suggest() {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    if (!name.trim() || !url.trim()) return
    setLoading(true)
    try {
      await api.suggestPlaylist(name.trim(), url.trim())
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="text-muted text-sm hover:text-accent transition-colors block mb-8">
          ← Retour
        </Link>

        {sent ? (
          <div className="text-center">
            <CheckCircle size={56} weight="duotone" className="text-accent mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-ink mb-2">Merci !</h2>
            <p className="text-muted">On examinera ta playlist avec plaisir.</p>
            <button
              onClick={() => { setSent(false); setName(""); setUrl("") }}
              className="mt-6 text-accent text-sm hover:underline"
            >
              Soumettre une autre
            </button>
          </div>
        ) : (
          <div className="bg-surface rounded-2xl p-8 border border-edge">
            <div className="flex items-center gap-3 mb-6">
              <MusicNote size={24} weight="duotone" className="text-accent" />
              <h2 className="text-2xl font-bold text-ink">Suggérer une playlist</h2>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-muted mb-2">Nom de la playlist</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Hits R&B 2015"
                  className="w-full border-2 border-edge rounded-xl px-4 py-3 text-ink focus:outline-none focus:border-accent transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-2">Lien Deezer</label>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.deezer.com/playlist/..."
                  className="w-full border-2 border-edge rounded-xl px-4 py-3 text-ink focus:outline-none focus:border-accent transition-colors"
                />
              </div>
              <button
                onClick={handleSubmit}
                disabled={!name.trim() || !url.trim() || loading}
                className="bg-accent text-white px-6 py-3 rounded-xl font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 mt-2"
              >
                {loading ? "Envoi…" : "Envoyer"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
