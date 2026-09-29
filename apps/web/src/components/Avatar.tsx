import { useMemo } from "react"
import { Blobatar } from "@blobatar/react"
import { EXPRESSION_VALUE, SHAPE_TRAIT, TONE_VALUE, decodeAvatar } from "@/utils/avatar"

interface AvatarProps {
  /** Encoded avatar string (see utils/avatar), or any plain seed. */
  name: string
  size?: number
  /** Opens the avatar editor when set. */
  onEdit?: () => void
  /** "always" for a single showcased avatar, "hover" for lists. */
  animate?: "hover" | "always"
}

const Avatar = ({ name, size = 36, onEdit, animate = "hover" }: AvatarProps) => {
  const config = useMemo(() => decodeAvatar(name || "joueur"), [name])
  const face = (
    <Blobatar
      name={config.seed || "joueur"}
      size={size}
      animate={animate}
      traits={config.shape ? { shape: SHAPE_TRAIT[config.shape] } : undefined}
      hue={config.hue ?? undefined}
      tone={config.tone ? TONE_VALUE[config.tone] : undefined}
      expression={EXPRESSION_VALUE[config.expression]}
      className="shrink-0"
    />
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
