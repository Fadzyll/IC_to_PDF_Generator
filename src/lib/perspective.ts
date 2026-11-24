import { ctx2d } from './image'
import { CARD_H_MM, CARD_W_MM } from './card'

export interface Point {
  x: number
  y: number
}
/** Four corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point]

/** Solve A·x = b (n×n) by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    const d = M[c][c] || 1e-12
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / d
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12))
}

/** Homography H (row-major 3×3, h33 = 1) mapping each `from[i]` to `to[i]`. */
export function homography(from: Quad, to: Quad): number[] {
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]
    const { x: u, y: v } = to[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  }
  return [...solve(A, b), 1]
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Put four arbitrary points into TL, TR, BR, BL order, and make sure the long
 * edge of the card comes out on top (a card is always landscape).
 */
export function orderQuad(pts: Point[], landscape = true): Quad {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4
  // Clockwise on screen (y down), starting from the point nearest top-left.
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  let start = 0
  sorted.forEach((p, i) => {
    if (p.x + p.y < sorted[start].x + sorted[start].y) start = i
  })
  let q = [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]) as Quad
  const horiz = dist(q[0], q[1]) + dist(q[2], q[3])
  const vert = dist(q[1], q[2]) + dist(q[3], q[0])
  if (landscape && vert > horiz) {
    // Card was photographed sideways: rotate the order so the long edge is on top.
    q = [q[3], q[0], q[1], q[2]]
  }
  return q
}

/** Edge lengths of a quad: width (avg of top/bottom) and height (avg of left/right). */
export function quadSize(q: Quad): { w: number; h: number } {
  return { w: (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, h: (dist(q[0], q[3]) + dist(q[1], q[2])) / 2 }
}

/** Output size for straightening `q`, keeping its proportions, with the long edge at most `maxEdge`. */
export function warpSize(q: Quad, maxEdge: number): { w: number; h: number } {
  const { w, h } = quadSize(q)
  const s = Math.min(1, maxEdge / Math.max(w, h)) || 1
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}

/** The whole image as a quad. */
export function fullQuad(w: number, h: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
}

/** Output width of a straightened card, in px. */
export const WARP_W = 1600
export const WARP_H = Math.round((WARP_W * CARD_H_MM) / CARD_W_MM)

/**
 * Straighten the card inside `quad` into a flat WARP_W × WARP_H rectangle
 * using a perspective transform with bilinear sampling.
 */
export function warpCard(src: HTMLCanvasElement, quad: Quad, outW = WARP_W, outH = WARP_H): HTMLCanvasElement {
  const sw = src.width
  const sh = src.height
  const sdata = ctx2d(src).getImageData(0, 0, sw, sh).data

  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const octx = ctx2d(out)
  const img = octx.createImageData(outW, outH)
  const o = img.data

  // Map output pixel -> source pixel.
  const dst: Quad = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ]
  const [a, b, c, d, e, f, g, h] = homography(dst, quad)

  let i = 0
  for (let v = 0; v < outH; v++) {
    const vy = v + 0.5
    for (let u = 0; u < outW; u++, i += 4) {
      const ux = u + 0.5
      const w = g * ux + h * vy + 1
      let x = (a * ux + b * vy + c) / w - 0.5
      let y = (d * ux + e * vy + f) / w - 0.5
      if (x < 0) x = 0
      else if (x > sw - 1) x = sw - 1
      if (y < 0) y = 0
      else if (y > sh - 1) y = sh - 1
      const x0 = x | 0
      const y0 = y | 0
      const x1 = x0 < sw - 1 ? x0 + 1 : x0
      const y1 = y0 < sh - 1 ? y0 + 1 : y0
      const fx = x - x0
      const fy = y - y0
      const p00 = (y0 * sw + x0) * 4
      const p10 = (y0 * sw + x1) * 4
      const p01 = (y1 * sw + x0) * 4
      const p11 = (y1 * sw + x1) * 4
      for (let k = 0; k < 3; k++) {
        const top = sdata[p00 + k] + (sdata[p10 + k] - sdata[p00 + k]) * fx
        const bot = sdata[p01 + k] + (sdata[p11 + k] - sdata[p01 + k]) * fx
        o[i + k] = top + (bot - top) * fy
      }
      o[i + 3] = 255
    }
  }
  octx.putImageData(img, 0, 0)
  return out
}

/** A default quad inset from the image edges, shaped like a card. */
export function defaultQuad(w: number, h: number): Quad {
  const ratio = CARD_W_MM / CARD_H_MM
  let qw = w * 0.84
  let qh = qw / ratio
  if (qh > h * 0.84) {
    qh = h * 0.84
    qw = qh * ratio
  }
  const x = (w - qw) / 2
  const y = (h - qh) / 2
  return [
    { x, y },
    { x: x + qw, y },
    { x: x + qw, y: y + qh },
    { x, y: y + qh },
  ]
}
