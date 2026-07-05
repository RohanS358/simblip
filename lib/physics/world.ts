'use client'

// The world runtime — the heart of SIMBLIP.
//
// Play mode builds ONE Matter.js world from the scene exactly as drawn:
// objects with body behaviors become bodies, connector objects attach to
// whatever their endpoints touch, hinges pin whatever they overlap. Nothing
// is regenerated or templated — the drawn scene itself starts simulating.
//
// Per-frame, behavior expressions (spring k, motor speed, force fields,
// gravity g) are re-evaluated against the page's variable scope, so editing
// a variable bends a running experiment. Body transforms are written
// straight to the DOM through an element registry — React is not in the
// 60 Hz path (docs/physics-engine.md).

import Matter from 'matter-js'
import decomp from 'poly-decomp'
import { create } from 'zustand'
import type { SceneObject } from '@/lib/scene/types'
import { isBody, connectorBehavior } from '@/lib/behaviors/registry'
import { compileExpr, type Scope } from '@/lib/formula/engine'
import { useDocStore } from '@/lib/store/document'
import { pushSample, notify, clearBuffer } from './bus'
import { connectorPath } from '@/lib/render/connector-path'
import { buildCircuit, stepCircuit, type Circuit } from '@/lib/circuit/engine'

Matter.Common.setDecomp(decomp)

export const PPM = 100 // pixels per meter — graphs report SI units

export type PlayMode = 'edit' | 'running' | 'paused'

interface RuntimeState {
  mode: PlayMode
  time: number // displayed sim time, throttled updates
  setMode: (m: PlayMode) => void
  setTime: (t: number) => void
}

export const useRuntimeStore = create<RuntimeState>((set) => ({
  mode: 'edit',
  time: 0,
  setMode: (mode) => set({ mode }),
  setTime: (time) => set({ time }),
}))

// ── DOM element registry (ObjectViews register their wrapper) ──────────────

const elements = new Map<string, HTMLElement>()

export function registerElement(objectId: string, el: HTMLElement | null) {
  if (el) elements.set(objectId, el)
  else elements.delete(objectId)
}

// ── World internals ─────────────────────────────────────────────────────────

interface BodyEntry {
  objectId: string
  body: Matter.Body
  center0: { x: number; y: number }
  angle0: number
  motors: ((scope: Scope) => number)[]
  forces: { fx: (s: Scope) => number; fy: (s: Scope) => number }[]
}

interface ConnectorEntry {
  objectId: string
  constraint: Matter.Constraint
  render?: string
  k?: (s: Scope) => number
  damping?: (s: Scope) => number
  restScale?: (s: Scope) => number
  rest0: number
}

interface World {
  pageId: string
  engine: Matter.Engine
  bodies: BodyEntry[]
  connectors: ConnectorEntry[]
  circuit: Circuit | null
  t: number
  raf: number | null
  last: number
  acc: number
}

let world: World | null = null
const STEP = 1000 / 120

function bodyCenter(obj: SceneObject) {
  return { x: obj.position.x + obj.size.w / 2, y: obj.position.y + obj.size.h / 2 }
}

function makeBody(obj: SceneObject, kind: 'dynamic' | 'static'): Matter.Body | null {
  const c = bodyCenter(obj)
  const angle = (obj.rotation * Math.PI) / 180
  const g = obj.geometry
  const behavior = obj.behaviors.find((b) => b.type === (kind === 'dynamic' ? 'rigidBody' : 'staticBody'))
  const p = (name: string, fallback: number) => {
    const v = behavior?.params[name]
    return v?.kind === 'number' && Number.isFinite(v.value) ? v.value : fallback
  }
  const options: Matter.IChamferableBodyDefinition = {
    isStatic: kind === 'static',
    angle,
    friction: p('friction', 0.1),
    restitution: p('restitution', 0.4),
  }

  let body: Matter.Body | null = null
  if (g.kind === 'circle') {
    body = Matter.Bodies.circle(c.x, c.y, Math.max(obj.size.w, obj.size.h) / 2, options)
  } else if (g.kind === 'rect') {
    body = Matter.Bodies.rectangle(c.x, c.y, obj.size.w, obj.size.h, options)
  } else if (g.kind === 'line' && g.points && g.points.length >= 2) {
    // A rigid line is a thin beam.
    const [a, b] = [g.points[0], g.points[g.points.length - 1]]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const lineAngle = Math.atan2(b[1] - a[1], b[0] - a[0])
    const mx = obj.position.x + (a[0] + b[0]) / 2
    const my = obj.position.y + (a[1] + b[1]) / 2
    body = Matter.Bodies.rectangle(mx, my, len, 10, { ...options, angle: lineAngle })
  } else if ((g.kind === 'polygon' || g.kind === 'stroke') && g.points && g.points.length >= 3) {
    const verts = g.points.map(([x, y]) => ({ x, y }))
    try {
      body = Matter.Bodies.fromVertices(c.x, c.y, [verts], options, true)
    } catch {
      body = Matter.Bodies.rectangle(c.x, c.y, obj.size.w, obj.size.h, options)
    }
  }
  if (!body) return null

  if (kind === 'dynamic') {
    Matter.Body.setMass(body, Math.max(p('mass', 1), 0.001))
    Matter.Body.setVelocity(body, { x: p('vx', 0) * PPM / 60, y: -p('vy', 0) * PPM / 60 })
    Matter.Body.setAngularVelocity(body, p('omega', 0) / 60)
    // Per-body toggle: opt this body out of colliding with other rigid bodies
    // (statics are a different category, so it still hits ground/walls).
    body.collisionFilter.category = 0x0002
    if (p('collide', 1) === 0) body.collisionFilter.mask = 0xffffffff ^ 0x0002
  }
  return body
}

// Live behavior expression: re-reads the param from the store each call and
// recompiles when the user edits it mid-run — a running experiment follows
// both variable changes AND direct expression edits.
function compiledParam(
  pageId: string,
  objectId: string,
  behaviorType: string,
  name: string,
  fallback: number
) {
  let expr: string | null = null
  let fn: (s: Scope) => number = () => fallback
  return (scope: Scope) => {
    const obj = useDocStore.getState().pages[pageId]?.objects[objectId]
    const p = obj?.behaviors.find((x) => x.enabled && x.type === behaviorType)?.params[name]
    if (p?.kind === 'number' && p.expr !== expr) {
      expr = p.expr
      fn = compileExpr(p.expr, p.value)
    }
    return fn(scope)
  }
}

function endpointWorld(obj: SceneObject, index: 0 | 1): { x: number; y: number } {
  const pts = obj.geometry.points ?? [[0, 0], [obj.size.w, 0]]
  const p = index === 0 ? pts[0] : pts[pts.length - 1]
  return { x: obj.position.x + p[0], y: obj.position.y + p[1] }
}

/** Build the physics world from the page exactly as drawn. */
export function buildWorld(pageId: string): World {
  const page = useDocStore.getState().pages[pageId]
  const engine = Matter.Engine.create()
  engine.gravity.y = 1 // scaled per-frame from the `g` variable

  const bodies: BodyEntry[] = []
  const connectors: ConnectorEntry[] = []
  const objs = Object.values(page?.objects ?? {})

  for (const obj of objs) {
    const kind = isBody(obj.behaviors)
    if (!kind) continue
    const body = makeBody(obj, kind)
    if (!body) continue
    const motors = obj.behaviors.some((b) => b.enabled && b.type === 'motor')
      ? [compiledParam(pageId, obj.id, 'motor', 'speed', 0)]
      : []
    const forces = obj.behaviors.some((b) => b.enabled && b.type === 'force')
      ? [
          {
            fx: compiledParam(pageId, obj.id, 'force', 'fx', 0),
            fy: compiledParam(pageId, obj.id, 'force', 'fy', 0),
          },
        ]
      : []
    bodies.push({
      objectId: obj.id,
      body,
      center0: { x: body.position.x, y: body.position.y },
      angle0: body.angle,
      motors,
      forces,
    })
    Matter.Composite.add(engine.world, body)
  }

  const allBodies = bodies.map((b) => b.body)

  // Connectors attach to whatever their endpoints touch — drawing a spring
  // from a mass to the ground IS the constraint.
  for (const obj of objs) {
    const conn = connectorBehavior(obj.behaviors)
    if (conn) {
      const pA = endpointWorld(obj, 0)
      const pB = endpointWorld(obj, 1)
      const hitA = Matter.Query.point(allBodies, pA)[0]
      const hitB = Matter.Query.point(allBodies, pB)[0]
      const rest0 = Math.hypot(pB.x - pA.x, pB.y - pA.y)
      const stiffnessFor = (type: string) => (type === 'rod' ? 1 : type === 'rope' ? 0.9 : 0.05)
      const constraint = Matter.Constraint.create({
        bodyA: hitA,
        bodyB: hitB,
        pointA: hitA ? { x: pA.x - hitA.position.x, y: pA.y - hitA.position.y } : pA,
        pointB: hitB ? { x: pB.x - hitB.position.x, y: pB.y - hitB.position.y } : pB,
        length: rest0,
        stiffness: stiffnessFor(conn.type),
        damping: 0.02,
      })
      Matter.Composite.add(engine.world, constraint)
      connectors.push({
        objectId: obj.id,
        constraint,
        render: (obj.metadata.render as string) ?? (conn.type === 'spring' ? 'spring' : conn.type === 'rope' ? 'rope' : conn.type === 'damper' ? 'damper' : undefined),
        k: conn.type === 'spring' ? compiledParam(pageId, obj.id, 'spring', 'k', 20) : undefined,
        damping:
          conn.type !== 'rod'
            ? compiledParam(pageId, obj.id, conn.type, 'damping', 0.05)
            : undefined,
        restScale:
          conn.type === 'spring' ? compiledParam(pageId, obj.id, 'spring', 'restScale', 1) : undefined,
        rest0,
      })
    }

    // Hinges pin the bodies under them (or one body to the world).
    if (obj.behaviors.some((b) => b.enabled && b.type === 'hinge')) {
      const c = bodyCenter(obj)
      const hits = Matter.Query.point(allBodies, c)
      const [a, b] = [hits[0], hits[1]]
      if (a) {
        const constraint = Matter.Constraint.create({
          bodyA: a,
          bodyB: b,
          pointA: { x: c.x - a.position.x, y: c.y - a.position.y },
          pointB: b ? { x: c.x - b.position.x, y: c.y - b.position.y } : c,
          length: 0,
          stiffness: 1,
        })
        Matter.Composite.add(engine.world, constraint)
        connectors.push({ objectId: obj.id, constraint, rest0: 0 })
      }
    }
  }

  return {
    pageId,
    engine,
    bodies,
    connectors,
    circuit: buildCircuit(objs),
    t: 0,
    raf: null,
    last: 0,
    acc: 0,
  }
}

function applyLiveParams(w: World, scope: Scope) {
  // gravity: page variable g (m/s²) relative to Earth default
  const g = typeof scope.g === 'number' ? scope.g : 9.81
  w.engine.gravity.y = g / 9.81

  const frameScope = { ...scope, t: w.t }
  for (const c of w.connectors) {
    if (c.k) {
      const k = Math.max(c.k(frameScope), 0)
      c.constraint.stiffness = Math.min(0.999, Math.max(0.0005, k / (k + 400)))
    }
    if (c.damping) c.constraint.damping = Math.min(0.5, Math.max(0, c.damping(frameScope)))
    if (c.restScale) c.constraint.length = c.rest0 * Math.max(c.restScale(frameScope), 0.01)
  }
  for (const b of w.bodies) {
    for (const speed of b.motors) Matter.Body.setAngularVelocity(b.body, speed(frameScope) / 60)
    for (const f of b.forces) {
      Matter.Body.applyForce(b.body, b.body.position, {
        x: f.fx(frameScope) * b.body.mass * 1e-4,
        y: -f.fy(frameScope) * b.body.mass * 1e-4,
      })
    }
  }
}

function syncDom(w: World) {
  for (const b of w.bodies) {
    const el = elements.get(b.objectId)
    if (!el) continue
    const dx = b.body.position.x - b.center0.x
    const dy = b.body.position.y - b.center0.y
    // Delta rotation only — the object's edit-time rotation is already
    // rendered on the inner div (see ObjectView).
    el.style.transform = `translate(${dx}px, ${dy}px) rotate(${b.body.angle - b.angle0}rad)`
  }
  for (const c of w.connectors) {
    const el = elements.get(c.objectId)
    if (!el) continue
    const obj = useDocStore.getState().pages[w.pageId]?.objects[c.objectId]
    if (!obj) continue
    const { constraint } = c
    const a = constraint.bodyA
      ? Matter.Constraint.pointAWorld(constraint)
      : (constraint.pointA as Matter.Vector)
    const bPt = constraint.bodyB
      ? Matter.Constraint.pointBWorld(constraint)
      : (constraint.pointB as Matter.Vector)
    const path = el.querySelector<SVGPathElement>('path[data-connector]')
    if (!path) {
      // Hinge marker (no path) — follow the pinned joint point.
      const c0 = bodyCenter(obj)
      el.style.transform = `translate(${a.x - c0.x}px, ${a.y - c0.y}px)`
      continue
    }
    path.setAttribute(
      'd',
      connectorPath(c.render, a.x - obj.position.x, a.y - obj.position.y, bPt.x - obj.position.x, bPt.y - obj.position.y)
    )
  }
}

// Circuit results → DOM, outside React (flow dashes, readouts, pins, glow).
function syncCircuitDom(w: World) {
  const c = w.circuit
  if (!c) return
  for (const [id, flow] of c.frame.wires) {
    const el = elements.get(id)
    if (!el) continue
    const conv = el.querySelector<SVGPathElement>('path[data-flow="conv"]')
    const elec = el.querySelector<SVGPathElement>('path[data-flow="elec"]')
    if (conv) {
      conv.style.strokeDashoffset = `${-flow.charge}px`
      conv.style.opacity = String(flow.intensity)
    }
    if (elec) {
      // electrons drift opposite to conventional current
      elec.style.strokeDashoffset = `${flow.charge}px`
      elec.style.opacity = String(flow.intensity * 0.9)
    }
    const base = el.querySelector<SVGPathElement>('path[data-wire]')
    if (base && flow.digital !== undefined) {
      base.style.stroke = flow.digital ? 'var(--accent-mint)' : ''
    }
  }
  for (const [id, r] of c.frame.readings) {
    const el = elements.get(id)
    if (!el) continue
    if (r.text !== undefined) {
      const s = el.querySelector('[data-reading]')
      if (s && s.textContent !== r.text) s.textContent = r.text
    }
    if (r.glow !== undefined) {
      const g = el.querySelector<SVGElement>('[data-glow]')
      if (g) g.style.opacity = String(Math.min(1, r.glow) * 0.55)
    }
  }
  for (const [id, pins] of c.frame.pins) {
    const el = elements.get(id)
    if (!el) continue
    el.querySelectorAll<HTMLElement>('[data-pin]').forEach((p) => {
      const v = pins[Number(p.dataset.pin)]
      const txt = v === undefined ? '' : String(v)
      if (p.textContent !== txt) p.textContent = txt
      p.dataset.state = v ? '1' : '0'
    })
  }
}

function resetCircuitDom() {
  for (const el of elements.values()) {
    el.querySelectorAll<SVGPathElement>('path[data-flow]').forEach((p) => {
      p.style.opacity = '0'
      p.style.strokeDashoffset = '0'
    })
    el.querySelectorAll<HTMLElement>('[data-reading], [data-pin]').forEach((s) => {
      s.textContent = ''
    })
    const g = el.querySelector<SVGElement>('[data-glow]')
    if (g) g.style.opacity = '0'
    const base = el.querySelector<SVGPathElement>('path[data-wire]')
    if (base) base.style.stroke = ''
  }
}

function sample(w: World) {
  if (w.circuit) {
    // electrical readings feed the same graph bus as body channels
    for (const [id, r] of w.circuit.frame.readings) {
      if (r.channels) {
        pushSample(id, { t: w.t, channels: r.channels })
        notify(id)
      }
    }
  }
  for (const b of w.bodies) {
    if (b.body.isStatic) continue
    const v = b.body.velocity // px per 60Hz frame
    const channels = {
      x: b.body.position.x / PPM,
      y: -b.body.position.y / PPM,
      vx: (v.x * 60) / PPM,
      vy: (-v.y * 60) / PPM,
      speed: (Math.hypot(v.x, v.y) * 60) / PPM,
      angle: b.body.angle,
      omega: b.body.angularVelocity * 60,
      ke: 0.5 * b.body.mass * ((Math.hypot(v.x, v.y) * 60) / PPM) ** 2,
    }
    pushSample(b.objectId, { t: w.t, channels })
    notify(b.objectId)
  }
}

let timeUpdateAt = 0

function frame(now: number) {
  if (!world) return
  const w = world
  const elapsed = Math.min(now - w.last, 100)
  w.last = now
  w.acc += elapsed

  const docState = useDocStore.getState()
  const scope = docState.scopes[w.pageId] ?? {}
  const pageObjects = docState.pages[w.pageId]?.objects ?? {}
  let stepped = false
  while (w.acc >= STEP) {
    applyLiveParams(w, scope)
    Matter.Engine.update(w.engine, STEP)
    if (w.circuit) stepCircuit(w.circuit, STEP / 1000, w.t, pageObjects)
    w.t += STEP / 1000
    w.acc -= STEP
    stepped = true
  }
  if (stepped) {
    syncDom(w)
    syncCircuitDom(w)
    sample(w)
    if (now - timeUpdateAt > 150) {
      timeUpdateAt = now
      useRuntimeStore.getState().setTime(w.t)
    }
  }
  w.raf = requestAnimationFrame(frame)
}

// ── Transport controls ──────────────────────────────────────────────────────

export function play(pageId: string) {
  const rt = useRuntimeStore.getState()
  if (rt.mode === 'paused' && world && world.pageId === pageId) {
    world.last = performance.now()
    world.acc = 0
    world.raf = requestAnimationFrame(frame)
    rt.setMode('running')
    return
  }
  stop() // clean previous world if any
  world = buildWorld(pageId)
  for (const b of world.bodies) clearBuffer(b.objectId)
  for (const comp of world.circuit?.comps ?? []) clearBuffer(comp.id)
  world.last = performance.now()
  world.raf = requestAnimationFrame(frame)
  rt.setMode('running')
  rt.setTime(0)
}

export function pause() {
  if (!world) return
  if (world.raf !== null) cancelAnimationFrame(world.raf)
  world.raf = null
  useRuntimeStore.getState().setMode('paused')
}

export function stepFrame() {
  if (!world) return
  const docState = useDocStore.getState()
  const scope = docState.scopes[world.pageId] ?? {}
  const pageObjects = docState.pages[world.pageId]?.objects ?? {}
  // one display frame = two 120 Hz physics steps
  for (let i = 0; i < 2; i++) {
    applyLiveParams(world, scope)
    Matter.Engine.update(world.engine, STEP)
    if (world.circuit) stepCircuit(world.circuit, STEP / 1000, world.t, pageObjects)
    world.t += STEP / 1000
  }
  syncDom(world)
  syncCircuitDom(world)
  sample(world)
  useRuntimeStore.getState().setTime(world.t)
}

/** Reset: discard the runtime; the scene as edited is untouched by design. */
export function stop() {
  if (world) {
    if (world.raf != null) cancelAnimationFrame(world.raf)
    // Restore connector paths to their drawn geometry — we mutated the DOM
    // directly, so React won't repaint them (its props never changed).
    for (const c of world.connectors) {
      const el = elements.get(c.objectId)
      const path = el?.querySelector<SVGPathElement>('path[data-connector]')
      const obj = useDocStore.getState().pages[world.pageId]?.objects[c.objectId]
      if (!path || !obj) continue
      const pts = obj.geometry.points ?? [[0, 0], [obj.size.w, 0]]
      const a = pts[0]
      const b = pts[pts.length - 1]
      path.setAttribute(
        'd',
        connectorPath((obj.metadata.render as string) ?? undefined, a[0], a[1], b[0], b[1])
      )
    }
    world = null
  }
  for (const el of elements.values()) el.style.transform = ''
  resetCircuitDom()
  useRuntimeStore.getState().setMode('edit')
  useRuntimeStore.getState().setTime(0)
}
