import { ChatCircleText } from "@phosphor-icons/react"
import { useAuth } from "@/hooks/useAuth"
import { useFeedbackEnabled } from "@/hooks/useFeedbackStatus"
import { openFeedback } from "@/utils/feedbackDialog"

/** « Donner un retour » du menu des paramètres; caché si le serveur n'a pas de tracker configuré. */
export default function FeedbackMenuButton({ onNavigate }: { onNavigate?: () => void }) {
  const enabled = useFeedbackEnabled()
  const { user, discordEnabled } = useAuth()
  // Sans compte et sans connexion Discord possible, personne ne pourrait envoyer
  if (!enabled || (!user && !discordEnabled)) return null

  return (
    <div className="mt-4 pt-3 border-t border-edge">
      <button
        type="button"
        onClick={() => {
          onNavigate?.()
          openFeedback()
        }}
        className="flex items-center gap-2 w-full text-sm text-muted hover:text-ink px-2 py-1.5 rounded-lg hover:bg-edge/50 transition-colors text-left"
      >
        <ChatCircleText size={16} />
        Donner un retour
      </button>
    </div>
  )
}
