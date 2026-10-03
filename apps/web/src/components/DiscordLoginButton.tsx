import { Link } from "react-router-dom"
import { CaretRight, DiscordLogo } from "@phosphor-icons/react"
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
    <div className={`flex flex-col items-center gap-1.5 ${className}`}>
      <a
        href={discordLoginUrl()}
        className="inline-flex items-center gap-2 bg-[#5865F2] text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 transition-opacity"
      >
        <DiscordLogo size={18} weight="fill" />
        Se connecter avec Discord
      </a>
      <p className="text-xs text-muted">Facultatif : garde ton historique, tes succès et tes amis</p>
    </div>
  )
}
