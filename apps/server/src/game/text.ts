// ponytail: O(n*m) Levenshtein, fine for song name lengths
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[m][n]
}

/** Lowercase, strip accents, drop punctuation and bracketed extras. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
}

export function similarity(a: string, b: string): number {
  if (a === b) return 100
  if (!a || !b) return 0
  return Math.round((1 - levenshtein(a, b) / Math.max(a.length, b.length)) * 100)
}
