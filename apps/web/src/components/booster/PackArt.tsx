import { PackRarity } from "@blindmusic/shared"
import { PACK_STYLE } from "@/utils/rarity"

interface PackArtProps {
  rarity: PackRarity
  className?: string
  /** Wiggles while the opening request is running. */
  shaking?: boolean
  /** Tears away once the vinyls come out. */
  tearing?: boolean
}

/** Sleeve of each booster, in `public/packs`: the rarer the pack, the more ornate the sleeve. */
const PACK_IMAGE: Record<PackRarity, string> = {
  [PackRarity.Normal]: "/packs/normal.webp",
  [PackRarity.Rare]: "/packs/rare.webp",
  [PackRarity.TresRare]: "/packs/tres_rare.webp",
  [PackRarity.Ultime]: "/packs/ultime.webp",
}

/** The booster sleeve (square, transparent corners). Swap `PACK_IMAGE` to change every pack at once. */
export default function PackArt({ rarity, className = "", shaking = false, tearing = false }: PackArtProps) {
  return (
    <img
      src={PACK_IMAGE[rarity]}
      alt={PACK_STYLE[rarity].label}
      draggable={false}
      className={`aspect-square object-contain select-none drop-shadow-lg ${
        shaking ? "animate-pack-shake" : ""
      } ${tearing ? "animate-pack-tear" : ""} ${className}`}
    />
  )
}
