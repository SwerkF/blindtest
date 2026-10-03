import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import satori from "satori"
import { Resvg, initWasm } from "@resvg/resvg-wasm"
import { blobatar } from "blobatar"
import * as expressions from "blobatar/expression"
import { SHAPE_TRAIT, TONE_VALUE, decodeAvatar } from "@blindmusic/shared"

/**
 * Share card of a public profile (/u/:id link previews), 1200×630 like
 * apps/web/public/og-image.png: dark background with the accent shape pattern of
 * `.bg-canvas`, Outfit, BLINDTEST branding.
 *
 * Satori lays the card out as SVG (pure JS + Yoga WASM) and resvg-wasm rasterises
 * it, so the Docker image needs no browser nor native module. The avatar is the
 * player's Blobatar, drawn server-side with the same `blobatar` package as the
 * web app; the Discord picture is used instead when the player opted in and it
 * can be fetched.
 */

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630

const BG = "#191410"
const ACCENT = "#c08a5e"
const INK = "#f5f2ee"
const MUTED = "#a8998a"
const TILE = "#231c17"
const EDGE = "#3a2f27"

export interface UserCardData {
  pseudo: string
  username: string
  avatarSeed: string
  /** Discord picture, only when the player chose it over the Blobatar. */
  avatarUrl: string | null
  gamesPlayed: number
  wins: number
  winRate: number
  achievements: number
}

/** Changes whenever something drawn on the card changes: cache key and ETag. */
export function cardHash(data: UserCardData): string {
  return createHash("sha1").update(JSON.stringify(data)).digest("base64url").slice(0, 16)
}

const ASSETS = join(import.meta.dir, "../../assets")

let ready: Promise<{ fonts: { name: string; data: Buffer; weight: 400 | 700 | 900; style: "normal" }[] }> | null =
  null

/** Fonts and the resvg WASM module, loaded once on the first card. */
function setup() {
  ready ??= (async () => {
    const wasm = readFileSync(Bun.resolveSync("@resvg/resvg-wasm/index_bg.wasm", import.meta.dir))
    await initWasm(wasm)
    const fonts = ([400, 700, 900] as const).flatMap((weight) =>
      ["latin", "latin-ext"].map((subset) => ({
        name: "Outfit",
        data: readFileSync(join(ASSETS, `outfit-${subset}-${weight}-normal.woff`)),
        weight,
        style: "normal" as const,
      }))
    )
    return { fonts }
  })()
  return ready
}

/** Same rendering as the web Avatar component (shape, hue, tone, expression from the encoded seed). */
export function blobSvg(avatarSeed: string, size: number): string {
  const config = decodeAvatar(avatarSeed || "joueur")
  const expression = (expressions as unknown as Record<string, expressions.Expression>)[config.expression]
  return blobatar(config.seed || "joueur", {
    size,
    traits: config.shape ? { shape: SHAPE_TRAIT[config.shape] } : undefined,
    hue: config.hue ?? undefined,
    tone: config.tone ? TONE_VALUE[config.tone] : undefined,
    expression,
  })
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
}

/** Discord picture as a data URI, or null when it cannot be fetched quickly. */
async function fetchPicture(url: string): Promise<string | null> {
  try {
    const res = await fetch(url.replace(/size=\d+/, "size=256"), { signal: AbortSignal.timeout(3000) })
    const type = res.headers.get("content-type") ?? ""
    if (!res.ok || !/^image\/(png|jpeg)/.test(type)) return null
    const bytes = Buffer.from(await res.arrayBuffer())
    return `data:${type};base64,${bytes.toString("base64")}`
  } catch {
    return null
  }
}

// The `.bg-canvas` tile from index.css, stroked in the accent colour
const PATTERN_TILE = `<g fill="none" stroke="${ACCENT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="14" cy="14" r="5"/><path d="M58 8v12M52 14h12"/><path d="M30 56l7-12 7 12z"/><path d="M70 50c3-4 6-4 9 0s6 4 9 0"/><rect x="8" y="72" width="9" height="9" rx="2" transform="rotate(20 12.5 76.5)"/><circle cx="62" cy="80" r="2" fill="${ACCENT}"/><path d="M40 20c0 4 2 6 6 6"/><path d="M84 84v-10l6-2v10"/><circle cx="82" cy="84" r="2.2" fill="${ACCENT}"/><circle cx="88" cy="82" r="2.2" fill="${ACCENT}"/></g>`

/** Background drawn under Satori's output: flat colour plus the repeating shapes. */
function backgroundSvg(): string {
  return (
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${BG}"/>` +
    `<defs><pattern id="bt-pattern" width="96" height="96" patternUnits="userSpaceOnUse">${PATTERN_TILE}</pattern></defs>` +
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#bt-pattern)" opacity="0.13"/>`
  )
}

type Style = Record<string, string | number>
interface Node {
  type: string
  props: { style?: Style; children?: (Node | string)[] | Node | string; src?: string; width?: number; height?: number }
}

function h(type: string, style: Style, ...children: (Node | string)[]): Node {
  // Satori wants display: flex on any element with several children
  const flex: Style = children.length > 1 && !style.display ? { display: "flex" } : {}
  return { type, props: { style: { ...flex, ...style }, children: children.length === 1 ? children[0] : children } }
}

function img(src: string, size: number, style: Style = {}): Node {
  return { type: "img", props: { src, width: size, height: size, style: { width: size, height: size, ...style } } }
}

const NOTE_ICON =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="${ACCENT}" ` +
  `stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="18" r="3"/><path d="M10 18V4l9 3v5l-9-3"/></svg>`

function stat(value: string, label: string): Node {
  return h(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      flex: 1,
      height: 132,
      background: TILE,
      border: `2px solid ${EDGE}`,
      borderRadius: 24,
    },
    h("div", { fontSize: 54, fontWeight: 900, color: INK, lineHeight: 1 }, value),
    h(
      "div",
      { fontSize: 22, fontWeight: 700, color: MUTED, marginTop: 10, letterSpacing: 3, textTransform: "uppercase" },
      label
    )
  )
}

function cardTree(data: UserCardData, avatarSrc: string, isPhoto: boolean): Node {
  const avatarSize = 200
  return h(
    "div",
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      display: "flex",
      flexDirection: "column",
      padding: "52px 64px 48px",
      fontFamily: "Outfit",
      color: INK,
    },
    // Header: branding and site
    h(
      "div",
      { display: "flex", alignItems: "center", justifyContent: "space-between" },
      h(
        "div",
        { display: "flex", alignItems: "center" },
        img(svgDataUri(NOTE_ICON), 40),
        h("div", { fontSize: 40, fontWeight: 900, letterSpacing: 2, marginLeft: 10, color: INK }, "BLINDTEST")
      ),
      h("div", { fontSize: 26, fontWeight: 700, color: ACCENT }, "blindtest.oliwr.win")
    ),
    // Identity
    h(
      "div",
      { display: "flex", alignItems: "center", flex: 1, marginTop: 8 },
      h(
        "div",
        {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 236,
          height: 236,
          background: TILE,
          border: `2px solid ${EDGE}`,
          borderRadius: 48,
          flexShrink: 0,
        },
        img(avatarSrc, isPhoto ? 188 : avatarSize, isPhoto ? { borderRadius: 94 } : {})
      ),
      h(
        "div",
        { display: "flex", flexDirection: "column", marginLeft: 44, minWidth: 0, flex: 1 },
        h(
          "div",
          { fontSize: 22, fontWeight: 700, color: ACCENT, letterSpacing: 5, textTransform: "uppercase" },
          "Profil joueur"
        ),
        h(
          "div",
          {
            fontSize: data.pseudo.length > 14 ? 64 : 84,
            fontWeight: 900,
            color: INK,
            lineHeight: 1.1,
            marginTop: 6,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          },
          data.pseudo
        ),
        h(
          "div",
          {
            fontSize: 30,
            fontWeight: 400,
            color: MUTED,
            marginTop: 6,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          },
          `@${data.username}`
        )
      )
    ),
    // Stats
    h(
      "div",
      { display: "flex", gap: 20 },
      stat(String(data.gamesPlayed), "Parties"),
      stat(String(data.wins), "Victoires"),
      stat(`${data.winRate}%`, "Winrate"),
      stat(String(data.achievements), "Succès")
    )
  )
}

/** `complete` is false when the Discord picture could not be fetched (do not cache that one). */
export async function renderUserCard(data: UserCardData): Promise<{ png: Uint8Array; complete: boolean }> {
  const { fonts } = await setup()
  const photo = data.avatarUrl ? await fetchPicture(data.avatarUrl) : null
  const avatarSrc = photo ?? svgDataUri(blobSvg(data.avatarSeed || data.pseudo, 200))
  const svg = await satori(cardTree(data, avatarSrc, photo !== null) as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts,
  })
  // Slide the patterned background under Satori's transparent root
  const composed = svg.replace(/(<svg[^>]*>)/, `$1${backgroundSvg()}`)
  const resvg = new Resvg(composed, { fitTo: { mode: "width", value: OG_WIDTH }, font: { loadSystemFonts: false } })
  return { png: resvg.render().asPng(), complete: !data.avatarUrl || photo !== null }
}

/** Rendered cards by user id; an entry is reused while its hash matches. */
const cache = new Map<string, { hash: string; png: Uint8Array }>()
const CACHE_LIMIT = 300

export function cachedCard(userId: string, hash: string): Uint8Array | null {
  const entry = cache.get(userId)
  if (!entry || entry.hash !== hash) return null
  // Refresh its place for the LRU eviction below
  cache.delete(userId)
  cache.set(userId, entry)
  return entry.png
}

export function storeCard(userId: string, hash: string, png: Uint8Array) {
  cache.delete(userId)
  cache.set(userId, { hash, png })
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
}
