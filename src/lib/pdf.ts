import { PDFDocument } from 'pdf-lib'
import { PAD_RATIO, type RenderedCard } from './card'
import { CanvasMemoryError, wipe } from './image'
import { A4_MM, CARD_CENTERS, CARD_WIDTH_MM, type CardSize } from './layout'

const MM_TO_PT = 72 / 25.4

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        // Safari returns null here when it's out of canvas memory.
        if (!blob) return reject(new CanvasMemoryError())
        blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject)
      },
      'image/jpeg',
      0.85,
    )
  })
}

/**
 * Build an A4 PDF with the front card on top and the back card below.
 * Cards are rendered one at a time and freed right after embedding, to keep
 * peak memory low (iPhone Safari has a small canvas memory limit).
 */
export async function buildPdf(renderers: (() => RenderedCard)[], size: CardSize): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle('IC copy')
  doc.setProducer('IC to PDF Generator')
  doc.setCreator('IC to PDF Generator')

  const pageW = A4_MM.w * MM_TO_PT
  const pageH = A4_MM.h * MM_TO_PT
  const page = doc.addPage([pageW, pageH])

  const cardWpt = CARD_WIDTH_MM[size] * MM_TO_PT
  // The rendered canvas includes padding on both sides of the card.
  const imgWpt = cardWpt * (1 + PAD_RATIO * 2)

  for (let i = 0; i < renderers.length; i++) {
    const { canvas } = renderers[i]()
    let jpgBytes: Uint8Array
    const ratio = canvas.height / canvas.width
    try {
      jpgBytes = await canvasToJpeg(canvas)
    } finally {
      wipe(canvas)
    }
    const jpg = await doc.embedJpg(jpgBytes)
    const imgHpt = imgWpt * ratio
    const cx = pageW / 2
    // pdf-lib's origin is bottom-left.
    const cy = pageH * (1 - CARD_CENTERS[i])
    page.drawImage(jpg, { x: cx - imgWpt / 2, y: cy - imgHpt / 2, width: imgWpt, height: imgHpt })
  }

  return doc.save()
}
