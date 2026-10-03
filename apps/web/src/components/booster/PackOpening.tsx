import { useEffect, useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { VinylRecord, X } from "@phosphor-icons/react"
import {
  CARD_RARITIES,
  CardRarity,
  PITY_THRESHOLD,
  type OpenPackResponse,
  type OpenedCard,
  type PackRarity,
} from "@blindmusic/shared"
import { AccountQueryKey, accountApi } from "@/utils/accountApi"
import { ApiError } from "@/utils/api"
import { CARD_STYLE, PACK_STYLE } from "@/utils/rarity"
import PackArt from "@/components/booster/PackArt"
import VinylCard from "@/components/booster/VinylCard"

interface PackOpeningProps {
  rarity: PackRarity
  /** Packs of this rarity left before opening this one. */
  stock: number
  onClose: () => void
}

type Phase = "ready" | "opening" | "reveal"

/** Rarest last, so the best vinyl is the final surprise. The draw itself already happened on the server. */
function revealOrder(cards: OpenedCard[]): OpenedCard[] {
  const rank = (c: OpenedCard) => CARD_RARITIES.indexOf(c.card.rarity)
  return [...cards].sort((a, b) => rank(a) - rank(b))
}

/** Full-screen opening: the pack shakes, tears, then the vinyls slide out of their sleeves one by one. */
export default function PackOpening({ rarity, stock, onClose }: PackOpeningProps) {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<Phase>("ready")
  const [result, setResult] = useState<OpenPackResponse | null>(null)
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const [error, setError] = useState("")

  const open = useMutation({
    mutationFn: () => accountApi.openPack(rarity),
    onMutate: () => {
      setError("")
      setPhase("opening")
    },
    onSuccess: (data) => {
      setResult(data)
      setRevealed(new Set())
      // Let the shaking pack play a beat before the tear
      setTimeout(() => setPhase("reveal"), 700)
      void queryClient.invalidateQueries({ queryKey: [AccountQueryKey.Boosters] })
      void queryClient.invalidateQueries({ queryKey: [AccountQueryKey.Collection] })
    },
    onError: (e) => {
      setPhase("ready")
      setError(e instanceof ApiError ? e.message : "Impossible d'ouvrir ce booster")
      void queryClient.invalidateQueries({ queryKey: [AccountQueryKey.Boosters] })
    },
  })

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !open.isPending) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, open.isPending])

  const cards = useMemo(() => (result ? revealOrder(result.cards) : []), [result])
  const allRevealed = cards.length > 0 && revealed.size === cards.length
  const best = cards.reduce<CardRarity>(
    (top, c) => (CARD_RARITIES.indexOf(c.card.rarity) > CARD_RARITIES.indexOf(top) ? c.card.rarity : top),
    CardRarity.Commun
  )

  function reveal(index: number) {
    setRevealed((prev) => new Set(prev).add(index))
  }

  function revealAll() {
    setRevealed(new Set(cards.map((_, i) => i)))
  }

  function another() {
    setResult(null)
    setRevealed(new Set())
    setPhase("ready")
    open.reset()
    open.mutate()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ouverture de booster"
      className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4 overflow-y-auto animate-fade"
    >
      <button
        type="button"
        onClick={onClose}
        disabled={open.isPending}
        aria-label="Fermer"
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white hover:bg-white/20 flex items-center justify-center disabled:opacity-40"
      >
        <X size={20} weight="bold" />
      </button>

      {phase !== "reveal" ? (
        <div className="flex flex-col items-center gap-6">
          <PackArt rarity={rarity} shaking={phase === "opening"} className="w-48 sm:w-56" />
          <p className="text-white/80 text-sm">
            {PACK_STYLE[rarity].label} · {stock} en réserve
          </p>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="button"
            disabled={phase === "opening"}
            onClick={() => open.mutate()}
            className="inline-flex items-center gap-2 text-base font-bold bg-accent text-white px-6 py-3 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            <VinylRecord size={20} weight="bold" />
            {phase === "opening" ? "Ouverture…" : "Ouvrir le booster"}
          </button>
        </div>
      ) : (
        <div className="w-full max-w-4xl flex flex-col items-center gap-5">
          <h2 className="text-white text-xl font-black">
            {allRevealed ? "Ton butin" : "Touche chaque vinyle pour le révéler"}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 w-full">
            {cards.map(({ card, isNew }, i) => (
              <div
                key={card.entryId}
                className="animate-vinyl-out"
                style={{ animationDelay: `${i * 120}ms` }}
              >
                {revealed.has(i) ? (
                  <div className="animate-vinyl-flip bg-surface border border-edge rounded-2xl p-2.5">
                    <VinylCard card={card} isNew={isNew} slideDisc />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => reveal(i)}
                    aria-label={`Révéler le vinyle ${i + 1}`}
                    className="w-full bg-surface/90 border border-edge rounded-2xl p-2.5 hover:border-accent transition-colors"
                  >
                    <span className="block relative w-full aspect-square">
                      <span
                        aria-hidden
                        className="absolute right-0 top-1/2 -translate-y-1/2 w-[78%] aspect-square rounded-full bg-[#17171a]"
                      />
                      <span className="relative block w-[84%] aspect-square rounded-lg border-2 border-edge bg-canvas flex items-center justify-center text-4xl font-black text-muted">
                        ?
                      </span>
                    </span>
                    <span className="block h-[58px]" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {allRevealed && result && (
            <div className="text-center text-white/90 text-sm flex flex-col items-center gap-3 animate-rise">
              {result.pityTriggered && (
                <p className="font-semibold" style={{ color: CARD_STYLE[CardRarity.Legendaire].color }}>
                  Garantie atteinte : un légendaire t'attendait après {PITY_THRESHOLD} boosters !
                </p>
              )}
              {best !== CardRarity.Commun && (
                <p>
                  Meilleure carte : <strong style={{ color: CARD_STYLE[best].color }}>{CARD_STYLE[best].label}</strong>
                </p>
              )}
              <div className="flex flex-wrap justify-center gap-3">
                {result.remaining > 0 && (
                  <button
                    type="button"
                    onClick={another}
                    className="text-sm font-bold bg-accent text-white px-5 py-2.5 rounded-xl hover:opacity-90 transition-opacity"
                  >
                    Ouvrir le suivant ({result.remaining})
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="text-sm font-semibold bg-white/10 text-white px-5 py-2.5 rounded-xl hover:bg-white/20 transition-colors"
                >
                  Voir ma collection
                </button>
              </div>
            </div>
          )}
          {!allRevealed && (
            <button
              type="button"
              onClick={revealAll}
              className="text-sm font-semibold bg-white/10 text-white px-5 py-2.5 rounded-xl hover:bg-white/20 transition-colors"
            >
              Tout révéler
            </button>
          )}
        </div>
      )}
    </div>
  )
}
