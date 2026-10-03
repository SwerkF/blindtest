import { authConfig } from "@/account/config"

const DISCORD_API = "https://discord.com/api/v10"

export interface DiscordUser {
  id: string
  username: string
  globalName: string | null
  avatar: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function discordAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: authConfig.discordClientId ?? "",
    redirect_uri: authConfig.discordRedirectUri ?? "",
    response_type: "code",
    scope: "identify",
    state,
    prompt: "none",
  })
  return `https://discord.com/oauth2/authorize?${params}`
}

/** Authorization-code exchange; returns the user access token. */
export async function exchangeDiscordCode(code: string): Promise<string> {
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: authConfig.discordClientId ?? "",
      client_secret: authConfig.discordClientSecret ?? "",
      grant_type: "authorization_code",
      code,
      redirect_uri: authConfig.discordRedirectUri ?? "",
    }),
  })
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok || !isRecord(body) || typeof body.access_token !== "string") {
    throw new Error(`Discord token exchange failed (${res.status})`)
  }
  return body.access_token
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const res = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } })
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok || !isRecord(body) || typeof body.id !== "string" || typeof body.username !== "string") {
    throw new Error(`Discord user lookup failed (${res.status})`)
  }
  return {
    id: body.id,
    username: body.username,
    globalName: typeof body.global_name === "string" ? body.global_name : null,
    avatar: typeof body.avatar === "string" ? body.avatar : null,
  }
}

export function discordAvatarUrl(discordId: string, avatarHash: string | null): string {
  if (avatarHash) return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png?size=128`
  // Default avatars are picked from the snowflake for accounts on the new username system
  let index = 0
  try {
    index = Number((BigInt(discordId) >> 22n) % 6n)
  } catch {}
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`
}
