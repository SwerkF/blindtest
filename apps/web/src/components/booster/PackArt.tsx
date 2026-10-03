import { VinylRecord } from "@phosphor-icons/react"
import type { PackRarity } from "@blindmusic/shared"
import { PACK_STYLE } from "@/utils/rarity"

interface PackArtProps {
  rarity: PackRarity
  className?: string
  /** Wiggles while the opening request is running. */
  shaking?: boolean
  /** Tears away once the vinyls come out. */
  tearing?: boolean
}

/**
 * Placeholder look of a booster until the final designs land: a coloured wrapper
 * with a record. Swap this component (and `PACK_STYLE`) to change every pack at once.
 */
export default function PackArt({ rarity, className = "", shaking = false, tearing = false }: PackArtProps) {
  const style = PACK_STYLE[rarity]
  return (
    <div
      className={`relative aspect-[3/4] rounded-2xl overflow-hidden border-2 flex flex-col items-center justify-between py-4 text-white select-none ${
        shaking ? "animate-pack-shake" : ""
      } ${tearing ? "animate-pack-tear" : ""} ${className}`}
      style={{ borderColor: style.color, background: `linear-gradient(160deg, ${style.from}, ${style.to})` }}
    >
      <span className="text-[10px] font-black uppercase tracking-[0.25em] opacity-90">Blindtest</span>
      <VinylRecord size="46%" weight="duotone" className="opacity-95" />
      <span className="text-[11px] sm:text-xs font-black uppercase tracking-wider text-center px-2 leading-tight">
        {style.label}
      </span>
    </div>
  )
}
