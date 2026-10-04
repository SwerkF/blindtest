import { useState } from "react"
import { useLocation } from "react-router-dom"
import { useMutation } from "@tanstack/react-query"
import { FEEDBACK_MESSAGE_MAX_LENGTH, FeedbackType } from "@blindmusic/shared"
import DiscordIcon from "@/components/DiscordIcon"
import Modal from "@/components/Modal"
import { useAuth } from "@/hooks/useAuth"
import { accountApi, discordLoginUrl } from "@/utils/accountApi"
import { closeFeedback, useFeedbackOpen } from "@/utils/feedbackDialog"
import { showToast } from "@/utils/toast"

const TYPE_LABEL: Record<FeedbackType, string> = {
  [FeedbackType.Bug]: "Bug",
  [FeedbackType.Idee]: "Idée",
  [FeedbackType.Autre]: "Autre",
}

const TYPE_PLACEHOLDER: Record<FeedbackType, string> = {
  [FeedbackType.Bug]: "Que s'est-il passé ? Où, et comment le reproduire ?",
  [FeedbackType.Idee]: "Qu'aimerais-tu voir dans le jeu ?",
  [FeedbackType.Autre]: "Dis-nous tout",
}

/** Modale « Donner un retour » : crée une issue côté serveur; la saisie est gardée en cas d'erreur. */
export default function FeedbackDialog() {
  const open = useFeedbackOpen()
  if (!open) return null
  return <FeedbackForm />
}

function FeedbackForm() {
  const { user, discordEnabled } = useAuth()
  const { pathname } = useLocation()
  const [type, setType] = useState<FeedbackType>(FeedbackType.Bug)
  const [message, setMessage] = useState("")

  const send = useMutation({
    mutationFn: () => accountApi.sendFeedback({ type, message: message.trim(), page: pathname }),
    onSuccess: () => {
      showToast({ title: "Merci pour ton retour !", icon: "💌" })
      closeFeedback()
    },
  })

  if (!user) {
    return (
      <Modal title="Donner un retour" onClose={closeFeedback}>
        <p className="text-muted mb-4">Connecte-toi avec Discord pour envoyer un retour.</p>
        {discordEnabled && (
          <a
            href={discordLoginUrl()}
            className="flex items-center justify-center gap-2 w-full bg-[#5865F2] text-white font-semibold px-4 py-3 rounded-xl hover:opacity-90 transition-opacity"
          >
            <DiscordIcon size={20} />
            Se connecter avec Discord
          </a>
        )}
      </Modal>
    )
  }

  const canSend = message.trim().length > 0 && !send.isPending

  return (
    <Modal
      title="Donner un retour"
      size="md"
      onClose={closeFeedback}
      actions={
        <>
          <button
            type="button"
            onClick={closeFeedback}
            className="text-sm font-semibold text-muted hover:text-ink px-4 py-2 rounded-xl hover:bg-edge/50 transition-colors"
          >
            Annuler
          </button>
          <button
            type="submit"
            form="feedback-form"
            disabled={!canSend}
            className="text-sm font-semibold bg-accent text-white px-4 py-2 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {send.isPending ? "Envoi…" : "Envoyer"}
          </button>
        </>
      }
    >
      <form
        id="feedback-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (canSend) send.mutate()
        }}
      >
        <div role="radiogroup" aria-label="Type de retour" className="grid grid-cols-3 gap-2 mb-3">
          {Object.values(FeedbackType).map((value) => {
            const active = value === type
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setType(value)}
                className={`min-h-11 rounded-xl border text-sm font-semibold transition-colors ${
                  active ? "border-accent bg-accent/10 text-accent" : "border-edge text-muted hover:border-muted hover:text-ink"
                }`}
              >
                {TYPE_LABEL[value]}
              </button>
            )
          })}
        </div>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
          rows={6}
          placeholder={TYPE_PLACEHOLDER[type]}
          aria-label="Ton message"
          className="w-full resize-y rounded-xl border border-edge bg-canvas px-3 py-2 text-base sm:text-sm text-ink placeholder:text-muted/70 focus:outline-none focus:border-accent"
        />
        <p className="mt-1 text-right text-xs text-muted tabular-nums">
          {message.length}/{FEEDBACK_MESSAGE_MAX_LENGTH}
        </p>
        {send.error && (
          <p role="alert" className="mt-2 text-red-500">
            {send.error.message}
          </p>
        )}
      </form>
    </Modal>
  )
}
