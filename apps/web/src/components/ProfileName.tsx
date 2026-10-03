import type { ReactNode } from "react"
import { useOpenUserProfile } from "@/hooks/useOpenUserProfile"

interface ProfileNameProps {
  /** App account id (PlayerPublic.userId); guests (null) get plain text. */
  userId: string | null | undefined
  children: ReactNode
  className?: string
}

/**
 * A player's name that opens their public profile when they have an account.
 * In a lobby or a game it opens in the drawer, so the player never leaves the room.
 */
export default function ProfileName({ userId, children, className = "" }: ProfileNameProps) {
  const openUserProfile = useOpenUserProfile()
  if (!userId) return <span className={className}>{children}</span>
  return (
    <button
      type="button"
      onClick={() => openUserProfile(userId)}
      title="Voir le profil"
      className={`${className} min-w-0 text-left hover:underline decoration-accent decoration-2 underline-offset-2 cursor-pointer`}
    >
      {children}
    </button>
  )
}
