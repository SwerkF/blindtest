/** Removes accents, case and punctuation so "Été (Remix)" and "ete" compare equal once the suffix is gone. */
function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
}

/** Key used to spot the same song released several times: title without brackets + artist. */
export function songKey(title: string, artist: string): string {
  const cleanTitle = plain(title)
    .replace(/[([].*?[)\]]/g, " ")
    .replace(/\s-\s.*$/, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
  return `${cleanTitle}|${plain(artist).replace(/[^a-z0-9]+/g, " ").trim()}`
}

const VERSION_WORDS = "remix|live|instrumental|karaoke|tribute|cover|video|clip"
/** "Song (Live at ...)", "Song - Remix", "Song [Instrumental]": a version word in a suffix, not in the real title. */
const VERSION_SUFFIX = new RegExp(`[(\\[]\\s*[^)\\]]*\\b(${VERSION_WORDS})\\b|\\s-\\s.*\\b(${VERSION_WORDS})\\b`, "i")
const BAD_ARTIST = /\b(karaoke|tribute|cover band|made famous by|originally performed|backing track)\b/i
const BAD_TITLE = /\b(karaoke|tribute to|made famous by|originally performed)\b/i

/** Remixes, live versions, instrumentals, karaoke, tributes and covers never make the catalogue. */
export function isExcluded(title: string, artist: string): boolean {
  return VERSION_SUFFIX.test(title) || BAD_TITLE.test(title) || BAD_ARTIST.test(artist)
}

const GENRES: { name: string; pattern: RegExp }[] = [
  { name: "rap", pattern: /hip.?hop|\brap\b|trap|drill|\bgrime\b/ },
  { name: "chanson", pattern: /chanson|fran[cç]ais|french|variet/ },
  { name: "metal", pattern: /metal/ },
  { name: "rock", pattern: /rock|punk|grunge|indie|alternative|new wave/ },
  { name: "electro", pattern: /electro|house|techno|trance|\bedm\b|dubstep|drum.?and.?bass|dance|ambient/ },
  { name: "rnb", pattern: /r&b|\brnb\b|soul|funk|disco|motown/ },
  { name: "reggae", pattern: /reggae|dancehall|\bska\b|afro/ },
  { name: "latin", pattern: /latin|reggaeton|salsa|bachata|cumbia/ },
  { name: "jazz", pattern: /jazz|blues|swing/ },
  { name: "country", pattern: /country|folk|bluegrass/ },
  { name: "classique", pattern: /classical|orchestr|opera|baroque/ },
  { name: "pop", pattern: /\bpop\b|synth.?pop|k-pop|j-pop|teen/ },
]

/** Macro genre from MusicBrainz tags, the most voted tag first ("rap:12|pop:3" or "pop;rock"). */
export function macroGenre(tags: string): string | null {
  const parsed = tags
    .split(/[|;]/)
    .map((raw) => {
      const [name, votes] = raw.split(":")
      return { name: (name ?? "").trim().toLowerCase(), votes: Number(votes) || 1 }
    })
    .filter((t) => t.name)
    .sort((a, b) => b.votes - a.votes)
  for (const tag of parsed) {
    const genre = GENRES.find((g) => g.pattern.test(tag.name))
    if (genre) return genre.name
  }
  return null
}

/** Genre label of a Deezer chart or editorial playlist (config), mapped to the same macro genres. */
export function genreFromLabel(label: string | undefined): string | null {
  return label ? macroGenre(label) : null
}

export function decadeOf(releaseDate: string | null | undefined): string | null {
  const year = Number((releaseDate ?? "").slice(0, 4))
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return null
  return `${Math.floor(year / 10) * 10}s`
}
