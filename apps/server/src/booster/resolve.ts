import { Prisma, type PrismaClient } from "@prisma/client"
import { prisma } from "@/db"
import { Throttle, fetchRetry } from "@/http"

export type PoolEntry = Prisma.CardPoolEntryGetPayload<object>
/** An entry whose Deezer track is known: the only kind a player can receive. */
export type ResolvedEntry = PoolEntry & { deezerTrackId: bigint; resolvedAt: Date }
export type Resolver = (entry: PoolEntry) => Promise<ResolvedEntry | null>

const API = "https://api.deezer.com"
export const RESOLVE_TIMEOUT_MS = 3000
/** Deezer allows about 50 calls per 5 seconds; stay under, a pack opening makes a handful of calls. */
const throttle = new Throttle(120)
/** Deezer error codes that say "try again later" rather than "this track does not exist": 4 quota, 700 busy. */
const TRANSIENT_ERRORS = new Set([4, 700])

interface DeezerTrack {
  id?: number
  readable?: boolean
  preview?: string
  md5_image?: string
  album?: { md5_image?: string }
  error?: { code?: number }
}

export interface ResolveDeps {
  client?: PrismaClient
  fetch?: typeof fetch
}

const isResolved = (entry: PoolEntry): entry is ResolvedEntry => entry.resolvedAt !== null && entry.deezerTrackId !== null

/**
 * Looks the track up on Deezer by ISRC the first time it is drawn, then remembers the answer in the entry.
 * Returns null when the entry cannot be played. Only a definitive answer (no such track, not readable,
 * no preview, id taken by another entry) marks it `unplayable`; a network error, a timeout or a
 * Deezer hiccup returns null and leaves the entry drawable, so a later opening can retry.
 * Never call it inside a database transaction: it waits for the network.
 */
export async function resolveEntry(entry: PoolEntry, deps: ResolveDeps = {}): Promise<ResolvedEntry | null> {
  if (isResolved(entry)) return entry
  if (entry.unplayable) return null
  const client = deps.client ?? prisma

  let response: Response
  try {
    response = await fetchRetry(`${API}/track/isrc:${encodeURIComponent(entry.isrc)}`, {
      throttle,
      timeoutMs: RESOLVE_TIMEOUT_MS,
      retries: 1,
      backoffMs: 250,
      fetch: deps.fetch,
    })
  } catch {
    return null
  }
  if (response.status === 404) return markUnplayable(client, entry)
  if (!response.ok) return null

  let track: DeezerTrack | null
  try {
    // Deezer reports errors with a 200 status and an `error` object
    track = (await response.json()) as DeezerTrack | null
  } catch {
    return null
  }
  if (track?.error) {
    return TRANSIENT_ERRORS.has(Number(track.error.code)) ? null : markUnplayable(client, entry)
  }
  if (!track || track.readable !== true || !track.preview || !Number.isSafeInteger(track.id)) {
    return markUnplayable(client, entry)
  }

  try {
    return (await client.cardPoolEntry.update({
      where: { id: entry.id },
      data: {
        deezerTrackId: BigInt(track.id!),
        deezerMd5Image: track.md5_image || track.album?.md5_image || null,
        resolvedAt: new Date(),
      },
    })) as ResolvedEntry
  } catch (error) {
    // Another entry already owns this Deezer track (same recording under two ISRCs)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return markUnplayable(client, entry)
    }
    throw error
  }
}

async function markUnplayable(client: PrismaClient, entry: PoolEntry): Promise<null> {
  await client.cardPoolEntry.update({ where: { id: entry.id }, data: { unplayable: true } })
  return null
}
