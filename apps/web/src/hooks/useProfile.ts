import { useEffect, useState } from "react"
import { PROFILE_CHANGED_EVENT, loadProfile, saveProfile, type UserProfile } from "@/utils/storage"
import { pushProfileToAccount } from "@/utils/accountSync"

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile>(loadProfile)

  // The Discord account may replace the local profile after login
  useEffect(() => {
    const reload = () => setProfile(loadProfile())
    window.addEventListener(PROFILE_CHANGED_EVENT, reload)
    return () => window.removeEventListener(PROFILE_CHANGED_EVENT, reload)
  }, [])

  const update = (next: UserProfile) => {
    setProfile(next)
    saveProfile(next)
    pushProfileToAccount(next)
  }

  const setName = (name: string) => update({ ...profile, name })

  const setAvatar = (avatarSeed: string) => update({ ...profile, avatarSeed })

  return { profile, setName, setAvatar }
}
