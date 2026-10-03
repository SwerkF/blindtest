/** bun run catalog:import [-- --in file] [--force] : loads the JSONL built by catalog:build into the database. */
import { join } from "node:path"
import { prisma } from "@/db"
import { parseArgs } from "./args"
import { importEntries, readEntries } from "./importer"

const { flags, values } = parseArgs(process.argv.slice(2), ["in"])
const file = values.get("in") ?? join(process.env.CATALOG_CACHE_DIR || join(import.meta.dir, ".cache"), "catalog.jsonl")
const summary = await importEntries(prisma, readEntries(file), { force: flags.has("force") })
console.log("[catalog] import terminé :", summary)
await prisma.$disconnect()
