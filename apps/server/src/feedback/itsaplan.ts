import { feedbackConfig, type FeedbackConfig } from "@/feedback/config"

export const ITSAPLAN_TIMEOUT_MS = 5000

/** Clé API personnelle d'It's a Plan : en-tête `x-api-key` (pas de Bearer). */
export const ITSAPLAN_API_KEY_HEADER = "x-api-key"

/** `POST /projects/{projectKey}/issues` à la racine de l'origine de l'API (pas de préfixe `/api`). */
export const itsAplanIssuesPath = (projectKey: string) => `/projects/${encodeURIComponent(projectKey)}/issues`

export interface FeedbackIssueInput {
  title: string
  description: string
  typeId: number
  labelIds: number[]
}

/** Crée l'issue et renvoie son identifiant lisible (ex. `BLIND-42`); lève en cas d'échec ou de timeout. */
export async function createFeedbackIssue(
  input: FeedbackIssueInput,
  config: FeedbackConfig | null = feedbackConfig,
  fetchFn: typeof fetch = fetch
): Promise<string> {
  if (!config) throw new Error("It's a Plan non configuré")
  const response = await fetchFn(`${config.baseUrl}${itsAplanIssuesPath(config.projectKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [ITSAPLAN_API_KEY_HEADER]: config.apiKey },
    body: JSON.stringify({
      title: input.title,
      description: input.description,
      typeId: input.typeId,
      labelIds: input.labelIds,
      columnId: config.columnId,
    }),
    signal: AbortSignal.timeout(ITSAPLAN_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`It's a Plan a répondu ${response.status}`)
  const issue = (await response.json().catch(() => null)) as { identifier?: unknown } | null
  if (typeof issue?.identifier !== "string" || !issue.identifier) throw new Error("Réponse It's a Plan sans identifiant d'issue")
  return issue.identifier
}
