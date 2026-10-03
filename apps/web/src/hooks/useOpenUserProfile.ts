import { useCallback } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { isRoomPath, openUserProfileDrawer, useProfileDrawer } from "@/utils/profileDrawer"

/**
 * Opens someone's public profile: in the drawer when the player is in a room (leaving
 * the page would leave the room) or already browsing the drawer, otherwise on /u/:id.
 */
export function useOpenUserProfile(): (userId: string) => void {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const drawer = useProfileDrawer()
  const inDrawer = drawer !== null || isRoomPath(pathname)
  return useCallback(
    (userId: string) => {
      if (inDrawer) openUserProfileDrawer(userId)
      else navigate(`/u/${encodeURIComponent(userId)}`)
    },
    [inDrawer, navigate]
  )
}
