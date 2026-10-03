import type { ProfileStats } from "@blindmusic/shared"

const decimal = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function formatSeconds(ms: number): string {
  return `${decimal.format(ms / 1000)} s`
}

interface StatProps {
  label: string
  value: string | number
  hint?: string
  /** Tooltip explaining how the stat is computed. */
  title?: string
}

function Stat({ label, value, hint, title }: StatProps) {
  return (
    <div className="bg-canvas/60 border border-edge rounded-xl px-3 py-2 text-center" title={title}>
      <p className="text-xl font-black text-ink">{value}</p>
      <p className="text-xs text-muted">{label}</p>
      {hint && <p className="text-[11px] text-muted/80 mt-0.5">{hint}</p>}
    </div>
  )
}

/** Games, wins and round stats ("guess moyen / perfect / ultimate"): own profile and public profiles. */
export default function ProfileStatsBlock({ stats }: { stats: ProfileStats }) {
  const hasRounds = stats.roundsTracked > 0
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Parties" value={stats.gamesPlayed} />
        <Stat label="Victoires" value={stats.wins} />
        <Stat label="Taux de victoire" value={`${stats.winRate} %`} />
        <Stat label="Meilleur score" value={stats.bestScore ?? "–"} />
      </div>
      {hasRounds ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat
            label="Guess moyen"
            value={`${decimal.format(stats.averageFound ?? 0)} / 3`}
            hint={stats.titleRate !== null ? `Titre trouvé ${stats.titleRate} %` : undefined}
            title="Nombre moyen de réponses trouvées par manche (artiste, titre, année)"
          />
          <Stat
            label="Guess perfect"
            value={stats.perfectRounds}
            hint="Artiste + titre"
            title="Manches où l'artiste et le titre ont été trouvés"
          />
          <Stat
            label="Guess ultimate"
            value={stats.ultimateRounds}
            hint="Artiste + titre + année"
            title="Manches où l'artiste, le titre et l'année ont été trouvés"
          />
          <Stat
            label="Temps moyen"
            value={stats.averageTitleMs !== null ? formatSeconds(stats.averageTitleMs) : "–"}
            hint="pour trouver le titre"
            title="Temps moyen entre le début de la manche et le titre trouvé"
          />
        </div>
      ) : (
        stats.gamesPlayed > 0 && (
          <p className="text-xs text-muted">
            Les stats par manche (guess moyen, perfect, ultimate) apparaîtront après la prochaine partie : les parties
            plus anciennes n'en gardent pas le détail.
          </p>
        )
      )}
      {hasRounds && (
        <p className="text-[11px] text-muted">
          Sur {stats.roundsTracked} manche{stats.roundsTracked > 1 ? "s" : ""} détaillée
          {stats.roundsTracked > 1 ? "s" : ""}.
        </p>
      )}
    </div>
  )
}
