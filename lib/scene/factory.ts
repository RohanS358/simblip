// Factories: bare geometry primitives and the component palette.
// A palette component is nothing special — it is geometry + pre-attached
// behaviors. The user can build the identical thing by drawing and
// converting; the palette only saves clicks (docs/architecture.md).

import type { SceneObject, GeometryKind, Vec2, Behavior } from './types'
import { num, str, uid } from './types'
import { createBehavior } from '@/lib/behaviors/registry'
import type { Recognition } from '@/lib/sketch/recognize'

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
  }
  return obj
}

/** Turn a recognized sketch into a scene object (spring gets its behavior). */
export function fromRecognition(rec: Recognition): SceneObject {
  const kindMap: Record<Recognition['kind'], GeometryKind> = {
    circle: 'circle',
    rect: 'rect',
    line: 'line',
    polygon: 'polygon',
    spring: 'line',
    stroke: 'stroke',
  }
  const obj = baseObject(kindMap[rec.kind], { x: rec.x, y: rec.y })
  obj.name = autoName(rec.kind === 'spring' ? 'Spring' : obj.geometry.kind.charAt(0).toUpperCase() + obj.geometry.kind.slice(1))
  obj.size = { w: rec.w, h: rec.h }
  if (rec.points.length > 0) obj.geometry.points = rec.points
  if (rec.kind === 'spring') {
    obj.behaviors.push(createBehavior('spring'))
    obj.metadata.render = 'spring'
  }
  return obj
}

// ── Component palette ───────────────────────────────────────────────────────

export interface ComponentDef {
  id: string
  label: string
  domain: 'mechanics' | 'electrical' | 'electronics' | 'digital'
  /** live = participates in the current engine; symbols await their solver */
  live: boolean
  create: (position: Vec2) => SceneObject
}

function withBehaviors(obj: SceneObject, ...behaviors: Behavior[]): SceneObject {
  obj.behaviors.push(...behaviors)
  return obj
}

function symbol(domain: ComponentDef['domain'], name: string, label: string, position: Vec2, params: Record<string, string> = {}): SceneObject {
  const obj = baseObject('symbol', position, autoName(label))
  obj.geometry.symbol = name
  obj.geometry.domain = domain
  obj.size = { w: 96, h: 48 }
  for (const [k, v] of Object.entries(params)) obj.parameters[k] = num(v)
  obj.behaviors.push(createBehavior('electricalNode'))
  return obj
}

const mech = (id: string, label: string, create: ComponentDef['create']): ComponentDef => ({
  id, label, domain: 'mechanics', live: true, create,
})

export const COMPONENTS: ComponentDef[] = [
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

  // ── Electrical / Electronics / Digital: editable symbols; solvers roadmap ──
  ...(
    [
      ['electrical', 'resistor', 'Resistor', { R: '100' }],
      ['electrical', 'capacitor', 'Capacitor', { C: '0.001' }],
      ['electrical', 'inductor', 'Inductor', { L: '0.1' }],
      ['electrical', 'battery', 'Battery', { V: '9' }],
      ['electrical', 'ac-source', 'AC Source', { V: '230', f: '50' }],
      ['electrical', 'gnd', 'Ground', {}],
      ['electrical', 'switch', 'Switch', {}],
      ['electronics', 'diode', 'Diode', {}],
      ['electronics', 'led', 'LED', {}],
      ['electronics', 'bjt', 'BJT', { beta: '100' }],
      ['electronics', 'mosfet', 'MOSFET', {}],
      ['electronics', 'opamp', 'Op-Amp', { gain: '100000' }],
      ['digital', 'and-gate', 'AND', {}],
      ['digital', 'or-gate', 'OR', {}],
      ['digital', 'xor-gate', 'XOR', {}],
      ['digital', 'not-gate', 'NOT', {}],
      ['digital', 'd-ff', 'D Flip-Flop', {}],
      ['digital', 'mux', 'MUX', {}],
    ] as [ComponentDef['domain'], string, string, Record<string, string>][]
  ).map(([domain, name, label, params]): ComponentDef => ({
    id: name,
    label,
    domain,
    live: false,
    create: (p) => symbol(domain, name, label, p, params),
  })),
]

export const componentById = (id: string) => COMPONENTS.find((c) => c.id === id)
