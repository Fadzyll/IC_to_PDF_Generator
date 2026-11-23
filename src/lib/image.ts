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
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** Rotate a canvas 180°, returning a new canvas. */
export function rotate180(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = src.width
  out.height = src.height
  const ctx = out.getContext('2d')!
  ctx.translate(out.width, out.height)
  ctx.rotate(Math.PI)
  ctx.drawImage(src, 0, 0)
  return out
}

/** Wipe a canvas's pixels and shrink it so the browser can free the memory. */
export function wipe(canvas: HTMLCanvasElement | null | undefined) {
  if (!canvas) return
  canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  canvas.width = 0
  canvas.height = 0
}
