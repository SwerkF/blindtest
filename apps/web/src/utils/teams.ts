import { Team } from "@blindmusic/shared"

/** Tailwind classes per team, written out in full so the compiler keeps them. */
export const TEAM_STYLE: Record<
  Team,
  { text: string; bg: string; soft: string; border: string; dot: string; color: string }
> = {
  [Team.Blue]: {
    /** Raw colour for inline styles (blue-500). */
    color: "#3b82f6",
    text: "text-blue-500",
    bg: "bg-blue-500",
    soft: "bg-blue-500/10",
    border: "border-blue-500/40",
    dot: "bg-blue-500",
  },
  [Team.Red]: {
    /** Raw colour for inline styles (red-500). */
    color: "#ef4444",
    text: "text-red-500",
    bg: "bg-red-500",
    soft: "bg-red-500/10",
    border: "border-red-500/40",
    dot: "bg-red-500",
  },
}

/** "Victoire des Bleus" reads better than the bare colour name. */
export const TEAM_PLURAL: Record<Team, string> = {
  [Team.Blue]: "Bleus",
  [Team.Red]: "Rouges",
}

export enum TeamResult {
  Win = "win",
  Loss = "loss",
  Draw = "draw",
}

export const TEAM_RESULT_LABEL: Record<TeamResult, string> = {
  [TeamResult.Win]: "victoire",
  [TeamResult.Loss]: "défaite",
  [TeamResult.Draw]: "égalité",
}
