import type { ReactNode } from "react"
import type { PublicUser } from "@blindmusic/shared"
import Avatar, { PlayerStatus } from "@/components/Avatar"

interface UserChipProps {
  user: PublicUser
  /** Shows the presence dot when set. */
  online?: boolean
  subtitle?: ReactNode
  children?: ReactNode
}

/** One account in a list: Blobatar (or Discord picture), pseudo, Discord name and actions. */
export default function UserChip({ user, online, subtitle, children }: UserChipProps) {
  const status = online === undefined ? undefined : online ? PlayerStatus.Online : PlayerStatus.Offline
  return (
    <div className="flex items-center gap-3 bg-canvas/60 border border-edge rounded-xl px-3 py-2">
      {user.avatarSeed ? (
        <Avatar name={user.avatarSeed} size={40} status={status} />
      ) : (
        <img src={user.discordAvatarUrl} alt="" className="w-10 h-10 rounded-full shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink truncate">{user.pseudo}</p>
        <p className="text-xs text-muted truncate">
          {subtitle ?? (
            <>
              @{user.username}
              {online !== undefined && (online ? " · En ligne" : " · Hors ligne")}
            </>
          )}
        </p>
      </div>
      {children && <div className="flex items-center gap-1.5 shrink-0">{children}</div>}
    </div>
  )
}
