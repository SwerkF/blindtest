import { useEffect, useState } from "react"
import { Moon, Sun } from "@phosphor-icons/react"

const KEY = "blindtest:theme"

export function prefersDark(): boolean {
  const stored = localStorage.getItem(KEY)
  if (stored) return stored === "dark"
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

export default function ThemeToggle() {
  const [dark, setDark] = useState(prefersDark)

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    localStorage.setItem(KEY, dark ? "dark" : "light")
  }, [dark])

  return (
    <button
      onClick={() => setDark((d) => !d)}
      aria-label={dark ? "Passer en mode clair" : "Passer en mode sombre"}
      className="p-2 rounded-xl text-muted hover:text-accent hover:bg-edge/50 transition-colors"
    >
      {dark ? <Sun size={18} weight="duotone" /> : <Moon size={18} weight="duotone" />}
    </button>
  )
}
