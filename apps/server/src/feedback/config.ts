export interface FeedbackConfig {
  baseUrl: string
  apiKey: string
  projectKey: string
  typeBug: number
  typeIdee: number
  typeAutre: number
  /** Colonne de départ des issues; l'API peut l'exiger. */
  columnId: number | null
  /** Label ajouté à chaque retour pour le distinguer des tickets de dev. */
  labelFeedbackId: number | null
}

type Env = Record<string, string | undefined>

function text(env: Env, name: string): string | null {
  const value = env[name]?.trim()
  return value ? value : null
}

/** null = absent; NaN = présent mais invalide. */
function integer(env: Env, name: string): number | null {
  const value = text(env, name)
  if (value === null) return null
  return /^\d+$/.test(value) ? Number(value) : Number.NaN
}

/**
 * Lit la configuration It's a Plan. Renvoie null (retours désactivés) dès qu'une variable
 * obligatoire manque ou qu'un identifiant n'est pas un entier; la raison est loguée sans valeur.
 */
export function loadFeedbackConfig(env: Env): FeedbackConfig | null {
  const baseUrl = text(env, "ITSAPLAN_URL")
  const apiKey = text(env, "ITSAPLAN_API_KEY")
  const projectKey = text(env, "ITSAPLAN_PROJECT_KEY")
  const typeBug = integer(env, "ITSAPLAN_TYPE_BUG")
  const typeIdee = integer(env, "ITSAPLAN_TYPE_IDEE")
  const typeAutre = integer(env, "ITSAPLAN_TYPE_AUTRE")
  const columnId = integer(env, "ITSAPLAN_COLUMN_ID")
  const labelFeedbackId = integer(env, "ITSAPLAN_LABEL_FEEDBACK")

  const required = { ITSAPLAN_URL: baseUrl, ITSAPLAN_API_KEY: apiKey, ITSAPLAN_PROJECT_KEY: projectKey, ITSAPLAN_TYPE_BUG: typeBug, ITSAPLAN_TYPE_IDEE: typeIdee, ITSAPLAN_TYPE_AUTRE: typeAutre }
  const missing = Object.entries(required).filter(([, value]) => value === null).map(([name]) => name)
  const invalid = Object.entries({ ITSAPLAN_TYPE_BUG: typeBug, ITSAPLAN_TYPE_IDEE: typeIdee, ITSAPLAN_TYPE_AUTRE: typeAutre, ITSAPLAN_COLUMN_ID: columnId, ITSAPLAN_LABEL_FEEDBACK: labelFeedbackId })
    .filter(([, value]) => Number.isNaN(value))
    .map(([name]) => name)

  // Tout vide = fonctionnalité volontairement absente, pas la peine de prévenir
  if (invalid.length > 0 || (missing.length > 0 && missing.length < Object.keys(required).length)) {
    const problems = [missing.length > 0 && `manquantes : ${missing.join(", ")}`, invalid.length > 0 && `invalides : ${invalid.join(", ")}`]
    console.warn(`Retours joueurs désactivés, variables ${problems.filter(Boolean).join(" ; ")}`)
  }
  if (baseUrl === null || apiKey === null || projectKey === null) return null
  if (typeBug === null || typeIdee === null || typeAutre === null) return null
  if (invalid.length > 0) return null

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    projectKey,
    typeBug,
    typeIdee,
    typeAutre,
    columnId,
    labelFeedbackId,
  }
}

export const feedbackConfig = loadFeedbackConfig(process.env)
