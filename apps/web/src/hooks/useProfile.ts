import { useState } from "react"
import { loadProfile, saveProfile, type UserProfile } from "@/utils/storage"

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile>(loadProfile)

  const setName = (name: string) => {
    const next = { ...profile, name }
    setProfile(next)
    saveProfile(next)
  }

  const setAvatar = (avatarSeed: string) => {
    const next = { ...profile, avatarSeed }
    setProfile(next)
    saveProfile(next)
  }

  return { profile, setName, setAvatar }
}
