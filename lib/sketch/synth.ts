// Synthetic stroke generator: clean skeletons (glyphs.ts) → what real hands do.
//
// The plan's central caution (§5.1, §6.2): a model that scores well on its own
// synthetic data can still fail on people. So everything here is built to make
// the synthetic world HARD and DIVERSE — and to be labelled as synthetic all
// the way down. Nothing in this file knows about real data; real samples are
// the same record (dataset.ts) with `source: 'real'`, and every report groups
// by source, so a synthetic number can never be mistaken for a real one.
//
// What a hand does that a renderer doesn't, and how it is modelled:
//   • lifts the pen between lead and body, or draws it all in one go
//       → merge / split / reverse / reorder strokes
//   • drifts and shakes at low frequency (mouse wobble, touchpad tremor)
//       → smooth sinusoidal offsets along the normal, per stroke
//   • rounds corners (finger and touchpad especially; a zigzag becomes a wave)
//       → moving-average smoothing whose radius is the writer's `rounding`
//   • overshoots a join, or leaves a gap
//       → ends pushed past / pulled short of their target
//   • draws big or small, squashed, tilted, sheared
//       → per-writer size/aspect/tilt, per-sample jitter on each
//   • omits or over-extends the connecting leads
//       → lead strokes dropped or stretched (so stripLeads is exercised)
//   • varies in speed and in how often the device reports a point
//       → per-device event interval and a speed profile along each stroke
//
// Writers are persistent: one style vector per simulated person, reused for all
// of that person's samples, and splits are made BY WRITER — so even the
// synthetic validation/test sets are "a hand the model never met". They are
// still synthetic hands. See `source`.

import { makeRng, hash32, type Rng } from './rng'
import { GLYPHS, type Glyph, type GlyphStroke, type Pt } from './glyphs'
import { UNKNOWN_CLASS, WAVE1_CLASSES, POSE_SYMMETRY, canonicalPose, type Pose, type Wave1Class } from './classes'
import type { SketchSampleT } from './dataset'

/** Bump when the generator's output distribution changes; stored in every sample's meta. */
export const GENERATOR_VERSION = 3

type Device = SketchSampleT['device']
export type Stroke3 = Array<[number, number, number]>

export interface WriterStyle {
  id: string
  device: Device
  /** Low-frequency hand wobble amplitude, px. */
  wobble: number
  /** Per-event pointer noise, px. */
  jitter: number
  /** Corner rounding, 0 (sharp) … 1 (a zigzag becomes a wave). */
  rounding: number
  /** Typical symbol width, px. */
  size: number
  /** Habitual squash: width ÷ height multiplier. */
  aspect: number
  /** Habitual tilt, degrees. */
  tilt: number
  shear: number
  /** Chance an end overshoots / falls short. */
  endNoise: number
  /** Chance two touching strokes are drawn as one. */
  mergeProb: number
  /** Chance a long stroke is lifted mid-way. */
  splitProb: number
  /** Chance a stroke order is random rather than natural. */
  orderShuffle: number
  /** Pen speed, px/ms. */
  speed: number
  /** Device event interval, ms. */
  dt: number
  /** Chance a connecting lead is left out. */
  leadOmit: number
  /** Chance the whole symbol is drawn bare, with no leads at all — how most
   *  people sketch a part before wiring it. (v1 had almost none of these, and
   *  the first model failed on bare gates/batteries/switches.) */
  leadless: number
}

/** Mouse and touchpad first, finger second, pen rare — as the students are. */
const DEVICE_MIX: ReadonlyArray<readonly [Device, number]> = [
  ['mouse', 0.4], ['touchpad', 0.3], ['finger', 0.25], ['pen', 0.05],
]

export function makeWriter(rng: Rng, id: string, device?: Device): WriterStyle {
  const dev = device ?? rng.weighted(DEVICE_MIX)
  const p = {
    mouse: { wobble: [0.4, 2], jitter: [0.2, 0.5], round: [0.05, 0.3], size: [60, 190], speed: [0.2, 0.7], dt: [8, 16], split: 0.18, merge: 0.55 },
    touchpad: { wobble: [1, 3.5], jitter: [0.4, 0.9], round: [0.2, 0.5], size: [60, 190], speed: [0.12, 0.45], dt: [8, 16], split: 0.3, merge: 0.4 },
    finger: { wobble: [1, 3], jitter: [0.5, 1.2], round: [0.2, 0.45], size: [110, 260], speed: [0.25, 0.9], dt: [16, 17], split: 0.12, merge: 0.65 },
    pen: { wobble: [0.3, 1.5], jitter: [0.15, 0.35], round: [0, 0.15], size: [70, 220], speed: [0.2, 0.8], dt: [4, 8], split: 0.15, merge: 0.6 },
  }[dev]
  const r = (a: readonly number[]) => rng.range(a[0], a[1])
  return {
    id,
    device: dev,
    wobble: r(p.wobble),
    jitter: r(p.jitter),
    rounding: r(p.round),
    size: r(p.size),
    aspect: Math.exp(rng.gauss() * 0.12),
    tilt: Math.max(-8, Math.min(8, rng.gauss() * 3)),
    shear: Math.max(-0.12, Math.min(0.12, rng.gauss() * 0.05)),
    endNoise: rng.range(0.25, 0.85),
    mergeProb: Math.max(0, Math.min(1, p.merge + rng.gauss() * 0.15)),
    splitProb: Math.max(0, Math.min(1, p.split + rng.gauss() * 0.08)),
    orderShuffle: rng.range(0.1, 0.5),
    speed: r(p.speed),
    dt: r(p.dt),
    leadOmit: rng.range(0, 0.22),
    leadless: rng.range(0, 0.7),
  }
}

// ── geometry helpers ───────────────────────────────────────────────────────

const rotate = (p: Pt, c: Pt, rad: number): Pt => {
  const dx = p[0] - c[0]
  const dy = p[1] - c[1]
  return [c[0] + dx * Math.cos(rad) - dy * Math.sin(rad), c[1] + dx * Math.sin(rad) + dy * Math.cos(rad)]
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Resample a polyline to points `step` apart (keeps both ends). */
function resample(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts.slice()
  const out: Pt[] = [pts[0]]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const seg = dist(a, b)
    if (seg === 0) continue
    let d = step - carry
    while (d <= seg) {
      const t = d / seg
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
      d += step
    }
    carry = seg - (d - step)
  }
  const last = pts[pts.length - 1]
  if (dist(out[out.length - 1], last) > step * 0.3) out.push(last)
  else out[out.length - 1] = last
  return out
}

/** Move one end of a polyline along its own tangent: + overshoots, − falls short. */
function pushEnd(pts: Pt[], atStart: boolean, by: number): Pt[] {
  if (pts.length < 2 || by === 0) return pts
  const out = pts.slice()
  const i = atStart ? 0 : pts.length - 1
  const j = atStart ? 1 : pts.length - 2
  const len = dist(pts[i], pts[j])
  if (len === 0) return pts
  const k = by / len
  out[i] = [pts[i][0] + (pts[i][0] - pts[j][0]) * k, pts[i][1] + (pts[i][1] - pts[j][1]) * k]
  return out
}

// ── glyph-space edits (frame units) ────────────────────────────────────────

function editLeads(rng: Rng, w: WriterStyle, strokes: GlyphStroke[]): GlyphStroke[] {
  if (rng.chance(w.leadless)) return strokes.filter((s) => !s.lead)
  const out: GlyphStroke[] = []
  for (const s of strokes) {
    if (!s.lead) { out.push(s); continue }
    if (rng.chance(w.leadOmit)) continue
    const [a, b] = s.pts
    // the end farther from the frame centre is the free one
    const outerIsA = dist(a, [50, 30]) > dist(b, [50, 30])
    const len = dist(a, b)
    const f = rng.range(-0.3, 0.55)
    out.push({ ...s, pts: pushEnd(s.pts, outerIsA, len * f) })
  }
  return out
}

function mergeTouching(rng: Rng, w: WriterStyle, strokes: Pt[][]): Pt[][] {
  const list = strokes.map((s) => s.slice())
  let again = true
  let guard = 0
  while (again && guard++ < 24) {
    again = false
    const order = rng.shuffle(list.map((_, i) => i))
    for (const i of order) {
      for (const j of order) {
        if (i >= j || !list[i] || !list[j]) continue
        const A = list[i]
        const B = list[j]
        // closed shapes (circles, triangles) are not extended by a neighbour's end
        const tryJoin = (a: Pt[], b: Pt[]): Pt[] | null => (dist(a[a.length - 1], b[0]) < 2.5 ? [...a, ...b.slice(1)] : null)
        const joined =
          tryJoin(A, B) ?? tryJoin(B, A) ?? tryJoin(A, B.slice().reverse()) ?? tryJoin(A.slice().reverse(), B) ?? null
        if (joined && rng.chance(w.mergeProb)) {
          list[i] = joined
          list.splice(j, 1)
          again = true
          break
        }
      }
      if (again) break
    }
  }
  return list
}

function splitLong(rng: Rng, w: WriterStyle, strokes: Pt[][]): Pt[][] {
  const out: Pt[][] = []
  for (const s of strokes) {
    if (s.length >= 8 && rng.chance(w.splitProb)) {
      const k = rng.int(3, s.length - 4)
      out.push(s.slice(0, k + 1), s.slice(k))
    } else out.push(s)
  }
  return out
}

// ── rendering one stroke to timed pixels ───────────────────────────────────

/** Moving average with a window that shrinks at the ends, so endpoints stay put. */
function roundCorners(pts: Pt[], halfWidth: number): Pt[] {
  if (halfWidth < 1 || pts.length < 3) return pts
  const out: Pt[] = []
  for (let i = 0; i < pts.length; i++) {
    const h = Math.min(halfWidth, i, pts.length - 1 - i)
    let x = 0
    let y = 0
    for (let k = i - h; k <= i + h; k++) { x += pts[k][0]; y += pts[k][1] }
    const n = 2 * h + 1
    out.push([x / n, y / n])
  }
  return out
}

function wobble(rng: Rng, pts: Pt[], amp: number): Pt[] {
  if (amp <= 0 || pts.length < 3) return pts
  const comps = [0, 1, 2].map((k) => ({
    a: (amp * rng.range(0.3, 1)) / Math.sqrt(k + 1),
    wl: rng.range(25, 140),
    ph: rng.range(0, 2 * Math.PI),
  }))
  const out: Pt[] = []
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    if (i) s += dist(pts[i], pts[i - 1])
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const tx = b[0] - a[0]
    const ty = b[1] - a[1]
    const tl = Math.hypot(tx, ty) || 1
    let d = 0
    for (const c of comps) d += c.a * Math.sin((2 * Math.PI * s) / c.wl + c.ph)
    out.push([pts[i][0] - (ty / tl) * d, pts[i][1] + (tx / tl) * d])
  }
  return out
}

/** Sample a dense path the way a pointer device would, and stamp the time. */
function toEvents(rng: Rng, w: WriterStyle, pts: Pt[], t0: number): { stroke: Stroke3; tEnd: number } {
  const v = w.speed * Math.exp(rng.gauss() * 0.28)
  const wl = rng.range(30, 120)
  const ph = rng.range(0, 2 * Math.PI)
  const out: Stroke3 = []
  let t = t0
  let nextAt = 0
  const jit = () => rng.gauss() * w.jitter
  out.push([pts[0][0] + jit(), pts[0][1] + jit(), Math.round(t)])
  let s = 0
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i], pts[i - 1])
    s += seg
    // speed varies along the stroke: slower in places, quicker in others
    const vi = Math.max(0.03, v * (1 + 0.3 * Math.sin((2 * Math.PI * s) / wl + ph)))
    t += seg / vi
    // emit an event whenever the device would have reported one
    if (t - t0 >= nextAt || i === pts.length - 1) {
      out.push([pts[i][0] + jit(), pts[i][1] + jit(), Math.round(t)])
      nextAt = t - t0 + w.dt * rng.range(0.75, 1.25)
    }
  }
  return { stroke: out, tEnd: t }
}

// ── one sample ─────────────────────────────────────────────────────────────

/**
 * One stroke, from the pixel path a person means to draw to the timed events a
 * pointer device reports: end overshoot/gap, a dense path, rounded corners,
 * wobble, then event sampling. `sizeRef` is how big the thing being drawn is,
 * because sloppiness scales with it. Null when the stroke came out a speck.
 */
function penStroke(rng: Rng, w: WriterStyle, path: Pt[], t: number, sizeRef: number): { stroke: Stroke3; tEnd: number } | null {
  let px = path
  // ends: overshoot or fall short
  for (const atStart of [true, false]) {
    if (rng.chance(w.endNoise)) px = pushEnd(px, atStart, rng.chance(0.55) ? rng.range(0, 7) : -rng.range(0, 5))
  }
  // the hand: dense path, rounded corners, wobble
  let dense = resample(px, 1.5)
  // A stroke shortened to a speck is not a stroke: the pen never left a mark.
  if (dense.length < 3) return null
  // Sloppiness scales with how big the symbol is drawn: a person drawing large
  // is not proportionally shakier, so rounding and wobble are relative to size.
  dense = roundCorners(dense, Math.round((w.rounding * rng.range(0.6, 1.4) * sizeRef * 0.035) / 1.5))
  dense = wobble(rng, dense, w.wobble * Math.max(0.7, Math.min(1.6, sizeRef / 110)))
  // the device: sampled events with timing
  return toEvents(rng, w, dense, t)
}

/** Strokes in frame units → timed pixel strokes, as writer `w` would draw them. */
export function render(rng: Rng, w: WriterStyle, frameStrokes: Pt[][]): Stroke3[] {
  // 1. how the pen moves: join, lift, reverse, reorder
  let strokes = mergeTouching(rng, w, frameStrokes)
  strokes = splitLong(rng, w, strokes)
  strokes = strokes.map((s) => (rng.chance(0.5) ? s.slice().reverse() : s))
  if (rng.chance(w.orderShuffle)) rng.shuffle(strokes)
  else if (rng.chance(0.35)) strokes.sort((a, b) => Math.min(...a.map((p) => p[0])) - Math.min(...b.map((p) => p[0])))

  // 2. into pixels: size, squash, shear, tilt
  const scale = (w.size / 100) * Math.exp(rng.gauss() * 0.18)
  const asp = w.aspect * Math.exp(rng.gauss() * 0.1)
  const sx = scale * Math.sqrt(asp)
  const sy = scale / Math.sqrt(asp)
  const tilt = ((Math.max(-12, Math.min(12, w.tilt + rng.gauss() * 3.5)) * Math.PI) / 180)
  const shear = w.shear + rng.gauss() * 0.04
  const place = (p: Pt): Pt => {
    const x = (p[0] - 50) * sx
    const y = (p[1] - 30) * sy
    return rotate([x + shear * y, y], [0, 0], tilt)
  }

  const ox = rng.range(60, 900)
  const oy = rng.range(60, 600)
  const out: Stroke3[] = []
  let t = 0
  for (const s of strokes) {
    const made = penStroke(rng, w, s.map(place), t, w.size)
    if (!made) continue
    out.push(made.stroke.map(([x, y, tt]) => [Math.round((x + ox) * 10) / 10, Math.round((y + oy) * 10) / 10, tt]))
    t = made.tEnd + rng.range(90, w.device === 'finger' ? 600 : 480)
  }
  // Every stroke was a speck (only possible for a near-empty glyph): draw the
  // first one plainly rather than hand back a sample with no ink.
  if (out.length === 0) {
    const dense = resample(strokes[0].map(place), 1.5)
    const { stroke } = toEvents(rng, w, dense, 0)
    out.push(stroke.map(([x, y, tt]) => [Math.round((x + ox) * 10) / 10, Math.round((y + oy) * 10) / 10, tt]))
  }
  // an occasional retraced stroke
  if (out.length && rng.chance(0.04)) {
    const s = out[rng.int(0, out.length - 1)]
    const dx = rng.range(-1.5, 1.5)
    const dy = rng.range(-1.5, 1.5)
    const last = out[out.length - 1]
    const base = last[last.length - 1][2] + rng.range(120, 400)
    out.push(s.map(([x, y, tt]) => [Math.round((x + dx) * 10) / 10, Math.round((y + dy) * 10) / 10, Math.round(base + (tt - s[0][2]))]))
  }
  // time starts at zero for every sample
  const t0 = out[0][0][2]
  return out.map((s) => s.map(([x, y, tt]): [number, number, number] => [x, y, tt - t0]))
}

/** Pose: how the whole symbol is turned. Writers mostly draw upright. */
function samplePose(rng: Rng, cls: Wave1Class): Pose {
  if (POSE_SYMMETRY[cls] === 'rot180') return rng.weighted<Pose>([[0, 0.7], [90, 0.3]])
  if (cls === 'gnd') return rng.weighted<Pose>([[0, 0.7], [90, 0.1], [180, 0.1], [270, 0.1]])
  return rng.weighted<Pose>([[0, 0.5], [180, 0.2], [90, 0.15], [270, 0.15]])
}

/** A glyph for `cls`; a writer's habits (e.g. how many resistor teeth) persist. */
function glyphFor(rng: Rng, w: WriterStyle, cls: Wave1Class) {
  const g = rng.chance(0.6) ? makeRng(hash32(`${w.id}/${cls}`)) : rng
  return GLYPHS[cls](g)
}

export interface DrawResult {
  strokes: Stroke3[]
  pose: Pose
  variant: string
}

export function drawSymbol(rng: Rng, w: WriterStyle, cls: Wave1Class): DrawResult {
  const glyph = glyphFor(rng, w, cls)
  const pose = samplePose(rng, cls)
  const rad = (pose * Math.PI) / 180
  const edited = editLeads(rng, w, glyph.strokes)
  const posed = edited.map((s) => s.pts.map((p) => rotate(p, [50, 30], rad)))
  return { strokes: render(rng, w, posed), pose: canonicalPose(cls, pose), variant: glyph.variant }
}

// ── negatives: things that are not a symbol ────────────────────────────────

const NEGATIVE_KINDS = ['scribble', 'polygon', 'line', 'ellipse', 'cross', 'box', 'arrow', 'partial', 'squiggles'] as const
type NegKind = (typeof NEGATIVE_KINDS)[number]

function smoothPath(rng: Rng, n: number): Pt[] {
  const c: Pt[] = Array.from({ length: n }, () => [rng.range(5, 95), rng.range(5, 55)])
  const out: Pt[] = []
  for (let i = 0; i < c.length - 2; i++) {
    const a: Pt = [(c[i][0] + c[i + 1][0]) / 2, (c[i][1] + c[i + 1][1]) / 2]
    const b: Pt = [(c[i + 1][0] + c[i + 2][0]) / 2, (c[i + 1][1] + c[i + 2][1]) / 2]
    for (let t = 0; t <= 1; t += 0.2) {
      const u = 1 - t
      out.push([u * u * a[0] + 2 * u * t * c[i + 1][0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[i + 1][1] + t * t * b[1]])
    }
  }
  return out
}

export function drawNegative(rng: Rng, w: WriterStyle): { strokes: Stroke3[]; kind: NegKind } {
  const kind = rng.pick(NEGATIVE_KINDS)
  let frame: Pt[][] = []
  switch (kind) {
    case 'scribble': frame = [smoothPath(rng, rng.int(7, 16))]; break
    case 'polygon': {
      const n = rng.int(3, 7)
      const pts: Pt[] = Array.from({ length: n }, (_, i): Pt => {
        const a = (i / n) * 2 * Math.PI + rng.range(-0.4, 0.4)
        const r = rng.range(14, 28)
        return [50 + r * 1.5 * Math.cos(a), 30 + r * Math.sin(a)]
      })
      frame = [[...pts, pts[0]]]
      break
    }
    case 'line': {
      const a = rng.range(0, Math.PI)
      const l = rng.range(30, 90)
      frame = [[[50 - (l / 2) * Math.cos(a), 30 - (l / 4) * Math.sin(a)], [50 + (l / 2) * Math.cos(a), 30 + (l / 4) * Math.sin(a)]]]
      break
    }
    case 'ellipse': {
      const rx = rng.range(14, 40)
      const ry = rng.range(10, 26)
      const a0 = rng.range(0, 2 * Math.PI)
      frame = [Array.from({ length: 30 }, (_, i): Pt => {
        const a = a0 + (i / 29) * 2 * Math.PI * rng.range(0.95, 1.1)
        return [50 + rx * Math.cos(a), 30 + ry * Math.sin(a)]
      })]
      break
    }
    case 'cross': {
      const k = rng.chance(0.5)
      frame = k
        ? [[[30, 12], [70, 48]], [[30, 48], [70, 12]]]
        : [[[50, 8], [50, 52]], [[24, 30], [76, 30]]]
      break
    }
    case 'box': {
      const x0 = rng.range(10, 30), x1 = rng.range(70, 90), y0 = rng.range(6, 18), y1 = rng.range(42, 54)
      frame = [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]
      break
    }
    case 'arrow': {
      const from: Pt = [rng.range(10, 30), rng.range(15, 45)]
      const to: Pt = [rng.range(70, 90), rng.range(15, 45)]
      const a = Math.atan2(to[1] - from[1], to[0] - from[0])
      const wing = (s: number): Pt[] => [[to[0] - 10 * Math.cos(a + s), to[1] - 10 * Math.sin(a + s)], to]
      frame = [[from, to], wing(0.45), wing(-0.45)]
      break
    }
    case 'partial': {
      // A symbol with most of it missing: not a symbol yet.
      const cls = rng.pick(WAVE1_CLASSES)
      const strokes = GLYPHS[cls](rng).strokes
      const bodyIdx = strokes.map((s, i) => (s.lead ? -1 : i)).filter((i) => i >= 0)
      const keep = new Set(rng.shuffle(bodyIdx.slice()).slice(0, Math.max(1, Math.floor(bodyIdx.length * 0.4))))
      frame = strokes.filter((s, i) => keep.has(i) || (s.lead && rng.chance(0.4))).map((s) => s.pts)
      break
    }
    case 'squiggles': {
      const n = rng.int(2, 4)
      for (let i = 0; i < n; i++) {
        const cx = 20 + (60 * i) / n
        const loops = Array.from({ length: 14 }, (_, k): Pt => [cx + k * 1.2 + rng.range(-3, 3), 30 + rng.range(-12, 12)])
        frame.push(loops)
      }
      break
    }
  }
  return { strokes: render(rng, w, frame), kind }
}

// ── whole dataset ──────────────────────────────────────────────────────────

export interface GenOptions {
  seed: number
  writers: number
  /** Samples per writer per class. */
  reps: number
  /** 'unknown' gets this many times `reps`, so it isn't drowned by 21 classes. */
  unknownFactor?: number
  /** Fractions of writers in train / val; the rest are test. */
  split?: { train: number; val: number }
}

/**
 * Every sample for a run, in a stable order. Same options → identical output.
 * Writers are split by writer id, never by sample.
 */
export function* generate(opts: GenOptions): Generator<SketchSampleT> {
  const root = makeRng(opts.seed)
  const split = opts.split ?? { train: 0.7, val: 0.15 }
  const unknownFactor = opts.unknownFactor ?? 2
  const order = root.fork('split').shuffle(Array.from({ length: opts.writers }, (_, i) => i))
  const splitOf = new Map<number, 'train' | 'val' | 'test'>()
  order.forEach((w, rank) => {
    const f = rank / opts.writers
    splitOf.set(w, f < split.train ? 'train' : f < split.train + split.val ? 'val' : 'test')
  })

  for (let wi = 0; wi < opts.writers; wi++) {
    const wid = `synth-${opts.seed}-w${String(wi).padStart(4, '0')}`
    const wrng = root.fork(wid)
    const style = makeWriter(wrng, wid)
    const sp = splitOf.get(wi)!
    const base = { writer: wid, device: style.device, split: sp }
    const meta = (extra: Record<string, string | number | boolean>) => ({ generator: GENERATOR_VERSION, seed: opts.seed, ...extra })

    for (const cls of WAVE1_CLASSES) {
      for (let r = 0; r < opts.reps; r++) {
        const id = `${wid}-${cls}-${r}`
        const rng = wrng.fork(id)
        const d = drawSymbol(rng, style, cls)
        yield { id, cls, pose: d.pose, strokes: d.strokes, source: 'synthetic', ...base, meta: meta({ variant: d.variant }) }
      }
    }
    for (let r = 0; r < opts.reps * unknownFactor; r++) {
      const id = `${wid}-${UNKNOWN_CLASS}-${r}`
      const rng = wrng.fork(id)
      const d = drawNegative(rng, style)
      yield { id, cls: UNKNOWN_CLASS, pose: 0, strokes: d.strokes, source: 'synthetic-negative', ...base, meta: meta({ variant: d.kind }) }
    }
  }
}


// ── whole-circuit scenes: symbols and wires drawn where a layout puts them ──

export interface Placement {
  /** Where the symbol's centre goes (page px). */
  cx: number
  cy: number
  /** How wide the 100-unit glyph frame is drawn, px. */
  width: number
  /** Whole-symbol turn, degrees clockwise (0/90/180/270). */
  pose: Pose
  /** Italic slant: how far the top leans right, as a fraction of height (handwriting). */
  slant?: number
}

export interface PlacedSymbol {
  strokes: Stroke3[]
  variant: string
  /** The drawn ink's bounding box, page px. */
  box: { x0: number; y0: number; x1: number; y1: number }
}

/** A symbol drawn at a given place and size: the same hand as drawSymbol, but not at a random spot. */
export function drawSymbolPlaced(rng: Rng, w: WriterStyle, cls: Wave1Class, at: Placement, t0 = 0): PlacedSymbol {
  return drawGlyphPlaced(rng, w, glyphFor(rng, w, cls), at, t0, true)
}

/** Any glyph (a symbol, a handwritten character) drawn at a place and size by writer `w`. */
export function drawGlyphPlaced(rng: Rng, w: WriterStyle, glyph: Glyph, at: Placement, t0 = 0, withLeads = false): PlacedSymbol {
  const rad = (at.pose * Math.PI) / 180
  const edited = withLeads ? editLeads(rng, w, glyph.strokes) : glyph.strokes
  const frame = edited.map((st) => st.pts.map((p) => rotate(p, [50, 30], rad)))
  let strokes = mergeTouching(rng, w, frame)
  strokes = splitLong(rng, w, strokes)
  strokes = strokes.map((st) => (rng.chance(0.5) ? st.slice().reverse() : st))
  if (rng.chance(w.orderShuffle)) rng.shuffle(strokes)

  const scale = (at.width / 100) * Math.exp(rng.gauss() * 0.05)
  const asp = Math.exp(rng.gauss() * 0.06)
  const tilt = (Math.max(-6, Math.min(6, w.tilt * 0.5 + rng.gauss() * 1.5)) * Math.PI) / 180
  const place = (p: Pt): Pt => {
    const x = (p[0] - 50) * scale * Math.sqrt(asp)
    const y = (p[1] - 30) * (scale / Math.sqrt(asp))
    const [rx, ry] = rotate([x + (at.slant ?? 0) * y, y], [0, 0], tilt)
    return [rx + at.cx, ry + at.cy]
  }
  const out: Stroke3[] = []
  let t = t0
  for (const st of strokes) {
    const made = penStroke(rng, w, st.map(place), t, at.width)
    if (!made) continue
    out.push(made.stroke.map(([x, y, tt]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, tt]))
    t = made.tEnd + rng.range(90, w.device === 'finger' ? 500 : 400)
  }
  if (out.length === 0) {
    const made = toEvents(rng, w, resample(strokes[0].map(place), 1.5), t0)
    out.push(made.stroke.map(([x, y, tt]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, tt]))
  }
  const all = out.flat()
  return {
    strokes: out,
    variant: glyph.variant,
    box: {
      x0: Math.min(...all.map((p) => p[0])), y0: Math.min(...all.map((p) => p[1])),
      x1: Math.max(...all.map((p) => p[0])), y1: Math.max(...all.map((p) => p[1])),
    },
  }
}

/**
 * Wires (or any polylines already in page px) drawn by hand: occasionally lifted
 * mid-way, ends loose, corners rounded, wobbled, timed. Returns the strokes and
 * the time the last one ended.
 */
export function drawPolylines(rng: Rng, w: WriterStyle, polys: Pt[][], t0: number, sizeRef = 110): { strokes: Stroke3[]; tEnd: number } {
  const out: Stroke3[] = []
  let t = t0
  for (const poly of polys) {
    let parts: Pt[][] = [poly]
    if (poly.length >= 3 && rng.chance(w.splitProb * 0.5)) {
      const k = rng.int(1, poly.length - 2)
      parts = [poly.slice(0, k + 1), poly.slice(k)]
    }
    for (const part of parts) {
      const made = penStroke(rng, w, rng.chance(0.5) ? part : part.slice().reverse(), t, sizeRef)
      if (!made) continue
      out.push(made.stroke.map(([x, y, tt]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, tt]))
      t = made.tEnd + rng.range(80, w.device === 'finger' ? 500 : 380)
    }
  }
  return { strokes: out, tEnd: t }
}

/** A junction dot: a small filled blob, drawn as a quick scribble. */
export function drawDot(rng: Rng, w: WriterStyle, cx: number, cy: number, t0: number): { strokes: Stroke3[]; tEnd: number } {
  const r = rng.range(2.2, 4.2)
  const pts: Pt[] = []
  const turns = rng.int(1, 2)
  for (let i = 0; i <= 10 * turns; i++) {
    const a = (i / 10) * 2 * Math.PI
    const rr = r * (1 - (i / (10 * turns)) * 0.6)
    pts.push([cx + rr * Math.cos(a) + rng.gauss() * 0.3, cy + rr * Math.sin(a) + rng.gauss() * 0.3])
  }
  const made = toEvents(rng, w, pts, t0)
  return { strokes: [made.stroke.map(([x, y, tt]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, tt])], tEnd: made.tEnd + rng.range(60, 200) }
}
