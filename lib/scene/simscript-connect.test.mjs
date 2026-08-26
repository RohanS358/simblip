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
export { terminalsOf, terminalWorld } from '@/lib/circuit/engine'
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

const { executeSimScript, useDocStore, terminalsOf, terminalWorld } = await import(bundle)

// endpointWorld + bodyCenter, verbatim from lib/physics/world.ts (354 / 231).
const endpointWorld = (o, i) => {
  const pts = o.geometry.points ?? [[0, 0], [o.size.w, 0]]
  const p = i === 0 ? pts[0] : pts[pts.length - 1]
  return { x: o.position.x + p[0], y: o.position.y + p[1] }
}
const bodyCenter = (o) => ({ x: o.position.x + o.size.w / 2, y: o.position.y + o.size.h / 2 })
const isBody = (o) => o.behaviors.some((b) => b.enabled && (b.type === 'rigidBody' || b.type === 'staticBody'))

/** With a layout surface — the 4th argument the AI panel really passes
 *  (components/workspace/ai-panel.tsx), which is what turns the placement
 *  pass on. Without it the script's own coordinates just stand, so a bug in
 *  that pass is invisible to every test that omits it. */
const runPlaced = (src) => {
  useDocStore.__reset()
  executeSimScript('p', src, { x: 200, y: 100 }, {
    bounds: { left: 0, top: 0, right: 1200, bottom: 800 },
    fixedFrame: false,
  })
  const objs = useDocStore.__objects()
  return { objs, connector: (t = 'rod') => objs.find((o) => o.behaviors.some((b) => b.type === t)) }
}

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

test('a non-specific anchor takes a free end instead of always end 1', () => {
  // The reported bug. `.centre` is what the system prompt and the corpus both
  // give as THE anchor for a mechanics part, and endpointIndex mapped every
  // name outside its END0 list to `1` — so two `.centre` connects on one
  // connector bound end 1 twice and left end 0 on nothing. buildWorld then
  // pinned that side to a fixed world point (a null bodyA is a world anchor in
  // Matter), which is invisible on the canvas: the scene looks wired and one
  // body is simply not attached.
  const { connector, objs } = run(`
    m1 = create("mass", { x: 100, y: 100, mass: 1 })
    m2 = create("mass", { x: 100, y: 350, mass: 1 })
    sp = create("spring", { length: 200 })
    connect(sp.centre, m1.centre)
    connect(sp.centre, m2.centre)
  `)
  const spring = connector('spring')
  const bodies = objs.filter(isBody)
  const at = (i) => {
    const p = endpointWorld(spring, i)
    return bodies.find((o) => { const c = bodyCenter(o); return c.x === p.x && c.y === p.y })
  }
  assert.ok(at(0), 'end 0 must hold a body, not empty space')
  assert.ok(at(1), 'end 1 must hold a body')
  assert.notEqual(at(0).id, at(1).id, 'the two ends must hold DIFFERENT bodies')
})

test('an explicitly named end still wins over the free-end rule', () => {
  // Naming an end is authoritative: `.a` is end 0 whatever else has been
  // bound. Only anchors that name no end at all get the free-end treatment,
  // so every existing script keeps the endpoints it always had.
  const { connector, objs } = run(`
    m1 = create("mass", { x: 100, y: 100, mass: 1 })
    m2 = create("mass", { x: 100, y: 350, mass: 1 })
    sp = create("spring", { length: 200 })
    connect(sp.b, m1.centre)
    connect(sp.centre, m2.centre)
  `)
  const spring = connector('spring')
  const bodies = objs.filter(isBody)
  const centreOf = (o) => bodyCenter(o)
  const m1 = bodies.find((o) => centreOf(o).y < 250)
  const m2 = bodies.find((o) => centreOf(o).y >= 250)
  assert.deepEqual(endpointWorld(spring, 1), centreOf(m1), '.b stayed end 1')
  assert.deepEqual(endpointWorld(spring, 0), centreOf(m2), '.centre took the free end 0')
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

// ── ref(): addressing an object that already exists ─────────────────────────
//
// SimScript was create-only — create() minted a fresh uid and nothing could
// name an object already on the page, so "connect the new spring to the mass
// that's already there" had no form and every edit degenerated into
// rebuilding the scene beside the old one. ref(id) returns the SAME handle
// create() returns, so set/connect/addproperty all work on live objects.

test('ref() edits an existing object instead of creating another', () => {
  useDocStore.getState().__reset?.()
  const store = useDocStore.getState()
  store.addObject('p', {
    id: 'existing', name: 'bob', geometry: { kind: 'circle' },
    position: { x: 100, y: 100 }, size: { w: 60, h: 60 }, rotation: 0, z: 1,
    behaviors: [], parameters: { mass: { kind: 'number', expr: '2', value: 2 } }, metadata: {},
  })
  const before = useDocStore.__objects().length

  executeSimScript('p', 'var m = ref("existing"); m.set({ mass: 9 });')

  assert.equal(useDocStore.__objects().length, before, 'ref() must not create anything')
  const o = useDocStore.__objects().find((x) => x.id === 'existing')
  assert.equal(o.parameters.mass.value, 9, 'the existing object should have been edited')
})

test('ref() to a missing id fails loudly rather than silently doing nothing', () => {
  assert.throws(() => executeSimScript('p', 'ref("nope")'), /no such object/i)
})

// ── Anchors that neither the netlist nor the drawn wire agreed on ───────────
//
// The circuit netlist is built from GEOMETRY: lib/circuit/engine.ts unions
// terminals and wire ends by coincident world points. So the pin a wire is
// DRAWN to is the electrical connection — and three separate copies of
// "anchor name -> terminal index" used to decide it, with three different
// fallbacks. They are one function now; these pin that.

/** Which terminal indices of `sym` the drawn wires actually end on. */
const wiredPins = (objs, sym) => {
  const part = objs.find((o) => o.geometry.symbol === sym)
  const terms = terminalsOf(part).map((t) => terminalWorld(part, t))
  const pins = []
  for (const w of objs.filter((o) => o.behaviors.some((b) => b.type === 'wire'))) {
    for (const i of [0, 1]) {
      const p = endpointWorld(w, i)
      const idx = terms.findIndex((t) => Math.abs(t.x - p.x) < 0.5 && Math.abs(t.y - p.y) < 0.5)
      if (idx >= 0) pins.push(idx)
    }
  }
  return pins.sort()
}

const BJT_CIRCUIT = (aAnchor, bAnchor) => `
  var b = create("battery", { V: 9 });
  var q = create("bjt", { beta: 100 });
  var r = create("resistor", { R: 1000 });
  connect(b.positive, q.${aAnchor});
  connect(q.${bAnchor}, r.a);
  connect(r.b, b.negative);
`

test('numeric pin anchors survive the wire re-router', () => {
  // The re-router had no numeric case at all: `pin0`/`pin1` fell through to
  // its own fallback, so the netlist unioned pin 1 while the wire was drawn
  // to the emitter. The page then showed one circuit and solved another.
  const { objs } = run(BJT_CIRCUIT('pin0', 'pin1'))
  assert.deepEqual(wiredPins(objs, 'bjt'), [0, 1])
})

test('two unknown anchors do not collapse onto one pin', () => {
  // The old fallback sent every unrecognised name to the LAST terminal, so
  // two different names became one net — a short that is nowhere in the
  // script. Distinct names now take distinct free pins.
  const { objs } = run(BJT_CIRCUIT('foo', 'bar'))
  const pins = wiredPins(objs, 'bjt')
  assert.equal(new Set(pins).size, 2, `both names landed on the same pin: ${pins}`)
})

test('real anchor names are unaffected', () => {
  const { objs } = run(BJT_CIRCUIT('base', 'collector'))
  assert.deepEqual(wiredPins(objs, 'bjt'), [0, 1])
})

test('two connectors chain through a joint body', () => {
  // A Matter constraint binds bodies, never another constraint, so a bare
  // connector-to-connector join had nothing for the solver to hold and fell
  // through to the cosmetic wire path. A reference-point (sensor, no
  // collision) is inserted as the joint so the chain articulates.
  const { objs, connector } = run(`
    pivot = create("hinge", { x: 240, y: 40 })
    bob = create("mass", { x: 240, y: 400, mass: 1 })
    r1 = create("rod", { length: 160 })
    r2 = create("rod", { length: 160 })
    connect(r1.a, pivot.centre)
    connect(r1.b, r2.a)
    connect(r2.b, bob.centre)
  `)
  const joints = objs.filter((o) => o.metadata?.render === 'reference-point')
  assert.equal(joints.length, 1, 'exactly one joint body for one connector-to-connector join')

  const rods = objs.filter((o) => o.behaviors.some((b) => b.enabled && b.type === 'rod'))
  assert.equal(rods.length, 2)
  const j = bodyCenter(joints[0])
  const touchesJoint = (rod) =>
    [0, 1].some((i) => {
      const p = endpointWorld(rod, i)
      return Math.abs(p.x - j.x) < 0.5 && Math.abs(p.y - j.y) < 0.5
    })
  for (const rod of rods) assert.ok(touchesJoint(rod), 'each rod must have an end on the joint body')

  // And no cosmetic wire was drawn for that join.
  assert.equal(objs.filter((o) => o.behaviors.some((b) => b.type === 'wire')).length, 0)
})

test('the placement pass moves connect()-drawn lines with the scene', () => {
  // The reported bug. connect() added its line straight to the store and never
  // registered it in `created`, so applySceneLayout translated (and scaled)
  // every create()d object and left every connect()d line exactly where it was
  // drawn — a constant offset between the bodies and the rod holding them.
  //
  // Circuits hid it: the auto-layout re-router rewrites wire geometry from
  // terminal positions afterwards, so schematics healed themselves. Nothing
  // re-routes a mechanics link.
  const { objs, connector } = runPlaced(`
    var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 460, height: 500 });
    var pivot = create("hinge", { x: 320, y: 100 });
    var bob = create("mass", { x: 320, y: 340, mass: 1 });
    connect(pivot.centre, bob.centre, "rod");
  `)
  const rod = connector('rod')
  const pivot = objs.find((o) => o.behaviors.some((b) => b.type === 'hinge'))
  const bob = objs.find((o) => o.behaviors.some((b) => b.type === 'rigidBody'))
  assert.deepEqual(endpointWorld(rod, 0), bodyCenter(pivot), 'rod start left behind by the layout pass')
  assert.deepEqual(endpointWorld(rod, 1), bodyCenter(bob), 'rod end left behind by the layout pass')
})
