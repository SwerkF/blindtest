import { useState } from "react"
import { MusicNotes } from "@phosphor-icons/react"
import { CardRarity, coverUrl, type CardDto } from "@blindmusic/shared"
import { accountApi } from "@/utils/accountApi"
import { CARD_STYLE } from "@/utils/rarity"

const reported = new Set<string>()

/** Tells the server once per vinyl that its cover is gone from the Deezer CDN. */
function reportCover(entryId: string) {
  if (reported.has(entryId)) return
  reported.add(entryId)
  void accountApi.reportCover(entryId).catch(() => {})
}

/** Stable pseudo-random hue from the title, for the cover fallback. */
function hueOf(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) % 360
  return hash
}

interface VinylCardProps {
  card: CardDto
  /** First copy of the vinyl, just drawn. */
  isNew?: boolean
  /** Slides the record out of its sleeve when it appears (pack opening). */
  slideDisc?: boolean
  className?: string
}

/**
 * A vinyl: the sleeve shows the cover (loaded straight from the Deezer CDN, rebuilt
 * from its md5), the record peeks out on the right and takes the rarity colour.
 */
export default function VinylCard({ card, isNew = false, slideDisc = false, className = "" }: VinylCardProps) {
  const [failed, setFailed] = useState(false)
  const style = CARD_STYLE[card.rarity]
  const showCover = card.deezerMd5Image && !failed
  const hue = hueOf(card.title + card.artistName)

  return (
    <div className={`flex flex-col gap-1.5 min-w-0 ${className}`}>
      <div className="relative w-full aspect-square">
        <div
          aria-hidden
          className={`absolute right-0 top-1/2 -translate-y-1/2 w-[78%] aspect-square rounded-full ${
            slideDisc ? "animate-disc-slide" : ""
          }`}
          style={{
            background:
              "radial-gradient(circle, transparent 0 22%, rgba(255,255,255,0.07) 23% 24%, transparent 25% 38%, rgba(255,255,255,0.06) 39% 40%, transparent 41%), #17171a",
          }}
        >
          <span
            className="absolute inset-[34%] rounded-full"
            style={{ background: `linear-gradient(135deg, ${style.from}, ${style.to})` }}
          />
          <span className="absolute inset-[47%] rounded-full bg-black/80" />
        </div>
        <div
          className={`relative w-[84%] aspect-square rounded-lg overflow-hidden border-2 bg-edge ${
            card.rarity === CardRarity.Legendaire || card.rarity === CardRarity.Epique ? "vinyl-sheen" : ""
          }`}
          style={{ borderColor: style.color }}
        >
          {showCover ? (
            <img
              src={coverUrl(card.deezerMd5Image!, 250)}
              alt=""
              loading="lazy"
              draggable={false}
              className="w-full h-full object-cover"
              onError={() => {
                setFailed(true)
                reportCover(card.entryId)
              }}
            />
          ) : (
            <div
              className="w-full h-full flex flex-col items-center justify-center gap-1 text-white/90"
              style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${(hue + 50) % 360} 55% 28%))` }}
            >
              <MusicNotes size={28} weight="duotone" />
              <span className="text-lg font-black leading-none">{card.title.trim().charAt(0).toUpperCase()}</span>
            </div>
          )}
          {isNew && (
            <span className="absolute top-1 left-1 text-[10px] font-black uppercase tracking-wide bg-accent text-white px-1.5 py-0.5 rounded-md">
              Nouveau
            </span>
          )}
          {card.count > 1 && (
            <span className="absolute bottom-1 right-1 text-[11px] font-black bg-black/70 text-white px-1.5 py-0.5 rounded-md">
              ×{card.count}
            </span>
          )}
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink truncate" title={card.title}>
          {card.title}
        </p>
        <p className="text-xs text-muted truncate" title={card.artistName}>
          {card.artistName}
        </p>
        <span
          className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md text-white"
          style={{ background: style.color }}
        >
          {style.label}
        </span>
      </div>
    </div>
  )
}
