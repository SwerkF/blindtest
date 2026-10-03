import { useState } from "react"
import { useAuth } from "@/hooks/useAuth"
import DiscordIcon from "@/components/DiscordIcon"

/** Lets a Discord account show its profile picture instead of the Blobatar. Renders nothing for guests. */
export default function DiscordAvatarToggle({ className = "" }: { className?: string }) {
  const { user, setUseDiscordAvatar } = useAuth()
  const [saving, setSaving] = useState(false)
  if (!user) return null

  const toggle = async () => {
    setSaving(true)
    await setUseDiscordAvatar(!user.useDiscordAvatar).catch(() => {})
    setSaving(false)
  }

  return (
    <label
      className={`flex items-center gap-3 min-h-11 px-3 py-2 rounded-xl border border-edge bg-canvas/60 cursor-pointer select-none ${className}`}
    >
      <img src={user.discordAvatarUrl} alt="" className="w-8 h-8 rounded-full shrink-0" />
      <span className="flex-1 text-sm text-ink flex items-center gap-1.5">
        <DiscordIcon size={14} className="text-[#5865F2]" />
        Utiliser ma photo Discord
      </span>
      <input
        type="checkbox"
        checked={user.useDiscordAvatar}
        disabled={saving}
        onChange={() => void toggle()}
        className="w-5 h-5 accent-accent cursor-pointer"
      />
    </label>
  )
}
