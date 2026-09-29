import { Link } from "react-router-dom"
import { PUBLISHER } from "@/legal/publisher"

/** "Édité par Kreio" and the legal links, at the bottom of the entry pages. */
export default function LegalFooter({ className = "" }: { className?: string }) {
  const link = "hover:text-accent transition-colors"
  return (
    <footer className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted ${className}`}>
      <span>
        Édité par{" "}
        <a href={PUBLISHER.url} target="_blank" rel="noreferrer" className="font-semibold text-ink hover:text-accent">
          {PUBLISHER.name}
        </a>
      </span>
      <Link to="/mentions-legales" className={link}>
        Mentions légales
      </Link>
      <Link to="/cgu" className={link}>
        CGU
      </Link>
      <Link to="/confidentialite" className={link}>
        Confidentialité
      </Link>
    </footer>
  )
}
