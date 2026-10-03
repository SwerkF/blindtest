import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CardRarity, PACK_RARITIES, type PackRarity } from "@blindmusic/shared"
import { AccountQueryKey, accountApi } from "@/utils/accountApi"
import { CARD_STYLE } from "@/utils/rarity"
import PackArt from "@/components/booster/PackArt"
import PackOpening from "@/components/booster/PackOpening"

/** My unopened packs, the pity progress and the opening button. */
export default function BoosterPanel() {
  const [opening, setOpening] = useState<PackRarity | null>(null)
  const { data, isLoading, isError } = useQuery({ queryKey: [AccountQueryKey.Boosters], queryFn: accountApi.boosters })

  if (isLoading) return <p className="text-sm text-muted">Chargement…</p>
  if (isError || !data) return <p className="text-sm text-red-500">Impossible de charger tes boosters</p>

  const total = data.packs.reduce((sum, p) => sum + p.count, 0)
  const untilPity = Math.max(1, data.pityThreshold - data.packsSincePity)
  const pityColor = CARD_STYLE[CardRarity.Legendaire].color

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xs text-muted font-medium uppercase tracking-wider mb-3">
          Mes boosters · {total} à ouvrir
        </h2>
        <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {PACK_RARITIES.map((rarity) => {
            const count = data.packs.find((p) => p.rarity === rarity)?.count ?? 0
            return (
              <li key={rarity} className="flex flex-col items-center gap-2">
                <div className={`relative w-full max-w-[130px] ${count === 0 ? "opacity-40 grayscale" : ""}`}>
                  <PackArt rarity={rarity} />
                  <span className="absolute -top-2 -right-2 min-w-6 h-6 px-1.5 rounded-full bg-ink text-canvas text-xs font-black flex items-center justify-center">
                    {count}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={count === 0 || !data.catalogReady}
                  onClick={() => setOpening(rarity)}
                  className="text-xs font-semibold bg-accent text-white px-3 py-1.5 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Ouvrir
                </button>
              </li>
            )
          })}
        </ul>
        {total === 0 && (
          <p className="mt-3 text-sm text-muted">
            Aucun booster pour l'instant : termine des parties, plus tu joues longtemps plus tu as de chances d'en gagner.
          </p>
        )}
        {!data.catalogReady && (
          <p className="mt-3 text-sm text-muted">Le catalogue de vinyles n'est pas encore prêt : les boosters s'ouvriront bientôt.</p>
        )}
      </div>

      <div className="bg-canvas/60 border border-edge rounded-2xl px-4 py-3">
        <div className="flex items-center justify-between text-sm gap-3">
          <span className="font-semibold text-ink">Garantie légendaire</span>
          <span className="text-muted">
            {untilPity === 1 ? "au prochain booster !" : `dans ${untilPity} boosters`}
          </span>
        </div>
        <div
          className="mt-2 h-2 rounded-full bg-edge overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={data.pityThreshold}
          aria-valuenow={data.packsSincePity}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(100, (data.packsSincePity / data.pityThreshold) * 100)}%`, background: pityColor }}
          />
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {data.packsSincePity} / {data.pityThreshold} boosters ouverts sans vinyle légendaire
        </p>
      </div>

      {opening && (
        <PackOpening
          rarity={opening}
          stock={data.packs.find((p) => p.rarity === opening)?.count ?? 0}
          onClose={() => setOpening(null)}
        />
      )}
    </div>
  )
}
