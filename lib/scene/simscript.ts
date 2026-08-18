import { useDocStore } from '@/lib/store/document'
import { terminalsOf, terminalWorld } from '@/lib/circuit/engine'
import { uid, type SceneObject, type GeometryKind, type BehaviorType, num, str } from './types'
import { behaviorSpec } from '@/lib/behaviors/registry'
import { createGeometry } from './factory'
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
  origin: { x: number; y: number } = { x: 200, y: 100 }
) {

  // Track connections for post-run auto-layout
  const circuitEdges: { fromId: string; fromAnchor: string; toId: string; toAnchor: string }[] = []
  // IDs of objects the user explicitly positioned (had x/y in props → skip auto-layout)
  const explicitPos = new Set<string>()

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
        z: Date.now(),
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
        z: Date.now(),
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
        z: Date.now(),
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
        obj.z = 1
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
        z: Date.now(), behaviors: [],
        parameters: {},
        metadata: { nameExplicit: !!props.name },
      }
    }

    // Universal styling — applies to EVERY kind above, so a resistor, a text
    // block and a slider all take the same fill/stroke/opacity/lock props.
    applyStyleProps(obj, props)

    if (hasExplicitPos) explicitPos.add(id)
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
  const endpointIndex = (anchor: string) => (END0.has(String(anchor).toLowerCase()) ? 0 : 1)

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

  const applyBinding = (connId: string, index: 0 | 1, bodyId: string) => {
    const target = bodyPoint(bodyId)
    if (target) moveEndpoint(connId, index, target)
  }

  // Returns a truthy marker when it handled the pair as a mechanics link.
  const mechConnect = (a: any, b: any) => {
    const connA = connectorOf(a.objectId)
    const connB = connectorOf(b.objectId)
    // Connector-to-connector isn't a body attachment; leave it to the wire path.
    if (!connA === !connB) return undefined
    const conn = (connA ?? connB)!
    const bodySide = connA ? b : a
    const connSide = connA ? a : b
    const target = bodyPoint(bodySide.objectId)
    if (!target) return undefined
    const index = endpointIndex(connSide.anchor) as 0 | 1
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

      // 1. Look up in per-symbol anchor index — RAW name first, then the
      // 'input'→'in' / 'output'→'out' normalized form. (Raw-first matters:
      // normalizing 'input1'→'in1' used to miss symbols whose map only had
      // 'input1', landing the wire on the wrong terminal.)
      const normAnchor = anchor.replace(/^input/i, 'in').replace(/^output/i, 'out')

      const sym = obj.geometry.symbol ?? ''
      const symMap = ANCHOR_INDEX[sym] ?? {}
      const idx = symMap[anchor] ?? symMap[normAnchor] ?? ANCHOR_INDEX._t2[anchor] ?? ANCHOR_INDEX._t2[normAnchor] ?? -1

      // 2. Numeric fallback: 'pin0', 'pin1', ...
      let termIdx = idx
      if (termIdx < 0) {
        const numMatch = normAnchor.match(/^(?:pin|t|terminal)?(\d+)$/i)
        if (numMatch) termIdx = parseInt(numMatch[1])
      }
      // 3. Named fallback by position convention
      if (termIdx < 0) {
        if (normAnchor === 'centre') return { x: obj.position.x + obj.size.w / 2, y: obj.position.y + obj.size.h / 2 }
        // First terminal = 'in' / last terminal = 'out'
        termIdx = (normAnchor === 'in' || normAnchor === 'positive' || normAnchor === 'anode') ? 0 : terminals.length - 1
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
  const builtins: Record<string, any> = { create, connect, addproperty, graph, console, Math }
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

  // ── Smart circuit auto-layout ──────────────────────────────────────────────
  // Runs only when there are edges and at least some nodes without explicit positions.
  if (circuitEdges.length > 0) {
    const allIds = new Set<string>()
    for (const e of circuitEdges) { allIds.add(e.fromId); allIds.add(e.toId) }
    const layoutIds = [...allIds].filter(id => !explicitPos.has(id))

    if (layoutIds.length > 0) {
      const getObj = (id: string) => store().pages[pageId]?.objects?.[id]
      const getSym = (id: string) => getObj(id)?.geometry?.symbol ?? ''

      // ── Classify each node by its electrical role ──────────────────────────
      const SUPPLY_SYMS  = new Set(['battery','ac-source','current-source','vcvs','vccs','ccvs','cccs','three-phase-source'])
      const GND_SYMS     = new Set(['gnd'])
      const ACTIVE_SYMS  = new Set(['bjt','bjt-pnp','mosfet','mosfet-pmos','opamp'])
      const PASSIVE_SYMS = new Set(['resistor','capacitor','inductor','potentiometer','fuse','bulb'])

      const isSupply  = (id: string) => SUPPLY_SYMS.has(getSym(id))
      const isGnd     = (id: string) => GND_SYMS.has(getSym(id))
      const isActive  = (id: string) => ACTIVE_SYMS.has(getSym(id))
      const isPassive = (id: string) => PASSIVE_SYMS.has(getSym(id))

      // Build undirected neighbour map for topology analysis
      const nbrs = new Map<string, Set<string>>()
      for (const id of layoutIds) nbrs.set(id, new Set())
      for (const e of circuitEdges) {
        if (layoutIds.includes(e.fromId) && layoutIds.includes(e.toId)) {
          nbrs.get(e.fromId)?.add(e.toId)
          nbrs.get(e.toId)?.add(e.fromId)
        }
      }

      // ── Detect analog vs digital domain ───────────────────────────────────
      const hasActive  = layoutIds.some(isActive)
      const hasSupply  = layoutIds.some(isSupply)
      const hasGnd     = layoutIds.some(isGnd)
      const isAnalog   = hasActive || (hasSupply && hasGnd && layoutIds.some(isPassive))
      const hasDigital = layoutIds.some(id => {
        const s = getSym(id); return s === 'input' || s === 'clock' || s === 'output' ||
          s.endsWith('-gate') || s.includes('-ff') || s.includes('-latch') ||
          s.includes('adder') || s.includes('decoder') || s.includes('encoder')
      })

      const positions = new Map<string, { x: number; y: number }>()
      const rotations = new Map<string, number>()

      // ──────────────────────────────────────────────────────────────────────
      // TEXTBOOK LAYOUT for simple supply + passive circuits (no transistors,
      // no gates): a series loop becomes a clean rectangle — supply vertical
      // on the left, components across the top and back along the bottom —
      // and a parallel bank becomes vertical branches between two rails.
      // Voltmeters/probes float above what they measure; gnd hangs below.
      // ──────────────────────────────────────────────────────────────────────
      const PARALLEL_PROBES = new Set(['voltmeter', 'probe', 'logic-probe', 'wattmeter'])
      const probeIds = layoutIds.filter(id => PARALLEL_PROBES.has(getSym(id)))
      const coreIds = layoutIds.filter(id => !PARALLEL_PROBES.has(getSym(id)))
      const ringIds = coreIds.filter(id => !isGnd(id))
      const ringNbrs = new Map<string, Set<string>>()
      for (const id of ringIds) ringNbrs.set(id, new Set())
      for (const e of circuitEdges) {
        if (e.fromId !== e.toId && ringNbrs.has(e.fromId) && ringNbrs.has(e.toId)) {
          ringNbrs.get(e.fromId)!.add(e.toId)
          ringNbrs.get(e.toId)!.add(e.fromId)
        }
      }

      let textbookDone = false
      if (hasSupply && !hasActive && !hasDigital && ringIds.length >= 2) {
        const supplies = ringIds.filter(isSupply)
        const supplyId = supplies[0]
        const TOP_Y = origin.y + 40
        const BOT_Y = TOP_Y + 240
        const MID_Y = (TOP_Y + BOT_Y) / 2
        const GRID_X = 160
        const X0 = origin.x + 40

        const placeVertical = (id: string, xMid: number, yMid: number) => {
          const o = getObj(id)
          const w = o?.size?.w ?? 96
          const h = o?.size?.h ?? 48
          rotations.set(id, 90)
          positions.set(id, { x: xMid - w / 2, y: yMid - h / 2 })
        }
        const placeHorizontal = (id: string, xMid: number, yMid: number) => {
          const o = getObj(id)
          const w = o?.size?.w ?? 96
          const h = o?.size?.h ?? 48
          positions.set(id, { x: xMid - w / 2, y: yMid - h / 2 })
        }

        // (a) parallel bank — one supply, every other component hangs directly off it
        const isBank =
          supplies.length === 1 &&
          ringIds.length >= 3 &&
          ringIds.every(id => {
            if (id === supplyId) return true
            const nb = ringNbrs.get(id)!
            return nb.size >= 1 && [...nb].every(n => n === supplyId)
          })

        if (isBank) {
          placeVertical(supplyId, X0, MID_Y)
          let bx = X0 + GRID_X
          for (const id of ringIds) {
            if (id === supplyId) continue
            placeVertical(id, bx, MID_Y)
            bx += 130
          }
          textbookDone = true
        } else if (supplyId && ringIds.every(id => (ringNbrs.get(id)?.size ?? 0) <= 2)) {
          // (b) series loop/chain — walk the circuit starting at the supply
          const chain: string[] = [supplyId]
          const seen = new Set([supplyId])
          let cur = supplyId
          for (;;) {
            const nxt = [...(ringNbrs.get(cur) ?? [])].find(n => !seen.has(n))
            if (!nxt) break
            chain.push(nxt)
            seen.add(nxt)
            cur = nxt
          }
          if (chain.length === ringIds.length) {
            const rest = chain.slice(1)
            const topCount = Math.ceil(rest.length / 2)
            placeVertical(chain[0], X0, MID_Y)
            // clockwise: across the top row, then back right-to-left along the bottom
            for (let i = 0; i < topCount; i++) placeHorizontal(rest[i], X0 + GRID_X * (i + 1), TOP_Y)
            const rightX = X0 + GRID_X * Math.max(1, topCount)
            const bottom = rest.slice(topCount)
            for (let i = 0; i < bottom.length; i++) placeHorizontal(bottom[i], rightX - GRID_X * i, BOT_Y)
            textbookDone = true
          }
        }

        if (textbookDone) {
          // gnd symbols hang below their neighbour
          for (const gid of coreIds.filter(isGnd)) {
            const nbr = [...(nbrs.get(gid) ?? [])].find(n => positions.has(n))
            const gw = getObj(gid)?.size?.w ?? 96
            if (nbr) {
              const p = positions.get(nbr)!
              const nw = getObj(nbr)?.size?.w ?? 96
              positions.set(gid, { x: p.x + nw / 2 - gw / 2, y: BOT_Y + 70 })
            } else {
              positions.set(gid, { x: X0 - gw / 2, y: BOT_Y + 70 })
            }
          }
          // parallel probes float above whatever they measure
          let freeX = X0
          for (const pid of probeIds) {
            const pw = getObj(pid)?.size?.w ?? 96
            const nbr = [...(nbrs.get(pid) ?? [])].find(n => positions.has(n))
            if (nbr) {
              const p = positions.get(nbr)!
              const nw = getObj(nbr)?.size?.w ?? 96
              positions.set(pid, { x: p.x + nw / 2 - pw / 2, y: TOP_Y - 120 })
            } else {
              positions.set(pid, { x: freeX, y: TOP_Y - 120 })
              freeX += 130
            }
          }
        }
      }

      if (textbookDone) {
        // placed above — skip the transistor/digital layouts
      } else if (isAnalog && !hasDigital && layoutIds.filter(isActive).length === 1) {
        // ──────────────────────────────────────────────────────────────────────
        // NET-AWARE AMPLIFIER LAYOUT (exactly one transistor / op-amp)
        //
        // Terminals are grouped into electrical NETS (union-find over the
        // connect() edges). The active device names its nets — base/collector/
        // emitter (gate/drain/source, in−/out/in+) — the rails name theirs
        // (VCC/GND/signal), and every passive is then slotted where a textbook
        // draws it: load above the collector, emitter network below, bias
        // divider left of the base, coupling caps walking in from the signal
        // source, output coupling walking out to the right.
        // ──────────────────────────────────────────────────────────────────────
        const activeId = layoutIds.find(isActive)!
        const aObj = getObj(activeId)
        const aSym = getSym(activeId)

        // Terminal-index resolution — the same rules the wire re-router uses.
        const idxFor = (objId: string, anchor: string): number => {
          const obj = getObj(objId)
          const sym = obj?.geometry.symbol ?? ''
          const map = ANCHOR_INDEX[sym] ?? {}
          const norm = anchor.replace(/^input/i, 'in').replace(/^output/i, 'out')
          let idx = map[anchor] ?? map[norm] ?? ANCHOR_INDEX._t2[anchor] ?? ANCHOR_INDEX._t2[norm]
          if (idx === undefined) {
            const m = norm.match(/^(?:pin|t|terminal)?(\d+)$/i)
            if (m) idx = parseInt(m[1])
          }
          if (idx === undefined) {
            const count = obj ? terminalsOf(obj).length : 1
            idx = norm === 'in' || norm === 'positive' || norm === 'anode' ? 0 : Math.max(0, count - 1)
          }
          return idx
        }

        // Union-find nets over `${id}:${terminalIndex}` keys.
        const parent = new Map<string, string>()
        const find = (k: string): string => {
          let r = k
          while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!
          parent.set(k, r)
          return r
        }
        const union = (a: string, b: string) => {
          const ra = find(a)
          const rb = find(b)
          if (ra !== rb) parent.set(ra, rb)
        }
        for (const e of circuitEdges) {
          union(`${e.fromId}:${idxFor(e.fromId, e.fromAnchor)}`, `${e.toId}:${idxFor(e.toId, e.toAnchor)}`)
        }
        const net = (id: string, idx: number) => find(`${id}:${idx}`)

        const METERS = new Set(['voltmeter', 'wattmeter'])
        const PROBE1 = new Set(['probe', 'logic-probe'])

        // Which terminals sit on each net (meters excluded — they observe,
        // they must not break series-chain detection).
        const netTerms = new Map<string, { id: string; idx: number }[]>()
        for (const e of circuitEdges) {
          for (const t of [
            { id: e.fromId, idx: idxFor(e.fromId, e.fromAnchor) },
            { id: e.toId, idx: idxFor(e.toId, e.toAnchor) },
          ]) {
            if (METERS.has(getSym(t.id))) continue
            const r = net(t.id, t.idx)
            const l = netTerms.get(r) ?? []
            if (!l.some((x) => x.id === t.id && x.idx === t.idx)) l.push(t)
            netTerms.set(r, l)
          }
        }

        // Name the important nets.
        const isOpAmpDev = aSym === 'opamp'
        const baseIdx = isOpAmpDev ? 1 : 0 // in− for the op-amp
        const colIdx = isOpAmpDev ? 2 : 1 // out for the op-amp
        const emiIdx = isOpAmpDev ? 0 : 2 // in+ for the op-amp
        const label = new Map<string, string>()
        const setLabel = (n: string, l: string) => {
          if (!label.has(n)) label.set(n, l)
        }
        setLabel(net(activeId, baseIdx), 'base')
        setLabel(net(activeId, colIdx), 'col')
        setLabel(net(activeId, emiIdx), 'emi')
        for (const id of layoutIds) if (isGnd(id)) setLabel(net(id, 0), 'gnd')
        const batteries = layoutIds.filter((id) => getSym(id) === 'battery')
        for (const b of batteries) {
          setLabel(net(b, 0), 'vcc')
          setLabel(net(b, 1), 'gnd')
        }
        const sigSources = layoutIds.filter((id) => isSupply(id) && getSym(id) !== 'battery')
        for (const s of sigSources) setLabel(net(s, 0), 'sig')

        // No explicit battery? The rail is the unlabeled net that the most
        // RESISTORS share (R1 and the collector load both tie to VCC).
        if (![...label.values()].includes('vcc')) {
          const counts = new Map<string, number>()
          for (const id of layoutIds) {
            if (getSym(id) !== 'resistor') continue
            for (const idx of [0, 1]) {
              const r = net(id, idx)
              if (!label.has(r)) counts.set(r, (counts.get(r) ?? 0) + 1)
            }
          }
          let best: string | null = null
          for (const [r, cnt] of counts) if (cnt >= 2 && (!best || cnt > (counts.get(best) ?? 0))) best = r
          if (best) label.set(best, 'vcc')
        }

        // Classify every 2-terminal passive (or the series chain it starts)
        // by the pair of named nets it bridges.
        type SlotName = 'rc' | 're' | 'r1' | 'r2' | 'cin' | 'out' | 'fb' | 'rail' | 'misc'
        const slots = new Map<SlotName, string[][]>()
        const addChain = (s: SlotName, chain: string[]) => {
          const l = slots.get(s) ?? []
          l.push(chain)
          slots.set(s, l)
        }
        const chained = new Set<string>()
        const isPassive2 = (id: string) => {
          const o = getObj(id)
          return (
            !!o &&
            o.geometry.kind === 'symbol' &&
            terminalsOf(o).length === 2 &&
            !isSupply(id) &&
            !isGnd(id) &&
            !METERS.has(getSym(id)) &&
            !PROBE1.has(getSym(id)) &&
            id !== activeId
          )
        }
        const slotFor = (a: string | undefined, b: string | undefined): SlotName | null => {
          const pair = new Set([a, b])
          const has = (x: string) => pair.has(x)
          if (has('col') && has('vcc')) return 'rc'
          if (has('emi') && has('gnd')) return 're'
          if (has('base') && has('vcc')) return 'r1'
          if (has('base') && has('gnd')) return 'r2'
          if (has('base') && has('col')) return 'fb'
          if (has('base')) return 'cin'
          if (has('col')) return 'out'
          if (has('vcc') && has('gnd')) return 'rail'
          if (has('emi')) return 're'
          return null
        }

        for (const id of layoutIds) {
          if (!isPassive2(id) || chained.has(id)) continue
          let la = label.get(net(id, 0))
          let lb = label.get(net(id, 1))
          const chain = [id]
          if ((la === undefined) !== (lb === undefined)) {
            // Walk the series chain from the unnamed side until a named net.
            let curId = id
            let curNet = la === undefined ? net(id, 0) : net(id, 1)
            for (let guard = 0; guard < 8; guard++) {
              const others = (netTerms.get(curNet) ?? []).filter((t) => t.id !== curId)
              if (others.length !== 1) break
              const nxt = others[0]
              if (!isPassive2(nxt.id) || chained.has(nxt.id) || chain.includes(nxt.id)) break
              chain.push(nxt.id)
              curId = nxt.id
              curNet = net(nxt.id, nxt.idx === 0 ? 1 : 0)
              const l = label.get(curNet)
              if (l !== undefined) {
                if (la === undefined) la = l
                else lb = l
                break
              }
            }
          }
          for (const cid of chain) chained.add(cid)
          addChain(slotFor(la, lb) ?? 'misc', chain)
        }

        // ── Placement ────────────────────────────────────────────────────────
        const QX = origin.x + 560
        const QY = origin.y + 300
        const aW = aObj?.size?.w ?? 96
        const aH = aObj?.size?.h ?? 72
        positions.set(activeId, { x: QX, y: QY })
        const colX = QX + aW * 0.72 // collector/emitter pin column
        const baseY = QY + aH / 2 // base pin height
        const RAIL_TOP = QY - 250
        const RAIL_BOT = QY + 260
        const STEP = 120

        const putV = (id: string, cx: number, cy: number) => {
          const o = getObj(id)
          rotations.set(id, 90)
          positions.set(id, { x: cx - (o?.size?.w ?? 96) / 2, y: cy - (o?.size?.h ?? 48) / 2 })
        }
        const putH = (id: string, cx: number, cy: number) => {
          const o = getObj(id)
          positions.set(id, { x: cx - (o?.size?.w ?? 96) / 2, y: cy - (o?.size?.h ?? 48) / 2 })
        }

        // collector load(s): stacked upward toward the VCC rail
        for (const [ci, chain] of (slots.get('rc') ?? []).entries())
          chain.forEach((id, i) => putV(id, colX + ci * 130, QY - 90 - i * STEP))
        // emitter network: stacked downward; parallel chains side by side (Re ∥ Ce)
        for (const [ci, chain] of (slots.get('re') ?? []).entries())
          chain.forEach((id, i) => putV(id, colX + ci * 130, QY + aH + 60 + i * STEP))
        // bias divider column, left of the base
        const biasX = QX - 130
        for (const [ci, chain] of (slots.get('r1') ?? []).entries())
          chain.forEach((id, i) => putV(id, biasX - ci * 120, QY - 90 - i * STEP))
        for (const [ci, chain] of (slots.get('r2') ?? []).entries())
          chain.forEach((id, i) => putV(id, biasX - ci * 120, QY + aH + 60 + i * STEP))
        // input coupling, walking left from the base toward the signal source
        for (const [ci, chain] of (slots.get('cin') ?? []).entries())
          chain.forEach((id, i) => putH(id, QX - 260 - i * 140, baseY + ci * 90))
        // output coupling, walking right from the collector
        const outY = QY - 40
        let outEndX = colX + 120
        for (const chain of slots.get('out') ?? [])
          chain.forEach((id, i) => {
            const cx = colX + 190 + i * 140
            putH(id, cx, outY)
            outEndX = Math.max(outEndX, cx + 90)
          })
        // feedback (base↔collector): horizontal, above the device
        for (const [ci, chain] of (slots.get('fb') ?? []).entries())
          chain.forEach((id, i) => putH(id, QX - 30 + i * 140, QY - 180 - ci * 90))
        // rail-to-rail parts (decoupling), then the supply, at the far left
        for (const [ci, chain] of (slots.get('rail') ?? []).entries())
          chain.forEach((id, i) =>
            putV(id, origin.x + 320 - ci * 110, (RAIL_TOP + RAIL_BOT) / 2 + (i - (chain.length - 1) / 2) * STEP)
          )
        for (const [bi, b] of batteries.entries()) putV(b, origin.x + 50 + bi * 110, (RAIL_TOP + RAIL_BOT) / 2)
        for (const [si, s] of sigSources.entries()) putV(s, origin.x + 170, baseY + 40 + si * 130)
        // anything unclassified parks in a column right of the output
        let miscY = QY - 140
        for (const chain of slots.get('misc') ?? [])
          for (const id of chain) {
            putV(id, outEndX + 140, miscY)
            miscY += 140
          }
        // meters and single-pin probes float near the output
        let probeX = outEndX + 40
        for (const id of layoutIds) {
          if (positions.has(id) || isGnd(id)) continue
          const sym = getSym(id)
          if (METERS.has(sym) || PROBE1.has(sym) || sym === 'ammeter') {
            positions.set(id, { x: probeX, y: outY - 140 })
            probeX += 130
          }
        }
        // gnd symbols hang under whatever they're wired to
        for (const id of layoutIds) {
          if (!isGnd(id) || positions.has(id)) continue
          const peers = (netTerms.get(net(id, 0)) ?? []).filter((t) => t.id !== id && positions.has(t.id))
          const px = peers.length > 0 ? Math.max(...peers.map((t) => positions.get(t.id)!.x)) : QX
          positions.set(id, { x: px + 20, y: RAIL_BOT + 40 })
        }
        // absolute fallback — never leave anything unplaced
        let fx = origin.x
        for (const id of layoutIds) {
          if (positions.has(id)) continue
          positions.set(id, { x: fx, y: RAIL_BOT + 130 })
          fx += 140
        }
      } else {
        // ── Digital / Generic Layout ──────────────────────────────────────────
        const adj = new Map<string, string[]>()
        for (const id of layoutIds) adj.set(id, [])
        for (const e of circuitEdges) if (!explicitPos.has(e.fromId) && !explicitPos.has(e.toId)) adj.get(e.fromId)?.push(e.toId)

        const inDegree = new Map<string, number>()
        for (const id of layoutIds) inDegree.set(id, 0)
        for (const e of circuitEdges) if (!explicitPos.has(e.toId)) inDegree.set(e.toId, (inDegree.get(e.toId) ?? 0) + 1)
        const sources = layoutIds.filter(id => (inDegree.get(id) ?? 0) === 0)

        const col = new Map<string, number>()
        const visited = new Set<string>()
        for (const start of (sources.length > 0 ? sources : [layoutIds[0]])) {
          if (visited.has(start)) continue
          visited.add(start); col.set(start, 0)
          const queue = [{ id: start, c: 0 }]
          while (queue.length) {
            const { id, c } = queue.shift()!
            for (const nbr of (adj.get(id) ?? [])) {
              if (!visited.has(nbr)) { visited.add(nbr); col.set(nbr, c + 1); queue.push({ id: nbr, c: c + 1 }) }
              else col.set(nbr, Math.max(col.get(nbr)!, c + 1))
            }
          }
        }
        for (const start of layoutIds) {
          if (visited.has(start)) continue
          visited.add(start); col.set(start, 0)
          const queue = [{ id: start, c: 0 }]
          while (queue.length) {
            const { id, c } = queue.shift()!
            for (const e of circuitEdges) {
              const nbr = e.fromId === id ? e.toId : e.toId === id ? e.fromId : null
              if (nbr && !visited.has(nbr) && layoutIds.includes(nbr)) { visited.add(nbr); col.set(nbr, c + 1); queue.push({ id: nbr, c: c + 1 }) }
            }
          }
        }

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
          cx += Math.max(...ids.map(id => getObj(id)?.size.w ?? 96), 96) + GAP_X
        }

        for (const [c, ids] of colGroups) {
          let cy = origin.y
          for (const id of ids) { positions.set(id, { x: colX.get(c) ?? origin.x, y: cy }); cy += (getObj(id)?.size.h ?? 48) + GAP_Y }
        }
      }

      for (const [id, pos] of positions) {
        const rot = rotations.get(id) ?? 0
        const obj = getObj(id)
        if (!obj) continue
        if (rot !== 0 && rot !== obj.rotation) store().updateObject(pageId, id, { position: pos, rotation: rot }, { history: false })
        else store().updateObject(pageId, id, { position: pos }, { history: false })
      }

      const excludeKinds = new Set(['line', 'table', 'graph', 'note', 'cashflow', 'truthtable'])
      const boundsList = Object.values(store().pages[pageId]?.objects ?? {})
        .filter(o => !excludeKinds.has(o.geometry.kind))
        .map(o => {
          const cx2 = o.position.x + o.size.w / 2, cy2 = o.position.y + o.size.h / 2
          const hw = (o.rotation === 90 || o.rotation === 270) ? o.size.h / 2 : o.size.w / 2
          const hh = (o.rotation === 90 || o.rotation === 270) ? o.size.w / 2 : o.size.h / 2
          const PAD = 12
          return { x1: cx2 - hw - PAD, y1: cy2 - hh - PAD, x2: cx2 + hw + PAD, y2: cy2 + hh + PAD, id: o.id }
        })

      for (const e of circuitEdges) {
        const wireObj = Object.values(store().pages[pageId]?.objects ?? {}).find(o =>
          o.geometry.kind === 'line' &&
          o.behaviors.some(b => b.params.targetA?.kind === 'string' && b.params.targetA.value === e.fromId && b.params.targetB?.kind === 'string' && b.params.targetB.value === e.toId)
        )
        if (!wireObj) continue
        const objA = store().pages[pageId]?.objects?.[e.fromId], objB = store().pages[pageId]?.objects?.[e.toId]
        if (!objA || !objB) continue
        const terminalsA = terminalsOf(objA), terminalsB = terminalsOf(objB)
        const symA = objA.geometry.symbol ?? '', symB = objB.geometry.symbol ?? ''
        const mapA = ANCHOR_INDEX[symA] ?? {}, mapB = ANCHOR_INDEX[symB] ?? {}
        const normA = e.fromAnchor.replace(/^input/i,'in').replace(/^output/i,'out')
        const normB = e.toAnchor.replace(/^input/i,'in').replace(/^output/i,'out')
        const idxA = mapA[normA] ?? mapA[e.fromAnchor] ?? ANCHOR_INDEX._t2[normA] ?? (terminalsA.length - 1)
        const idxB = mapB[normB] ?? mapB[e.toAnchor]   ?? ANCHOR_INDEX._t2[normB] ?? 0
        const tA = terminalsA[Math.min(Math.max(0, idxA), terminalsA.length - 1)] ?? { x: 1, y: 0.5 }
        const tB = terminalsB[Math.min(Math.max(0, idxB), terminalsB.length - 1)] ?? { x: 0, y: 0.5 }

        const wA = terminalWorld(objA, tA)
        const wB = terminalWorld(objB, tB)

        const pinDir = (t: { x: number; y: number }) => {
          if (t.x <= 0.05) return { dx: -1, dy: 0 }
          if (t.x >= 0.95) return { dx:  1, dy: 0 }
          if (t.y <= 0.05) return { dx:  0, dy: -1 }
          if (t.y >= 0.95) return { dx:  0, dy:  1 }
          return { dx: 1, dy: 0 }
        }
        const dA = pinDir(tA), dB = pinDir(tB)
        const routePad = 18
        const p1 = { x: wA.x + dA.dx * routePad, y: wA.y + dA.dy * routePad }
        const p2 = { x: wB.x + dB.dx * routePad, y: wB.y + dB.dy * routePad }

        const segHitsBox = (a: {x:number,y:number}, b: {x:number,y:number}) => {
          const x1 = Math.min(a.x, b.x) - 2, x2 = Math.max(a.x, b.x) + 2
          const y1 = Math.min(a.y, b.y) - 2, y2 = Math.max(a.y, b.y) + 2
          return boundsList.some(box =>
            x2 > box.x1 && x1 < box.x2 && y2 > box.y1 && y1 < box.y2 &&
            box.id !== e.fromId && box.id !== e.toId
          )
        }

        const midX = (p1.x + p2.x) / 2
        const midY = (p1.y + p2.y) / 2

        const tryHVH = (mx: number) => {
          const m1 = { x: mx, y: p1.y }, m2 = { x: mx, y: p2.y }
          if (!segHitsBox(p1, m1) && !segHitsBox(m1, m2) && !segHitsBox(m2, p2)) return [wA, p1, m1, m2, p2, wB]
          return null
        }
        const tryVHV = (my: number) => {
          const m1 = { x: p1.x, y: my }, m2 = { x: p2.x, y: my }
          if (!segHitsBox(p1, m1) && !segHitsBox(m1, m2) && !segHitsBox(m2, p2)) return [wA, p1, m1, m2, p2, wB]
          return null
        }

        let path = tryHVH(midX) || tryVHV(midY)
        if (!path) {
          for (let offset = 20; offset <= 800; offset += 20) {
            path = tryHVH(midX + offset) || tryHVH(midX - offset) || tryVHV(midY + offset) || tryVHV(midY - offset)
            if (path) break
          }
        }
        if (!path) path = [wA, p1, { x: p1.x, y: p2.y }, p2, wB]

        path = path.filter((pt, i, arr) => i === 0 || Math.abs(pt.x - arr[i-1].x) > 0.5 || Math.abs(pt.y - arr[i-1].y) > 0.5)

        const minPathX = Math.min(...path.map(p => p.x))
        const minPathY = Math.min(...path.map(p => p.y))
        const maxPathX = Math.max(...path.map(p => p.x))
        const maxPathY = Math.max(...path.map(p => p.y))

        store().updateObject(pageId, wireObj.id, {
          position: { x: minPathX, y: minPathY },
          size: { w: Math.abs(maxPathX - minPathX) || 4, h: Math.abs(maxPathY - minPathY) || 4 },
          geometry: {
            ...wireObj.geometry,
            points: path.map(p => [p.x - minPathX, p.y - minPathY]),
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
