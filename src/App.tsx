import { useEffect, useMemo, useRef, useState } from 'react'
import { loadImage, rotate90, wipe } from './lib/image'
import { renderCard, CARD_H_MM, CARD_W_MM, PAD_RATIO } from './lib/card'
import { A4_MM, CARD_CENTERS, CARD_WIDTH_MM, type CardSize } from './lib/layout'
import {
  CAPTION_PRESETS,
  DEFAULT_WATERMARK,
  type WatermarkOptions,
  type WatermarkPosition,
} from './lib/watermark'

type Side = 'front' | 'back'
const SIDES: Side[] = ['front', 'back']
const LABEL: Record<Side, string> = { front: 'Front', back: 'Back' }

/** Card width in px for on-screen preview vs. final PDF. */
const PREVIEW_PX = 700
const EXPORT_PX = 1600

export default function App() {
  const [photos, setPhotos] = useState<Record<Side, HTMLCanvasElement | null>>({ front: null, back: null })
  const [wm, setWm] = useState<WatermarkOptions>(DEFAULT_WATERMARK)
  const [size, setSize] = useState<CardSize>('enlarged')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = photos.front !== null && photos.back !== null
  const update = <K extends keyof WatermarkOptions>(k: K, v: WatermarkOptions[K]) => setWm((p) => ({ ...p, [k]: v }))

  async function onPick(side: Side, file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const img = await loadImage(file)
      wipe(photos[side])
      setPhotos((p) => ({ ...p, [side]: img }))
    } catch {
      setError('Could not read that image. Please try another photo.')
    }
  }

  function onRotate(side: Side) {
    const src = photos[side]
    if (!src) return
    const out = rotate90(src)
    setPhotos((p) => ({ ...p, [side]: out }))
    wipe(src)
  }

  function onRemove(side: Side) {
    wipe(photos[side])
    setPhotos((p) => ({ ...p, [side]: null }))
  }

  function clearAll() {
    SIDES.forEach((s) => wipe(photos[s]))
    setPhotos({ front: null, back: null })
    setWm(DEFAULT_WATERMARK)
    setError(null)
  }

  async function makePdfFile(): Promise<File> {
    const cards = SIDES.map((s) => renderCard(photos[s]!, wm, EXPORT_PX))
    try {
      // pdf-lib is large, so load it only when it's needed.
      const { buildPdf } = await import('./lib/pdf')
      const bytes = await buildPdf(cards, size)
      const slug = wm.text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'copy'
      return new File([bytes as BlobPart], `IC-${slug}.pdf`, { type: 'application/pdf' })
    } finally {
      cards.forEach((c) => wipe(c.canvas))
    }
  }

  async function onDownload() {
    setBusy(true)
    setError(null)
    try {
      const file = await makePdfFile()
      const url = URL.createObjectURL(file)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      setError('Something went wrong generating the PDF.')
    } finally {
      setBusy(false)
    }
  }

  const canShare = typeof navigator !== 'undefined' && 'canShare' in navigator

  async function onShare() {
    setBusy(true)
    setError(null)
    try {
      const file = await makePdfFile()
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: file.name })
      } else {
        setError('Sharing files is not supported on this browser. Use Download instead.')
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setError('Could not share the PDF.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <header>
        <h1>IC to PDF</h1>
        <p className="privacy">
          🔒 Your photos never leave this device. Everything is processed in your browser.
        </p>
      </header>

      <section className="panel">
        <h2>1. Capture your IC</h2>
        <div className="slots">
          {SIDES.map((side) => (
            <CaptureSlot
              key={side}
              label={LABEL[side]}
              photo={photos[side]}
              onPick={(f) => onPick(side, f)}
              onRotate={() => onRotate(side)}
              onRemove={() => onRemove(side)}
            />
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>2. Watermark</h2>
        <label className="field">
          <span>Caption</span>
          <input
            type="text"
            value={wm.text}
            maxLength={60}
            onChange={(e) => update('text', e.target.value.toUpperCase())}
            placeholder="FOR PRIVATE USE ONLY"
          />
        </label>
        <div className="chips">
          {CAPTION_PRESETS.map((p) => (
            <button key={p} type="button" className={wm.text === p ? 'chip active' : 'chip'} onClick={() => update('text', p)}>
              {p.replace(/^FOR /, '').replace(/ ONLY$/, '')}
            </button>
          ))}
        </div>

        <div className="grid">
          <label className="field">
            <span>Position</span>
            <select value={wm.position} onChange={(e) => update('position', e.target.value as WatermarkPosition)} disabled={wm.tile}>
              <option value="top-left">Top left</option>
              <option value="top-right">Top right</option>
              <option value="bottom-left">Bottom left</option>
              <option value="bottom-right">Bottom right</option>
              <option value="center">Across centre</option>
            </select>
          </label>
          <label className="field">
            <span>Colour</span>
            <input type="color" value={wm.color} onChange={(e) => update('color', e.target.value)} />
          </label>
          <label className="field">
            <span>Size ({Math.round(wm.scale * 100)}%)</span>
            <input type="range" min={0.6} max={2} step={0.05} value={wm.scale} onChange={(e) => update('scale', +e.target.value)} />
          </label>
          <label className="field">
            <span>Opacity ({Math.round(wm.opacity * 100)}%)</span>
            <input type="range" min={0.2} max={1} step={0.05} value={wm.opacity} onChange={(e) => update('opacity', +e.target.value)} />
          </label>
        </div>

        <label className="check">
          <input type="checkbox" checked={wm.includeDate} onChange={(e) => update('includeDate', e.target.checked)} />
          Add today's date
        </label>
        <label className="check">
          <input type="checkbox" checked={wm.tile} onChange={(e) => update('tile', e.target.checked)} />
          Repeat across the whole card (harder to crop out)
        </label>
      </section>

      <section className="panel">
        <h2>3. Preview</h2>
        <div className="segmented" role="radiogroup" aria-label="Card size">
          <button type="button" aria-pressed={size === 'enlarged'} onClick={() => setSize('enlarged')}>
            Enlarged
          </button>
          <button type="button" aria-pressed={size === 'actual'} onClick={() => setSize('actual')}>
            Actual size
          </button>
        </div>
        <A4Preview photos={photos} wm={wm} size={size} />
      </section>

      {error && <p className="error">{error}</p>}

      <div className="actions">
        <button type="button" className="primary" disabled={!ready || busy} onClick={onDownload}>
          {busy ? 'Generating…' : 'Download PDF'}
        </button>
        {canShare && (
          <button type="button" disabled={!ready || busy} onClick={onShare}>
            Share
          </button>
        )}
        <button type="button" className="ghost" onClick={clearAll}>
          Clear all
        </button>
      </div>
      {!ready && <p className="hint">Add both the front and back photos to generate the PDF.</p>}
    </div>
  )
}

function CaptureSlot(props: {
  label: string
  photo: HTMLCanvasElement | null
  onPick: (f: File | undefined) => void
  onRotate: () => void
  onRemove: () => void
}) {
  const { label, photo, onPick, onRotate, onRemove } = props
  const camRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    onPick(e.target.files?.[0])
    e.target.value = '' // allow re-picking the same file
  }

  return (
    <div className="slot">
      <div className="slot-head">{label}</div>
      <div className="slot-body">
        {photo ? <CanvasView source={photo} className="thumb" /> : <div className="placeholder">No photo yet</div>}
      </div>
      <div className="slot-actions">
        <button type="button" onClick={() => camRef.current?.click()}>
          📷 Snap
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          Upload
        </button>
        {photo && (
          <>
            <button type="button" onClick={onRotate} aria-label={`Rotate ${label}`}>
              ⟳
            </button>
            <button type="button" onClick={onRemove} aria-label={`Remove ${label}`}>
              ✕
            </button>
          </>
        )}
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
    </div>
  )
}

function A4Preview({ photos, wm, size }: { photos: Record<Side, HTMLCanvasElement | null>; wm: WatermarkOptions; size: CardSize }) {
  const rendered = useMemo(
    () => SIDES.map((s) => (photos[s] ? renderCard(photos[s]!, wm, PREVIEW_PX).canvas : null)),
    [photos, wm],
  )

  // Layout in % of the A4 page, matching the PDF exactly.
  const imgWmm = CARD_WIDTH_MM[size] * (1 + PAD_RATIO * 2)
  const imgHmm = imgWmm * ((CARD_H_MM / CARD_W_MM + PAD_RATIO * 2) / (1 + PAD_RATIO * 2))

  return (
    <div className="a4">
      {SIDES.map((s, i) => {
        const style = {
          width: `${(imgWmm / A4_MM.w) * 100}%`,
          left: `${(1 - imgWmm / A4_MM.w) * 50}%`,
          top: `${(CARD_CENTERS[i] - imgHmm / A4_MM.h / 2) * 100}%`,
        }
        const c = rendered[i]
        return c ? (
          <CanvasView key={s} source={c} className="a4-card" style={style} />
        ) : (
          <div key={s} className="a4-card a4-empty" style={{ ...style, aspectRatio: `${imgWmm} / ${imgHmm}` }}>
            {LABEL[s]}
          </div>
        )
      })}
    </div>
  )
}

/** Displays an offscreen canvas by copying it into an on-screen one. */
function CanvasView({ source, className, style }: { source: HTMLCanvasElement; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.width = source.width
    c.height = source.height
    c.getContext('2d')!.drawImage(source, 0, 0)
  }, [source])
  return <canvas ref={ref} className={className} style={style} />
}
