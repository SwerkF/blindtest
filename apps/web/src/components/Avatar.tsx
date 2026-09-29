import { useMemo } from "react"
import { Blobatar } from "@blobatar/react"
import { sleepy, thinking } from "blobatar/expression"
import { EXPRESSION_VALUE, SHAPE_TRAIT, TONE_VALUE, decodeAvatar } from "@/utils/avatar"

export enum PlayerStatus {
  Online = "online",
  Typing = "typing",
  Offline = "offline",
}

const STATUS_LABEL: Record<PlayerStatus, string> = {
  [PlayerStatus.Online]: "Connecté",
  [PlayerStatus.Typing]: "En train d'écrire…",
  [PlayerStatus.Offline]: "Déconnecté",
}

const STATUS_DOT: Record<PlayerStatus, string> = {
  [PlayerStatus.Online]: "bg-green-500",
  [PlayerStatus.Typing]: "bg-amber-400 animate-pulse",
  [PlayerStatus.Offline]: "bg-muted",
}

interface AvatarProps {
  /** Encoded avatar string (see utils/avatar), or any plain seed. */
  name: string
  size?: number
  /** Opens the avatar editor when set. */
  onEdit?: () => void
  /** "always" for a single showcased avatar, "hover" for lists. */
  animate?: "hover" | "always"
  /** Shows presence: the blob "thinks" while typing and dozes off when disconnected. */
  status?: PlayerStatus
}

const Avatar = ({ name, size = 36, onEdit, animate = "hover", status }: AvatarProps) => {
  const config = useMemo(() => decodeAvatar(name || "joueur"), [name])
  const expression =
    status === PlayerStatus.Typing
      ? thinking
      : status === PlayerStatus.Offline
        ? sleepy
        : EXPRESSION_VALUE[config.expression]
  const blob = (
    <Blobatar
      name={config.seed || "joueur"}
      size={size}
      animate={animate}
      traits={config.shape ? { shape: SHAPE_TRAIT[config.shape] } : undefined}
      hue={config.hue ?? undefined}
      tone={config.tone ? TONE_VALUE[config.tone] : undefined}
      expression={expression}
      className="shrink-0"
    />
  )
  const face = status ? (
    <span className="relative inline-flex shrink-0" title={STATUS_LABEL[status]}>
      {blob}
      <span
        className={`absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full ring-2 ring-surface ${STATUS_DOT[status]}`}
      />
    </span>
  ) : (
    blob
  )
  if (!onEdit) return face
  return (
    <button
      type="button"
      onClick={onEdit}
      title="Personnaliser l'avatar"
      aria-label="Personnaliser l'avatar"
      className="rounded-full shrink-0 hover:scale-105 transition-transform"
    >
      {face}
    </button>
  )
}

export default Avatar
