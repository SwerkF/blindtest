import { feedbackConfig, type FeedbackConfig } from "@/feedback/config"

export const ITSAPLAN_TIMEOUT_MS = 5000
/** Extrait de la réponse du tracker gardé dans l'erreur (logs serveur seulement). */
const ERROR_BODY_EXCERPT_LENGTH = 200

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

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Début du corps sur une ligne, clé masquée : de quoi reconnaître une 404 du front ou une erreur JSON de l'API. */
function describeBody(raw: string, apiKey: string): string {
  const excerpt = raw.replaceAll(apiKey, "[clé masquée]").replace(/\s+/g, " ").trim().slice(0, ERROR_BODY_EXCERPT_LENGTH)
  return excerpt || "corps vide"
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
    // Une redirection (page de login, front au lieu de l'API) n'est pas une réponse de l'API
    redirect: "manual",
  })
  const raw = await response.text().catch(() => "")
  if (!response.ok) throw new Error(`It's a Plan a répondu ${response.status} : ${describeBody(raw, config.apiKey)}`)
  const issue = parseJson(raw) as { identifier?: unknown } | null
  if (typeof issue?.identifier !== "string" || !issue.identifier) {
    throw new Error(`Réponse It's a Plan sans identifiant d'issue : ${describeBody(raw, config.apiKey)}`)
  }
  return issue.identifier
}
