import type { ReactNode } from "react"
import type { PublicUser } from "@blindmusic/shared"
import Avatar, { PlayerStatus } from "@/components/Avatar"
import { useOpenUserProfile } from "@/hooks/useOpenUserProfile"

interface UserChipProps {
  user: PublicUser
  /** Shows the presence dot when set. */
  online?: boolean
  subtitle?: ReactNode
  children?: ReactNode
  /** Avatar and name open the public profile (drawer in rooms, /u/:id elsewhere). */
  linkProfile?: boolean
}

/** One account in a list: Blobatar (or Discord picture), pseudo, Discord name and actions. */
export default function UserChip({ user, online, subtitle, children, linkProfile = true }: UserChipProps) {
  const status = online === undefined ? undefined : online ? PlayerStatus.Online : PlayerStatus.Offline
  const openUserProfile = useOpenUserProfile()
  const identity = (
    <>
      <Avatar
        name={user.avatarSeed || user.pseudo}
        size={40}
        status={status}
        imageUrl={user.useDiscordAvatar || !user.avatarSeed ? user.discordAvatarUrl : null}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink truncate group-hover:underline decoration-accent decoration-2 underline-offset-2">
          {user.pseudo}
        </p>
        <p className="text-xs text-muted truncate">
          {subtitle ?? (
            <>
              @{user.username}
              {online !== undefined && (online ? " · En ligne" : " · Hors ligne")}
            </>
          )}
        </p>
      </div>
    </>
  )
  return (
    <div className="flex items-center gap-3 bg-canvas/60 border border-edge rounded-xl px-3 py-2">
      {linkProfile ? (
        <button
          type="button"
          onClick={() => openUserProfile(user.id)}
          title={`Voir le profil de ${user.pseudo}`}
          className="flex-1 min-w-0 flex items-center gap-3 text-left rounded-lg group"
        >
          {identity}
        </button>
      ) : (
        <div className="flex-1 min-w-0 flex items-center gap-3">{identity}</div>
      )}
      {children && <div className="flex items-center gap-1.5 shrink-0">{children}</div>}
    </div>
  )
}
