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

export const TERMINALS: Record<string, TerminalDef[]> = {
  resistor: T2,
  capacitor: T2,
  inductor: T2,
  battery: T2, // [+, −]
  'ac-source': T2,
  switch: T2,
  fuse: T2,
  bulb: T2,
  diode: T2, // [anode, cathode]
  led: T2,
  ammeter: T2,
  voltmeter: T2,
  gnd: [{ x: 0.5, y: 0.12 }],
  probe: [{ x: 0.5, y: 1 }],
  bjt: [
    { x: 0, y: 0.5 },
    { x: 0.583, y: 0.083 },
    { x: 0.583, y: 0.917 },
  ], // [B, C, E]
  mosfet: [
    { x: 0, y: 0.5 },
    { x: 0.708, y: 0.125 },
    { x: 0.708, y: 0.875 },
  ], // [G, D, S]
  opamp: [
    { x: 0, y: 0.3125 },
    { x: 0, y: 0.6875 },
    { x: 1, y: 0.5 },
  ], // [in+, in−, out]
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
}

const GATES = new Set(['and-gate', 'or-gate', 'xor-gate', 'nand-gate', 'nor-gate', 'not-gate'])
const DIGITAL = new Set([...GATES, 'd-ff', 'mux', 'input', 'clock', 'output'])

export const SNAP = 14

// Default parameter values (used when an object lacks the param).
const DEF: Record<string, Record<string, number>> = {
  resistor: { R: 100 },
  bulb: { R: 20 },
  capacitor: { C: 0.001 },
  inductor: { L: 0.1 },
  battery: { V: 9 },
  'ac-source': { V: 12, f: 1 },
  switch: { closed: 1 },
  fuse: { Imax: 1 },
  diode: { Vf: 0.7 },
  led: { Vf: 2 },
  mosfet: { Vt: 2 },
  opamp: { gain: 1e5 },
  input: { value: 0 },
  clock: { f: 1 },
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
    for (const t of TERMINALS[o.geometry.symbol!] ?? []) {
      const w = terminalWorld(o, t)
      if (Math.hypot(w.x - p.x, w.y - p.y) < snap) return true
    }
  }
  return false
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
    const defs = TERMINALS[o.geometry.symbol!] ?? []
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

  // terminal ↔ terminal (abutting components), and all grounds are one earth
  for (let i = 0; i < termPts.length; i++) {
    for (let j = i + 1; j < termPts.length; j++) {
      if (Math.hypot(termPts[i].x - termPts[j].x, termPts[i].y - termPts[j].y) < SNAP) {
        union(termPts[i].item, termPts[j].item)
      }
    }
  }
  const gndItems = termPts.filter((tp) => comps[tp.comp].geometry.symbol === 'gnd').map((tp) => tp.item)
  for (let i = 1; i < gndItems.length; i++) union(gndItems[0], gndItems[i])

  // terminal ↔ wire (anywhere along the wire), wire endpoint ↔ wire
  wires.forEach((w, wi) => {
    for (const tp of termPts) {
      if (polyDist(tp.x, tp.y, w.pts) < SNAP) union(tp.item, wireBase + wi)
    }
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
    const defs = TERMINALS[o.geometry.symbol!] ?? []
    const nets = defs.map((_, ti) => netId(termPts[termBase[ci] + ti].item))
    const symbol = o.geometry.symbol!
    const comp: CircuitComponent = {
      id: o.id,
      symbol,
      nets,
      state: {},
      outflow: nets.map(() => 0),
    }
    if (symbol === 'battery' || symbol === 'ac-source' || symbol === 'opamp') comp.vsrcRow = nVsrc++
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
      const tp = termPts.find((p) => Math.hypot(p.x - ep[0], p.y - ep[1]) < SNAP)
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
      if (DIGITAL.has(s) || s === 'gnd' || s === 'probe') continue

      if (s === 'resistor' || s === 'bulb') stampG(a, b, 1 / Math.max(pv(comp, 'R'), 1e-6))
      else if (s === 'voltmeter') stampG(a, b, 1e-7)
      else if (s === 'ammeter') stampG(a, b, CLOSED)
      else if (s === 'switch') stampG(a, b, pv(comp, 'closed') >= 0.5 ? CLOSED : OPEN)
      else if (s === 'fuse') stampG(a, b, comp.state.blown ? OPEN : CLOSED)
      else if (s === 'capacitor') {
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
      } else if (s === 'bjt') {
        const [B, C2, E] = comp.nets
        if (comp.state.on) {
          const gbe = 1 / 1000
          stampG(B, E, gbe)
          stampI(B, E, -gbe * 0.7)
          stampG(C2, E, 1 / 5) // saturated switch
        } else {
          stampG(B, E, OPEN)
          stampG(C2, E, OPEN)
        }
      } else if (s === 'mosfet') {
        const [, D, S] = comp.nets
        stampG(D, S, comp.state.on ? 1 : OPEN)
      } else if (s === 'battery' || s === 'ac-source') {
        const row = n + comp.vsrcRow!
        const V = s === 'battery' ? pv(comp, 'V') : pv(comp, 'V') * Math.sin(2 * Math.PI * pv(comp, 'f') * t)
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
      }
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
        const on = comp.state.on ? vab > pv(comp, 'Vf') - 0.35 : vab > pv(comp, 'Vf')
        if ((comp.state.on ?? 0) !== +on) {
          comp.state.on = +on
          changed = true
        }
      } else if (s === 'bjt') {
        const vbe = x[comp.nets[0]] - x[comp.nets[2]]
        const on = comp.state.on ? vbe > 0.55 : vbe > 0.65
        if ((comp.state.on ?? 0) !== +on) {
          comp.state.on = +on
          changed = true
        }
      } else if (s === 'mosfet') {
        const vgs = x[comp.nets[0]] - x[comp.nets[2]]
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
    if (DIGITAL.has(s) || s === 'gnd' || s === 'probe') continue
    const [a, b] = comp.nets
    const vab = v(a) - v(b)
    let I = 0 // internal current a → b

    if (s === 'resistor' || s === 'bulb') I = vab / Math.max(pv(comp, 'R'), 1e-6)
    else if (s === 'voltmeter') I = vab * 1e-7
    else if (s === 'ammeter') I = vab * CLOSED
    else if (s === 'switch') I = vab * (pv(comp, 'closed') >= 0.5 ? CLOSED : OPEN)
    else if (s === 'fuse') {
      I = vab * (comp.state.blown ? OPEN : CLOSED)
      if (Math.abs(I) > pv(comp, 'Imax')) comp.state.blown = 1
    } else if (s === 'capacitor') {
      const geq = Math.max(pv(comp, 'C'), 1e-12) / dt
      I = geq * (vab - (comp.state.v ?? 0))
      comp.state.v = vab
    } else if (s === 'inductor') {
      I = (comp.state.i ?? 0) + (dt / Math.max(pv(comp, 'L'), 1e-9)) * vab
      comp.state.i = I
    } else if (s === 'diode' || s === 'led') {
      I = comp.state.on ? (vab - pv(comp, 'Vf')) / 2 : vab * OPEN
    } else if (s === 'battery' || s === 'ac-source') {
      I = x[n + comp.vsrcRow!] ?? 0
    } else if (s === 'bjt') {
      const [B, C2, E] = comp.nets
      const ib = comp.state.on ? (v(B) - v(E) - 0.7) / 1000 : 0
      const ic = comp.state.on ? (v(C2) - v(E)) / 5 : 0
      comp.outflow[0] = -ib
      comp.outflow[1] = -ic
      comp.outflow[2] = ib + ic
    } else if (s === 'mosfet') {
      const [, D, S] = comp.nets
      const id = comp.state.on ? v(D) - v(S) : 0
      comp.outflow[1] = -id
      comp.outflow[2] = id
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
    else if (s === 'led') r.glow = comp.state.on ? Math.min(1, Math.abs(I) / 0.02) : 0
    else if (s === 'bulb') r.glow = Math.min(1, Math.sqrt(Math.abs(vab * I)) / 2)
    if (s === 'battery' || s === 'ac-source') r.channels = { V: v(a) - v(b), I: Math.abs(I), P: Math.abs(vab * I) }
    c.frame.readings.set(comp.id, r)
  }

  // probes read node voltage against the reference
  for (const comp of c.comps) {
    if (comp.symbol === 'probe') {
      const val = v(comp.nets[0])
      c.frame.readings.set(comp.id, { text: fmtUnit(val, 'V'), channels: { V: val } })
    } else if (comp.symbol === 'output') {
      const val = c.logic[comp.nets[0]] ?? 0
      c.frame.readings.set(comp.id, { text: String(val), glow: val, channels: { value: val } })
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
          const a = L[comp.nets[0]] ?? 0
          const b = L[comp.nets[1]] ?? 0
          const out =
            s === 'and-gate' ? a & b
            : s === 'or-gate' ? a | b
            : s === 'xor-gate' ? a ^ b
            : s === 'nand-gate' ? 1 - (a & b)
            : 1 - (a | b) // nor
          L[comp.nets[2]] = out
        }
      } else if (s === 'mux') {
        const [i0, i1, sel, out] = comp.nets
        L[out] = (L[sel] ? L[i1] : L[i0]) ?? 0
      }
    }
  }

  // sequential: D flip-flops sample on the rising clock edge
  for (const comp of c.comps) {
    if (comp.symbol !== 'd-ff') continue
    const clk = L[comp.nets[1]] ?? 0
    if (clk === 1 && (comp.state.prevClk ?? 0) === 0) comp.state.q = L[comp.nets[0]] ?? 0
    comp.state.prevClk = clk
    L[comp.nets[2]] = comp.state.q ?? 0
  }
}
