import { afterAll, describe, expect, test } from "bun:test"
import Fastify from "fastify"
import type { User } from "@prisma/client"
import { FEEDBACK_MESSAGE_MAX_LENGTH, FeedbackType } from "@blindmusic/shared"
import { loadFeedbackConfig, type FeedbackConfig } from "@/feedback/config"
import { createFeedbackIssue, type FeedbackIssueInput } from "@/feedback/itsaplan"
import { FEEDBACK_LIMIT_PER_HOUR, createFeedbackRoutes, feedbackTitle } from "@/feedback/routes"

const API_KEY = "sk_test_secret_key_123"

const CONFIG: FeedbackConfig = {
  baseUrl: "https://tracker.example",
  apiKey: API_KEY,
  projectKey: "BLIND",
  typeBug: 21,
  typeIdee: 20,
  typeAutre: 22,
  columnId: 21,
  labelFeedbackId: null,
}

const USER = { id: "user_1", pseudo: "Alice", username: "alice", email: "alice@secret.example" } as unknown as User

interface Options {
  config?: FeedbackConfig | null
  user?: User | null
  createIssue?: (input: FeedbackIssueInput) => Promise<string>
  now?: () => number
}

const servers: ReturnType<typeof Fastify>[] = []
afterAll(async () => {
  await Promise.all(servers.map((server) => server.close()))
})

interface Reply {
  statusCode: number
  body: string
  json: () => unknown
}

/** `fastify.inject` ne marche pas sous Bun : vrai serveur sur un port éphémère. */
async function setup(options: Options = {}) {
  const sent: FeedbackIssueInput[] = []
  const fastify = Fastify()
  servers.push(fastify)
  await fastify.register(
    createFeedbackRoutes({
      config: options.config === undefined ? CONFIG : options.config,
      authenticate: async (_req, reply) => {
        const user = options.user === undefined ? USER : options.user
        if (!user) reply.status(401).send({ error: "Connexion requise" })
        return user
      },
      createIssue:
        options.createIssue ??
        (async (input) => {
          sent.push(input)
          return "BLIND-42"
        }),
      now: options.now ?? Date.now,
    })
  )
  const origin = await fastify.listen({ port: 0, host: "127.0.0.1" })
  const call = async (path: string, init?: RequestInit): Promise<Reply> => {
    const res = await fetch(origin + path, init)
    const body = await res.text()
    return { statusCode: res.status, body, json: () => JSON.parse(body) as unknown }
  }
  const post = (payload: unknown, headers: Record<string, string> = {}) =>
    call("/feedback", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) })
  const status = () => call("/feedback/status")
  return { post, status, sent }
}

describe("POST /feedback", () => {
  test("401 sans session", async () => {
    const { post, sent } = await setup({ user: null })
    const res = await post({ type: "bug", message: "Ça plante" })
    expect(res.statusCode).toBe(401)
    expect(sent).toHaveLength(0)
  })

  test("503 si la config est incomplète, et le statut le dit", async () => {
    const { post, status } = await setup({ config: null })
    const res = await post({ type: "bug", message: "Ça plante" })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: "Les retours sont désactivés" })
    expect((await status()).json()).toEqual({ enabled: false })
  })

  test("GET /feedback/status : enabled quand tout est configuré", async () => {
    const { status } = await setup()
    expect((await status()).json()).toEqual({ enabled: true })
  })

  test.each([
    ["type inconnu", { type: "spam", message: "x" }],
    ["type absent", { message: "x" }],
    ["message absent", { type: "bug" }],
    ["message vide après trim", { type: "bug", message: "   \n " }],
    ["message non texte", { type: "bug", message: 12 }],
    ["message trop long", { type: "bug", message: "a".repeat(FEEDBACK_MESSAGE_MAX_LENGTH + 1) }],
    ["page trop longue", { type: "bug", message: "x", page: "/" + "a".repeat(200) }],
    ["page non texte", { type: "bug", message: "x", page: 3 }],
  ])("400 : %s", async (_name, body) => {
    const { post, sent } = await setup()
    expect((await post(body)).statusCode).toBe(400)
    expect(sent).toHaveLength(0)
  })

  test("un message de 4000 caractères passe", async () => {
    const { post } = await setup()
    expect((await post({ type: "autre", message: "a".repeat(FEEDBACK_MESSAGE_MAX_LENGTH) })).statusCode).toBe(201)
  })

  test("201 avec l'identifiant de l'issue", async () => {
    const { post } = await setup()
    const res = await post({ type: "idee", message: "Un mode karaoké", page: "/lobby/ABCD" })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ id: "BLIND-42" })
  })

  test("502 si It's a Plan échoue, sans fuite de détail", async () => {
    const { post } = await setup({
      createIssue: async () => {
        throw new Error(`HTTP 500 pour ${API_KEY}`)
      },
    })
    const logged: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => void logged.push(args)
    const res = await post({ type: "bug", message: "Ça plante" }).finally(() => {
      console.error = original
    })
    expect(logged).toHaveLength(1)
    expect(JSON.stringify(logged)).not.toContain(API_KEY)
    expect(res.statusCode).toBe(502)
    expect(res.json()).toEqual({ error: "Le retour n'a pas pu être envoyé, réessaie plus tard" })
    expect(res.body).not.toContain(API_KEY)
  })

  test("429 au 6e envoi dans l'heure, puis de nouveau possible après", async () => {
    let now = 1_700_000_000_000
    const { post } = await setup({ now: () => now })
    for (let i = 0; i < FEEDBACK_LIMIT_PER_HOUR; i++) {
      expect((await post({ type: "bug", message: `bug ${i}` })).statusCode).toBe(201)
    }
    const limited = await post({ type: "bug", message: "encore" })
    expect(limited.statusCode).toBe(429)
    expect(limited.json()).toEqual({ error: "Trop de retours, réessaie plus tard" })
    now += 60 * 60 * 1000 + 1
    expect((await post({ type: "bug", message: "plus tard" })).statusCode).toBe(201)
  })

  test("la limite est par joueur et les envois invalides ne la consomment pas", async () => {
    const { post } = await setup()
    for (let i = 0; i < 10; i++) await post({ type: "nope", message: "x" })
    for (let i = 0; i < FEEDBACK_LIMIT_PER_HOUR; i++) {
      expect((await post({ type: "bug", message: `bug ${i}` })).statusCode).toBe(201)
    }
    const other = await setup({ user: { ...USER, id: "user_2" } as User })
    expect((await other.post({ type: "bug", message: "autre joueur" })).statusCode).toBe(201)
  })
})

describe("contenu envoyé", () => {
  test.each([
    [FeedbackType.Bug, 21, "[Bug]"],
    [FeedbackType.Idee, 20, "[Idée]"],
    [FeedbackType.Autre, 22, "[Autre]"],
  ])("type %s : typeId %d et titre préfixé %s", async (type, typeId, prefix) => {
    const { post, sent } = await setup()
    await post({ type, message: "Quelque chose" })
    expect(sent[0]?.typeId).toBe(typeId)
    expect(sent[0]?.title).toBe(`${prefix} Quelque chose`)
  })

  test("label ajouté seulement s'il est configuré", async () => {
    const without = await setup()
    await without.post({ type: "bug", message: "x" })
    expect(without.sent[0]?.labelIds).toEqual([])

    const withLabel = await setup({ config: { ...CONFIG, labelFeedbackId: 7 } })
    await withLabel.post({ type: "bug", message: "x" })
    expect(withLabel.sent[0]?.labelIds).toEqual([7])
  })

  test("titre sur une ligne, tronqué à 80 caractères", async () => {
    const { post, sent } = await setup()
    await post({ type: "bug", message: `${"a".repeat(50)}\n\n${"b".repeat(100)}` })
    const title = sent[0]?.title ?? ""
    expect(title).not.toContain("\n")
    expect(title).toBe(`[Bug] ${"a".repeat(50)} ${"b".repeat(29)}…`)
    expect(feedbackTitle(FeedbackType.Bug, "court")).toBe("[Bug] court")
  })

  test("description : message complet, joueur, page, navigateur tronqué et date; ni email ni clé", async () => {
    const { post, sent } = await setup({ now: () => Date.UTC(2026, 9, 4, 12, 0, 0) })
    const message = `${"long ".repeat(40)}fin`
    await post({ type: "bug", message, page: "/game/XYZ" }, { "user-agent": "UA/" + "x".repeat(500) })
    const description = sent[0]?.description ?? ""
    expect(description.startsWith(message)).toBe(true)
    expect(description).toContain("Joueur : Alice (user_1)")
    expect(description).toContain("Page : /game/XYZ")
    expect(description).toContain("Date : 2026-10-04T12:00:00.000Z")
    const agent = description.split("\n").find((line) => line.startsWith("Navigateur : ")) ?? ""
    expect(agent.length).toBeLessThanOrEqual("Navigateur : ".length + 200)
    expect(description).not.toContain("alice@secret.example")
    expect(JSON.stringify(sent)).not.toContain(API_KEY)
  })
})

describe("client It's a Plan", () => {
  const input: FeedbackIssueInput = { title: "[Bug] x", description: "d", typeId: 21, labelIds: [7] }

  function fakeFetch(response: Response) {
    const calls: { url: string; init: RequestInit }[] = []
    const fn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return response
    }) as typeof fetch
    return { fn, calls }
  }

  test("envoie la clé dans x-api-key seulement, le corps ne la contient pas", async () => {
    const { fn, calls } = fakeFetch(Response.json({ id: 9, identifier: "BLIND-42" }, { status: 201 }))
    expect(await createFeedbackIssue(input, CONFIG, fn)).toBe("BLIND-42")
    const call = calls[0]!
    expect(call.url).toBe("https://tracker.example/projects/BLIND/issues")
    const headers = call.init.headers as Record<string, string>
    expect(headers["x-api-key"]).toBe(API_KEY)
    expect(headers.Authorization).toBeUndefined()
    expect(String(call.init.body)).not.toContain(API_KEY)
    expect(JSON.parse(String(call.init.body))).toEqual({ ...input, columnId: 21 })
  })

  test("lève sur une réponse en erreur ou sans numéro d'issue", async () => {
    await expect(createFeedbackIssue(input, CONFIG, fakeFetch(new Response("boom", { status: 500 })).fn)).rejects.toThrow("500")
    await expect(createFeedbackIssue(input, CONFIG, fakeFetch(Response.json({ id: 9 })).fn)).rejects.toThrow()
  })
})

describe("configuration", () => {
  const FULL = {
    ITSAPLAN_URL: "https://tracker.example/",
    ITSAPLAN_API_KEY: API_KEY,
    ITSAPLAN_PROJECT_KEY: "BLIND",
    ITSAPLAN_TYPE_BUG: "21",
    ITSAPLAN_TYPE_IDEE: "20",
    ITSAPLAN_TYPE_AUTRE: "22",
    ITSAPLAN_COLUMN_ID: "21",
  }

  test("complète : parse les entiers, retire le slash final, label optionnel", () => {
    expect(loadFeedbackConfig(FULL)).toEqual({ ...CONFIG, baseUrl: "https://tracker.example" })
    expect(loadFeedbackConfig({ ...FULL, ITSAPLAN_LABEL_FEEDBACK: "9" })).toMatchObject({ labelFeedbackId: 9 })
  })

  test("variable obligatoire manquante ou identifiant invalide : désactivé", () => {
    const warn = console.warn
    console.warn = () => {}
    try {
      expect(loadFeedbackConfig({})).toBeNull()
      expect(loadFeedbackConfig({ ...FULL, ITSAPLAN_API_KEY: " " })).toBeNull()
      expect(loadFeedbackConfig({ ...FULL, ITSAPLAN_TYPE_BUG: "abc" })).toBeNull()
      expect(loadFeedbackConfig({ ...FULL, ITSAPLAN_COLUMN_ID: "x" })).toBeNull()
      expect(loadFeedbackConfig({ ...FULL, ITSAPLAN_COLUMN_ID: "" })).toBeNull()
    } finally {
      console.warn = warn
    }
  })
})
