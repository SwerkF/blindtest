import { Link } from "react-router-dom"
import { DiscordLogo, SignOut, UserCircle } from "@phosphor-icons/react"
import { useAuth } from "@/hooks/useAuth"
import { discordLoginUrl } from "@/utils/accountApi"

/** Account block of the gear menu: profile link and logout, or the Discord login. */
export default function AccountMenuSection({ onNavigate }: { onNavigate?: () => void }) {
  const { user, discordEnabled, logout } = useAuth()

  if (!user) {
    if (!discordEnabled) return null
    return (
      <div className="mt-4 pt-3 border-t border-edge">
        <p className="text-xs text-muted font-medium uppercase tracking-wider mb-2">Compte</p>
        <a
          href={discordLoginUrl()}
          className="flex items-center justify-center gap-2 w-full bg-[#5865F2] text-white text-sm font-semibold px-3 py-2 rounded-xl hover:opacity-90 transition-opacity"
        >
          <DiscordLogo size={16} weight="fill" />
          Se connecter avec Discord
        </a>
      </div>
    )
  }

  return (
    <div className="mt-4 pt-3 border-t border-edge">
      <p className="text-xs text-muted font-medium uppercase tracking-wider mb-2">Compte</p>
      <div className="flex items-center gap-2.5 mb-2">
        <img src={user.discordAvatarUrl} alt="" className="w-8 h-8 rounded-full" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink truncate">{user.pseudo}</p>
          <p className="text-xs text-muted truncate">@{user.username}</p>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Link
          to="/profil"
          onClick={onNavigate}
          className="flex items-center gap-2 text-sm text-ink px-2 py-1.5 rounded-lg hover:bg-edge/50 transition-colors"
        >
          <UserCircle size={16} />
          Mon profil
        </Link>
        <button
          type="button"
          onClick={() => {
            onNavigate?.()
            void logout()
          }}
          className="flex items-center gap-2 text-sm text-muted hover:text-red-500 px-2 py-1.5 rounded-lg hover:bg-edge/50 transition-colors text-left"
        >
          <SignOut size={16} />
          Se déconnecter
        </button>
      </div>
    </div>
  )
}
