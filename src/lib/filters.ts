/**
 * Scanner-style image filters (like CamScanner's), applied to the
 * straightened card. All processing is local, on canvas pixels.
 */

export type FilterId = 'original' | 'enhance' | 'magic' | 'gray' | 'bw'

export const FILTERS: { id: FilterId; label: string; hint: string }[] = [
  { id: 'original', label: 'Original', hint: 'No changes' },
  { id: 'enhance', label: 'Auto enhance', hint: 'Fix colour, contrast and sharpness' },
  { id: 'magic', label: 'Magic colour', hint: 'Remove shadows, brighter and more vivid' },
  { id: 'gray', label: 'Grayscale', hint: 'Black and white photo' },
  { id: 'bw', label: 'B&W', hint: 'Photocopy look' },
]

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

export function applyFilter(src: HTMLCanvasElement, id: FilterId): HTMLCanvasElement {
  if (id === 'original') return src
  const w = src.width
  const h = src.height
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  ctx.drawImage(src, 0, 0)
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data

  switch (id) {
    case 'enhance':
      levels(d, true, 0.005)
      saturate(d, 1.15)
      sharpen(d, w, h, 0.6)
      break
    case 'magic':
      flattenLighting(d, w, h)
      levels(d, false, 0.003)
      saturate(d, 1.35)
      sharpen(d, w, h, 0.8)
      break
    case 'gray':
      toGray(d)
      levels(d, false, 0.005)
      sharpen(d, w, h, 0.5)
      break
    case 'bw':
      threshold(d, w, h)
      break
  }
  ctx.putImageData(img, 0, 0)
  return out
}

/** Value at percentile `p` of a 256-bin histogram with `n` samples. */
function percentile(hist: Uint32Array, n: number, p: number) {
  const target = n * p
  let acc = 0
  for (let i = 0; i < 256; i++) {
    acc += hist[i]
    if (acc >= target) return i
  }
  return 255
}

/**
 * Auto levels: stretch so the darkest/brightest `clip` fraction maps to 0/255.
 * Per channel (also corrects colour casts) or on brightness only.
 */
function levels(d: Uint8ClampedArray, perChannel: boolean, clip: number) {
  const n = d.length / 4
  const hists = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]
  for (let i = 0; i < d.length; i += 4) {
    hists[0][d[i]]++
    hists[1][d[i + 1]]++
    hists[2][d[i + 2]]++
    hists[3][Math.round(lum(d[i], d[i + 1], d[i + 2]))]++
  }
  const range = (hst: Uint32Array) => {
    const lo = percentile(hst, n, clip)
    const hi = percentile(hst, n, 1 - clip)
    // Don't over-stretch an image that's genuinely low contrast.
    return hi - lo < 40 ? [lo, lo + 40] : [lo, hi]
  }
  const luts = (perChannel ? [0, 1, 2].map((k) => range(hists[k])) : [0, 1, 2].map(() => range(hists[3]))).map(([lo, hi]) => {
    const lut = new Uint8ClampedArray(256)
    for (let v = 0; v < 256; v++) lut[v] = ((v - lo) * 255) / (hi - lo)
    return lut
  })
  for (let i = 0; i < d.length; i += 4) {
    d[i] = luts[0][d[i]]
    d[i + 1] = luts[1][d[i + 1]]
    d[i + 2] = luts[2][d[i + 2]]
  }
}

function saturate(d: Uint8ClampedArray, s: number) {
  for (let i = 0; i < d.length; i += 4) {
    const l = lum(d[i], d[i + 1], d[i + 2])
    d[i] = clamp(l + (d[i] - l) * s)
    d[i + 1] = clamp(l + (d[i + 1] - l) * s)
    d[i + 2] = clamp(l + (d[i + 2] - l) * s)
  }
}

function toGray(d: Uint8ClampedArray) {
  for (let i = 0; i < d.length; i += 4) {
    const l = lum(d[i], d[i + 1], d[i + 2])
    d[i] = d[i + 1] = d[i + 2] = l
  }
}

/** Unsharp mask with a 3×3 box blur. */
function sharpen(d: Uint8ClampedArray, w: number, h: number, amount: number) {
  const src = new Uint8ClampedArray(d)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4
      for (let k = 0; k < 3; k++) {
        const j = i + k
        const blur =
          (src[j - w * 4 - 4] + src[j - w * 4] + src[j - w * 4 + 4] + src[j - 4] + src[j] + src[j + 4] + src[j + w * 4 - 4] + src[j + w * 4] + src[j + w * 4 + 4]) / 9
        d[j] = clamp(src[j] + (src[j] - blur) * amount)
      }
    }
}

/**
 * Even out uneven lighting and shadows. Estimates how bright the card "should"
 * be everywhere (a smooth envelope of the bright areas) and lifts darker regions
 * towards it, like a scanner's flat lighting.
 */
function flattenLighting(d: Uint8ClampedArray, w: number, h: number) {
  const B = 16 // block size
  const bw = Math.ceil(w / B)
  const bh = Math.ceil(h / B)
  // Brightness envelope: ~90th percentile brightness per block (robust to glare).
  let env = new Float32Array(bw * bh)
  const vals: number[] = []
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      vals.length = 0
      for (let y = by * B; y < Math.min(h, (by + 1) * B); y += 2)
        for (let x = bx * B; x < Math.min(w, (bx + 1) * B); x += 2) {
          const i = (y * w + x) * 4
          vals.push(lum(d[i], d[i + 1], d[i + 2]))
        }
      vals.sort((a, b) => a - b)
      env[by * bw + bx] = vals[Math.floor(vals.length * 0.9)] ?? 255
    }
  // Max filter (ignore dark text/photos), then smooth.
  const pass = (fn: (vals: number[]) => number, r: number) => {
    const t = new Float32Array(bw * bh)
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const v: number[] = []
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const yy = Math.min(bh - 1, Math.max(0, y + dy))
            const xx = Math.min(bw - 1, Math.max(0, x + dx))
            v.push(env[yy * bw + xx])
          }
        t[y * bw + x] = fn(v)
      }
    env = t
  }
  pass((v) => Math.max(...v), 2)
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
  pass(mean, 3)
  pass(mean, 3)

  // Lift each pixel by target / envelope (bilinear-interpolated), capped.
  const target = 238
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bh - 1, Math.max(0, y / B - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(bh - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1, Math.max(0, x / B - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(bw - 1, x0 + 1)
      const tx = fx - x0
      const e =
        (env[y0 * bw + x0] * (1 - tx) + env[y0 * bw + x1] * tx) * (1 - ty) +
        (env[y1 * bw + x0] * (1 - tx) + env[y1 * bw + x1] * tx) * ty
      const gain = Math.min(1.8, Math.max(1, target / Math.max(1, e)))
      const i = (y * w + x) * 4
      d[i] = clamp(d[i] * gain)
      d[i + 1] = clamp(d[i + 1] * gain)
      d[i + 2] = clamp(d[i + 2] * gain)
    }
  }
}

/** Adaptive threshold (Bradley): black where a pixel is clearly darker than its surroundings. */
function threshold(d: Uint8ClampedArray, w: number, h: number) {
  const L = new Float32Array(w * h)
  for (let i = 0, j = 0; i < L.length; i++, j += 4) L[i] = lum(d[j], d[j + 1], d[j + 2])
  // Integral image for fast local means.
  const S = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += L[y * w + x]
      S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row
    }
  }
  const r = Math.max(8, Math.round(w / 32))
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w, x + r + 1)
      const sum = S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0]
      const mean = sum / ((x1 - x0) * (y1 - y0))
      const v = L[y * w + x] < mean * 0.86 ? 0 : 255
      const j = (y * w + x) * 4
      d[j] = d[j + 1] = d[j + 2] = v
    }
  }
}
