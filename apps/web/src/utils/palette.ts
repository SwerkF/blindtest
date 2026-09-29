/** Colour themes; the CSS for each lives in index.css under [data-palette]. */
export enum Palette {
  Toffee = "toffee",
  Ocean = "ocean",
  Forest = "forest",
  Sakura = "sakura",
  Neon = "neon",
  Mint = "mint",
}

export const PALETTES: { id: Palette; label: string; swatch: string }[] = [
  { id: Palette.Toffee, label: "Caramel", swatch: "#946846" },
  { id: Palette.Ocean, label: "Océan", swatch: "#2f6fdf" },
  { id: Palette.Forest, label: "Forêt", swatch: "#2f8a4c" },
  { id: Palette.Sakura, label: "Sakura", swatch: "#d9467a" },
  { id: Palette.Neon, label: "Néon", swatch: "#7c4dff" },
  { id: Palette.Mint, label: "Menthe", swatch: "#0f9488" },
]

const KEY = "blindtest:palette"

function isPalette(value: string | null): value is Palette {
  return PALETTES.some((p) => p.id === value)
}

export function getPalette(): Palette {
  try {
    const stored = localStorage.getItem(KEY)
    return isPalette(stored) ? stored : Palette.Toffee
  } catch {
    return Palette.Toffee
  }
}

export function applyPalette(palette: Palette) {
  // The default palette is the base :root tokens, no attribute needed
  if (palette === Palette.Toffee) delete document.documentElement.dataset.palette
  else document.documentElement.dataset.palette = palette
}

export function setPalette(palette: Palette) {
  try {
    localStorage.setItem(KEY, palette)
  } catch {}
  applyPalette(palette)
}
