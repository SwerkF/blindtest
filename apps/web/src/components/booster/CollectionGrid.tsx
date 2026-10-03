import { useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { CaretLeft, CaretRight } from "@phosphor-icons/react"
import { CARD_RARITIES, type CardRarity } from "@blindmusic/shared"
import { AccountQueryKey, accountApi } from "@/utils/accountApi"
import { CARD_STYLE } from "@/utils/rarity"
import VinylCard from "@/components/booster/VinylCard"

interface CollectionGridProps {
  /** Owner of the collection; null = mine. */
  userId: string | null
  /** Shown when the collection is empty. */
  emptyText?: string
}

/** A player's vinyls, filterable by rarity and paginated. Used for my tab and for public profiles. */
export default function CollectionGrid({ userId, emptyText = "Aucun vinyle pour l'instant." }: CollectionGridProps) {
  const [rarity, setRarity] = useState<CardRarity | null>(null)
  const [page, setPage] = useState(1)
  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: [AccountQueryKey.Collection, userId ?? "me", rarity, page],
    queryFn: () => accountApi.collection(userId, page, rarity),
    placeholderData: keepPreviousData,
  })

  if (isLoading) return <p className="text-sm text-muted">Chargement…</p>
  if (isError || !data) return <p className="text-sm text-red-500">Impossible de charger la collection</p>

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))
  const pick = (next: CardRarity | null) => {
    setRarity(next)
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        <strong className="text-ink">{data.unique}</strong> vinyle{data.unique > 1 ? "s" : ""} différent
        {data.unique > 1 ? "s" : ""} · {data.copies} exemplaire{data.copies > 1 ? "s" : ""}
      </p>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par rareté">
        <FilterChip active={rarity === null} onClick={() => pick(null)} label="Tous" />
        {CARD_RARITIES.map((r) => {
          const row = data.summary.find((s) => s.rarity === r)
          return (
            <FilterChip
              key={r}
              active={rarity === r}
              onClick={() => pick(r)}
              label={`${CARD_STYLE[r].label} ${row?.owned ?? 0}/${row?.total ?? 0}`}
              color={CARD_STYLE[r].color}
            />
          )
        })}
      </div>

      {data.items.length === 0 ? (
        <p className="text-sm text-muted">{emptyText}</p>
      ) : (
        <ul className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 ${isFetching ? "opacity-70" : ""}`}>
          {data.items.map((card) => (
            <li key={card.entryId}>
              <VinylCard card={card} />
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm text-muted">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            aria-label="Page précédente"
            className="w-9 h-9 rounded-xl border border-edge flex items-center justify-center hover:border-muted disabled:opacity-40"
          >
            <CaretLeft size={16} weight="bold" />
          </button>
          <span>
            Page {page} / {pages}
          </span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Page suivante"
            className="w-9 h-9 rounded-xl border border-edge flex items-center justify-center hover:border-muted disabled:opacity-40"
          >
            <CaretRight size={16} weight="bold" />
          </button>
        </div>
      )}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean
  onClick: () => void
  label: string
  color?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
        active ? "text-white border-transparent" : "text-muted border-edge hover:border-muted"
      }`}
      style={active ? { background: color ?? "var(--color-accent)" } : color ? { color } : undefined}
    >
      {label}
    </button>
  )
}
