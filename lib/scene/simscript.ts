import { useDocStore } from '@/lib/store/document'
import { terminalsOf, terminalWorld } from '@/lib/circuit/engine'
import { uid, type SceneObject, type GeometryKind, type BehaviorType, num, str } from './types'
import { EMPTY_SPEC } from '@/lib/econ/engine'

// Always read fresh state — Zustand creates new state objects on every set(),
// so any snapshot captured before an addObject call is immediately stale.
const store = () => useDocStore.getState()

// ── Domain classification ─────────────────────────────────────────────────────
const ELECTRICAL_SYMBOLS = new Set([
  'battery', 'ac-source', 'current-source', 'resistor', 'bulb', 'capacitor',
  'inductor', 'potentiometer', 'switch', 'fuse', 'gnd', 'voltmeter', 'ammeter',
  'wattmeter', 'probe', 'vcvs', 'vccs', 'ccvs', 'cccs', 'transformer',
  'transformer-ct', 'three-phase-source', 'dc-machine', 'pressure-plate',
])
const ELECTRONICS_SYMBOLS = new Set([
  'diode', 'led', 'zener', 'bjt', 'bjt-pnp', 'mosfet', 'mosfet-pmos', 'opamp',
])
const DIGITAL_SYMBOLS = new Set([
  'input', 'clock', 'output', 'logic-probe',
  'and-gate', 'or-gate', 'xor-gate', 'nand-gate', 'nor-gate', 'not-gate',
  'd-ff', 'jk-ff', 't-ff', 'sr-latch', 'tristate',
  'mux', 'demux', 'encoder', 'half-adder', 'full-adder', 'decoder', 'comparator',
  'seven-seg', 'bcd-7seg', 'register4', 'counter4',
])
const CIRCUIT_SYMBOLS = new Set([
  ...ELECTRICAL_SYMBOLS, ...ELECTRONICS_SYMBOLS, ...DIGITAL_SYMBOLS,
  'electric-motor', 'induction-motor',
])

// Tall symbols that need more height so pins don't crowd each other
const TALL_H: Record<string, number> = {
  'seven-seg': 150, 'bcd-7seg': 150, 'register4': 100, 'counter4': 90,
  'wattmeter': 80, 'transformer': 80, 'transformer-ct': 90,
  'three-phase-source': 80, 'induction-motor': 80,
  'full-adder': 80, 'decoder': 96, 'encoder': 96, 'comparator': 80,
  'half-adder': 72, 'jk-ff': 80, 'mux': 80, 'demux': 80,
  'bjt': 72, 'bjt-pnp': 72, 'mosfet': 72, 'mosfet-pmos': 72,
  'opamp': 72,
}

// Mechanics / optics / waves / quantum components
const MECHANICS_COMPONENTS: Record<string, { kind: GeometryKind; behavior: BehaviorType; w: number; h: number; render?: string; extraBehaviors?: BehaviorType[] }> = {
  mass:            { kind: 'circle', behavior: 'rigidBody',   w: 70,  h: 70  },
  block:           { kind: 'rect',   behavior: 'rigidBody',   w: 110, h: 80  },
  beam:            { kind: 'rect',   behavior: 'rigidBody',   w: 260, h: 16  },
  wheel:           { kind: 'circle', behavior: 'rigidBody',   w: 100, h: 100 },
  ground:          { kind: 'rect',   behavior: 'staticBody',  w: 480, h: 26,  render: 'ground' },
  spring:          { kind: 'line',   behavior: 'spring',      w: 150, h: 2,   render: 'spring' },
  rope:            { kind: 'line',   behavior: 'rope',        w: 150, h: 2,   render: 'rope'   },
  rod:             { kind: 'line',   behavior: 'rod',         w: 150, h: 2   },
  damper:          { kind: 'line',   behavior: 'damper',      w: 120, h: 2,   render: 'damper' },
  hinge:           { kind: 'circle', behavior: 'hinge',       w: 22,  h: 22,  render: 'hinge'  },
  motor:           { kind: 'circle', behavior: 'rigidBody',   w: 80,  h: 80,  render: 'motor', extraBehaviors: ['motor'] },
  charge:          { kind: 'circle', behavior: 'rigidBody',   w: 46,  h: 46,  render: 'charge', extraBehaviors: ['charge'] },
  efield:          { kind: 'rect',   behavior: 'efield',      w: 260, h: 180, render: 'field' },
  bfield:          { kind: 'rect',   behavior: 'bfield',      w: 260, h: 180, render: 'field' },
  heatblock:       { kind: 'rect',   behavior: 'staticBody',  w: 100, h: 100, extraBehaviors: ['heatSource'] },
  'heat-block':    { kind: 'rect',   behavior: 'staticBody',  w: 100, h: 100, extraBehaviors: ['heatSource'] },
  torsionpendulum: { kind: 'circle', behavior: 'hinge',       w: 22,  h: 22,  render: 'hinge', extraBehaviors: ['torsionSpring'] },
  'torsion-pendulum': { kind: 'circle', behavior: 'hinge',    w: 22,  h: 22,  render: 'hinge', extraBehaviors: ['torsionSpring'] },
  'reference-point': { kind: 'circle', behavior: 'rigidBody', w: 20,  h: 20,  render: 'reference-point' },
}

const OPTICS_COMPONENTS: Record<string, { kind: GeometryKind; behavior: BehaviorType; w: number; h: number; render: string; points?: [number,number][] }> = {
  'light-source':   { kind: 'circle', behavior: 'lightSource',    w: 24,  h: 24,  render: 'light-source' },
  lightsource:      { kind: 'circle', behavior: 'lightSource',    w: 24,  h: 24,  render: 'light-source' },
  'thin-lens':      { kind: 'line',   behavior: 'thinLens',       w: 2,   h: 120, render: 'lens', points: [[0,0],[0,120]] },
  lens:             { kind: 'line',   behavior: 'thinLens',       w: 2,   h: 120, render: 'lens', points: [[0,0],[0,120]] },
  mirror:           { kind: 'line',   behavior: 'opticalMirror',  w: 2,   h: 120, render: 'mirror', points: [[0,0],[0,120]] },
  'optical-mirror': { kind: 'line',   behavior: 'opticalMirror',  w: 2,   h: 120, render: 'mirror', points: [[0,0],[0,120]] },
  screen:           { kind: 'line',   behavior: 'opticalScreen',  w: 2,   h: 160, render: 'optical-screen', points: [[0,0],[0,160]] },
  'optical-screen': { kind: 'line',   behavior: 'opticalScreen',  w: 2,   h: 160, render: 'optical-screen', points: [[0,0],[0,160]] },
  slit:             { kind: 'line',   behavior: 'slit',           w: 2,   h: 200, render: 'slit', points: [[0,0],[0,200]] },
}

const WAVES_COMPONENTS: Record<string, { kind: GeometryKind; behavior: BehaviorType; w: number; h: number; render: string; points?: [number,number][] }> = {
  'wave-source':      { kind: 'circle', behavior: 'waveSource',       w: 24,  h: 24,  render: 'wave-source' },
  wavesource:         { kind: 'circle', behavior: 'waveSource',       w: 24,  h: 24,  render: 'wave-source' },
  'wave-boundary':    { kind: 'line',   behavior: 'waveBoundary',     w: 2,   h: 120, render: 'wave-boundary', points: [[0,0],[0,120]] },
  waveboundary:       { kind: 'line',   behavior: 'waveBoundary',     w: 2,   h: 120, render: 'wave-boundary', points: [[0,0],[0,120]] },
  'transmission-line':{ kind: 'line',   behavior: 'transmissionLine', w: 220, h: 2,   render: 'transmission-line', points: [[0,0],[220,0]] },
  transmissionline:   { kind: 'line',   behavior: 'transmissionLine', w: 220, h: 2,   render: 'transmission-line', points: [[0,0],[220,0]] },
}

const QUANTUM_COMPONENTS: Record<string, { kind: GeometryKind; behavior: BehaviorType; w: number; h: number; render: string }> = {
  'quantum-well':   { kind: 'rect', behavior: 'quantumWell',   w: 260, h: 160, render: 'quantum-well'  },
  quantumwell:      { kind: 'rect', behavior: 'quantumWell',   w: 260, h: 160, render: 'quantum-well'  },
  'tunnel-barrier': { kind: 'rect', behavior: 'tunnelBarrier', w: 260, h: 140, render: 'tunnel-barrier' },
  tunnelbarrier:    { kind: 'rect', behavior: 'tunnelBarrier', w: 260, h: 140, render: 'tunnel-barrier' },
}

// Default numeric params for circuit components (same as factory.ts)
const CIRCUIT_DEFAULTS: Record<string, Record<string, string>> = {
  battery: { V: '9' },
  'ac-source': { V: '12', f: '1', wave: '0' },
  'current-source': { I: '0.01' },
  resistor: { R: '100' },
  bulb: { R: '20' },
  capacitor: { C: '0.001' },
  inductor: { L: '0.1' },
  potentiometer: { R: '1000', ratio: '0.5' },
  switch: { closed: '1' },
  fuse: { Imax: '1' },
  vcvs: { gain: '2' },
  vccs: { gm: '0.01' },
  ccvs: { r: '100' },
  cccs: { beta: '2' },
  transformer: { n: '2' },
  'transformer-ct': { n: '2' },
  'three-phase-source': { V: '220', f: '50' },
  'dc-machine': { Ra: '2', k: '0.5', J: '0.02', load: '0', friction: '0.001' },
  'electric-motor': { Ra: '2', k: '0.5', J: '0.02', load: '0', friction: '0.001' },
  'induction-motor': { R2: '5', X: '8', poles: '4', f: '50', J: '0.05', load: '0', friction: '0.001' },
  diode: { Vf: '0.7' },
  led: { Vf: '2' },
  zener: { Vf: '0.7', Vz: '5.1' },
  bjt: { beta: '100' },
  'bjt-pnp': { beta: '100' },
  mosfet: { Vt: '2' },
  'mosfet-pmos': { Vt: '2' },
  opamp: { gain: '100000' },
  clock: { f: '1' },
  input: { value: '0' },
  counter4: { mod: '16', dir: '0' },
}

// ── Anchor → terminal index map ───────────────────────────────────────────────
// Maps friendly anchor names to terminal indices in TERMINALS.
// This covers every named terminal for every symbol.
const ANCHOR_INDEX: Record<string, Record<string, number>> = {
  // 2-terminal (T2) components: index 0 = positive/anode/in, index 1 = negative/cathode/out
  _t2: { positive: 0, negative: 1, anode: 0, cathode: 1, plus: 0, minus: 1, in: 0, out: 1, input: 0, output: 1, a: 0, b: 1 },
  battery:          { positive: 0, negative: 1, plus: 0, minus: 1 },
  'ac-source':      { positive: 0, negative: 1 },
  'current-source': { positive: 0, negative: 1 },
  resistor:         { input1: 0, input2: 1, a: 0, b: 1, in: 0, out: 1 },
  bulb:             { input1: 0, input2: 1, a: 0, b: 1 },
  capacitor:        { positive: 0, negative: 1, a: 0, b: 1 },
  inductor:         { a: 0, b: 1 },
  switch:           { a: 0, b: 1 },
  fuse:             { a: 0, b: 1 },
  diode:            { anode: 0, cathode: 1, a: 0, k: 1 },
  led:              { anode: 0, cathode: 1, a: 0, k: 1 },
  zener:            { anode: 0, cathode: 1 },
  ammeter:          { a: 0, b: 1 },
  voltmeter:        { a: 0, b: 1 },
  'dc-machine':     { positive: 0, negative: 1 },
  'pressure-plate': { a: 0, b: 1 },
  'not-gate':       { input: 0, in: 0, output: 1, out: 1 },
  // 3-terminal
  potentiometer:    { top: 0, wiper: 1, w: 1, bottom: 2 },
  bjt:              { base: 0, b: 0, collector: 1, c: 1, emitter: 2, e: 2 },
  'bjt-pnp':        { base: 0, b: 0, collector: 1, c: 1, emitter: 2, e: 2 },
  mosfet:           { gate: 0, g: 0, drain: 1, d: 1, source: 2, s: 2 },
  'mosfet-pmos':    { gate: 0, g: 0, drain: 1, d: 1, source: 2, s: 2 },
  opamp:            { 'in+': 0, inp: 0, positive: 0, 'in-': 1, inn: 1, negative: 1, out: 2, output: 2 },
  'sr-latch':       { s: 0, r: 1, q: 2, output: 2 },
  'd-ff':           { d: 0, clk: 1, clock: 1, q: 2, output: 2 },
  't-ff':           { t: 0, clk: 1, clock: 1, q: 2, output: 2 },
  tristate:         { input: 0, in: 0, enable: 1, en: 1, output: 2, out: 2 },
  // Gates (GATE3 default: [in0, in1, out]) — variable but default 2 inputs
  'and-gate':       { input1: 0, in1: 0, a: 0, input2: 1, in2: 1, b: 1, output: 2, out: 2 },
  'or-gate':        { input1: 0, in1: 0, a: 0, input2: 1, in2: 1, b: 1, output: 2, out: 2 },
  'xor-gate':       { input1: 0, in1: 0, a: 0, input2: 1, in2: 1, b: 1, output: 2, out: 2 },
  'nand-gate':      { input1: 0, in1: 0, a: 0, input2: 1, in2: 1, b: 1, output: 2, out: 2 },
  'nor-gate':       { input1: 0, in1: 0, a: 0, input2: 1, in2: 1, b: 1, output: 2, out: 2 },
  'jk-ff':          { j: 0, clk: 1, clock: 1, k: 2, q: 3, output: 3 },
  // 4-terminal controlled sources
  vcvs:             { 'ctrl+': 0, ctrlp: 0, 'ctrl-': 1, ctrln: 1, out: 2, 'out-': 3 },
  vccs:             { 'ctrl+': 0, ctrlp: 0, 'ctrl-': 1, ctrln: 1, out: 2, 'out-': 3 },
  ccvs:             { 'ctrl+': 0, ctrlp: 0, 'ctrl-': 1, ctrln: 1, out: 2, 'out-': 3 },
  cccs:             { 'ctrl+': 0, ctrlp: 0, 'ctrl-': 1, ctrln: 1, out: 2, 'out-': 3 },
  transformer:      { 'primary+': 0, p1: 0, 'primary-': 1, p2: 1, 'secondary+': 2, s1: 2, 'secondary-': 3, s2: 3 },
  'transformer-ct': { 'primary+': 0, p1: 0, 'primary-': 1, p2: 1, s1: 2, ct: 3, s2: 4 },
  wattmeter:        { 'current+': 0, ip: 0, 'current-': 1, in_: 1, 'voltage+': 2, vp: 2, 'voltage-': 3, vn: 3 },
  // Single terminal
  gnd:              { terminal: 0, a: 0 },
  probe:            { terminal: 0, a: 0 },
  'logic-probe':    { terminal: 0, a: 0 },
  input:            { output: 0, out: 0, q: 0 },
  clock:            { output: 0, out: 0, q: 0 },
  output:           { input: 0, in: 0, d: 0 },
  // multi-output
  'three-phase-source': { a: 0, b: 1, c: 2, n: 3, neutral: 3 },
  'induction-motor':    { a: 0, b: 1, c: 2, n: 3, neutral: 3 },
  'half-adder':     { a: 0, b: 1, sum: 2, s: 2, carry: 3, cout: 3 },
  'full-adder':     { a: 0, b: 1, cin: 2, sum: 3, s: 3, carry: 4, cout: 4 },
  decoder:          { a: 0, b: 1, y0: 2, y1: 3, y2: 4, y3: 5 },
  comparator:       { a: 0, b: 1, lt: 2, eq: 3, gt: 4 },
  mux:              { in0: 0, in1: 1, sel: 2, output: 3, out: 3 },
  demux:            { input: 0, in: 0, sel: 1, out0: 2, out1: 3 },
  encoder:          { in0: 0, in1: 1, in2: 2, in3: 3, out0: 4, out1: 5 },
  'seven-seg':      { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6 },
  'bcd-7seg':       { a: 0, b: 1, c: 2, d: 3, qa: 4, qb: 5, qc: 6, qd: 7, qe: 8, qf: 9, qg: 10 },
  counter4:         { clk: 0, clock: 0, q0: 1, q1: 2, q2: 3, q3: 4 },
  register4:        { sin: 0, clk: 1, clock: 1, sout: 2 },
}

// ─────────────────────────────────────────────────────────────────────────────

class ScriptObject {
  id: string
  pageId: string

  constructor(id: string, pageId: string) {
    this.id = id
    this.pageId = pageId
  }

  // Resolve an anchor name to an { objectId, anchor } descriptor understood by connect()
  _anchor(name: string) { return { objectId: this.id, anchor: name } }

  // ── Generic named-anchor proxy ─────────────────────────────────────────────
  // Intercept ANY property access so users can write battery.positive, gate.input1, etc.
  // This is done via a Proxy wrapping the ScriptObject instance (see wrapProxy below).

  // Physics properties (for graph.plot)
  get vx()  { return { objectId: this.id, property: 'vx'  } }
  get vy()  { return { objectId: this.id, property: 'vy'  } }
  get ax()  { return { objectId: this.id, property: 'ax'  } }
  get ay()  { return { objectId: this.id, property: 'ay'  } }
  get V()   { return { objectId: this.id, property: 'V'   } }
  get I()   { return { objectId: this.id, property: 'I'   } }
  get P()   { return { objectId: this.id, property: 'P'   } }
  get omega(){ return { objectId: this.id, property: 'omega' } }
  get angle(){ return { objectId: this.id, property: 'angle' } }
  get x()   { return { objectId: this.id, property: 'x'   } }
  get y()   { return { objectId: this.id, property: 'y'   } }
  get ke()  { return { objectId: this.id, property: 'ke'  } }
  get pe()  { return { objectId: this.id, property: 'pe'  } }
  get speed(){ return { objectId: this.id, property: 'speed' } }

  /** Update params / position / size on this object. */
  set(props: Record<string, any>) {
    const current = store().pages[this.pageId]?.objects?.[this.id]
    if (!current) return this
    const paramUpdates: Record<string, any> = {}
    for (const [k, v] of Object.entries(props)) {
      if (k === 'x' || k === 'y' || k === 'width' || k === 'height' || k === 'rotation') continue
      paramUpdates[k] = typeof v === 'number' ? num(String(v)) : str(String(v))
    }
    const next = {
      ...current,
      position: { x: props.x ?? current.position.x, y: props.y ?? current.position.y },
      size: { w: props.width ?? current.size.w, h: props.height ?? current.size.h },
      rotation: props.rotation ?? current.rotation,
      parameters: { ...current.parameters, ...paramUpdates },
    }
    store().addObject(this.pageId, next, { history: false })
    return this
  }
}

/** Wrap a ScriptObject in a Proxy so any unknown property access returns an anchor descriptor. */
function wrapProxy(obj: ScriptObject): ScriptObject {
  return new Proxy(obj, {
    get(target, prop: string) {
      if (prop in target) return (target as any)[prop]
      // Treat unknown string props as anchor names
      if (typeof prop === 'string' && !prop.startsWith('_')) {
        return { objectId: target.id, anchor: prop }
      }
      return undefined
    }
  }) as ScriptObject
}

// ─────────────────────────────────────────────────────────────────────────────

export function executeSimScript(
  pageId: string,
  source: string,
  origin: { x: number; y: number } = { x: 200, y: 100 }
) {

  // Track connections for post-run auto-layout
  const circuitEdges: { fromId: string; fromAnchor: string; toId: string; toAnchor: string }[] = []
  // IDs of objects the user explicitly positioned (had x/y in props → skip auto-layout)
  const explicitPos = new Set<string>()

  // ── create() ────────────────────────────────────────────────────────────────
  const create = (kind: string, props: Record<string, any> = {}): ScriptObject => {
    const id = uid()
    const hasExplicitPos = props.x !== undefined || props.y !== undefined
    const normalKind = kind.toLowerCase()

    let obj: SceneObject

    // ── Circuit / schematic symbol ────────────────────────────────────────────
    if (CIRCUIT_SYMBOLS.has(normalKind)) {
      const domain = ELECTRICAL_SYMBOLS.has(normalKind)  ? 'electrical'
                   : ELECTRONICS_SYMBOLS.has(normalKind) ? 'electronics'
                   : 'digital'
      const defaults = CIRCUIT_DEFAULTS[normalKind] ?? {}
      const params: Record<string, any> = {}
      for (const [k, v] of Object.entries(defaults)) params[k] = num(v)
      // Allow user to override defaults
      for (const [k, v] of Object.entries(props)) {
        if (k !== 'x' && k !== 'y' && k !== 'width' && k !== 'height' && k !== 'rotation' && k !== 'dir' && k !== 'name') {
          params[k] = typeof v === 'number' ? num(String(v)) : str(String(v))
        }
      }
      obj = {
        id,
        name: props.name ?? normalKind,
        geometry: { kind: 'symbol', symbol: normalKind, domain },
        position: { x: origin.x + (props.x ?? 0), y: origin.y + (props.y ?? 0) },
        size: { w: props.width ?? 96, h: props.height ?? (TALL_H[normalKind] ?? 48) },
        rotation: props.rotation ?? (props.dir === 'up' ? -90 : props.dir === 'down' ? 90 : props.dir === 'left' ? 180 : 0),
        z: Date.now(),
        behaviors: [{ id: uid(), type: 'electricalNode' as BehaviorType, enabled: true, params: {} }],
        parameters: params,
        metadata: { nameExplicit: !!props.name },
      }

    // ── Mechanics component ───────────────────────────────────────────────────
    } else if (normalKind in MECHANICS_COMPONENTS) {
      const def = MECHANICS_COMPONENTS[normalKind]
      const behaviors: any[] = [{ id: uid(), type: def.behavior, enabled: true, params: def.behavior === 'rigidBody' ? { mass: num(String(props.mass ?? 1)) } : {} }]
      if (def.extraBehaviors) for (const bt of def.extraBehaviors) behaviors.push({ id: uid(), type: bt, enabled: true, params: {} })
      obj = {
        id,
        name: props.name ?? normalKind,
        geometry: { kind: def.kind, points: def.kind === 'line' ? [[0,0],[def.w,0]] : undefined },
        position: { x: origin.x + (props.x ?? 0), y: origin.y + (props.y ?? 0) },
        size: { w: props.width ?? def.w, h: props.height ?? def.h },
        rotation: props.rotation ?? (props.dir === 'up' ? -90 : props.dir === 'down' ? 90 : props.dir === 'left' ? 180 : 0),
        z: Date.now(),
        behaviors,
        parameters: {},
        metadata: { render: def.render, nameExplicit: !!props.name },
      }

    // ── Optics component ──────────────────────────────────────────────────────
    } else if (normalKind in OPTICS_COMPONENTS) {
      const def = OPTICS_COMPONENTS[normalKind]
      obj = {
        id,
        name: props.name ?? normalKind,
        geometry: { kind: def.kind, points: def.points },
        position: { x: origin.x + (props.x ?? 0), y: origin.y + (props.y ?? 0) },
        size: { w: props.width ?? def.w, h: props.height ?? def.h },
        rotation: props.rotation ?? 0,
        z: Date.now(),
        behaviors: [{ id: uid(), type: def.behavior, enabled: true, params: {} }],
        parameters: {},
        metadata: { render: def.render, nameExplicit: !!props.name },
      }

    // ── Waves component ───────────────────────────────────────────────────────
    } else if (normalKind in WAVES_COMPONENTS) {
      const def = WAVES_COMPONENTS[normalKind]
      obj = {
        id,
        name: props.name ?? normalKind,
        geometry: { kind: def.kind, points: def.points },
        position: { x: origin.x + (props.x ?? 0), y: origin.y + (props.y ?? 0) },
        size: { w: props.width ?? def.w, h: props.height ?? def.h },
        rotation: props.rotation ?? 0,
        z: Date.now(),
        behaviors: [{ id: uid(), type: def.behavior, enabled: true, params: {} }],
        parameters: {},
        metadata: { render: def.render, nameExplicit: !!props.name },
      }

    // ── Quantum component ─────────────────────────────────────────────────────
    } else if (normalKind in QUANTUM_COMPONENTS) {
      const def = QUANTUM_COMPONENTS[normalKind]
      obj = {
        id,
        name: props.name ?? normalKind,
        geometry: { kind: def.kind },
        position: { x: origin.x + (props.x ?? 0), y: origin.y + (props.y ?? 0) },
        size: { w: props.width ?? def.w, h: props.height ?? def.h },
        rotation: 0,
        z: Date.now(),
        behaviors: [{ id: uid(), type: def.behavior, enabled: true, params: {} }],
        parameters: {},
        metadata: { render: def.render, nameExplicit: !!props.name },
      }

    // ── Special canvas objects ────────────────────────────────────────────────
    } else if (normalKind === 'graph') {
      obj = {
        id,
        name: props.name ?? 'Graph',
        geometry: { kind: 'graph' },
        position: { x: origin.x + (props.x ?? 0), y: origin.y + (props.y ?? 0) },
        size: { w: props.width ?? 380, h: props.height ?? 260 },
        rotation: 0, z: Date.now(), behaviors: [],
        parameters: { sourceId: str(''), yChannels: str('') },
        metadata: { nameExplicit: !!props.name },
      }
    } else if (normalKind === 'table') {
      obj = {
        id,
        name: props.name ?? 'Table',
        geometry: { kind: 'table' },
        position: { x: origin.x + (props.x ?? 0), y: origin.y + (props.y ?? 0) },
        size: { w: props.width ?? 380, h: props.height ?? 260 },
        rotation: 0, z: Date.now(), behaviors: [],
        parameters: { data: str('') },
        metadata: { nameExplicit: !!props.name },
      }
    } else if (normalKind === 'note') {
      obj = {
        id,
        name: props.name ?? 'Note',
        geometry: { kind: 'note' },
        position: { x: origin.x + (props.x ?? 0), y: origin.y + (props.y ?? 0) },
        size: { w: props.width ?? 220, h: props.height ?? 180 },
        rotation: 0, z: Date.now(), behaviors: [],
        parameters: { text: str(props.text ?? '') },
        metadata: { color: props.color ?? 'amber', nameExplicit: !!props.name },
      }
    } else if (normalKind === 'cashflow') {
      obj = {
        id,
        name: props.name ?? 'Cash Flow',
        geometry: { kind: 'cashflow' },
        position: { x: origin.x + (props.x ?? 0), y: origin.y + (props.y ?? 0) },
        size: { w: props.width ?? 480, h: props.height ?? 300 },
        rotation: 0, z: Date.now(), behaviors: [],
        parameters: { spec: str(JSON.stringify(EMPTY_SPEC)) },
        metadata: { nameExplicit: !!props.name },
      }
    } else if (normalKind === 'truthtable' || normalKind === 'truth-table') {
      obj = {
        id,
        name: props.name ?? 'Truth Table',
        geometry: { kind: 'truthtable' },
        position: { x: origin.x + (props.x ?? 0), y: origin.y + (props.y ?? 0) },
        size: { w: props.width ?? 320, h: props.height ?? 260 },
        rotation: 0, z: Date.now(), behaviors: [],
        parameters: { inputs: str(props.inputs ?? ''), outputs: str(props.outputs ?? '') },
        metadata: { nameExplicit: !!props.name },
      }
    } else {
      // ── Generic geometry fallback ─────────────────────────────────────────
      const gk = (normalKind === 'rect' ? 'rect' : normalKind === 'circle' ? 'circle' : normalKind === 'line' ? 'line' : normalKind === 'polygon' ? 'polygon' : 'rect') as GeometryKind
      obj = {
        id,
        name: props.name ?? kind,
        geometry: { kind: gk },
        position: { x: origin.x + (props.x ?? 0), y: origin.y + (props.y ?? 0) },
        size: { w: props.width ?? 80, h: props.height ?? 60 },
        rotation: props.rotation ?? 0,
        z: Date.now(), behaviors: [],
        parameters: {},
        metadata: { nameExplicit: !!props.name },
      }
    }

    if (hasExplicitPos) explicitPos.add(id)
    store().addObject(pageId, obj, { history: false })
    return wrapProxy(new ScriptObject(id, pageId))
  }

  // ── connect() ───────────────────────────────────────────────────────────────
  // Resolves anchor names to real terminal world coordinates,
  // then adds a wire line object and records the edge for auto-layout.
  const connect = (a: any, b: any, type: string = 'wire') => {
    if (!a?.objectId || !b?.objectId) {
      console.warn('[SimScript] connect: invalid anchor', a, b)
      return
    }

    circuitEdges.push({ fromId: a.objectId, fromAnchor: a.anchor, toId: b.objectId, toAnchor: b.anchor })

    const objA = store().pages[pageId]?.objects?.[a.objectId]
    const objB = store().pages[pageId]?.objects?.[b.objectId]

    const resolveAnchor = (obj: SceneObject | undefined, anchor: string, fallbackX: number, fallbackY: number) => {
      if (!obj) return { x: fallbackX, y: fallbackY }
      const terminals = terminalsOf(obj)
      if (terminals.length === 0) return { x: obj.position.x + obj.size.w / 2, y: obj.position.y + obj.size.h / 2 }

      // 1. Look up in per-symbol anchor index
      const sym = obj.geometry.symbol ?? ''
      const symMap = ANCHOR_INDEX[sym] ?? {}
      const idx = symMap[anchor] ?? ANCHOR_INDEX._t2[anchor] ?? -1

      // 2. Numeric fallback: 'pin0', 'pin1', ...
      let termIdx = idx
      if (termIdx < 0) {
        const numMatch = anchor.match(/^(?:pin|t|terminal)?(\d+)$/)
        if (numMatch) termIdx = parseInt(numMatch[1])
      }
      // 3. Named fallback by position convention
      if (termIdx < 0) {
        if (anchor === 'centre') return { x: obj.position.x + obj.size.w / 2, y: obj.position.y + obj.size.h / 2 }
        // First terminal = 'in' / last terminal = 'out'
        termIdx = (anchor === 'in' || anchor === 'input' || anchor === 'positive' || anchor === 'anode') ? 0 : terminals.length - 1
      }

      termIdx = Math.max(0, Math.min(terminals.length - 1, termIdx))
      return terminalWorld(obj, terminals[termIdx])
    }

    const pA = resolveAnchor(objA, a.anchor, 0, 0)
    const pB = resolveAnchor(objB, b.anchor, 200, 200)

    const id = uid()
    const line: SceneObject = {
      id,
      name: type,
      geometry: {
        kind: 'line',
        points: [
          [pA.x - Math.min(pA.x, pB.x), pA.y - Math.min(pA.y, pB.y)],
          [pB.x - Math.min(pA.x, pB.x), pB.y - Math.min(pA.y, pB.y)],
        ],
      },
      position: { x: Math.min(pA.x, pB.x), y: Math.min(pA.y, pB.y) },
      size: { w: Math.abs(pB.x - pA.x) || 4, h: Math.abs(pB.y - pA.y) || 4 },
      rotation: 0,
      z: Date.now(),
      behaviors: [{
        id: uid(), type: 'wire' as BehaviorType, enabled: true,
        params: {
          targetA: str(a.objectId), anchorA: str(a.anchor),
          targetB: str(b.objectId), anchorB: str(b.anchor),
        },
      }],
      parameters: {},
      metadata: { render: type },
    }
    store().addObject(pageId, line, { history: false })
    return wrapProxy(new ScriptObject(id, pageId))
  }

  // ── graph object ─────────────────────────────────────────────────────────────
  // graph.plot(obj.property)                → plot vs time (default)
  // graph.plot(obj.vy, obj.vx)              → y vs x
  // graph.plot(obj.vy, 'bar')               → bar style vs time
  // graph.plot(obj.V, obj.I, 'scatter')     → scatter
  const graph = {
    plot: (yVar: any, xVarOrStyle?: any, styleArg: string = 'line') => {
      let xVar: any = null
      let style = styleArg
      if (typeof xVarOrStyle === 'string') style = xVarOrStyle
      else if (xVarOrStyle != null) xVar = xVarOrStyle

      let graphObj = Object.values(store().pages[pageId]?.objects ?? {}).find(o => o.geometry.kind === 'graph')

      const newGraph: SceneObject = graphObj ? { ...graphObj } : {
        id: uid(), name: 'Graph', geometry: { kind: 'graph' },
        position: { x: origin.x + 600, y: origin.y },
        size: { w: 380, h: 260 }, rotation: 0, z: Date.now(),
        behaviors: [], parameters: {}, metadata: {},
      }

      const yProp = yVar?.property ?? String(yVar)
      const yId   = yVar?.objectId ?? ''
      const xIsTime = !xVar
      const xProp = xIsTime ? 't' : (xVar?.property ?? String(xVar))
      const xId   = !xIsTime ? (xVar?.objectId ?? '') : ''

      const seriesStr = yId ? `${yId}:${yProp}` : ''
      const oldSeries = newGraph.parameters.series?.kind === 'string' ? newGraph.parameters.series.value : ''
      newGraph.parameters = {
        ...newGraph.parameters,
        series: str(seriesStr ? (oldSeries ? `${oldSeries};${seriesStr}` : seriesStr) : oldSeries),
        ...(xIsTime ? {} : { xChannel: str(xProp) }),
        plot_style: str(style),
      }
      store().addObject(pageId, newGraph, { history: false })
    },
  }

  // ── Sandbox ───────────────────────────────────────────────────────────────────
  const builtins: Record<string, any> = { create, connect, graph, console, Math }
  const sandboxVars: Record<string, any> = {}
  const sandbox = new Proxy(builtins, {
    has() { return true },
    get(target, key: string) {
      if (key === (Symbol.unscopables as any)) return undefined
      if (key in target) return target[key]
      return sandboxVars[key]
    },
    set(_t, key: string, value) { sandboxVars[key] = value; return true },
  })

  const transpiled = source.replace(/\b(var|let|const)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/g, '$2')
  const fn = new Function('sandbox', `with(sandbox) { ${transpiled} }`)
  fn(sandbox)

  // ── Smart circuit auto-layout ──────────────────────────────────────────────
  // Runs only when there are edges and at least some nodes without explicit positions.
  if (circuitEdges.length > 0) {
    const allIds = new Set<string>()
    for (const e of circuitEdges) { allIds.add(e.fromId); allIds.add(e.toId) }
    const layoutIds = [...allIds].filter(id => !explicitPos.has(id))

    if (layoutIds.length > 0) {
      // Build directed adjacency from edge order (fromId → toId)
      const adj = new Map<string, string[]>()
      for (const id of layoutIds) adj.set(id, [])
      for (const e of circuitEdges) {
        if (!explicitPos.has(e.fromId) && !explicitPos.has(e.toId)) {
          adj.get(e.fromId)?.push(e.toId)
        }
      }

      // BFS from the node with no incoming edges (most source-like) — leftmost in layout
      const inDegree = new Map<string, number>()
      for (const id of layoutIds) inDegree.set(id, 0)
      for (const e of circuitEdges) {
        if (!explicitPos.has(e.toId)) inDegree.set(e.toId, (inDegree.get(e.toId) ?? 0) + 1)
      }
      const sources = layoutIds.filter(id => (inDegree.get(id) ?? 0) === 0)
      const startId = sources.length > 0 ? sources[0] : layoutIds[0]

      const col = new Map<string, number>()
      const visited = new Set<string>()
      const queue: { id: string; c: number }[] = [{ id: startId, c: 0 }]
      col.set(startId, 0); visited.add(startId)
      while (queue.length) {
        const { id, c } = queue.shift()!
        for (const nbr of (adj.get(id) ?? [])) {
          if (!visited.has(nbr)) {
            visited.add(nbr)
            col.set(nbr, c + 1)
            queue.push({ id: nbr, c: c + 1 })
          }
        }
        // Also visit via undirected edges for nodes not reached directionally
        for (const e of circuitEdges) {
          const nbr = e.fromId === id ? e.toId : e.toId === id ? e.fromId : null
          if (nbr && !visited.has(nbr) && layoutIds.includes(nbr)) {
            visited.add(nbr)
            col.set(nbr, c + 1)
            queue.push({ id: nbr, c: c + 1 })
          }
        }
      }

      // Group by column, assign rows
      const colGroups = new Map<number, string[]>()
      for (const id of layoutIds) {
        const c = col.get(id) ?? 0
        if (!colGroups.has(c)) colGroups.set(c, [])
        colGroups.get(c)!.push(id)
      }

      const GAP_X = 40, GAP_Y = 24
      const colX = new Map<number, number>()
      const maxCols = Math.max(...[...col.values()]) + 1
      let cx = origin.x
      for (let c = 0; c < maxCols; c++) {
        colX.set(c, cx)
        const ids = colGroups.get(c) ?? []
        const maxW = Math.max(...ids.map(id => store().pages[pageId]?.objects?.[id]?.size.w ?? 96), 96)
        cx += maxW + GAP_X
      }

      const positions = new Map<string, { x: number; y: number }>()
      for (const [c, ids] of colGroups) {
        let cy = origin.y
        for (const id of ids) {
          positions.set(id, { x: colX.get(c) ?? origin.x, y: cy })
          cy += (store().pages[pageId]?.objects?.[id]?.size.h ?? 48) + GAP_Y
        }
      }

      // Apply positions
      for (const [id, pos] of positions) {
        store().updateObject(pageId, id, { position: pos }, { history: false })
      }

      // Re-route wires to actual terminal world positions
      for (const e of circuitEdges) {
        const wireObj = Object.values(store().pages[pageId]?.objects ?? {}).find(o =>
          o.geometry.kind === 'line' &&
          o.behaviors.some(b =>
            b.params.targetA?.kind === 'string' && b.params.targetA.value === e.fromId &&
            b.params.targetB?.kind === 'string' && b.params.targetB.value === e.toId
          )
        )
        if (!wireObj) continue

        const objA = store().pages[pageId]?.objects?.[e.fromId]
        const objB = store().pages[pageId]?.objects?.[e.toId]
        if (!objA || !objB) continue

        const terminalsA = terminalsOf(objA)
        const terminalsB = terminalsOf(objB)

        const symA = objA.geometry.symbol ?? ''
        const symB = objB.geometry.symbol ?? ''
        const mapA = ANCHOR_INDEX[symA] ?? {}
        const mapB = ANCHOR_INDEX[symB] ?? {}
        const idxA = mapA[e.fromAnchor] ?? ANCHOR_INDEX._t2[e.fromAnchor] ?? (terminalsA.length - 1)
        const idxB = mapB[e.toAnchor]   ?? ANCHOR_INDEX._t2[e.toAnchor]   ?? 0

        const tA = terminalsA[Math.min(Math.max(0, idxA), terminalsA.length - 1)] ?? { x: 1, y: 0.5 }
        const tB = terminalsB[Math.min(Math.max(0, idxB), terminalsB.length - 1)] ?? { x: 0, y: 0.5 }

        const wA = terminalWorld(objA, tA)
        const wB = terminalWorld(objB, tB)

        store().updateObject(pageId, wireObj.id, {
          position: { x: Math.min(wA.x, wB.x), y: Math.min(wA.y, wB.y) },
          size: { w: Math.abs(wB.x - wA.x) || 4, h: Math.abs(wB.y - wA.y) || 4 },
          geometry: {
            ...wireObj.geometry,
            points: [
              [wA.x - Math.min(wA.x, wB.x), wA.y - Math.min(wA.y, wB.y)],
              [wB.x - Math.min(wA.x, wB.x), wB.y - Math.min(wA.y, wB.y)],
            ],
          },
        }, { history: false })
      }
    }
  }

  // ── Sync variables to page sidebar ────────────────────────────────────────────
  const currentVars = store().pages[pageId]?.variables ?? []
  const newVars = [...currentVars]

  for (const [k, v] of Object.entries(sandboxVars)) {
    if (v instanceof ScriptObject || (v && typeof v === 'object' && 'objectId' in v && !('property' in v))) {
      // It's a component handle — sync its name
      const objId = v instanceof ScriptObject ? v.id : v.objectId
      if (objId) {
        const current = store().pages[pageId]?.objects?.[objId]
        if (current && !current.metadata.nameExplicit && current.name !== k) {
          store().updateObject(pageId, objId, { name: k }, { history: false })
        }
      }
      continue
    }

    if (typeof v === 'number' || typeof v === 'string') {
      const existing = newVars.find(x => x.name === k)
      if (existing) { existing.value = Number(v); existing.expr = String(v) }
      else newVars.push({ id: uid(), name: k, expr: String(v), value: Number(v) })
    } else if (v && typeof v === 'object' && 'property' in v) {
      // Dynamic binding — e.g. vx = block.vx
      const expr = `${v.objectId}.${v.property}`
      const existing = newVars.find(x => x.name === k)
      if (existing) existing.expr = expr
      else newVars.push({ id: uid(), name: k, expr, value: 0 })
    }
  }

  useDocStore.setState(s => {
    const p = s.pages[pageId]
    if (!p) return s
    return { ...s, pages: { ...s.pages, [pageId]: { ...p, variables: newVars } } }
  })
}
