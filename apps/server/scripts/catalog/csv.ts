import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"

/** Splits one CSV line, honouring quotes and doubled quotes. Multi-line fields are not supported. */
export function parseCsvLine(line: string, separator = ","): string[] {
  const fields: string[] = []
  let current = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (char === '"') quoted = false
      else current += char
    } else if (char === '"') quoted = true
    else if (char === separator) {
      fields.push(current)
      current = ""
    } else current += char
  }
  fields.push(current)
  return fields
}

/** Streams the rows of a CSV file as objects keyed by the header, so a huge MusicBrainz export fits in memory. */
export async function* readCsv(path: string): AsyncGenerator<Record<string, string>> {
  const lines = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity })
  let header: string[] | null = null
  for await (const raw of lines) {
    const line = raw.replace(/^﻿/, "")
    if (!line.trim()) continue
    const fields = parseCsvLine(line)
    if (!header) {
      header = fields.map((f) => f.trim().toLowerCase())
      continue
    }
    const row: Record<string, string> = {}
    header.forEach((name, i) => (row[name] = fields[i] ?? ""))
    yield row
  }
}
