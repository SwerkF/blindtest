import { useEffect } from "react"
import { Outlet, useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { achievementDef, type FriendsResponse, type UserWsServerMessage } from "@blindmusic/shared"
import { useAuth } from "@/hooks/useAuth"
import { useUserSocket } from "@/hooks/useUserSocket"
import { AccountQueryKey } from "@/utils/accountApi"
import { linkAccount } from "@/utils/accountSync"
import { showToast } from "@/utils/toast"
import Toaster from "@/components/Toaster"
import type { HomeNavState } from "@/pages/Home"
import ProfileDrawer from "@/components/ProfileDrawer"
import { ProfileTab, openProfile } from "@/utils/profileDrawer"
import { PACK_STYLE } from "@/utils/rarity"

const INVITE_TOAST_MS = 20_000
const AUTH_ERROR_PARAM = "authError"
const ROOM_PATH = /^\/(?:lobby|game)\/([^/]+)/

/**
 * Layout around every page: syncs the local profile with the Discord account,
 * keeps the per-user socket open and shows its notifications as toasts.
 */
export default function AccountRoot() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()

  useEffect(() => {
    linkAccount(user)
  }, [user])

  // The login callback lands back here with ?authError=... when Discord refused or failed
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const reason = params.get(AUTH_ERROR_PARAM)
    if (!reason) return
    showToast({
      title: "Connexion Discord impossible",
      text: reason === "denied" ? "Autorisation refusée sur Discord" : "Réessaie dans un instant",
      icon: "⚠️",
    })
    params.delete(AUTH_ERROR_PARAM)
    const search = params.toString()
    navigate(`${location.pathname}${search ? `?${search}` : ""}`, { replace: true })
  }, [navigate])

  function acceptInvite(code: string) {
    // Read at click time: the toast may outlive the page it was shown on
    const match = ROOM_PATH.exec(location.pathname)
    const current = match?.[1]?.toUpperCase()
    if (current === code.toUpperCase()) return
    const state: HomeNavState | undefined = current
      ? { fromRoom: { code: current, path: location.pathname } }
      : undefined
    navigate(`/join/${code}`, { state })
  }

  const refreshFriends = () => void queryClient.invalidateQueries({ queryKey: [AccountQueryKey.Friends] })

  function handle(msg: UserWsServerMessage) {
    switch (msg.type) {
      case "friend:presence":
        queryClient.setQueryData<FriendsResponse>([AccountQueryKey.Friends], (prev) =>
          prev
            ? {
                ...prev,
                friends: prev.friends.map((f) => (f.user.id === msg.userId ? { ...f, online: msg.online } : f)),
              }
            : prev
        )
        break
      case "friend:request":
        refreshFriends()
        showToast({
          title: "Nouvelle demande d'ami",
          text: `${msg.from.pseudo} veut t'ajouter en ami`,
          imageUrl: msg.from.discordAvatarUrl,
          action: { label: "Voir", onClick: () => openProfile(ProfileTab.Friends) },
        })
        break
      case "friend:accepted":
        refreshFriends()
        showToast({
          title: "Demande acceptée",
          text: `${msg.from.pseudo} est maintenant ton ami`,
          imageUrl: msg.from.discordAvatarUrl,
        })
        break
      case "friend:changed":
        refreshFriends()
        break
      case "lobby:invite":
        showToast({
          title: `${msg.from.pseudo} t'invite à jouer`,
          text: `Salon ${msg.code}`,
          imageUrl: msg.from.discordAvatarUrl,
          durationMs: INVITE_TOAST_MS,
          action: { label: "Rejoindre", onClick: () => acceptInvite(msg.code) },
        })
        break
      case "achievement:unlocked":
        void queryClient.invalidateQueries({ queryKey: [AccountQueryKey.Achievements] })
        void queryClient.invalidateQueries({ queryKey: [AccountQueryKey.History] })
        for (const id of msg.ids) {
          const def = achievementDef(id)
          if (def) showToast({ title: `Succès débloqué : ${def.name}`, text: def.description, icon: def.icon })
        }
        break
      case "booster:earned":
        void queryClient.invalidateQueries({ queryKey: [AccountQueryKey.Boosters] })
        showToast({
          title: "Booster gagné !",
          text: `Un pack ${PACK_STYLE[msg.rarity].label.toLowerCase()} t'attend dans ta collection`,
          icon: "💿",
          action: { label: "Ouvrir", onClick: () => openProfile(ProfileTab.Collection) },
        })
        break
    }
  }

  useUserSocket(user?.id ?? null, handle, () => {
    void queryClient.invalidateQueries({ queryKey: [AccountQueryKey.Me] })
  })

  return (
    <>
      <Outlet />
      <ProfileDrawer />
      <Toaster />
    </>
  )
}
