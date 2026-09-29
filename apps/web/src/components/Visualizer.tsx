import { useCallback, useEffect, useRef, useState } from "react"
import { SpeakerHigh, SpeakerSlash, Play } from "@phosphor-icons/react"
import { getVolume, isMuted, onVolumeChange, setMuted, setVolume } from "@/utils/audio"

interface Props {
  previewUrl: string | null
  isPlaying: boolean
  /** Seconds already elapsed in the round, so a late join stays in sync. */
  seekTo?: number
}

const BAR_COUNT = 40

/** "#rrggbb" blended towards white by `amount` (0..1). */
function mixWithWhite(hex: string, amount: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i)
  if (!m) return hex
  const n = Number.parseInt(m[1], 16)
  const channel = (shift: number) => {
    const c = (n >> shift) & 0xff
    return Math.round(c + (255 - c) * amount)
  }
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, data: Uint8Array<ArrayBuffer> | null, t: number) {
  ctx.clearRect(0, 0, w, h)

  const slot = w / BAR_COUNT
  const barW = slot * 0.6
  const gap = slot * 0.4

  // Bars follow the theme accent, lightening towards the top
  const accent = getComputedStyle(ctx.canvas).getPropertyValue("--color-accent").trim() || "#946846"
  const grad = ctx.createLinearGradient(0, h, 0, 0)
  grad.addColorStop(0, accent)
  grad.addColorStop(1, mixWithWhite(accent, 0.45))

  for (let i = 0; i < BAR_COUNT; i++) {
    let value: number
    if (data && data.length > 0) {
      const idx = Math.floor((i / BAR_COUNT) * data.length)
      value = data[idx] / 255
    } else {
      value = 0.12 + Math.abs(Math.sin(t * 0.002 + i * 0.4 + Math.cos(i * 0.3))) * 0.5
    }

    const barH = Math.max(3, value * h * 0.9)
    const x = i * slot + gap / 2
    ctx.fillStyle = grad
    ctx.fillRect(x, h - barH, barW, barH)
  }
}

export default function Visualizer({ previewUrl, isPlaying, seekTo = 0 }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animRef = useRef<number>(0)

  const [volume, setVol] = useState(getVolume)
  const [muted, setMut] = useState(isMuted)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => onVolumeChange(() => {
    setVol(getVolume())
    setMut(isMuted())
  }), [])

  /**
   * Routing an element through a suspended AudioContext silences it entirely,
   * and a context created without a user gesture always starts suspended. So
   * the graph is only wired up once the context is confirmed running; until
   * then playback stays on the plain element and the bars animate on a timer.
   */
  const setupAnalyser = useCallback(async () => {
    const audio = audioRef.current
    if (analyserRef.current || !audio || typeof AudioContext === "undefined") return

    let ctx = ctxRef.current
    if (!ctx) {
      ctx = new AudioContext()
      ctxRef.current = ctx
    }
    if (ctx.state !== "running") {
      try {
        await ctx.resume()
      } catch {
        return
      }
    }
    if (ctx.state !== "running") return

    try {
      const source = ctx.createMediaElementSource(audio)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 128
      source.connect(analyser)
      analyser.connect(ctx.destination)
      analyserRef.current = analyser
    } catch {
      // Already captured or blocked; plain playback keeps working
    }
  }, [])

  const start = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return
    await setupAnalyser()
    try {
      await audio.play()
      setBlocked(false)
    } catch {
      setBlocked(true)
    }
  }, [setupAnalyser])

  // Any interaction is a chance to recover from a blocked autoplay / suspended context
  useEffect(() => {
    const onGesture = () => {
      if (!analyserRef.current) void setupAnalyser()
      if (blocked && isPlaying) void start()
    }
    window.addEventListener("pointerdown", onGesture)
    window.addEventListener("keydown", onGesture)
    return () => {
      window.removeEventListener("pointerdown", onGesture)
      window.removeEventListener("keydown", onGesture)
    }
  }, [setupAnalyser, start, blocked, isPlaying])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume
  }, [volume, muted])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !previewUrl) return
    audio.crossOrigin = "anonymous"
    audio.src = previewUrl
    audio.volume = muted ? 0 : volume
    if (seekTo > 0) audio.currentTime = seekTo
    if (isPlaying) void start()
    // seekTo/volume only matter at load time for this preview
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl, start])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) void start()
    else audio.pause()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx2d = canvas.getContext("2d")!
    let active = true

    const loop = (t: number) => {
      if (!active) return
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h

      let data: Uint8Array<ArrayBuffer> | null = null
      if (analyserRef.current) {
        data = new Uint8Array(analyserRef.current.frequencyBinCount) as Uint8Array<ArrayBuffer>
        analyserRef.current.getByteFrequencyData(data)
      }
      draw(ctx2d, w, h, data, t)
      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)

    return () => {
      active = false
      cancelAnimationFrame(animRef.current)
    }
  }, [])

  return (
    <div className="relative w-full h-full bg-stage rounded-xl overflow-hidden">
      <audio ref={audioRef} />
      <canvas ref={canvasRef} className="w-full h-full" />

      {blocked && isPlaying && (
        <button
          onClick={() => void start()}
          className="absolute inset-0 flex items-center justify-center gap-2 bg-stage/90 text-smoke font-semibold text-sm"
        >
          <Play size={18} weight="fill" className="text-toffee" />
          Activer le son
        </button>
      )}

      <div className="absolute top-2 right-2 flex items-center gap-2 bg-stage/80 rounded-full pl-2 pr-3 py-1.5">
        <button
          onClick={() => setMuted(!muted)}
          aria-label={muted ? "Rétablir le son" : "Couper le son"}
          className="text-khaki hover:text-toffee transition-colors"
        >
          {muted || volume === 0 ? <SpeakerSlash size={15} /> : <SpeakerHigh size={15} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => {
            setMuted(false)
            setVolume(Number(e.target.value))
          }}
          aria-label="Volume"
          className="w-20 accent-toffee"
        />
      </div>
    </div>
  )
}
