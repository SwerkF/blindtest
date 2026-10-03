import { randomBytes } from "node:crypto"

function optional(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? value : null
}

const sessionSecret = optional("SESSION_SECRET")
if (!sessionSecret) {
  console.warn("SESSION_SECRET manquant : secret aléatoire, les sessions seront perdues au redémarrage")
}

const webOrigin = optional("WEB_ORIGIN")

export const authConfig = {
  discordClientId: optional("DISCORD_CLIENT_ID"),
  discordClientSecret: optional("DISCORD_CLIENT_SECRET"),
  discordRedirectUri: optional("DISCORD_REDIRECT_URI"),
  sessionSecret: sessionSecret ?? randomBytes(32).toString("hex"),
  /** Where the browser lands after login/logout; null keeps redirects relative to the current host. */
  webOrigin,
  /** Secure cookies only make sense behind https. */
  secureCookies: webOrigin?.startsWith("https://") ?? false,
}

/** Swerk is recognised by his Discord id only (never by pseudo), for the secret achievements. */
export const SWERK_DISCORD_ID = optional("SWERK_DISCORD_ID") ?? "317411645129490435"

export function discordEnabled(): boolean {
  return Boolean(authConfig.discordClientId && authConfig.discordClientSecret && authConfig.discordRedirectUri)
}
