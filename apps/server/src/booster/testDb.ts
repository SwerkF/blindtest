import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PrismaClient } from "@prisma/client"
import { singleConnectionUrl } from "@/dbUrl"

const SERVER_DIR = join(import.meta.dir, "../..")

/** A throwaway SQLite database with the real schema, for the integration tests. */
export function createTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "blindtest-"))
  const url = `file:${join(dir, "test.db")}`
  const push = Bun.spawnSync(["bunx", "prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
    cwd: SERVER_DIR,
    env: { ...process.env, DATABASE_URL: url },
    stdout: "pipe",
    stderr: "pipe",
  })
  if (push.exitCode !== 0) throw new Error(`prisma db push failed: ${push.stderr.toString()}`)
  const client = new PrismaClient({ datasources: { db: { url: singleConnectionUrl(url) } } })
  return {
    client,
    async close() {
      await client.$disconnect()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
