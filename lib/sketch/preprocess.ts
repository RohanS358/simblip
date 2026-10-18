// Strokes → SketchNet input tensors. The ONLY implementation.
//
// Training data is exported by running THIS code over the shards
// (scripts/ai/sketch/export-tensors.mjs), and the browser runs the same code at
// recognition time — so train/serve skew in preprocessing cannot exist by
// construction. (A Python port would have to be kept in step with
// normalizeStrokes/stripLeads forever; this is simply not done.)
//
// Two views of one drawing:
//   image  2 × 32 × 32   channel 0: the whole drawing; channel 1: the body with
//                        the shared horizontal leads stripped (features.ts
//                        stripLeads), re-normalised to fill the frame.
//   seq    64 × 4        the same strokes resampled to 64 points in drawing
//                        order: (x, y, penUp, turn).
//
// Bump PREPROCESS_VERSION whenever any number here changes; the model manifest
// records the version it was trained with and the loader refuses a mismatch.

import { normalizeStrokes, stripLeads, type StrokeSet } from './features'

export const PREPROCESS_VERSION = 1
export const IMG = 32
export const SEQ_LEN = 64
export const SEQ_DIM = 4

const PAD = 2.5 // frame margin, px
const MAX_STROKES = SEQ_LEN / 2

type Pt = number[]

/** Draw anti-aliased ~2 px lines into one 32×32 plane (max-composited). */
function raster(strokes: StrokeSet, out: Float32Array, plane: number): void {
  const base = plane * IMG * IMG
  const span = IMG - 2 * PAD
  const px = (v: number) => (v + 0.5) * span + PAD - 0.5
  const seg = (x0: number, y0: number, x1: number, y1: number) => {
    const ix0 = Math.max(0, Math.floor(Math.min(x0, x1) - 2))
    const ix1 = Math.min(IMG - 1, Math.ceil(Math.max(x0, x1) + 2))
    const iy0 = Math.max(0, Math.floor(Math.min(y0, y1) - 2))
    const iy1 = Math.min(IMG - 1, Math.ceil(Math.max(y0, y1) + 2))
    const dx = x1 - x0
    const dy = y1 - y0
    const l2 = dx * dx + dy * dy
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const t = l2 ? Math.max(0, Math.min(1, ((ix - x0) * dx + (iy - y0) * dy) / l2)) : 0
        const d = Math.hypot(ix - (x0 + dx * t), iy - (y0 + dy * t))
        const v = Math.min(1, Math.max(0, 1.25 - d))
        const i = base + iy * IMG + ix
        if (v > out[i]) out[i] = v
      }
    }
  }
  for (const st of strokes) {
    if (st.length === 1) seg(px(st[0][0]), px(st[0][1]), px(st[0][0]), px(st[0][1]))
    for (let i = 1; i < st.length; i++) seg(px(st[i - 1][0]), px(st[i - 1][1]), px(st[i][0]), px(st[i][1]))
  }
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** `n` points evenly spaced by arclength along one stroke (both ends kept). */
function resampleStroke(st: Pt[], n: number): Pt[] {
  const cum = [0]
  for (let i = 1; i < st.length; i++) cum.push(cum[i - 1] + dist(st[i], st[i - 1]))
  const total = cum[cum.length - 1]
  if (total === 0) return Array.from({ length: n }, () => [st[0][0], st[0][1]])
  const out: Pt[] = []
  let j = 1
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1)
    while (j < st.length - 1 && cum[j] < target) j++
    const span = cum[j] - cum[j - 1] || 1
    const t = Math.min(1, Math.max(0, (target - cum[j - 1]) / span))
    out.push([st[j - 1][0] + (st[j][0] - st[j - 1][0]) * t, st[j - 1][1] + (st[j][1] - st[j - 1][1]) * t])
  }
  return out
}

/** How many of the 64 sequence points each stroke gets: by length, at least 2 each. */
function allocate(lengths: number[]): number[] {
  const total = lengths.reduce((a, b) => a + b, 0) || 1
  const n = lengths.map((l) => Math.max(2, Math.round((SEQ_LEN * l) / total)))
  let sum = n.reduce((a, b) => a + b, 0)
  while (sum > SEQ_LEN) {
    let k = 0
    for (let i = 1; i < n.length; i++) if (n[i] > n[k]) k = i
    if (n[k] <= 2) break
    n[k]--
    sum--
  }
  while (sum < SEQ_LEN) {
    let k = 0
    for (let i = 1; i < n.length; i++) if (lengths[i] / n[i] > lengths[k] / n[k]) k = i
    n[k]++
    sum++
  }
  return n
}

function sequence(strokes: StrokeSet, out: Float32Array): void {
  const used = strokes.filter((s) => s.length > 0).slice(0, MAX_STROKES)
  const lengths = used.map((s) => {
    let l = 0
    for (let i = 1; i < s.length; i++) l += dist(s[i], s[i - 1])
    return l
  })
  const counts = allocate(lengths)
  const pts: Array<{ p: Pt; up: number; first: boolean; last: boolean }> = []
  used.forEach((s, si) => {
    const r = s.length === 1 ? Array.from({ length: counts[si] }, () => s[0]) : resampleStroke(s, counts[si])
    r.forEach((p, k) => pts.push({ p, up: si > 0 && k === 0 ? 1 : 0, first: k === 0, last: k === r.length - 1 }))
  })
  for (let i = 0; i < SEQ_LEN; i++) {
    const cur = pts[i]
    if (!cur) break
    let turn = 0
    if (!cur.first && !cur.last) {
      const a = pts[i - 1].p
      const b = cur.p
      const c = pts[i + 1].p
      const v1x = b[0] - a[0], v1y = b[1] - a[1], v2x = c[0] - b[0], v2y = c[1] - b[1]
      if (Math.hypot(v1x, v1y) > 1e-9 && Math.hypot(v2x, v2y) > 1e-9) {
        turn = Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y) / Math.PI
      }
    }
    out[i * SEQ_DIM] = cur.p[0] * 2
    out[i * SEQ_DIM + 1] = cur.p[1] * 2
    out[i * SEQ_DIM + 2] = cur.up
    out[i * SEQ_DIM + 3] = turn
  }
}

export interface SketchTensors {
  /** 2·32·32, channel-major. */
  img: Float32Array
  /** 64·4, row-major. */
  seq: Float32Array
}

/** Strokes are arrays of [x, y, …]; any number of extra columns (time, pressure) is ignored. */
export function preprocess(strokes: StrokeSet): SketchTensors {
  const img = new Float32Array(2 * IMG * IMG)
  const seq = new Float32Array(SEQ_LEN * SEQ_DIM)
  const clean = strokes.filter((s) => s.length > 0).map((s) => s.map((p) => [p[0], p[1]]))
  if (clean.length === 0) return { img, seq }
  const full = normalizeStrokes(clean)
  raster(full, img, 0)
  raster(normalizeStrokes(stripLeads(full)), img, 1)
  // Whole 1/255 steps: the training set stores the image as bytes, so the
  // browser must see exactly the values the network trained on.
  for (let i = 0; i < img.length; i++) img[i] = Math.round(img[i] * 255) / 255
  sequence(full, seq)
  return { img, seq }
}
