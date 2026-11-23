import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { CanvasMemoryError, ctx2d, loadImage, rotate180, wipe } from './lib/image'
import { renderCard, CARD_H_MM, CARD_W_MM, PAD_RATIO } from './lib/card'
import { A4_MM, CARD_CENTERS, CARD_WIDTH_MM, WATERMARK_BOOST, type CardSize } from './lib/layout'
import { applyFilter, FILTERS, type FilterId } from './lib/filters'
import { detectCard } from './lib/detect'
import { defaultQuad, warpCard, type Quad } from './lib/perspective'
import {
  CAPTION_PRESETS,
  DEFAULT_WATERMARK,
  type WatermarkOptions,
  type WatermarkPosition,
} from './lib/watermark'
import { Cropper, type CropResult } from './components/Cropper'
import { Camera } from './components/Camera'

type Side = 'front' | 'back'
const SIDES: Side[] = ['front', 'back']
const LABEL: Record<Side, string> = { front: 'Front', back: 'Back' }

/** Donation page. A plain link only: no third-party scripts on a page that handles IC photos. */
const SUPPORT_URL = 'https://sociabuzz.com/fadzyll007/tribe'

/** Card width in px for on-screen preview vs. final PDF. */
const PREVIEW_PX = 700
const EXPORT_PX = 1600
/** Fallback if the phone runs out of image memory at full size. */
const EXPORT_PX_LOW = 1100

/** The PDF code is loaded on demand; a redeploy can remove the old file a stale page asks for. */
const isChunkLoadError = (e: unknown) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch/i.test(
    (e as Error)?.message ?? '',
  )

/** Turn a failure into a message that says what happened and what to do. */
function describeError(e: unknown, action: string): { message: string; reload?: boolean } {
  if (e instanceof CanvasMemoryError) {
    return {
      message: `Your phone ran out of memory while ${action}. Close other tabs or apps and try again. If it still fails, reload the page.`,
      reload: true,
    }
  }
  if (isChunkLoadError(e)) {
    return { message: 'The app was just updated. Please reload the page and try again.', reload: true }
  }
  const err = e as Error
  const detail = err?.message ? ` (${err.name}: ${err.message.slice(0, 120)})` : ''
  return { message: `Something went wrong while ${action}.${detail}`, reload: true }
}

/** Run image work during render without crashing the page if memory runs out. */
function tryCanvas<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch (e) {
    console.error(e)
    return fallback
  }
}

/**
 * Free canvases from the previous render once they've been replaced. Safari is
 * slow to release canvas memory by itself and has a low limit on iPhones.
 */
function useReleaseReplaced(current: (HTMLCanvasElement | null)[], keep: (HTMLCanvasElement | null | undefined)[] = []) {
  const prev = useRef<HTMLCanvasElement[]>([])
  useEffect(() => {
    const now = current.filter((c): c is HTMLCanvasElement => !!c)
    for (const c of prev.current) if (!now.includes(c) && !keep.includes(c)) wipe(c)
    prev.current = now
  })
}

interface SideState {
  /** Original photo (downscaled), kept so the crop can be edited again. */
  source: HTMLCanvasElement
  crop: CropResult
  /** Straightened, card-shaped result. */
  card: HTMLCanvasElement
}

type Sides = Record<Side, SideState | null>

/** What's open on top of the main page. */
type Overlay =
  | { kind: 'camera'; side: Side }
  | { kind: 'crop'; side: Side; source: HTMLCanvasElement; initial: CropResult }
  | null

const hasLiveCamera = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

/** Let React paint a "Processing…" state before blocking work. */
const nextFrame = () => new Promise((r) => setTimeout(r, 30))

export default function App() {
  const [sides, setSides] = useState<Sides>({ front: null, back: null })
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [wm, setWm] = useState<WatermarkOptions>(DEFAULT_WATERMARK)
  const [size, setSize] = useState<CardSize>('enlarged')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; reload?: boolean } | null>(null)
  // Set after a PDF is downloaded or shared, to show a small thank-you / support note.
  const [done, setDone] = useState(false)
  const captureInputs = useRef<Record<Side, HTMLInputElement | null>>({ front: null, back: null })

  const [filter, setFilter] = useState<FilterId>('enhance')
  // Straightened cards with the chosen filter applied (recomputed only when those change).
  const cards = useMemo(
    () => ({
      // If filtering fails (out of memory), fall back to the unfiltered card.
      front: sides.front ? tryCanvas(() => applyFilter(sides.front!.card, filter), sides.front.card) : null,
      back: sides.back ? tryCanvas(() => applyFilter(sides.back!.card, filter), sides.back.card) : null,
    }),
    [sides, filter],
  )
  // Free filtered copies when they're replaced (but never the original straightened cards).
  useReleaseReplaced([cards.front, cards.back], [sides.front?.card, sides.back?.card])
  const wmFor = (s: CardSize) => ({ ...wm, scale: wm.scale * WATERMARK_BOOST[s] })
  const ready = cards.front !== null && cards.back !== null

  // Load the PDF code as soon as both photos are in, so a later redeploy can't break the download.
  useEffect(() => {
    if (ready) import('./lib/pdf').catch(() => {})
  }, [ready])
  const update = <K extends keyof WatermarkOptions>(k: K, v: WatermarkOptions[K]) => setWm((p) => ({ ...p, [k]: v }))

  /** A new photo arrived (camera or file): find the card, then open the cropper. */
  async function startCrop(side: Side, source: HTMLCanvasElement, guide?: Quad) {
    setBusy('Finding card edges…')
    await nextFrame()
    const quad = tryCanvas(() => detectCard(source, guide), null) ?? guide ?? defaultQuad(source.width, source.height)
    setBusy(null)
    setOverlay({ kind: 'crop', side, source, initial: { quad, flipped: false } })
  }

  async function onPick(side: Side, file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const img = await loadImage(file)
      await startCrop(side, img)
    } catch {
      setBusy(null)
      setError({ message: 'Could not read that image. Please try another photo.' })
    }
  }

  function onSnap(side: Side) {
    setError(null)
    if (hasLiveCamera()) setOverlay({ kind: 'camera', side })
    else captureInputs.current[side]?.click()
  }

  async function onCropDone(side: Side, source: HTMLCanvasElement, crop: CropResult) {
    setOverlay(null)
    setBusy('Straightening…')
    setError(null)
    await nextFrame()
    let card: HTMLCanvasElement
    try {
      card = warpCard(source, crop.quad)
      if (crop.flipped) {
        const f = rotate180(card)
        wipe(card)
        card = f
      }
    } catch (e) {
      console.error(e)
      setBusy(null)
      setError(describeError(e, 'straightening the photo'))
      return
    }
    const old = sides[side]
    if (old) {
      if (old.source !== source) wipe(old.source)
      wipe(old.card)
    }
    setSides((s) => ({ ...s, [side]: { source, crop, card } }))
    setBusy(null)
  }

  function onCropCancel(side: Side, source: HTMLCanvasElement) {
    // Discard a brand-new photo, but never the one already in use.
    if (sides[side]?.source !== source) wipe(source)
    setOverlay(null)
  }

  function onEdit(side: Side) {
    const s = sides[side]
    if (s) setOverlay({ kind: 'crop', side, source: s.source, initial: s.crop })
  }

  function onRemove(side: Side) {
    const s = sides[side]
    if (s) {
      wipe(s.source)
      wipe(s.card)
    }
    setSides((p) => ({ ...p, [side]: null }))
  }

  function clearAll() {
    SIDES.forEach((s) => {
      wipe(sides[s]?.source)
      wipe(sides[s]?.card)
    })
    setSides({ front: null, back: null })
    setWm(DEFAULT_WATERMARK)
    setError(null)
    setDone(false)
  }

  async function makePdfFile(): Promise<File> {
    // pdf-lib is large, so it's loaded on demand (usually already preloaded above).
    const { buildPdf } = await import('./lib/pdf')
    const build = (px: number) => buildPdf(SIDES.map((s) => () => renderCard(cards[s]!, wmFor(size), px)), size)
    let bytes: Uint8Array
    try {
      bytes = await build(EXPORT_PX)
    } catch (e) {
      // Out of image memory (typically iPhone Safari): try again at a lower resolution.
      if (!(e instanceof CanvasMemoryError)) throw e
      await nextFrame()
      bytes = await build(EXPORT_PX_LOW)
    }
    const slug = wm.text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'copy'
    const d = new Date()
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return new File([bytes as BlobPart], `IC-${slug}-${date}.pdf`, { type: 'application/pdf' })
  }

  async function onDownload() {
    setBusy('Generating PDF…')
    setError(null)
    try {
      const file = await makePdfFile()
      const url = URL.createObjectURL(file)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setDone(true)
    } catch (e) {
      console.error(e)
      setError(describeError(e, 'generating the PDF'))
    } finally {
      setBusy(null)
    }
  }

  const canShare = typeof navigator !== 'undefined' && 'canShare' in navigator

  async function onShare() {
    setBusy('Generating PDF…')
    setError(null)
    try {
      const file = await makePdfFile()
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: file.name })
        setDone(true)
      } else {
        setError({ message: 'Sharing files is not supported on this browser. Use Download instead.' })
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        console.error(e)
        setError(describeError(e, 'sharing the PDF'))
      }
    } finally {
      setBusy(null)
    }
  }

  // Lock page scroll while a full-screen overlay is open.
  useEffect(() => {
    document.body.style.overflow = overlay ? 'hidden' : ''
  }, [overlay])

  return (
    <div className="app">
      <section className="panel">
        <h2>1. Capture your IC</h2>
        <div className="slots">
          {SIDES.map((side) => (
            <CaptureSlot
              key={side}
              label={LABEL[side]}
              card={cards[side]}
              captureRef={(el) => (captureInputs.current[side] = el)}
              onSnap={() => onSnap(side)}
              onPick={(f) => onPick(side, f)}
              onEdit={() => onEdit(side)}
              onRemove={() => onRemove(side)}
            />
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>2. Enhance</h2>
        <FilterPicker sides={sides} value={filter} onChange={setFilter} />
      </section>

      <section className="panel">
        <h2>3. Watermark</h2>
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
        <h2>4. Preview</h2>
        <div className="segmented" role="group" aria-label="Card size">
          <button type="button" aria-pressed={size === 'enlarged'} onClick={() => setSize('enlarged')}>
            Enlarged
          </button>
          <button type="button" aria-pressed={size === 'actual'} onClick={() => setSize('actual')}>
            Actual size
          </button>
        </div>
        <A4Preview cards={cards} wm={wmFor(size)} size={size} />
      </section>

      {error && (
        <div className="error" role="alert">
          <p>{error.message}</p>
          {error.reload && (
            <button type="button" onClick={() => location.reload()}>
              Reload page
            </button>
          )}
        </div>
      )}

      <div className="actions">
        <button type="button" className="primary" disabled={!ready || !!busy} onClick={onDownload}>
          Download PDF
        </button>
        {canShare && (
          <button type="button" disabled={!ready || !!busy} onClick={onShare}>
            Share
          </button>
        )}
        <button type="button" className="ghost" onClick={clearAll}>
          Clear all
        </button>
      </div>
      {!ready && <p className="hint">Add both the front and back photos to generate the PDF.</p>}
      {done && (
        <div className="support-note" role="status">
          <span>✓ Your PDF is ready.</span>
          <span>
            Found this useful?{' '}
            <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
              ☕ Support the developer
            </a>
          </span>
        </div>
      )}

      {overlay?.kind === 'camera' && (
        <Camera
          title={LABEL[overlay.side]}
          onCancel={() => setOverlay(null)}
          onFallback={() => {
            setOverlay(null)
            captureInputs.current[overlay.side]?.click()
          }}
          onCapture={(frame, guide) => {
            setOverlay(null)
            startCrop(overlay.side, frame, guide)
          }}
        />
      )}
      {overlay?.kind === 'crop' && (
        <Cropper
          key={`${overlay.side}-${overlay.source.width}`}
          title={LABEL[overlay.side]}
          source={overlay.source}
          initial={overlay.initial}
          onCancel={() => onCropCancel(overlay.side, overlay.source)}
          onDone={(r) => onCropDone(overlay.side, overlay.source, r)}
        />
      )}
      {busy && (
        <div className="busy" role="status">
          <div className="spinner" />
          {busy}
        </div>
      )}
    </div>
  )
}

function CaptureSlot(props: {
  label: string
  card: HTMLCanvasElement | null
  captureRef: (el: HTMLInputElement | null) => void
  onSnap: () => void
  onPick: (f: File | undefined) => void
  onEdit: () => void
  onRemove: () => void
}) {
  const { label, card, captureRef, onSnap, onPick, onEdit, onRemove } = props
  const fileRef = useRef<HTMLInputElement>(null)

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    onPick(e.target.files?.[0])
    e.target.value = '' // allow re-picking the same file
  }

  return (
    <div className="slot">
      <div className="slot-head">{label}</div>
      <div className="slot-body">
        {card ? (
          <button type="button" className="thumb-btn" onClick={onEdit} aria-label={`Edit ${label} crop`}>
            <CanvasView source={card} className="thumb" maxWidth={640} />
          </button>
        ) : (
          <div className="placeholder">No photo yet</div>
        )}
      </div>
      <div className="slot-actions">
        <button type="button" onClick={onSnap}>
          📷 Snap
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          Upload
        </button>
        {card && (
          <>
            <button type="button" onClick={onEdit} aria-label={`Edit ${label} crop`}>
              ✂️
            </button>
            <button type="button" onClick={onRemove} aria-label={`Remove ${label}`}>
              ✕
            </button>
          </>
        )}
      </div>
      {/* Fallback when live camera isn't available: the OS camera app. */}
      <input ref={captureRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
    </div>
  )
}

/** Filter chips with live thumbnails of the user's own card, like a scanner app. */
function FilterPicker({ sides, value, onChange }: { sides: Sides; value: FilterId; onChange: (f: FilterId) => void }) {
  const base = sides.front?.card ?? sides.back?.card ?? null
  const thumbs = useMemo(() => {
    if (!base) return null
    const small = document.createElement('canvas')
    small.width = 240
    small.height = Math.round((240 * base.height) / base.width)
    const ctx = ctx2d(small)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(base, 0, 0, small.width, small.height)
    return tryCanvas(
      () => Object.fromEntries(FILTERS.map((f) => [f.id, applyFilter(small, f.id)])) as Record<FilterId, HTMLCanvasElement>,
      null,
    )
  }, [base])
  useReleaseReplaced(thumbs ? Object.values(thumbs) : [])

  return (
    <div className="filters" role="group" aria-label="Colour filter">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          className={value === f.id ? 'filter active' : 'filter'}
          aria-pressed={value === f.id}
          title={f.hint}
          onClick={() => onChange(f.id)}
        >
          {thumbs ? <CanvasView source={thumbs[f.id]} className="filter-thumb" /> : <span className="filter-thumb empty" />}
          <span>{f.label}</span>
        </button>
      ))}
    </div>
  )
}

function A4Preview({ cards, wm, size }: { cards: Record<Side, HTMLCanvasElement | null>; wm: WatermarkOptions; size: CardSize }) {
  // While a slider is being dragged, let the preview lag behind instead of re-rendering on every step.
  const deferredWm = useDeferredValue(wm)
  const rendered = useMemo(
    () => SIDES.map((s) => (cards[s] ? tryCanvas(() => renderCard(cards[s]!, deferredWm, PREVIEW_PX).canvas, null) : null)),
    [cards, deferredWm],
  )
  useReleaseReplaced(rendered)

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
function CanvasView({
  source,
  className,
  style,
  maxWidth = Infinity,
}: {
  source: HTMLCanvasElement
  className?: string
  style?: React.CSSProperties
  /** Store at most this many px wide (thumbnails don't need the full-size image). */
  maxWidth?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  // Free the on-screen copy when this view goes away.
  useEffect(() => {
    const c = ref.current // captured now: React clears refs before unmount cleanups run
    return () => {
      if (c) c.width = c.height = 0
    }
  }, [])
  useEffect(() => {
    const c = ref.current
    if (!c) return
    // A throw inside an effect would take down the whole page; leave the view blank instead.
    tryCanvas(() => {
      const scale = Math.min(1, maxWidth / source.width)
      c.width = Math.round(source.width * scale)
      c.height = Math.round(source.height * scale)
      ctx2d(c).drawImage(source, 0, 0, c.width, c.height)
    }, undefined)
  }, [source, maxWidth])
  return <canvas ref={ref} className={className} style={style} />
}
