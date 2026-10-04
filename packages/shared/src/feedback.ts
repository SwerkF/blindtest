/** « Donner un retour » : les joueurs connectés envoient un bug, une idée ou autre chose. */

export enum FeedbackType {
  Bug = "bug",
  Idee = "idee",
  Autre = "autre",
}

export const FEEDBACK_MESSAGE_MAX_LENGTH = 4000
export const FEEDBACK_PAGE_MAX_LENGTH = 200

export interface FeedbackBody {
  type: FeedbackType
  message: string
  /** Chemin de la page d'où part le retour (`location.pathname`). */
  page?: string
}

export interface FeedbackResponse {
  /** Identifiant lisible de l'issue créée, ex. `BLIND-42`. */
  id: string
}

export interface FeedbackStatusResponse {
  enabled: boolean
}
