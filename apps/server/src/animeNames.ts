import { normalize, similarity } from "@/game/text"

/**
 * Everything after one of these is a season/part marker, not the name people
 * say: "Shingeki no Kyojin: The Final Season Part 2" -> "Shingeki no Kyojin".
 */
const SEASON_MARKER =
  /\s*[:\-–]?\s*\b(the\s+)?(final\s+season|(\d+|first|second|third|fourth|fifth)(st|nd|rd|th)?\s+season|season\s*\d+|saison\s*\d+|part\s*\d+|cour\s*\d+|movie|film|ova|ona|specials?|recap)\b.*$/i

/** Trailing sequel numbers: "Overlord III", "Haikyuu!! 2". */
const TRAILING_NUMBER = /\s+(ii|iii|iv|v|vi|\d{1,2})\s*$/i

/**
 * Best-known French and English titles, keyed by the start of the normalised
 * romaji title. AniList usually has them too; this keeps the classics playable
 * when it is unreachable.
 */
const KNOWN_ALIASES: Record<string, string[]> = {
  "shingeki no kyojin": ["L'Attaque des Titans", "Attack on Titan"],
  "boku no hero academia": ["My Hero Academia"],
  "hagane no renkinjutsushi": ["Fullmetal Alchemist"],
  "shinseiki evangelion": ["Neon Genesis Evangelion", "Evangelion"],
  "saint seiya": ["Les Chevaliers du Zodiaque"],
  "captain tsubasa": ["Olive et Tom"],
  "hokuto no ken": ["Ken le Survivant"],
  "city hunter": ["Nicky Larson"],
  "cat s eye": ["Signé Cat's Eyes"],
  "bishoujo senshi sailor moon": ["Sailor Moon"],
  "sen to chihiro no kamikakushi": ["Le Voyage de Chihiro"],
  "tonari no totoro": ["Mon voisin Totoro"],
  "mononoke hime": ["Princesse Mononoké"],
  "kimi no na wa": ["Your Name"],
  "yakusoku no neverland": ["The Promised Neverland"],
  "boku dake ga inai machi": ["Erased"],
  "ansatsu kyoushitsu": ["Assassination Classroom"],
  "nanatsu no taizai": ["Seven Deadly Sins"],
  "ore dake level up na ken": ["Solo Leveling"],
  "sousou no frieren": ["Frieren"],
  "tensei shitara slime datta ken": ["Moi, quand je me réincarne en Slime", "Slime"],
  "kimetsu no yaiba": ["Demon Slayer", "Les Rôdeurs de la nuit"],
  "ano hi mita hana no namae": ["AnoHana"],
  "sword art online": ["SAO"],
  "hunter x hunter": ["HxH"],
  "jujutsu kaisen": ["JJK"],
  "one punch man": ["OPM"],
  "fullmetal alchemist": ["FMA"],
  "jojo no kimyou na bouken": ["JoJo's Bizarre Adventure", "JoJo"],
  "kaguya sama wa kokurasetai": ["Kaguya-sama: Love is War", "Kaguya-sama"],
  "shigatsu wa kimi no uso": ["Your Lie in April", "Ton mensonge en avril"],
  "dragon quest dai no daibouken": ["Fly"],
  "kidou senshi gundam": ["Mobile Suit Gundam", "Gundam"],
  "ookami to koushinryou": ["Spice and Wolf"],
  "kage no jitsuryokusha ni naritakute": ["The Eminence in Shadow"],
  "mahou shoujo madoka magica": ["Madoka Magica"],
  "yahari ore no seishun love comedy wa machigatteiru": ["Oregairu"],
  "enen no shouboutai": ["Fire Force"],
}

/** "Shingeki no Kyojin: The Final Season Part 2" -> "Shingeki no Kyojin". */
export function coreTitle(title: string): string {
  let core = title.replace(/\s*\((tv|movie|ova|ona|\d{4})\)\s*$/i, "")
  for (let pass = 0; pass < 3; pass++) {
    const next = core.replace(SEASON_MARKER, "").replace(TRAILING_NUMBER, "").trim()
    if (next === core) break
    core = next
  }
  return core
}

/** The title itself, without its season marker, without its subtitle, and the subtitle alone. */
export function animeNameVariants(name: string): string[] {
  const variants = new Set<string>([name.trim()])
  const core = coreTitle(name)
  if (normalize(core).length >= 3) variants.add(core)
  const beforeColon = name.split(":")[0].trim()
  if (normalize(beforeColon).length >= 4) variants.add(beforeColon)
  const coreBeforeColon = coreTitle(beforeColon)
  if (normalize(coreBeforeColon).length >= 4) variants.add(coreBeforeColon)
  // "Demon Slayer: Kimetsu no Yaiba", "JoJo...: Diamond is Unbreakable"
  const subtitle = coreTitle(name.split(":").slice(1).join(":").trim())
  if (subtitle.split(/\s+/).length >= 2 && normalize(subtitle).length >= 8) variants.add(subtitle)
  return [...variants].filter(Boolean)
}

/** "Shingeki no Kyojin" -> "snk", "My Hero Academia" -> "mha", "Hunter x Hunter" -> "hxh". */
export function acronymOf(name: string): string | null {
  const words = normalize(name).split(" ").filter(Boolean)
  if (words.length < 2) return null
  const acronym = words.map((w) => w[0]).join("")
  return acronym.length >= 2 ? acronym : null
}

function knownAliasesFor(title: string): string[] {
  const key = normalize(coreTitle(title))
  const out: string[] = []
  for (const [prefix, titles] of Object.entries(KNOWN_ALIASES)) {
    if (key.startsWith(prefix)) out.push(...titles)
  }
  return out
}

/**
 * The first alias of the built-in list that is a real name, not an
 * abbreviation ("Demon Slayer" yes, "SAO" or "Fly" no).
 */
export function knownDisplayName(title: string): string | null {
  for (const alias of knownAliasesFor(title)) {
    if (normalize(alias).replace(/\s/g, "").length > 5) return alias
  }
  return null
}

export interface AnimeTitles {
  english?: string | null
  romaji?: string | null
}

/**
 * The name most players know the anime by: the built-in French/English alias
 * ("Les Chevaliers du Zodiaque"), then the AniList English title ("Solo
 * Leveling" for "Ore dake Level Up na Ken"), then romaji, then AnimeThemes'.
 */
export function bestKnownName(name: string, aniList?: AnimeTitles | null): string {
  for (const title of [name, aniList?.romaji, aniList?.english]) {
    const known = title ? knownDisplayName(title) : null
    if (known) return known
  }
  return aniList?.english?.trim() || aniList?.romaji?.trim() || name
}

export interface AnimeAnswers {
  names: string[]
  acronyms: string[]
}

/** Every way a player may name the anime, from all the titles known for it. */
export function expandAnswers(titles: string[]): AnimeAnswers {
  const all = [...titles]
  for (const t of titles) all.push(...knownAliasesFor(t))

  const names = new Set<string>()
  const acronyms = new Set<string>()
  for (const title of all) {
    for (const v of animeNameVariants(title)) {
      const n = normalize(v)
      if (!n) continue
      names.add(v)
      const acronym = acronymOf(v)
      if (acronym) acronyms.add(acronym)
      // A short one-word synonym ("SnK", "AoT", "JJK") is an abbreviation already
      const compact = n.replace(/\s/g, "")
      if (compact.length >= 2 && compact.length <= 5) acronyms.add(compact)
    }
  }
  return { names: [...names], acronyms: [...acronyms] }
}

/** Articles are dropped so "attaque des titans" matches "L'Attaque des Titans". */
function comparable(s: string): string {
  return normalize(s)
    .replace(/^(the|a|an|l|le|la|les)\s+/, "")
    .trim()
}

/**
 * A guess names the anime when it is close to one of its names (typos,
 * accents, spacing), starts it with at least two words ("boku no hero"), or
 * is one of its abbreviations spelled exactly.
 */
export function matchesAnswer(rawGuess: string, answers: AnimeAnswers, maxErrorPercent: number): boolean {
  const guess = comparable(rawGuess)
  if (!guess) return false
  const compactGuess = guess.replace(/\s/g, "")
  if (answers.acronyms.includes(compactGuess)) return true

  const accept = 100 - maxErrorPercent
  return answers.names.some((name) => {
    const target = comparable(name)
    if (!target) return false
    if (guess === target) return true
    // Short names ("K-On", "86") leave no room for typos
    if (target.length < 4) return compactGuess === target.replace(/\s/g, "")
    // The whole name typed inside a longer sentence
    if (target.length >= 4 && guess.includes(target)) return true
    // The start of a long name, cut at a word boundary: two words, or one long enough word
    if (target.startsWith(`${guess} `)) {
      const words = guess.split(" ").length
      if (words >= 2 && guess.length >= 6) return true
      if (guess.length >= 5 && guess.length / target.length >= 0.4) return true
    }
    const compactTarget = target.replace(/\s/g, "")
    return similarity(guess, target) >= accept || similarity(compactGuess, compactTarget) >= accept
  })
}

/** Within reach of a name without being accepted: "getting warm". */
export function isCloseToAnswer(rawGuess: string, answers: AnimeAnswers, maxErrorPercent: number): boolean {
  const guess = comparable(rawGuess)
  const accept = 100 - maxErrorPercent
  return answers.names.some((name) => {
    const sim = similarity(guess, comparable(name))
    return sim < accept && sim >= accept - 22
  })
}
