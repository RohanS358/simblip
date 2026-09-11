import { useDocStore } from '@/lib/store/document'
import { terminalsOf, terminalWorld } from '@/lib/circuit/engine'
import { uid, type SceneObject, type GeometryKind, type BehaviorType, num, str } from './types'
import { behaviorSpec } from '@/lib/behaviors/registry'
import { createGeometry, nextZ } from './factory'
import { channelsFor } from './channels'
import { planPlacement, unionRect, type Bounds } from './auto-layout'
import {
  placeOptimized, OrthoRouter, routeEdge, routeEdgeFrom, halfExtent, hitsAnyBody,
  type Edge as LayoutEdge, type Pt,
} from './circuit-layout'
import { latexToExpr } from '@/lib/formula/latex'
import {
  CANVAS_KINDS, canvasKindOf, applyKindProps, applyStyleProps, RESERVED_PROPS,
  ANCHOR_INDEX,
} from './simscript-props'

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
  dielectric:      { kind: 'rect',   behavior: 'dielectric',  w: 260, h: 180, render: 'field' },
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
  /** Angle about the pivot — the pendulum one. `angle` is the body's own
   *  spin, which stays flat 0 for a bob hanging on a rod. */
  get swing(){ return { objectId: this.id, property: 'swing' } }
  get x()   { return { objectId: this.id, property: 'x'   } }
  get y()   { return { objectId: this.id, property: 'y'   } }
  get ke()  { return { objectId: this.id, property: 'ke'  } }
  get pe()  { return { objectId: this.id, property: 'pe'  } }
  get speed(){ return { objectId: this.id, property: 'speed' } }

  /** Update params / position / size on this object. Keys that belong to an
   *  attached behavior (mass, friction, stiffness, q, f…) are routed into
   *  that behavior's params — the ones the solvers actually read — so
   *  `block.set({ mass: 20 })` genuinely changes the physics. */
  set(props: Record<string, any>) {
    const current = store().pages[this.pageId]?.objects?.[this.id]
    if (!current) return this
    const paramUpdates: Record<string, any> = {}
    let behaviors = current.behaviors
    for (const [k, v] of Object.entries(props)) {
      if (k === 'x' || k === 'y' || k === 'width' || k === 'height' || k === 'rotation') continue
      const wrapped = typeof v === 'number' ? num(String(v)) : str(String(v))
      // Behavior param? (already present on a behavior, or declared by its spec)
      const bi = behaviors.findIndex(
        (b) => k in b.params || behaviorSpec(b.type)?.params.some((p) => p.name === k)
      )
      if (bi >= 0) {
        behaviors = behaviors.map((b, i) => (i === bi ? { ...b, params: { ...b.params, [k]: wrapped } } : b))
        continue
      }
      paramUpdates[k] = wrapped
    }
    const next = {
      ...current,
      position: { x: props.x ?? current.position.x, y: props.y ?? current.position.y },
      size: { w: props.width ?? current.size.w, h: props.height ?? current.size.h },
      rotation: props.rotation ?? current.rotation,
      behaviors,
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
  origin: { x: number; y: number } = { x: 200, y: 100 },
  /** Where the finished scene may go. Supplied by the caller (which can see
   *  the viewport and the page kind) so this module needs no browser stores.
   *  Omitted means no layout pass — the script's own coordinates stand. */
  layoutSurface?: { bounds: Bounds; fixedFrame: boolean }
) {

  // Track connections for post-run auto-layout
  const circuitEdges: { fromId: string; fromAnchor: string; toId: string; toAnchor: string }[] = []
  // IDs of objects the user explicitly positioned (had x/y in props → skip auto-layout)
  const explicitPos = new Set<string>()
  // Every object this run created, in creation order.
  const created: string[] = []

  // ── Anchor names we don't recognise, per object ─────────────────────────────
  // The circuit netlist is built from GEOMETRY, not from names: lib/circuit/
  // engine.ts unions terminals and wire ends by coincident world points. So
  // where connect() lands a wire IS the electrical connection, and an anchor
  // that resolves to the wrong terminal is a genuinely mis-wired circuit.
  //
  // The old fallback sent every unrecognised name to the LAST terminal. Two
  // different names on one component therefore landed on the same pin and the
  // union-find merged them into one net — a short that exists nowhere in the
  // script and shows up only as a wrong answer. Distinct unknown names now get
  // distinct free terminals, which at least preserves what the script said:
  // that these are different points.
  const usedTerminals = new Map<string, Set<number>>()
  const unknownAnchors = new Map<string, Map<string, number>>()
  /** One warning per object+name, not one per connect() that mentions it. */
  const warnedAnchors = new Set<string>()

  /**
   * Anchor name -> terminal index, for one circuit symbol.
   *
   * THE single resolver. connect() draws the wire from this, and the
   * auto-layout netlist unions nets from it (idxFor below) — those used to be
   * two separate copies of this lookup with two separate fallbacks, so a name
   * neither recognised could be drawn to one pin and wired to another. Same
   * reason lib/ai/simscript-lint.ts reads the real registries rather than a
   * copy: a second implementation of a rule is a rule that will disagree.
   */
  const terminalIndexFor = (obj: SceneObject, anchor: string): number => {
    const count = terminalsOf(obj).length
    if (count === 0) return 0
    const norm = anchor.replace(/^input/i, 'in').replace(/^output/i, 'out')
    const symMap = ANCHOR_INDEX[obj.geometry.symbol ?? ''] ?? {}

    let idx =
      symMap[anchor] ?? symMap[norm] ?? ANCHOR_INDEX._t2[anchor] ?? ANCHOR_INDEX._t2[norm] ?? -1

    if (idx < 0) {
      const numMatch = norm.match(/^(?:pin|t|terminal)?(\d+)$/i)
      if (numMatch) idx = parseInt(numMatch[1])
    }
    if (idx < 0) {
      const lower = norm.toLowerCase()
      if (lower === 'in' || lower === 'positive' || lower === 'anode') idx = 0
      else if (lower === 'out' || lower === 'negative' || lower === 'cathode') idx = count - 1
      else {
        // Genuinely unrecognised. Placing it is a guess either way, so make the
        // guess a visible one — silently landing on the wrong pin is how a
        // circuit comes out wired differently from what was written.
        idx = assignUnknownTerminal(obj.id, anchor, count)
        if (!warnedAnchors.has(`${obj.id}:${anchor}`)) {
          warnedAnchors.add(`${obj.id}:${anchor}`)
          console.warn(
            `[SimScript] connect: "${obj.geometry.symbol ?? obj.id}" has no anchor "${anchor}" — ` +
              `using terminal ${idx}. Valid: ${Object.keys(symMap).join(', ') || `pin0…pin${count - 1}`}`
          )
        }
      }
    }

    idx = Math.max(0, Math.min(count - 1, idx))
    const seen = usedTerminals.get(obj.id) ?? new Set<number>()
    seen.add(idx)
    usedTerminals.set(obj.id, seen)
    return idx
  }

  /** A terminal for an anchor name we have no entry for. Stable per name, so a
   *  name reused across connects keeps making the same node. */
  const assignUnknownTerminal = (objId: string, anchor: string, count: number): number => {
    const seen = unknownAnchors.get(objId) ?? new Map<string, number>()
    unknownAnchors.set(objId, seen)
    const already = seen.get(anchor)
    if (already !== undefined) return already
    const used = usedTerminals.get(objId) ?? new Set<number>()
    // First free pin; if every pin is spoken for, the old last-terminal
    // behaviour, which is at least what existing scripts already got.
    let idx = count - 1
    for (let i = 0; i < count; i++) if (!used.has(i)) { idx = i; break }
    seen.set(anchor, idx)
    return idx
  }

  // ── create() ────────────────────────────────────────────────────────────────
  const create = (kind: string, props: Record<string, any> = {}): ScriptObject => {
    const id = uid()
    // Only treat as explicitly positioned if the user passed a non-zero coordinate.
    // x:0, y:0 is the default fallback — don't skip auto-layout for it.
    const hasExplicitPos = (props.x !== undefined && props.x !== 0) || (props.y !== undefined && props.y !== 0)
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
        // RESERVED_PROPS covers position, size AND every styling key, so
        // `create("resistor", { R: 330, fill: "#f00" })` styles the symbol
        // instead of inventing a bogus `fill` electrical parameter.
        if (!RESERVED_PROPS.has(k)) {
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
        z: nextZ(),
        behaviors: [{ id: uid(), type: 'electricalNode' as BehaviorType, enabled: true, params: {} }],
        parameters: params,
        metadata: { nameExplicit: !!props.name },
      }

    // ── Mechanics component ───────────────────────────────────────────────────
    } else if (normalKind in MECHANICS_COMPONENTS) {
      const def = MECHANICS_COMPONENTS[normalKind]
      // Any prop the behavior's spec declares (mass, friction, stiffness, q,
      // Ex, Bz, speed…) lands in the behavior params the solver reads.
      const fromProps = (bt: BehaviorType): Record<string, any> => {
        const out: Record<string, any> = {}
        for (const p of behaviorSpec(bt)?.params ?? []) {
          if (props[p.name] !== undefined) out[p.name] = num(String(props[p.name]))
        }
        return out
      }
      const behaviors: any[] = [{
        id: uid(), type: def.behavior, enabled: true,
        params: { ...(def.behavior === 'rigidBody' ? { mass: num(String(props.mass ?? 1)) } : {}), ...fromProps(def.behavior) },
      }]
      if (def.extraBehaviors) for (const bt of def.extraBehaviors) behaviors.push({ id: uid(), type: bt, enabled: true, params: fromProps(bt) })
      // `length` is what everyone (the AI especially) calls a rod/spring/rope's
      // span, but it's a geometry fact, not a behavior param — none of these
      // behaviors declare it, so it used to be dropped on the floor and every
      // rod came out the stock 150px regardless of what the script asked for.
      const span = def.kind === 'line' ? Number(props.length ?? props.width ?? def.w) : def.w
      obj = {
        id,
        name: props.name ?? normalKind,
        geometry: { kind: def.kind, points: def.kind === 'line' ? [[0,0],[span,0]] : undefined },
        position: { x: origin.x + (props.x ?? 0), y: origin.y + (props.y ?? 0) },
        size: { w: def.kind === 'line' ? span : (props.width ?? def.w), h: props.height ?? def.h },
        rotation: props.rotation ?? (props.dir === 'up' ? -90 : props.dir === 'down' ? 90 : props.dir === 'left' ? 180 : 0),
        z: nextZ(),
        behaviors,
        parameters: {},
        metadata: { render: def.render, nameExplicit: !!props.name },
      }

    // ── Optics component ──────────────────────────────────────────────────────
    } else if (normalKind in OPTICS_COMPONENTS || normalKind in WAVES_COMPONENTS || normalKind in QUANTUM_COMPONENTS) {
      const def = OPTICS_COMPONENTS[normalKind] ?? WAVES_COMPONENTS[normalKind] ?? QUANTUM_COMPONENTS[normalKind]
      const params: Record<string, any> = {}
      for (const p of behaviorSpec(def.behavior)?.params ?? []) {
        if (props[p.name] !== undefined) params[p.name] = num(String(props[p.name]))
      }
      const isQuantum = normalKind in QUANTUM_COMPONENTS
      obj = {
        id,
        name: props.name ?? normalKind,
        geometry: { kind: def.kind, points: 'points' in def ? def.points : undefined },
        position: { x: origin.x + (props.x ?? 0), y: origin.y + (props.y ?? 0) },
        size: { w: props.width ?? def.w, h: props.height ?? def.h },
        rotation: isQuantum ? 0 : props.rotation ?? 0,
        z: nextZ(),
        behaviors: [{ id: uid(), type: def.behavior, enabled: true, params }],
        parameters: {},
        metadata: { render: def.render, nameExplicit: !!props.name },
      }

    // ── Every other canvas object ─────────────────────────────────────────────
    // Delegated to lib/scene/factory.ts — the SAME factory the palette, the
    // tool dock and paste all go through. This used to be a hand-written copy
    // of each kind's defaults here, which is why `gridtable`, `slider`,
    // `button`, `trigger`, `surface3d` and `chart` silently came out as blank
    // rects (four of them were even documented as working): a kind added to
    // the factory never reached SimScript. Delegating means a new kind is
    // scriptable the day it's added, and its defaults can't drift.
    } else if (CANVAS_KINDS.has(canvasKindOf(normalKind))) {
      const gk = canvasKindOf(normalKind)
      obj = createGeometry(gk, {
        x: origin.x + (props.x ?? 0),
        y: origin.y + (props.y ?? 0),
      })
      obj.id = id
      if (props.name) obj.name = String(props.name)
      if (props.width !== undefined) obj.size.w = Number(props.width)
      if (props.height !== undefined) obj.size.h = Number(props.height)
      obj.metadata.nameExplicit = !!props.name
      // `system` is a rect with a render tag, not a geometry kind of its own.
      if (normalKind === 'system') {
        obj.name = props.name ?? `${String(props.domain ?? 'mechanics')} system`
        obj.size = { w: props.width ?? 460, h: props.height ?? 320 }
        obj.z = 0 // backdrop — see createSystem() in lib/scene/factory.ts
        obj.metadata.render = 'system'
        obj.metadata.domain = String(props.domain ?? 'mechanics')
      }
      applyKindProps(obj, gk, props)

    } else {
      // ── Generic geometry fallback ─────────────────────────────────────────
      // Anything unrecognized becomes a plain rect, as documented.
      obj = {
        id,
        name: props.name ?? kind,
        geometry: { kind: 'rect' },
        position: { x: origin.x + (props.x ?? 0), y: origin.y + (props.y ?? 0) },
        size: { w: props.width ?? 80, h: props.height ?? 60 },
        rotation: props.rotation ?? 0,
        z: nextZ(), behaviors: [],
        parameters: {},
        metadata: { nameExplicit: !!props.name },
      }
    }

    // Universal styling — applies to EVERY kind above, so a resistor, a text
    // block and a slider all take the same fill/stroke/opacity/lock props.
    applyStyleProps(obj, props)

    if (hasExplicitPos) explicitPos.add(id)
    created.push(id)
    store().addObject(pageId, obj, { history: false })
    return wrapProxy(new ScriptObject(id, pageId))
  }

  // ── Mechanics connector binding ─────────────────────────────────────────────
  // A rod/spring/rope/damper is bound to its bodies by GEOMETRY: buildWorld
  // runs Matter.Query.point at each of the connector's two endpoints and
  // attaches to whatever body it hits. `connect(rod.a, bob.centre)` therefore
  // has to physically drag that endpoint onto the bob, which is what this does.
  //
  // Endpoint naming: `a`/`start`/`p0`/`0`/`in` = endpoint 0, anything else = 1.
  const MECH_CONNECTOR_BEHAVIORS = new Set(['rod', 'spring', 'rope', 'damper'])

  const connectorOf = (id: string) => {
    const o = store().pages[pageId]?.objects?.[id]
    return o?.behaviors?.some(bh => bh.enabled && MECH_CONNECTOR_BEHAVIORS.has(bh.type)) ? o : undefined
  }

  const END0 = new Set(['a', 'start', 'p0', '0', 'in', 'from', 'head'])
  const END1 = new Set(['b', 'end', 'p1', '1', 'out', 'to', 'tail'])

  // Centre of the body an endpoint should grab. Uses the object's own centre;
  // that point is inside every body geometry we support, so Query.point hits.
  const bodyPoint = (id: string) => {
    const o = store().pages[pageId]?.objects?.[id]
    if (!o) return undefined
    return { x: o.position.x + o.size.w / 2, y: o.position.y + o.size.h / 2 }
  }

  // Move one endpoint of `conn` to world point `p`, keeping the other fixed.
  // Rewrites geometry.points (NOT rotation) because endpointWorld in
  // world.ts reads points+position and ignores rotation entirely.
  const moveEndpoint = (connId: string, index: 0 | 1, p: { x: number; y: number }) => {
    const c = store().pages[pageId]?.objects?.[connId]
    if (!c) return
    const pts = c.geometry.points ?? [[0, 0], [c.size.w, 0]]
    const world = pts.map(pt => ({ x: c.position.x + pt[0], y: c.position.y + pt[1] }))
    world[index === 0 ? 0 : world.length - 1] = p
    const minX = Math.min(...world.map(w => w.x))
    const minY = Math.min(...world.map(w => w.y))
    store().updateObject(pageId, connId, {
      position: { x: minX, y: minY },
      geometry: { ...c.geometry, points: world.map(w => [w.x - minX, w.y - minY] as [number, number]) },
      size: {
        w: Math.max(...world.map(w => w.x)) - minX || 2,
        h: Math.max(...world.map(w => w.y)) - minY || 2,
      },
      rotation: 0, // endpoints now carry the angle; a leftover rotation would double it
    }, { history: false })
    explicitPos.add(connId) // pinned by geometry — auto-layout must not move it
  }

  // Every endpoint→body binding connect() made, replayed after the script ends.
  // A script is free to connect() first and position later
  //   connect(rod.b, bob.centre); bob.set({ x: 400, y: 400 })
  // and the endpoint we stamped at connect() time would be left behind at the
  // bob's OLD centre, hitting nothing. Physics reads geometry, not intent, so
  // the binding has to be re-stamped once every position is final.
  const mechBindings: { connId: string; index: 0 | 1; bodyId: string }[] = []

  /**
   * Which end of `connId` an anchor means.
   *
   * The two named ends are exact. Everything else — `.centre` above all, which
   * the corpus and the system prompt both list as THE anchor for a mechanics
   * part — names no end at all, and used to fall to `1` unconditionally. Two
   * such calls on one connector therefore bound end 1 twice and left end 0
   * attached to nothing:
   *
   *   connect(spring.centre, m1.centre);   // end 1 <- m1
   *   connect(spring.centre, m2.centre);   // end 1 <- m2, m1 silently dropped
   *
   * buildWorld then found no body under end 0 and pinned that side to a fixed
   * world point (Matter.Constraint treats a null bodyA as a world anchor), so
   * the scene LOOKED wired and one of the two bodies was not attached at all —
   * invisible on the canvas and wrong the moment it runs.
   *
   * So a non-specific anchor now takes the first end nobody has claimed. An
   * explicitly named end always wins, even when it repeats: naming `.a` twice
   * is a contradiction in the script, and silently rerouting it to `.b` would
   * be this same class of guess.
   */
  const endpointIndex = (connId: string, anchor: string): 0 | 1 => {
    const name = String(anchor).toLowerCase()
    if (END0.has(name)) return 0
    if (END1.has(name)) return 1
    return mechBindings.some((m) => m.connId === connId && m.index === 0) ? 1 : 0
  }

  const applyBinding = (connId: string, index: 0 | 1, bodyId: string) => {
    const target = bodyPoint(bodyId)
    if (target) moveEndpoint(connId, index, target)
  }

  /** World position of one end of a connector. Mirrors endpointWorld in
   *  lib/physics/world.ts — the function the solver itself reads. */
  const endpointOf = (connId: string, index: 0 | 1) => {
    const c = store().pages[pageId]?.objects?.[connId]
    if (!c) return undefined
    const pts = c.geometry.points ?? [[0, 0], [c.size.w, 0]]
    const p = index === 0 ? pts[0] : pts[pts.length - 1]
    return { x: c.position.x + p[0], y: c.position.y + p[1] }
  }

  // Returns a truthy marker when it handled the pair as a mechanics link.
  const mechConnect = (a: any, b: any) => {
    const connA = connectorOf(a.objectId)
    const connB = connectorOf(b.objectId)
    // Neither side is a connector — a body-to-body pair belongs to the wire
    // path (or to connect(a, b, "rod"), which builds the connector itself).
    if (!connA && !connB) return undefined

    // ── Two connectors: chain them through a joint BODY ─────────────────────
    // A Matter constraint binds bodies, never another constraint, so there is
    // nothing at a bare connector-to-connector joint for the solver to hold
    // and this pair used to fall through to the wire path — a cosmetic line
    // and no physics, the same silent failure as a mis-bound endpoint.
    //
    // A reference-point is exactly the body needed: small, a sensor, and
    // collision-free (lib/physics/world.ts gives it isSensor + an empty
    // collision mask), so inserting one adds a pin joint without adding
    // anything the scene can bump into. Both endpoints then bind to it the
    // ordinary way and the chain articulates.
    if (connA && connB) {
      const idxA = endpointIndex(connA.id, a.anchor)
      const idxB = endpointIndex(connB.id, b.anchor)
      const at = endpointOf(connA.id, idxA) ?? endpointOf(connB.id, idxB)
      if (!at) return undefined
      // Centred on the joint: create() positions by top-left, and the exact
      // endpoints are re-stamped from the joint's real centre after the
      // script finishes, so a size change here cannot leave them behind.
      const joint = create('reference-point', { x: at.x - 10, y: at.y - 10, name: 'joint' })
      mechBindings.push({ connId: connA.id, index: idxA, bodyId: joint.id })
      mechBindings.push({ connId: connB.id, index: idxB, bodyId: joint.id })
      applyBinding(connA.id, idxA, joint.id)
      applyBinding(connB.id, idxB, joint.id)
      explicitPos.add(joint.id)
      return wrapProxy(new ScriptObject(joint.id, pageId))
    }

    const conn = (connA ?? connB)!
    const bodySide = connA ? b : a
    const connSide = connA ? a : b
    const target = bodyPoint(bodySide.objectId)
    if (!target) return undefined
    const index = endpointIndex(conn.id, connSide.anchor)
    moveEndpoint(conn.id, index, target)
    mechBindings.push({ connId: conn.id, index, bodyId: bodySide.objectId })
    explicitPos.add(bodySide.objectId) // don't let circuit layout drag the body away
    return wrapProxy(new ScriptObject(conn.id, pageId))
  }

  // ── connect() ───────────────────────────────────────────────────────────────
  // Resolves anchor names to real terminal world coordinates,
  // then adds a wire line object and records the edge for auto-layout.
  const connect = (a: any, b: any, type: string = 'wire') => {
    if (!a?.objectId || !b?.objectId) {
      console.warn('[SimScript] connect: invalid anchor', a, b)
      return
    }

    // ── Mechanics connectors bind GEOMETRICALLY, not by edge list ────────────
    // buildWorld (lib/physics/world.ts) pairs a rod/spring/rope/damper to its
    // two bodies with Matter.Query.point at the connector's own endpoints —
    // whatever body sits under an endpoint IS the attachment. So for these,
    // connect() must MOVE the endpoint onto the target, not draw a wire; the
    // old wire-drawing path produced a cosmetic line and zero physics, which
    // is why scripted pendulums fell apart instead of swinging.
    const mech = mechConnect(a, b)
    if (mech) return mech
    circuitEdges.push({ fromId: a.objectId, fromAnchor: a.anchor, toId: b.objectId, toAnchor: b.anchor })

    const objA = store().pages[pageId]?.objects?.[a.objectId]
    const objB = store().pages[pageId]?.objects?.[b.objectId]

    const resolveAnchor = (obj: SceneObject | undefined, anchor: string, fallbackX: number, fallbackY: number) => {
      if (!obj) return { x: fallbackX, y: fallbackY }
      const terminals = terminalsOf(obj)
      if (terminals.length === 0) return { x: obj.position.x + obj.size.w / 2, y: obj.position.y + obj.size.h / 2 }

      // `centre` is the one anchor that is a POINT rather than a terminal, so
      // it is answered here; every other name is a terminal index and goes
      // through the shared resolver.
      const normAnchor = anchor.replace(/^input/i, 'in').replace(/^output/i, 'out')
      if (normAnchor.toLowerCase() === 'centre') {
        return { x: obj.position.x + obj.size.w / 2, y: obj.position.y + obj.size.h / 2 }
      }
      return terminalWorld(obj, terminals[terminalIndexFor(obj, anchor)])
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
      z: nextZ(),
      behaviors: [{
        id: uid(),
        type: type as BehaviorType,   // <-- was hardcoded 'wire' as BehaviorType; now respects the caller's type
        enabled: true,
        params: {
          targetA: str(a.objectId), anchorA: str(a.anchor),
          targetB: str(b.objectId), anchorB: str(b.anchor),
        },
      }],
      parameters: {},
      metadata: { render: type },
    }
    store().addObject(pageId, line, { history: false })
    // A wire is part of the scene, so the layout pass must move it with the
    // scene. It used to be added straight to the store and never registered,
    // so applySceneLayout translated (and scaled) every create()d object and
    // left every connect()d line exactly where it was drawn — a constant
    // offset between the bodies and the rod holding them.
    //
    // Circuits hid this: the auto-layout re-router rewrites wire geometry from
    // terminal positions afterwards, so schematics healed themselves. Nothing
    // re-routes a mechanics link, so `connect(pivot.centre, bob.centre, "rod")`
    // came out as a rod floating clear of both bodies — attached to neither,
    // which is exactly what verify-scene then reported.
    created.push(id)
    return wrapProxy(new ScriptObject(id, pageId))
  }

  // ── addproperty() ─────────────────────────────────────────────────────────────
  // Attach any behavior to an existing object created with create().
  const addproperty = (obj: any, behaviorType: string, params: Record<string, any> = {}) => {
    const objId = obj?.id ?? obj?.objectId
    if (!objId) { console.warn('[SimScript] addproperty: invalid object', obj); return }
    const current = store().pages[pageId]?.objects?.[objId]
    if (!current) { console.warn('[SimScript] addproperty: object not found', objId); return }
    const b: any = { id: uid(), type: behaviorType as BehaviorType, enabled: true, params: {} }
    if (behaviorType === 'rigidBody') b.params.mass = num('1')
    // optional third argument: addproperty(shape, "rigidBody", { mass: 5 })
    for (const [k, v] of Object.entries(params)) {
      b.params[k] = typeof v === 'number' ? num(String(v)) : str(String(v))
    }
    store().updateObject(pageId, objId, { behaviors: [...current.behaviors, b] }, { history: false })
  }

  // ── graph object ─────────────────────────────────────────────────────────────
  // graph.plot(obj.property)                → plot vs time (default)
  // graph.plot(obj.vy, obj.vx)              → y vs x
  // graph.plot(obj.vy, 'bar')               → bar style vs time
  // graph.plot(obj.V, obj.I, 'scatter')     → scatter
  // graph.plot(formulaObj)                  → plot the card's maths
  // graph.plot(bodyObj)                     → plot its first live channel
  const PLOT_STYLES = new Set(['line', 'bar', 'scatter', 'area', 'step'])

  /** What a graph.plot() argument actually means.
   *
   *  A bare object used to fall through `yVar?.property` into the anchor
   *  proxy, which answers ANY property with a descriptor object — so the
   *  series came out as the literal string "[object Object]:[object Object]"
   *  and the graph plotted nothing. An object on its own is a legitimate
   *  thing to plot, so it's resolved here instead: a Formula card by its
   *  maths, anything else by the first channel it actually streams. */
  const plotTarget = (v: any): { expr: string } | { objectId: string; property: string } | null => {
    if (v == null) return null
    if (v instanceof ScriptObject) {
      const o = store().pages[pageId]?.objects?.[v.id]
      if (!o) return null
      if (o.geometry.kind === 'formula') {
        const latex = o.parameters.latex?.kind === 'string' ? o.parameters.latex.value : ''
        const parsed = latexToExpr(latex)
        if (!parsed) { console.warn('[SimScript] graph.plot: no expression in', latex); return null }
        return { expr: parsed.expr }
      }
      const channel = channelsFor(o)[0]
      if (!channel) { console.warn('[SimScript] graph.plot: nothing to plot on', o.name); return null }
      return { objectId: v.id, property: channel }
    }
    if (typeof v.objectId === 'string' && typeof v.property === 'string') return v
    console.warn('[SimScript] graph.plot: not a plottable value', v)
    return null
  }

  const graph = {
    plot: (yVar: any, xVarOrStyle?: any, styleArg: string = 'line') => {
      let xVar: any = null
      let style = styleArg
      let xChannelName = ''
      // A string second argument is the plot style — unless it isn't one, in
      // which case it names the x axis (`graph.plot(E, "x")` reads as "E
      // against x" to everyone who writes it, and used to silently become a
      // bogus plot style).
      if (typeof xVarOrStyle === 'string') {
        if (PLOT_STYLES.has(xVarOrStyle)) style = xVarOrStyle
        else xChannelName = xVarOrStyle
      } else if (xVarOrStyle != null) xVar = xVarOrStyle

      const y = plotTarget(yVar)
      if (!y) return
      const x = xVar ? plotTarget(xVar) : null
      if (x && 'objectId' in x) xChannelName = x.property

      let graphObj = Object.values(store().pages[pageId]?.objects ?? {}).find(o => o.geometry.kind === 'graph')

      // Sit the graph just right of whatever this script actually built,
      // not at a fixed +600. The scene's real width is only known now (the
      // system box is 460 wide in most corpus examples but 900 in others),
      // so a constant either buries the graph inside a wide scene or leaves
      // a gap of dead space beside a narrow one — and on a 960px slide,
      // 600 + 380 = 980 puts it off the frame entirely.
      const GRAPH_GAP = 24
      const sceneRight = Object.values(store().pages[pageId]?.objects ?? {})
        .filter((o) => created.includes(o.id) && o.geometry.kind !== 'graph')
        .reduce((mx, o) => Math.max(mx, o.position.x + o.size.w), origin.x)
      const graphX = Number.isFinite(sceneRight) ? sceneRight + GRAPH_GAP : origin.x + 600

      const newGraph: SceneObject = graphObj ? { ...graphObj } : {
        id: uid(), name: 'Graph', geometry: { kind: 'graph' },
        position: { x: graphX, y: origin.y },
        size: { w: 380, h: 260 }, rotation: 0, z: nextZ(),
        behaviors: [], parameters: {}, metadata: {},
      }

      const append = (key: string, value: string) => {
        const prev = newGraph.parameters[key]?.kind === 'string' ? (newGraph.parameters[key] as any).value : ''
        return prev.split(';').map((e: string) => e.trim()).includes(value)
          ? prev
          : prev ? `${prev}; ${value}` : value
      }

      newGraph.parameters = {
        ...newGraph.parameters,
        ...('expr' in y
          ? { formulas: str(append('formulas', y.expr)) }
          : { series: str(append('series', `${y.objectId}:${y.property}`)) }),
        ...(xChannelName ? { xChannel: str(xChannelName) } : {}),
        plot_style: str(style),
      }
      store().addObject(pageId, newGraph, { history: false })
    },
  }

  // ── ref(): address an object that already exists ──────────────────────────
  // SimScript was create-only — create() minted a fresh uid and nothing could
  // name an object already on the page. So "connect the new spring to the mass
  // that's already there" had no form, and every edit degenerated into
  // rebuilding the whole scene beside the old one.
  //
  // ref(id) returns the SAME ScriptObject handle create() returns, so every
  // existing verb — set(), connect(), addproperty(), anchors — works on live
  // objects unchanged. That single addition is what makes the language
  // editing-capable rather than append-only.
  const ref = (id: string) => {
    if (!store().pages[pageId]?.objects?.[id]) {
      throw new Error(`ref("${id}"): no such object on this page`)
    }
    // NOT added to `created`: the layout pass must never move an object the
    // user already placed.
    return wrapProxy(new ScriptObject(id, pageId))
  }

  // ── Sandbox ───────────────────────────────────────────────────────────────────
  const builtins: Record<string, any> = { create, connect, addproperty, graph, ref, console, Math }
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
  // The newlines around the body are load-bearing: on one line, a script
  // ending in a `// comment` swallows the closing brace and throws
  // "Unexpected token ')'". Comments are ordinary, valid SimScript (the AI
  // writes them constantly), so this must not depend on the last line.
  const fn = new Function('sandbox', `with(sandbox) {\n${transpiled}\n}`)
  fn(sandbox)

  // Re-stamp every mechanics endpoint now that positions are final, so a
  // connect()-then-move script still hands the solver a real attachment.
  for (const b of mechBindings) applyBinding(b.connId, b.index, b.bodyId)

  // ── Circuit auto-layout: force-directed placement + orthogonal routing ─────
  // See lib/scene/circuit-layout.ts. Replaces four hand-written per-topology
  // branches (series loop / parallel bank / one-transistor amp / digital chain)
  // that hardcoded coordinates for circuits someone had anticipated; anything
  // else fell through to a BFS-column pass that ignored pin orientation, so
  // wires routinely left a right-hand pin to reach a part placed below-left
  // and doubled back across their own body.
  const getObj = (id: string) => store().pages[pageId]?.objects?.[id]

  // Only edges between real SCHEMATIC parts get laid out. A mechanics link
  // (rod/spring/rope) is also recorded here, but its endpoints ARE the physics
  // attachment — buildWorld pairs bodies by what sits under them — so moving a
  // body or rewriting that line's geometry silently detaches the simulation.
  const schematicEdges = circuitEdges.filter(e => {
    const a = getObj(e.fromId), b = getObj(e.toId)
    return a?.geometry.kind === 'symbol' && b?.geometry.kind === 'symbol' &&
      terminalsOf(a).length > 0 && terminalsOf(b).length > 0
  })

  if (schematicEdges.length > 0) {
    const allIds = new Set<string>()
    for (const e of schematicEdges) { allIds.add(e.fromId); allIds.add(e.toId) }
    const layoutIds = [...allIds].filter(id => !explicitPos.has(id))

    if (layoutIds.length > 0) {
      const idxFor = (objId: string, anchor: string): number => {
        const obj = getObj(objId)
        return obj ? terminalIndexFor(obj, anchor) : 0
      }
      const edges: LayoutEdge[] = schematicEdges.map(e => ({
        fromId: e.fromId, toId: e.toId,
        fromIdx: idxFor(e.fromId, e.fromAnchor), toIdx: idxFor(e.toId, e.toAnchor),
      }))

      // Tier 1 — placement.
      const placement = placeOptimized(layoutIds, edges, getObj, origin)
      for (const [id, p] of placement) {
        const obj = getObj(id)
        if (!obj) continue
        store().updateObject(pageId, id,
          p.rotation !== obj.rotation
            ? { position: { x: p.x, y: p.y }, rotation: p.rotation }
            : { position: { x: p.x, y: p.y } },
          { history: false })
      }
    }

    // Tier 2 — orthogonal routing, over the FINAL positions (explicitly placed
    // parts included: they are obstacles even though layout never moved them).
    const excludeKinds = new Set(['line', 'table', 'graph', 'note', 'cashflow', 'truthtable'])
    const bodies = Object.values(store().pages[pageId]?.objects ?? {})
      .filter(o => !excludeKinds.has(o.geometry.kind))
    // TRUE body rectangles. The search grid is padded below so routes keep a
    // little air, but validation must use the real outline: a pin sits ON its
    // body's edge, so against a padded box every legitimate stub looks like a
    // wire entering a component and every clean candidate gets rejected.
    const boxOf = (o: SceneObject) => {
      const cx = o.position.x + o.size.w / 2, cy = o.position.y + o.size.h / 2
      const h = halfExtent(o, o.rotation ?? 0)
      return { x1: cx - h.x, y1: cy - h.y, x2: cx + h.x, y2: cy + h.y, id: o.id }
    }
    const boxes = bodies.map(boxOf)

    if (boxes.length > 0) {
      const MARGIN = 320
      const lo = { x: Math.min(...boxes.map(b => b.x1)) - MARGIN, y: Math.min(...boxes.map(b => b.y1)) - MARGIN }
      const hi = { x: Math.max(...boxes.map(b => b.x2)) + MARGIN, y: Math.max(...boxes.map(b => b.y2)) + MARGIN }
      const router = new OrthoRouter(boxes, { lo, hi })

      // Matching on the two object ids alone is ambiguous: two pins of the same
      // pair of parts (a voltmeter across a resistor) share it, so .find() kept
      // returning the FIRST wire — one got routed twice and the other was left
      // as the zero-length stub connect() drew it, i.e. electrically absent,
      // since the netlist unions by coincident world points. Match the anchors
      // too, and consume each wire once.
      // ── Net-aware ordering ────────────────────────────────────────────
      // Several connect()s can leave the SAME pin. Routed independently, each
      // takes its own long way round and the sheet turns into a tangle — one
      // full-adder input fanned out as a 112px wire and a 712px one that
      // looped around the whole drawing. A real schematic branches: the
      // second wire leaves the FIRST one at a junction dot.
      //
      // Route the shortest wire of each fan-out first, then let its siblings
      // start from the nearest point on what is already drawn. Sorting by
      // straight-line span is what makes "first" mean "the short one".
      const spanOf = (e: typeof schematicEdges[number]) => {
        const a = getObj(e.fromId), b = getObj(e.toId)
        if (!a || !b) return 0
        const ta = terminalsOf(a), tb = terminalsOf(b)
        const pa = terminalWorld(a, ta[Math.min(terminalIndexFor(a, e.fromAnchor), ta.length - 1)] ?? { x: 1, y: 0.5 })
        const pb = terminalWorld(b, tb[Math.min(terminalIndexFor(b, e.toAnchor), tb.length - 1)] ?? { x: 0, y: 0.5 })
        return Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y)
      }
      const ordered = [...schematicEdges].sort((p, q) => spanOf(p) - spanOf(q))

      // Points already carrying this net, keyed by source pin.
      const netPath = new Map<string, Pt[]>()
      const pinKey = (p: Pt) => `${Math.round(p.x)},${Math.round(p.y)}`

      const claimed = new Set<string>()
      for (const e of ordered) {
        const wireObj = Object.values(store().pages[pageId]?.objects ?? {}).find(o =>
          o.geometry.kind === 'line' && !claimed.has(o.id) &&
          o.behaviors.some(b =>
            b.params.targetA?.kind === 'string' && b.params.targetA.value === e.fromId &&
            b.params.targetB?.kind === 'string' && b.params.targetB.value === e.toId &&
            (b.params.anchorA?.kind !== 'string' || b.params.anchorA.value === e.fromAnchor) &&
            (b.params.anchorB?.kind !== 'string' || b.params.anchorB.value === e.toAnchor))
        )
        if (!wireObj) continue
        claimed.add(wireObj.id)
        const objA = getObj(e.fromId), objB = getObj(e.toId)
        if (!objA || !objB) continue

        // The SAME resolver connect() and the netlist use — the drawn wire IS
        // the electrical connection (lib/circuit/engine.ts unions by coincident
        // world points), so a second copy here could solve a different circuit.
        const termsA = terminalsOf(objA), termsB = terminalsOf(objB)
        const idxA = terminalIndexFor(objA, e.fromAnchor)
        const idxB = terminalIndexFor(objB, e.toAnchor)
        const tA = termsA[Math.min(Math.max(0, idxA), termsA.length - 1)] ?? { x: 1, y: 0.5 }
        const tB = termsB[Math.min(Math.max(0, idxB), termsB.length - 1)] ?? { x: 0, y: 0.5 }

        // No body is exempt — not even the two this wire terminates on. A wire
        // stops at the pin on the boundary; routeEdge opens only the stub cells.
        let path = routeEdge(router, objA, tA, objB, tB)

        // If this net is already on the sheet, tap the nearest point of it
        // instead of running a second long wire from the same pin. The tap
        // point is ON the existing polyline, so the netlist — which unions by
        // coincident world points — still sees one electrical node.
        const srcKey = pinKey(terminalWorld(objA, tA))
        const drawn = netPath.get(srcKey)
        if (drawn && drawn.length > 1) {
          const end = path[path.length - 1]
          let best: Pt | null = null
          let bestD = Infinity
          for (let i = 1; i < drawn.length; i++) {
            // Nearest point on this segment, clamped to it (segments are
            // orthogonal, so this is just a clamp on one axis).
            const a = drawn[i - 1], b = drawn[i]
            const vx = b.x - a.x, vy = b.y - a.y
            const L2 = vx * vx + vy * vy
            const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((end.x - a.x) * vx + (end.y - a.y) * vy) / L2))
            const q = { x: a.x + vx * t, y: a.y + vy * t }
            // A junction must sit in clear space. Tapping a point that lies
            // inside a component puts the dot under the symbol and forces the
            // branch to start from within a body.
            if (boxes.some(bx => q.x > bx.x1 && q.x < bx.x2 && q.y > bx.y1 && q.y < bx.y2)) continue
            const d = Math.abs(q.x - end.x) + Math.abs(q.y - end.y)
            if (d < bestD) { bestD = d; best = q }
          }
          if (best) {
            const tap = routeEdgeFrom(router, best, objB, tB)
            const tapLen = tap.slice(1).reduce((acc, p, i) => acc + Math.abs(p.x - tap[i].x) + Math.abs(p.y - tap[i].y), 0)
            const runLen = path.slice(1).reduce((acc, p, i) => acc + Math.abs(p.x - path[i].x) + Math.abs(p.y - path[i].y), 0)
            // Take the branch only when it is both shorter and clean: a tap
            // that has to cut through a body is worse than the long way round.
            if (tapLen < runLen && !hitsAnyBody(tap, boxes, tap[0], tap[tap.length - 1])) path = tap
          }
        }
        if (!netPath.has(srcKey)) netPath.set(srcKey, path)

        const minX = Math.min(...path.map(p => p.x)), minY = Math.min(...path.map(p => p.y))
        const maxX = Math.max(...path.map(p => p.x)), maxY = Math.max(...path.map(p => p.y))
        store().updateObject(pageId, wireObj.id, {
          position: { x: minX, y: minY },
          size: { w: Math.abs(maxX - minX) || 4, h: Math.abs(maxY - minY) || 4 },
          geometry: { ...wireObj.geometry, points: path.map(p => [p.x - minX, p.y - minY]) },
        }, { history: false })
      }
    }
  }

  // ── Unplaced cards stack, they don't pile up ──────────────────────────────
  // A card created without x/y lands at the origin — and so does the next one,
  // and the answer text already sitting there. Anything the script didn't
  // position explicitly is pushed clear of what's already on the page, in
  // creation order, so a script that writes two formulas gets two readable
  // formulas instead of one illegible overlap. Only cards move: a body or a
  // connector's position is physics, not layout.
  const CARD_KINDS = new Set(['formula', 'text', 'note', 'graph', 'chart', 'table', 'gridtable', 'surface3d', 'code', 'cashflow', 'truthtable'])
  const movable = created.filter((id) => {
    const o = store().pages[pageId]?.objects?.[id]
    return !!o && !explicitPos.has(id) && CARD_KINDS.has(o.geometry.kind)
  })
  if (movable.length > 0) {
    const movableSet = new Set(movable)
    const rectOf = (o: SceneObject) => ({ x1: o.position.x, y1: o.position.y, x2: o.position.x + o.size.w, y2: o.position.y + o.size.h })
    const GAP = 16
    const occupied = Object.values(store().pages[pageId]?.objects ?? {})
      .filter((o) => !movableSet.has(o.id))
      .map(rectOf)
    for (const id of movable) {
      const o = store().pages[pageId]?.objects?.[id]
      if (!o) continue
      let r = rectOf(o)
      // Each push can slide it into something else, so keep going until it
      // sits clear (bounded: every step moves strictly down past one box).
      for (let guard = 0; guard < occupied.length + 1; guard++) {
        const hit = occupied.find((b) => r.x2 > b.x1 && r.x1 < b.x2 && r.y2 > b.y1 && r.y1 < b.y2)
        if (!hit) break
        const dy = hit.y2 + GAP - r.y1
        r = { ...r, y1: r.y1 + dy, y2: r.y2 + dy }
      }
      if (r.y1 !== o.position.y) store().updateObject(pageId, id, { position: { x: o.position.x, y: r.y1 } }, { history: false })
      occupied.push(r)
    }
  }

  // ── Sync variables to page sidebar ────────────────────────────────────────────
  // A script's variable names are the only names these things have, so they
  // become the object's name on the canvas and the variable's name on the page.

  /** A Formula card as maths: its LaTeX, converted. */
  const cardExpr = (id: string) => {
    const o = store().pages[pageId]?.objects?.[id]
    if (o?.geometry.kind !== 'formula') return null
    return latexToExpr(o.parameters.latex?.kind === 'string' ? o.parameters.latex.value : '')
  }

  // Formula cards created by this script, with the name each would take.
  const cards = Object.entries(sandboxVars)
    .filter(([, v]) => v instanceof ScriptObject)
    .map(([scriptName, v]) => ({ scriptName, parsed: cardExpr((v as ScriptObject).id) }))
    .filter((c): c is { scriptName: string; parsed: NonNullable<ReturnType<typeof cardExpr>> } => !!c.parsed)
    .map((c) => ({ name: c.parsed.name ?? c.scriptName, expr: c.parsed.expr, defined: !!c.parsed.name }))

  const pending: { name: string; expr: string }[] = []

  // A card earns a page variable when it DEFINES something — either it says so
  // ("E = σ/ε") or another card's maths reads its name. Registering every card
  // would bury the Variables panel under the f0…fN of a written answer, which
  // nothing refers to; registering none leaves `u = ½ε₀|E|²` unable to find E.
  for (const c of cards) {
    if (c.defined || cards.some((o) => o !== c && new RegExp(`\\b${c.name}\\b`).test(o.expr)))
      pending.push({ name: c.name, expr: c.expr })
  }

  for (const [k, v] of Object.entries(sandboxVars)) {
    if (v instanceof ScriptObject || (v && typeof v === 'object' && 'objectId' in v && !('property' in v))) {
      // It's a component handle — sync its name
      const objId = v instanceof ScriptObject ? v.id : v.objectId
      if (objId) {
        const current = store().pages[pageId]?.objects?.[objId]
        const name = cardExpr(objId)?.name ?? k
        if (current && !current.metadata.nameExplicit && current.name !== name) {
          store().updateObject(pageId, objId, { name }, { history: false })
        }
      }
      continue
    }

    if (typeof v === 'number' || typeof v === 'string') {
      pending.push({ name: k, expr: String(v) })
    } else if (v && typeof v === 'object' && 'property' in v) {
      // Dynamic binding — e.g. vx = block.vx
      pending.push({ name: k, expr: `${v.objectId}.${v.property}` })
    }
  }

  // Through the store action, so the page scope is re-solved with them in it —
  // a variable nothing can see is a variable no formula can use.
  for (const v of pending) store().upsertVariable(pageId, v.name, v.expr)

  // ── Final placement, decided by geometry rather than by the model ─────────
  // Every coordinate above came from a language model that cannot see the
  // page: it does not know the board is scrolled to y=1600, that a note
  // already sits where it aimed, or that this is a 960x540 slide. So the
  // script's absolute positions are treated as a LAYOUT, not a location, and
  // the whole scene is translated (and scaled only if it cannot fit) as one
  // rigid group — preserving every endpoint binding physics depends on.
  // Placement is decided by the CALLER, which knows the page frame. Keeping
  // it out of here leaves this module free of the browser stores — the reason
  // it stays testable headlessly.
  applySceneLayout(pageId, created, layoutSurface)
}

/**
 * Translate a freshly created scene into the right place on the page.
 *
 * Separated from executeSimScript so it is testable without running a script,
 * and so the edit lane can reuse it. Pure decision (lib/scene/auto-layout.ts),
 * impure application: the geometry is decided by code, then written through
 * the same store actions a drag uses.
 */
export function applySceneLayout(
  pageId: string,
  createdIds: string[],
  /** The space to place into. Passed in rather than read from the browser
   *  stores so this module stays headless-testable and has no dependency on
   *  the workspace store. Omitted (no DOM, a caller that does not care) means
   *  no layout pass: the script's own coordinates stand. */
  surface?: { bounds: Bounds; fixedFrame: boolean }
): void {
  if (createdIds.length === 0) return
  const page = store().pages[pageId]
  if (!page) return

  const rectOf = (o: SceneObject) => ({ x: o.position.x, y: o.position.y, w: o.size.w, h: o.size.h })
  const madeSet = new Set(createdIds)
  const made = createdIds.map((id) => page.objects[id]).filter(Boolean)
  if (made.length === 0) return

  const occupied = Object.values(page.objects)
    .filter((o) => !madeSet.has(o.id))
    .map(rectOf)

  if (!surface) return

  const { dx, dy, scale } = planPlacement({
    scene: made.map(rectOf),
    occupied,
    bounds: surface.bounds,
    fixedFrame: surface.fixedFrame,
  })

  if (dx === 0 && dy === 0 && scale === 1) return

  // Scale about the scene's own top-left so relative geometry is preserved
  // exactly — a spring's endpoints move with the bodies they are bound to.
  const box = unionRect(made.map(rectOf))!
  for (const o of made) {
    const nx = box.x + (o.position.x - box.x) * scale + dx
    const ny = box.y + (o.position.y - box.y) * scale + dy
    const patch: Partial<SceneObject> = { position: { x: nx, y: ny } }
    if (scale !== 1) {
      patch.size = { w: o.size.w * scale, h: o.size.h * scale }
      // Line-ish geometry carries its shape in `points`, not in size alone.
      if (o.geometry.points) {
        patch.geometry = { ...o.geometry, points: o.geometry.points.map(([px, py]) => [px * scale, py * scale]) }
      }
    }
    store().updateObject(pageId, o.id, patch, { history: false })
  }
}
