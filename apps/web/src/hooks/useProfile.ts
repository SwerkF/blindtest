import { useState } from "react"
import { loadProfile, saveProfile, type UserProfile } from "@/utils/storage"

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile>(loadProfile)

  const setName = (name: string) => {
    const next = { ...profile, name }
    setProfile(next)
    saveProfile(next)
  }

  const reroll = () => {
    const next = { ...profile, avatarSeed: crypto.randomUUID() }
    setProfile(next)
    saveProfile(next)
    return next.avatarSeed
  }

  return { profile, setName, reroll }
}
