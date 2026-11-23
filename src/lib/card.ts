import { ctx2d } from './image'
import { drawWatermark, type WatermarkOptions } from './watermark'

/** ISO/IEC 7810 ID-1 card size (MyKad), in mm. */
export const CARD_W_MM = 85.6
export const CARD_H_MM = 54

/** White space around the card (as a fraction of card width) so the banner can overhang it. */
export const PAD_RATIO = 0.14

export interface RenderedCard {
  canvas: HTMLCanvasElement
  /** Width of the card itself in pixels (canvas is wider because of padding). */
  cardPx: number
}

/**
 * Render a card photo onto a white canvas: fit to card aspect ratio (cover),
 * round the corners, then burn the watermark into the pixels.
 */
export function renderCard(
  photo: HTMLCanvasElement,
  watermark: WatermarkOptions,
  cardPx: number,
): RenderedCard {
  const cardW = cardPx
  const cardH = Math.round((cardPx * CARD_H_MM) / CARD_W_MM)
  const pad = Math.round(cardW * PAD_RATIO)

  const canvas = document.createElement('canvas')
  canvas.width = cardW + pad * 2
  canvas.height = cardH + pad * 2
  const ctx = ctx2d(canvas)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Cover-fit the photo into the card rectangle.
  const scale = Math.max(cardW / photo.width, cardH / photo.height)
  const sw = cardW / scale
  const sh = cardH / scale
  const sx = (photo.width - sw) / 2
  const sy = (photo.height - sh) / 2

  ctx.save()
  ctx.beginPath()
  ctx.roundRect(pad, pad, cardW, cardH, cardW * 0.035)
  ctx.clip()
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(photo, sx, sy, sw, sh, pad, pad, cardW, cardH)
  ctx.restore()

  drawWatermark(ctx, { x: pad, y: pad, w: cardW, h: cardH }, watermark)

  return { canvas, cardPx: cardW }
}
