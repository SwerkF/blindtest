import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { FriendsResponse } from "@blindmusic/shared"
import { AccountQueryKey, accountApi } from "@/utils/accountApi"

const EMPTY: FriendsResponse = { friends: [], incoming: [], outgoing: [] }

/** Friends and pending requests; presence updates arrive through the user socket. */
export function useFriends(enabled: boolean) {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: [AccountQueryKey.Friends], queryFn: accountApi.friends, enabled })

  /** Runs a friend action then refetches the list; resolves to an error message or null. */
  const run = async (action: () => Promise<unknown>): Promise<string | null> => {
    try {
      await action()
      return null
    } catch (error) {
      return error instanceof Error ? error.message : "Erreur"
    } finally {
      void queryClient.invalidateQueries({ queryKey: [AccountQueryKey.Friends] })
    }
  }

  return { data: query.data ?? EMPTY, loading: query.isLoading, run }
}
