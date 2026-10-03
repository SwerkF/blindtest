import { randomInt } from "node:crypto"

/** Uniform integer in [0, max). Injectable so tests can script the draws. */
export type RandomInt = (max: number) => number

/** Every draw of the boosters goes through the OS CSPRNG (node:crypto), server side only. */
export const rngInt: RandomInt = (max) => randomInt(max)

const PRECISION = 1000

/** Picks a key with a probability proportional to its weight (decimals up to 1/1000 are kept). */
export function weightedPick<K extends string>(weights: Record<K, number>, random: RandomInt = rngInt): K {
  const entries = (Object.entries(weights) as [K, number][]).filter(([, weight]) => weight > 0)
  const scaled = entries.map(([key, weight]) => [key, Math.round(weight * PRECISION)] as const)
  const total = scaled.reduce((sum, [, weight]) => sum + weight, 0)
  if (total <= 0) throw new Error("weightedPick needs at least one positive weight")
  let roll = random(total)
  for (const [key, weight] of scaled) {
    if (roll < weight) return key
    roll -= weight
  }
  return scaled[scaled.length - 1]![0]
}
