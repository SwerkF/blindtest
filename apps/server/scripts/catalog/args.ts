export interface Args {
  flags: Set<string>
  values: Map<string, string>
}

/** `--flag` and `--name value`, nothing fancier. */
export function parseArgs(argv: string[], valueOptions: string[]): Args {
  const flags = new Set<string>()
  const values = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith("--")) continue
    const name = arg.slice(2)
    if (valueOptions.includes(name)) values.set(name, argv[++i] ?? "")
    else flags.add(name)
  }
  return { flags, values }
}
