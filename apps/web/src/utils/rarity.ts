import { CardRarity, PackRarity } from "@blindmusic/shared"

/**
 * Look of every rarity. Packs and vinyls are drawn from this one table, so the
 * final pack designs only have to replace the values (and PackArt) here.
 */
export interface RarityStyle {
  label: string
  /** Main colour: borders, chips, labels. */
  color: string
  /** Gradient stops for a pack or a vinyl label. */
  from: string
  to: string
}

export const CARD_STYLE: Record<CardRarity, RarityStyle> = {
  [CardRarity.Commun]: { label: "Commun", color: "#8b8f98", from: "#a3a7b0", to: "#6b7078" },
  [CardRarity.Rare]: { label: "Rare", color: "#3b82f6", from: "#60a5fa", to: "#2563eb" },
  [CardRarity.Epique]: { label: "Épique", color: "#a855f7", from: "#c084fc", to: "#7e22ce" },
  [CardRarity.Legendaire]: { label: "Légendaire", color: "#f59e0b", from: "#fcd34d", to: "#d97706" },
}

export const PACK_STYLE: Record<PackRarity, RarityStyle> = {
  [PackRarity.Normal]: { label: "Booster normal", color: "#a8845a", from: "#c9a77c", to: "#8a6a43" },
  [PackRarity.Rare]: { label: "Booster rare", color: "#3b82f6", from: "#60a5fa", to: "#1d4ed8" },
  [PackRarity.TresRare]: { label: "Booster très rare", color: "#a855f7", from: "#c084fc", to: "#6d28d9" },
  [PackRarity.Ultime]: { label: "Booster ultime", color: "#f59e0b", from: "#fde68a", to: "#b45309" },
}

/** Formats a percentage the French way: 82 %, 2,6 %, 0,4 %. */
export function formatPercent(value: number): string {
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded.toLocaleString("fr-FR")} %`
}
