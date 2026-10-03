import { useState } from "react"
import { Link } from "react-router-dom"
import { Check, PaperPlaneTilt, UsersThree } from "@phosphor-icons/react"
import { useAuth } from "@/hooks/useAuth"
import { useFriends } from "@/hooks/useFriends"
import { accountApi } from "@/utils/accountApi"
import Modal from "@/components/Modal"
import UserChip from "@/components/UserChip"

/** Lobby button for logged-in players: pings online friends with the invite code. */
export default function InviteFriendsButton({ code }: { code: string }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  if (!user) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 text-sm font-semibold border border-edge bg-surface text-ink px-3 py-2 rounded-xl hover:border-accent hover:text-accent transition-colors"
      >
        <UsersThree size={16} weight="bold" />
        Mes amis
      </button>
      {open && <InviteFriendsModal code={code} onClose={() => setOpen(false)} />}
    </>
  )
}

function InviteFriendsModal({ code, onClose }: { code: string; onClose: () => void }) {
  const { data, loading } = useFriends(true)
  const [sent, setSent] = useState<Set<string>>(new Set())
  const [error, setError] = useState("")

  async function invite(userId: string) {
    setError("")
    try {
      await accountApi.invite(userId, code)
      setSent((prev) => new Set(prev).add(userId))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Erreur")
    }
  }

  return (
    <Modal title="Inviter un ami" size="md" onClose={onClose}>
      {loading ? (
        <p className="text-muted">Chargement…</p>
      ) : data.friends.length === 0 ? (
        <p className="text-muted">
          Tu n'as pas encore d'amis.{" "}
          <Link to="/profil?onglet=amis" className="text-accent hover:underline">
            Ajoute-en depuis ton profil
          </Link>
          .
        </p>
      ) : (
        <ul className="flex flex-col gap-2 max-h-[55vh] overflow-y-auto -mr-2 pr-2">
          {data.friends.map((friend) => {
            const done = sent.has(friend.user.id)
            return (
              <li key={friend.friendshipId}>
                <UserChip user={friend.user} online={friend.online}>
                  <button
                    type="button"
                    disabled={!friend.online || done}
                    onClick={() => void invite(friend.user.id)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold bg-accent text-white px-3 py-1.5 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
                  >
                    {done ? <Check size={14} weight="bold" /> : <PaperPlaneTilt size={14} weight="bold" />}
                    {done ? "Invité" : "Inviter"}
                  </button>
                </UserChip>
              </li>
            )
          })}
        </ul>
      )}
      {error && <p className="mt-3 text-red-500">{error}</p>}
    </Modal>
  )
}
