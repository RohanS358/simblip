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

Matter.Common.setDecomp(decomp)

export const PPM = 100 // pixels per meter — graphs report SI units

export type PlayMode = 'edit' | 'running' | 'paused'

interface RuntimeState {
  mode: PlayMode
  time: number // displayed sim time, throttled updates
  bodyCollisions: boolean // rigid body ↔ rigid body collision toggle
  setMode: (m: PlayMode) => void
  setTime: (t: number) => void
  toggleBodyCollisions: () => void
}

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  mode: 'edit',
  time: 0,
  bodyCollisions: true,
  setMode: (mode) => set({ mode }),
  setTime: (time) => set({ time }),
  toggleBodyCollisions: () => {
    const next = !get().bodyCollisions
    set({ bodyCollisions: next })
    // Live-update any bodies already in the running world.
    if (world) {
      for (const b of world.bodies) {
        if (!b.body.isStatic) b.body.collisionFilter.group = next ? 0 : -1
      }
    }
  },
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
    if (!useRuntimeStore.getState().bodyCollisions) body.collisionFilter.group = -1
  }
  return body
}

function compiledParam(obj: SceneObject, behaviorType: string, name: string, fallback: number) {
  const b = obj.behaviors.find((x) => x.enabled && x.type === behaviorType)
  const p = b?.params[name]
  return p?.kind === 'number' ? compileExpr(p.expr, p.value) : () => fallback
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
    const motors = obj.behaviors
      .filter((b) => b.enabled && b.type === 'motor')
      .map((b) => {
        const p = b.params.speed
        return p?.kind === 'number' ? compileExpr(p.expr, p.value) : () => 0
      })
    const forces = obj.behaviors
      .filter((b) => b.enabled && b.type === 'force')
      .map((b) => ({
        fx: b.params.fx?.kind === 'number' ? compileExpr(b.params.fx.expr, 0) : () => 0,
        fy: b.params.fy?.kind === 'number' ? compileExpr(b.params.fy.expr, 0) : () => 0,
      }))
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
        k: conn.type === 'spring' ? compiledParam(obj, 'spring', 'k', 20) : undefined,
        damping:
          conn.type !== 'rod' ? compiledParam(obj, conn.type, 'damping', 0.05) : undefined,
        restScale: conn.type === 'spring' ? compiledParam(obj, 'spring', 'restScale', 1) : undefined,
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

  return { pageId, engine, bodies, connectors, t: 0, raf: null, last: 0, acc: 0 }
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
    const path = el?.querySelector<SVGPathElement>('path[data-connector]')
    if (!el || !path) continue
    const obj = useDocStore.getState().pages[w.pageId]?.objects[c.objectId]
    if (!obj) continue
    const { constraint } = c
    const a = constraint.bodyA
      ? Matter.Constraint.pointAWorld(constraint)
      : (constraint.pointA as Matter.Vector)
    const bPt = constraint.bodyB
      ? Matter.Constraint.pointBWorld(constraint)
      : (constraint.pointB as Matter.Vector)
    path.setAttribute(
      'd',
      connectorPath(c.render, a.x - obj.position.x, a.y - obj.position.y, bPt.x - obj.position.x, bPt.y - obj.position.y)
    )
  }
}

function sample(w: World) {
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

  const scope = useDocStore.getState().scopes[w.pageId] ?? {}
  let stepped = false
  while (w.acc >= STEP) {
    applyLiveParams(w, scope)
    Matter.Engine.update(w.engine, STEP)
    w.t += STEP / 1000
    w.acc -= STEP
    stepped = true
  }
  if (stepped) {
    syncDom(w)
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
  const scope = useDocStore.getState().scopes[world.pageId] ?? {}
  // one display frame = two 120 Hz physics steps
  for (let i = 0; i < 2; i++) {
    applyLiveParams(world, scope)
    Matter.Engine.update(world.engine, STEP)
    world.t += STEP / 1000
  }
  syncDom(world)
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
  useRuntimeStore.getState().setMode('edit')
  useRuntimeStore.getState().setTime(0)
}
