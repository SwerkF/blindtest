import { useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowLeft,
  Check,
  ClockCounterClockwise,
  Copy,
  Crown,
  DiscordLogo,
  SignOut,
  Trophy,
  Users,
} from "@phosphor-icons/react"
import { ACHIEVEMENTS, GameMode, type GameHistoryItem } from "@blindmusic/shared"
import { useAuth } from "@/hooks/useAuth"
import DiscordAvatarToggle from "@/components/DiscordAvatarToggle"
import { useProfile } from "@/hooks/useProfile"
import { AccountQueryKey, accountApi, discordLoginUrl } from "@/utils/accountApi"
import Avatar from "@/components/Avatar"
import SettingsMenu from "@/components/SettingsMenu"
import FriendsPanel from "@/components/FriendsPanel"
import LegalFooter from "@/components/LegalFooter"
import Modal from "@/components/Modal"
import { ProfileTab, readProfileTab } from "@/utils/profileDrawer"

const TABS = [
  { id: ProfileTab.History, label: "Historique", icon: ClockCounterClockwise },
  { id: ProfileTab.Achievements, label: "Succès", icon: Trophy },
  { id: ProfileTab.Friends, label: "Amis", icon: Users },
]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}

/** Standalone /profil page (home page link, Discord login return). */
export default function Profile() {
  const [params, setParams] = useSearchParams()
  return (
    <div className="min-h-screen bg-canvas px-4 py-6 sm:py-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted hover:text-accent transition-colors"
          >
            <ArrowLeft size={16} weight="bold" />
            Accueil
          </Link>
          <SettingsMenu />
        </div>
        <ProfileContent
          tab={readProfileTab(params.get("onglet"))}
          onTabChange={(tab) => setParams({ onglet: tab }, { replace: true })}
          loginRedirect="/profil"
        />
        <LegalFooter className="mt-8" />
      </div>
    </div>
  )
}

interface ProfileContentProps {
  tab: ProfileTab
  onTabChange: (tab: ProfileTab) => void
  /** Where the Discord login sends the player back to. */
  loginRedirect: string
}

/** Profile card, Historique / Succès / Amis tabs and account deletion: shared by the page and the drawer. */
export function ProfileContent({ tab, onTabChange, loginRedirect }: ProfileContentProps) {
  const { user, discordEnabled, loading, logout, deleteAccount } = useAuth()
  const { profile } = useProfile()
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState("")

  async function handleDelete() {
    setDeleteError("")
    try {
      await deleteAccount()
      setConfirmDelete(false)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Erreur")
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <>
      {loading ? (
        <p className="text-muted text-sm">Chargement…</p>
      ) : !user ? (
        <div className="bg-surface border border-edge rounded-3xl p-8 text-center flex flex-col items-center gap-4">
          <Avatar name={profile.avatarSeed} size={96} animate="always" />
          <h1 className="text-2xl font-black text-ink">Mon profil</h1>
          <p className="text-sm text-muted max-w-sm">
            Connecte-toi avec Discord pour garder ton historique de parties, débloquer des succès et jouer avec tes
            amis. Tu peux aussi continuer à jouer sans compte.
          </p>
          {discordEnabled ? (
            <a
              href={discordLoginUrl(loginRedirect)}
              className="inline-flex items-center gap-2 bg-[#5865F2] text-white text-sm font-semibold px-5 py-3 rounded-xl hover:opacity-90 transition-opacity"
            >
              <DiscordLogo size={18} weight="fill" />
              Se connecter avec Discord
            </a>
          ) : (
            <p className="text-xs text-muted">La connexion n'est pas disponible sur ce serveur.</p>
          )}
        </div>
      ) : (
        <>
          <div className="bg-surface border border-edge rounded-3xl p-5 sm:p-6 flex flex-col sm:flex-row items-center gap-5">
            <Avatar
              name={user.avatarSeed || profile.avatarSeed}
              size={96}
              animate="always"
              imageUrl={user.useDiscordAvatar ? user.discordAvatarUrl : null}
            />
            <div className="flex-1 min-w-0 text-center sm:text-left">
              <h1 className="text-2xl font-black text-ink truncate">{user.pseudo}</h1>
              <p className="text-sm text-muted flex items-center justify-center sm:justify-start gap-1.5 mt-0.5">
                <img src={user.discordAvatarUrl} alt="" className="w-4 h-4 rounded-full" />@{user.username}
              </p>
              <button
                type="button"
                onClick={() => void copyCode(user.friendCode)}
                title="Copier mon code ami"
                className="mt-3 inline-flex items-center gap-2 text-xs text-muted bg-canvas border border-edge rounded-lg px-2.5 py-1.5 hover:border-accent transition-colors"
              >
                Code ami <span className="font-mono font-bold text-ink tracking-widest">{user.friendCode}</span>
                {copied ? <Check size={12} weight="bold" className="text-green-600" /> : <Copy size={12} />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex items-center gap-2 text-sm text-muted hover:text-red-500 px-3 py-2 rounded-xl transition-colors"
            >
              <SignOut size={16} weight="bold" />
              Se déconnecter
            </button>
          </div>

          <DiscordAvatarToggle className="mt-4" />

          <div role="tablist" className="mt-6 flex gap-1 bg-surface border border-edge rounded-2xl p-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => onTabChange(id)}
                className={`flex-1 inline-flex items-center justify-center gap-2 text-sm font-semibold px-3 py-2 rounded-xl transition-colors ${
                  tab === id ? "bg-accent text-white" : "text-muted hover:text-ink"
                }`}
              >
                <Icon size={16} weight="bold" />
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 bg-surface border border-edge rounded-3xl p-4 sm:p-6">
            {tab === ProfileTab.History && <HistoryTab />}
            {tab === ProfileTab.Achievements && <AchievementsTab />}
            {tab === ProfileTab.Friends && <FriendsPanel />}
          </div>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-muted hover:text-red-500 transition-colors"
            >
              Supprimer mon compte
            </button>
          </div>
        </>
      )}

      {confirmDelete && (
        <Modal
          title="Supprimer mon compte ?"
          onClose={() => setConfirmDelete(false)}
          actions={
            <>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-sm text-muted hover:text-ink px-4 py-2 rounded-xl transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="text-sm font-semibold text-white bg-red-500 px-4 py-2 rounded-xl hover:opacity-90 transition-opacity"
              >
                Supprimer
              </button>
            </>
          }
        >
          <p>
            Ton historique, tes succès et tes amis seront effacés définitivement. Tu pourras toujours jouer sans compte,
            avec ton pseudo.
          </p>
          {deleteError && <p className="mt-3 text-red-500">{deleteError}</p>}
        </Modal>
      )}
    </>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-canvas/60 border border-edge rounded-xl px-3 py-2 text-center">
      <p className="text-xl font-black text-ink">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  )
}

function HistoryTab() {
  const { data, isLoading, isError } = useQuery({ queryKey: [AccountQueryKey.History], queryFn: accountApi.history })
  if (isLoading) return <p className="text-sm text-muted">Chargement…</p>
  if (isError || !data) return <p className="text-sm text-red-500">Impossible de charger l'historique</p>
  const ratio = data.gamesPlayed ? Math.round((data.wins / data.gamesPlayed) * 100) : 0
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Parties" value={data.gamesPlayed} />
        <Stat label="Victoires" value={data.wins} />
        <Stat label="Taux" value={`${ratio} %`} />
      </div>
      {data.items.length === 0 ? (
        <p className="text-sm text-muted">Aucune partie enregistrée pour l'instant : lance-toi !</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.items.map((item) => (
            <HistoryRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  )
}

function HistoryRow({ item }: { item: GameHistoryItem }) {
  return (
    <li className="flex items-center gap-3 bg-canvas/60 border border-edge rounded-xl px-3 py-2.5">
      <span
        className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center font-black text-sm ${
          item.won ? "bg-amber-400/20 text-amber-500" : "bg-edge text-ink"
        }`}
      >
        {item.won ? <Crown size={18} weight="fill" /> : `#${item.rank}`}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink">
          {item.score} pts · {item.rank}/{item.playerCount}
          {item.team && (
            <span className="ml-2 text-xs font-medium text-muted">
              Équipe {item.team}
              {item.teamWon ? " · gagnée" : item.teamWon === false ? " · perdue" : ""}
            </span>
          )}
        </p>
        <p className="text-xs text-muted truncate">
          {formatDate(item.playedAt)} · {item.mode === GameMode.Anime ? "Animé" : "Classique"} · {item.roundCount} titre
          {item.roundCount > 1 ? "s" : ""}
        </p>
      </div>
    </li>
  )
}

function AchievementsTab() {
  const { data, isLoading, isError } = useQuery({
    queryKey: [AccountQueryKey.Achievements],
    queryFn: accountApi.achievements,
  })
  if (isLoading) return <p className="text-sm text-muted">Chargement…</p>
  if (isError || !data) return <p className="text-sm text-red-500">Impossible de charger les succès</p>
  const unlocked = new Map(data.map((a) => [a.id, a.unlockedAt]))
  return (
    <div>
      <p className="text-sm text-muted mb-3">
        {unlocked.size} / {ACHIEVEMENTS.length} débloqués
      </p>
      <ul className="grid sm:grid-cols-2 gap-2">
        {ACHIEVEMENTS.map((def) => {
          const at = unlocked.get(def.id)
          return (
            <li
              key={def.id}
              className={`flex items-center gap-3 border rounded-xl px-3 py-2.5 ${
                at ? "border-accent/40 bg-accent/5" : "border-edge bg-canvas/40 opacity-60"
              }`}
            >
              <span className={`text-2xl shrink-0 ${at ? "" : "grayscale"}`}>{def.icon}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{def.name}</p>
                <p className="text-xs text-muted">{def.description}</p>
                {at && <p className="text-[11px] text-accent mt-0.5">Débloqué le {formatDate(at)}</p>}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
