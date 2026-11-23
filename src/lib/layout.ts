import { CARD_W_MM } from './card'

export type CardSize = 'enlarged' | 'actual'

/** Card width on the page, in mm. */
export const CARD_WIDTH_MM: Record<CardSize, number> = {
  enlarged: 130,
  actual: CARD_W_MM,
}

/**
 * Extra watermark size per card size. At actual size the card is small, so the
 * caption needs a bigger share of it to stay readable.
 */
export const WATERMARK_BOOST: Record<CardSize, number> = {
  enlarged: 1,
  actual: 1.3,
}

export const A4_MM = { w: 210, h: 297 }
/** Vertical centres of the front and back cards, as fractions of page height. */
export const CARD_CENTERS = [0.28, 0.72] as const
