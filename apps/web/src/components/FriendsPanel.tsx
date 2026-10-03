import { useState, type FormEvent } from "react"
import { Check, MagnifyingGlass, UserMinus, UserPlus, X } from "@phosphor-icons/react"
import { FriendRequestOutcome, type PublicUser } from "@blindmusic/shared"
import { useFriends } from "@/hooks/useFriends"
import { accountApi } from "@/utils/accountApi"
import UserChip from "@/components/UserChip"

const iconButton = "p-2 rounded-lg transition-colors disabled:opacity-50"

/** Profile tab: find people, answer requests and manage the friend list. */
export default function FriendsPanel() {
  const { data, loading, run } = useFriends(true)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<PublicUser[] | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  const knownIds = new Set([
    ...data.friends.map((f) => f.user.id),
    ...data.incoming.map((r) => r.user.id),
    ...data.outgoing.map((r) => r.user.id),
  ])

  async function search(event: FormEvent) {
    event.preventDefault()
    const q = query.trim()
    if (q.length < 2) return
    setBusy(true)
    setMessage(null)
    try {
      const found = await accountApi.searchUsers(q)
      setResults(found)
      if (found.length === 0) setMessage({ text: "Aucun joueur trouvé", error: true })
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Erreur", error: true })
    } finally {
      setBusy(false)
    }
  }

  async function add(user: PublicUser) {
    const outcomes: FriendRequestOutcome[] = []
    const error = await run(async () => {
      outcomes.push((await accountApi.sendRequest({ userId: user.id })).outcome)
    })
    if (error) return setMessage({ text: error, error: true })
    setMessage({
      text:
        outcomes[0] === FriendRequestOutcome.Accepted
          ? `${user.pseudo} est maintenant ton ami`
          : `Demande envoyée à ${user.pseudo}`,
      error: false,
    })
  }

  async function act(action: () => Promise<unknown>) {
    const error = await run(action)
    if (error) setMessage({ text: error, error: true })
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <form onSubmit={(e) => void search(e)} className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pseudo, nom Discord ou code ami"
            aria-label="Rechercher un joueur"
            maxLength={40}
            className="flex-1 min-w-0 border-2 border-edge bg-surface rounded-xl px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent transition-colors"
          />
          <button
            type="submit"
            disabled={busy || query.trim().length < 2}
            className="inline-flex items-center gap-1.5 bg-accent text-white text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <MagnifyingGlass size={16} weight="bold" />
            <span className="hidden sm:inline">Chercher</span>
          </button>
        </form>
        {message && (
          <p className={`mt-2 text-sm ${message.error ? "text-red-500" : "text-green-600"}`}>{message.text}</p>
        )}
        {results && results.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {results.map((user) => (
              <li key={user.id}>
                <UserChip user={user}>
                  {knownIds.has(user.id) ? (
                    <span className="text-xs text-muted">Déjà ajouté</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void add(user)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold bg-accent text-white px-3 py-1.5 rounded-lg hover:opacity-90 transition-opacity"
                    >
                      <UserPlus size={14} weight="bold" />
                      Ajouter
                    </button>
                  )}
                </UserChip>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.incoming.length > 0 && (
        <section>
          <h3 className="text-xs text-muted font-medium uppercase tracking-wider mb-2">
            Demandes reçues ({data.incoming.length})
          </h3>
          <ul className="flex flex-col gap-2">
            {data.incoming.map((request) => (
              <li key={request.friendshipId}>
                <UserChip user={request.user}>
                  <button
                    type="button"
                    onClick={() => void act(() => accountApi.accept(request.friendshipId))}
                    aria-label="Accepter"
                    title="Accepter"
                    className={`${iconButton} bg-green-500/10 text-green-600 hover:bg-green-500/20`}
                  >
                    <Check size={16} weight="bold" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void act(() => accountApi.decline(request.friendshipId))}
                    aria-label="Refuser"
                    title="Refuser"
                    className={`${iconButton} text-muted hover:text-red-500 hover:bg-edge/60`}
                  >
                    <X size={16} weight="bold" />
                  </button>
                </UserChip>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="text-xs text-muted font-medium uppercase tracking-wider mb-2">
          Amis ({data.friends.length})
        </h3>
        {loading ? (
          <p className="text-sm text-muted">Chargement…</p>
        ) : data.friends.length === 0 ? (
          <p className="text-sm text-muted">
            Pas encore d'amis : cherche-les par pseudo ou partage ton code ami.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.friends.map((friend) => (
              <li key={friend.friendshipId}>
                <UserChip user={friend.user} online={friend.online}>
                  {confirmRemove === friend.friendshipId ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmRemove(null)
                          void act(() => accountApi.remove(friend.friendshipId))
                        }}
                        className="text-xs font-semibold text-white bg-red-500 px-3 py-1.5 rounded-lg hover:opacity-90"
                      >
                        Retirer
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(null)}
                        className="text-xs text-muted hover:text-ink px-2 py-1.5"
                      >
                        Annuler
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(friend.friendshipId)}
                      aria-label="Retirer des amis"
                      title="Retirer des amis"
                      className={`${iconButton} text-muted hover:text-red-500 hover:bg-edge/60`}
                    >
                      <UserMinus size={16} />
                    </button>
                  )}
                </UserChip>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.outgoing.length > 0 && (
        <section>
          <h3 className="text-xs text-muted font-medium uppercase tracking-wider mb-2">Demandes envoyées</h3>
          <ul className="flex flex-col gap-2">
            {data.outgoing.map((request) => (
              <li key={request.friendshipId}>
                <UserChip user={request.user} subtitle="En attente">
                  <button
                    type="button"
                    onClick={() => void act(() => accountApi.decline(request.friendshipId))}
                    className="text-xs text-muted hover:text-red-500 px-2 py-1.5 transition-colors"
                  >
                    Annuler
                  </button>
                </UserChip>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
