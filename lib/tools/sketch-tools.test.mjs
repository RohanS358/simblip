// S6: the tutor's sketch.* tools against the REAL document store and the real reader/compiler.
// Ink is SYNTHETIC (generated hands). Run: npm run test:ai

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { bundle } from '../../scripts/test/bundle.mjs'

const root = resolve(import.meta.dirname, '../..')
// the readers fetch their networks from /models; serve them from disk
globalThis.fetch = async (url) => {
  const buf = readFileSync(resolve(root, 'public', String(url).replace(/^\//, '')))
  return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
}

const m = await bundle(
  `
export { runTool, toolSpecs } from '@/lib/tools/registry'
import '@/lib/tools/sketch'
export { useDocStore } from '@/lib/store/document'
export { loadSketchNet, loadInkChars } from '@/lib/sketch/sketchnet'
export { drawScene } from '@/lib/sketch/scene-synth'
export { makeWriter } from '@/lib/sketch/synth'
export { makeRng } from '@/lib/sketch/rng'
export { describeReading } from '@/lib/sketch/teach'
export { startCircuitGhost } from '@/lib/sketch/circuit-ghost'
`,
  'sketch-tools'
)
const { runTool, toolSpecs, useDocStore, loadSketchNet, loadInkChars, drawScene, makeWriter, makeRng, describeReading } = m
const { layouts } = JSON.parse(readFileSync(resolve(root, 'lib/sketch/golden/scene-layouts.json'), 'utf8'))

const PAGE = 'p-sketch'
const ctx = { pageId: PAGE }
const objects = () => Object.values(useDocStore.getState().pages[PAGE]?.objects ?? {})
const ink = () => objects().filter((o) => o.geometry.kind === 'stroke')

/** Draw layout `i` onto the page as plain ink objects, as the pen tool would. */
function drawOnPage(i, text = false) {
  const rng = makeRng(500 + i)
  const sc = drawScene(layouts[i], rng.fork('s'), makeWriter(rng.fork('w'), `st-${i}`, 'mouse'), undefined, undefined, { text })
  sc.strokes.forEach((pts, k) => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
    const x0 = Math.min(...xs), y0 = Math.min(...ys)
    useDocStore.getState().addObject(PAGE, {
      id: `ink${k}`, name: 'Ink', z: k + 1, position: { x: x0, y: y0 }, size: { w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 }, rotation: 0,
      geometry: { kind: 'stroke', points: pts.map(([x, y]) => [x - x0, y - y0]) }, metadata: {}, behaviors: [], parameters: {},
    }, { history: false })
  })
  return sc
}

test.before(async () => {
  assert.ok(await loadSketchNet(), 'recogniser loaded')
  await loadInkChars()
})
test.beforeEach(() => {
  useDocStore.getState().loadPage(PAGE)
  useDocStore.getState().removeObjects(PAGE, objects().map((o) => o.id))
})

test('the sketch tools are in the one registry, with short summaries and object schemas', () => {
  const specs = toolSpecs().filter((s) => s.name.startsWith('sketch.'))
  assert.deepEqual(specs.map((s) => s.name).sort(), ['sketch.recognize', 'sketch.to_scene'])
  for (const s of specs) assert.equal(s.inputSchema.type, 'object')
})

test('sketch.recognize says what it read, and changes nothing', async () => {
  drawOnPage(0)
  const before = objects().length
  const r = await runTool('sketch.recognize', {}, ctx)
  assert.equal(r.ok, true, r.error)
  assert.match(r.summary, /I read \d+ parts/)
  assert.equal(r.data.kind, 'circuit')
  assert.equal(objects().length, before, 'read-only')
})

test('sketch.recognize asks the student the questions a tutor would: no source, open ends, diode direction', async () => {
  // a reading with the source removed: the tutor must notice
  drawOnPage(1) // battery, diode, inductor
  const r = await runTool('sketch.recognize', {}, ctx)
  assert.equal(r.ok, true)
  assert.ok(r.data.questions.some((q) => /diode|led|battery|plate/i.test(q)), `questions: ${r.data.questions.join(' | ')}`)
})

test('sketch.to_scene builds the circuit in ONE undo step and replaces the ink', async () => {
  drawOnPage(0)
  const n = ink().length
  assert.ok(n > 5)
  const r = await runTool('sketch.to_scene', {}, ctx)
  assert.equal(r.ok, true, r.error)
  assert.match(r.summary, /Built a circuit from \d+ parts/)
  assert.equal(ink().length, 0, 'the sketch was replaced')
  assert.ok(objects().length >= 4, 'real parts exist')
  useDocStore.getState().undo(PAGE)
  assert.equal(ink().length, n, 'one undo brings the sketch back')
})

test('sketch.to_scene refuses what is not a circuit, and a page with no ink, without touching the page', async () => {
  const empty = await runTool('sketch.recognize', {}, ctx)
  assert.equal(empty.ok, false)
  assert.match(empty.error, /no hand-drawn ink/)
  // one lone stroke: not a circuit
  useDocStore.getState().addObject(PAGE, { id: 'a', name: 'Ink', z: 1, position: { x: 10, y: 10 }, size: { w: 80, h: 6 }, rotation: 0, geometry: { kind: 'stroke', points: Array.from({ length: 20 }, (_, i) => [i * 4, 3 + Math.sin(i) * 3]) }, metadata: {}, behaviors: [], parameters: {} }, { history: false })
  const before = objects().length
  const r = await runTool('sketch.to_scene', {}, ctx)
  assert.equal(r.ok, false)
  assert.match(r.error, /Not built/)
  assert.equal(objects().length, before)
})

test('a picture id that is not a picture is a clear error the model can fix', async () => {
  drawOnPage(0)
  const r = await runTool('sketch.recognize', { object: 'ink0' }, ctx)
  assert.equal(r.ok, false)
  assert.match(r.error, /not a picture/)
})

test('describeReading turns a failure into what went wrong, and an unsure symbol into a question', () => {
  const f = describeReading({ kind: 'fail', failure: { reason: 'incomplete', message: 'Found a resistor with wires, but a circuit needs at least two parts.', box: { x0: 0, y0: 0, x1: 1, y1: 1 }, ids: [], parts: ['resistor'] } })
  assert.match(f.read, /could not read/i)
  assert.match(f.read, /at least two parts/)
  const s = describeReading({ kind: 'symbol', tier: 'unsure', ids: [], pick: { kind: 'place', cls: 'opamp', p: 0.4, pose: 0, alts: [], absorb: [], box: { x0: 0, y0: 0, x1: 1, y1: 1 }, margin: 0.1 } })
  assert.match(s.read, /not sure/i)
  assert.ok(s.moves.length > 0)
})
