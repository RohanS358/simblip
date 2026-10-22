// Photo → binary ink mask (phase S5). Plain arrays, no DOM, no OpenCV: a ~8 MB WASM build was not worth
// it for what this needs (plan, Section 8: "prefer hand-written"), and it runs in the reader worker.
//
//   RGBA ─▶ grey ─▶ downscale ─▶ adaptive threshold (uneven light, shadows) ─▶ despeckle ─▶ thin (1 px skeleton)
//
// Lines in a photographed or scanned diagram are dark on light paper, but the paper is rarely evenly lit,
// so a pixel is ink when it is clearly darker than ITS NEIGHBOURHOOD, not than a global cut-off.

export interface RgbaImage {
  data: ArrayLike<number>
  width: number
  height: number
}

export interface Mask {
  w: number
  h: number
  /** 1 = ink. */
  px: Uint8Array
}

/** Longest side the reader works at: symbols then land at about the size people draw them on the canvas. */
export const MAX_SIDE = 900

export function toGrey(img: RgbaImage): Float32Array {
  const n = img.width * img.height
  const g = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = (img.data[4 * i + 3] ?? 255) / 255
    // transparent pixels count as white paper
    g[i] = (0.299 * img.data[4 * i] + 0.587 * img.data[4 * i + 1] + 0.114 * img.data[4 * i + 2]) * a + 255 * (1 - a)
  }
  return g
}

/** Box-average downscale so the longest side is at most `max`. Returns the grey image and the scale used (≤ 1). */
export function downscale(grey: Float32Array, w: number, h: number, max = MAX_SIDE): { grey: Float32Array; w: number; h: number; scale: number } {
  const scale = Math.min(1, max / Math.max(w, h))
  if (scale >= 1) return { grey, w, h, scale: 1 }
  const nw = Math.max(1, Math.round(w * scale))
  const nh = Math.max(1, Math.round(h * scale))
  const out = new Float32Array(nw * nh)
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor(y / scale)
    const y1 = Math.max(y0 + 1, Math.min(h, Math.floor((y + 1) / scale)))
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x / scale)
      const x1 = Math.max(x0 + 1, Math.min(w, Math.floor((x + 1) / scale)))
      let s = 0
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) s += grey[yy * w + xx]
      out[y * nw + x] = s / ((y1 - y0) * (x1 - x0))
    }
  }
  return { grey: out, w: nw, h: nh, scale }
}

/** Mean-based adaptive threshold through an integral image: ink = clearly darker than the local mean. */
export function threshold(grey: Float32Array, w: number, h: number): Mask {
  const win = Math.max(15, Math.round(Math.max(w, h) / 14)) | 1
  const half = win >> 1
  const integral = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += grey[y * w + x]
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + row
    }
  }
  const px = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half)
    const y1 = Math.min(h, y + half + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half)
      const x1 = Math.min(w, x + half + 1)
      const sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0]
      const mean = sum / ((x1 - x0) * (y1 - y0))
      // darker than the neighbourhood by a margin that scales with how bright it is, and not merely grey paper
      if (grey[y * w + x] < mean - Math.max(14, 0.18 * mean) && grey[y * w + x] < 200) px[y * w + x] = 1
    }
  }
  return { w, h, px }
}

const N8: Array<[number, number]> = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]

/** Drop connected specks smaller than `minPx` pixels (paper grain, dust). Returns how many were removed. */
export function despeckle(m: Mask, minPx: number): number {
  const { w, h, px } = m
  const seen = new Uint8Array(w * h)
  let removed = 0
  const stack: number[] = []
  for (let s = 0; s < w * h; s++) {
    if (!px[s] || seen[s]) continue
    const comp: number[] = []
    stack.push(s)
    seen[s] = 1
    while (stack.length) {
      const p = stack.pop()!
      comp.push(p)
      const x = p % w
      const y = (p / w) | 0
      for (const [dx, dy] of N8) {
        const xx = x + dx
        const yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const q = yy * w + xx
        if (px[q] && !seen[q]) { seen[q] = 1; stack.push(q) }
      }
    }
    if (comp.length < minPx) { for (const p of comp) px[p] = 0; removed++ }
  }
  return removed
}

/** Euclidean-ish distance (chamfer 3-4) from each ink pixel to the nearest background pixel, in pixels. */
export function distanceTransform(m: Mask): Float32Array {
  const { w, h, px } = m
  const d = new Float32Array(w * h)
  const BIG = 1e9
  for (let i = 0; i < w * h; i++) d[i] = px[i] ? BIG : 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!px[i]) continue
      let v = d[i]
      if (x > 0) v = Math.min(v, d[i - 1] + 1)
      if (y > 0) v = Math.min(v, d[i - w] + 1)
      if (x > 0 && y > 0) v = Math.min(v, d[i - w - 1] + 1.4142)
      if (x < w - 1 && y > 0) v = Math.min(v, d[i - w + 1] + 1.4142)
      d[i] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (!px[i]) continue
      let v = d[i]
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1)
      if (y < h - 1) v = Math.min(v, d[i + w] + 1)
      if (x < w - 1 && y < h - 1) v = Math.min(v, d[i + w + 1] + 1.4142)
      if (x > 0 && y < h - 1) v = Math.min(v, d[i + w - 1] + 1.4142)
      d[i] = v
    }
  }
  // pixels on the image border count as touching background
  for (let i = 0; i < w * h; i++) if (px[i] && d[i] >= BIG) d[i] = 1
  return d
}

/** Zhang–Suen thinning: reduce every stroke to a 1-pixel-wide centre line, in place. */
export function thin(m: Mask): void {
  const { w, h, px } = m
  const del: number[] = []
  let changed = true
  let guard = 0
  while (changed && guard++ < 200) {
    changed = false
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x
          if (!px[i]) continue
          const p2 = px[i - w], p3 = px[i - w + 1], p4 = px[i + 1], p5 = px[i + w + 1]
          const p6 = px[i + w], p7 = px[i + w - 1], p8 = px[i - 1], p9 = px[i - w - 1]
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (B < 2 || B > 6) continue
          const A = (!p2 && p3 ? 1 : 0) + (!p3 && p4 ? 1 : 0) + (!p4 && p5 ? 1 : 0) + (!p5 && p6 ? 1 : 0) + (!p6 && p7 ? 1 : 0) + (!p7 && p8 ? 1 : 0) + (!p8 && p9 ? 1 : 0) + (!p9 && p2 ? 1 : 0)
          if (A !== 1) continue
          if (pass === 0) { if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue }
          else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue
          del.push(i)
        }
      }
      if (del.length) { changed = true; for (const i of del) px[i] = 0 }
    }
  }
}

export const countInk = (m: Mask): number => {
  let n = 0
  for (let i = 0; i < m.px.length; i++) n += m.px[i]
  return n
}
