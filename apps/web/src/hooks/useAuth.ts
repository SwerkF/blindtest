import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { MeResponse } from "@blindmusic/shared"
import { AccountQueryKey, accountApi } from "@/utils/accountApi"

const GUEST: MeResponse = { user: null, discordEnabled: false }

/** The optional Discord account; `user` stays null for guests. */
export function useAuth() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: [AccountQueryKey.Me],
    queryFn: accountApi.me,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  const forget = () => {
    queryClient.setQueryData<MeResponse>([AccountQueryKey.Me], (prev) => ({ ...(prev ?? GUEST), user: null }))
    queryClient.removeQueries({ queryKey: [AccountQueryKey.Friends] })
    queryClient.removeQueries({ queryKey: [AccountQueryKey.History] })
    queryClient.removeQueries({ queryKey: [AccountQueryKey.Achievements] })
  }

  const logout = async () => {
    await accountApi.logout().catch(() => {})
    forget()
  }

  /** Throws on failure so the caller can show the error. */
  const deleteAccount = async () => {
    await accountApi.deleteAccount()
    forget()
  }

  /** Throws on failure; the cached account is updated on success. */
  const setUseDiscordAvatar = async (value: boolean) => {
    const user = await accountApi.setUseDiscordAvatar(value)
    queryClient.setQueryData<MeResponse>([AccountQueryKey.Me], (prev) => ({ ...(prev ?? GUEST), user }))
  }

  const data = query.data ?? GUEST
  return {
    user: data.user,
    discordEnabled: data.discordEnabled,
    loading: query.isLoading,
    logout,
    deleteAccount,
    setUseDiscordAvatar,
  }
}
