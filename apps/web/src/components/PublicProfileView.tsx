import { useState, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Clock, UserCircle, UserPlus, X } from "@phosphor-icons/react"
import {
  ACHIEVEMENTS,
  FriendRequestOutcome,
  FriendshipState,
  achievementDef,
  isSecretAchievement,
  type PublicProfileResponse,
} from "@blindmusic/shared"
import Avatar from "@/components/Avatar"
import ProfileStatsBlock from "@/components/ProfileStats"
import CollectionGrid from "@/components/booster/CollectionGrid"
import { HistoryRow } from "@/pages/Profile"
import { AccountQueryKey, accountApi } from "@/utils/accountApi"
import { ApiError } from "@/utils/api"

function formatMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })
}

export function usePublicProfile(userId: string) {
  return useQuery({
    queryKey: [AccountQueryKey.PublicProfile, userId],
    queryFn: () => accountApi.publicProfile(userId),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  })
}

interface PublicProfileViewProps {
  userId: string
  /** Shown for one's own profile (link to the full profile with the private tabs). */
  onOpenOwnProfile?: () => void
}

/** Someone's public profile: card, friend button, stats, achievements and last games. */
export default function PublicProfileView({ userId, onOpenOwnProfile }: PublicProfileViewProps) {
  const { data, isLoading, error } = usePublicProfile(userId)
  if (isLoading) return <p className="text-sm text-muted">Chargement…</p>
  if (error instanceof ApiError && error.status === 404) {
    return (
      <div className="bg-surface border border-edge rounded-3xl p-8 text-center flex flex-col items-center gap-3">
        <UserCircle size={48} className="text-muted" />
        <p className="text-ink font-semibold">Joueur introuvable</p>
        <p className="text-sm text-muted">Ce compte n'existe pas ou a été supprimé.</p>
      </div>
    )
  }
  if (error || !data) return <p className="text-sm text-red-500">Impossible de charger ce profil</p>
  return <ProfileBody profile={data} onOpenOwnProfile={onOpenOwnProfile} />
}

function ProfileBody({
  profile,
  onOpenOwnProfile,
}: {
  profile: PublicProfileResponse
  onOpenOwnProfile?: () => void
}) {
  const { user, stats, achievements, recentGames } = profile
  // Secret achievements only count once unlocked, so the total never spoils them
  const unlockedIds = new Set(achievements.map((a) => a.id))
  const total = ACHIEVEMENTS.filter((def) => !isSecretAchievement(def) || unlockedIds.has(def.id)).length

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-surface border border-edge rounded-3xl p-5 sm:p-6 flex flex-col sm:flex-row items-center gap-5">
        <Avatar name={user.avatarSeed || user.pseudo} size={96} animate="always" imageUrl={user.avatarUrl} />
        <div className="flex-1 min-w-0 text-center sm:text-left">
          <h1 className="text-2xl font-black text-ink truncate">{user.pseudo}</h1>
          <p className="text-sm text-muted truncate">@{user.username}</p>
          <p className="text-xs text-muted mt-1">Membre depuis {formatMonth(user.createdAt)}</p>
        </div>
        <FriendButton profile={profile} onOpenOwnProfile={onOpenOwnProfile} />
      </div>

      <section className="bg-surface border border-edge rounded-3xl p-4 sm:p-6">
        <h2 className="text-xs text-muted font-medium uppercase tracking-wider mb-3">Statistiques</h2>
        <ProfileStatsBlock stats={stats} />
      </section>

      <section className="bg-surface border border-edge rounded-3xl p-4 sm:p-6">
        <h2 className="text-xs text-muted font-medium uppercase tracking-wider mb-3">
          Succès · {achievements.length} / {total}
        </h2>
        {achievements.length === 0 ? (
          <p className="text-sm text-muted">Aucun succès débloqué pour l'instant.</p>
        ) : (
          <ul className="grid sm:grid-cols-2 gap-2">
            {achievements.map((a) => {
              const def = achievementDef(a.id)
              if (!def) return null
              return (
                <li
                  key={a.id}
                  className="flex items-center gap-3 border border-accent/40 bg-accent/5 rounded-xl px-3 py-2.5"
                >
                  <span className="text-2xl shrink-0">{def.icon}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{def.name}</p>
                    <p className="text-xs text-muted">{def.description}</p>
                    <p className="text-[11px] text-accent mt-0.5">Débloqué le {formatDate(a.unlockedAt)}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="bg-surface border border-edge rounded-3xl p-4 sm:p-6">
        <h2 className="text-xs text-muted font-medium uppercase tracking-wider mb-3">Collection de vinyles</h2>
        <CollectionGrid userId={user.id} emptyText="Aucun vinyle dans cette collection pour l'instant." />
      </section>

      <section className="bg-surface border border-edge rounded-3xl p-4 sm:p-6">
        <h2 className="text-xs text-muted font-medium uppercase tracking-wider mb-3">Dernières parties</h2>
        {recentGames.length === 0 ? (
          <p className="text-sm text-muted">Aucune partie enregistrée.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recentGames.map((item) => (
              <HistoryRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

const primaryButton =
  "inline-flex items-center gap-2 text-sm font-semibold bg-accent text-white px-4 py-2 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
const secondaryButton =
  "inline-flex items-center gap-2 text-sm text-muted hover:text-ink px-3 py-2 rounded-xl border border-edge hover:border-muted transition-colors disabled:opacity-50"

function FriendButton({
  profile,
  onOpenOwnProfile,
}: {
  profile: PublicProfileResponse
  onOpenOwnProfile?: () => void
}) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const { friendship, friendshipId, user } = profile

  async function act(action: () => Promise<unknown>) {
    setBusy(true)
    setMessage(null)
    try {
      await action()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erreur")
    } finally {
      setBusy(false)
      void queryClient.invalidateQueries({ queryKey: [AccountQueryKey.PublicProfile, user.id] })
      void queryClient.invalidateQueries({ queryKey: [AccountQueryKey.Friends] })
    }
  }

  let content: ReactNode = null
  switch (friendship) {
    case FriendshipState.Guest:
      content = <p className="text-xs text-muted max-w-[12rem] text-center">Connecte-toi avec Discord pour l'ajouter en ami</p>
      break
    case FriendshipState.Self:
      content = onOpenOwnProfile ? (
        <button type="button" onClick={onOpenOwnProfile} className={secondaryButton}>
          <UserCircle size={16} weight="bold" />
          Mon profil
        </button>
      ) : (
        <span className="text-xs text-muted">C'est ton profil</span>
      )
      break
    case FriendshipState.None:
      content = (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const { outcome } = await accountApi.sendRequest({ userId: user.id })
              if (outcome === FriendRequestOutcome.Accepted) setMessage(`${user.pseudo} est maintenant ton ami`)
            })
          }
          className={primaryButton}
        >
          <UserPlus size={16} weight="bold" />
          Ajouter en ami
        </button>
      )
      break
    case FriendshipState.Outgoing:
      content = (
        <div className="flex flex-col items-center gap-1">
          <span className="inline-flex items-center gap-1.5 text-sm text-muted">
            <Clock size={16} weight="bold" />
            Demande envoyée
          </span>
          {friendshipId && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => accountApi.decline(friendshipId))}
              className="text-xs text-muted hover:text-red-500 transition-colors"
            >
              Annuler
            </button>
          )}
        </div>
      )
      break
    case FriendshipState.Incoming:
      content = friendshipId && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => accountApi.accept(friendshipId))}
            className={primaryButton}
          >
            <Check size={16} weight="bold" />
            Accepter
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => accountApi.decline(friendshipId))}
            aria-label="Refuser"
            title="Refuser"
            className={secondaryButton}
          >
            <X size={16} weight="bold" />
          </button>
        </div>
      )
      break
    case FriendshipState.Friends:
      content = (
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-600 bg-green-500/10 px-3 py-1.5 rounded-xl">
          <Check size={16} weight="bold" />
          Amis
        </span>
      )
      break
  }

  return (
    <div className="shrink-0 flex flex-col items-center gap-1">
      {content}
      {message && <p className="text-xs text-muted max-w-[12rem] text-center">{message}</p>}
    </div>
  )
}
