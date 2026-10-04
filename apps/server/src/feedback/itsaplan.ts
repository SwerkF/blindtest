import { feedbackConfig, type FeedbackConfig } from "@/feedback/config"

export const ITSAPLAN_TIMEOUT_MS = 5000

/**
 * ATTENTION : chemin non vérifié. La spec OpenAPI de l'instance n'était pas joignable depuis
 * l'environnement de développement; la route est déduite de l'outil MCP `create_issue`
 * (`projectKey` en paramètre de chemin; `title`, `description`, `typeId`, `labelIds`, `columnId`
 * dans le corps). À confronter à la doc OpenAPI : seules ces constantes et `readIssueNumber` en dépendent.
 */
export const ITSAPLAN_API_PREFIX = "/api"
export const itsAplanIssuesPath = (projectKey: string) => `${ITSAPLAN_API_PREFIX}/projects/${encodeURIComponent(projectKey)}/issues`

export interface FeedbackIssueInput {
  title: string
  description: string
  typeId: number
  labelIds: number[]
}

/** Numéro séquentiel de l'issue (le 42 de BLIND-42), que la réponse soit à plat ou enveloppée. */
function readIssueNumber(payload: unknown): number | null {
  const queue: unknown[] = [payload]
  for (let depth = 0; depth < 3 && queue.length > 0; depth++) {
    const next: unknown[] = []
    for (const candidate of queue) {
      if (typeof candidate !== "object" || candidate === null) continue
      const record = candidate as Record<string, unknown>
      if (typeof record.sequenceNumber === "number") return record.sequenceNumber
      next.push(record.issue, record.data)
    }
    queue.splice(0, queue.length, ...next)
  }
  return null
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
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      title: input.title,
      description: input.description,
      typeId: input.typeId,
      labelIds: input.labelIds,
      ...(config.columnId !== null ? { columnId: config.columnId } : {}),
    }),
    signal: AbortSignal.timeout(ITSAPLAN_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`It's a Plan a répondu ${response.status}`)
  const number = readIssueNumber(await response.json().catch(() => null))
  if (number === null) throw new Error("Réponse It's a Plan sans numéro d'issue")
  return `${config.projectKey}-${number}`
}
