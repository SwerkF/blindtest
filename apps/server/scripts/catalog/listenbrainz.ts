import { JsonlCache, sleep } from "./http"

const ENDPOINT = "https://api.listenbrainz.org/1/popularity/recording"

export interface Popularity {
  listens: number
  users: number
}

type PopularityRow = { recording_mbid?: string; total_listen_count?: number | null; total_user_count?: number | null }

/** The API answers with a list of rows (or wraps it); anything else counts as "unknown". */
export function parsePopularity(body: unknown): Map<string, Popularity> {
  const rows: unknown = Array.isArray(body) ? body : (body as { payload?: unknown } | null)?.payload
  const result = new Map<string, Popularity>()
  if (!Array.isArray(rows)) return result
  for (const row of rows as PopularityRow[]) {
    if (!row?.recording_mbid) continue
    result.set(row.recording_mbid, {
      listens: Number(row.total_listen_count) || 0,
      users: Number(row.total_user_count) || 0,
    })
  }
  return result
}

async function postBatch(mbids: string[], attempt = 0): Promise<Map<string, Popularity>> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "blindtest-catalog/1.0 (kreio.fr)" },
    body: JSON.stringify({ recording_mbids: mbids }),
  })
  if (response.status === 429 || response.status >= 500) {
    if (attempt >= 5) throw new Error(`ListenBrainz ${response.status}`)
    const wait = Number(response.headers.get("retry-after")) * 1000 || 2000 * 2 ** attempt
    await sleep(wait)
    return postBatch(mbids, attempt + 1)
  }
  if (response.status === 400 && mbids.length > 1) {
    // Batch too large for the API: split it and merge
    const half = Math.ceil(mbids.length / 2)
    const [a, b] = await Promise.all([postBatch(mbids.slice(0, half)), postBatch(mbids.slice(half))])
    return new Map([...a, ...b])
  }
  if (!response.ok) throw new Error(`ListenBrainz ${response.status}`)
  return parsePopularity(await response.json())
}

/** Listen counts of recordings by batches of `batchSize` MBIDs; unknown recordings count as 0. */
export async function fetchPopularity(
  mbids: string[],
  cache: JsonlCache<Popularity>,
  batchSize = 500,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, Popularity>> {
  const result = new Map<string, Popularity>()
  const todo: string[] = []
  for (const mbid of mbids) {
    if (cache.has(mbid)) result.set(mbid, cache.get(mbid) ?? { listens: 0, users: 0 })
    else todo.push(mbid)
  }
  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize)
    const found = await postBatch(batch)
    for (const mbid of batch) {
      const value = found.get(mbid) ?? { listens: 0, users: 0 }
      cache.set(mbid, value)
      result.set(mbid, value)
    }
    onProgress?.(Math.min(i + batchSize, todo.length), todo.length)
    await sleep(250)
  }
  return result
}
