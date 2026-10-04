import { useQuery } from "@tanstack/react-query"
import { AccountQueryKey, accountApi } from "@/utils/accountApi"

/** Le serveur a-t-il la config du tracker ? Faux tant que la réponse n'est pas là. */
export function useFeedbackEnabled(): boolean {
  const { data } = useQuery({
    queryKey: [AccountQueryKey.FeedbackStatus],
    queryFn: accountApi.feedbackStatus,
    staleTime: 10 * 60 * 1000,
    retry: false,
  })
  return data?.enabled ?? false
}
