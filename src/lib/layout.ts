import { CARD_W_MM } from './card'

export type CardSize = 'enlarged' | 'actual'

/** Card width on the page, in mm. */
export const CARD_WIDTH_MM: Record<CardSize, number> = {
  enlarged: 130,
  actual: CARD_W_MM,
}

export const A4_MM = { w: 210, h: 297 }
/** Vertical centres of the front and back cards, as fractions of page height. */
export const CARD_CENTERS = [0.28, 0.72] as const
