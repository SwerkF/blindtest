import { Blobatar } from "@blobatar/react"

interface AvatarProps {
  name: string
  size?: number
  onReroll?: () => void
}

const Avatar = ({ name, size = 36, onReroll }: AvatarProps) => {
  const face = <Blobatar name={name || "joueur"} size={size} alt="" className="rounded-full" />
  if (!onReroll) return face
  return (
    <button type="button" onClick={onReroll} title="Changer d'avatar" aria-label="Changer d'avatar" className="rounded-full shrink-0">
      {face}
    </button>
  )
}

export default Avatar
