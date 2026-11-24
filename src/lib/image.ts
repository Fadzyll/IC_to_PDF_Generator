/**
 * Thrown when the browser refuses to give us a canvas. iPhone Safari has a hard
 * limit on total canvas memory, and returns null instead of a context past it.
 */
export class CanvasMemoryError extends Error {
  constructor() {
    super('Not enough memory for image processing')
    this.name = 'CanvasMemoryError'
  }
}

/** getContext('2d') that fails loudly (and recognisably) instead of returning null. */
export function ctx2d(canvas: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', opts)
  if (!ctx) throw new CanvasMemoryError()
  return ctx
}

/** Max long-edge size we keep in memory. Plenty for print, keeps phones fast. */
const MAX_EDGE = 2000

/**
 * Load a photo from a file input, apply EXIF orientation and downscale it.
 * Everything happens locally in the browser; nothing is uploaded.
 */
export async function loadImage(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    return toCanvas(bitmap, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}

/** Copy any drawable (bitmap, video frame) into a canvas, downscaled to MAX_EDGE. */
export function toCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = ctx2d(canvas)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** Rotate a canvas 180°, returning a new canvas. */
export function rotate180(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = src.width
  out.height = src.height
  const ctx = ctx2d(out)
  ctx.translate(out.width, out.height)
  ctx.rotate(Math.PI)
  ctx.drawImage(src, 0, 0)
  return out
}

/** Wipe a canvas's pixels and shrink it so the browser can free the memory. */
export function wipe(canvas: HTMLCanvasElement | null | undefined) {
  if (!canvas) return
  canvas.width = 0
  canvas.height = 0
}

/** Rotate a canvas clockwise by 90, 180 or 270 degrees, returning a new canvas. */
export function rotateCanvas(src: HTMLCanvasElement, deg: 90 | 180 | 270): HTMLCanvasElement {
  const out = document.createElement('canvas')
  const quarter = deg !== 180
  out.width = quarter ? src.height : src.width
  out.height = quarter ? src.width : src.height
  const ctx = ctx2d(out)
  ctx.translate(out.width / 2, out.height / 2)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return out
}

/** Encode a canvas (JPEG by default). Safari returns null when out of canvas memory. */
export function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.9, type = 'image/jpeg'): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new CanvasMemoryError())), type, quality),
  )
}

/** Decode an image blob into a canvas, optionally downscaled so its long edge is at most `maxEdge`. */
export async function blobToCanvas(blob: Blob, maxEdge = Infinity): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob)
  try {
    const s = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(bitmap.width * s))
    c.height = Math.max(1, Math.round(bitmap.height * s))
    const ctx = ctx2d(c)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, c.width, c.height)
    return c
  } finally {
    bitmap.close()
  }
}

/** A downscaled copy of a canvas (long edge at most `maxEdge`). */
export function scaledCopy(src: HTMLCanvasElement, maxEdge: number): HTMLCanvasElement {
  const s = Math.min(1, maxEdge / Math.max(src.width, src.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(src.width * s))
  c.height = Math.max(1, Math.round(src.height * s))
  const ctx = ctx2d(c)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, c.width, c.height)
  return c
}
