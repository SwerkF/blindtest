import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { User } from "@prisma/client"
import {
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_PAGE_MAX_LENGTH,
  FeedbackType,
  type FeedbackBody,
  type FeedbackResponse,
  type FeedbackStatusResponse,
} from "@blindmusic/shared"
import { requireUser } from "@/account/authRoutes"
import { feedbackConfig, type FeedbackConfig } from "@/feedback/config"
import { createFeedbackIssue, type FeedbackIssueInput } from "@/feedback/itsaplan"

export const FEEDBACK_LIMIT_PER_HOUR = 5
const WINDOW_MS = 60 * 60 * 1000
const TITLE_EXCERPT_LENGTH = 80
const USER_AGENT_MAX_LENGTH = 200

const TITLE_PREFIX: Record<FeedbackType, string> = {
  [FeedbackType.Bug]: "[Bug]",
  [FeedbackType.Idee]: "[Idée]",
  [FeedbackType.Autre]: "[Autre]",
}

export interface FeedbackDeps {
  config: FeedbackConfig | null
  authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<User | null>
  createIssue: (input: FeedbackIssueInput) => Promise<string>
  now: () => number
}

function isFeedbackType(value: unknown): value is FeedbackType {
  return Object.values(FeedbackType).includes(value as FeedbackType)
}

/** Une seule ligne, sans caractères de contrôle : ces champs finissent dans un tracker en markdown. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

export function feedbackTitle(type: FeedbackType, message: string): string {
  const characters = Array.from(oneLine(message))
  const excerpt = characters.slice(0, TITLE_EXCERPT_LENGTH).join("")
  return `${TITLE_PREFIX[type]} ${excerpt}${characters.length > TITLE_EXCERPT_LENGTH ? "…" : ""}`
}

/** Message complet puis le contexte du joueur; jamais d'email ni de cookie. */
export function feedbackDescription(message: string, user: User, page: string | null, userAgent: string | undefined, date: Date): string {
  return [
    message,
    "",
    "---",
    `Joueur : ${oneLine(user.pseudo || user.username)} (${user.id})`,
    `Page : ${page ? oneLine(page) : "inconnue"}`,
    `Navigateur : ${userAgent ? oneLine(userAgent).slice(0, USER_AGENT_MAX_LENGTH) : "inconnu"}`,
    `Date : ${date.toISOString()}`,
  ].join("\n")
}

/** « Donner un retour » : crée une issue dans le tracker, la clé API ne quitte jamais le serveur. */
export function createFeedbackRoutes(deps: FeedbackDeps) {
  const sends = new Map<string, number[]>()

  /** Compte l'envoi s'il reste de la place dans l'heure glissante; purge les entrées expirées. */
  function allowSend(userId: string): boolean {
    const now = deps.now()
    for (const [id, times] of sends) {
      const recent = times.filter((time) => now - time < WINDOW_MS)
      if (recent.length === 0) sends.delete(id)
      else sends.set(id, recent)
    }
    const recent = sends.get(userId) ?? []
    if (recent.length >= FEEDBACK_LIMIT_PER_HOUR) return false
    sends.set(userId, [...recent, now])
    return true
  }

  return async function feedbackRoutes(fastify: FastifyInstance) {
    fastify.get("/feedback/status", async (): Promise<FeedbackStatusResponse> => ({ enabled: deps.config !== null }))

    fastify.post<{ Body: Partial<FeedbackBody> | undefined }>("/feedback", async (req, reply): Promise<FeedbackResponse | undefined> => {
      const config = deps.config
      if (!config) return reply.status(503).send({ error: "Les retours sont désactivés" })
      const user = await deps.authenticate(req, reply)
      if (!user) return

      const { type, page } = req.body ?? {}
      const message = typeof req.body?.message === "string" ? req.body.message.trim() : ""
      if (!isFeedbackType(type)) return reply.status(400).send({ error: "Type de retour invalide" })
      if (!message) return reply.status(400).send({ error: "Écris un message avant d'envoyer" })
      if (Array.from(message).length > FEEDBACK_MESSAGE_MAX_LENGTH) {
        return reply.status(400).send({ error: `Message trop long (${FEEDBACK_MESSAGE_MAX_LENGTH} caractères maximum)` })
      }
      if (page !== undefined && (typeof page !== "string" || page.length > FEEDBACK_PAGE_MAX_LENGTH)) {
        return reply.status(400).send({ error: "Page invalide" })
      }
      if (!allowSend(user.id)) return reply.status(429).send({ error: "Trop de retours, réessaie plus tard" })

      const typeIds: Record<FeedbackType, number> = {
        [FeedbackType.Bug]: config.typeBug,
        [FeedbackType.Idee]: config.typeIdee,
        [FeedbackType.Autre]: config.typeAutre,
      }
      try {
        const id = await deps.createIssue({
          title: feedbackTitle(type, message),
          description: feedbackDescription(message, user, page ?? null, req.headers["user-agent"], new Date(deps.now())),
          typeId: typeIds[type],
          labelIds: config.labelFeedbackId !== null ? [config.labelFeedbackId] : [],
        })
        return reply.status(201).send({ id })
      } catch (error) {
        const reason = error instanceof Error ? error.message.replaceAll(config.apiKey, "[clé masquée]") : "erreur inconnue"
        console.error("Création du retour impossible :", reason)
        return reply.status(502).send({ error: "Le retour n'a pas pu être envoyé, réessaie plus tard" })
      }
    })
  }
}

export default createFeedbackRoutes({
  config: feedbackConfig,
  authenticate: requireUser,
  createIssue: (input) => createFeedbackIssue(input),
  now: Date.now,
})
