import { PDFDocument } from 'pdf-lib'
import { applyFilter, type FilterId } from './filters'
import { blobToCanvas, CanvasMemoryError, canvasToBlob, ctx2d, wipe } from './image'
import type { Page } from './pages'
import { drawWatermark, type WatermarkOptions } from './watermark'

export type PageSize = 'a4' | 'letter' | 'fit'
export type Margin = 'none' | 'small' | 'large'
export type Quality = 'small' | 'balanced' | 'high'

export interface PagesPdfOptions {
  pageSize: PageSize
  margin: Margin
  quality: Quality
  filter: FilterId
  watermark: WatermarkOptions | null
}

const MM = 72 / 25.4
/** Portrait page sizes, in points. */
const SIZES: Record<Exclude<PageSize, 'fit'>, [number, number]> = {
  a4: [210 * MM, 297 * MM],
  letter: [612, 792],
}
const MARGINS: Record<Margin, number> = { none: 0, small: 10 * MM, large: 20 * MM }
/** Long-edge pixels and JPEG quality for each quality setting. */
export const QUALITY: Record<Quality, { edge: number; jpeg: number }> = {
  small: { edge: 1200, jpeg: 0.7 },
  balanced: { edge: 1600, jpeg: 0.82 },
  high: { edge: 2000, jpeg: 0.92 },
}

/** Page image bytes for the PDF: filtered, watermarked and resized as needed. */
async function pageJpeg(page: Page, opts: PagesPdfOptions, edge: number, jpeg: number): Promise<Uint8Array> {
  // Fast path: nothing to change, so reuse the stored JPEG as is.
  if (opts.filter === 'original' && !opts.watermark && Math.max(page.w, page.h) <= edge) {
    return new Uint8Array(await page.image.arrayBuffer())
  }
  const src = await blobToCanvas(page.image, edge)
  let out = src
  try {
    out = applyFilter(src, opts.filter, 'document')
    if (opts.watermark) drawWatermark(ctx2d(out), { x: 0, y: 0, w: out.width, h: out.height }, opts.watermark)
    return new Uint8Array(await (await canvasToBlob(out, jpeg)).arrayBuffer())
  } finally {
    wipe(src)
    if (out !== src) wipe(out)
  }
}

/**
 * Build a multi-page PDF. Pages are processed one at a time (and their
 * canvases freed right away) so even long documents fit in phone memory.
 */
export async function buildPagesPdf(
  pages: Page[],
  opts: PagesPdfOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle('Scanned document')
  doc.setProducer('ScanGo PDF')
  doc.setCreator('ScanGo PDF')
  const { edge, jpeg } = QUALITY[opts.quality]
  const margin = MARGINS[opts.margin]

  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i, pages.length)
    const p = pages[i]
    let bytes: Uint8Array
    try {
      bytes = await pageJpeg(p, opts, edge, jpeg)
    } catch (e) {
      // Out of image memory (typically iPhone Safari): retry this page smaller.
      if (!(e instanceof CanvasMemoryError)) throw e
      bytes = await pageJpeg(p, opts, Math.round(edge * 0.6), jpeg)
    }
    const img = await doc.embedJpg(bytes)
    const landscape = p.w > p.h

    // Page size: a standard sheet turned to match the photo, or the photo's own shape.
    let pw: number
    let ph: number
    if (opts.pageSize === 'fit') {
      const long = SIZES.a4[1]
      const ratio = p.w / p.h
      ;[pw, ph] = landscape ? [long, long / ratio] : [long * ratio, long]
      pw += margin * 2
      ph += margin * 2
    } else {
      const [w, h] = SIZES[opts.pageSize]
      ;[pw, ph] = landscape ? [h, w] : [w, h]
    }
    const page = doc.addPage([pw, ph])
    const boxW = pw - margin * 2
    const boxH = ph - margin * 2
    const s = Math.min(boxW / p.w, boxH / p.h)
    const w = p.w * s
    const h = p.h * s
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h })
  }
  onProgress?.(pages.length, pages.length)
  return doc.save()
}
