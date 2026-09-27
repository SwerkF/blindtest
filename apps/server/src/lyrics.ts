interface LyricsResponse {
  lyrics?: string
}

const MAX_CHARS = 4000

/**
 * Best-effort lookup against the free lyrics.ovh service. Returns null on any
 * failure so a missing result never holds up the round.
 */
export async function fetchLyrics(artist: string, title: string): Promise<string | null> {
  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data: LyricsResponse = await res.json()
    const text = data.lyrics?.replace(/\r\n/g, "\n").trim()
    if (!text) return null
    return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text
  } catch {
    return null
  }
}

/**
 * Providers index the released title, so the untouched one is tried before the
 * guessable version we stripped down.
 */
export async function fetchTrackLyrics(
  artist: string,
  fullTitle: string,
  cleanedTitle: string
): Promise<string | null> {
  const viaFull = await fetchLyrics(artist, fullTitle)
  if (viaFull) return viaFull
  if (cleanedTitle === fullTitle) return null
  return fetchLyrics(artist, cleanedTitle)
}
