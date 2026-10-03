import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import type { User } from "@prisma/client"
import { prisma } from "@/db"
import { authConfig } from "@/account/config"

export const SESSION_COOKIE = "bt_session"
export const OAUTH_STATE_COOKIE = "bt_oauth"
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

function hmac(value: string, secret = authConfig.sessionSecret): string {
  return createHmac("sha256", secret).update(value).digest("base64url")
}

/** "value.signature", so a cookie cannot be forged without SESSION_SECRET. */
export function signValue(value: string, secret?: string): string {
  return `${value}.${hmac(value, secret)}`
}

export function unsignValue(signed: string | undefined, secret?: string): string | null {
  if (!signed) return null
  const dot = signed.lastIndexOf(".")
  if (dot <= 0) return null
  const value = signed.slice(0, dot)
  const given = Buffer.from(signed.slice(dot + 1))
  const expected = Buffer.from(hmac(value, secret))
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  return value
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(";")) {
    const eq = part.indexOf("=")
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (!name || name in out) continue
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim())
    } catch {
      out[name] = part.slice(eq + 1).trim()
    }
  }
  return out
}

export function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`]
  if (authConfig.secureCookies) parts.push("Secure")
  return parts.join("; ")
}

export function clearCookie(name: string): string {
  return serializeCookie(name, "", 0)
}

export async function createSession(userId: string): Promise<string> {
  const id = randomBytes(32).toString("base64url")
  await prisma.session.create({ data: { id, userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) } })
  return serializeCookie(SESSION_COOKIE, signValue(id), SESSION_TTL_MS / 1000)
}

export function sessionIdFrom(cookieHeader: string | undefined): string | null {
  return unsignValue(parseCookies(cookieHeader)[SESSION_COOKIE])
}

/** The logged-in account behind a request's cookies, or null for guests. */
export async function userFromCookies(cookieHeader: string | undefined): Promise<User | null> {
  const sessionId = sessionIdFrom(cookieHeader)
  if (!sessionId) return null
  const session = await prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } })
  if (!session) return null
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: sessionId } }).catch(() => {})
    return null
  }
  return session.user
}

export async function destroySession(cookieHeader: string | undefined) {
  const sessionId = sessionIdFrom(cookieHeader)
  if (sessionId) await prisma.session.deleteMany({ where: { id: sessionId } })
}
