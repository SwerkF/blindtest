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
