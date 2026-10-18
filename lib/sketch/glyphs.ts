// Stroke skeletons for the wave-1 classes: how a person DRAWS each ANSI/US
// symbol, as pen strokes — not how part-art.tsx renders it.
//
// part-art.tsx returns JSX, so its geometry can't be read without a renderer,
// and a clean render isn't what a hand produces anyway (a hand lifts the pen
// between a lead and a body; a rendered symbol is one filled shape). These
// skeletons are authored once, here, in a 100 × 60 frame with y pointing down,
// and every function takes the RNG so a class has real style variants
// (3–6 resistor teeth, one or two battery cells, circle or no circle around a
// transistor…). Poses are applied later by the generator, not baked in.
//
// Strokes are natural PRIMITIVES — a plate, a lead, a zigzag. Whether the
// writer joins them into one continuous line is the generator's decision.

import type { Rng } from './rng'
import type { Wave1Class } from './classes'

export type Pt = [number, number]

export interface GlyphStroke {
  pts: Pt[]
  /** A connecting lead: the writer may omit it or run it long. */
  lead?: boolean
}

export interface Glyph {
  strokes: GlyphStroke[]
  /** Which style variant was drawn — kept as provenance. */
  variant: string
}

export const FRAME = { w: 100, h: 60 }

// ── primitives ─────────────────────────────────────────────────────────────

export const line = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y1]]
export const lead = (x0: number, y0: number, x1: number, y1: number): GlyphStroke => ({ pts: line(x0, y0, x1, y1), lead: true })
export const body = (pts: Pt[]): GlyphStroke => ({ pts })

export function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 18): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
  }
  return out
}

export const circle = (cx: number, cy: number, r: number): Pt[] => arc(cx, cy, r, r, -Math.PI / 2, (3 * Math.PI) / 2, 28)

export function quad(p0: Pt, c: Pt, p1: Pt, n = 14): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    out.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]])
  }
  return out
}

/** The two short strokes of an arrow head at `to`, pointing away from `from`. */
function head(from: Pt, to: Pt, size: number, spread = 0.45): Pt[][] {
  const a = Math.atan2(to[1] - from[1], to[0] - from[0])
  const wing = (s: number): Pt[] => [
    [to[0] - size * Math.cos(a + s), to[1] - size * Math.sin(a + s)],
    to,
  ]
  return [wing(spread), wing(-spread)]
}

const MID = 30

// ── two-terminal parts: leads left and right on y = 30 ─────────────────────

function resistor(rng: Rng): Glyph {
  const teeth = rng.int(3, 6)
  const amp = rng.range(9, 15)
  const xs = rng.range(18, 26)
  const xe = 100 - xs
  const pts: Pt[] = [[xs, MID]]
  const n = teeth * 2
  for (let k = 0; k < n; k++) pts.push([xs + ((k + 0.5) * (xe - xs)) / n, MID + (k % 2 === 0 ? -amp : amp)])
  pts.push([xe, MID])
  return { variant: `zigzag-${teeth}`, strokes: [lead(0, MID, xs, MID), body(pts), lead(xe, MID, 100, MID)] }
}

function capacitor(rng: Rng): Glyph {
  const gap = rng.range(7, 16)
  const hh = rng.range(32, 46)
  const x1 = 50 - gap / 2
  const x2 = 50 + gap / 2
  return {
    variant: 'plates',
    strokes: [
      lead(0, MID, x1, MID), body(line(x1, MID - hh / 2, x1, MID + hh / 2)),
      body(line(x2, MID - hh / 2, x2, MID + hh / 2)), lead(x2, MID, 100, MID),
    ],
  }
}

function inductor(rng: Rng): Glyph {
  const humps = rng.int(3, 5)
  const xs = rng.range(16, 24)
  const xe = 100 - xs
  const w = (xe - xs) / humps
  const r = w / 2
  const ry = rng.range(0.9, 1.4) * r
  const pts: Pt[] = []
  for (let i = 0; i < humps; i++) pts.push(...arc(xs + w * (i + 0.5), MID, r, ry, Math.PI, 2 * Math.PI, 12))
  return { variant: `coil-${humps}`, strokes: [lead(0, MID, xs, MID), body(pts), lead(xe, MID, 100, MID)] }
}

/** Pose 0: the long (positive) plate is on the left. */
function battery(rng: Rng): Glyph {
  const cells = rng.chance(0.55) ? 1 : 2
  const longH = rng.range(34, 46)
  const shortH = longH * rng.range(0.45, 0.65)
  const pitch = rng.range(8, 13)
  const total = cells * 2
  const x0 = 50 - (pitch * (total - 1)) / 2
  const strokes: GlyphStroke[] = [lead(0, MID, x0, MID)]
  for (let i = 0; i < total; i++) {
    const h = i % 2 === 0 ? longH : shortH
    const x = x0 + pitch * i
    strokes.push(body(line(x, MID - h / 2, x, MID + h / 2)))
  }
  strokes.push(lead(x0 + pitch * (total - 1), MID, 100, MID))
  return { variant: `cells-${cells}`, strokes }
}

function sw(rng: Rng): Glyph {
  const xl = rng.range(20, 28)
  const xr = 100 - xl
  const rise = rng.range(14, 26)
  const dots = rng.chance(0.5)
  const strokes: GlyphStroke[] = [
    lead(0, MID, xl, MID), lead(xr, MID, 100, MID),
    body(line(xl, MID, xr - rng.range(2, 8), MID - rise)),
  ]
  if (dots) strokes.push(body(circle(xl, MID, 2.6)), body(circle(xr, MID, 2.6)))
  return { variant: dots ? 'blade-dots' : 'blade', strokes }
}

function bulb(rng: Rng): Glyph {
  const r = rng.range(19, 25)
  const k = r * Math.SQRT1_2
  return {
    variant: 'cross-circle',
    strokes: [
      lead(0, MID, 50 - r, MID), body(circle(50, MID, r)), lead(50 + r, MID, 100, MID),
      body(line(50 - k, MID - k, 50 + k, MID + k)), body(line(50 - k, MID + k, 50 + k, MID - k)),
    ],
  }
}

/** Pose 0: current flows left → right (anode left). */
function diodeShape(rng: Rng, led: boolean): Glyph {
  const xa = rng.range(32, 40)
  const xb = 100 - xa - rng.range(0, 4)
  const hh = rng.range(13, 19)
  const strokes: GlyphStroke[] = [
    lead(0, MID, xa, MID),
    body([[xa, MID - hh], [xa, MID + hh], [xb, MID], [xa, MID - hh]]),
    body(line(xb, MID - hh, xb, MID + hh)),
    lead(xb, MID, 100, MID),
  ]
  if (led) {
    for (const dx of [0, 12]) {
      const from: Pt = [xa + 12 + dx, MID - hh - 3]
      const to: Pt = [from[0] + 11, from[1] - 11]
      strokes.push(body([from, to]), ...head(from, to, 5).map(body))
    }
  }
  return { variant: led ? 'led-arrows' : 'triangle-bar', strokes }
}

function gnd(rng: Rng): Glyph {
  const top = rng.range(16, 22)
  const gap = rng.range(8, 11)
  const w = rng.range(46, 60)
  const strokes: GlyphStroke[] = [lead(50, 0, 50, top)]
  for (let i = 0; i < 3; i++) {
    const half = (w / 2) * (1 - i * 0.32)
    strokes.push(body(line(50 - half, top + gap * i, 50 + half, top + gap * i)))
  }
  return { variant: 'three-bars', strokes }
}

function acSource(rng: Rng): Glyph {
  const r = rng.range(19, 25)
  const sine: Pt[] = []
  const a = r * rng.range(0.28, 0.4)
  for (let i = 0; i <= 20; i++) {
    const t = i / 20
    sine.push([50 - r * 0.62 + t * r * 1.24, MID - a * Math.sin(t * 2 * Math.PI)])
  }
  return {
    variant: 'circle-sine',
    strokes: [lead(0, MID, 50 - r, MID), body(circle(50, MID, r)), lead(50 + r, MID, 100, MID), body(sine)],
  }
}

function meter(rng: Rng, letter: 'V' | 'A'): Glyph {
  const r = rng.range(19, 25)
  const s = r * 0.42
  const mark: GlyphStroke[] =
    letter === 'V'
      ? [body([[50 - s, MID - s], [50, MID + s], [50 + s, MID - s]])]
      : [body([[50 - s, MID + s], [50, MID - s], [50 + s, MID + s]]), body(line(50 - s * 0.5, MID + s * 0.3, 50 + s * 0.5, MID + s * 0.3))]
  return {
    variant: `circle-${letter}`,
    strokes: [lead(0, MID, 50 - r, MID), body(circle(50, MID, r)), lead(50 + r, MID, 100, MID), ...mark],
  }
}

// ── logic gates (ANSI/US): inputs left, output right ───────────────────────

const GATE_TOP = 8
const GATE_BOT = 52

function andBody(xl: number, xr: number): Pt[] {
  const r = (GATE_BOT - GATE_TOP) / 2
  const xc = xr - r
  return [[xl, GATE_TOP], [xc, GATE_TOP], ...arc(xc, MID, r, r, -Math.PI / 2, Math.PI / 2, 16).slice(1), [xl, GATE_BOT], [xl, GATE_TOP]]
}

function orBody(xl: number, tip: number): { outline: Pt[]; back: Pt[] } {
  const back = quad([xl, GATE_TOP], [xl + 15, MID], [xl, GATE_BOT])
  const top = quad([xl, GATE_TOP], [xl + (tip - xl) * 0.55, GATE_TOP], [tip, MID])
  const bot = quad([tip, MID], [xl + (tip - xl) * 0.55, GATE_BOT], [xl, GATE_BOT])
  return { outline: [...top, ...bot.slice(1)], back }
}

function gate(rng: Rng, kind: 'and' | 'or' | 'xor' | 'nand' | 'nor'): Glyph {
  const inverted = kind === 'nand' || kind === 'nor'
  const xl = rng.range(22, 28)
  const out = rng.range(70, 78)
  const bubbleR = rng.range(3.6, 5)
  const bodyR = inverted ? out - 2 * bubbleR : out
  const strokes: GlyphStroke[] = []
  if (kind === 'and' || kind === 'nand') {
    strokes.push(body(andBody(xl, bodyR)))
    strokes.push(lead(0, 20, xl, 20), lead(0, 40, xl, 40))
  } else {
    const { outline, back } = orBody(xl, bodyR)
    strokes.push(body(outline), body(back))
    const reach = xl + 4.5 // where the curved back sits at y = 20 / 40
    if (kind === 'xor') {
      const off = rng.range(5, 8)
      strokes.push(body(back.map(([x, y]): Pt => [x - off, y])))
      strokes.push(lead(0, 20, reach - off, 20), lead(0, 40, reach - off, 40))
    } else {
      strokes.push(lead(0, 20, reach, 20), lead(0, 40, reach, 40))
    }
  }
  let outStart = bodyR
  if (inverted) {
    strokes.push(body(circle(bodyR + bubbleR, MID, bubbleR)))
    outStart = bodyR + 2 * bubbleR
  }
  strokes.push(lead(outStart, MID, 100, MID))
  return { variant: kind, strokes }
}

function notGate(rng: Rng): Glyph {
  const xl = rng.range(26, 34)
  const tip = rng.range(62, 70)
  const bubbleR = rng.range(3.6, 5)
  const hh = rng.range(15, 21)
  return {
    variant: 'triangle-bubble',
    strokes: [
      lead(0, MID, xl, MID),
      body([[xl, MID - hh], [xl, MID + hh], [tip, MID], [xl, MID - hh]]),
      body(circle(tip + bubbleR, MID, bubbleR)),
      lead(tip + 2 * bubbleR, MID, 100, MID),
    ],
  }
}

// ── three-terminal and active parts ────────────────────────────────────────

/** Pose 0: base on the left, collector up-right, emitter down-right (NPN, arrow out). */
function bjt(rng: Rng): Glyph {
  const ring = rng.chance(0.6)
  const bx = rng.range(36, 42)
  const spread = rng.range(10, 14)
  const ex: Pt = [bx + 24, MID + 20]
  const strokes: GlyphStroke[] = [
    lead(0, MID, bx, MID),
    body(line(bx, MID - spread - 4, bx, MID + spread + 4)),
    body([[bx, MID - spread + 3], [bx + 24, MID - 20], [bx + 24, 0]]),
    body([[bx, MID + spread - 3], ex, [ex[0], 60]]),
  ]
  const from: Pt = [bx + 6, MID + spread + 1]
  strokes.push(...head(from, [bx + 18, MID + 16.5], 5.5).map(body))
  if (ring) strokes.push(body(circle(bx + 8, MID, 26)))
  return { variant: ring ? 'npn-ring' : 'npn', strokes }
}

/** Pose 0: gate left, drain up, source down; enhancement NMOS with the three-piece channel. */
function mosfet(rng: Rng): Glyph {
  const gx = rng.range(28, 34)
  const cx = gx + rng.range(7, 10)
  const right = cx + 22
  const strokes: GlyphStroke[] = [
    lead(0, 38, gx, 38),
    body(line(gx, 12, gx, 48)),
    body(line(cx, 10, cx, 22)), body(line(cx, 26, cx, 34)), body(line(cx, 38, cx, 50)),
    body([[cx, 16], [right, 16], [right, 0]]),
    body([[cx, 44], [right, 44], [right, 60]]),
    body([[cx + 1, MID], [right, MID], [right, 44]]),
  ]
  strokes.push(...head([right, MID], [cx + 1, MID], 5).map(body))
  return { variant: 'nmos', strokes }
}

/** Pose 0: inputs on the left (− above +), output at the right tip. */
function opamp(rng: Rng): Glyph {
  const xl = rng.range(20, 26)
  const tip = 100 - rng.range(18, 24)
  const swap = rng.chance(0.3)
  const plus = (y: number): GlyphStroke[] => [body(line(xl + 4, y, xl + 12, y)), body(line(xl + 8, y - 4, xl + 8, y + 4))]
  const minus = (y: number): GlyphStroke[] => [body(line(xl + 4, y, xl + 12, y))]
  return {
    variant: swap ? 'plus-top' : 'minus-top',
    strokes: [
      body([[xl, 4], [xl, 56], [tip, MID], [xl, 4]]),
      lead(0, 18, xl, 18), lead(0, 42, xl, 42), lead(tip, MID, 100, MID),
      ...(swap ? [...plus(18), ...minus(42)] : [...minus(18), ...plus(42)]),
    ],
  }
}

export const GLYPHS: Record<Wave1Class, (rng: Rng) => Glyph> = {
  battery,
  resistor,
  capacitor,
  inductor,
  switch: sw,
  bulb,
  led: (r) => diodeShape(r, true),
  diode: (r) => diodeShape(r, false),
  gnd,
  'ac-source': acSource,
  voltmeter: (r) => meter(r, 'V'),
  ammeter: (r) => meter(r, 'A'),
  'and-gate': (r) => gate(r, 'and'),
  'or-gate': (r) => gate(r, 'or'),
  'xor-gate': (r) => gate(r, 'xor'),
  'nand-gate': (r) => gate(r, 'nand'),
  'nor-gate': (r) => gate(r, 'nor'),
  'not-gate': notGate,
  bjt,
  mosfet,
  opamp,
}

// ── where the wires go ─────────────────────────────────────────────────────
// Pin positions in the same 100 × 60 frame, at pose 0, for a typical drawing of
// each class. Names are SimScript anchors (what the IR and compiler use).
// lib/sketch/pins.ts turns these into bounding-box fractions — calibrated against
// real glyph output by scripts/ai/sketch/calibrate-pins.mjs — which is what the
// wire matcher actually uses; this table is the single source they derive from.

export interface FramePin {
  name: string
  x: number
  y: number
}

const two = (a: string, b: string): FramePin[] => [{ name: a, x: 0, y: MID }, { name: b, x: 100, y: MID }]

export const PIN_FRAME: Record<Wave1Class, FramePin[]> = {
  battery: two('positive', 'negative'), // pose 0: the long (positive) plate is on the left
  resistor: two('a', 'b'),
  capacitor: two('a', 'b'),
  inductor: two('a', 'b'),
  switch: two('a', 'b'),
  bulb: two('a', 'b'),
  led: two('anode', 'cathode'),
  diode: two('anode', 'cathode'),
  gnd: [{ name: 'terminal', x: 50, y: 0 }],
  'ac-source': two('positive', 'negative'),
  voltmeter: two('a', 'b'),
  ammeter: two('a', 'b'),
  'and-gate': [{ name: 'input1', x: 0, y: 20 }, { name: 'input2', x: 0, y: 40 }, { name: 'output', x: 100, y: MID }],
  'or-gate': [{ name: 'input1', x: 0, y: 20 }, { name: 'input2', x: 0, y: 40 }, { name: 'output', x: 100, y: MID }],
  'xor-gate': [{ name: 'input1', x: 0, y: 20 }, { name: 'input2', x: 0, y: 40 }, { name: 'output', x: 100, y: MID }],
  'nand-gate': [{ name: 'input1', x: 0, y: 20 }, { name: 'input2', x: 0, y: 40 }, { name: 'output', x: 100, y: MID }],
  'nor-gate': [{ name: 'input1', x: 0, y: 20 }, { name: 'input2', x: 0, y: 40 }, { name: 'output', x: 100, y: MID }],
  'not-gate': [{ name: 'input', x: 0, y: MID }, { name: 'output', x: 100, y: MID }],
  bjt: [{ name: 'base', x: 0, y: MID }, { name: 'collector', x: 63, y: 0 }, { name: 'emitter', x: 63, y: 60 }],
  mosfet: [{ name: 'gate', x: 0, y: 38 }, { name: 'drain', x: 62, y: 0 }, { name: 'source', x: 62, y: 60 }],
  // minus-on-top is the common drawing; plus-on-top is the 30 % variant (see opamp()).
  opamp: [{ name: 'in-', x: 0, y: 18 }, { name: 'in+', x: 0, y: 42 }, { name: 'out', x: 100, y: MID }],
}
