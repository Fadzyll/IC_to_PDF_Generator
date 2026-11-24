import { detectCard } from './detect'
import { applyFilter, type FilterId } from './filters'
import { blobToCanvas, canvasToBlob, ctx2d, rotateCanvas, scaledCopy, wipe } from './image'
import { warpCard, warpSize, type Quad } from './perspective'
import { drawWatermark, type WatermarkOptions } from './watermark'

/**
 * One page of a Picture-to-PDF document. Images are kept as compressed JPEG
 * blobs (not canvases) so dozens of pages fit in an iPhone's memory; canvases
 * only exist briefly while a page is being processed.
 */
export type Rotation = 0 | 90 | 180 | 270

export interface Page {
  id: string
  /** Bumped whenever the page's image changes (for thumbnail caching). */
  rev: number
  /** The photo as taken (downscaled), kept so the crop can be edited again. */
  source: Blob
  /** Crop corners in `source` pixels, or null for the whole photo. */
  quad: Quad | null
  rotation: Rotation
  /** Cropped, straightened and rotated result (no filter yet). */
  image: Blob
  w: number
  h: number
  /** Small copy of `image` for thumbnails. */
  thumbBase: Blob
}

export const PAGE_MAX_EDGE = 2000
const THUMB_EDGE = 360

let nextId = 1
const newId = () => `p${Date.now().toString(36)}${(nextId++).toString(36)}`

/** Crop + straighten + rotate a source canvas into the page image and its thumbnail. */
async function render(
  src: HTMLCanvasElement,
  quad: Quad | null,
  rotation: Rotation,
): Promise<Pick<Page, 'image' | 'w' | 'h' | 'thumbBase'>> {
  const temps: HTMLCanvasElement[] = []
  try {
    let img = src
    if (quad) {
      const { w, h } = warpSize(quad, PAGE_MAX_EDGE)
      img = warpCard(src, quad, w, h)
      temps.push(img)
    }
    if (rotation) {
      img = rotateCanvas(img, rotation)
      temps.push(img)
    }
    const image = await canvasToBlob(img, 0.92)
    const thumb = scaledCopy(img, THUMB_EDGE)
    temps.push(thumb)
    const thumbBase = await canvasToBlob(thumb, 0.85)
    return { image, w: img.width, h: img.height, thumbBase }
  } finally {
    temps.forEach(wipe)
  }
}

/** Make a page from a photo. `src` stays owned by the caller. */
export async function createPage(src: HTMLCanvasElement, autoCrop: boolean): Promise<Page> {
  const quad = autoCrop ? detectCard(src, undefined, 'document') : null
  const source = await canvasToBlob(src, 0.9)
  return { id: newId(), rev: 1, source, quad, rotation: 0, ...(await render(src, quad, 0)) }
}

/** Re-render a page after its crop or rotation changed. */
export async function updatePage(page: Page, changes: { quad?: Quad | null; rotation?: Rotation }): Promise<Page> {
  const next = { ...page, ...changes }
  const src = await blobToCanvas(page.source)
  try {
    return { ...next, rev: page.rev + 1, ...(await render(src, next.quad, next.rotation)) }
  } finally {
    wipe(src)
  }
}

/** Thumbnail with the filter (and optional watermark) applied, as an object URL. */
export async function thumbnailUrl(page: Page, filter: FilterId, watermark: WatermarkOptions | null): Promise<string> {
  const base = await blobToCanvas(page.thumbBase)
  let out = base
  try {
    out = applyFilter(base, filter, 'document')
    if (watermark) drawWatermark(ctx2d(out), { x: 0, y: 0, w: out.width, h: out.height }, watermark)
    return URL.createObjectURL(await canvasToBlob(out, 0.85))
  } finally {
    wipe(base)
    if (out !== base) wipe(out)
  }
}
