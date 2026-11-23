export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'

export interface WatermarkOptions {
  text: string
  position: WatermarkPosition
  color: string
  /** 0..1 */
  opacity: number
  /** Multiplier on the default size, 0.5..2 */
  scale: number
  /** Append today's date to the caption */
  includeDate: boolean
  /** Repeat the banner across the whole card (harder to crop out) */
  tile: boolean
}

export const DEFAULT_WATERMARK: WatermarkOptions = {
  text: 'FOR PRIVATE USE ONLY',
  position: 'top-left',
  color: '#000000',
  opacity: 1,
  scale: 1,
  includeDate: false,
  tile: false,
}

export const CAPTION_PRESETS = [
  'FOR PRIVATE USE ONLY',
  'FOR BANK ACCOUNT OPENING ONLY',
  'FOR LOAN APPLICATION ONLY',
  'FOR EMPLOYMENT PURPOSE ONLY',
  'FOR TENANCY AGREEMENT ONLY',
  'FOR VERIFICATION PURPOSE ONLY',
]

export function captionText(opts: WatermarkOptions): string {
  const base = opts.text.trim() || DEFAULT_WATERMARK.text
  if (!opts.includeDate) return base
  const d = new Date()
  const date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
  return `${base} – ${date}`
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Draw one banner: two parallel lines with the caption centred between them,
 * rotated diagonally. `cx, cy` is the banner centre, `angle` in radians.
 */
function drawBanner(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  angle: number,
  cardW: number,
  caption: string,
  opts: WatermarkOptions,
  minLength: number,
  repeatText = false,
) {
  const fontSize = cardW * 0.03 * opts.scale
  const gap = fontSize * 1.9 // distance between the two lines
  const lineWidth = Math.max(1, fontSize * 0.13)

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  ctx.font = `600 ${fontSize}px "Helvetica Neue", Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const textW = ctx.measureText(caption).width
  const length = Math.max(minLength, textW + fontSize * 3)

  ctx.strokeStyle = opts.color
  ctx.fillStyle = opts.color
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'butt'
  ctx.beginPath()
  ctx.moveTo(-length / 2, -gap / 2)
  ctx.lineTo(length / 2, -gap / 2)
  ctx.moveTo(-length / 2, gap / 2)
  ctx.lineTo(length / 2, gap / 2)
  ctx.stroke()
  if (repeatText) {
    // Repeat the caption along the whole stripe so every stripe is labelled.
    const step = textW + fontSize * 3
    for (let x = 0; x <= length / 2; x += step) {
      ctx.fillText(caption, x, 0)
      if (x) ctx.fillText(caption, -x, 0)
    }
  } else {
    ctx.fillText(caption, 0, 0)
  }
  ctx.restore()
}

/**
 * Draw the watermark over a card. `card` is the card's rectangle on the canvas;
 * the banner is allowed to extend past it (the canvas has padding for that),
 * like the diagonal "FOR PRIVATE USE ONLY" strip in a typical IC photocopy.
 */
export function drawWatermark(ctx: CanvasRenderingContext2D, card: Rect, opts: WatermarkOptions) {
  const caption = captionText(opts)
  const { x, y, w, h } = card
  const deg45 = Math.PI / 4

  ctx.save()
  ctx.globalAlpha = opts.opacity

  if (opts.tile) {
    // Diagonal stripes across the whole card, clipped to the card itself.
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, w * 0.035)
    ctx.clip()
    const step = w * 0.32 * opts.scale
    const span = w + h
    for (let d = -span; d <= span; d += step) {
      drawBanner(ctx, x + w / 2 + d * Math.SQRT1_2, y + h / 2 + d * Math.SQRT1_2, -deg45, w, caption, opts, span * 1.5, true)
    }
  } else {
    const minLen = w * 0.44 * opts.scale
    const ox = w * 0.11 // offset of banner centre from the corner
    const oy = h * 0.11
    switch (opts.position) {
      case 'top-left':
        drawBanner(ctx, x + ox, y + oy, -deg45, w, caption, opts, minLen)
        break
      case 'top-right':
        drawBanner(ctx, x + w - ox, y + oy, deg45, w, caption, opts, minLen)
        break
      case 'bottom-left':
        drawBanner(ctx, x + ox, y + h - oy, deg45, w, caption, opts, minLen)
        break
      case 'bottom-right':
        drawBanner(ctx, x + w - ox, y + h - oy, -deg45, w, caption, opts, minLen)
        break
      case 'center':
        drawBanner(ctx, x + w / 2, y + h / 2, -Math.atan2(h, w), w, caption, opts, Math.hypot(w, h) * 1.05)
        break
    }
  }
  ctx.restore()
}
