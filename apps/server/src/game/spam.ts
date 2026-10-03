import { SpamKind, SpamReason } from "@blindmusic/shared"

/** At most this many messages (or reactions) in the sliding window... */
export const SPAM_MAX_EVENTS = 5
export const SPAM_WINDOW_MS = 5000
/** ...one more and that channel is muted this long. */
export const SPAM_MUTE_MS = 5000
/** Back-to-back reactions closer than this are dropped silently. */
export const REACTION_COOLDOWN_MS = 400
/** The same chat message again within this delay is dropped. */
export const DUPLICATE_WINDOW_MS = 10_000
/** The spammer is told at most this often, so notices cannot be spammed back. */
export const NOTICE_INTERVAL_MS = 2000

interface Channel {
  /** Accepted events still inside the window, oldest first. */
  events: number[]
  mutedUntil: number
  lastText: string
  lastTextAt: number
}

export interface SpamState {
  chat: Channel
  reaction: Channel
  lastNoticeAt: number
}

export type SpamCheck =
  | { ok: true }
  /** `notify` is false when the sender was told recently (or for the silent reaction cooldown). */
  | { ok: false; reason: SpamReason; retryInMs: number; notify: boolean }

function channel(): Channel {
  return { events: [], mutedUntil: 0, lastText: "", lastTextAt: 0 }
}

export function newSpamState(): SpamState {
  return { chat: channel(), reaction: channel(), lastNoticeAt: -Infinity }
}

function comparable(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ")
}

/**
 * Decides whether a chat message or a reaction goes through, and records it
 * when it does. Blocked attempts do not count, so a mute always ends.
 */
export function checkSpam(state: SpamState, kind: SpamKind, now: number, text?: string): SpamCheck {
  const ch = kind === SpamKind.Chat ? state.chat : state.reaction
  const block = (reason: SpamReason, retryInMs: number, silent = false): SpamCheck => {
    const notify = !silent && now - state.lastNoticeAt >= NOTICE_INTERVAL_MS
    if (notify) state.lastNoticeAt = now
    return { ok: false, reason, retryInMs: Math.max(0, retryInMs), notify }
  }

  if (now < ch.mutedUntil) return block(SpamReason.Rate, ch.mutedUntil - now)

  while (ch.events.length && now - ch.events[0] >= SPAM_WINDOW_MS) ch.events.shift()
  const last = ch.events[ch.events.length - 1]

  if (kind === SpamKind.Reaction && last !== undefined && now - last < REACTION_COOLDOWN_MS) {
    return block(SpamReason.Rate, REACTION_COOLDOWN_MS - (now - last), true)
  }
  if (kind === SpamKind.Chat && text !== undefined) {
    const same = comparable(text) === ch.lastText && now - ch.lastTextAt < DUPLICATE_WINDOW_MS
    if (same) return block(SpamReason.Duplicate, DUPLICATE_WINDOW_MS - (now - ch.lastTextAt))
  }
  if (ch.events.length >= SPAM_MAX_EVENTS) {
    ch.mutedUntil = now + SPAM_MUTE_MS
    ch.events = []
    return block(SpamReason.Rate, SPAM_MUTE_MS)
  }

  ch.events.push(now)
  if (kind === SpamKind.Chat && text !== undefined) {
    ch.lastText = comparable(text)
    ch.lastTextAt = now
  }
  return { ok: true }
}
