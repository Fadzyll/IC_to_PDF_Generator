import { useEffect, useMemo, useRef } from 'react'
import { ctx2d, wipe } from '../lib/image'
import { tryCanvas, useReleaseReplaced, type AppError } from '../lib/app-utils'
import { applyFilter, FILTERS, type FilterId } from '../lib/filters'
import { SUPPORT_URL } from '../config'

/** Displays an offscreen canvas by copying it into an on-screen one. */
export function CanvasView({
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

/**
 * A small built-in example (a card or a document page in dim, uneven light), so
 * the filter thumbnails show what each filter does before any photo is added.
 */
function drawSample(kind: 'card' | 'document'): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 240
  c.height = 151
  const x = ctx2d(c)
  if (kind === 'card') {
    x.fillStyle = '#9ab7d6'
    x.beginPath()
    x.roundRect(0, 0, 240, 151, 9)
    x.fill()
    x.fillStyle = '#c9a24a'
    x.fillRect(22, 58, 30, 24)
    x.fillStyle = '#e4ecf5'
    x.beginPath()
    x.roundRect(160, 34, 56, 74, 14)
    x.fill()
    x.fillStyle = '#2b3a67'
    x.fillRect(20, 18, 110, 9)
    x.fillStyle = '#4a5878'
    for (let i = 0; i < 3; i++) x.fillRect(22, 98 + i * 12, 100 - i * 18, 5)
  } else {
    x.fillStyle = '#ecebe6'
    x.fillRect(0, 0, 240, 151)
    x.fillStyle = '#2a2d33'
    x.fillRect(18, 16, 120, 9)
    x.fillStyle = '#555a63'
    for (let i = 0; i < 8; i++) x.fillRect(18, 36 + i * 13, 204 - (i % 3) * 30, 4)
  }
  // Warm cast and a shadow from the right, like an indoor phone photo.
  const g = x.createLinearGradient(0, 0, 240, 0)
  g.addColorStop(0, 'rgba(60,40,10,0.15)')
  g.addColorStop(1, 'rgba(20,10,0,0.55)')
  x.fillStyle = g
  x.globalCompositeOperation = 'multiply'
  x.fillRect(0, 0, 240, 151)
  return c
}

/** Filter chips with live thumbnails (of the user's photo, or a built-in example), like a scanner app. */
export function FilterPicker({
  base,
  sample,
  value,
  onChange,
}: {
  base: HTMLCanvasElement | null
  sample: 'card' | 'document'
  value: FilterId
  onChange: (f: FilterId) => void
}) {
  const thumbs = useMemo(
    () =>
      tryCanvas(() => {
        const small = document.createElement('canvas')
        if (base) {
          small.width = 240
          small.height = Math.round((240 * base.height) / base.width)
          const ctx = ctx2d(small)
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(base, 0, 0, small.width, small.height)
        } else {
          const s = drawSample(sample)
          small.width = s.width
          small.height = s.height
          ctx2d(small).drawImage(s, 0, 0)
          wipe(s)
        }
        return Object.fromEntries(FILTERS.map((f) => [f.id, applyFilter(small, f.id, sample)])) as Record<FilterId, HTMLCanvasElement>
      }, null),
    [base, sample],
  )
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

export function ErrorBox({ error }: { error: AppError | null }) {
  if (!error) return null
  return (
    <div className="error" role="alert">
      <p>{error.message}</p>
      {error.reload && (
        <button type="button" onClick={() => location.reload()}>
          Reload page
        </button>
      )}
    </div>
  )
}

/** Thank-you note with the support link, shown after a PDF is made. */
export function SupportNote({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div className="support-note" role="status">
      <span>✓ Your PDF is ready.</span>
      <span>
        Found this useful?{' '}
        <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
          ☕ Support the developer
        </a>
      </span>
    </div>
  )
}

export function BusyOverlay({ label }: { label: string | null }) {
  if (!label) return null
  return (
    <div className="busy" role="status">
      <div className="spinner" />
      {label}
    </div>
  )
}
