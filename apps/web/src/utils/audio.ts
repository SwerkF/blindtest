/** Short feedback cues, mapped to the files in /public/sounds. */
export enum Cue {
  /** One criterion landed (artist or title alone). */
  Match = "exclamation",
  /** Artist and title both found by us. */
  Complete = "tada",
  /** Pre-game countdown. */
  Countdown = "information-bar",
  /** Nothing matched. */
  Miss = "chord",
  /** A rival completed the pair first. */
  Rival = "battery-critical",
}

const VOLUME_KEY = "blindtest:volume"
const MUTED_KEY = "blindtest:muted"
export const DEFAULT_VOLUME = 0.25
/** Cues are mixed a little above the music so they stay audible over it. */
const CUE_GAIN = 1.6

type Listener = () => void

const listeners = new Set<Listener>()

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v))
}

export function getVolume(): number {
  const raw = Number.parseFloat(localStorage.getItem(VOLUME_KEY) ?? "")
  return Number.isFinite(raw) ? clamp(raw) : DEFAULT_VOLUME
}

export function isMuted(): boolean {
  return localStorage.getItem(MUTED_KEY) === "1"
}

export function setVolume(v: number) {
  localStorage.setItem(VOLUME_KEY, String(clamp(v)))
  listeners.forEach((l) => l())
}

export function setMuted(m: boolean) {
  localStorage.setItem(MUTED_KEY, m ? "1" : "0")
  listeners.forEach((l) => l())
}

export function onVolumeChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const cache = new Map<Cue, HTMLAudioElement>()

export function playCue(cue: Cue) {
  if (isMuted()) return
  let el = cache.get(cue)
  if (!el) {
    el = new Audio(`/sounds/${cue}.mp3`)
    cache.set(cue, el)
  }
  el.volume = clamp(getVolume() * CUE_GAIN)
  el.currentTime = 0
  // Autoplay may still be blocked before the first interaction
  el.play().catch(() => {})
}
