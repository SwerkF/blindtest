import { Link } from "react-router-dom"
import { CaretRight } from "@phosphor-icons/react"
import DiscordIcon from "@/components/DiscordIcon"
import { useAuth } from "@/hooks/useAuth"
import { discordLoginUrl } from "@/utils/accountApi"

/** Optional login on the home page; guests can ignore it and play right away. */
export default function DiscordLoginButton({ className = "" }: { className?: string }) {
  const { user, discordEnabled, loading } = useAuth()
  if (loading) return null

  if (user) {
    return (
      <Link
        to="/profil"
        className={`flex items-center gap-2.5 text-sm text-muted hover:text-accent transition-colors ${className}`}
      >
        <img src={user.discordAvatarUrl} alt="" className="w-6 h-6 rounded-full" />
        <span>
          Connecté en tant que <span className="font-semibold text-ink">{user.username}</span>
        </span>
        <CaretRight size={14} weight="bold" />
      </Link>
    )
  }

  if (!discordEnabled) return null
  return (
    <div className={`w-full flex flex-col items-center gap-3 ${className}`}>
      <div className="w-full flex items-center gap-3 text-xs font-medium text-muted uppercase tracking-wider">
        <span className="flex-1 h-px bg-edge" />
        ou
        <span className="flex-1 h-px bg-edge" />
      </div>
      <a
        href={discordLoginUrl()}
        className="w-full flex items-center justify-center gap-2.5 bg-[#5865F2] text-white font-semibold px-4 py-3 rounded-xl hover:opacity-90 transition-opacity"
      >
        <DiscordIcon size={22} />
        Se connecter avec Discord
      </a>
      <p className="text-xs text-muted text-center">Facultatif : garde ton historique, tes succès et tes amis</p>
    </div>
  )
}
