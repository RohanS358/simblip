// Factories: bare geometry primitives and the component palette.
// A palette component is nothing special — it is geometry + pre-attached
// behaviors. The user can build the identical thing by drawing and
// converting; the palette only saves clicks (docs/architecture.md).

import type { SceneObject, GeometryKind, Vec2, Behavior } from './types'
import { num, str, uid } from './types'
import { createBehavior } from '@/lib/behaviors/registry'
import type { Recognition } from '@/lib/sketch/recognize'
import { EMPTY_SPEC } from '@/lib/econ/engine'
import { DEFAULT_DSA_SOURCE } from '@/lib/dsa/samples'

let nameCounter = 0
const autoName = (base: string) => `${base} ${(++nameCounter % 1000)}`

export function baseObject(kind: GeometryKind, position: Vec2, name?: string): SceneObject {
  return {
    id: uid(),
    name: name ?? autoName(kind.charAt(0).toUpperCase() + kind.slice(1)),
    geometry: { kind },
    position,
    size: { w: 160, h: 120 },
    rotation: 0,
    z: Date.now() % 1_000_000,
    behaviors: [],
    parameters: {},
    metadata: {},
  }
}

export function createGeometry(kind: GeometryKind, position: Vec2): SceneObject {
  const obj = baseObject(kind, position)
  switch (kind) {
    case 'circle':
      obj.size = { w: 90, h: 90 }
      break
    case 'line':
      obj.geometry.points = [
        [0, 0],
        [160, 0],
      ]
      obj.size = { w: 160, h: 2 }
      break
    case 'note':
      obj.size = { w: 220, h: 200 }
      obj.parameters.text = str('')
      obj.metadata.color = ['amber', 'mint', 'blue', 'violet', 'rose'][Math.floor(Math.random() * 5)]
      break
    case 'text':
      obj.size = { w: 320, h: 48 }
      obj.parameters.text = str('')
      break
    case 'formula':
      obj.size = { w: 300, h: 96 }
      obj.parameters.latex = str('F = m \\cdot g')
      break
    case 'graph':
      obj.size = { w: 380, h: 260 }
      obj.parameters.sourceId = str('')
      obj.parameters.yChannels = str('')
      break
    case 'table':
      obj.size = { w: 380, h: 260 }
      obj.parameters.data = str('')
      break
    case 'cashflow':
      obj.size = { w: 480, h: 300 }
      obj.parameters.spec = str(JSON.stringify(EMPTY_SPEC))
      break
    case 'truthtable':
      obj.size = { w: 320, h: 260 }
      obj.parameters.inputs = str('')
      obj.parameters.outputs = str('')
      break
    case 'dsa':
      obj.name = autoName('DSA Lab')
      obj.size = { w: 980, h: 620 }
      obj.parameters.source = str(DEFAULT_DSA_SOURCE)
      break
  }
  return obj
}

/** Turn a recognized sketch into a scene object. Geometry only — no behavior
 *  is ever attached here; meaning comes from the Inspector or the palette. */
export function fromRecognition(rec: Recognition): SceneObject {
  const kindMap: Record<Recognition['kind'], GeometryKind> = {
    circle: 'circle',
    rect: 'rect',
    line: 'line',
    polygon: 'polygon',
    stroke: 'stroke',
  }
  const obj = baseObject(kindMap[rec.kind], { x: rec.x, y: rec.y })
  obj.name = autoName(obj.geometry.kind.charAt(0).toUpperCase() + obj.geometry.kind.slice(1))
  obj.size = { w: rec.w, h: rec.h }
  if (rec.points.length > 0) obj.geometry.points = rec.points
  return obj
}

// ── Component palette ───────────────────────────────────────────────────────

export interface ComponentDef {
  id: string
  label: string
  domain: 'mechanics' | 'electrical' | 'electronics' | 'digital' | 'optics' | 'waves' | 'quantum' | 'economics' | 'dsa'
  /** live = participates in the current engine; symbols await their solver */
  live: boolean
  create: (position: Vec2) => SceneObject
}

function withBehaviors(obj: SceneObject, ...behaviors: Behavior[]): SceneObject {
  obj.behaviors.push(...behaviors)
  return obj
}

// Components that pack many pins onto one edge need a taller box than the
// 48px default — otherwise pin-to-pin spacing falls under the wire snap
// radius (lib/circuit/engine.ts SNAP) and a wire meant for one pin can
// accidentally bond to its neighbor. Height only; width stays 96.
const TALL_SYMBOLS: Record<string, number> = {
  'seven-seg': 150, // 7 pins at 1/8 spacing → 18.75px gaps, clear of SNAP=14
  'bcd-7seg': 150, // same 7-pin edge
  register4: 100, // widest mode packs 4 pins at 1/5 spacing → 20px gaps
  counter4: 90, // 4 fixed output pins at 1/5 spacing
  // encoder/demux default narrow (4:2 / 1:2) at creation — widening to 8:3
  // or 1:4 via the Model dropdown resizes automatically (recommendedHeight).
}

function symbol(domain: ComponentDef['domain'], name: string, label: string, position: Vec2, params: Record<string, string> = {}): SceneObject {
  const obj = baseObject('symbol', position, autoName(label))
  obj.geometry.symbol = name
  obj.geometry.domain = domain
  obj.size = { w: 96, h: TALL_SYMBOLS[name] ?? 48 }
  for (const [k, v] of Object.entries(params)) obj.parameters[k] = num(v)
  obj.behaviors.push(createBehavior('electricalNode'))
  return obj
}

const econ = (id: string, label: string, create: ComponentDef['create']): ComponentDef => ({
  id, label, domain: 'economics', live: true, create,
})

const mech = (id: string, label: string, create: ComponentDef['create']): ComponentDef => ({
  id, label, domain: 'mechanics', live: true, create,
})

const optic = (id: string, label: string, create: ComponentDef['create']): ComponentDef => ({
  id, label, domain: 'optics', live: true, create,
})

const wave = (id: string, label: string, create: ComponentDef['create']): ComponentDef => ({
  id, label, domain: 'waves', live: true, create,
})

const quantum = (id: string, label: string, create: ComponentDef['create']): ComponentDef => ({
  id, label, domain: 'quantum', live: true, create,
})

// ── System boundaries ───────────────────────────────────────────────────────
// A dashed region that declares its domain. Doodles drawn inside it are
// recognized as that domain's components (canvas.tsx), so tablet users can
// sketch a whole circuit without touching the palette.

const SYSTEM_LABELS: Record<ComponentDef['domain'], string> = {
  mechanics: 'Mechanics',
  electrical: 'Electrical',
  electronics: 'Electronics',
  digital: 'Digital',
  optics: 'Optics',
  waves: 'Waves',
  quantum: 'Quantum',
  economics: 'Economics',
  dsa: 'DSA',
}

export function createSystem(domain: ComponentDef['domain'], position: Vec2): SceneObject {
  const obj = baseObject('rect', position, autoName(`${SYSTEM_LABELS[domain]} System`))
  obj.size = { w: 460, h: 320 }
  obj.metadata.render = 'system'
  obj.metadata.domain = domain
  obj.z = 1 // always beneath its contents (their z is a timestamp)
  return obj
}

const systemDef = (domain: ComponentDef['domain']): ComponentDef => ({
  id: `system-${domain}`,
  label: 'System',
  domain,
  live: true,
  create: (p) => createSystem(domain, p),
})

export const COMPONENTS: ComponentDef[] = [
  systemDef('mechanics'),
  systemDef('electrical'),
  systemDef('electronics'),
  systemDef('digital'),
  systemDef('waves'),
  systemDef('quantum'),
  // ── Mechanics: geometry + behaviors, fully live ──
  mech('mass', 'Mass', (p) => {
    const o = baseObject('circle', p, autoName('Mass'))
    o.size = { w: 70, h: 70 }
    return withBehaviors(o, createBehavior('rigidBody'))
  }),
  mech('block', 'Block', (p) => {
    const o = baseObject('rect', p, autoName('Block'))
    o.size = { w: 110, h: 80 }
    return withBehaviors(o, createBehavior('rigidBody'))
  }),
  mech('beam', 'Beam', (p) => {
    const o = baseObject('rect', p, autoName('Beam'))
    o.size = { w: 260, h: 16 }
    return withBehaviors(o, createBehavior('rigidBody'))
  }),
  mech('wheel', 'Wheel', (p) => {
    const o = baseObject('circle', p, autoName('Wheel'))
    o.size = { w: 100, h: 100 }
    const rb = createBehavior('rigidBody')
    rb.params.friction = num('0.9')
    return withBehaviors(o, rb)
  }),
  mech('reference-point', 'Reference Point', (p) => {
    const o = baseObject('circle', p, autoName('Ref Point'))
    o.size = { w: 20, h: 20 }
    o.metadata.render = 'reference-point'
    const rb = createBehavior('rigidBody')
    rb.params.mass = num('0.001') // massless observer — never perturbs the host
    rb.params.showTrail = num('1') // the point of the thing is to see where it goes
    return withBehaviors(o, rb)
  }),
  mech('ground', 'Ground', (p) => {
    const o = baseObject('rect', p, autoName('Ground'))
    o.size = { w: 480, h: 26 }
    o.metadata.render = 'ground'
    return withBehaviors(o, createBehavior('staticBody'))
  }),
  mech('spring', 'Spring', (p) => {
    const o = baseObject('line', p, autoName('Spring'))
    o.geometry.points = [[0, 0], [150, 0]]
    o.size = { w: 150, h: 2 }
    o.metadata.render = 'spring'
    return withBehaviors(o, createBehavior('spring'))
  }),
  mech('rope', 'Rope', (p) => {
    const o = baseObject('line', p, autoName('Rope'))
    o.geometry.points = [[0, 0], [150, 0]]
    o.size = { w: 150, h: 2 }
    o.metadata.render = 'rope'
    return withBehaviors(o, createBehavior('rope'))
  }),
  mech('rod', 'Rod', (p) => {
    const o = baseObject('line', p, autoName('Rod'))
    o.geometry.points = [[0, 0], [150, 0]]
    o.size = { w: 150, h: 2 }
    return withBehaviors(o, createBehavior('rod'))
  }),
  mech('damper', 'Damper', (p) => {
    const o = baseObject('line', p, autoName('Damper'))
    o.geometry.points = [[0, 0], [120, 0]]
    o.size = { w: 120, h: 2 }
    o.metadata.render = 'damper'
    return withBehaviors(o, createBehavior('damper'))
  }),
  mech('hinge', 'Hinge', (p) => {
    const o = baseObject('circle', p, autoName('Hinge'))
    o.size = { w: 22, h: 22 }
    o.metadata.render = 'hinge'
    return withBehaviors(o, createBehavior('hinge'))
  }),
  mech('motor', 'Motor', (p) => {
    const o = baseObject('circle', p, autoName('Motor'))
    o.size = { w: 80, h: 80 }
    o.metadata.render = 'motor'
    return withBehaviors(o, createBehavior('rigidBody'), createBehavior('motor'))
  }),
  mech('charge', 'Charged Ball', (p) => {
    const o = baseObject('circle', p, autoName('Charge'))
    o.size = { w: 46, h: 46 }
    o.metadata.render = 'charge'
    return withBehaviors(o, createBehavior('rigidBody'), createBehavior('charge'))
  }),
  mech('efield', 'E-Field Region', (p) => {
    const o = baseObject('rect', p, autoName('E-Field'))
    o.size = { w: 260, h: 180 }
    o.metadata.render = 'field'
    o.metadata.fieldKind = 'e'
    return withBehaviors(o, createBehavior('efield'))
  }),
  mech('bfield', 'B-Field Region', (p) => {
    const o = baseObject('rect', p, autoName('B-Field'))
    o.size = { w: 260, h: 180 }
    o.metadata.render = 'field'
    o.metadata.fieldKind = 'b'
    return withBehaviors(o, createBehavior('bfield'))
  }),
  mech('torsion-pendulum', 'Torsion Pendulum', (p) => {
    const o = baseObject('circle', p, autoName('Torsion Hinge'))
    o.size = { w: 22, h: 22 }
    o.metadata.render = 'hinge'
    return withBehaviors(o, createBehavior('hinge'), createBehavior('torsionSpring'))
  }),
  mech('heat-block', 'Heat Source', (p) => {
    const o = baseObject('rect', p, autoName('Heat Block'))
    o.size = { w: 100, h: 100 }
    return withBehaviors(o, createBehavior('staticBody'), createBehavior('heatSource'))
  }),

  // ── Optics: a ray tracer, not a body/behavior solver — geometry.tsx reads
  // the whole page and re-traces reactively (lib/optics/engine.ts). ──
  optic('light-source', 'Light Source', (p) => {
    const o = baseObject('circle', p, autoName('Light Source'))
    o.size = { w: 24, h: 24 }
    o.metadata.render = 'light-source'
    return withBehaviors(o, createBehavior('lightSource'))
  }),
  optic('thin-lens', 'Thin Lens', (p) => {
    const o = baseObject('line', p, autoName('Lens'))
    o.geometry.points = [[0, 0], [0, 120]]
    o.size = { w: 2, h: 120 }
    o.metadata.render = 'lens'
    return withBehaviors(o, createBehavior('thinLens'))
  }),
  optic('optical-mirror', 'Mirror', (p) => {
    const o = baseObject('line', p, autoName('Mirror'))
    o.geometry.points = [[0, 0], [0, 120]]
    o.size = { w: 2, h: 120 }
    o.metadata.render = 'mirror'
    return withBehaviors(o, createBehavior('opticalMirror'))
  }),
  optic('optical-screen', 'Screen', (p) => {
    const o = baseObject('line', p, autoName('Screen'))
    o.geometry.points = [[0, 0], [0, 160]]
    o.size = { w: 2, h: 160 }
    o.metadata.render = 'optical-screen'
    return withBehaviors(o, createBehavior('opticalScreen'))
  }),
  optic('slit', 'Slit', (p) => {
    const o = baseObject('line', p, autoName('Slit'))
    o.geometry.points = [[0, 0], [0, 200]]
    o.size = { w: 2, h: 200 }
    o.metadata.render = 'slit'
    return withBehaviors(o, createBehavior('slit'))
  }),

  // ── Waves: closed-form plane-wave/transmission-line formulas, not a new
  // time-stepping solver — see lib/waves/engine.ts. ──
  wave('wave-source', 'Wave Source', (p) => {
    const o = baseObject('circle', p, autoName('Wave Source'))
    o.size = { w: 24, h: 24 }
    o.metadata.render = 'wave-source'
    return withBehaviors(o, createBehavior('waveSource'))
  }),
  wave('wave-boundary', 'Wave Boundary', (p) => {
    const o = baseObject('line', p, autoName('Boundary'))
    o.geometry.points = [[0, 0], [0, 120]]
    o.size = { w: 2, h: 120 }
    o.metadata.render = 'wave-boundary'
    return withBehaviors(o, createBehavior('waveBoundary'))
  }),
  wave('transmission-line', 'Transmission Line', (p) => {
    const o = baseObject('line', p, autoName('T-Line'))
    o.geometry.points = [[0, 0], [220, 0]]
    o.size = { w: 220, h: 2 }
    o.metadata.render = 'transmission-line'
    return withBehaviors(o, createBehavior('transmissionLine'))
  }),

  // ── Quantum: self-contained param → plot objects, no scene interaction
  // (stationary states — see lib/quantum/engine.ts). ──
  quantum('quantum-well', 'Quantum Well', (p) => {
    const o = baseObject('rect', p, autoName('Quantum Well'))
    o.size = { w: 260, h: 160 }
    o.metadata.render = 'quantum-well'
    return withBehaviors(o, createBehavior('quantumWell'))
  }),
  quantum('tunnel-barrier', 'Tunnel Barrier', (p) => {
    const o = baseObject('rect', p, autoName('Tunnel Barrier'))
    o.size = { w: 260, h: 140 }
    o.metadata.render = 'tunnel-barrier'
    return withBehaviors(o, createBehavior('tunnelBarrier'))
  }),

  // ── DSA: C++ IDE + line-by-line algorithm visualizer (memory blocks,
  // pointer arrows, recursion tree, measured complexity — lib/dsa). ──
  {
    id: 'dsa-lab',
    label: 'DSA Lab',
    domain: 'dsa' as const,
    live: true,
    create: (p: Vec2) => createGeometry('dsa', p),
  },

  // ── Economics: engineering-economics cash-flow timeline (money moves
  // through time; NPV/FV computed live — see components/objects/cashflow). ──
  econ('cashflow', 'Cash Flow', (p) => {
    const o = baseObject('cashflow', p, autoName('Cash Flow'))
    o.size = { w: 480, h: 300 }
    o.parameters.spec = str(JSON.stringify(EMPTY_SPEC))
    return o
  }),

  // ── Digital analysis: reads the circuit rather than being part of it. ──
  {
    id: 'truth-table',
    label: 'Truth Table',
    domain: 'digital' as const,
    live: true,
    create: (p: Vec2) => {
      const o = baseObject('truthtable', p, autoName('Truth Table'))
      o.size = { w: 320, h: 260 }
      o.parameters.inputs = str('')
      o.parameters.outputs = str('')
      return o
    },
  },

  // ── Electrical / Electronics / Digital: live symbols, MNA + logic solver ──
  ...(
    [
      ['electrical', 'battery', 'Battery', { V: '9' }],
      ['electrical', 'ac-source', 'AC Source', { V: '12', f: '1', wave: '0' }],
      ['electrical', 'current-source', 'Current Source', { I: '0.01' }],
      ['electrical', 'resistor', 'Resistor', { R: '100' }],
      ['electrical', 'bulb', 'Bulb', { R: '20' }],
      ['electrical', 'capacitor', 'Capacitor', { C: '0.001' }],
      ['electrical', 'inductor', 'Inductor', { L: '0.1' }],
      ['electrical', 'potentiometer', 'Potentiometer', { R: '1000', ratio: '0.5' }],
      ['electrical', 'switch', 'Switch', { closed: '1' }],
      ['electrical', 'fuse', 'Fuse', { Imax: '1' }],
      ['electrical', 'gnd', 'Ground', {}],
      ['electrical', 'voltmeter', 'Voltmeter', {}],
      ['electrical', 'ammeter', 'Ammeter', {}],
      ['electrical', 'wattmeter', 'Wattmeter', {}],
      ['electrical', 'probe', 'Probe', {}],
      ['electrical', 'vcvs', 'VCVS', { gain: '2' }],
      ['electrical', 'vccs', 'VCCS', { gm: '0.01' }],
      ['electrical', 'ccvs', 'CCVS', { r: '100' }],
      ['electrical', 'cccs', 'CCCS', { beta: '2' }],
      ['electrical', 'transformer', 'Transformer', { n: '2' }],
      ['electrical', 'transformer-ct', 'Transformer (CT)', { n: '2' }],
      ['electrical', 'three-phase-source', '3-Phase Source', { V: '220', f: '50' }],
      ['electrical', 'dc-machine', 'DC Machine', { Ra: '2', k: '0.5', J: '0.02', load: '0', friction: '0.001' }],
      ['electronics', 'diode', 'Diode', { Vf: '0.7' }],
      ['electronics', 'led', 'LED', { Vf: '2' }],
      ['electronics', 'zener', 'Zener Diode', { Vf: '0.7', Vz: '5.1' }],
      ['electronics', 'bjt', 'BJT (NPN)', { beta: '100' }],
      ['electronics', 'bjt-pnp', 'BJT (PNP)', { beta: '100' }],
      ['electronics', 'mosfet', 'MOSFET (N)', { Vt: '2' }],
      ['electronics', 'mosfet-pmos', 'MOSFET (P)', { Vt: '2' }],
      ['electronics', 'opamp', 'Op-Amp', { gain: '100000' }],
      ['digital', 'input', 'Input', { value: '0' }],
      ['digital', 'clock', 'Clock', { f: '1' }],
      ['digital', 'output', 'Output', {}],
      ['digital', 'logic-probe', 'Logic Probe', {}],
      ['digital', 'and-gate', 'AND', {}],
      ['digital', 'or-gate', 'OR', {}],
      ['digital', 'xor-gate', 'XOR', {}],
      ['digital', 'nand-gate', 'NAND', {}],
      ['digital', 'nor-gate', 'NOR', {}],
      ['digital', 'not-gate', 'NOT', {}],
      ['digital', 'd-ff', 'D Flip-Flop', {}],
      ['digital', 'jk-ff', 'JK Flip-Flop', {}],
      ['digital', 't-ff', 'T Flip-Flop', {}],
      ['digital', 'sr-latch', 'SR Latch', {}],
      ['digital', 'tristate', 'Tri-State Buffer', {}],
      ['digital', 'mux', 'MUX', {}],
      ['digital', 'demux', 'DEMUX', {}],
      ['digital', 'encoder', 'Encoder 4:2', {}],
      ['digital', 'half-adder', 'Half Adder', {}],
      ['digital', 'full-adder', 'Full Adder', {}],
      ['digital', 'decoder', 'Decoder 2:4', {}],
      ['digital', 'comparator', 'Comparator', {}],
      ['digital', 'seven-seg', '7-Segment Display', {}],
      ['digital', 'bcd-7seg', 'BCD → 7-Seg', {}],
      ['digital', 'register4', 'Shift Register 4-bit', {}],
      ['digital', 'counter4', 'Counter 4-bit', { mod: '16', dir: '0' }],
    ] as [ComponentDef['domain'], string, string, Record<string, string>][]
  ).map(([domain, name, label, params]): ComponentDef => ({
    id: name,
    label,
    domain,
    live: true,
    create: (p) => symbol(domain, name, label, p, params),
  })),

  // ── Cross-domain: physics ↔ circuit couplings that need an extra behavior
  // beyond bare electricalNode, so they can't go through the generic map
  // above. See lib/physics/world.ts (makeBody's symbol case, the pressure-
  // plate collision listener, and syncElectricMotors). ──
  {
    id: 'pressure-plate',
    label: 'Pressure Plate',
    domain: 'electrical',
    live: true,
    create: (p) => withBehaviors(symbol('electrical', 'pressure-plate', 'Pressure Plate', p, {}), createBehavior('staticBody')),
  },
  {
    id: 'electric-motor',
    label: 'Electric Motor',
    domain: 'electrical',
    live: true,
    // Same symbol/circuit math as plain "DC Machine" — the only difference
    // is the hinge, which is what lets a real body pin to it and spin.
    create: (p) =>
      withBehaviors(
        symbol('electrical', 'dc-machine', 'Electric Motor', p, { Ra: '2', k: '0.5', J: '0.02', load: '0', friction: '0.001' }),
        createBehavior('hinge')
      ),
  },
  {
    id: 'induction-motor',
    label: '3-Phase Induction Motor',
    domain: 'electrical',
    live: true,
    create: (p) =>
      withBehaviors(
        symbol('electrical', 'induction-motor', '3-Phase Induction Motor', p, {
          R2: '5', X: '8', poles: '4', f: '50', J: '0.05', load: '0', friction: '0.001',
        }),
        createBehavior('hinge')
      ),
  },
]

export const componentById = (id: string) => COMPONENTS.find((c) => c.id === id)
