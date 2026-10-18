// S4 optics: a sketch of a bench becomes a scene whose rays do what the drawing says.
// Run: node --test lib/sketch/optics-sketch.test.mjs
//
// The sketches are GENERATED (a writer model), so rates are SYNTHETIC. The ray checks run the compiled
// scene through the app's own tracer (lib/optics/engine.ts): a convex lens brings a beam to a focus
// at f behind it, a concave lens makes it diverge as if from f in front, and a plane mirror turns it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from '../../scripts/test/exec.mjs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '../..')
mkdirSync(join(root, 'node_modules', '.cache'), { recursive: true })
const dir = mkdtempSync(join(root, 'node_modules', '.cache', 'sketch-optics-'))
const stub = join(dir, 'stub-store.mjs')
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'sim.mjs')

writeFileSync(stub, `
let pages = { p: { objects: {} } }
const state = () => ({
  pages, scopes: {}, variables: {},
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
export { extractOptics, opticsEvidence } from '@/lib/sketch/optics'
export { compareMech } from '@/lib/sketch/compare-mech'
export { compileIR } from '@/lib/sketch/compile'
export { OPTICS_SITUATIONS, makeOpticsScene } from '@/lib/sketch/optics-synth'
export { executeSimScript } from '@/lib/scene/simscript'
export { traceRays } from '@/lib/optics/engine'
export { useDocStore } from '@/lib/store/document'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${bundle}`,
  `--alias:@/lib/store/document=${stub}`, `--alias:@=${root}`, '--external:react', '--external:zustand', '--external:matter-js', '--external:poly-decomp'],
  { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' })
const m = await import(pathToFileURL(bundle).href)
test.after(() => rmSync(dir, { recursive: true, force: true }))

const devices = ['mouse', 'touchpad', 'finger', 'pen']
const idx = (id) => m.OPTICS_SITUATIONS.findIndex((s) => s.id === id)
const read = (i, seed, dev = 'mouse') => {
  const scene = m.makeOpticsScene(i, seed, dev)
  const ink = scene.strokes.map((s, j) => ({ id: `k${j}`, pts: s.map(([x, y]) => [x, y]) }))
  return { scene, got: m.extractOptics(ink) }
}

test('reader: a source, a lens, a screen and focal marks, from hand-written strokes', () => {
  const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n])
  const strokes = [
    { id: 'axis', pts: line(80, 200, 520, 200, 40) },
    { id: 'src', pts: Array.from({ length: 31 }, (_, i) => [120 + 14 * Math.cos((i / 30) * 2 * Math.PI), 200 + 14 * Math.sin((i / 30) * 2 * Math.PI)]) },
    // a double-headed vertical arrow: a converging lens at x = 300
    { id: 'lens', pts: line(300, 130, 300, 270, 20) },
    { id: 'h1', pts: line(300, 130, 292, 146, 3) }, { id: 'h2', pts: line(300, 130, 308, 146, 3) },
    { id: 'h3', pts: line(300, 270, 292, 254, 3) }, { id: 'h4', pts: line(300, 270, 308, 254, 3) },
    { id: 'scr', pts: line(450, 140, 450, 260, 20) },
    { id: 'f1', pts: line(220, 194, 220, 206, 3) }, { id: 'f2', pts: line(380, 194, 380, 206, 3) },
  ]
  const r = m.extractOptics(strokes)
  assert.deepEqual(r.ir.nodes.map((n) => n.cls), ['light-source', 'thin-lens', 'optical-screen'])
  const lens = r.ir.nodes.find((n) => n.cls === 'thin-lens')
  assert.equal(Number(lens.values.f), 80, 'f is the distance from the lens to the focal marks')
  assert.ok(r.furnitureIds.includes('axis'), 'the axis is not a part')
  assert.equal(r.ignoredIds.length, 0)
})

test('reader: every optics gold situation, drawn by four writers — SYNTHETIC rate', (t) => {
  let exact = 0
  let total = 0
  let fOk = 0
  let fTot = 0
  for (let i = 0; i < m.OPTICS_SITUATIONS.length; i++) {
    for (let k = 0; k < 8; k++) {
      const { scene, got } = read(i, 10 + k, devices[k % 4])
      total++
      if (m.compareMech(got.ir, scene.truth.ir, { angleTol: 10 }).exact) exact++
      if (scene.owners.includes('mark')) {
        for (const tn of scene.truth.ir.nodes.filter((n) => n.cls === 'thin-lens')) {
          const g = got.ir.nodes.find((n) => n.cls === 'thin-lens' && Math.abs(n.bbox[0] - tn.bbox[0]) < 30)
          if (!g) continue
          fTot++
          const a = Number(g.values?.f)
          const b = Number(tn.values.f)
          if (Math.sign(a) === Math.sign(b) && Math.abs(a - b) <= 0.2 * Math.abs(b)) fOk++
        }
      }
    }
  }
  t.diagnostic(`SYNTHETIC optics: exact ${exact}/${total}; focal length right where marked ${fOk}/${fTot}`)
  assert.ok(exact >= 0.85 * total, `exact ${exact}/${total}`)
  assert.ok(fOk >= 0.9 * fTot, `focal length ${fOk}/${fTot}`)
})

test('compiler: optics scenes compile lint-clean and keep each part where it was drawn, at the drawn length', () => {
  for (let i = 0; i < m.OPTICS_SITUATIONS.length; i++) {
    const { got } = read(i, 10)
    const res = m.compileIR(got.ir)
    assert.ok(res.ok, `${m.OPTICS_SITUATIONS[i].id}: ${JSON.stringify(res.errors)}`)
    assert.equal(res.script, m.compileIR(got.ir).script, 'deterministic')
  }
  const { got } = read(idx('convex-lens-focus'), 10)
  const res = m.compileIR(got.ir)
  m.useDocStore.__reset()
  m.executeSimScript('p', res.script, { x: 100, y: 100 })
  const lens = m.useDocStore.__objects().find((o) => o.behaviors.some((b) => b.type === 'thinLens'))
  const drawn = got.ir.nodes.find((n) => n.cls === 'thin-lens')
  const pts = lens.geometry.points
  assert.ok(Math.abs(Math.abs(pts[1][1] - pts[0][1]) - drawn.bbox[3]) < 2, `lens aperture ${pts[1][1] - pts[0][1]} vs drawn ${drawn.bbox[3]}`)
})

/** draw → read → compile → build → trace rays */
function trace(situation, seed, dev = 'mouse') {
  const { scene, got } = read(idx(situation), seed, dev)
  const res = m.compileIR(got.ir)
  assert.ok(res.ok, JSON.stringify(res.errors))
  m.useDocStore.__reset()
  m.executeSimScript('p', res.script, { x: 100, y: 100 })
  const objs = m.useDocStore.__objects()
  const paths = m.traceRays(objs)
  return { scene, got, objs, paths }
}

/** where the last segment of a ray crosses the horizontal line y = yAxis (null if it never does going forward) */
const crossX = (path, yAxis) => {
  const a = path.points.at(-2)
  const b = path.points.at(-1)
  if (Math.abs(b.y - a.y) < 1e-6) return null
  return a.x + ((yAxis - a.y) * (b.x - a.x)) / (b.y - a.y)
}

/**
 * The traces of a situation across writers, for the readings that were exact. Reading accuracy is measured
 * above; these tests ask whether a scene that was read RIGHT then behaves right on the real tracer.
 */
function exactTraces(situation, seeds) {
  const out = []
  for (const seed of seeds) {
    const t = trace(situation, seed, devices[seed % 4])
    if (m.compareMech(t.got.ir, t.scene.truth.ir, { angleTol: 10 }).exact) out.push(t)
  }
  return out
}

const SEEDS = [10, 11, 12, 13, 14, 15, 16, 17]

test('rays: a convex lens brings a parallel beam to a focus at f behind it', () => {
  const ts = exactTraces('convex-lens-focus', SEEDS)
  assert.ok(ts.length >= 4, `only ${ts.length}/${SEEDS.length} readings were exact`)
  for (const { scene, objs, paths } of ts) {
    const lens = objs.find((o) => o.behaviors.some((b) => b.type === 'thinLens'))
    // the optical axis is the lens's own centre line (the hand-drawn source is rarely exactly on it)
    const yAxis = lens.position.y + lens.size.h / 2
    const lensX = lens.position.x
    const f = scene.expect.f
    const through = paths.filter((p) => p.points.length >= 3 && p.points.at(-1).x > lensX && p.points.at(-2).x >= lensX - 1)
    const xs = through.map((p) => crossX(p, yAxis)).filter((x) => x !== null && Math.abs(x - lensX) < 4 * f)
    assert.ok(xs.length >= 3, 'rays came out of the lens')
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    assert.ok(Math.abs(mean - lensX - f) <= 0.25 * f, `focus at ${(mean - lensX).toFixed(0)} px behind the lens, f = ${f}`)
  }
})

test('rays: a concave lens spreads the beam, as if from a virtual focus on the source side', () => {
  const ts = exactTraces('concave-lens-diverges', SEEDS)
  assert.ok(ts.length >= 4, `only ${ts.length}/${SEEDS.length} readings were exact`)
  for (const { scene, objs, paths } of ts) {
    const lens = objs.find((o) => o.behaviors.some((b) => b.type === 'thinLens'))
    const yAxis = lens.position.y + lens.size.h / 2
    const lensX = lens.position.x
    const f = scene.expect.f
    const through = paths.filter((p) => p.points.length >= 3 && p.points.at(-1).x > lensX)
    // off-axis rays must move AWAY from the axis after the lens
    const spread = through.filter((p) => {
      const a = p.points.at(-2)
      const b = p.points.at(-1)
      return (a.y < yAxis - 3 && b.y < a.y - 1) || (a.y > yAxis + 3 && b.y > a.y + 1)
    })
    const xs = spread.map((p) => crossX(p, yAxis)).filter((x) => x !== null)
    assert.ok(spread.length >= 2 && xs.length >= 2, 'the beam spread')
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    assert.ok(Math.abs(lensX - mean - f) <= 0.3 * f, `virtual focus ${(lensX - mean).toFixed(0)} px in front, f = ${f}`)
  }
})

test('rays: a plane mirror sends the beam back (vertical) or turns it (45°)', () => {
  const back = exactTraces('plane-mirror-0', SEEDS)
  const up = exactTraces('plane-mirror-45', SEEDS)
  assert.ok(back.length >= 4 && up.length >= 4, `exact readings: ${back.length} and ${up.length}`)
  for (const { paths } of back) {
    const mid = paths.find((p) => p.points.length >= 3)
    const a = mid.points.at(-2)
    const b = mid.points.at(-1)
    assert.ok(b.x < a.x - 1 && Math.abs(b.y - a.y) < 0.35 * Math.abs(b.x - a.x), 'reflected straight back')
  }
  for (const { paths } of up) {
    const p45 = paths.find((p) => p.points.length >= 3)
    const a = p45.points.at(-2)
    const b = p45.points.at(-1)
    assert.ok(Math.abs(b.x - a.x) < 0.35 * Math.abs(b.y - a.y), 'turned through 90°')
  }
})
