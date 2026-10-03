import { useEffect } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft } from "@phosphor-icons/react"
import SettingsMenu from "@/components/SettingsMenu"
import LegalFooter from "@/components/LegalFooter"
import PublicProfileView, { usePublicProfile } from "@/components/PublicProfileView"

const DEFAULT_TITLE = document.title

/** /u/:id — a player's public profile, the page shared as a link (see the OG card in nginx.conf). */
export default function UserProfile() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const { data } = usePublicProfile(id)

  useEffect(() => {
    if (!data) return
    document.title = `Profil de ${data.user.pseudo} · Blindtest`
    return () => {
      document.title = DEFAULT_TITLE
    }
  }, [data])

  return (
    <div className="min-h-screen bg-canvas px-4 py-6 sm:py-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted hover:text-accent transition-colors"
          >
            <ArrowLeft size={16} weight="bold" />
            Accueil
          </Link>
          <SettingsMenu />
        </div>
        <PublicProfileView userId={id} onOpenOwnProfile={() => navigate("/profil")} />
        <LegalFooter className="mt-8" />
      </div>
    </div>
  )
}
