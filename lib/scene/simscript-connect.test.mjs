// connect() end-to-end — drives the REAL executeSimScript, not a copy of its math.
// Run: node --test lib/scene/simscript-connect.test.mjs
//
// The sibling simscript-mechconnect.test.mjs pins moveEndpoint's geometry by
// mirroring it. That catches math regressions but not wiring ones: it stayed
// green while connect() left endpoints behind. This file bundles simscript.ts
// against a stub store and asserts the contract buildWorld actually reads —
// "is there a body under this endpoint" — plus a real Matter run.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Matter from 'matter-js'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simscript-connect-'))
const stub = join(dir, 'stub-store.mjs')
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'sim.mjs')

// The doc store is a browser/Zustand module; connect() only needs get/add/update.
writeFileSync(stub, `
let pages = { p: { objects: {} } }
export const useDocStore = {
  getState: () => ({
    pages,
    addObject(pageId, obj) { (pages[pageId] ??= { objects: {} }).objects[obj.id] = obj },
    updateObject(pageId, id, patch) {
      const cur = pages[pageId]?.objects?.[id]
      if (cur) pages[pageId].objects[id] = { ...cur, ...patch }
    },
    ensurePage() {},
    upsertVariable(pageId, name, expr) {
      const vars = (pages[pageId].variables ??= [])
      const existing = vars.find((v) => v.name === name)
      if (existing) existing.expr = expr
      else vars.push({ id: name, name, expr, value: 0 })
    },
  }),
  setState: (fn) => { if (typeof fn === 'function') { const r = fn({ pages }); if (r?.pages) for (const k of Object.keys(r.pages)) pages[k] = r.pages[k] } },
  __reset: () => { pages = { p: { objects: {} } } },
  __objects: () => Object.values(pages.p?.objects ?? {}),
}
`)
// Re-export the store THROUGH the bundle: esbuild inlines the stub, so importing
// it separately would hand the test a second, unrelated module instance.
writeFileSync(entry, `
export { executeSimScript } from '@/lib/scene/simscript'
export { useDocStore } from '@/lib/store/document'
`)
// applySceneLayout reads the page frame from the workspace store. Stub it:
// these tests run headless with no DOM, and the real module pulls in zustand.
const wsStub = join(dir, 'ws-stub.ts')
writeFileSync(wsStub, `
export const findPageMeta = () => undefined
export const useWorkspaceStore = { getState: () => ({ nodes: {} }) }
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@/lib/store/document=${stub}`, `--alias:@=${root}`,
  '--external:react', '--external:zustand'], { cwd: root, stdio: 'pipe' })

const { executeSimScript, useDocStore } = await import(bundle)

// endpointWorld + bodyCenter, verbatim from lib/physics/world.ts (354 / 231).
const endpointWorld = (o, i) => {
  const pts = o.geometry.points ?? [[0, 0], [o.size.w, 0]]
  const p = i === 0 ? pts[0] : pts[pts.length - 1]
  return { x: o.position.x + p[0], y: o.position.y + p[1] }
}
const bodyCenter = (o) => ({ x: o.position.x + o.size.w / 2, y: o.position.y + o.size.h / 2 })
const isBody = (o) => o.behaviors.some((b) => b.enabled && (b.type === 'rigidBody' || b.type === 'staticBody'))

const run = (src) => {
  useDocStore.__reset()
  executeSimScript('p', src, { x: 0, y: 0 })
  const objs = useDocStore.__objects()
  return {
    objs,
    connector: (type = 'rod') => objs.find((o) => o.behaviors.some((b) => b.type === type)),
    named: (n) => objs.find((o) => o.name === n),
  }
}

test('connect() then move: the endpoint follows the body', () => {
  // The regression: connect() stamped the endpoint at the bob's centre at call
  // time, then .set() moved the bob out from under it, leaving the solver a
  // constraint attached to empty space.
  const { connector, objs } = run(`
    b = create("mass")
    r = create("rod", { length: 150 })
    connect(r.b, b.centre)
    b.set({ x: 400, y: 400 })
  `)
  const bob = objs.find(isBody)
  assert.deepEqual(endpointWorld(connector(), 1), bodyCenter(bob),
    'endpoint must be re-stamped after the body moved, or Query.point finds nothing')
})

test('both endpoints bind, and only the named end moves', () => {
  const { connector, objs } = run(`
    pivot = create("hinge", { x: 300, y: 120 })
    bob = create("mass", { x: 300, y: 340, mass: 1 })
    rod = create("rod", { length: 220 })
    connect(rod.a, pivot.centre)
    connect(rod.b, bob.centre)
  `)
  const rod = connector()
  const bob = objs.find((o) => isBody(o))
  const pivot = objs.find((o) => o.behaviors.some((b) => b.type === 'hinge'))
  assert.deepEqual(endpointWorld(rod, 0), bodyCenter(pivot), 'end a sits on the pivot')
  assert.deepEqual(endpointWorld(rod, 1), bodyCenter(bob), 'end b sits on the bob')
})

test('a body endpoint really is queryable by Matter', () => {
  const { connector, objs } = run(`
    g = create("ground", { x: 0, y: 500 })
    m = create("mass", { x: 100, y: 200 })
    s = create("spring", { length: 120 })
    connect(s.a, g.centre)
    connect(s.b, m.centre)
  `)
  const bodies = objs.filter(isBody).map((o) => {
    const c = bodyCenter(o)
    return Matter.Bodies.rectangle(c.x, c.y, o.size.w, o.size.h)
  })
  const spring = connector('spring')
  for (const i of [0, 1]) {
    assert.ok(Matter.Query.point(bodies, endpointWorld(spring, i)).length > 0,
      `spring endpoint ${i} must land inside a real body`)
  }
})

test('connect(a, b, "rod") builds a rod that swings rigidly', () => {
  // The corpus form the model is trained on. Asserts physics, not geometry:
  // the bob must actually swing, and the rod must not stretch.
  const { connector, objs } = run(`
    var pivot = create("hinge", { x: 300, y: 120 });
    var bob = create("mass", { x: 300, y: 340, mass: 1 });
    connect(pivot.centre, bob.centre, "rod");
  `)
  const rod = connector()
  assert.ok(rod, 'connect() with type "rod" must create a real rod behavior, not a cosmetic wire')

  const engine = Matter.Engine.create()
  engine.gravity.y = 1
  const bobObj = objs.find(isBody)
  const c = bodyCenter(bobObj)
  const body = Matter.Bodies.circle(c.x, c.y, bobObj.size.w / 2)
  Matter.Composite.add(engine.world, body)

  const pA = endpointWorld(rod, 0)
  const pB = endpointWorld(rod, 1)
  const hitB = Matter.Query.point([body], pB)[0]
  assert.ok(hitB, 'the bob end must attach to the bob')
  const r0 = Math.hypot(pB.x - pA.x, pB.y - pA.y)
  Matter.Composite.add(engine.world, Matter.Constraint.create({
    bodyB: hitB,
    pointA: pA, // no body under the pivot: Matter pins it to this world point
    pointB: { x: pB.x - hitB.position.x, y: pB.y - hitB.position.y },
    length: r0, stiffness: 1, damping: 0.02,
  }))

  let minX = Infinity, maxX = -Infinity, rMin = Infinity, rMax = -Infinity
  for (let i = 0; i < 600; i++) {
    Matter.Engine.update(engine, 1000 / 60)
    minX = Math.min(minX, body.position.x)
    maxX = Math.max(maxX, body.position.x)
    const r = Math.hypot(body.position.x - pA.x, body.position.y - pA.y)
    rMin = Math.min(rMin, r); rMax = Math.max(rMax, r)
  }
  assert.ok(maxX - minX > 5, `pendulum must swing, x range was ${(maxX - minX).toFixed(1)}px`)
  assert.ok(rMax - rMin < 3, `a rod must stay rigid, length ranged ${rMin.toFixed(1)}–${rMax.toFixed(1)}`)
})

test('a pendulum plots a live swing, not a flat line', () => {
  // The corpus used to teach graph.plot(bob.angle). A round bob on a rod
  // swings through a wide arc WITHOUT ever spinning, so body.angle is 0.000
  // forever and the graph drew a dead horizontal line. `swing` is the angle
  // about the pivot — the quantity the question actually means.
  const { connector, objs } = run(`
    var pivot = create("hinge", { x: 300, y: 120 });
    var bob = create("mass", { x: 300, y: 340, mass: 1 });
    connect(pivot.centre, bob.centre, "rod");
    graph.plot(bob.swing);
  `)
  const graph = objs.find((o) => o.geometry.kind === 'graph')
  assert.match(graph.parameters.series.value, /:swing$/,
    '`swing` must resolve as a channel, not fall through to an anchor descriptor')

  // Now prove the channel actually moves, using world.ts's own definition.
  const rod = connector()
  const bobObj = objs.find(isBody)
  const c = bodyCenter(bobObj)
  const engine = Matter.Engine.create()
  engine.gravity.y = 1
  const body = Matter.Bodies.circle(c.x, c.y, bobObj.size.w / 2)
  Matter.Composite.add(engine.world, body)
  const pivot = endpointWorld(rod, 0)
  const pB = endpointWorld(rod, 1)
  Matter.Composite.add(engine.world, Matter.Constraint.create({
    bodyB: body,
    pointA: pivot,
    pointB: { x: pB.x - body.position.x, y: pB.y - body.position.y },
    length: Math.hypot(pB.x - pivot.x, pB.y - pivot.y),
    stiffness: 1, damping: 0.02,
  }))

  const swing = () => Math.atan2(body.position.x - pivot.x, body.position.y - pivot.y)
  let lo = Infinity, hi = -Infinity, spin = 0
  for (let i = 0; i < 300; i++) {
    Matter.Engine.update(engine, 1000 / 60)
    lo = Math.min(lo, swing()); hi = Math.max(hi, swing())
    spin = Math.max(spin, Math.abs(body.angle))
  }
  assert.ok(hi - lo > 0.05, `swing must vary, range was ${(hi - lo).toFixed(4)} rad`)
  assert.ok(spin < 0.05,
    'and body.angle must stay ~0 — that is exactly why plotting it was wrong')
})

test.after(() => rmSync(dir, { recursive: true, force: true }))
