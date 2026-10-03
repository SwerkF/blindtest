import { expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { rngInt, weightedPick } from "@/booster/rng"

test("weightedPick suit le tirage fourni, par tranches de poids", () => {
  const weights = { a: 1, b: 2, c: 0.5 }
  // Total = 3500 : a = [0,1000), b = [1000,3000), c = [3000,3500)
  expect(weightedPick(weights, () => 0)).toBe("a")
  expect(weightedPick(weights, () => 999)).toBe("a")
  expect(weightedPick(weights, () => 1000)).toBe("b")
  expect(weightedPick(weights, () => 2999)).toBe("b")
  expect(weightedPick(weights, () => 3000)).toBe("c")
  expect(weightedPick(weights, () => 3499)).toBe("c")
})

test("weightedPick ignore les poids nuls et refuse un tirage impossible", () => {
  expect(weightedPick({ a: 0, b: 5 }, () => 0)).toBe("b")
  expect(() => weightedPick({ a: 0, b: 0 })).toThrow()
})

test("rngInt reste dans [0, max) et pioche bien partout", () => {
  const seen = new Set<number>()
  for (let i = 0; i < 2000; i++) {
    const n = rngInt(5)
    expect(n).toBeGreaterThanOrEqual(0)
    expect(n).toBeLessThan(5)
    seen.add(n)
  }
  expect(seen.size).toBe(5)
})

test("distribution réelle de weightedPick proche des poids", () => {
  const weights = { commun: 82, rare: 15, epique: 2.6, legendaire: 0.4 }
  const counts: Record<string, number> = { commun: 0, rare: 0, epique: 0, legendaire: 0 }
  const draws = 40_000
  for (let i = 0; i < draws; i++) counts[weightedPick(weights)]!++
  expect(counts.commun! / draws).toBeGreaterThan(0.8)
  expect(counts.commun! / draws).toBeLessThan(0.84)
  expect(counts.rare! / draws).toBeGreaterThan(0.13)
  expect(counts.rare! / draws).toBeLessThan(0.17)
})

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === ".cache" || name === "node_modules" ? [] : sources(path)
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : []
  })
}

test("aucun Math.random dans les boosters ni dans le script catalogue", () => {
  const roots = [join(import.meta.dir), join(import.meta.dir, "../../scripts/catalog")]
  const files = roots.flatMap((root) => {
    try {
      return sources(root)
    } catch {
      return []
    }
  })
  expect(files.length).toBeGreaterThan(0)
  for (const file of files) expect(readFileSync(file, "utf8")).not.toContain("Math.random")
})
