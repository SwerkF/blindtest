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
      className="shrink-0 block"
    />
  )
  // Discord-style presence: a small dot astride the corner, with a transparent notch cut out of the avatar
  const dot = Math.max(8, Math.min(14, Math.round(size * 0.22)))
  const notch = dot / 2 + 2.5
  // Blobs do not reach the corners of their box: pull the dot in so it bites into the shape
  const inset = Math.round(size * 0.08)
  const offset = inset + dot / 2
  const centre = `calc(100% - ${offset}px) calc(100% - ${offset}px)`
  const mask = `radial-gradient(circle at ${centre}, transparent ${notch}px, #000 ${notch + 0.5}px)`
  const face = status ? (
    <span className="relative block shrink-0" style={{ width: size, height: size }} title={STATUS_LABEL[status]}>
      <span className="block" style={{ WebkitMaskImage: mask, maskImage: mask }}>
        {blob}
      </span>
      <span
        className={`absolute rounded-full ${STATUS_DOT[status]}`}
        style={{ width: dot, height: dot, right: inset, bottom: inset }}
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
