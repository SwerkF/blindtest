import { useEffect, useState, type ReactNode } from "react"
import { Shuffle, X } from "@phosphor-icons/react"
import Avatar from "@/components/Avatar"
import {
  AvatarExpression,
  AvatarShape,
  AvatarTone,
  EXPRESSION_LABEL,
  SHAPE_LABEL,
  TONE_LABEL,
  decodeAvatar,
  encodeAvatar,
  type AvatarConfig,
} from "@/utils/avatar"

interface AvatarEditorProps {
  value: string
  onSave: (encoded: string) => void
  onClose: () => void
}

const HUES = [0, 25, 45, 70, 110, 150, 180, 205, 230, 260, 290, 325]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="text-xs text-muted font-medium uppercase tracking-wider mb-2">{title}</h4>
      {children}
    </section>
  )
}

function Choice({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex flex-col items-center gap-1 p-1.5 rounded-xl border transition-colors ${
        active ? "border-accent bg-accent/10" : "border-edge hover:border-muted"
      }`}
    >
      {children}
      <span className="text-[10px] text-muted leading-none truncate max-w-full">{label}</span>
    </button>
  )
}

export default function AvatarEditor({ value, onSave, onClose }: AvatarEditorProps) {
  const [draft, setDraft] = useState<AvatarConfig>(() => decodeAvatar(value))

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const patch = (next: Partial<AvatarConfig>) => setDraft((current) => ({ ...current, ...next }))
  const preview = (next: Partial<AvatarConfig>) => encodeAvatar({ ...draft, ...next })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-pitch/60 p-4 animate-fade"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Personnaliser l'avatar"
        onClick={(event) => event.stopPropagation()}
        className="bg-surface border border-edge rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-xl"
      >
        <div className="flex items-center justify-between p-5 border-b border-edge">
          <h3 className="font-bold text-ink">Personnaliser l'avatar</h3>
          <button type="button" onClick={onClose} aria-label="Fermer" className="text-muted hover:text-ink">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          <div className="flex flex-col items-center gap-3">
            <Avatar name={encodeAvatar(draft)} size={150} animate="always" />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => patch({ seed: crypto.randomUUID() })}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-edge text-ink hover:border-accent hover:text-accent transition-colors"
              >
                <Shuffle size={15} />
                Nouveau blob
              </button>
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    seed: crypto.randomUUID(),
                    shape: null,
                    hue: null,
                    tone: null,
                    expression: AvatarExpression.Idle,
                  })
                }
                className="text-sm px-3 py-1.5 rounded-lg text-muted hover:text-ink transition-colors"
              >
                Tout aléatoire
              </button>
            </div>
          </div>

          <Section title="Forme">
            <div className="grid grid-cols-6 gap-1.5">
              <Choice active={draft.shape === null} label="Auto" onClick={() => patch({ shape: null })}>
                <Avatar name={preview({ shape: null })} size={40} />
              </Choice>
              {Object.values(AvatarShape).map((shape) => (
                <Choice key={shape} active={draft.shape === shape} label={SHAPE_LABEL[shape]} onClick={() => patch({ shape })}>
                  <Avatar name={preview({ shape })} size={40} />
                </Choice>
              ))}
            </div>
          </Section>

          <Section title="Couleur">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => patch({ hue: null })}
                aria-pressed={draft.hue === null}
                className={`h-8 px-3 rounded-full border text-xs font-medium transition-colors ${
                  draft.hue === null ? "border-accent text-accent bg-accent/10" : "border-edge text-muted hover:border-muted"
                }`}
              >
                Auto
              </button>
              {HUES.map((hue) => (
                <button
                  key={hue}
                  type="button"
                  onClick={() => patch({ hue })}
                  aria-label={`Teinte ${hue}°`}
                  aria-pressed={draft.hue === hue}
                  style={{ backgroundColor: `oklch(0.72 0.14 ${hue})` }}
                  className={`w-8 h-8 rounded-full transition-transform ${
                    draft.hue === hue ? "ring-2 ring-accent ring-offset-2 ring-offset-surface scale-110" : "hover:scale-110"
                  }`}
                />
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={359}
              value={draft.hue ?? 0}
              onChange={(event) => patch({ hue: Number(event.target.value) })}
              aria-label="Teinte précise"
              className="w-full mt-3 accent-accent"
            />
          </Section>

          <Section title="Ton">
            <div className="grid grid-cols-7 gap-1.5">
              <Choice active={draft.tone === null} label="Auto" onClick={() => patch({ tone: null })}>
                <Avatar name={preview({ tone: null })} size={36} />
              </Choice>
              {Object.values(AvatarTone).map((tone) => (
                <Choice key={tone} active={draft.tone === tone} label={TONE_LABEL[tone]} onClick={() => patch({ tone })}>
                  <Avatar name={preview({ tone })} size={36} />
                </Choice>
              ))}
            </div>
          </Section>

          <Section title="Expression">
            <div className="grid grid-cols-7 gap-1.5">
              {Object.values(AvatarExpression).map((expression) => (
                <Choice
                  key={expression}
                  active={draft.expression === expression}
                  label={EXPRESSION_LABEL[expression]}
                  onClick={() => patch({ expression })}
                >
                  <Avatar name={preview({ expression })} size={36} />
                </Choice>
              ))}
            </div>
          </Section>
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-edge">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm text-muted hover:text-ink">
            Annuler
          </button>
          <button
            type="button"
            onClick={() => onSave(encodeAvatar(draft))}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-accent text-white hover:opacity-90"
          >
            Valider
          </button>
        </div>
      </div>
    </div>
  )
}
