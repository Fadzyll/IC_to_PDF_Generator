/** Max long-edge size we keep in memory. Plenty for print, keeps phones fast. */
const MAX_EDGE = 2000

/**
 * Load a photo from a file input, apply EXIF orientation and downscale it.
 * Everything happens locally in the browser; nothing is uploaded.
 */
export async function loadImage(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, w, h)
    // A card is landscape; a portrait photo was almost certainly taken sideways.
    return h > w ? rotate90(canvas) : canvas
  } finally {
    bitmap.close()
  }
}

/** Rotate a canvas 90° clockwise, returning a new canvas. */
export function rotate90(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = src.height
  out.height = src.width
  const ctx = out.getContext('2d')!
  ctx.translate(out.width, 0)
  ctx.rotate(Math.PI / 2)
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
