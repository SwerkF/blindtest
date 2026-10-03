import type { AccountUser } from "@blindmusic/shared"
import { accountApi } from "@/utils/accountApi"
import { applyProfile, loadProfile, type UserProfile } from "@/utils/storage"

const PUSH_DELAY_MS = 800

let linkedUserId: string | null = null
let pushTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Called when the account is known. On the very first login the local pseudo
 * and avatar are copied to the account; afterwards the account wins, so the
 * same profile follows the player from one device to another.
 */
export function linkAccount(user: AccountUser | null) {
  if (user?.id === linkedUserId) return
  linkedUserId = user?.id ?? null
  if (!user) return
  const local = loadProfile()
  if (!user.hasProfile) {
    if (local.name.trim()) void accountApi.updateProfile(local.name.trim(), local.avatarSeed).catch(() => {})
    return
  }
  const next = { name: user.pseudo, avatarSeed: user.avatarSeed || local.avatarSeed }
  if (next.name !== local.name || next.avatarSeed !== local.avatarSeed) applyProfile(next)
}

/** Local pseudo/avatar edits follow to the account, debounced while typing. */
export function pushProfileToAccount(profile: UserProfile) {
  if (!linkedUserId) return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = null
    if (!linkedUserId || !profile.name.trim()) return
    void accountApi.updateProfile(profile.name.trim(), profile.avatarSeed).catch(() => {})
  }, PUSH_DELAY_MS)
}
