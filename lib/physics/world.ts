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
import { PX_PER_CM, PX_PER_M } from '@/lib/scene/units'
import { isBody, connectorBehavior } from '@/lib/behaviors/registry'
import { compileExpr, type Scope } from '@/lib/formula/engine'
import { useDocStore } from '@/lib/store/document'
import { pushSample, notify, clearBuffer } from './bus'
import { connectorPath } from '@/lib/render/connector-path'
import { buildCircuit, stepCircuit, type Circuit } from '@/lib/circuit/engine'
import { pushEvent, clearEvents } from './event-log'

Matter.Common.setDecomp(decomp)

// The page is measured in centimetres (10 px = 1 cm, lib/scene/units.ts), so
// a metre is 1000 px. Positions and speeds are reported in cm/cm·s⁻¹ to match
// what the Inspector shows; energy stays in joules, which needs metres.
export const PPM = PX_PER_M // pixels per metre — 1000
export { PX_PER_CM }

export type PlayMode = 'edit' | 'running' | 'paused'

interface RuntimeState {
  mode: PlayMode
  time: number // displayed sim time, throttled updates
  /** The system boundary currently being simulated, or null for the whole
   *  page. A scoped run only builds the objects inside that boundary. */
  scopeId: string | null
  setMode: (m: PlayMode) => void
  setTime: (t: number) => void
  setScope: (id: string | null) => void
}

export const useRuntimeStore = create<RuntimeState>((set) => ({
  mode: 'edit',
  time: 0,
  scopeId: null,
  setMode: (mode) => set({ mode }),
  setTime: (time) => set({ time }),
  setScope: (scopeId) => set({ scopeId }),
}))

// ── DOM element registry (ObjectViews register their wrapper) ──────────────

const elements = new Map<string, HTMLElement>()

/** The wrapper element for an object, if it's currently mounted. Lets the
 *  canvas move things by writing transforms directly, exactly like the physics
 *  loop does — React is far too expensive to sit in a 60 Hz drag. */
export function getElement(objectId: string): HTMLElement | undefined {
  return elements.get(objectId)
}

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
  /** A rope only resists STRETCHING past its length — unlike a rod/spring it
   * must go slack (exert nothing) once its two ends are closer together than
   * that, or it's just a softer rod. See applyLiveParams. */
  isRope?: boolean
}

interface ChargeEntry {
  body: Matter.Body
  q: (s: Scope) => number
}

interface FieldRegion {
  kind: 'e' | 'b'
  objectId: string // position/size read live — the region itself never moves
  Ex?: (s: Scope) => number
  Ey?: (s: Scope) => number
  Bz?: (s: Scope) => number
}

interface TorsionEntry {
  body: Matter.Body
  angle0: number
  k: (s: Scope) => number
  restAngle: (s: Scope) => number
}

interface ThermalEntry {
  objectId: string
  body: Matter.Body
  power: (s: Scope) => number
  conductivity: (s: Scope) => number
  coolRate: (s: Scope) => number
  temp: number // °C — persists across steps
}

interface TracerEntry {
  objectId: string
  body: Matter.Body
  motion: (s: Scope) => number
  trail: (s: Scope) => number
  forcesOn: (s: Scope) => number
  trailPts: number[][]
  prevV: { x: number; y: number }
  prevW: number
}

interface World {
  pageId: string
  /** system boundary this run is confined to (null = the whole page) */
  scopeId: string | null
  engine: Matter.Engine
  bodies: BodyEntry[]
  tracers: TracerEntry[]
  connectors: ConnectorEntry[]
  charges: ChargeEntry[]
  fields: FieldRegion[]
  torsions: TorsionEntry[]
  thermal: ThermalEntry[]
  circuit: Circuit | null
  t: number
  raf: number | null
  last: number
  acc: number
}

let world: World | null = null
const STEP = 1000 / 120

// ── Step-back history: a bounded stack of pre-step snapshots ───────────────
// Matter.js integration isn't reversible, so "step back" doesn't rewind
// physics — it restores the exact state captured just before the step that's
// being undone. One entry per display frame (Play) or per Step-button press.
interface Snapshot {
  t: number
  bodies: { id: string; x: number; y: number; angle: number; vx: number; vy: number; av: number }[]
  thermal: { objectId: string; temp: number }[]
  compState: { id: string; state: Record<string, number> }[]
  trailLens: { objectId: string; len: number }[]
}

const HISTORY_MAX = 900
let history: Snapshot[] = []

function captureSnapshot(w: World): Snapshot {
  return {
    t: w.t,
    bodies: w.bodies.map((b) => ({
      id: b.objectId,
      x: b.body.position.x,
      y: b.body.position.y,
      angle: b.body.angle,
      vx: b.body.velocity.x,
      vy: b.body.velocity.y,
      av: b.body.angularVelocity,
    })),
    thermal: w.thermal.map((th) => ({ objectId: th.objectId, temp: th.temp })),
    compState: (w.circuit?.comps ?? []).map((c) => ({ id: c.id, state: { ...c.state } })),
    trailLens: w.tracers.map((t) => ({ objectId: t.objectId, len: t.trailPts.length })),
  }
}

function restoreSnapshot(w: World, snap: Snapshot) {
  const byId = new Map(w.bodies.map((b) => [b.objectId, b]))
  for (const bs of snap.bodies) {
    const b = byId.get(bs.id)
    if (!b) continue
    Matter.Body.setPosition(b.body, { x: bs.x, y: bs.y })
    Matter.Body.setAngle(b.body, bs.angle)
    Matter.Body.setVelocity(b.body, { x: bs.vx, y: bs.vy })
    Matter.Body.setAngularVelocity(b.body, bs.av)
  }
  for (const ts of snap.thermal) {
    const th = w.thermal.find((x) => x.objectId === ts.objectId)
    if (th) th.temp = ts.temp
  }
  if (w.circuit) {
    const compById = new Map(w.circuit.comps.map((c) => [c.id, c]))
    for (const cs of snap.compState) {
      const c = compById.get(cs.id)
      if (c) c.state = { ...cs.state }
    }
  }
  for (const tl of snap.trailLens) {
    const tr = w.tracers.find((x) => x.objectId === tl.objectId)
    if (!tr) continue
    tr.trailPts.length = Math.min(tr.trailPts.length, tl.len)
    tr.prevV = { x: tr.body.velocity.x, y: tr.body.velocity.y }
    tr.prevW = tr.body.angularVelocity
  }
  w.t = snap.t
}

function pushHistory(w: World) {
  history.push(captureSnapshot(w))
  if (history.length > HISTORY_MAX) history.shift()
}

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

  // A reference point is an OBSERVER: it rides along on the body under it and
  // reports where that material point goes. It must not collide with anything
  // or weigh the host down, or it would change the very motion it's measuring.
  if (obj.metadata.render === 'reference-point') {
    options.isSensor = true
    options.collisionFilter = { group: -1, category: 0, mask: 0 }
    options.frictionAir = 0
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
  } else if (g.kind === 'stroke' && g.points && g.points.length >= 2) {
    // A doodle is an open polyline — decomposing it as a "polygon" yields
    // degenerate slivers that never collide. Build a chain of thin segments
    // along the ink instead: drawn ramps, bowls and terrain collide exactly
    // where the line is.
    const parts: Matter.Body[] = []
    let prev = g.points[0]
    for (let i = 1; i < g.points.length; i++) {
      const cur = g.points[i]
      const len = Math.hypot(cur[0] - prev[0], cur[1] - prev[1])
      // Resample: merge sub-8px steps so a scribble stays a few dozen parts.
      if (len < 8 && i < g.points.length - 1) continue
      if (len >= 1) {
        parts.push(
          Matter.Bodies.rectangle(
            obj.position.x + (prev[0] + cur[0]) / 2,
            obj.position.y + (prev[1] + cur[1]) / 2,
            len + 4, // slight overlap keeps the chain gap-free on curves
            8,
            {
              angle: Math.atan2(cur[1] - prev[1], cur[0] - prev[0]),
              // Collisions read material props from the touched PART.
              friction: options.friction,
              restitution: options.restitution,
            }
          )
        )
      }
      prev = cur
    }
    if (parts.length > 0) body = Matter.Body.create({ parts, ...options })
  } else if (g.kind === 'polygon' && g.points && g.points.length >= 3) {
    const verts = g.points.map(([x, y]) => ({ x, y }))
    try {
      body = Matter.Bodies.fromVertices(c.x, c.y, [verts], options, true)
    } catch {
      body = Matter.Bodies.rectangle(c.x, c.y, obj.size.w, obj.size.h, options)
    }
  } else if (g.kind === 'symbol') {
    // A circuit symbol given a rigidBody/staticBody (e.g. the Pressure Plate
    // preset) gets a plain rectangular collider matching its footprint — no
    // existing component combines symbol+body, so this is purely additive.
    body = Matter.Bodies.rectangle(c.x, c.y, obj.size.w, obj.size.h, options)
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
export function buildWorld(pageId: string, scopeId: string | null = null): World {
  const page = useDocStore.getState().pages[pageId]
  const engine = Matter.Engine.create()
  engine.gravity.y = 1 // scaled per-frame from the `g` variable

  const bodies: BodyEntry[] = []
  const tracers: TracerEntry[] = []
  const connectors: ConnectorEntry[] = []
  const charges: ChargeEntry[] = []
  const fields: FieldRegion[] = []
  const torsions: TorsionEntry[] = []
  const thermal: ThermalEntry[] = []

  // A scoped run simulates ONLY what sits inside that system boundary — an
  // object counts as inside when its centre is within the box. The boundary
  // object itself is never simulated (it's the container, not content).
  const scope = scopeId ? page?.objects[scopeId] : undefined
  const inScope = (o: SceneObject) => {
    if (!scope) return true
    if (o.id === scope.id) return false
    const cx = o.position.x + o.size.w / 2
    const cy = o.position.y + o.size.h / 2
    return (
      cx >= scope.position.x &&
      cx <= scope.position.x + scope.size.w &&
      cy >= scope.position.y &&
      cy <= scope.position.y + scope.size.h
    )
  }
  const objs = Object.values(page?.objects ?? {}).filter(inScope)

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
    if (kind === 'dynamic') {
      tracers.push({
        objectId: obj.id,
        body,
        motion: compiledParam(pageId, obj.id, 'rigidBody', 'showMotion', 0),
        trail: compiledParam(pageId, obj.id, 'rigidBody', 'showTrail', 0),
        forcesOn: compiledParam(pageId, obj.id, 'rigidBody', 'showForces', 0),
        trailPts: [],
        prevV: { x: 0, y: 0 },
        prevW: 0,
      })
    }
    if (kind === 'dynamic' && obj.behaviors.some((b) => b.enabled && b.type === 'charge')) {
      charges.push({ body, q: compiledParam(pageId, obj.id, 'charge', 'q', 1) })
    }
    if (obj.behaviors.some((b) => b.enabled && b.type === 'heatSource')) {
      const initT = (() => {
        const v = obj.behaviors.find((b) => b.type === 'heatSource')?.params.tempInit
        return v?.kind === 'number' && Number.isFinite(v.value) ? v.value : 20
      })()
      thermal.push({
        objectId: obj.id,
        body,
        power: compiledParam(pageId, obj.id, 'heatSource', 'power', 10),
        conductivity: compiledParam(pageId, obj.id, 'heatSource', 'conductivity', 5),
        coolRate: compiledParam(pageId, obj.id, 'heatSource', 'coolRate', 0.05),
        temp: initT,
      })
    }
  }

  // Field regions aren't bodies — they're zones a charge's center can be
  // inside of. Position/size are read live each frame (see applyFieldForces).
  for (const obj of objs) {
    if (obj.behaviors.some((b) => b.enabled && b.type === 'efield')) {
      fields.push({
        kind: 'e',
        objectId: obj.id,
        Ex: compiledParam(pageId, obj.id, 'efield', 'Ex', 0),
        Ey: compiledParam(pageId, obj.id, 'efield', 'Ey', 100),
      })
    }
    if (obj.behaviors.some((b) => b.enabled && b.type === 'bfield')) {
      fields.push({ kind: 'b', objectId: obj.id, Bz: compiledParam(pageId, obj.id, 'bfield', 'Bz', 1) })
    }
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
      // Rope starts taut (its drawn length IS its max length); whether it
      // stays taut or goes slack from here is decided live, every frame,
      // in applyLiveParams — a fixed stiffness here would just make it a
      // softer rod, which was exactly the bug.
      const stiffnessFor = (type: string) => (type === 'rod' || type === 'rope' ? 1 : 0.05)
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
        isRope: conn.type === 'rope',
      })
    }

    // A Reference Point sticks to whatever body is under it, at that exact
    // point, and is then free to spin — a hinge, in other words. Because it is
    // itself a (massless, non-colliding) body, it streams x/y/vx/vy like any
    // other, so you can graph it or trail it and watch one material point of a
    // multi-body linkage move.
    if (obj.metadata.render === 'reference-point') {
      const self = bodies.find((b) => b.objectId === obj.id)?.body
      const c = bodyCenter(obj)
      const host = Matter.Query.point(allBodies, c).find((b) => b !== self)
      if (self && host) {
        const constraint = Matter.Constraint.create({
          bodyA: host,
          bodyB: self,
          pointA: { x: c.x - host.position.x, y: c.y - host.position.y },
          pointB: { x: 0, y: 0 },
          length: 0,
          stiffness: 1,
        })
        Matter.Composite.add(engine.world, constraint)
        connectors.push({ objectId: obj.id, constraint, rest0: 0 })
      }
      continue // never also act as a hinge
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

        const torsion = obj.behaviors.find((bh) => bh.enabled && bh.type === 'torsionSpring')
        if (torsion) {
          torsions.push({
            body: a,
            angle0: a.angle,
            k: compiledParam(pageId, obj.id, 'torsionSpring', 'k', 5),
            restAngle: compiledParam(pageId, obj.id, 'torsionSpring', 'restAngle', 0),
          })
        }
      }
    }
  }

  // The boundary is ABSOLUTE: four static walls just outside the box mean
  // nothing inside can ever leave it, whatever the forces.
  if (scope) {
    const T = 200 // thick, so a fast body can't tunnel through in one step
    const { x, y } = scope.position
    const { w: sw, h: sh } = scope.size
    const wall = (cx: number, cy: number, ww: number, wh: number) =>
      Matter.Bodies.rectangle(cx, cy, ww, wh, {
        isStatic: true,
        restitution: 0.35,
        friction: 0.3,
        label: 'system-wall',
      })
    Matter.Composite.add(engine.world, [
      wall(x + sw / 2, y - T / 2, sw + 2 * T, T), // top
      wall(x + sw / 2, y + sh + T / 2, sw + 2 * T, T), // bottom
      wall(x - T / 2, y + sh / 2, T, sh + 2 * T), // left
      wall(x + sw + T / 2, y + sh / 2, T, sh + 2 * T), // right
    ])
  }

  const circuit = buildCircuit(objs)
  const w: World = {
    pageId,
    scopeId,
    engine,
    bodies,
    tracers,
    connectors,
    charges,
    fields,
    torsions,
    thermal,
    circuit,
    t: 0,
    raf: null,
    last: 0,
    acc: 0,
  }

  // Pressure plates: a rigid body touching one closes it like a switch,
  // detected via real Matter.js collisions (it's a genuine static body —
  // see makeBody's 'symbol' case above — not just a position heuristic).
  const plateIds = new Set(circuit?.comps.filter((c) => c.symbol === 'pressure-plate').map((c) => c.id) ?? [])
  if (plateIds.size > 0) {
    const onTouch = (pressed: boolean) => (event: Matter.IEventCollision<Matter.Engine>) => {
      if (!w.circuit) return
      for (const pair of event.pairs) {
        for (const [plateBody, otherBody] of [
          [pair.bodyA, pair.bodyB],
          [pair.bodyB, pair.bodyA],
        ] as const) {
          if (otherBody.isStatic) continue
          const entry = w.bodies.find((b) => b.body === plateBody)
          if (!entry || !plateIds.has(entry.objectId)) continue
          const comp = w.circuit.comps.find((cc) => cc.id === entry.objectId)
          if (!comp) continue
          comp.state.touchCount = Math.max(0, (comp.state.touchCount ?? 0) + (pressed ? 1 : -1))
          comp.state.pressed = comp.state.touchCount > 0 ? 1 : 0
        }
      }
    }
    Matter.Events.on(engine, 'collisionStart', onTouch(true))
    Matter.Events.on(engine, 'collisionEnd', onTouch(false))
  }

  // Accessible event log (UX masterplan §16 ADD): a screen-reader user has
  // no way to notice a collision that's currently only a visual flash on
  // the canvas. One line per newly-touching body pair — Matter only fires
  // collisionStart once contact begins, and pushEvent's own per-pair
  // cooldown covers the multi-contact-point / resolver-iteration case
  // within a single instant, so a resting body doesn't spam the log.
  Matter.Events.on(engine, 'collisionStart', (event: Matter.IEventCollision<Matter.Engine>) => {
    for (const pair of event.pairs) {
      const a = bodies.find((b) => b.body === pair.bodyA)
      const b = bodies.find((b) => b.body === pair.bodyB)
      if (!a || !b) continue
      const nameA = page?.objects[a.objectId]?.name ?? 'Object'
      const nameB = page?.objects[b.objectId]?.name ?? 'Object'
      const pairKey = [a.objectId, b.objectId].sort().join(':')
      pushEvent(pageId, w.t, `${nameA} collided with ${nameB} at t=${w.t.toFixed(2)}s`, pairKey)
    }
  })

  return w
}

// Pedagogical force scales — tunable via the live q/E/B params rather than
// SI-accurate, matching how spring k / gravity / motor speed are already
// calibrated in this engine for visible-but-controllable behavior.
const COULOMB_K = 8
const FORCE_SCALE = 1e-4
const BFIELD_SCALE = 1e-3

/** Net Coulomb + field (E/B) force on one charged body, in the same raw
 * pedagogical units as applyChargeForces — before FORCE_SCALE/BFIELD_SCALE —
 * so tracer arrows can apply their own visual scale. Read-only: no mutation. */
function chargeForceOn(w: World, body: Matter.Body, q: number, frameScope: Scope): { x: number; y: number } {
  let fx = 0
  let fy = 0
  for (const other of w.charges) {
    if (other.body === body) continue
    const oq = other.q(frameScope)
    const dx = (body.position.x - other.body.position.x) / PPM
    const dy = (body.position.y - other.body.position.y) / PPM
    const r2 = Math.max(dx * dx + dy * dy, 0.01)
    const r = Math.sqrt(r2)
    const F = (COULOMB_K * q * oq) / r2
    fx += (F * dx) / r
    fy += (F * dy) / r
  }
  if (w.fields.length > 0) {
    const pageObjs = useDocStore.getState().pages[w.pageId]?.objects ?? {}
    for (const f of w.fields) {
      const region = pageObjs[f.objectId]
      if (!region) continue
      const p = body.position
      if (
        p.x < region.position.x ||
        p.x > region.position.x + region.size.w ||
        p.y < region.position.y ||
        p.y > region.position.y + region.size.h
      )
        continue
      if (f.kind === 'e' && f.Ex && f.Ey) {
        fx += q * f.Ex(frameScope)
        fy += -q * f.Ey(frameScope)
      } else if (f.kind === 'b' && f.Bz) {
        const Bz = f.Bz(frameScope)
        fx += q * -body.velocity.y * Bz
        fy += q * body.velocity.x * Bz
      }
    }
  }
  return { x: fx, y: fy }
}

function applyChargeForces(w: World, frameScope: Scope) {
  if (w.charges.length === 0 && w.fields.length === 0) return
  const qs = w.charges.map((c) => ({ c, q: c.q(frameScope) }))

  // Coulomb pairs: like charges repel, opposite attract.
  for (let i = 0; i < qs.length; i++) {
    for (let j = i + 1; j < qs.length; j++) {
      const a = qs[i]
      const b = qs[j]
      const dx = (b.c.body.position.x - a.c.body.position.x) / PPM
      const dy = (b.c.body.position.y - a.c.body.position.y) / PPM
      const r2 = Math.max(dx * dx + dy * dy, 0.01)
      const r = Math.sqrt(r2)
      const F = (COULOMB_K * a.q * b.q) / r2
      const fx = ((F * dx) / r) * FORCE_SCALE
      const fy = ((F * dy) / r) * FORCE_SCALE
      Matter.Body.applyForce(a.c.body, a.c.body.position, { x: -fx, y: -fy })
      Matter.Body.applyForce(b.c.body, b.c.body.position, { x: fx, y: fy })
    }
  }

  if (w.fields.length === 0 || qs.length === 0) return
  const pageObjs = useDocStore.getState().pages[w.pageId]?.objects ?? {}
  for (const f of w.fields) {
    const region = pageObjs[f.objectId]
    if (!region) continue
    const x0 = region.position.x
    const y0 = region.position.y
    const x1 = x0 + region.size.w
    const y1 = y0 + region.size.h
    for (const { c, q } of qs) {
      const p = c.body.position
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue
      if (f.kind === 'e' && f.Ex && f.Ey) {
        const Ex = f.Ex(frameScope)
        const Ey = f.Ey(frameScope)
        Matter.Body.applyForce(c.body, p, { x: q * Ex * FORCE_SCALE, y: -q * Ey * FORCE_SCALE })
      } else if (f.kind === 'b' && f.Bz) {
        const Bz = f.Bz(frameScope)
        // Lorentz force F = q·v×B with B = (0,0,Bz) out of the page, converted
        // through the same screen/physical Y-flip the rest of the engine uses.
        const vx = c.body.velocity.x
        const vy = c.body.velocity.y
        Matter.Body.applyForce(c.body, p, {
          x: q * -vy * Bz * BFIELD_SCALE,
          y: q * vx * Bz * BFIELD_SCALE,
        })
      }
    }
  }
}

function applyTorsionSprings(w: World, frameScope: Scope, dtSeconds: number) {
  for (const th of w.torsions) {
    const k = Math.max(th.k(frameScope), 0)
    const restRad = th.angle0 + (th.restAngle(frameScope) * Math.PI) / 180
    const diff = th.body.angle - restRad
    const angAccel = (-k * diff) / Math.max(th.body.inertia, 1e-6)
    Matter.Body.setAngularVelocity(th.body, th.body.angularVelocity + angAccel * dtSeconds)
  }
}

function stepThermal(w: World, frameScope: Scope, dtSeconds: number) {
  if (w.thermal.length === 0) return
  const ambient = typeof frameScope.ambient === 'number' ? frameScope.ambient : 20
  const byBody = new Map(w.thermal.map((t) => [t.body, t]))
  const netQ = new Map<ThermalEntry, number>()

  // Conduction: Fourier's law between bodies Matter currently reports as
  // touching — reuses the collision system already running for contacts.
  const pairs = (w.engine.pairs as unknown as { list: Matter.Pair[] } | null)?.list ?? []
  for (const pair of pairs) {
    if (!pair.isActive) continue
    const ta = byBody.get(pair.bodyA)
    const tb = byBody.get(pair.bodyB)
    if (!ta || !tb) continue
    const k = (ta.conductivity(frameScope) + tb.conductivity(frameScope)) / 2
    const q = k * (ta.temp - tb.temp)
    netQ.set(ta, (netQ.get(ta) ?? 0) - q)
    netQ.set(tb, (netQ.get(tb) ?? 0) + q)
  }

  for (const t of w.thermal) {
    const power = t.power(frameScope)
    const cooling = Math.max(t.coolRate(frameScope), 0) * (t.temp - ambient)
    t.temp += (power - cooling + (netQ.get(t) ?? 0)) * dtSeconds
  }
}

// Electric Motor / 3-Phase Induction Motor: same "hinge pins whatever's
// touching it" mechanism as a plain Hinge (see the hinge loop in
// buildWorld, which already pushed a point constraint into w.connectors for
// any of these that has something to pin) — the only new thing is driving
// that pin's angular velocity from the circuit's own electrically-computed
// omega instead of a fixed speed expression. Runs right after stepCircuit
// so the body carries this step's freshly-computed omega into the next one.
const ELECTRIC_MOTOR_SYMBOLS = new Set(['dc-machine', 'induction-motor'])

function syncElectricMotors(w: World) {
  if (!w.circuit) return
  for (const comp of w.circuit.comps) {
    if (!ELECTRIC_MOTOR_SYMBOLS.has(comp.symbol)) continue
    const hinge = w.connectors.find((c) => c.objectId === comp.id)
    const spun = hinge?.constraint.bodyA
    if (!spun) continue // no hinge behavior on this motor, or nothing pinned to it
    Matter.Body.setAngularVelocity(spun, (comp.state.omega ?? 0) / 60)
  }
}

function applyLiveParams(w: World, scope: Scope, dtMs: number) {
  // gravity: page variable g (m/s²) relative to Earth default
  const g = typeof scope.g === 'number' ? scope.g : 9.81
  w.engine.gravity.y = g / 9.81

  // air resistance: page variable `drag` (Matter's frictionAir, 0 = vacuum)
  const drag = typeof scope.drag === 'number' ? Math.max(0, scope.drag) : 0.01
  for (const b of w.bodies) if (!b.body.isStatic) b.body.frictionAir = drag

  const frameScope = { ...scope, t: w.t }
  for (const c of w.connectors) {
    if (c.k) {
      const k = Math.max(c.k(frameScope), 0)
      c.constraint.stiffness = Math.min(0.999, Math.max(0.0005, k / (k + 400)))
    }
    if (c.damping) c.constraint.damping = Math.min(0.5, Math.max(0, c.damping(frameScope)))
    if (c.restScale) c.constraint.length = c.rest0 * Math.max(c.restScale(frameScope), 0.01)
    if (c.isRope) {
      // A rope only resists being STRETCHED past its length — closer than
      // that, it must go slack (no pull at all), unlike a rod/spring which
      // always fights to hold one exact distance. Recomputed every step
      // since "closer or farther than rest0" changes as the bodies move.
      const { bodyA, bodyB, pointA, pointB } = c.constraint
      const wa = bodyA ? { x: bodyA.position.x + pointA.x, y: bodyA.position.y + pointA.y } : pointA
      const wb = bodyB ? { x: bodyB.position.x + pointB.x, y: bodyB.position.y + pointB.y } : pointB
      const dist = Math.hypot(wb.x - wa.x, wb.y - wa.y)
      if (dist <= c.rest0) {
        c.constraint.length = dist
        c.constraint.stiffness = 0.0005 // effectively inert while slack
      } else {
        c.constraint.length = c.rest0
        c.constraint.stiffness = 1
      }
    }
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
  applyChargeForces(w, frameScope)
  applyTorsionSprings(w, frameScope, dtMs / 1000)
  stepThermal(w, frameScope, dtMs / 1000)
}

// ── Tracers: per-body motion vectors, path trail, force arrows ─────────────
// Drawn on one imperative SVG overlay (page coordinates, same parent as the
// object wrappers) so React never repaints during Play. All three are opt-in
// per body via rigidBody params showMotion/showTrail/showForces (default 0).

let tracerOverlay: SVGSVGElement | null = null

function ensureTracerOverlay(w: World): SVGSVGElement | null {
  if (tracerOverlay && tracerOverlay.isConnected) return tracerOverlay
  let host: HTMLElement | null = null
  for (const t of w.tracers) {
    const el = elements.get(t.objectId)
    if (el?.parentElement) {
      host = el.parentElement
      break
    }
  }
  if (!host) return null
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  // A width/height of exactly 0 on the root <svg> disables rendering of the
  // whole element per spec, regardless of overflow:visible — use 1px like
  // the other imperative overlays in this app (guides/stroke in canvas.tsx).
  svg.setAttribute('width', '1')
  svg.setAttribute('height', '1')
  svg.style.position = 'absolute'
  svg.style.left = '0'
  svg.style.top = '0'
  svg.style.overflow = 'visible'
  svg.style.pointerEvents = 'none'
  svg.style.zIndex = '999999'
  host.appendChild(svg)
  tracerOverlay = svg
  return svg
}

function removeTracerOverlay() {
  tracerOverlay?.remove()
  tracerOverlay = null
}

function arrowSvg(x: number, y: number, dx: number, dy: number, color: string, label: string): string {
  const len = Math.hypot(dx, dy)
  if (len < 3) return ''
  const ux = dx / len
  const uy = dy / len
  const hx = x + dx
  const hy = y + dy
  const px = -uy
  const py = ux
  return (
    `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="${color}" stroke-width="2"/>` +
    `<path d="M ${hx.toFixed(1)} ${hy.toFixed(1)} L ${(hx - ux * 8 + px * 4).toFixed(1)} ${(hy - uy * 8 + py * 4).toFixed(1)} L ${(hx - ux * 8 - px * 4).toFixed(1)} ${(hy - uy * 8 - py * 4).toFixed(1)} Z" fill="${color}"/>` +
    (label
      ? `<text x="${(hx + ux * 6 + px * 4).toFixed(1)}" y="${(hy + uy * 6 + py * 4).toFixed(1)}" fill="${color}" font-size="10" font-family="monospace">${label}</text>`
      : '')
  )
}

/** Curved arrow around a body centre — spin/torque direction indicator. */
function arcArrowSvg(x: number, y: number, r: number, cw: boolean, color: string, label: string): string {
  const a0 = -Math.PI * 0.75 // start upper-left, sweep ~210°
  const a1 = a0 + Math.PI * 1.17 * (cw ? 1 : -1)
  const sx = x + r * Math.cos(a0)
  const sy = y + r * Math.sin(a0)
  const ex = x + r * Math.cos(a1)
  const ey = y + r * Math.sin(a1)
  const dir = cw ? 1 : -1
  const tx = -Math.sin(a1) * dir
  const ty = Math.cos(a1) * dir
  const px = -ty
  const py = tx
  return (
    `<path d="M ${sx.toFixed(1)} ${sy.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 1 ${cw ? 1 : 0} ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="${color}" stroke-width="2" opacity="0.85"/>` +
    `<path d="M ${(ex + tx * 9).toFixed(1)} ${(ey + ty * 9).toFixed(1)} L ${(ex + px * 4).toFixed(1)} ${(ey + py * 4).toFixed(1)} L ${(ex - px * 4).toFixed(1)} ${(ey - py * 4).toFixed(1)} Z" fill="${color}"/>` +
    (label
      ? `<text x="${(x + r * 0.3).toFixed(1)}" y="${(y - r - 7).toFixed(1)}" fill="${color}" font-size="10" font-family="monospace">${label}</text>`
      : '')
  )
}

// Clamp an arrow to a sane on-screen length while keeping direction.
function scaled(dx: number, dy: number, scale: number, maxLen: number): { x: number; y: number } {
  let x = dx * scale
  let y = dy * scale
  const len = Math.hypot(x, y)
  if (len > maxLen) {
    x = (x / len) * maxLen
    y = (y / len) * maxLen
  }
  return { x, y }
}

const TRAIL_MAX = 900

function syncTracers(w: World, scope: Scope, dtSeconds: number) {
  const active = w.tracers.some(
    (t) => t.motion(scope) > 0 || t.trail(scope) > 0 || t.forcesOn(scope) > 0
  )
  const svg = active ? ensureTracerOverlay(w) : tracerOverlay
  if (!svg) return
  if (!active) {
    svg.innerHTML = ''
    return
  }
  const frameScope = { ...scope, t: w.t }
  const g = typeof scope.g === 'number' ? scope.g : 9.81
  let html = ''

  for (const t of w.tracers) {
    const { x, y } = t.body.position
    const v = t.body.velocity // px per engine step
    const vps = { x: v.x * 60, y: v.y * 60 } // ≈ px/s for display
    const a = dtSeconds > 0 ? { x: (v.x - t.prevV.x) * 60 / dtSeconds, y: (v.y - t.prevV.y) * 60 / dtSeconds } : { x: 0, y: 0 }
    t.prevV = { x: v.x, y: v.y }
    const omega = t.body.angularVelocity * 60 // ≈ rad/s for display
    const alpha = dtSeconds > 0 ? ((t.body.angularVelocity - t.prevW) * 60) / dtSeconds : 0
    t.prevW = t.body.angularVelocity

    // (b) path trail
    if (t.trail(frameScope) > 0) {
      const last = t.trailPts[t.trailPts.length - 1]
      if (!last || Math.hypot(x - last[0], y - last[1]) > 1.5) {
        t.trailPts.push([x, y])
        if (t.trailPts.length > TRAIL_MAX) t.trailPts.splice(0, t.trailPts.length - TRAIL_MAX)
      }
      if (t.trailPts.length > 1) {
        html += `<polyline points="${t.trailPts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}" fill="none" stroke="var(--accent-mint)" stroke-width="1.5" opacity="0.55" stroke-dasharray="4 3"/>`
      }
    } else if (t.trailPts.length) {
      t.trailPts.length = 0
    }

    // (a) motion vectors: velocity + acceleration, magnitude labels
    if (t.motion(frameScope) > 0) {
      const speed = Math.hypot(vps.x, vps.y)
      if (speed > 2) {
        const dv = scaled(vps.x, vps.y, 0.35, 110)
        html += arrowSvg(
          x,
          y,
          dv.x,
          dv.y,
          'var(--accent-mint)',
          `v ${(speed / PX_PER_CM).toFixed(1)}cm/s`
        )
      }
      const amag = Math.hypot(a.x, a.y)
      if (amag > 5) {
        const da = scaled(a.x, a.y, 0.04, 90)
        html += arrowSvg(
          x,
          y,
          da.x,
          da.y,
          'var(--accent-violet)',
          `a ${(amag / PX_PER_CM).toFixed(1)}cm/s²`
        )
      }
    }

    // (c) all forces acting on the body
    if (t.forcesOn(frameScope) > 0) {
      const be = w.bodies.find((b) => b.body === t.body)
      const m = t.body.mass
      // weight
      html += arrowSvg(x, y, 0, Math.min(30 + m * g, 100), 'var(--accent-rose)', `W ${(m * g).toFixed(1)}N`)
      // applied force behavior
      for (const f of be?.forces ?? []) {
        const fx = f.fx(frameScope)
        const fy = -f.fy(frameScope)
        if (Math.hypot(fx, fy) > 0.01) {
          const df = scaled(fx, fy, 3, 110)
          html += arrowSvg(x, y, df.x, df.y, 'var(--accent-amber)', `F ${Math.hypot(fx, f.fy(frameScope)).toFixed(1)}N`)
        }
      }
      // connector (spring/rope/rod) tension along the constraint
      for (const c of w.connectors) {
        const { constraint } = c
        if (constraint.bodyA !== t.body && constraint.bodyB !== t.body) continue
        const pa = constraint.bodyA ? Matter.Constraint.pointAWorld(constraint) : (constraint.pointA as Matter.Vector)
        const pb = constraint.bodyB ? Matter.Constraint.pointBWorld(constraint) : (constraint.pointB as Matter.Vector)
        const other = constraint.bodyA === t.body ? pb : pa
        const dx = other.x - x
        const dy = other.y - y
        const len = Math.hypot(dx, dy) || 1
        const stretch = len - constraint.length
        const k = c.k ? c.k(frameScope) : 0
        const mag = k > 0 ? Math.abs(k * stretch) : 0
        // spring pulls toward the other end when stretched, pushes when compressed
        const sign = stretch >= 0 ? 1 : -1
        const dT = scaled((dx / len) * sign, (dy / len) * sign, Math.min(20 + mag * 0.2, 90), 90)
        html += arrowSvg(x, y, dT.x, dT.y, 'var(--accent-blue)', mag > 0 ? `T ${mag.toFixed(1)}N` : 'T')
      }
      // electric/magnetic force (charge behavior in E-field/B-field regions,
      // plus Coulomb interaction with every other charged body)
      const chg = w.charges.find((c) => c.body === t.body)
      if (chg) {
        const q = chg.q(frameScope)
        const cf = chargeForceOn(w, t.body, q, frameScope)
        const mag = Math.hypot(cf.x, cf.y)
        if (mag > 0.02) {
          const dc = scaled(cf.x, cf.y, 10, 100)
          html += arrowSvg(x, y, dc.x, dc.y, 'var(--accent-violet)', `Fe ${mag.toFixed(1)}N`)
        }
      }
      // contact normals from active collision pairs
      for (const pair of w.engine.pairs.list) {
        if (!pair.isActive) continue
        if (pair.bodyA !== t.body && pair.bodyB !== t.body) continue
        const n = pair.collision.normal
        const s = pair.bodyA === t.body ? -1 : 1
        html += arrowSvg(x, y, n.x * 45 * s, n.y * 45 * s, 'var(--muted-foreground)', 'N')
      }
      // drag (air resistance) opposes motion
      const speed = Math.hypot(vps.x, vps.y)
      if (t.body.frictionAir > 0.001 && speed > 20) {
        const dd = scaled(-vps.x, -vps.y, 0.15, 60)
        html += arrowSvg(x, y, dd.x, dd.y, 'var(--foreground)', 'drag')
      }
      // rotational: net torque (τ = I·α) — or bare spin ω when coasting —
      // drawn as a curved arrow whose sweep matches the turn direction
      // (Matter's +angle is clockwise on screen).
      const tau = Number.isFinite(t.body.inertia) ? t.body.inertia * alpha : 0
      const hasTau = Math.abs(tau) > 0.5
      if (hasTau || Math.abs(omega) > 0.05) {
        const bb = t.body.bounds
        const r = Math.min(64, Math.max(20, 0.42 * Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y)))
        const cwDir = (hasTau ? tau : omega) > 0
        const label = hasTau ? `τ ${tau.toFixed(1)}N·m` : `ω ${omega.toFixed(2)}rad/s`
        html += arcArrowSvg(x, y, r, cwDir, 'var(--accent-amber)', label)
      }
    }
  }
  svg.innerHTML = html
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
  for (const th of w.thermal) {
    const el = elements.get(th.objectId)
    const tint = el?.querySelector<SVGElement>('[data-heat]')
    if (!tint) continue
    // Blue (cold) → red (hot) around a ±40°C band centered on ambient.
    const frac = Math.max(-1, Math.min(1, (th.temp - 20) / 40))
    tint.style.opacity = String(Math.min(0.75, Math.abs(frac) * 0.75))
    tint.style.fill = frac >= 0 ? 'var(--accent-rose)' : 'var(--accent-blue)'
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
    moveEndpointDots(el, a.x - obj.position.x, a.y - obj.position.y, bPt.x - obj.position.x, bPt.y - obj.position.y)
  }
}

// Attachment dots ride along with the constraint endpoints (same DOM-mutation
// path as the connector `d` above — React never repaints these during Play).
function moveEndpointDots(el: HTMLElement, ax: number, ay: number, bx: number, by: number) {
  const dotA = el.querySelector<SVGCircleElement>('circle[data-endpoint="a"]')
  const dotB = el.querySelector<SVGCircleElement>('circle[data-endpoint="b"]')
  if (dotA) {
    dotA.setAttribute('cx', String(ax))
    dotA.setAttribute('cy', String(ay))
  }
  if (dotB) {
    dotB.setAttribute('cx', String(bx))
    dotB.setAttribute('cy', String(by))
  }
}

// Circuit results → DOM, outside React (flow dashes, readouts, pins, glow).
function syncCircuitDom(w: World) {
  const c = w.circuit
  if (!c) return
  for (const comp of c.comps) {
    if (comp.symbol !== 'dc-machine' && comp.symbol !== 'induction-motor') continue
    const el = elements.get(comp.id)
    const spin = el?.querySelector<SVGElement>('[data-spin]')
    if (spin) spin.style.transform = `rotate(${comp.state.angle ?? 0}rad)`
  }
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
  const thermalByObj = new Map(w.thermal.map((t) => [t.objectId, t]))
  for (const b of w.bodies) {
    if (b.body.isStatic) continue
    const v = b.body.velocity // px per 60Hz frame
    const channels: Record<string, number> = {
      // Lengths in centimetres — the page's unit.
      x: b.body.position.x / PX_PER_CM,
      y: -b.body.position.y / PX_PER_CM,
      vx: (v.x * 60) / PX_PER_CM,
      vy: (-v.y * 60) / PX_PER_CM,
      speed: (Math.hypot(v.x, v.y) * 60) / PX_PER_CM,
      angle: b.body.angle,
      omega: b.body.angularVelocity * 60,
      // Energy is a joule, which is defined in metres — not cm.
      ke: 0.5 * b.body.mass * ((Math.hypot(v.x, v.y) * 60) / PPM) ** 2,
    }
    const th = thermalByObj.get(b.objectId)
    if (th) {
      channels.temp = th.temp
      thermalByObj.delete(b.objectId) // handled — don't double-push below
    }
    pushSample(b.objectId, { t: w.t, channels })
    notify(b.objectId)
  }
  // Static bodies (heat sinks/reservoirs) carry temperature but no motion —
  // stream just the temp channel for them.
  for (const th of thermalByObj.values()) {
    pushSample(th.objectId, { t: w.t, channels: { temp: th.temp } })
    notify(th.objectId)
  }
}

let timeUpdateAt = 0

let lastLiveRefresh = 0

function frame(now: number) {
  if (!world) return
  const w = world
  const elapsed = Math.min(now - w.last, 100)
  w.last = now
  w.acc += elapsed

  const docState = useDocStore.getState()
  const scope = docState.scopes[w.pageId] ?? {}
  const pageObjects = docState.pages[w.pageId]?.objects ?? {}
  // `timeScale` variable: slow-motion / fast-forward without losing accuracy
  const ts = Math.min(5, Math.max(0, typeof scope.timeScale === 'number' ? scope.timeScale : 1))
  let stepped = false
  if (ts > 0 && w.acc >= STEP) pushHistory(w)
  while (w.acc >= STEP) {
    if (ts > 0) {
      applyLiveParams(w, scope, STEP * ts)
      Matter.Engine.update(w.engine, STEP * ts)
      if (w.circuit) {
        stepCircuit(w.circuit, (STEP / 1000) * ts, w.t, pageObjects)
        syncElectricMotors(w)
      }
      w.t += (STEP / 1000) * ts
      stepped = true
    }
    w.acc -= STEP
  }
  if (stepped) {
    syncDom(w)
    // Live variables: [Object(channel)] refs re-solve at ~5 Hz during Play.
    if (now - lastLiveRefresh > 200) {
      lastLiveRefresh = now
      useDocStore.getState().refreshLive(w.pageId)
    }
    syncTracers(w, scope, (elapsed / 1000) * ts)
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

export function play(pageId: string, scopeId: string | null = null) {
  const rt = useRuntimeStore.getState()
  // Resume only if it's the SAME run — switching scope rebuilds the world.
  if (rt.mode === 'paused' && world && world.pageId === pageId && world.scopeId === scopeId) {
    world.last = performance.now()
    world.acc = 0
    world.raf = requestAnimationFrame(frame)
    rt.setMode('running')
    return
  }
  stop() // clean previous world if any
  rt.setScope(scopeId)
  world = buildWorld(pageId, scopeId)
  for (const b of world.bodies) clearBuffer(b.objectId)
  for (const comp of world.circuit?.comps ?? []) clearBuffer(comp.id)
  clearEvents(pageId)
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
  pushHistory(world)
  // one display frame = two 120 Hz physics steps
  for (let i = 0; i < 2; i++) {
    applyLiveParams(world, scope, STEP)
    Matter.Engine.update(world.engine, STEP)
    if (world.circuit) stepCircuit(world.circuit, STEP / 1000, world.t, pageObjects)
    world.t += STEP / 1000
  }
  syncDom(world)
  syncTracers(world, scope, (2 * STEP) / 1000)
  syncCircuitDom(world)
  sample(world)
  useRuntimeStore.getState().setTime(world.t)
}

/** Undo one Step (or one Played display frame) — restores the exact
 * pre-step snapshot rather than integrating backward (Matter.js can't). */
export function stepBack() {
  if (!world) return
  const snap = history.pop()
  if (!snap) return
  if (useRuntimeStore.getState().mode === 'running') pause()
  restoreSnapshot(world, snap)
  const scope = useDocStore.getState().scopes[world.pageId] ?? {}
  syncDom(world)
  syncTracers(world, scope, STEP / 1000)
  syncCircuitDom(world)
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
      if (el) moveEndpointDots(el, a[0], a[1], b[0], b[1])
    }
    world = null
  }
  history = []
  removeTracerOverlay()
  for (const el of elements.values()) {
    el.style.transform = ''
    const tint = el.querySelector<SVGElement>('[data-heat]')
    if (tint) tint.style.opacity = '0'
  }
  resetCircuitDom()
  useRuntimeStore.getState().setMode('edit')
  useRuntimeStore.getState().setScope(null)
  useRuntimeStore.getState().setTime(0)
}
