import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { detectCard, type DetectShape } from '../lib/detect'
import { orderQuad, warpCard, warpSize, type Point, type Quad } from '../lib/perspective'
import { ctx2d, rotate180, wipe } from '../lib/image'

export interface CropResult {
  quad: Quad
  flipped: boolean
}

interface Props {
  title: string
  source: HTMLCanvasElement
  initial: CropResult
  onCancel: () => void
  onDone: (r: CropResult) => void
  /** 'card' (IC, fixed landscape shape) or 'document' (any page shape). */
  shape?: DetectShape
}

const LOUPE = 120 // css px
const ZOOM = 3

export function Cropper({ title, source, initial, onCancel, onDone, shape = 'card' }: Props) {
  const isCard = shape === 'card'
  const ordered = (q: Quad) => orderQuad(q, isCard)
  const [quad, setQuad] = useState<Quad>(initial.quad)
  const [flipped, setFlipped] = useState(initial.flipped)
  const [drag, setDrag] = useState<number | null>(null)
  const [dispScale, setDispScale] = useState(1)
  const [note, setNote] = useState<string | null>(null)

  const imgRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const loupeRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)

  // Draw the photo once.
  useLayoutEffect(() => {
    const c = imgRef.current!
    c.width = source.width
    c.height = source.height
    // Effects must not throw (it would crash the page), e.g. when out of canvas memory.
    try {
      ctx2d(c).drawImage(source, 0, 0)
    } catch (e) {
      console.error(e)
    }
  }, [source])

  // Free the on-screen copies of the photo when the cropper closes.
  useEffect(() => {
    // Capture the elements now: React clears refs before unmount cleanups run.
    const els = [imgRef.current, previewRef.current, loupeRef.current]
    return () => {
      for (const c of els) if (c) c.width = c.height = 0
    }
  }, [])

  // Track on-screen scale so handles stay a constant finger-friendly size.
  useEffect(() => {
    const c = imgRef.current!
    const update = () => setDispScale(c.getBoundingClientRect().width / source.width || 1)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(c)
    return () => ro.disconnect()
  }, [source])

  // Live preview of the straightened card (small, cheap).
  useEffect(() => {
    if (drag !== null) return
    const c = previewRef.current
    if (!c) return
    try {
      const card = shape === 'card'
      const q = orderQuad(quad, card)
      const size = card ? { w: 360, h: 227 } : warpSize(q, 360)
      const warped = warpCard(source, q, size.w, size.h)
      const out = flipped ? rotate180(warped) : warped
      c.width = out.width
      c.height = out.height
      ctx2d(c).drawImage(out, 0, 0)
      wipe(warped)
      wipe(out)
    } catch (e) {
      console.error(e) // preview only; the crop itself still works
    }
  }, [source, quad, flipped, drag, shape])

  const toSource = useCallback(
    (e: React.PointerEvent): Point => {
      const r = svgRef.current!.getBoundingClientRect()
      return {
        x: Math.min(source.width, Math.max(0, ((e.clientX - r.left) / r.width) * source.width)),
        y: Math.min(source.height, Math.max(0, ((e.clientY - r.top) / r.height) * source.height)),
      }
    },
    [source],
  )

  const drawLoupe = (p: Point) => {
    const c = loupeRef.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = LOUPE * dpr
    c.height = LOUPE * dpr
    const ctx = ctx2d(c)
    const span = LOUPE / (ZOOM * dispScale) // source px shown across the loupe
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(source, p.x - span / 2, p.y - span / 2, span, span, 0, 0, c.width, c.height)
    ctx.strokeStyle = '#ff3b30'
    ctx.lineWidth = 2 * dpr
    ctx.beginPath()
    ctx.moveTo(c.width / 2, c.height / 2 - 14 * dpr)
    ctx.lineTo(c.width / 2, c.height / 2 + 14 * dpr)
    ctx.moveTo(c.width / 2 - 14 * dpr, c.height / 2)
    ctx.lineTo(c.width / 2 + 14 * dpr, c.height / 2)
    ctx.stroke()
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = toSource(e)
    const reach = 44 / dispScale
    let idx = -1
    let bestD = Infinity
    quad.forEach((q, i) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y)
      if (d < reach && d < bestD) {
        bestD = d
        idx = i
      }
    })
    if (idx < 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag(idx)
    drawLoupe(quad[idx])
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag === null) return
    const p = toSource(e)
    setQuad((q) => q.map((pt, i) => (i === drag ? p : pt)) as Quad)
    drawLoupe(p)
  }

  const endDrag = () => setDrag(null)

  const autoDetect = () => {
    const q = detectCard(source, undefined, shape)
    if (q) {
      setQuad(q)
      setNote(null)
    } else {
      setNote(`Couldn't find the ${isCard ? 'card' : 'page'} edges automatically. Drag the corners instead.`)
    }
  }

  // Nothing to reset if the corners and flip are as they were when the cropper opened.
  const unchanged =
    flipped === initial.flipped && quad.every((p, i) => p.x === initial.quad[i].x && p.y === initial.quad[i].y)

  const r = 11 / dispScale
  const stroke = 2.5 / dispScale
  const pts = quad.map((p) => `${p.x},${p.y}`).join(' ')
  const loupeOnLeft = drag !== null && quad[drag].x > source.width / 2

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={`Crop ${title}`}>
      <div className="modal-bar">
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <strong>Crop {title}</strong>
        <button type="button" className="primary" onClick={() => onDone({ quad: ordered(quad), flipped })}>
          Done
        </button>
      </div>

      <div className="crop-stage">
        <div className="crop-frame">
          <canvas ref={imgRef} className="crop-img" />
          <svg
            ref={svgRef}
            className="crop-overlay"
            viewBox={`0 0 ${source.width} ${source.height}`}
            preserveAspectRatio="none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <defs>
              <mask id="crop-mask">
                <rect width={source.width} height={source.height} fill="#fff" />
                <polygon points={pts} fill="#000" />
              </mask>
            </defs>
            <rect width={source.width} height={source.height} fill="rgba(0,0,0,0.5)" mask="url(#crop-mask)" />
            <polygon points={pts} fill="none" stroke="#4da3ff" strokeWidth={stroke} />
            {quad.map((p, i) => (
              <circle
                key={i}
                data-corner={i}
                cx={p.x}
                cy={p.y}
                r={drag === i ? r * 1.3 : r}
                fill="rgba(77,163,255,0.35)"
                stroke="#fff"
                strokeWidth={stroke}
              />
            ))}
          </svg>
          {/* Always mounted so it can be drawn before the first re-render. */}
          <canvas
            ref={loupeRef}
            className={`loupe ${loupeOnLeft ? 'left' : 'right'}`}
            hidden={drag === null}
            style={{ width: LOUPE, height: LOUPE }}
          />
        </div>
      </div>

      <div className="crop-tools">
        <div className="crop-preview">
          <canvas ref={previewRef} />
        </div>
        <div className="crop-buttons">
          <button type="button" onClick={autoDetect}>
            ✨ Auto-detect
          </button>
          {/* Pages are rotated from the page list instead. */}
          {isCard && (
            <button type="button" onClick={() => setFlipped((f) => !f)}>
              ↻ Flip 180°
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setQuad([
                { x: 0, y: 0 },
                { x: source.width, y: 0 },
                { x: source.width, y: source.height },
                { x: 0, y: source.height },
              ])
              setNote(null)
            }}
            title="Use the whole photo (e.g. if it's already cropped to the card)"
          >
            ⛶ Full photo
          </button>
          <button
            type="button"
            disabled={unchanged}
            onClick={() => {
              setQuad(initial.quad)
              setFlipped(initial.flipped)
              setNote(null)
            }}
            title="Undo your changes since opening this screen"
          >
            ↺ Reset
          </button>
        </div>
        {note ? <p className="crop-note">{note}</p> : <p className="crop-note">Drag the 4 corners onto the {isCard ? "card's" : "page's"} corners.</p>}
      </div>
    </div>
  )
}
