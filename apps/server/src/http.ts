import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname } from "node:path"

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Spaces calls at least `intervalMs` apart, whatever the number of concurrent callers. */
export class Throttle {
  private next = 0
  constructor(private readonly intervalMs: number) {}
  async wait() {
    const now = Date.now()
    const slot = Math.max(now, this.next)
    this.next = slot + this.intervalMs
    if (slot > now) await sleep(slot - now)
  }
}

export interface FetchRetryOptions {
  /** Spaces the attempts; shared between callers so a burst stays under the API quota. */
  throttle?: Throttle
  /** Per attempt; a timeout counts as a network error. */
  timeoutMs?: number
  /** Extra attempts after the first one, on network errors and 429/5xx answers. */
  retries?: number
  /** Wait before the first retry, doubled each time. */
  backoffMs?: number
  fetch?: typeof fetch
}

/**
 * fetch with a throttle, a timeout and retries. A network error is thrown once the attempts
 * are spent; any other answer (404 and 4xx included) is returned for the caller to read.
 */
export async function fetchRetry(url: string, options: FetchRetryOptions = {}): Promise<Response> {
  const { throttle, timeoutMs, retries = 0, backoffMs = 2000 } = options
  for (let attempt = 0; ; attempt++) {
    await throttle?.wait()
    const last = attempt >= retries
    let response: Response
    try {
      response = await (options.fetch ?? fetch)(url, timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : undefined)
    } catch (error) {
      if (last) throw error
      await sleep(backoffMs * 2 ** attempt)
      continue
    }
    if (response.status === 404 || response.ok || last || (response.status < 500 && response.status !== 429)) return response
    await sleep(backoffMs * 2 ** attempt)
  }
}

/** Cached lookups survive a crash so a run resumes where it stopped; they expire so each run refreshes. */
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

interface CacheLine<T> {
  key: string
  at: number
  value: T | null
}

export class JsonlCache<T> {
  private readonly map = new Map<string, CacheLine<T>>()

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true })
    if (!existsSync(path)) return
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line) continue
      try {
        const parsed = JSON.parse(line) as CacheLine<T>
        if (Date.now() - parsed.at < CACHE_TTL_MS) this.map.set(parsed.key, parsed)
      } catch {}
    }
  }

  has(key: string) {
    return this.map.has(key)
  }

  get(key: string): T | null {
    return this.map.get(key)?.value ?? null
  }

  set(key: string, value: T | null) {
    const line: CacheLine<T> = { key, at: Date.now(), value }
    this.map.set(key, line)
    appendFileSync(this.path, `${JSON.stringify(line)}\n`)
  }
}
