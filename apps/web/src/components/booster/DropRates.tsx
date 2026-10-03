import { Info } from "@phosphor-icons/react"
import {
  CARD_PERCENTILES,
  CARD_RARITIES,
  MAX_PACKS_PER_DAY,
  MIN_ROUNDS_FOR_DROP,
  MIN_ROUND_DURATION_SEC,
  PACK_CARD_RATES,
  PACK_RARITIES,
  PACK_SIZE,
  PITY_THRESHOLD,
  packDropChance,
  packRarityRates,
  playSeconds,
} from "@blindmusic/shared"
import { CARD_STYLE, PACK_STYLE, formatPercent } from "@/utils/rarity"

const EXAMPLES: { rounds: number; seconds: number }[] = [
  { rounds: 5, seconds: 10 },
  { rounds: 10, seconds: 20 },
  { rounds: 10, seconds: 30 },
  { rounds: 20, seconds: 30 },
]

const PERFORMANCES = [
  { label: "Partie faible", perf: 0 },
  { label: "Partie correcte", perf: 0.5 },
  { label: "Partie excellente", perf: 1 },
]

/** Every rate shown here comes from the same constants the server draws with. */
export default function DropRates() {
  return (
    <details className="group bg-canvas/60 border border-edge rounded-2xl px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-ink flex items-center gap-2 select-none">
        <Info size={16} weight="bold" className="text-accent" />
        Taux de drop et règles
      </summary>
      <div className="mt-4 flex flex-col gap-5 text-sm text-muted">
        <section>
          <h3 className="text-xs font-medium uppercase tracking-wider mb-2">Gagner un booster</h3>
          <p className="mb-2">
            À la fin d'une partie, plus tu as joué longtemps, plus tu as de chances de gagner un booster. Mieux tu joues,
            plus il est rare. Il faut un compte, {MIN_ROUNDS_FOR_DROP} manches minimum de {MIN_ROUND_DURATION_SEC} s
            minimum, au moins 1 point, et {MAX_PACKS_PER_DAY} boosters gagnés par jour au maximum. Seul, la chance est
            divisée par deux.
          </p>
          <ul className="grid sm:grid-cols-2 gap-1">
            {EXAMPLES.map(({ rounds, seconds }) => (
              <li key={`${rounds}-${seconds}`} className="flex justify-between gap-3 bg-surface rounded-lg px-3 py-1.5">
                <span>
                  {rounds} manches de {seconds} s
                </span>
                <strong className="text-ink">{formatPercent(packDropChance(playSeconds(rounds, seconds), 4) * 100)}</strong>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="text-xs font-medium uppercase tracking-wider mb-2">Rareté du booster gagné</h3>
          <RatesTable
            columns={PACK_RARITIES.map((r) => ({ key: r, label: PACK_STYLE[r].label.replace("Booster ", ""), color: PACK_STYLE[r].color }))}
            rows={PERFORMANCES.map(({ label, perf }) => {
              const rates = packRarityRates(perf)
              return { label, values: PACK_RARITIES.map((r) => rates[r]) }
            })}
          />
        </section>

        <section>
          <h3 className="text-xs font-medium uppercase tracking-wider mb-2">Vinyles dans un booster ({PACK_SIZE} par pack)</h3>
          <RatesTable
            columns={CARD_RARITIES.map((r) => ({ key: r, label: CARD_STYLE[r].label, color: CARD_STYLE[r].color }))}
            rows={PACK_RARITIES.map((pack) => ({
              label: PACK_STYLE[pack].label,
              values: CARD_RARITIES.map((r) => PACK_CARD_RATES[pack][r]),
            }))}
          />
          <p className="mt-2">
            Garantie : un vinyle légendaire est assuré après {PITY_THRESHOLD} boosters ouverts sans en avoir eu.
          </p>
        </section>

        <section>
          <h3 className="text-xs font-medium uppercase tracking-wider mb-2">Rareté d'un vinyle</h3>
          <p>
            Elle suit la popularité du titre (rang Deezer et écoutes) comparée aux titres du même style : légendaire
            à partir du top {100 - CARD_PERCENTILES.legendaire} %, épique top {100 - CARD_PERCENTILES.epique} %, rare
            top {100 - CARD_PERCENTILES.rare} %, commun pour le reste. Elle est figée quand tu obtiens le vinyle.
          </p>
        </section>
      </div>
    </details>
  )
}

function RatesTable({
  columns,
  rows,
}: {
  columns: { key: string; label: string; color: string }[]
  rows: { label: string; values: number[] }[]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr>
            <th />
            {columns.map((c) => (
              <th key={c.key} className="px-2 py-1 text-xs font-bold whitespace-nowrap" style={{ color: c.color }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-edge">
              <th className="pr-2 py-1.5 font-medium text-ink whitespace-nowrap">{row.label}</th>
              {row.values.map((value, i) => (
                <td key={columns[i]!.key} className="px-2 py-1.5 tabular-nums">
                  {formatPercent(value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
