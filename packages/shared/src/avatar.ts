/** Avatar codec shared by the web app (Blobatar) and the server (OG cards). */

/**
 * A player's avatar travels as a single string (stored in localStorage and
 * relayed by the server as `avatarSeed`), so the customisation is packed into
 * it: `v1|seed|shape|hue|tone|expression`. Empty fields stay random from the
 * seed. Anything not in that format is a plain legacy seed.
 */
export interface AvatarConfig {
  seed: string
  shape: AvatarShape | null
  /** Degrees, 0–359. */
  hue: number | null
  tone: AvatarTone | null
  expression: AvatarExpression
}

export enum AvatarShape {
  Round = "round",
  Organic = "organic",
  Boxy = "boxy",
  Capsule = "capsule",
  Nub = "nub",
  Cloud = "cloud",
  Droplet = "droplet",
  Hexagon = "hexagon",
  Sun = "sun",
  Triangle = "triangle",
}

/** Midpoint of each silhouette's band in blobatar's gen2 shape table. */
export const SHAPE_TRAIT: Record<AvatarShape, number> = {
  [AvatarShape.Round]: 0.11,
  [AvatarShape.Organic]: 0.35,
  [AvatarShape.Boxy]: 0.54,
  [AvatarShape.Capsule]: 0.65,
  [AvatarShape.Nub]: 0.745,
  [AvatarShape.Cloud]: 0.825,
  [AvatarShape.Droplet]: 0.8875,
  [AvatarShape.Hexagon]: 0.93,
  [AvatarShape.Sun]: 0.965,
  [AvatarShape.Triangle]: 0.99,
}

export enum AvatarTone {
  Pastel = "pastel",
  Pale = "pale",
  Mid = "mid",
  Deep = "deep",
  Bright = "bright",
  Ink = "ink",
}

/** Midpoint of each swatch in blobatar's tone set. */
export const TONE_VALUE: Record<AvatarTone, number> = {
  [AvatarTone.Pastel]: 0.1,
  [AvatarTone.Pale]: 0.28,
  [AvatarTone.Mid]: 0.49,
  [AvatarTone.Deep]: 0.71,
  [AvatarTone.Bright]: 0.865,
  [AvatarTone.Ink]: 0.965,
}

export enum AvatarExpression {
  Idle = "idle",
  Happy = "happy",
  Wink = "wink",
  Surprised = "surprised",
  Love = "love",
  Smug = "smug",
  Shy = "shy",
  Thinking = "thinking",
  Sleepy = "sleepy",
  Unsure = "unsure",
  Sad = "sad",
  Scared = "scared",
  Mad = "mad",
  Sick = "sick",
}

const PREFIX = "v1"
const SEP = "|"

function isEnumValue<T extends string>(values: Record<string, T>, raw: string): raw is T {
  return (Object.values(values) as string[]).includes(raw)
}

export function decodeAvatar(raw: string): AvatarConfig {
  const parts = raw.split(SEP)
  if (parts[0] !== PREFIX || parts.length !== 6) {
    return { seed: raw, shape: null, hue: null, tone: null, expression: AvatarExpression.Idle }
  }
  const [, seed, shape, hue, tone, expression] = parts
  const hueValue = Number.parseInt(hue, 10)
  return {
    seed,
    shape: isEnumValue(AvatarShape, shape) ? shape : null,
    hue: Number.isFinite(hueValue) ? ((hueValue % 360) + 360) % 360 : null,
    tone: isEnumValue(AvatarTone, tone) ? tone : null,
    expression: isEnumValue(AvatarExpression, expression) ? expression : AvatarExpression.Idle,
  }
}

export function encodeAvatar(config: AvatarConfig): string {
  const plain =
    config.shape === null &&
    config.hue === null &&
    config.tone === null &&
    config.expression === AvatarExpression.Idle
  // Keep legacy-looking seeds when nothing is customised
  if (plain) return config.seed
  return [
    PREFIX,
    config.seed.replaceAll(SEP, ""),
    config.shape ?? "",
    config.hue ?? "",
    config.tone ?? "",
    config.expression,
  ].join(SEP)
}
