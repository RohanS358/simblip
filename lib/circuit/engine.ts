// Circuit engine — the electrical/electronics/digital solver.
//
// Build once per Play: symbol terminals + drawn wires become nets (union-find
// with a snap radius), then each 120 Hz step runs Modified Nodal Analysis
// (KCL/KVL, Ohm's law; backward-Euler companion models for C and L; iterated
// piecewise states for diode/LED/BJT/MOSFET; ideal op-amp as a constrained
// source) plus a fixpoint digital logic pass (gates, D-FF, MUX, clock).
//
// Results (readings, per-wire current flow, per-pin logic levels) live in
// plain maps outside React; the world runtime syncs them to the DOM — the
// same pattern the physics engine uses (docs/physics-engine.md).

import type { SceneObject } from '@/lib/scene/types'

// ── Terminals (fractions of the object bbox) ────────────────────────────────

export interface TerminalDef {
  x: number
  y: number
}

const T2: TerminalDef[] = [
  { x: 0, y: 0.5 },
  { x: 1, y: 0.5 },
]
const GATE3: TerminalDef[] = [
  { x: 0, y: 0.333 },
  { x: 0, y: 0.667 },
  { x: 1, y: 0.5 },
]

// Dependent-source / two-port terminal layout: [ctrl+, ctrl−, out+, out−].
const T4: TerminalDef[] = [
  { x: 0, y: 0.2 },
  { x: 0, y: 0.8 },
  { x: 1, y: 0.2 },
  { x: 1, y: 0.8 },
]

export const TERMINALS: Record<string, TerminalDef[]> = {
  resistor: T2,
  capacitor: T2,
  inductor: T2,
  battery: T2, // [+, −]
  'ac-source': T2,
  'current-source': T2, // [+, −] — current flows internally − → + (out of +)
  'dc-machine': T2, // armature [+, −] — self-contained shaft: see comp.state.omega
  'pressure-plate': T2, // closes like a switch when a rigid body touches it (physics-driven, not user-toggled)
  switch: T2,
  fuse: T2,
  bulb: T2,
  diode: T2, // [anode, cathode]
  led: T2,
  zener: T2, // [anode, cathode] — conducts forward at Vf, breaks down in reverse at Vz
  ammeter: T2,
  voltmeter: T2,
  wattmeter: [
    { x: 0, y: 0.2 }, // current coil +
    { x: 0, y: 0.8 }, // current coil −
    { x: 1, y: 0.2 }, // voltage coil +
    { x: 1, y: 0.8 }, // voltage coil −
  ],
  potentiometer: [
    { x: 0, y: 0 }, // top
    { x: 0.5, y: 1 }, // wiper
    { x: 1, y: 0 }, // bottom
  ],
  gnd: [{ x: 0.5, y: 0.12 }],
  probe: [{ x: 0.5, y: 1 }],
  'logic-probe': [{ x: 0.5, y: 1 }],
  bjt: [
    { x: 0, y: 0.5 },
    { x: 0.583, y: 0.083 },
    { x: 0.583, y: 0.917 },
  ], // [B, C, E]
  'bjt-pnp': [
    { x: 0, y: 0.5 },
    { x: 0.583, y: 0.083 },
    { x: 0.583, y: 0.917 },
  ], // [B, C, E]
  mosfet: [
    { x: 0, y: 0.5 },
    { x: 0.708, y: 0.125 },
    { x: 0.708, y: 0.875 },
  ], // [G, D, S]
  'mosfet-pmos': [
    { x: 0, y: 0.5 },
    { x: 0.708, y: 0.125 },
    { x: 0.708, y: 0.875 },
  ], // [G, D, S]
  opamp: [
    { x: 0, y: 0.3125 },
    { x: 0, y: 0.6875 },
    { x: 1, y: 0.5 },
  ], // [in+, in−, out]
  vcvs: T4, // voltage-controlled voltage source
  vccs: T4, // voltage-controlled current source
  ccvs: T4, // current-controlled voltage source (ctrl pins carry the sensed current)
  cccs: T4, // current-controlled current source
  transformer: [
    { x: 0, y: 0.2 }, // primary +
    { x: 0, y: 0.8 }, // primary −
    { x: 1, y: 0.2 }, // secondary +
    { x: 1, y: 0.8 }, // secondary −
  ],
  'transformer-ct': [
    { x: 0, y: 0.2 }, // primary +
    { x: 0, y: 0.8 }, // primary −
    { x: 1, y: 0.1 }, // secondary 1
    { x: 1, y: 0.5 }, // center tap
    { x: 1, y: 0.9 }, // secondary 2
  ],
  'three-phase-source': [
    { x: 0.2, y: 0 }, // A
    { x: 0.5, y: 0 }, // B
    { x: 0.8, y: 0 }, // C
    { x: 0.5, y: 1 }, // N (star point)
  ],
  'induction-motor': [
    { x: 0, y: 0.2 }, // A
    { x: 0, y: 0.5 }, // B
    { x: 0, y: 0.8 }, // C
    { x: 1, y: 0.5 }, // N (wire to the source's neutral)
  ],
  'and-gate': GATE3,
  'or-gate': GATE3,
  'xor-gate': GATE3,
  'nand-gate': GATE3,
  'nor-gate': GATE3,
  'not-gate': [
    { x: 0, y: 0.5 },
    { x: 1, y: 0.5 },
  ],
  'd-ff': GATE3, // [D, CLK, Q]
  mux: [
    { x: 0, y: 0.25 },
    { x: 0, y: 0.5 },
    { x: 0, y: 0.75 },
    { x: 1, y: 0.5 },
  ], // [in0, in1, sel, out]
  input: [{ x: 1, y: 0.5 }],
  clock: [{ x: 1, y: 0.5 }],
  output: [{ x: 0, y: 0.5 }],
  'half-adder': [
    { x: 0, y: 0.333 },
    { x: 0, y: 0.667 },
    { x: 1, y: 0.333 },
    { x: 1, y: 0.667 },
  ], // [A, B, S, C]
  'full-adder': [
    { x: 0, y: 0.25 },
    { x: 0, y: 0.5 },
    { x: 0, y: 0.75 },
    { x: 1, y: 0.333 },
    { x: 1, y: 0.667 },
  ], // [A, B, Cin, S, Cout]
  'sr-latch': [
    { x: 0, y: 0.333 },
    { x: 0, y: 0.667 },
    { x: 1, y: 0.5 },
  ], // [S, R, Q]
  'jk-ff': [
    { x: 0, y: 0.25 },
    { x: 0, y: 0.5 },
    { x: 0, y: 0.75 },
    { x: 1, y: 0.5 },
  ], // [J, CLK, K, Q]
  decoder: [
    { x: 0, y: 0.333 },
    { x: 0, y: 0.667 },
    { x: 1, y: 0.2 },
    { x: 1, y: 0.4 },
    { x: 1, y: 0.6 },
    { x: 1, y: 0.8 },
  ], // [A(lsb), B, Y0..Y3]
  comparator: [
    { x: 0, y: 0.333 },
    { x: 0, y: 0.667 },
    { x: 1, y: 0.25 },
    { x: 1, y: 0.5 },
    { x: 1, y: 0.75 },
  ], // [A, B, A<B, A=B, A>B]
  't-ff': GATE3, // [T, CLK, Q]
  tristate: GATE3, // [in, enable, out]
  'seven-seg': Array.from({ length: 7 }, (_, i) => ({ x: 0, y: (i + 1) / 8 })), // [a, b, c, d, e, f, g]
  'bcd-7seg': [
    { x: 0, y: 0.2 },
    { x: 0, y: 0.4 },
    { x: 0, y: 0.6 },
    { x: 0, y: 0.8 }, // A, B, C, D (BCD in, LSB first)
    ...Array.from({ length: 7 }, (_, i) => ({ x: 1, y: (i + 1) / 8 })), // a..g out
  ],
  counter4: [
    { x: 0, y: 0.5 }, // CLK
    { x: 1, y: 0.2 },
    { x: 1, y: 0.4 },
    { x: 1, y: 0.6 },
    { x: 1, y: 0.8 }, // Q0..Q3
  ],
  // Variable-model fallbacks (isElectrical only checks this static table —
  // terminalsOf() computes the real layout per model at netlist-build time).
  demux: [
    { x: 0, y: 0.5 },
    { x: 0.5, y: 0 },
    { x: 1, y: 0.333 },
    { x: 1, y: 0.667 },
  ], // 1:2 default — [in, sel, out0, out1]
  encoder: [
    { x: 0, y: 0.2 },
    { x: 0, y: 0.4 },
    { x: 0, y: 0.6 },
    { x: 0, y: 0.8 },
    { x: 1, y: 0.4 },
    { x: 1, y: 0.6 },
  ], // 4:2 default — [in0..in3, out0, out1]
  register4: [
    { x: 0, y: 0.3 },
    { x: 0, y: 0.7 },
    { x: 1, y: 0.5 },
  ], // SISO default — [SIN, CLK, SOUT]
}

// ── Variable component models ───────────────────────────────────────────────
// Gates take 2–8 inputs, MUX is 2:1 or 4:1, decoder 2:4 or 3:8 — chosen via
// an `inputs` number param on the object (absent = the familiar default).
// Terminals, glyph stubs and the logic pass all derive from terminalsOf().

export const VARIABLE_INPUTS = new Set(['and-gate', 'or-gate', 'xor-gate', 'nand-gate', 'nor-gate'])

export function inputCountOf(obj: SceneObject): number {
  const sym = obj.geometry.symbol ?? ''
  const p = obj.parameters.inputs
  const raw = p?.kind === 'number' ? Math.round(p.value) : NaN
  if (VARIABLE_INPUTS.has(sym)) return Number.isFinite(raw) ? Math.min(8, Math.max(2, raw)) : 2
  if (sym === 'mux' || sym === 'demux') return raw === 4 ? 4 : 2
  if (sym === 'decoder') return raw === 3 ? 3 : 2
  if (sym === 'encoder') return raw === 8 ? 8 : 4
  if (sym === 'register4') return Number.isFinite(raw) ? Math.min(3, Math.max(0, raw)) : 0
  return 0
}

/** Terminal layout for an object, honoring its model (input count). */
export function terminalsOf(obj: SceneObject): TerminalDef[] {
  const sym = obj.geometry.symbol ?? ''
  const n = inputCountOf(obj)
  if (VARIABLE_INPUTS.has(sym) && n > 2) {
    return [
      ...Array.from({ length: n }, (_, i) => ({ x: 0, y: (i + 1) / (n + 1) })),
      { x: 1, y: 0.5 },
    ]
  }
  if (sym === 'mux' && n === 4) {
    // [in0..in3, sel0, sel1, out] — selects enter from the bottom.
    return [
      { x: 0, y: 0.2 },
      { x: 0, y: 0.4 },
      { x: 0, y: 0.6 },
      { x: 0, y: 0.8 },
      { x: 0.38, y: 1 },
      { x: 0.62, y: 1 },
      { x: 1, y: 0.5 },
    ]
  }
  if (sym === 'decoder' && n === 3) {
    // [A, B, C, Y0..Y7]
    return [
      { x: 0, y: 0.25 },
      { x: 0, y: 0.5 },
      { x: 0, y: 0.75 },
      ...Array.from({ length: 8 }, (_, i) => ({ x: 1, y: (i + 1) / 9 })),
    ]
  }
  if (sym === 'demux' && n === 4) {
    // [in, sel0, sel1, out0..out3] — selects enter from the top.
    return [
      { x: 0, y: 0.5 },
      { x: 0.38, y: 0 },
      { x: 0.62, y: 0 },
      { x: 1, y: 0.2 },
      { x: 1, y: 0.4 },
      { x: 1, y: 0.6 },
      { x: 1, y: 0.8 },
    ]
  }
  if (sym === 'demux') {
    // 1:2 — [in, sel, out0, out1]
    return [
      { x: 0, y: 0.5 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0.333 },
      { x: 1, y: 0.667 },
    ]
  }
  if (sym === 'encoder' && n === 8) {
    // 8:3 — [in0..in7, out0..out2]
    return [
      ...Array.from({ length: 8 }, (_, i) => ({ x: 0, y: (i + 1) / 9 })),
      { x: 1, y: 0.35 },
      { x: 1, y: 0.5 },
      { x: 1, y: 0.65 },
    ]
  }
  if (sym === 'encoder') {
    // 4:2 — [in0..in3, out0, out1]
    return [
      ...Array.from({ length: 4 }, (_, i) => ({ x: 0, y: (i + 1) / 5 })),
      { x: 1, y: 0.4 },
      { x: 1, y: 0.6 },
    ]
  }
  if (sym === 'register4') {
    if (n === 1) return [{ x: 0, y: 0.3 }, { x: 0, y: 0.7 }, { x: 1, y: 0.2 }, { x: 1, y: 0.4 }, { x: 1, y: 0.6 }, { x: 1, y: 0.8 }] // SIPO: SIN, CLK, Q0..Q3
    if (n === 2) return [{ x: 0, y: 0.15 }, { x: 0, y: 0.35 }, { x: 0, y: 0.55 }, { x: 0, y: 0.75 }, { x: 0.35, y: 0 }, { x: 0.65, y: 0 }, { x: 1, y: 0.5 }] // PISO: D0..D3, LOAD, CLK, SOUT
    if (n === 3) return [{ x: 0, y: 0.15 }, { x: 0, y: 0.35 }, { x: 0, y: 0.55 }, { x: 0, y: 0.75 }, { x: 0.5, y: 0 }, { x: 1, y: 0.15 }, { x: 1, y: 0.35 }, { x: 1, y: 0.55 }, { x: 1, y: 0.75 }] // PIPO: D0..D3, CLK, Q0..Q3
    return [{ x: 0, y: 0.3 }, { x: 0, y: 0.7 }, { x: 1, y: 0.5 }] // SISO: SIN, CLK, SOUT
  }
  return TERMINALS[sym] ?? []
}

/**
 * Minimum box height so a wide model's same-edge pins clear the wire snap
 * radius (SNAP) — a 96×48 8-input gate packs pins 5px apart, well inside
 * SNAP=14, so a wire meant for one pin can bond to its neighbor instead.
 * Returns null when the default 48px box is already safe (narrow models).
 */
export function recommendedHeight(symbol: string, n: number): number | null {
  const gap = 18 // > SNAP with margin
  if (VARIABLE_INPUTS.has(symbol) && n > 2) return Math.ceil(gap * (n + 1))
  if ((symbol === 'mux' || symbol === 'demux') && n === 4) return Math.ceil(gap * 5)
  if (symbol === 'decoder' && n === 3) return Math.ceil(gap * 9)
  if (symbol === 'encoder' && n === 8) return Math.ceil(gap * 9)
  return null
}

const GATES = new Set(['and-gate', 'or-gate', 'xor-gate', 'nand-gate', 'nor-gate', 'not-gate'])
const DIGITAL = new Set([
  ...GATES,
  'd-ff', 'mux', 'input', 'clock', 'output',
  'half-adder', 'full-adder', 'sr-latch', 'jk-ff', 'decoder', 'comparator',
  't-ff', 'tristate', 'demux', 'encoder', 'seven-seg', 'bcd-7seg', 'register4', 'counter4',
])

export const SNAP = 14

// Default parameter values (used when an object lacks the param).
const DEF: Record<string, Record<string, number>> = {
  resistor: { R: 100 },
  bulb: { R: 20 },
  capacitor: { C: 0.001 },
  inductor: { L: 0.1 },
  battery: { V: 9 },
  'ac-source': { V: 12, f: 1, wave: 0 }, // wave: 0=sine, 1=square, 2=triangle
  'current-source': { I: 0.01 },
  'dc-machine': { Ra: 2, k: 0.5, J: 0.02, load: 0, friction: 0.001 },
  'induction-motor': { R2: 5, X: 8, poles: 4, f: 50, J: 0.05, load: 0, friction: 0.001 },
  switch: { closed: 1 },
  fuse: { Imax: 1 },
  diode: { Vf: 0.7 },
  led: { Vf: 2 },
  zener: { Vf: 0.7, Vz: 5.1 },
  potentiometer: { R: 1000, ratio: 0.5 },
  mosfet: { Vt: 2 },
  'mosfet-pmos': { Vt: 2 },
  opamp: { gain: 1e5 },
  vcvs: { gain: 2 },
  vccs: { gm: 0.01 },
  ccvs: { r: 100 },
  cccs: { beta: 2 },
  transformer: { n: 2 },
  'transformer-ct': { n: 2 },
  'three-phase-source': { V: 220, f: 50 },
  input: { value: 0 },
  clock: { f: 1 },
  encoder: { priority: 0 },
  counter4: { mod: 16, dir: 0 },
}

/** AC waveform generator — function-generator style: sine, square, triangle. */
function waveform(kind: number, phaseAngle: number): number {
  const wrapped = ((phaseAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  if (kind >= 1.5) {
    // triangle: linear ramp −1..1..−1 over the cycle
    const frac = wrapped / (2 * Math.PI)
    return frac < 0.5 ? 4 * frac - 1 : 3 - 4 * frac
  }
  if (kind >= 0.5) return wrapped < Math.PI ? 1 : -1 // square
  return Math.sin(wrapped)
}

/** How many extra MNA unknowns (branch currents) a component's stamp needs. */
function vsrcRowsFor(symbol: string): number {
  if (symbol === 'battery' || symbol === 'ac-source' || symbol === 'opamp') return 1
  if (symbol === 'vcvs' || symbol === 'cccs' || symbol === 'transformer') return 1
  if (symbol === 'ccvs' || symbol === 'transformer-ct') return 2
  if (symbol === 'three-phase-source') return 3
  return 0
}

// ── Geometry helpers ────────────────────────────────────────────────────────

function rotatePoint(x: number, y: number, cx: number, cy: number, deg: number) {
  if (!deg) return { x, y }
  const r = (deg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const dx = x - cx
  const dy = y - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

export function terminalWorld(obj: SceneObject, t: TerminalDef): { x: number; y: number } {
  const cx = obj.position.x + obj.size.w / 2
  const cy = obj.position.y + obj.size.h / 2
  return rotatePoint(obj.position.x + t.x * obj.size.w, obj.position.y + t.y * obj.size.h, cx, cy, obj.rotation)
}

function wireWorldPoints(obj: SceneObject): number[][] {
  const pts = obj.geometry.points ?? [
    [0, 0],
    [obj.size.w, 0],
  ]
  const cx = obj.position.x + obj.size.w / 2
  const cy = obj.position.y + obj.size.h / 2
  return pts.map(([x, y]) => {
    const p = rotatePoint(obj.position.x + x, obj.position.y + y, cx, cy, obj.rotation)
    return [p.x, p.y]
  })
}

/** Lines/strokes conduct if they carry a wire behavior — or are bare ink. */
export function isConductor(o: SceneObject): boolean {
  if (o.geometry.kind !== 'line' && o.geometry.kind !== 'stroke') return false
  if (o.behaviors.some((b) => b.enabled && b.type === 'wire')) return true
  return o.behaviors.length === 0
}

function isElectrical(o: SceneObject): boolean {
  return (
    o.geometry.kind === 'symbol' &&
    Boolean(TERMINALS[o.geometry.symbol ?? '']) &&
    !o.behaviors.some((b) => b.type === 'electricalNode' && !b.enabled)
  )
}

function segDist(px: number, py: number, a: number[], b: number[]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0
  return Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t))
}

function polyDist(px: number, py: number, pts: number[][]): number {
  if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1])
  let min = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const d = segDist(px, py, pts[i], pts[i + 1])
    if (d < min) min = d
  }
  return min
}

/** Is this page point on a component terminal? (canvas uses it to auto-wire pen strokes) */
export function nearTerminal(
  objects: Iterable<SceneObject>,
  p: { x: number; y: number },
  snap = SNAP
): boolean {
  for (const o of objects) {
    if (!isElectrical(o)) continue
    for (const t of terminalsOf(o)) {
      const w = terminalWorld(o, t)
      if (Math.hypot(w.x - p.x, w.y - p.y) < snap) return true
    }
  }
  return false
}

/** World position of the closest terminal within snap range, or null —
 *  lets a drawn wire's endpoint land EXACTLY on the pin, no gap. */
export function nearestTerminal(
  objects: Iterable<SceneObject>,
  p: { x: number; y: number },
  snap = SNAP
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null
  let bestD = snap
  for (const o of objects) {
    if (!isElectrical(o)) continue
    for (const t of terminalsOf(o)) {
      const w = terminalWorld(o, t)
      const d = Math.hypot(w.x - p.x, w.y - p.y)
      if (d < bestD) {
        bestD = d
        best = { x: w.x, y: w.y }
      }
    }
  }
  return best
}

// ── Circuit structures ──────────────────────────────────────────────────────

export interface CircuitComponent {
  id: string
  symbol: string
  nets: number[]
  state: Record<string, number>
  vsrcRow?: number // battery / ac-source / opamp extra unknown
  outflow: number[] // per-terminal current INTO the net (amps), updated per step
}

interface CircuitWire {
  id: string
  net: number
  attach?: { comp: number; term: number; end: 0 | 1 }
  charge: number // ∫ flow-speed dt, drives dash offset
}

export interface WireFlow {
  current: number
  charge: number
  intensity: number // 0..1 overlay opacity
  digital?: number // 0/1 when the net is logic-driven
}

export interface Reading {
  text?: string
  glow?: number
  channels?: Record<string, number>
}

export interface Circuit {
  netCount: number
  ref: number
  nVsrc: number
  comps: CircuitComponent[]
  wires: CircuitWire[]
  digitalNets: Set<number>
  logic: number[] // per-net logic level
  frame: {
    readings: Map<string, Reading>
    wires: Map<string, WireFlow>
    pins: Map<string, number[]>
  }
}

// ── Build: objects → nets ───────────────────────────────────────────────────

export function buildCircuit(objects: SceneObject[]): Circuit | null {
  const comps = objects.filter(isElectrical)
  if (comps.length === 0) return null
  const wires = objects.filter(isConductor).map((o) => ({ obj: o, pts: wireWorldPoints(o) }))

  // terminals flattened, then wires — one union-find item each
  const termPts: { comp: number; term: number; x: number; y: number; item: number }[] = []
  const termBase: number[] = []
  let itemCount = 0
  comps.forEach((o, ci) => {
    termBase.push(itemCount)
    const defs = terminalsOf(o)
    defs.forEach((td, ti) => {
      const w = terminalWorld(o, td)
      termPts.push({ comp: ci, term: ti, x: w.x, y: w.y, item: itemCount++ })
    })
  })
  const wireBase = itemCount
  itemCount += wires.length

  const parent = Array.from({ length: itemCount }, (_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b)
  }

  // terminal ↔ terminal (abutting components), and all grounds are one earth.
  // Never auto-union two terminals of the SAME component — multi-pin parts
  // (3+ input gates, decoders, mux 4:1…) routinely pack pins closer than
  // SNAP on a compact glyph; those are always logically distinct nets.
  // And bond each pin only to the CLOSEST in-range pin of any other
  // component: on compact glyphs several foreign pins can sit inside SNAP,
  // and grabbing them all shorts logically distinct nets together.
  for (let i = 0; i < termPts.length; i++) {
    const nearest = new Map<number, { item: number; d: number }>() // other comp → closest pin
    for (let j = 0; j < termPts.length; j++) {
      if (j === i || termPts[i].comp === termPts[j].comp) continue
      const d = Math.hypot(termPts[i].x - termPts[j].x, termPts[i].y - termPts[j].y)
      if (d >= SNAP) continue
      const cur = nearest.get(termPts[j].comp)
      if (!cur || d < cur.d) nearest.set(termPts[j].comp, { item: termPts[j].item, d })
    }
    for (const { item } of nearest.values()) union(termPts[i].item, item)
  }
  const gndItems = termPts.filter((tp) => comps[tp.comp].geometry.symbol === 'gnd').map((tp) => tp.item)
  for (let i = 1; i < gndItems.length; i++) union(gndItems[0], gndItems[i])

  // terminal ↔ wire (anywhere along the wire), wire endpoint ↔ wire.
  // Same closest-pin rule: a wire ending on one pin of a compact part must
  // not also grab the neighbouring pins sitting inside the snap radius.
  wires.forEach((w, wi) => {
    const nearest = new Map<number, { item: number; d: number }>() // comp → closest pin
    for (const tp of termPts) {
      const d = polyDist(tp.x, tp.y, w.pts)
      if (d >= SNAP) continue
      const cur = nearest.get(tp.comp)
      if (!cur || d < cur.d) nearest.set(tp.comp, { item: tp.item, d })
    }
    for (const { item } of nearest.values()) union(item, wireBase + wi)
    wires.forEach((w2, wj) => {
      if (wi === wj) return
      const ends = [w.pts[0], w.pts[w.pts.length - 1]]
      for (const e of ends) {
        if (polyDist(e[0], e[1], w2.pts) < SNAP) union(wireBase + wi, wireBase + wj)
      }
    })
  })

  // roots → compact net ids; only keep wires whose net touches a terminal
  const netOf = new Map<number, number>()
  const netId = (item: number): number => {
    const root = find(item)
    let id = netOf.get(root)
    if (id === undefined) {
      id = netOf.size
      netOf.set(root, id)
    }
    return id
  }
  const terminalNets = new Set(termPts.map((tp) => netId(tp.item)))

  let nVsrc = 0
  const circComps: CircuitComponent[] = comps.map((o, ci) => {
    const defs = terminalsOf(o)
    const nets = defs.map((_, ti) => netId(termPts[termBase[ci] + ti].item))
    const symbol = o.geometry.symbol!
    const comp: CircuitComponent = {
      id: o.id,
      symbol,
      nets,
      state: {},
      outflow: nets.map(() => 0),
    }
    const rows = vsrcRowsFor(symbol)
    if (rows > 0) {
      comp.vsrcRow = nVsrc
      nVsrc += rows
    }
    return comp
  })

  const circWires: CircuitWire[] = []
  wires.forEach((w, wi) => {
    const net = netId(wireBase + wi)
    if (!terminalNets.has(net)) return // pure doodle — stays ink
    const cw: CircuitWire = { id: w.obj.id, net, charge: 0 }
    const ends: [number[], 0 | 1][] = [
      [w.pts[0], 0],
      [w.pts[w.pts.length - 1], 1],
    ]
    for (const [ep, end] of ends) {
      let tp: (typeof termPts)[number] | undefined
      let bestD = SNAP
      for (const p of termPts) {
        const d = Math.hypot(p.x - ep[0], p.y - ep[1])
        if (d < bestD) {
          bestD = d
          tp = p
        }
      }
      if (tp) {
        cw.attach = { comp: tp.comp, term: tp.term, end }
        break
      }
    }
    circWires.push(cw)
  })

  const digitalNets = new Set<number>()
  circComps.forEach((c) => {
    if (DIGITAL.has(c.symbol)) c.nets.forEach((n) => digitalNets.add(n))
  })

  // reference: earth if drawn, else a source's negative terminal
  const gndComp = circComps.find((c) => c.symbol === 'gnd')
  const src = circComps.find((c) => c.symbol === 'battery') ?? circComps.find((c) => c.symbol === 'ac-source')
  const ref = gndComp ? gndComp.nets[0] : src ? src.nets[1] : 0

  return {
    netCount: netOf.size,
    ref,
    nVsrc,
    comps: circComps,
    wires: circWires,
    digitalNets,
    logic: new Array(netOf.size).fill(0),
    frame: { readings: new Map(), wires: new Map(), pins: new Map() },
  }
}

// ── Linear solve (Gaussian elimination, partial pivoting) ──────────────────

function solveLinear(A: number[][], z: number[]): number[] {
  const n = z.length
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    if (Math.abs(A[piv][col]) < 1e-13) {
      A[col][col] = 1
      z[col] = 0
      continue
    }
    if (piv !== col) {
      const tr = A[piv]
      A[piv] = A[col]
      A[col] = tr
      const tz = z[piv]
      z[piv] = z[col]
      z[col] = tz
    }
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col]
      if (!f) continue
      for (let cc = col; cc < n; cc++) A[r][cc] -= f * A[col][cc]
      z[r] -= f * z[col]
    }
  }
  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = z[r]
    for (let cc = r + 1; cc < n; cc++) s -= A[r][cc] * x[cc]
    x[r] = A[r][r] ? s / A[r][r] : 0
  }
  return x
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function fmtUnit(v: number, unit: string): string {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)} M${unit}`
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)} k${unit}`
  if (a >= 1) return `${v.toFixed(2)} ${unit}`
  if (a >= 1e-3) return `${(v * 1e3).toFixed(1)} m${unit}`
  if (a >= 1e-6) return `${(v * 1e6).toFixed(1)} µ${unit}`
  return `0 ${unit}`
}

// ── Step ────────────────────────────────────────────────────────────────────

const OPEN = 1e-9 // conductance of an open branch
const CLOSED = 1e3 // conductance of a closed switch / ammeter shunt
// Digital logic HIGH represents a real 5V rail wherever a digital net meets
// the analog world (a gate/output/clock pin wired to a resistor, LED, or
// voltmeter) — see the digital→analog bridge stamp in assemble(). Modeled
// as a Norton source (small source resistance) rather than an ideal
// vsrcRow: no new MNA unknown needed, and it's a bit more realistic (a real
// logic output isn't a zero-ohm source either).
const DIGITAL_HIGH_V = 5
const DIGITAL_SOURCE_R = 20

export function stepCircuit(
  c: Circuit,
  dt: number,
  t: number,
  objects: Record<string, SceneObject>
) {
  const pv = (comp: CircuitComponent, name: string): number => {
    const p = objects[comp.id]?.parameters[name]
    const d = DEF[comp.symbol]?.[name] ?? 0
    return p?.kind === 'number' && Number.isFinite(p.value) ? p.value : d
  }

  stepDigital(c, t, pv)

  // ── analog MNA ──
  const n = c.netCount
  const N = n + c.nVsrc
  const A: number[][] = Array.from({ length: N }, () => new Array(N).fill(0))
  const z: number[] = new Array(N).fill(0)
  let x: number[] = new Array(N).fill(0)

  const assemble = () => {
    for (let r = 0; r < N; r++) {
      A[r].fill(0)
      z[r] = 0
    }
    for (let i = 0; i < n; i++) A[i][i] += OPEN // gmin keeps floating nets solvable

    const stampG = (a: number, b: number, g: number) => {
      A[a][a] += g
      A[b][b] += g
      A[a][b] -= g
      A[b][a] -= g
    }
    const stampI = (a: number, b: number, J: number) => {
      // current J flowing a → b through the element
      z[a] -= J
      z[b] += J
    }

    for (const comp of c.comps) {
      const [a, b] = comp.nets
      const s = comp.symbol
      if (DIGITAL.has(s) || s === 'gnd' || s === 'probe' || s === 'logic-probe') continue

      if (s === 'resistor' || s === 'bulb') stampG(a, b, 1 / Math.max(pv(comp, 'R'), 1e-6))
      else if (s === 'voltmeter') stampG(a, b, 1e-7)
      else if (s === 'ammeter') stampG(a, b, CLOSED)
      else if (s === 'switch') stampG(a, b, pv(comp, 'closed') >= 0.5 ? CLOSED : OPEN)
      else if (s === 'pressure-plate') stampG(a, b, (comp.state.pressed ?? 0) >= 0.5 ? CLOSED : OPEN)
      else if (s === 'fuse') stampG(a, b, comp.state.blown ? OPEN : CLOSED)
      else if (s === 'current-source') stampI(a, b, pv(comp, 'I'))
      else if (s === 'dc-machine') {
        // Shaft state (comp.state.omega) lives here regardless of whether
        // anything physical is attached. The "Electric Motor" palette preset
        // is this exact symbol plus a hinge behavior — see syncElectricMotors
        // in lib/physics/world.ts, which spins whatever body is pinned to
        // that hinge at this omega. Plain "DC Machine" just leaves the shaft
        // abstract (no hinge), for circuit-only labs.
        // Armature = back-EMF (k·ω) in series with Ra, exactly like a diode's
        // "on" companion model but with a state-driven source instead of Vf.
        const Ra = Math.max(pv(comp, 'Ra'), 1e-3)
        const k = pv(comp, 'k')
        const omega = comp.state.omega ?? 0
        const g = 1 / Ra
        stampG(a, b, g)
        stampI(a, b, -g * k * omega)
      }
      else if (s === 'wattmeter') {
        // current coil (a,b): near-zero impedance, in series with the load
        // voltage coil (c,d): near-infinite impedance, in parallel
        const [ia, ib2, va, vb] = comp.nets
        stampG(ia, ib2, CLOSED)
        stampG(va, vb, 1e-7)
      } else if (s === 'induction-motor') {
        // Balanced wye load, each phase A/B/C stamped independently to N
        // (the user wires N to the source's neutral — no internal-only net
        // needed). Per-phase resistance is R2/|slip| — this is what makes
        // the physical torque-slip curve below actually draw more current
        // near stall and roughly none at synchronous speed, same as a real
        // cage rotor's referred resistance.
        const [pa, pb, pc, nRef] = comp.nets
        const R2 = Math.max(pv(comp, 'R2'), 1e-3)
        const poles = Math.max(2, Math.round(pv(comp, 'poles')) || 4)
        const f = Math.max(pv(comp, 'f'), 1e-3)
        const omegaSync = (2 * Math.PI * f) / (poles / 2)
        const omega = comp.state.omega ?? 0
        const slip = (omegaSync - omega) / omegaSync
        const slipMag = Math.max(Math.abs(slip), 1e-3)
        const g = 1 / Math.max(R2 / slipMag, 1e-3)
        stampG(pa, nRef, g)
        stampG(pb, nRef, g)
        stampG(pc, nRef, g)
      } else if (s === 'potentiometer') {
        const [top, wiper, bottom] = comp.nets
        const R = Math.max(pv(comp, 'R'), 1)
        const ratio = Math.min(1, Math.max(0, pv(comp, 'ratio')))
        stampG(top, wiper, 1 / Math.max(R * ratio, 1e-6))
        stampG(wiper, bottom, 1 / Math.max(R * (1 - ratio), 1e-6))
      } else if (s === 'capacitor') {
        const geq = Math.max(pv(comp, 'C'), 1e-12) / dt
        stampG(a, b, geq)
        stampI(a, b, -geq * (comp.state.v ?? 0)) // companion source
      } else if (s === 'inductor') {
        stampG(a, b, dt / Math.max(pv(comp, 'L'), 1e-9))
        stampI(a, b, comp.state.i ?? 0)
      } else if (s === 'diode' || s === 'led') {
        if (comp.state.on) {
          const g = 1 / 2 // 2 Ω series when conducting
          stampG(a, b, g)
          stampI(a, b, -g * pv(comp, 'Vf')) // shifts the I-V curve by Vf
        } else stampG(a, b, OPEN)
      } else if (s === 'zener') {
        if (comp.state.mode === 1) {
          // forward-conducting, same as a diode
          const g = 1 / 2
          stampG(a, b, g)
          stampI(a, b, -g * pv(comp, 'Vf'))
        } else if (comp.state.mode === -1) {
          // reverse breakdown: clamps at −Vz, conducts b → a
          const g = 1 / 5
          stampG(a, b, g)
          stampI(a, b, g * pv(comp, 'Vz'))
        } else stampG(a, b, OPEN)
      } else if (s === 'bjt' || s === 'bjt-pnp') {
        const [B, C2, E] = comp.nets
        const pnp = s === 'bjt-pnp'
        if (comp.state.on) {
          const gbe = 1 / 1000
          if (pnp) {
            stampG(E, B, gbe)
            stampI(E, B, -gbe * 0.7)
          } else {
            stampG(B, E, gbe)
            stampI(B, E, -gbe * 0.7)
          }
          stampG(C2, E, 1 / 5) // saturated switch
        } else {
          stampG(B, E, OPEN)
          stampG(C2, E, OPEN)
        }
      } else if (s === 'mosfet' || s === 'mosfet-pmos') {
        const [, D, S] = comp.nets
        stampG(D, S, comp.state.on ? 1 : OPEN)
      } else if (s === 'battery' || s === 'ac-source') {
        const row = n + comp.vsrcRow!
        const V =
          s === 'battery'
            ? pv(comp, 'V')
            : pv(comp, 'V') * waveform(pv(comp, 'wave'), 2 * Math.PI * pv(comp, 'f') * t)
        A[a][row] += 1
        A[b][row] -= 1
        A[row][a] += 1
        A[row][b] -= 1
        z[row] = V
      } else if (s === 'opamp') {
        const [p, m, out] = comp.nets
        const row = n + comp.vsrcRow!
        const gain = Math.max(pv(comp, 'gain'), 1)
        A[out][row] += 1 // output source current
        A[row][out] += 1 // Vout − gain·(V+ − V−) = 0
        A[row][p] -= gain
        A[row][m] += gain
      } else if (s === 'vcvs') {
        const [p, m, outP, outM] = comp.nets
        const row = n + comp.vsrcRow!
        const gain = pv(comp, 'gain')
        A[outP][row] += 1
        A[outM][row] -= 1
        A[row][outP] += 1
        A[row][outM] -= 1
        A[row][p] -= gain
        A[row][m] += gain
      } else if (s === 'vccs') {
        const [p, m, outP, outM] = comp.nets
        const gm = pv(comp, 'gm')
        A[outP][p] -= gm
        A[outP][m] += gm
        A[outM][p] += gm
        A[outM][m] -= gm
      } else if (s === 'ccvs') {
        // row0 senses the control current (zero-volt branch across ctrl pins),
        // row1 is the output voltage source: Vout = r · Isense
        const [ctrlP, ctrlM, outP, outM] = comp.nets
        const senseRow = n + comp.vsrcRow!
        const outRow = senseRow + 1
        const r = pv(comp, 'r')
        A[ctrlP][senseRow] += 1
        A[ctrlM][senseRow] -= 1
        A[senseRow][ctrlP] += 1
        A[senseRow][ctrlM] -= 1
        A[outP][outRow] += 1
        A[outM][outRow] -= 1
        A[outRow][outP] += 1
        A[outRow][outM] -= 1
        A[outRow][senseRow] -= r
      } else if (s === 'cccs') {
        // sense row carries Isense through the ctrl pins (zero-volt branch);
        // the output current beta·Isense is stamped directly from that unknown.
        const [ctrlP, ctrlM, outP, outM] = comp.nets
        const senseRow = n + comp.vsrcRow!
        const beta = pv(comp, 'beta')
        A[ctrlP][senseRow] += 1
        A[ctrlM][senseRow] -= 1
        A[senseRow][ctrlP] += 1
        A[senseRow][ctrlM] -= 1
        A[outP][senseRow] += beta
        A[outM][senseRow] -= beta
      } else if (s === 'transformer') {
        const [p1, p2, s1, s2] = comp.nets
        const row = n + comp.vsrcRow!
        const nt = Math.max(pv(comp, 'n'), 1e-3)
        A[p1][row] += 1
        A[p2][row] -= 1
        A[s1][row] -= nt
        A[s2][row] += nt
        A[row][p1] += 1
        A[row][p2] -= 1
        A[row][s1] -= nt
        A[row][s2] += nt
      } else if (s === 'transformer-ct') {
        const [p1, p2, sec1, ct, sec2] = comp.nets
        const row1 = n + comp.vsrcRow!
        const row2 = row1 + 1
        const nt = Math.max(pv(comp, 'n'), 1e-3)
        // half 1: primary − n·(sec1 − ct) = 0
        A[p1][row1] += 1
        A[p2][row1] -= 1
        A[sec1][row1] -= nt
        A[ct][row1] += nt
        A[row1][p1] += 1
        A[row1][p2] -= 1
        A[row1][sec1] -= nt
        A[row1][ct] += nt
        // half 2: primary − n·(ct − sec2) = 0 (opposite polarity → full-wave center tap)
        A[p1][row2] += 1
        A[p2][row2] -= 1
        A[ct][row2] -= nt
        A[sec2][row2] += nt
        A[row2][p1] += 1
        A[row2][p2] -= 1
        A[row2][ct] -= nt
        A[row2][sec2] += nt
      } else if (s === 'three-phase-source') {
        const [pa, pb, pc, nRef] = comp.nets
        const row0 = n + comp.vsrcRow!
        const V = pv(comp, 'V') * Math.SQRT2
        const w = 2 * Math.PI * pv(comp, 'f') * t
        const phases: [number, number][] = [
          [pa, 0],
          [pb, (-2 * Math.PI) / 3],
          [pc, (2 * Math.PI) / 3],
        ]
        phases.forEach(([net, offset], i) => {
          const row = row0 + i
          A[net][row] += 1
          A[nRef][row] -= 1
          A[row][net] += 1
          A[row][nRef] -= 1
          z[row] = V * Math.sin(w + offset)
        })
      }
    }

    // Digital→analog bridge: every net a digital component touches gets
    // pulled toward DIGITAL_HIGH_V·logic through a small source resistance,
    // so any analog device sharing that net (resistor, LED, voltmeter…)
    // actually sees ~5V/0V instead of whatever gmin leaves it floating at.
    // A pure-digital net with no analog device attached is unaffected by
    // this in practice — nothing reads its analog "voltage".
    for (const net of c.digitalNets) {
      const level = c.logic[net] ?? 0
      const g = 1 / DIGITAL_SOURCE_R
      stampG(net, c.ref, g)
      stampI(net, c.ref, g * DIGITAL_HIGH_V * level)
    }

    // reference net is 0 V by definition
    A[c.ref].fill(0)
    A[c.ref][c.ref] = 1
    z[c.ref] = 0
  }

  // Nonlinear devices: iterate piecewise states to a fixed point.
  for (let iter = 0; iter < 12; iter++) {
    assemble()
    x = solveLinear(
      A.map((row) => row.slice()),
      z.slice()
    )
    let changed = false
    for (const comp of c.comps) {
      const s = comp.symbol
      if (s === 'diode' || s === 'led') {
        const vab = x[comp.nets[0]] - x[comp.nets[1]]
        const Vf = pv(comp, 'Vf')
        let on = comp.state.on ? vab > Vf - 0.35 : vab > Vf
        // The "on" companion model actively pulls vab toward Vf, which can
        // make a reverse-biased diode look self-consistently "forward" when
        // it's the sole bridge between two otherwise-unconnected subnets
        // (e.g. a bare half-wave rectifier during the blocked half-cycle) —
        // nothing else calibrates vab, so the forced value satisfies its own
        // turn-on test. Guard with the branch current's sign: a diode that's
        // really conducting forward always has I ≥ 0 by this same formula.
        if (on && (vab - Vf) / 2 < 0) on = false
        if ((comp.state.on ?? 0) !== +on) {
          comp.state.on = +on
          changed = true
        }
      } else if (s === 'zener') {
        const vab = x[comp.nets[0]] - x[comp.nets[1]]
        const Vf = pv(comp, 'Vf')
        const Vz = pv(comp, 'Vz')
        const prevMode = comp.state.mode ?? 0
        let mode: number
        if (prevMode === 1) {
          mode = (vab - Vf) / 2 < 0 ? 0 : vab > Vf - 0.35 ? 1 : 0
        } else if (prevMode === -1) {
          mode = (vab + Vz) / 5 > 0 ? 0 : vab < -Vz + 0.35 ? -1 : 0
        } else {
          mode = vab > Vf ? 1 : vab < -Vz ? -1 : 0
        }
        if (prevMode !== mode) {
          comp.state.mode = mode
          changed = true
        }
      } else if (s === 'bjt' || s === 'bjt-pnp') {
        const pnp = s === 'bjt-pnp'
        const vbe = pnp ? x[comp.nets[2]] - x[comp.nets[0]] : x[comp.nets[0]] - x[comp.nets[2]]
        const on = comp.state.on ? vbe > 0.55 : vbe > 0.65
        if ((comp.state.on ?? 0) !== +on) {
          comp.state.on = +on
          changed = true
        }
      } else if (s === 'mosfet' || s === 'mosfet-pmos') {
        const pmos = s === 'mosfet-pmos'
        const vgs = pmos ? x[comp.nets[2]] - x[comp.nets[0]] : x[comp.nets[0]] - x[comp.nets[2]]
        const vt = pv(comp, 'Vt')
        const on = comp.state.on ? vgs > vt - 0.5 : vgs > vt
        if ((comp.state.on ?? 0) !== +on) {
          comp.state.on = +on
          changed = true
        }
      }
    }
    if (!changed) break
  }

  // ── currents, state integration, readings ──
  const v = (i: number) => x[i] ?? 0

  for (const comp of c.comps) {
    const s = comp.symbol
    comp.outflow.fill(0)
    if (DIGITAL.has(s) || s === 'gnd' || s === 'probe' || s === 'logic-probe') continue

    // ── multi-terminal (3+) components: handled fully here, then skip ahead ──
    if (s === 'potentiometer') {
      const [top, wiper, bottom] = comp.nets
      const R = Math.max(pv(comp, 'R'), 1)
      const ratio = Math.min(1, Math.max(0, pv(comp, 'ratio')))
      const Itw = (v(top) - v(wiper)) / Math.max(R * ratio, 1e-6)
      const Iwb = (v(wiper) - v(bottom)) / Math.max(R * (1 - ratio), 1e-6)
      comp.outflow[0] = -Itw
      comp.outflow[1] = Itw - Iwb
      comp.outflow[2] = Iwb
      c.frame.readings.set(comp.id, {
        text: fmtUnit(v(wiper) - v(bottom), 'V'),
        channels: { Vtop: v(top), Vwiper: v(wiper), Vbottom: v(bottom) },
      })
      continue
    }
    if (s === 'wattmeter') {
      const [ia, ib2, va, vb] = comp.nets
      const I = (v(ia) - v(ib2)) * CLOSED
      const V = v(va) - v(vb)
      comp.outflow[0] = -I
      comp.outflow[1] = I
      c.frame.readings.set(comp.id, {
        text: fmtUnit(Math.abs(V * I), 'W'),
        channels: { V, I: Math.abs(I), P: Math.abs(V * I) },
      })
      continue
    }
    if (s === 'induction-motor') {
      const [pa, pb, pc, nRef] = comp.nets
      const R2 = Math.max(pv(comp, 'R2'), 1e-3)
      const X = Math.max(pv(comp, 'X'), 1e-3)
      const poles = Math.max(2, Math.round(pv(comp, 'poles')) || 4)
      const f = Math.max(pv(comp, 'f'), 1e-3)
      const omegaSync = (2 * Math.PI * f) / (poles / 2)
      const omega = comp.state.omega ?? 0
      const slip = (omegaSync - omega) / omegaSync
      const slipSafe = Math.abs(slip) < 1e-3 ? (slip < 0 ? -1e-3 : 1e-3) : slip

      const va = v(pa) - v(nRef)
      const vb = v(pb) - v(nRef)
      const vc = v(pc) - v(nRef)
      const g = 1 / Math.max(R2 / Math.abs(slipSafe), 1e-3)
      const ia = va * g
      const ib = vb * g
      const ic = vc * g
      comp.outflow[0] = -ia
      comp.outflow[1] = -ib
      comp.outflow[2] = -ic
      comp.outflow[3] = ia + ib + ic

      // This is a time-domain (not phasor) solver, so the raw phase voltage
      // is a 2f ripple, not a steady RMS — smooth it before feeding the
      // torque formula so torque (and therefore RPM) doesn't judder at line
      // frequency. Settles over roughly one AC cycle.
      const vrmsPrev = comp.state.vrms ?? 0
      const alpha = Math.min(1, dt * 8)
      comp.state.vrms = vrmsPrev + (Math.abs(va) - vrmsPrev) * alpha

      // Standard simplified (stator impedance neglected) torque-slip curve:
      // T(s) = 3·V²·(R2/s) / (ωs·((R2/s)² + X²)) — correctly →0 torque at
      // synchronous speed and flips sign (braking) once slip goes negative.
      const R2s = R2 / slipSafe
      const Tem = (3 * comp.state.vrms * comp.state.vrms * R2s) / (omegaSync * (R2s * R2s + X * X))
      const J = Math.max(pv(comp, 'J'), 1e-4)
      const load = pv(comp, 'load')
      const friction = Math.max(pv(comp, 'friction'), 0)
      comp.state.omega = omega + ((Tem - load - friction * omega) / J) * dt
      comp.state.torque = Tem
      comp.state.slip = slip
      comp.state.angle = ((comp.state.angle ?? 0) + omega * dt) % (2 * Math.PI)

      c.frame.readings.set(comp.id, {
        text: `${((omega * 60) / (2 * Math.PI)).toFixed(0)} RPM`,
        channels: { omega, torque: Tem, slip, I: Math.abs(ia) + Math.abs(ib) + Math.abs(ic) },
      })
      continue
    }
    if (s === 'vcvs') {
      const [p, m, outP, outM] = comp.nets
      const io = x[n + comp.vsrcRow!] ?? 0
      comp.outflow[2] = -io
      comp.outflow[3] = io
      const V = v(outP) - v(outM)
      c.frame.readings.set(comp.id, {
        text: fmtUnit(V, 'V'),
        channels: { Vctrl: v(p) - v(m), Vout: V, I: Math.abs(io) },
      })
      continue
    }
    if (s === 'vccs') {
      const [p, m, outP, outM] = comp.nets
      const gm = pv(comp, 'gm')
      const io = gm * (v(p) - v(m))
      comp.outflow[2] = io
      comp.outflow[3] = -io
      c.frame.readings.set(comp.id, {
        text: fmtUnit(io, 'A'),
        channels: { Vctrl: v(p) - v(m), Vout: v(outP) - v(outM), I: Math.abs(io) },
      })
      continue
    }
    if (s === 'ccvs') {
      const [, , outP, outM] = comp.nets
      const senseRow = n + comp.vsrcRow!
      const outRow = senseRow + 1
      const isense = x[senseRow] ?? 0
      const iout = x[outRow] ?? 0
      comp.outflow[0] = -isense
      comp.outflow[1] = isense
      comp.outflow[2] = -iout
      comp.outflow[3] = iout
      c.frame.readings.set(comp.id, {
        text: fmtUnit(v(outP) - v(outM), 'V'),
        channels: { Isense: isense, Vout: v(outP) - v(outM), I: Math.abs(iout) },
      })
      continue
    }
    if (s === 'cccs') {
      const [, , outP, outM] = comp.nets
      const senseRow = n + comp.vsrcRow!
      const isense = x[senseRow] ?? 0
      const beta = pv(comp, 'beta')
      const io = beta * isense
      comp.outflow[0] = -isense
      comp.outflow[1] = isense
      comp.outflow[2] = io
      comp.outflow[3] = -io
      c.frame.readings.set(comp.id, {
        text: fmtUnit(io, 'A'),
        channels: { Isense: isense, Vout: v(outP) - v(outM), I: Math.abs(io) },
      })
      continue
    }
    if (s === 'transformer') {
      const [p1, p2, s1, s2] = comp.nets
      const io = x[n + comp.vsrcRow!] ?? 0
      const nt = Math.max(pv(comp, 'n'), 1e-3)
      comp.outflow[0] = -io
      comp.outflow[1] = io
      comp.outflow[2] = nt * io
      comp.outflow[3] = -nt * io
      c.frame.readings.set(comp.id, {
        text: fmtUnit(v(s1) - v(s2), 'V'),
        channels: { Vprimary: v(p1) - v(p2), Vsecondary: v(s1) - v(s2), I: Math.abs(io) },
      })
      continue
    }
    if (s === 'transformer-ct') {
      const [p1, p2, sec1, ct, sec2] = comp.nets
      const row1 = n + comp.vsrcRow!
      const row2 = row1 + 1
      const i1 = x[row1] ?? 0
      const i2 = x[row2] ?? 0
      const nt = Math.max(pv(comp, 'n'), 1e-3)
      comp.outflow[0] = -(i1 + i2)
      comp.outflow[1] = i1 + i2
      comp.outflow[2] = nt * i1
      comp.outflow[3] = -nt * i1 + nt * i2
      comp.outflow[4] = -nt * i2
      c.frame.readings.set(comp.id, {
        text: fmtUnit(v(sec1) - v(sec2), 'V'),
        channels: {
          Vprimary: v(p1) - v(p2),
          Vsec1: v(sec1) - v(ct),
          Vsec2: v(ct) - v(sec2),
        },
      })
      continue
    }
    if (s === 'three-phase-source') {
      const [pa, pb, pc, nRef] = comp.nets
      const row0 = n + comp.vsrcRow!
      const ia = x[row0] ?? 0
      const ib3 = x[row0 + 1] ?? 0
      const ic3 = x[row0 + 2] ?? 0
      comp.outflow[0] = -ia
      comp.outflow[1] = -ib3
      comp.outflow[2] = -ic3
      comp.outflow[3] = ia + ib3 + ic3
      c.frame.readings.set(comp.id, {
        text: fmtUnit(v(pa) - v(nRef), 'V'),
        channels: {
          Va: v(pa) - v(nRef),
          Vb: v(pb) - v(nRef),
          Vc: v(pc) - v(nRef),
          Vab: v(pa) - v(pb),
        },
      })
      continue
    }

    const [a, b] = comp.nets
    const vab = v(a) - v(b)
    let I = 0 // internal current a → b

    if (s === 'resistor' || s === 'bulb') I = vab / Math.max(pv(comp, 'R'), 1e-6)
    else if (s === 'voltmeter') I = vab * 1e-7
    else if (s === 'ammeter') I = vab * CLOSED
    else if (s === 'switch') I = vab * (pv(comp, 'closed') >= 0.5 ? CLOSED : OPEN)
    else if (s === 'pressure-plate') I = vab * ((comp.state.pressed ?? 0) >= 0.5 ? CLOSED : OPEN)
    else if (s === 'fuse') {
      I = vab * (comp.state.blown ? OPEN : CLOSED)
      if (Math.abs(I) > pv(comp, 'Imax')) comp.state.blown = 1
    } else if (s === 'current-source') {
      I = pv(comp, 'I')
    } else if (s === 'dc-machine') {
      const Ra = Math.max(pv(comp, 'Ra'), 1e-3)
      const k = pv(comp, 'k')
      const omega = comp.state.omega ?? 0
      I = (vab - k * omega) / Ra // armature current
      const Tem = k * I // electromagnetic torque
      const J = Math.max(pv(comp, 'J'), 1e-4)
      const load = pv(comp, 'load')
      const friction = Math.max(pv(comp, 'friction'), 0)
      comp.state.omega = omega + ((Tem - load - friction * omega) / J) * dt
      comp.state.torque = Tem
      comp.state.angle = ((comp.state.angle ?? 0) + omega * dt) % (2 * Math.PI)
    } else if (s === 'capacitor') {
      const geq = Math.max(pv(comp, 'C'), 1e-12) / dt
      I = geq * (vab - (comp.state.v ?? 0))
      comp.state.v = vab
    } else if (s === 'inductor') {
      I = (comp.state.i ?? 0) + (dt / Math.max(pv(comp, 'L'), 1e-9)) * vab
      comp.state.i = I
    } else if (s === 'diode' || s === 'led') {
      I = comp.state.on ? (vab - pv(comp, 'Vf')) / 2 : vab * OPEN
    } else if (s === 'zener') {
      I =
        comp.state.mode === 1
          ? (vab - pv(comp, 'Vf')) / 2
          : comp.state.mode === -1
            ? (vab + pv(comp, 'Vz')) / 5
            : vab * OPEN
    } else if (s === 'battery' || s === 'ac-source') {
      I = x[n + comp.vsrcRow!] ?? 0
    } else if (s === 'bjt' || s === 'bjt-pnp') {
      const [B, C2, E] = comp.nets
      const pnp = s === 'bjt-pnp'
      const ib = comp.state.on ? (pnp ? (v(E) - v(B) - 0.7) / 1000 : (v(B) - v(E) - 0.7) / 1000) : 0
      const ic = comp.state.on ? (pnp ? (v(E) - v(C2)) / 5 : (v(C2) - v(E)) / 5) : 0
      if (pnp) {
        comp.outflow[0] = ib
        comp.outflow[1] = ic
        comp.outflow[2] = -(ib + ic)
      } else {
        comp.outflow[0] = -ib
        comp.outflow[1] = -ic
        comp.outflow[2] = ib + ic
      }
    } else if (s === 'mosfet' || s === 'mosfet-pmos') {
      const [, D, S] = comp.nets
      const pmos = s === 'mosfet-pmos'
      const id = comp.state.on ? (pmos ? v(S) - v(D) : v(D) - v(S)) : 0
      if (pmos) {
        comp.outflow[1] = id
        comp.outflow[2] = -id
      } else {
        comp.outflow[1] = -id
        comp.outflow[2] = id
      }
    } else if (s === 'opamp') {
      const io = x[n + comp.vsrcRow!] ?? 0
      comp.outflow[2] = -io
    }

    if (!comp.outflow.some((f) => f !== 0) && comp.nets.length === 2) {
      comp.outflow[0] = -I
      comp.outflow[1] = I
    }

    // readings
    const r: Reading = { channels: { V: vab, I: Math.abs(I), P: Math.abs(vab * I) } }
    if (s === 'voltmeter') r.text = fmtUnit(vab, 'V')
    else if (s === 'ammeter') r.text = fmtUnit(I, 'A')
    else if (s === 'fuse' && comp.state.blown) r.text = 'blown'
    else if (s === 'pressure-plate') r.text = (comp.state.pressed ?? 0) >= 0.5 ? 'pressed' : 'open'
    else if (s === 'led') r.glow = comp.state.on ? Math.min(1, Math.abs(I) / 0.02) : 0
    else if (s === 'bulb') r.glow = Math.min(1, Math.sqrt(Math.abs(vab * I)) / 2)
    else if (s === 'zener' && comp.state.mode === -1) r.text = fmtUnit(vab, 'V')
    else if (s === 'dc-machine') {
      const omega = comp.state.omega ?? 0
      r.text = `${((omega * 60) / (2 * Math.PI)).toFixed(0)} RPM`
      r.channels = { V: vab, I: Math.abs(I), P: Math.abs(vab * I), omega, torque: comp.state.torque ?? 0 }
    }
    if (s === 'battery' || s === 'ac-source') r.channels = { V: v(a) - v(b), I: Math.abs(I), P: Math.abs(vab * I) }
    c.frame.readings.set(comp.id, r)
  }

  // probes read node voltage against the reference
  for (const comp of c.comps) {
    if (comp.symbol === 'probe') {
      const val = v(comp.nets[0])
      c.frame.readings.set(comp.id, { text: fmtUnit(val, 'V'), channels: { V: val } })
    } else if (comp.symbol === 'logic-probe') {
      // Logic probe: the net's digital level, streamed to the graph bus so
      // clock edges can be charted at any point in the circuit.
      const val = c.logic[comp.nets[0]] ?? 0
      c.frame.readings.set(comp.id, { text: val ? 'HIGH' : 'LOW', glow: val, channels: { level: val } })
    } else if (comp.symbol === 'output') {
      const val = c.logic[comp.nets[0]] ?? 0
      c.frame.readings.set(comp.id, { text: String(val), glow: val, channels: { value: val } })
    } else if (comp.symbol === 'clock' || comp.symbol === 'input') {
      // Sources stream their level too, so clock waveforms can be graphed
      // directly without needing a probe on the wire.
      const val = c.logic[comp.nets[0]] ?? 0
      c.frame.readings.set(comp.id, { channels: { value: val } })
    }
  }

  // digital pins: every terminal shows its net's logic level
  for (const comp of c.comps) {
    if (!DIGITAL.has(comp.symbol)) continue
    c.frame.pins.set(
      comp.id,
      comp.nets.map((net) => c.logic[net] ?? 0)
    )
  }

  // per-net outflow magnitude for wires without a direct attachment
  const netMax = new Map<number, number>()
  for (const comp of c.comps) {
    comp.nets.forEach((net, i) => {
      const f = Math.abs(comp.outflow[i])
      if (f > (netMax.get(net) ?? 0)) netMax.set(net, f)
    })
  }

  for (const w of c.wires) {
    const digital = c.digitalNets.has(w.net) ? c.logic[w.net] ?? 0 : undefined
    let I = 0
    if (digital === undefined) {
      if (w.attach) {
        const f = c.comps[w.attach.comp].outflow[w.attach.term]
        I = w.attach.end === 0 ? f : -f
      } else {
        I = netMax.get(w.net) ?? 0
      }
    }
    const mag = Math.abs(I)
    const flowing = mag > 1e-7
    if (flowing) w.charge += Math.sign(I) * Math.min(140, 30 + 90 * Math.sqrt(mag)) * dt
    c.frame.wires.set(w.id, {
      current: I,
      charge: w.charge,
      intensity: flowing ? Math.min(0.95, 0.35 + Math.sqrt(mag)) : 0,
      digital,
    })
  }
}

// ── Digital logic ───────────────────────────────────────────────────────────

function stepDigital(
  c: Circuit,
  t: number,
  pv: (comp: CircuitComponent, name: string) => number
) {
  const L = c.logic

  // drivers
  for (const comp of c.comps) {
    if (comp.symbol === 'input') L[comp.nets[0]] = pv(comp, 'value') >= 0.5 ? 1 : 0
    else if (comp.symbol === 'clock') L[comp.nets[0]] = (t * pv(comp, 'f')) % 1 < 0.5 ? 1 : 0
  }

  // combinational fixpoint
  for (let pass = 0; pass < 8; pass++) {
    for (const comp of c.comps) {
      const s = comp.symbol
      if (GATES.has(s)) {
        if (s === 'not-gate') {
          L[comp.nets[1]] = L[comp.nets[0]] ? 0 : 1
        } else {
          // N-input gates: the last net is the output, the rest are inputs.
          const nIn = comp.nets.length - 1
          let and = 1
          let or = 0
          let xor = 0
          for (let i = 0; i < nIn; i++) {
            const bit = L[comp.nets[i]] ?? 0
            and &= bit
            or |= bit
            xor ^= bit
          }
          const out =
            s === 'and-gate' ? and
            : s === 'or-gate' ? or
            : s === 'xor-gate' ? xor
            : s === 'nand-gate' ? 1 - and
            : 1 - or // nor
          L[comp.nets[nIn]] = out
        }
      } else if (s === 'mux') {
        if (comp.nets.length === 7) {
          // 4:1 — [in0..in3, sel0, sel1, out]
          const idx = (L[comp.nets[4]] ?? 0) + 2 * (L[comp.nets[5]] ?? 0)
          L[comp.nets[6]] = L[comp.nets[idx]] ?? 0
        } else {
          const [i0, i1, sel, out] = comp.nets
          L[out] = (L[sel] ? L[i1] : L[i0]) ?? 0
        }
      } else if (s === 'half-adder') {
        const [a, b, sum, carry] = comp.nets
        L[sum] = (L[a] ?? 0) ^ (L[b] ?? 0)
        L[carry] = (L[a] ?? 0) & (L[b] ?? 0)
      } else if (s === 'full-adder') {
        const [a, b, cin, sum, cout] = comp.nets
        const total = (L[a] ?? 0) + (L[b] ?? 0) + (L[cin] ?? 0)
        L[sum] = total & 1
        L[cout] = total >> 1
      } else if (s === 'decoder') {
        // 2:4 (6 nets) or 3:8 (11 nets); address bits are LSB-first.
        const nIn = comp.nets.length > 6 ? 3 : 2
        let idx = 0
        for (let i = 0; i < nIn; i++) idx += (L[comp.nets[i]] ?? 0) << i
        comp.nets.slice(nIn).forEach((y, i) => (L[y] = i === idx ? 1 : 0))
      } else if (s === 'comparator') {
        const [a, b, lt, eq, gt] = comp.nets
        const av = L[a] ?? 0
        const bv = L[b] ?? 0
        L[lt] = av < bv ? 1 : 0
        L[eq] = av === bv ? 1 : 0
        L[gt] = av > bv ? 1 : 0
      } else if (s === 'sr-latch') {
        const set = L[comp.nets[0]] ?? 0
        const reset = L[comp.nets[1]] ?? 0
        if (set && !reset) comp.state.q = 1
        else if (reset && !set) comp.state.q = 0
        L[comp.nets[2]] = comp.state.q ?? 0
      } else if (s === 'demux') {
        if (comp.nets.length === 7) {
          // 1:4 — [in, sel0, sel1, out0..out3]
          const idx = (L[comp.nets[1]] ?? 0) + 2 * (L[comp.nets[2]] ?? 0)
          const inV = L[comp.nets[0]] ?? 0
          comp.nets.slice(3).forEach((y, i) => (L[y] = i === idx ? inV : 0))
        } else {
          // 1:2 — [in, sel, out0, out1]
          const [inN, sel, o0, o1] = comp.nets
          const inV = L[inN] ?? 0
          L[o0] = L[sel] ? 0 : inV
          L[o1] = L[sel] ? inV : 0
        }
      } else if (s === 'encoder') {
        // 4:2 (6 nets) or 8:3 (11 nets); with `priority`, the highest-index
        // active input wins — otherwise the first (lowest-index) one does.
        const nIn = comp.nets.length > 6 ? 8 : 4
        const ins = comp.nets.slice(0, nIn)
        const outs = comp.nets.slice(nIn)
        const usePriority = pv(comp, 'priority') >= 0.5
        let idx = -1
        if (usePriority) {
          for (let i = nIn - 1; i >= 0; i--) {
            if (L[ins[i]]) {
              idx = i
              break
            }
          }
        } else {
          idx = ins.findIndex((n) => L[n])
        }
        const val = idx < 0 ? 0 : idx
        outs.forEach((y, i) => (L[y] = (val >> i) & 1))
      } else if (s === 'bcd-7seg') {
        const [A, B, C, D] = comp.nets
        const outs = comp.nets.slice(4)
        const val = (L[A] ?? 0) + 2 * (L[B] ?? 0) + 4 * (L[C] ?? 0) + 8 * (L[D] ?? 0)
        // Segment patterns a..g (MSB-first), 1 = lit. Common-cathode digits 0–9.
        const TABLE = [0x7e, 0x30, 0x6d, 0x79, 0x33, 0x5b, 0x5f, 0x70, 0x7f, 0x7b]
        const bits = val >= 0 && val <= 9 ? TABLE[val] : 0
        outs.forEach((y, i) => (L[y] = (bits >> (6 - i)) & 1))
      } else if (s === 'tristate') {
        const [inN, en, out] = comp.nets
        // Disabled: the buffer stops driving — the net just holds its last
        // value (a simplified stand-in for a floating tri-state bus).
        if (L[en]) L[out] = L[inN] ?? 0
      }
    }
  }

  // sequential: flip-flops sample on the rising clock edge
  for (const comp of c.comps) {
    if (comp.symbol === 'd-ff') {
      const clk = L[comp.nets[1]] ?? 0
      if (clk === 1 && (comp.state.prevClk ?? 0) === 0) comp.state.q = L[comp.nets[0]] ?? 0
      comp.state.prevClk = clk
      L[comp.nets[2]] = comp.state.q ?? 0
    } else if (comp.symbol === 'jk-ff') {
      const [j, clkNet, k, q] = comp.nets
      const clk = L[clkNet] ?? 0
      if (clk === 1 && (comp.state.prevClk ?? 0) === 0) {
        const J = L[j] ?? 0
        const K = L[k] ?? 0
        if (J && K) comp.state.q = (comp.state.q ?? 0) ? 0 : 1 // toggle
        else if (J) comp.state.q = 1
        else if (K) comp.state.q = 0
      }
      comp.state.prevClk = clk
      L[q] = comp.state.q ?? 0
    } else if (comp.symbol === 't-ff') {
      const [t, clkNet, q] = comp.nets
      const clk = L[clkNet] ?? 0
      if (clk === 1 && (comp.state.prevClk ?? 0) === 0 && L[t]) comp.state.q = (comp.state.q ?? 0) ? 0 : 1
      comp.state.prevClk = clk
      L[q] = comp.state.q ?? 0
    } else if (comp.symbol === 'register4') {
      // 4 bits packed into comp.state.bits; mode (0=SISO,1=SIPO,2=PISO,
      // 3=PIPO) picks which pins exist — see terminalsOf('register4').
      const raw = pv(comp, 'inputs')
      const mode = Math.min(3, Math.max(0, Math.round(Number.isFinite(raw) ? raw : 0)))
      const nets = comp.nets
      const clkNet = mode === 2 ? nets[5] : mode === 3 ? nets[4] : nets[1]
      const clk = L[clkNet] ?? 0
      if (clk === 1 && (comp.state.prevClk ?? 0) === 0) {
        let b = comp.state.bits ?? 0
        if (mode === 0 || mode === 1) {
          const sin = L[nets[0]] ?? 0
          if (mode === 0) comp.state.sout = (b >> 3) & 1
          b = ((b << 1) | sin) & 0xf
        } else if (mode === 2) {
          if (L[nets[4]]) {
            b = (L[nets[0]] ? 1 : 0) | (L[nets[1]] ? 2 : 0) | (L[nets[2]] ? 4 : 0) | (L[nets[3]] ? 8 : 0)
          } else {
            comp.state.sout = (b >> 3) & 1
            b = (b << 1) & 0xf
          }
        } else {
          b = (L[nets[0]] ? 1 : 0) | (L[nets[1]] ? 2 : 0) | (L[nets[2]] ? 4 : 0) | (L[nets[3]] ? 8 : 0)
        }
        comp.state.bits = b
      }
      comp.state.prevClk = clk
      const b = comp.state.bits ?? 0
      if (mode === 0) L[nets[2]] = comp.state.sout ?? 0
      else if (mode === 1) [nets[2], nets[3], nets[4], nets[5]].forEach((n, i) => (L[n] = (b >> i) & 1))
      else if (mode === 2) L[nets[6]] = comp.state.sout ?? 0
      else [nets[5], nets[6], nets[7], nets[8]].forEach((n, i) => (L[n] = (b >> i) & 1))
    } else if (comp.symbol === 'counter4') {
      const [clkNet, ...qNets] = comp.nets
      const clk = L[clkNet] ?? 0
      if (clk === 1 && (comp.state.prevClk ?? 0) === 0) {
        // "sync" vs "async" produce the same count sequence at this level of
        // simulation (no propagation-delay modeling), so `sync` is exposed
        // as a labeling param only — both wrap mod-N identically.
        const mod = Math.max(2, Math.min(16, Math.round(pv(comp, 'mod'))))
        const dir = pv(comp, 'dir') >= 0.5 ? -1 : 1
        let v = (comp.state.count ?? 0) + dir
        if (v >= mod) v = 0
        if (v < 0) v = mod - 1
        comp.state.count = v
      }
      comp.state.prevClk = clk
      const v = comp.state.count ?? 0
      qNets.forEach((n, i) => (L[n] = (v >> i) & 1))
    }
  }
}
