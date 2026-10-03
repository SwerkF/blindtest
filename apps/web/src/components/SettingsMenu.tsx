import { useEffect, useRef, useState } from "react"
import { Check, GearSix } from "@phosphor-icons/react"
import { PALETTES, getPalette, setPalette, type Palette } from "@/utils/palette"
import ThemeToggle from "@/components/ThemeToggle"
import AccountMenuSection from "@/components/AccountMenuSection"
import { setHideReactions, useHideReactions } from "@/utils/reactions"

/** Gear button opening the site settings: colour theme, dark mode, other players' reactions. */
export default function SettingsMenu() {
  const [open, setOpen] = useState(false)
  const [palette, setCurrent] = useState<Palette>(getPalette)
  const hideReactions = useHideReactions()
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  function pick(next: Palette) {
    setPalette(next)
    setCurrent(next)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Paramètres d'affichage"
        aria-expanded={open}
        className={`p-3 lg:p-2 rounded-xl text-muted hover:text-accent hover:bg-edge/50 transition-all ${
          open ? "text-accent bg-edge/50 rotate-45" : ""
        }`}
      >
        <GearSix size={18} weight="duotone" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-30 w-64 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-edge bg-surface shadow-xl p-4 animate-pop">
          <p className="text-xs text-muted font-medium uppercase tracking-wider mb-3">Thème</p>
          <div className="grid grid-cols-3 gap-2">
            {PALETTES.map((p) => {
              const active = p.id === palette
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pick(p.id)}
                  className={`flex flex-col items-center gap-1.5 p-2 min-h-11 rounded-xl border transition-colors ${
                    active ? "border-accent bg-accent/5" : "border-edge hover:border-muted"
                  }`}
                >
                  <span
                    className="w-7 h-7 rounded-full flex items-center justify-center shadow-inner"
                    style={{ backgroundColor: p.swatch }}
                  >
                    {active && <Check size={14} weight="bold" className="text-white" />}
                  </span>
                  <span className="text-xs text-ink">{p.label}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-4 pt-3 border-t border-edge flex items-center justify-between">
            <span className="text-xs text-muted font-medium uppercase tracking-wider">Mode sombre</span>
            <ThemeToggle />
          </div>
          <label className="mt-3 pt-3 border-t border-edge flex items-center justify-between gap-3 min-h-11 lg:min-h-0 cursor-pointer group">
            <span className="text-xs text-muted font-medium uppercase tracking-wider transition-colors group-hover:text-ink">
              Masquer les réactions des autres
            </span>
            <input
              type="checkbox"
              checked={hideReactions}
              onChange={(e) => setHideReactions(e.target.checked)}
              className="w-5 h-5 lg:w-4 lg:h-4 shrink-0 accent-accent"
            />
          </label>
          <AccountMenuSection onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}
