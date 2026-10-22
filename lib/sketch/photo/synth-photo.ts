// A SYNTHETIC photo of a drawing, for tests and the evaluation: strokes rendered to pixels, then spoiled the
// way a phone camera spoils a page (uneven light, blur, noise, a slight turn). Labelled synthetic wherever
// it is reported — it says nothing about real photographs.

import type { Rng } from '../rng'
import type { RgbaImage } from './raster'

export interface PhotoOptions {
  /** line width, px */
  width?: number
  /** blur radius (box), px */
  blur?: number
  /** light falls off from one side by this much (0–0.5) */
  shade?: number
  /** noise amplitude, grey levels */
  noise?: number
  /** page tilt, degrees */
  tilt?: number
  margin?: number
  /** render at this multiple of the drawing's size (a higher-resolution photo of the same figure) */
  zoom?: number
}

/** The picture, plus where the drawing's origin went (for scoring against the truth; exact only when tilt is 0). */
export interface SyntheticPhoto extends RgbaImage {
  shiftX: number
  shiftY: number
}

export function renderPhoto(strokes0: number[][][], rng: Rng, o: PhotoOptions = {}): SyntheticPhoto {
  const zoom = o.zoom ?? 1
  const strokes = zoom === 1 ? strokes0 : strokes0.map((s) => s.map(([x, y]) => [x * zoom, y * zoom]))
  const lw = o.width ?? 3
  const margin = o.margin ?? 60
  const tilt = ((o.tilt ?? 0) * Math.PI) / 180
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]) }
  const W = Math.ceil(x1 - x0 + 2 * margin)
  const H = Math.ceil(y1 - y0 + 2 * margin)
  const cx = W / 2
  const cy = H / 2
  const ink = new Float32Array(W * H) // 0..1 darkness
  const stamp = (x: number, y: number) => {
    const r = lw / 2
    for (let yy = Math.floor(y - r - 1); yy <= Math.ceil(y + r + 1); yy++) {
      if (yy < 0 || yy >= H) continue
      for (let xx = Math.floor(x - r - 1); xx <= Math.ceil(x + r + 1); xx++) {
        if (xx < 0 || xx >= W) continue
        const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y)
        const a = Math.max(0, Math.min(1, r + 0.5 - d))
        if (a > ink[yy * W + xx]) ink[yy * W + xx] = a
      }
    }
  }
  for (const s of strokes) {
    const pts = s.map(([x, y]) => {
      const px = x - x0 + margin - cx
      const py = y - y0 + margin - cy
      return [cx + px * Math.cos(tilt) - py * Math.sin(tilt), cy + px * Math.sin(tilt) + py * Math.cos(tilt)]
    })
    for (let i = 0; i < pts.length; i++) {
      stamp(pts[i][0], pts[i][1])
      if (i > 0) {
        const [ax, ay] = pts[i - 1]
        const [bx, by] = pts[i]
        const n = Math.ceil(Math.hypot(bx - ax, by - ay) / (lw / 3))
        for (let k = 1; k < n; k++) stamp(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n)
      }
    }
  }
  // blur (separable box)
  const br = Math.round(o.blur ?? 1)
  let img = ink
  if (br > 0) {
    const tmp = new Float32Array(W * H)
    const out = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0
      for (let k = -br; k <= br; k++) { const xx = x + k; if (xx >= 0 && xx < W) { s += img[y * W + xx]; n++ } }
      tmp[y * W + x] = s / n
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0
      for (let k = -br; k <= br; k++) { const yy = y + k; if (yy >= 0 && yy < H) { s += tmp[yy * W + x]; n++ } }
      out[y * W + x] = s / n
    }
    img = out
  }
  const shade = o.shade ?? 0
  const noise = o.noise ?? 0
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const light = 1 - shade * (x / W) - 0.5 * shade * (y / H)
    const paper = 238 * light
    const v = paper * (1 - 0.85 * img[y * W + x]) + (noise ? rng.gauss() * noise : 0)
    const i = 4 * (y * W + x)
    data[i] = data[i + 1] = data[i + 2] = v
    data[i + 3] = 255
  }
  return { data, width: W, height: H, shiftX: (margin - x0) / zoom, shiftY: (margin - y0) / zoom }
}
