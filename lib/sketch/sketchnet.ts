// SketchNet inference: a hand-written forward pass, no runtime dependency.
//
// The network is ~117k parameters (0.47 MB) — a 4-block CNN, a GRU and two
// small heads — so its forward pass is about 150 lines of loops, and it runs in
// a few milliseconds. That avoids shipping the ~10 MB ONNX Runtime WASM binary
// the plan budgeted for. The .onnx file is still exported and checked against
// PyTorch; this file is checked against the same PyTorch outputs
// (sketchnet.test.mjs, golden vectors), so all three agree.
//
// Weights come from public/models/sketchnet-v1.{json,bin}: BatchNorm is already
// folded into the convolutions and the calibration temperature into the class
// head, so softmax(logits) is a calibrated probability.

import { IMG, PREPROCESS_VERSION, SEQ_DIM, SEQ_LEN, preprocess } from './preprocess'
import type { StrokeSet } from './features'

export interface SketchNetManifest {
  name: string
  preprocessVersion: number
  labels: string[]
  poses: number[]
  arch: { channels: number[]; hidden: number; trunk: number }
  temperature: number
  bytes: number
  sha256: string
  tensors: Array<{ name: string; shape: number[]; offset: number }>
  evidence: { synthetic: Record<string, number | null>; real: unknown; note: string }
}

export interface SketchPrediction {
  /** A wave-1 class id, or 'unknown'. */
  cls: string
  /** Calibrated probability of `cls`. */
  conf: number
  /** Best three, most likely first. */
  top: Array<{ cls: string; conf: number }>
  pose: 0 | 90 | 180 | 270
  poseConf: number
}

export interface SketchNet {
  manifest: SketchNetManifest
  /** Raw logits for already-preprocessed tensors (what the tests compare). */
  forward(img: ArrayLike<number>, seq: ArrayLike<number>): { cls: Float64Array; pose: Float64Array }
  predict(strokes: StrokeSet): SketchPrediction
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

/**
 * 3×3, stride 1, zero-pad 1 → ReLU → 2×2 max-pool. `x` is cin·h·w; returns
 * cout·h/2·w/2.
 *
 * Done as im2col + dot products: each output pixel gathers its cin·9 inputs into
 * one contiguous row, then every output channel is a dot product of that row with
 * its (equally contiguous) weights. For these tiny grids (32×32 down to 4×4) that
 * is several times faster than looping over kernel offsets, where the loop
 * bookkeeping outweighs the arithmetic.
 */
function convBlock(x: ArrayLike<number>, cin: number, h: number, w: number, wt: Float64Array, bias: Float64Array, cout: number): Float64Array {
  const K = cin * 9
  const col = new Float64Array(h * w * K)
  // Most of a sketch is blank paper: a pixel whose whole 3×3×cin neighbourhood is
  // zero outputs just the bias, so the dot products are skipped for it.
  const blank = new Uint8Array(h * w)
  for (let y = 0; y < h; y++) {
    for (let xx = 0; xx < w; xx++) {
      let k = (y * w + xx) * K
      let any = 0
      for (let ic = 0; ic < cin; ic++) {
        const plane = ic * h * w
        for (let ky = -1; ky <= 1; ky++) {
          const yy = y + ky
          for (let kx = -1; kx <= 1; kx++) {
            const x2 = xx + kx
            const v = yy >= 0 && yy < h && x2 >= 0 && x2 < w ? x[plane + yy * w + x2] : 0
            if (v !== 0) any = 1
            col[k++] = v
          }
        }
      }
      blank[y * w + xx] = any ? 0 : 1
    }
  }
  const full = new Float64Array(cout * h * w)
  for (let p = 0; p < h * w; p++) {
    if (blank[p]) {
      for (let oc = 0; oc < cout; oc++) full[oc * h * w + p] = bias[oc]
      continue
    }
    const c0 = p * K
    for (let oc = 0; oc < cout; oc++) {
      const w0 = oc * K
      let s0 = bias[oc]
      let s1 = 0
      let s2 = 0
      let s3 = 0
      let k = 0
      for (; k + 3 < K; k += 4) {
        s0 += wt[w0 + k] * col[c0 + k]
        s1 += wt[w0 + k + 1] * col[c0 + k + 1]
        s2 += wt[w0 + k + 2] * col[c0 + k + 2]
        s3 += wt[w0 + k + 3] * col[c0 + k + 3]
      }
      for (; k < K; k++) s0 += wt[w0 + k] * col[c0 + k]
      full[oc * h * w + p] = s0 + s1 + s2 + s3
    }
  }
  const oh = h >> 1
  const ow = w >> 1
  const out = new Float64Array(cout * oh * ow)
  for (let c = 0; c < cout; c++) {
    for (let y = 0; y < oh; y++) {
      for (let xx = 0; xx < ow; xx++) {
        const i = c * h * w + 2 * y * w + 2 * xx
        // max of the window, floored at 0 (= ReLU before pooling)
        out[c * oh * ow + y * ow + xx] = Math.max(0, full[i], full[i + 1], full[i + w], full[i + w + 1])
      }
    }
  }
  return out
}

function linear(x: Float64Array, wt: Float64Array, b: Float64Array, nOut: number): Float64Array {
  const nIn = x.length
  const out = new Float64Array(nOut)
  for (let j = 0; j < nOut; j++) {
    let s = b[j]
    const r = j * nIn
    for (let i = 0; i < nIn; i++) s += wt[r + i] * x[i]
    out[j] = s
  }
  return out
}

/** PyTorch GRU, one layer, batch of one: gate rows are (reset, update, new). */
function gru(seq: ArrayLike<number>, wIh: Float64Array, wHh: Float64Array, bIh: Float64Array, bHh: Float64Array, H: number): Float64Array {
  let h = new Float64Array(H)
  const gi = new Float64Array(3 * H)
  const gh = new Float64Array(3 * H)
  for (let t = 0; t < SEQ_LEN; t++) {
    for (let j = 0; j < 3 * H; j++) {
      let a = bIh[j]
      for (let k = 0; k < SEQ_DIM; k++) a += wIh[j * SEQ_DIM + k] * seq[t * SEQ_DIM + k]
      gi[j] = a
      let b = bHh[j]
      const r = j * H
      for (let k = 0; k < H; k++) b += wHh[r + k] * h[k]
      gh[j] = b
    }
    const next = new Float64Array(H)
    for (let j = 0; j < H; j++) {
      const r = sigmoid(gi[j] + gh[j])
      const z = sigmoid(gi[H + j] + gh[H + j])
      const n = Math.tanh(gi[2 * H + j] + r * gh[2 * H + j])
      next[j] = (1 - z) * n + z * h[j]
    }
    h = next
  }
  return h
}

function softmax(l: Float64Array): Float64Array {
  let m = -Infinity
  for (const v of l) if (v > m) m = v
  const e = new Float64Array(l.length)
  let s = 0
  for (let i = 0; i < l.length; i++) { e[i] = Math.exp(l[i] - m); s += e[i] }
  for (let i = 0; i < l.length; i++) e[i] /= s
  return e
}

/** Build the network from a manifest and its weight blob. Throws on any mismatch. */
export function createSketchNet(manifest: SketchNetManifest, weights: ArrayBuffer): SketchNet {
  if (manifest.preprocessVersion !== PREPROCESS_VERSION) {
    throw new Error(`SketchNet was trained with preprocessing v${manifest.preprocessVersion}; this build is v${PREPROCESS_VERSION}`)
  }
  if (weights.byteLength !== manifest.bytes) {
    throw new Error(`SketchNet weights are ${weights.byteLength} bytes, manifest says ${manifest.bytes}`)
  }
  // Stored as float32, held as float64: V8 computes in doubles, so float32
  // arrays pay a conversion on every load and store (measured ~1.6x slower).
  const all = Float64Array.from(new Float32Array(weights))
  const T: Record<string, Float64Array> = {}
  for (const t of manifest.tensors) T[t.name] = all.subarray(t.offset, t.offset + t.shape.reduce((a, b) => a * b, 1))
  const ch = manifest.arch.channels
  const H = manifest.arch.hidden
  const nCls = manifest.labels.length
  const nPose = manifest.poses.length

  const forward: SketchNet['forward'] = (img, seq) => {
    let x = img
    let size = IMG
    for (let i = 0; i < ch.length - 1; i++) {
      x = convBlock(x, ch[i], size, size, T[`conv${i}.w`], T[`conv${i}.b`], ch[i + 1])
      size >>= 1
    }
    // global average over what is left of the spatial grid
    const cLast = ch[ch.length - 1]
    const z = new Float64Array(cLast + H)
    const area = size * size
    for (let c = 0; c < cLast; c++) {
      let s = 0
      for (let i = 0; i < area; i++) s += x[c * area + i]
      z[c] = s / area
    }
    z.set(gru(seq, T['gru.w_ih'], T['gru.w_hh'], T['gru.b_ih'], T['gru.b_hh'], H), cLast)
    const t = linear(z, T['trunk.w'], T['trunk.b'], manifest.arch.trunk).map((v) => Math.max(0, v))
    return { cls: linear(t, T['cls.w'], T['cls.b'], nCls), pose: linear(z, T['pose.w'], T['pose.b'], nPose) }
  }

  // Reading a drawing asks about the same stroke groups again and again (once per scale tried), so
  // the answer for a set of strokes is kept. Keyed by the points themselves; bounded.
  const memo = new Map<string, SketchPrediction>()
  const predict: SketchNet['predict'] = (strokes) => {
    const key = strokes.map((st) => st.map((p) => `${p[0]},${p[1]},${p[2] ?? ''}`).join(';')).join('|')
    const hit = memo.get(key)
    if (hit) return hit
    const res = predictFresh(strokes)
    if (memo.size >= 1024) memo.delete(memo.keys().next().value as string)
    memo.set(key, res)
    return res
  }
  const predictFresh: SketchNet['predict'] = (strokes) => {
    const { img, seq } = preprocess(strokes)
    const out = forward(img, seq)
    const p = softmax(out.cls)
    const order = Array.from(p.keys()).sort((a, b) => p[b] - p[a])
    const pp = softmax(out.pose)
    const pi = pp.indexOf(Math.max(...pp))
    return {
      cls: manifest.labels[order[0]],
      conf: p[order[0]],
      top: order.slice(0, 3).map((i) => ({ cls: manifest.labels[i], conf: p[i] })),
      pose: manifest.poses[pi] as SketchPrediction['pose'],
      poseConf: pp[pi],
    }
  }

  return { manifest, forward, predict }
}

const MODEL = 'sketchnet-v1'
const CHAR_MODEL = 'inkchars-v1'

interface Slot {
  loading: Promise<SketchNet | null> | null
  ready: SketchNet | null
  /** When the last attempt failed (ms), so a later call retries instead of caching the failure forever. */
  failedAt: number
}
/** After a failed download, wait this long before trying again (callers like peek run on every pointer-up). */
export const MODEL_RETRY_MS = 3000
const slots = new Map<string, Slot>()
const slotFor = (name: string): Slot => {
  let s = slots.get(name)
  if (!s) slots.set(name, (s = { loading: null, ready: null, failedAt: 0 }))
  return s
}

/**
 * Fetch and build a shipped model once. Resolves to null — never throws — if
 * the files are missing or incompatible, so callers simply fall back to doing
 * without it (the older recogniser; or typing a value by hand).
 */
export function loadModel(name: string, base = '/models', now: () => number = Date.now): Promise<SketchNet | null> {
  const slot = slotFor(name)
  // a failed attempt is forgotten once the cooldown passes, so "try again" can actually succeed
  if (slot.loading && !slot.ready && slot.failedAt && now() - slot.failedAt >= MODEL_RETRY_MS) {
    slot.loading = null
    slot.failedAt = 0
  }
  slot.loading ??= (async () => {
    try {
      const [m, w] = await Promise.all([fetch(`${base}/${name}.json`), fetch(`${base}/${name}.bin`)])
      if (!m.ok || !w.ok) throw new Error(`HTTP ${m.status}/${w.status}`)
      slot.ready = createSketchNet((await m.json()) as SketchNetManifest, await w.arrayBuffer())
      return slot.ready
    } catch {
      slot.failedAt = now()
      return null
    }
  })()
  return slot.loading
}

/** True when the last attempt to load this model failed (and it is not loaded). For honest messages. */
export const modelFailed = (name: string): boolean => {
  const s = slots.get(name)
  return !!s && !s.ready && s.failedAt > 0
}

/** Forget a model's state (tests). */
export const resetModel = (name: string): void => {
  slots.delete(name)
}

/** The network if it has finished loading, else null — and starts loading it.
 *  For synchronous callers (a pointer-up handler) that must never wait. */
const peek = (name: string): SketchNet | null => {
  const slot = slotFor(name)
  if (!slot.ready) void loadModel(name)
  return slot.ready
}

/** The symbol network (see peek). */
export const peekSketchNet = (): SketchNet | null => peek(MODEL)
/** Did the symbol network fail to download? (so "still loading" is not said when it never will load) */
export const sketchNetFailed = (): boolean => modelFailed(MODEL)
/** The handwritten-character network that reads values like "10k"; null until loaded or if absent. */
export const peekInkChars = (): SketchNet | null => peek(CHAR_MODEL)

export const loadSketchNet = (base = '/models'): Promise<SketchNet | null> => loadModel(MODEL, base)
export const loadInkChars = (base = '/models'): Promise<SketchNet | null> => loadModel(CHAR_MODEL, base)
