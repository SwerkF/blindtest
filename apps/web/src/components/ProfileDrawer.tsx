import { useEffect, useRef } from "react"
import { useLocation } from "react-router-dom"
import { ArrowLeft, X } from "@phosphor-icons/react"
import { ProfileContent } from "@/pages/Profile"
import PublicProfileView from "@/components/PublicProfileView"
import { ProfileTab, closeProfile, openProfile, setProfileTab, useProfileDrawer } from "@/utils/profileDrawer"

/**
 * Profile opened from the gear menu, or a player's public profile opened from a room: a panel over half the screen (full width on phones)
 * above a dimmed page. The page underneath stays mounted, so lobby and game sockets stay open.
 */
export default function ProfileDrawer() {
  const view = useProfileDrawer()
  const { pathname } = useLocation()
  const panelRef = useRef<HTMLDivElement>(null)
  const open = view !== null
  const title = view?.kind === "user" ? "Profil du joueur" : "Mon profil"

  // Following a link (invite toast, legal page...) leaves the drawer behind
  useEffect(() => {
    closeProfile()
  }, [pathname])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeProfile()
    }
    document.addEventListener("keydown", onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    panelRef.current?.focus()
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (!view) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div aria-hidden="true" className="absolute inset-0 bg-pitch/50 animate-fade" onClick={closeProfile} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative w-full sm:w-1/2 sm:min-w-[26rem] h-full bg-canvas border-l border-edge shadow-xl overflow-y-auto overscroll-contain outline-none animate-slide-in"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-canvas border-b border-edge px-4 sm:px-6 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex items-center gap-2 min-w-0">
            {view.kind === "user" && view.back !== null && (
              <button
                type="button"
                onClick={() => openProfile(view.back ?? ProfileTab.History)}
                aria-label="Retour à mon profil"
                title="Retour à mon profil"
                className="p-2 -m-1 rounded-lg text-muted hover:text-ink hover:bg-edge/60 transition-colors"
              >
                <ArrowLeft size={18} weight="bold" />
              </button>
            )}
            <h2 className="text-lg font-bold text-ink truncate">{title}</h2>
          </div>
          <button
            type="button"
            onClick={closeProfile}
            aria-label="Fermer"
            className="p-2.5 -m-1 rounded-lg text-muted hover:text-ink hover:bg-edge/60 transition-colors"
          >
            <X size={18} weight="bold" />
          </button>
        </div>
        <div className="px-4 sm:px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {view.kind === "me" ? (
            <ProfileContent tab={view.tab} onTabChange={setProfileTab} loginRedirect={pathname} />
          ) : (
            <PublicProfileView
              key={view.userId}
              userId={view.userId}
              onOpenOwnProfile={() => openProfile(view.back ?? ProfileTab.History)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
