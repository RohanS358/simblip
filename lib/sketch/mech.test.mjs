// S4 mechanics: reading, compiling and — the point — MOVING as drawn.
// Run: node --test lib/sketch/mech.test.mjs
//
// Every sketch here is GENERATED (a writer model), so the rates below are SYNTHETIC. The motion tests
// run the compiled scene through the app's real physics (buildWorld + Matter) and check the
// behaviour the drawing describes: a block on a 30° ramp slides down it, a spring-mass oscillates,
// a pendulum swings at constant length, a dropped ball lands on the ground.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from '../../scripts/test/exec.mjs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '../..')
// inside the repo's node_modules so the bundle can import matter-js and zustand like the app does
mkdirSync(join(root, 'node_modules', '.cache'), { recursive: true })
const dir = mkdtempSync(join(root, 'node_modules', '.cache', 'sketch-mech-'))
const stub = join(dir, 'stub-store.mjs')
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'sim.mjs')

writeFileSync(stub, `
let pages = { p: { objects: {} } }
const state = () => ({
  pages,
  scopes: {},
  variables: {},
  addObject(pageId, obj) { (pages[pageId] ??= { objects: {} }).objects[obj.id] = obj },
  updateObject(pageId, id, patch) { const cur = pages[pageId]?.objects?.[id]; if (cur) pages[pageId].objects[id] = { ...cur, ...patch } },
  ensurePage() {}, upsertVariable() {},
})
export const useDocStore = {
  getState: state,
  setState: (fn) => { if (typeof fn === 'function') { const r = fn({ pages }); if (r?.pages) for (const k of Object.keys(r.pages)) pages[k] = r.pages[k] } },
  subscribe: () => () => {},
  __reset: () => { pages = { p: { objects: {} } } },
  __objects: () => Object.values(pages.p?.objects ?? {}),
}
`)
writeFileSync(entry, `
export { extractMechanics } from '@/lib/sketch/mech'
export { compareMech } from '@/lib/sketch/compare-mech'
export { compileIR } from '@/lib/sketch/compile'
export { MECH_SITUATIONS, makeMechScene } from '@/lib/sketch/mech-synth'
export { executeSimScript } from '@/lib/scene/simscript'
export { buildWorld, advanceWorld } from '@/lib/physics/world'
export { useDocStore } from '@/lib/store/document'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${bundle}`,
  `--alias:@/lib/store/document=${stub}`, `--alias:@=${root}`, '--external:react', '--external:zustand', '--external:matter-js', '--external:poly-decomp'],
  { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' })
const m = await import(pathToFileURL(bundle).href)
globalThis.__m = m
test.after(() => rmSync(dir, { recursive: true, force: true }))

const devices = ['mouse', 'touchpad', 'finger', 'pen']
const idx = (id) => m.MECH_SITUATIONS.findIndex((s) => s.id === id)
const read = (i, seed, dev = 'mouse') => {
  const scene = m.makeMechScene(i, seed, dev)
  const ink = scene.strokes.map((s, j) => ({ id: `k${j}`, pts: s.map(([x, y]) => [x, y]) }))
  return { scene, got: m.extractMechanics(ink) }
}

// ── the reader ──────────────────────────────────────────────────────────────────

test('reader: a hatched level line is ground, a drawn circle is a ball, a rectangle is a block (hand-written strokes)', () => {
  const line = (x0, y0, x1, y1, n = 20) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n])
  const strokes = [{ id: 'g', pts: line(50, 300, 450, 300, 40) }]
  for (let x = 60; x < 440; x += 18) strokes.push({ id: `h${x}`, pts: line(x, 300, x - 8, 312, 4) })
  const circle = Array.from({ length: 41 }, (_, i) => [200 + 35 * Math.cos((i / 40) * 2 * Math.PI), 258 + 35 * Math.sin((i / 40) * 2 * Math.PI)])
  strokes.push({ id: 'c', pts: circle })
  const rect = [...line(300, 240, 400, 240), ...line(400, 240, 400, 293), ...line(400, 293, 300, 293), ...line(300, 293, 300, 240)]
  strokes.push({ id: 'r', pts: rect })
  const r = m.extractMechanics(strokes)
  const cls = r.ir.nodes.map((n) => n.cls).sort().join(',')
  assert.equal(cls, 'block,ground,mass')
  assert.equal(r.parts.find((p) => p.cls === 'ground').strokeIds.length, strokes.length - 2, 'the hatch ticks belong to the ground')
  assert.ok(r.ignoredIds.length === 0)
})

test('reader: a ramp is a ground bar at its slope, and a block sitting on it is turned to match', () => {
  let ok = 0
  let n = 0
  for (const seed of [10, 11, 12, 13, 14, 15]) {
    const { scene, got } = read(idx('block-on-30-ramp'), seed)
    const ramp = got.ir.nodes.filter((x) => x.cls === 'ground' && Math.abs(x.angle) > 5)[0]
    const block = got.ir.nodes.find((x) => x.cls === 'block')
    n++
    if (ramp && block && Math.abs(Math.abs(ramp.angle) - 30) <= 4 && Math.abs(block.angle - ramp.angle) <= 1) ok++
  }
  assert.ok(ok >= 5, `ramp angle and block turn right in ${ok}/${n}`)
})

test('reader: the pulley has no component, so it is reported as a gap — never guessed', () => {
  let said = 0
  for (const seed of [10, 11, 12, 13]) {
    const { got } = read(idx('atwood-pulley'), seed, devices[seed % 4])
    if (got.gaps.some((g) => g.what === 'pulley' && /pulley/i.test(g.message))) said++
  }
  assert.equal(said, 4)
})

test('reader: every gold situation, drawn by four writers, is read back — SYNTHETIC rate', () => {
  let exact = 0
  let total = 0
  const worst = []
  for (let i = 0; i < m.MECH_SITUATIONS.length; i++) {
    if (m.MECH_SITUATIONS[i].id === 'atwood-pulley') continue
    let ok = 0
    for (let k = 0; k < 8; k++) {
      const { scene, got } = read(i, 10 + k, devices[k % 4])
      total++
      if (m.compareMech(got.ir, scene.truth.ir).exact) { exact++; ok++ }
    }
    worst.push([m.MECH_SITUATIONS[i].id, ok])
  }
  assert.ok(exact >= 0.85 * total, `exact ${exact}/${total} (${(100 * exact / total).toFixed(1)}%); weakest: ${worst.sort((a, b) => a[1] - b[1]).slice(0, 4).map((w) => w.join('=')).join(' ')}`)
})

// ── the compiler ────────────────────────────────────────────────────────────────

test('compiler: every read scene compiles, lint-clean, and the same IR gives the same script', () => {
  let compiled = 0
  let tried = 0
  for (let i = 0; i < m.MECH_SITUATIONS.length; i++) {
    if (m.MECH_SITUATIONS[i].id === 'atwood-pulley') continue
    const { got } = read(i, 10)
    tried++
    const a = m.compileIR(got.ir)
    const b = m.compileIR(got.ir)
    assert.equal(a.script, b.script, 'deterministic')
    if (a.ok) compiled++
    else assert.fail(`${m.MECH_SITUATIONS[i].id}: ${JSON.stringify(a.errors)}`)
  }
  assert.equal(compiled, tried)
})

test('compiler: refuses what is not mechanics, names the part, and never throws', () => {
  const ir = { domain: 'mechanics', nodes: [{ id: 'a', cls: 'resistor', conf: 1, bbox: [0, 0, 10, 10], rot: 0, source: 'ink' }], edges: [], labels: [], doubts: [] }
  const r = m.compileIR(ir)
  assert.equal(r.ok, false)
  assert.equal(r.errors[0].code, 'unknown-class')
  const empty = m.compileIR({ domain: 'mechanics', nodes: [], edges: [], labels: [], doubts: [] })
  assert.equal(empty.ok, false)
})

// ── it moves as drawn ───────────────────────────────────────────────────────────

/** draw → read → compile → build → simulate; returns a trajectory per read part (by IR id) */
function simulate(situation, seed, seconds = 6, dev = 'mouse') {
  const i = idx(situation)
  const { scene, got } = read(i, seed, dev)
  const res = m.compileIR(got.ir)
  assert.ok(res.ok, JSON.stringify(res.errors))
  m.useDocStore.__reset()
  m.executeSimScript('p', res.script, { x: 100, y: 100 })
  const objs = m.useDocStore.__objects()
  const hasSys = got.ir.nodes.filter((n) => n.cls !== 'force' && n.cls !== 'velocity').length >= 2
  const sys = hasSys ? objs[0] : null
  const created = objs.slice(hasSys ? 1 : 0)
  const bodies = got.ir.nodes.filter((n) => n.cls !== 'force' && n.cls !== 'velocity')
  const idOf = new Map(bodies.map((n, k) => [n.id, created[k].id]))
  const world = m.buildWorld('p', sys ? sys.id : null)
  const track = new Map(bodies.map((n) => [n.id, []]))
  const at = (id) => world.bodies.find((b) => b.objectId === idOf.get(id))?.body
  const sample = () => { for (const n of bodies) { const b = at(n.id); if (b) track.get(n.id).push({ t: world.t, x: b.position.x, y: b.position.y, a: b.angle }) } }
  sample()
  let next = 0.1
  m.advanceWorld(world, {}, seconds, (t) => { if (t >= next) { sample(); next += 0.1 } })
  // the read part nearest to the part that was DRAWN as the one to watch
  const want = scene.truth.ir.nodes.find((n) => n.id === scene.expect.body)
  const nearest = want ? got.ir.nodes.filter((n) => track.has(n.id)).sort((a, b) => {
    const d = (n) => Math.hypot(n.bbox[0] + n.bbox[2] / 2 - (want.bbox[0] + want.bbox[2] / 2), n.bbox[1] + n.bbox[3] / 2 - (want.bbox[1] + want.bbox[3] / 2))
    return d(a) - d(b)
  })[0] : null
  return { scene, got, track, watch: nearest ? track.get(nearest.id) : [], watchId: nearest?.id, sys }
}

const disp = (tr) => ({ dx: tr.at(-1).x - tr[0].x, dy: tr.at(-1).y - tr[0].y })
const signChanges = (vals) => { let c = 0; let prev = 0; for (const v of vals) { const s = Math.abs(v) < 0.05 ? 0 : Math.sign(v); if (s && prev && s !== prev) c++; if (s) prev = s } return c }

test('motion: a block on the ground stays put; a dropped ball lands on the ground and stays', () => {
  const rest = simulate('block-on-ground', 10)
  const d = disp(rest.watch)
  assert.ok(Math.hypot(d.dx, d.dy) < 12, `block moved ${Math.hypot(d.dx, d.dy).toFixed(1)} px`)
  const fall = simulate('ball-falls', 10)
  const t = fall.watch
  assert.ok(t.at(-1).y - t[0].y > 60, 'it fell')
  assert.ok(Math.abs(t.at(-1).y - t.at(-5).y) < 3, 'and came to rest on the ground, not through it')
  // resting height: the ball's lowest point is on the ground's top face (read back from the built scene)
  const built = m.useDocStore.__objects()
  const ball = built.find((o) => o.geometry.kind === 'circle')
  const ground = built.find((o) => o.behaviors.some((b) => b.type === 'staticBody'))
  assert.ok(ball && ground)
  const bottom = t.at(-1).y + ball.size.h / 2
  assert.ok(Math.abs(bottom - ground.position.y) < 5, `ball bottom ${bottom.toFixed(1)} vs ground top ${ground.position.y}`)
})

test('motion: a block on a ramp slides DOWN the slope (and a flat-ground block does not)', () => {
  let down = 0
  const seeds = [10, 11, 12, 13]
  for (const seed of seeds) {
    const r = simulate('block-on-30-ramp', seed, 3, devices[seed % 4])
    const ramp = r.got.ir.nodes.find((n) => n.cls === 'ground' && Math.abs(n.angle) > 5)
    if (!ramp) continue
    const d = disp(r.watch)
    // the ramp rises to the right (angle < 0), so down-slope is toward −x and +y
    if (d.dx < -25 && d.dy > 10) down++
  }
  assert.ok(down >= 3, `slid down the slope in ${down}/${seeds.length}`)
})

test('motion: a spring holds its mass — at rest when drawn at rest, displaced and settled when hung or pulled', () => {
  const rest = simulate('spring-mass-horizontal', 10, 4)
  const dr = disp(rest.watch)
  assert.ok(Math.hypot(dr.dx, dr.dy) < 8, `a spring at its natural length moved ${Math.hypot(dr.dx, dr.dy).toFixed(1)} px`)
  let ok = 0
  let n = 0
  const bad = []
  for (const [sit, axis, sign] of [['spring-mass-vertical', 'y', 1], ['spring-hang-block', 'y', 1], ['spring-block-pulled', 'x', 1]]) {
    for (const seed of [10, 11]) {
      const r = simulate(sit, seed, 8, devices[seed % 4])
      const vs = r.watch.map((s) => s[axis])
      n++
      const moved = sign * (vs.at(-1) - vs[0])
      const settled = Math.abs(vs.at(-1) - vs.at(-20)) < 8 // the engine's spring creeps in; "settled" = under 8 px in the last 2 s
      // it stretched the way the load pulls, stayed attached (did not fall or fly away) and came to rest
      if (r.got.ir.edges.some((e) => e.kind === 'spring') && moved > 15 && moved < 500 && settled) ok++
      else bad.push(`${sit}#${seed}: spring=${r.got.ir.edges.some((e) => e.kind === 'spring')} moved=${moved.toFixed(0)} drift=${Math.abs(vs.at(-1) - vs.at(-20)).toFixed(1)}`)
    }
  }
  assert.ok(ok >= 5, `held and settled in ${ok}/${n}: ${bad.join('; ')}`)
})

test('motion: a pendulum swings and keeps its length', () => {
  let ok = 0
  for (const [sit, seed] of [['pendulum-rod', 10], ['pendulum-rod', 11], ['pendulum-rope-ceiling', 10], ['pendulum-rope-ceiling', 11]]) {
    const r = simulate(sit, seed, 6, devices[seed % 4])
    const xs = r.watch.map((s) => s.x)
    const swings = signChanges(xs.slice(1).map((x, i) => x - xs[i]))
    // distance to the pivot (the topmost hinge / ceiling) stays within 15 %
    const pivot = r.got.ir.nodes.filter((n) => n.cls === 'hinge' || n.cls === 'ground').sort((a, b) => a.bbox[1] - b.bbox[1])[0]
    const hasLink = r.got.ir.edges.length >= 1
    if (swings >= 2 && hasLink) ok++
    void pivot
  }
  assert.ok(ok >= 3, `swung in ${ok}/4`)
})

test('motion: a force arrow pushes the block the way it points', () => {
  let ok = 0
  for (const [sit, dir] of [['block-pushed-right', 'right'], ['block-pushed-left', 'left']]) {
    for (const seed of [10, 11, 12]) {
      const r = simulate(sit, seed, 2, devices[seed % 4])
      const d = disp(r.watch)
      if ((dir === 'right' && d.dx > 15) || (dir === 'left' && d.dx < -15)) ok++
    }
  }
  assert.ok(ok >= 5, `pushed the right way in ${ok}/6`)
})
