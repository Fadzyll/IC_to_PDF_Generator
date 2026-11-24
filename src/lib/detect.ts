import { ctx2d } from './image'
import { CARD_H_MM, CARD_W_MM } from './card'
import { orderQuad, type Point, type Quad } from './perspective'

/**
 * Lightweight card edge detector (no OpenCV):
 *   1. downscale + grayscale + blur
 *   2. Sobel edges
 *   3. Hough transform voting along each edge's gradient direction
 *   4. try pairs of near-horizontal and near-vertical lines, keep the
 *      card-shaped quadrilateral whose edges are best supported by real edges.
 * Returns corners in source-pixel coordinates, or null if nothing convincing.
 */

const WORK = 400 // working size (long edge), px

interface Line {
  theta: number // radians, normal direction
  rho: number
  votes: number
}

/**
 * 'card': an ID-1 card (fixed 85.6 × 54 proportions, always landscape).
 * 'document': a page, receipt or note: any reasonable proportions, any orientation.
 */
export type DetectShape = 'card' | 'document'

export function detectCard(src: HTMLCanvasElement, region?: Quad, shape: DetectShape = 'card'): Quad | null {
  const isCard = shape === 'card'
  const scale = Math.min(1, WORK / Math.max(src.width, src.height))
  const w = Math.max(8, Math.round(src.width * scale))
  const h = Math.max(8, Math.round(src.height * scale))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = ctx2d(c, { willReadFrequently: true })
  ctx.drawImage(src, 0, 0, w, h)
  const rgba = ctx.getImageData(0, 0, w, h).data
  c.width = c.height = 0 // pixels copied out; free the scratch canvas

  // Per-channel copies, blurred twice with a 3×3 box (edges clamped, so the
  // photo's border doesn't turn into a fake edge).
  const N = w * h
  const ch = [0, 1, 2].map((k) => {
    let g = new Float32Array(N)
    for (let i = 0; i < N; i++) g[i] = rgba[i * 4 + k]
    for (let pass = 0; pass < 2; pass++) {
      const t = new Float32Array(N)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let s = 0
          for (let dy = -1; dy <= 1; dy++) {
            const yy = Math.min(h - 1, Math.max(0, y + dy)) * w
            for (let dx = -1; dx <= 1; dx++) s += g[yy + Math.min(w - 1, Math.max(0, x + dx))]
          }
          t[y * w + x] = s / 9
        }
      g = t
    }
    return g
  })

  // Sobel on each colour channel; keep the strongest. Colour edges matter:
  // a blue card on a beige table has little brightness contrast.
  const mag = new Float32Array(N)
  const ang = new Float32Array(N)
  const B = 4 // ignore a thin border
  for (let y = B; y < h - B; y++)
    for (let x = B; x < w - B; x++) {
      const i = y * w + x
      for (const g of ch) {
        const gx = g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1]
        const gy = g[i + w - 1] + 2 * g[i + w] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - w] - g[i - w + 1]
        const m = Math.hypot(gx, gy)
        if (m > mag[i]) {
          mag[i] = m
          ang[i] = Math.atan2(gy, gx)
        }
      }
    }

  const sample = Array.from(mag).filter((v) => v > 0).sort((a, b) => a - b)
  if (sample.length < 50) return null

  // Edge threshold: start strict (top 12% of gradients) and relax it if nothing
  // is found. Strong text edges on the card can otherwise drown out a faint
  // card border, e.g. a light card on a light table.
  // Prefer four real edges at any threshold before inferring a missing one.
  // (Inferring a missing edge needs known proportions, so only for cards.)
  for (const inferMissing of isCard ? [false, true] : [false]) {
    for (const pct of [0.88, 0.75, 0.6]) {
      const q = findQuad(Math.max(30, sample[Math.floor(sample.length * pct)]), inferMissing)
      if (q) {
        // Pull corners ~0.7% towards the centre so no background sliver shows.
        const cx = q.reduce((s, p) => s + p.x, 0) / 4
        const cy = q.reduce((s, p) => s + p.y, 0) / 4
        return q.map((p) => ({
          x: Math.min(src.width, Math.max(0, (p.x + (cx - p.x) * 0.007) / scale)),
          y: Math.min(src.height, Math.max(0, (p.y + (cy - p.y) * 0.007) / scale)),
        })) as Quad
      }
    }
  }
  return null

  function findQuad(thr: number, inferMissing: boolean): Quad | null {
    const isEdge = (x: number, y: number) => {
      const xi = Math.round(x)
      const yi = Math.round(y)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = xi + dx
          const yy = yi + dy
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && mag[yy * w + xx] >= thr) return true
        }
      return false
    }

    /**
     * Colour difference across an edge (p→q, clockwise): compares pixels a few px
     * inside the quad with pixels a few px outside. A real card edge has the card
     * on one side and the background on the other; a texture line (wood grain,
     * table edge) usually has similar colours on both sides.
     */
    const contrast = (p: Point, q: Point): { diff: number; spread: number } => {
      const len = Math.hypot(q.x - p.x, q.y - p.y)
      const nx = -(q.y - p.y) / len // inward normal
      const ny = (q.x - p.x) / len
      const off = 4
      let sum = 0
      let outside = 0
      const inner: number[][] = []
      // Skip the ends: card corners are rounded.
      for (let k = 2; k < 19; k++) {
        const t = k / 20
        const x = p.x + (q.x - p.x) * t
        const y = p.y + (q.y - p.y) * t
        const xi = Math.round(x + nx * off)
        const yi = Math.round(y + ny * off)
        const xo = Math.round(x - nx * off)
        const yo = Math.round(y - ny * off)
        if (xo < 0 || yo < 0 || xo >= w || yo >= h || xi < 0 || yi < 0 || xi >= w || yi >= h) {
          outside++
          continue
        }
        const a = yi * w + xi
        const b = yo * w + xo
        sum += Math.hypot(ch[0][a] - ch[0][b], ch[1][a] - ch[1][b], ch[2][a] - ch[2][b])
        inner.push([ch[0][a], ch[1][a], ch[2][a]])
      }
      const n = inner.length
      // Edge runs along the photo border: no way to tell, assume it's fine.
      if (n < 5) return outside > 8 ? { diff: 40, spread: 0 } : { diff: 0, spread: 0 }
      // How much the colour just inside the edge varies (a real card edge has
      // the card all along its inside; a wrong line crosses card and background).
      const mean = [0, 1, 2].map((k) => inner.reduce((s, c) => s + c[k], 0) / n)
      const spread = inner.reduce((s, c) => s + Math.hypot(c[0] - mean[0], c[1] - mean[1], c[2] - mean[2]), 0) / n
      return { diff: sum / n, spread }
    }

    // Hough: theta in [0, 180) degrees, voting ±3° around each pixel's gradient angle.
    const T = 180
    const R = Math.ceil(Math.hypot(w, h))
    const RB = 2 * R + 1
    const acc = new Float32Array(T * RB)
    const cos = new Float32Array(T)
    const sin = new Float32Array(T)
    for (let t = 0; t < T; t++) {
      cos[t] = Math.cos((t * Math.PI) / 180)
      sin[t] = Math.sin((t * Math.PI) / 180)
    }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (mag[i] < thr) continue
        let deg = Math.round((ang[i] * 180) / Math.PI)
        deg = ((deg % 180) + 180) % 180
        for (let dt = -3; dt <= 3; dt++) {
          const t = (deg + dt + T) % T
          const r = Math.round(x * cos[t] + y * sin[t]) + R
          acc[t * RB + r] += 1
        }
      }

    // Peak picking with non-maximum suppression.
    const peaks: Line[] = []
    const minVotes = Math.min(w, h) * 0.15
    for (let t = 0; t < T; t++)
      for (let r = 0; r < RB; r++) {
        const v = acc[t * RB + r]
        if (v < minVotes) continue
        let isMax = true
        for (let dt = -4; dt <= 4 && isMax; dt++)
          for (let dr = -6; dr <= 6; dr++) {
            if (!dt && !dr) continue
            const tt = (t + dt + T) % T
            const rr = r + dr
            if (rr < 0 || rr >= RB) continue
            if (acc[tt * RB + rr] > v || (acc[tt * RB + rr] === v && (dt < 0 || (dt === 0 && dr < 0)))) {
              isMax = false
              break
            }
          }
        if (isMax) peaks.push({ theta: (t * Math.PI) / 180, rho: r - R, votes: v })
      }
    peaks.sort((a, b) => b.votes - a.votes)

    // Split into near-horizontal (normal ~90°) and near-vertical (normal ~0°/180°) lines.
    const horiz: Line[] = []
    const vert: Line[] = []
    for (const p of peaks) {
      const deg = (p.theta * 180) / Math.PI
      if (deg >= 55 && deg <= 125) {
        if (horiz.length < 14) horiz.push(p)
      }
      else if (deg <= 35 || deg >= 145) {
        // Normalise to theta in (-35°, 35°) so lines sort left-to-right by rho.
        const l = deg >= 145 ? { theta: p.theta - Math.PI, rho: -p.rho, votes: p.votes } : p
        if (vert.length < 14) vert.push(l)
      }
    }
    // Need at least 3 lines (the 4th can be inferred, see the fallback below).
    if (!horiz.length || !vert.length || horiz.length + vert.length < (inferMissing ? 3 : 4)) return null

    const intersect = (a: Line, b: Line): Point | null => {
      const det = Math.cos(a.theta) * Math.sin(b.theta) - Math.sin(a.theta) * Math.cos(b.theta)
      if (Math.abs(det) < 1e-6) return null
      return {
        x: (a.rho * Math.sin(b.theta) - b.rho * Math.sin(a.theta)) / det,
        y: (b.rho * Math.cos(a.theta) - a.rho * Math.cos(b.theta)) / det,
      }
    }
    const support = (p: Point, q: Point) => {
      const n = Math.max(8, Math.round(Math.hypot(q.x - p.x, q.y - p.y) / 2))
      let hit = 0
      for (let k = 0; k <= n; k++) if (isEdge(p.x + ((q.x - p.x) * k) / n, p.y + ((q.y - p.y) * k) / n)) hit++
      return hit / (n + 1)
    }

    const cardRatio = CARD_W_MM / CARD_H_MM
    const margin = 0.03 * Math.max(w, h)
    const regionSmall = region?.map((p) => ({ x: p.x * scale, y: p.y * scale }))
    // A holder object, since `best` is updated inside the evaluate() closure.
    const found: { best: { q: Quad; score: number } | null } = { best: null }

    /**
     * Check a candidate quad and score it. With `oneWeakEdge`, the weakest edge
     * is allowed to be invisible (its corners were inferred from the card's
     * shape), so it's excluded from the checks and the score.
     */
    const evaluate = (pts: (Point | null)[], oneWeakEdge: boolean) => {
      if (pts.some((p) => !p || p.x < -margin || p.y < -margin || p.x > w + margin || p.y > h + margin)) return
      const q = orderQuad(pts as Point[], isCard)
      const top = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y)
      const bot = Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y)
      const left = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y)
      const right = Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y)
      if (Math.min(top, bot, left, right) < Math.min(w, h) * 0.15) return
      // Allow for perspective: opposite edges within 35% of each other.
      if (Math.min(top, bot) / Math.max(top, bot) < 0.65 || Math.min(left, right) / Math.max(left, right) < 0.65) return
      const ratio = (top + bot) / (left + right)
      if (isCard) {
        if (ratio < cardRatio * 0.72 || ratio > cardRatio * 1.35) return
      } else if (Math.max(ratio, 1 / ratio) > 4) {
        return // pages and receipts: anything up to 4:1
      }
      const area = 0.5 * Math.abs(q.reduce((s, p, n) => s + p.x * q[(n + 1) % 4].y - q[(n + 1) % 4].x * p.y, 0))
      // Documents usually fill much of the photo; small rectangles are more likely things printed on it.
      if (area < w * h * (isCard ? 0.08 : 0.15)) return

      const s = [support(q[0], q[1]), support(q[1], q[2]), support(q[2], q[3]), support(q[3], q[0])]
      const cst = [contrast(q[0], q[1]), contrast(q[1], q[2]), contrast(q[2], q[3]), contrast(q[3], q[0])]
      const lens = [top, right, bot, left]
      const quality = lens.map((_, n) => (s[n] * Math.min(1, cst[n].diff / 60)) / (1 + cst[n].spread / 25))
      const weak = oneWeakEdge ? quality.indexOf(Math.min(...quality)) : -1
      const edges = [0, 1, 2, 3].filter((n) => n !== weak)
      if (Math.min(...edges.map((n) => s[n])) < 0.35) return
      if (Math.min(...edges.map((n) => cst[n].diff)) < 14) return
      let score = edges.reduce((sum, n) => sum + lens[n] * quality[n], 0)
      if (oneWeakEdge) score *= 0.7
      // Prefer quads near the camera guide frame, if one was given.
      if (regionSmall) {
        const off = q.reduce((sum, p, n) => sum + Math.hypot(p.x - regionSmall[n].x, p.y - regionSmall[n].y), 0) / 4
        score *= 1 / (1 + off / (0.25 * Math.max(w, h)))
      }
      if (!found.best || score > found.best.score) found.best = { q, score }
    }

    for (let i = 0; i < horiz.length; i++)
      for (let j = i + 1; j < horiz.length; j++)
        for (let k = 0; k < vert.length; k++)
          for (let l = k + 1; l < vert.length; l++)
            evaluate(
              [intersect(horiz[i], vert[k]), intersect(horiz[i], vert[l]), intersect(horiz[j], vert[l]), intersect(horiz[j], vert[k])],
              false,
            )
    if (found.best || !inferMissing) return found.best?.q ?? null

    // Fallback: one edge is invisible (e.g. in shadow against a dark table).
    // A card's proportions are fixed, so infer the missing edge from the other three.
    const along = (l: Line, sign: number): Point => ({ x: -Math.sin(l.theta) * sign, y: Math.cos(l.theta) * sign })
    const step = (p: Point | null, d: Point, len: number) => (p ? { x: p.x + d.x * len, y: p.y + d.y * len } : null)
    for (const sign of [1, -1]) {
      // Two horizontals + one vertical: infer the other vertical.
      for (let i = 0; i < horiz.length; i++)
        for (let j = i + 1; j < horiz.length; j++)
          for (const v of vert) {
            const a = intersect(horiz[i], v)
            const b = intersect(horiz[j], v)
            if (!a || !b) continue
            const len = Math.hypot(a.x - b.x, a.y - b.y) * cardRatio
            const da = along(horiz[i], sign)
            let db = along(horiz[j], sign)
            if (da.x * db.x + da.y * db.y < 0) db = { x: -db.x, y: -db.y }
            evaluate([a, step(a, da, len), step(b, db, len), b], true)
          }
      // Two verticals + one horizontal: infer the other horizontal.
      for (let k = 0; k < vert.length; k++)
        for (let l = k + 1; l < vert.length; l++)
          for (const hz of horiz) {
            const a = intersect(hz, vert[k])
            const b = intersect(hz, vert[l])
            if (!a || !b) continue
            const len = Math.hypot(a.x - b.x, a.y - b.y) / cardRatio
            const da = along(vert[k], sign)
            let db = along(vert[l], sign)
            if (da.x * db.x + da.y * db.y < 0) db = { x: -db.x, y: -db.y }
            evaluate([a, b, step(b, db, len), step(a, da, len)], true)
          }
    }

    return (found.best as { q: Quad } | null)?.q ?? null
  }
}
