// The tutor and the sketch tools, end to end: a student draws a circuit on the page (SYNTHETIC hand), asks
// "why does the LED not light?", the router sends it to the sketch tools, a scripted model calls
// sketch.recognize against the REAL store, reader and diagnosis, and what the tool reports is what the student
// is told. The model here is scripted (only the loop and the tools are under test, not any model's wording).
// Run: npm run test:ai

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { bundle } from '../../scripts/test/bundle.mjs'

const root = resolve(import.meta.dirname, '../..')
globalThis.fetch = async (url) => {
  const buf = readFileSync(resolve(root, 'public', String(url).replace(/^\//, '')))
  return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
}

const m = await bundle(
  `
export { makeAct } from '@/lib/ai/tutor/act'
export { routeAct } from '@/lib/ai/tutor/router'
import '@/lib/tools/sketch'
import '@/lib/tools/scene'
export { runTool } from '@/lib/tools/registry'
export { useDocStore } from '@/lib/store/document'
export { loadSketchNet, loadInkChars } from '@/lib/sketch/sketchnet'
export { drawScene } from '@/lib/sketch/scene-synth'
export { makeWriter } from '@/lib/sketch/synth'
export { makeRng } from '@/lib/sketch/rng'
`,
  'tutor-sketch'
)
const { makeAct, routeAct, runTool, useDocStore, loadSketchNet, loadInkChars, drawScene, makeWriter, makeRng } = m

const PAGE = 'p-tutor-sketch'
const ctx = { pageId: PAGE }

/** A series loop: battery (left) — resistor (top) — LED (right), as the layout generator describes a scene. */
function ledLoop({ reversed, resistor = true }) {
  const nodes = [
    { id: 'n1', cls: 'battery', conf: 1, bbox: [0, 0, 60, 30], rot: 0, source: 'ink', values: { V: '9' } },
    ...(resistor ? [{ id: 'n2', cls: 'resistor', conf: 1, bbox: [0, 0, 60, 30], rot: 0, source: 'ink', values: { R: '330' } }] : []),
    { id: 'n3', cls: 'led', conf: 1, bbox: [0, 0, 60, 30], rot: 0, source: 'ink' },
  ]
  const parts = [{ id: 'n1', cls: 'battery', x: 522, y: 416, w: 96, h: 48, rot: 90, terminals: [{ x: 570, y: 392 }, { x: 570, y: 488 }] }]
  const wires = []
  if (resistor) {
    parts.push({ id: 'n2', cls: 'resistor', x: 650, y: 348, w: 96, h: 48, rot: 0, terminals: [{ x: 650, y: 372 }, { x: 746, y: 372 }] })
    parts.push({ id: 'n3', cls: 'led', x: 782, y: 416, w: 96, h: 48, rot: reversed ? 270 : 90, terminals: reversed ? [{ x: 830, y: 488 }, { x: 830, y: 392 }] : [{ x: 830, y: 392 }, { x: 830, y: 488 }] })
    wires.push({ pts: [[570, 392], [570, 372], [650, 372]], a: { part: 0, term: 0 }, b: { part: 1, term: 0 } })
    wires.push({ pts: [[746, 372], [830, 372], [830, 392]], a: { part: 1, term: 1 }, b: { part: 2, term: reversed ? 1 : 0 } })
    wires.push({ pts: [[830, 488], [830, 508], [570, 508], [570, 488]], a: { part: 2, term: reversed ? 0 : 1 }, b: { part: 0, term: 1 } })
  } else {
    parts.push({ id: 'n3', cls: 'led', x: 650, y: 416, w: 96, h: 48, rot: 90, terminals: [{ x: 698, y: 392 }, { x: 698, y: 488 }] })
    wires.push({ pts: [[570, 392], [570, 372], [698, 372], [698, 392]], a: { part: 0, term: 0 }, b: { part: 1, term: 0 } })
    wires.push({ pts: [[698, 488], [698, 508], [570, 508], [570, 488]], a: { part: 1, term: 1 }, b: { part: 0, term: 1 } })
  }
  return { id: reversed ? 'led-reversed' : 'led-ok', ir: { domain: 'circuit', nodes, edges: [], labels: [], doubts: [] }, parts, wires }
}

/** Put a drawn layout on the page as plain ink, as the pen tool would; returns how many strokes. */
function drawOnPage(layout, seed, device = 'pen') {
  const rng = makeRng(seed)
  const sc = drawScene(layout, rng.fork('s'), makeWriter(rng.fork('w'), `tut-${seed}`, device), undefined, undefined, { text: false })
  sc.strokes.forEach((pts, k) => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
    const x0 = Math.min(...xs), y0 = Math.min(...ys)
    useDocStore.getState().addObject(PAGE, {
      id: `ink${k}`, name: 'Ink', z: k + 1, position: { x: x0, y: y0 }, size: { w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 }, rotation: 0,
      geometry: { kind: 'stroke', points: pts.map(([x, y]) => [x - x0, y - y0]) }, metadata: {}, behaviors: [], parameters: {},
    }, { history: false })
  })
  return sc.strokes.length
}

const call = (name, args, id = 'c1') => ({ id, name, arguments: JSON.stringify(args) })
/** The model: first call the tool the router offered, then answer from what the tool said. */
const scripted = (first) => {
  const seen = []
  return {
    seen,
    async chat(req) {
      seen.push(req)
      if (seen.length === 1) return { content: '', toolCalls: [call(first, {})], tokensPerSec: null }
      const tool = [...req.messages].reverse().find((x) => x.role === 'tool')
      return { content: `TOOL SAID: ${tool?.content}`, toolCalls: [], tokensPerSec: null }
    },
  }
}

test.before(async () => {
  assert.ok(await loadSketchNet())
  await loadInkChars()
})
test.beforeEach(() => {
  useDocStore.getState().loadPage(PAGE)
  useDocStore.getState().removeObjects(PAGE, Object.keys(useDocStore.getState().pages[PAGE]?.objects ?? {}))
})

/** Run the tutor's loop for one prompt against the real tools. */
async function ask(prompt, firstTool) {
  const plan = routeAct(prompt, true)
  assert.equal(plan?.kind, 'agent', `"${prompt}" must go to the tools`)
  assert.ok(plan.tools.includes(firstTool), `${plan.tools}`)
  const eng = scripted(firstTool)
  const act = makeAct({ engine: eng, ctx: () => ctx, emit() {} })
  const out = await act({ prompt, pageDigest: 'a drawing' }, '')
  return { out, eng, plan }
}

test('"read my drawing": the tutor reads the real ink and reports parts and connections', async () => {
  drawOnPage(ledLoop({ reversed: false }), 11)
  const { out } = await ask('read my drawing', 'sketch.recognize')
  assert.equal(out.toolSteps[0].name, 'sketch.recognize')
  assert.equal(out.toolSteps[0].ok, true, out.toolSteps[0].summary)
  assert.match(out.toolSteps[0].summary, /I read \d parts/)
  assert.match(out.message, /TOOL SAID: From the newest sketch/)
})

test('"why does the LED not light?" with the LED drawn BACKWARDS: the tool names the LED and the fix', async () => {
  let said = 0
  let tried = 0
  for (const seed of [21, 22, 23, 24, 25, 26]) {
    useDocStore.getState().removeObjects(PAGE, Object.keys(useDocStore.getState().pages[PAGE]?.objects ?? {}))
    drawOnPage(ledLoop({ reversed: true }), seed)
    const { out } = await ask('why does the LED not light?', 'sketch.recognize')
    tried++
    if (/in backwards/i.test(out.toolSteps[0].summary)) said++
  }
  assert.ok(said >= 4, `named the backwards LED on ${said}/${tried} hands`)
})

test('the same circuit drawn the RIGHT way is not called backwards (no false alarm)', async () => {
  let falseAlarms = 0
  for (const seed of [31, 32, 33, 34, 35, 36]) {
    useDocStore.getState().removeObjects(PAGE, Object.keys(useDocStore.getState().pages[PAGE]?.objects ?? {}))
    drawOnPage(ledLoop({ reversed: false }), seed)
    const { out } = await ask('why does the LED not light?', 'sketch.recognize')
    if (/in backwards/i.test(out.toolSteps[0].summary)) falseAlarms++
  }
  assert.ok(falseAlarms <= 1, `${falseAlarms}/6 false "backwards" alarms`)
})

test('an LED drawn straight across the battery is called out as having no resistor', async () => {
  let said = 0
  for (const seed of [41, 42, 43, 44, 45, 46]) {
    useDocStore.getState().removeObjects(PAGE, Object.keys(useDocStore.getState().pages[PAGE]?.objects ?? {}))
    drawOnPage(ledLoop({ reversed: false, resistor: false }), seed)
    const { out } = await ask("why isn't my circuit working", 'sketch.recognize')
    if (/no resistor in series|burn out/i.test(out.toolSteps[0].summary)) said++
  }
  assert.ok(said >= 3, `${said}/6`)
})

test('"turn my drawing into a circuit" builds it through the tutor in one undo step', async () => {
  // several hands: a hand the reader cannot wire completely must say so, never claim a clean circuit
  let clean = 0
  for (const seed of [51, 52, 53, 54, 55, 56]) {
    useDocStore.getState().removeObjects(PAGE, Object.keys(useDocStore.getState().pages[PAGE]?.objects ?? {}))
    const n = drawOnPage(ledLoop({ reversed: false }), seed)
    const before = Object.keys(useDocStore.getState().pages[PAGE].objects).length
    const { out } = await ask('turn my drawing into a circuit', 'sketch.to_scene')
    const step = out.toolSteps[0]
    assert.equal(step.name, 'sketch.to_scene')
    if (step.ok) {
      if (/Built a circuit/.test(step.summary)) {
        clean++
        // the ink the reading used is replaced; a stray stroke it did not use may stay (undo brings everything back)
        const left = Object.values(useDocStore.getState().pages[PAGE].objects).filter((o) => o.geometry.kind === 'stroke').length
        assert.ok(left <= 0.15 * n, `${left} of ${n} strokes left behind`)
      }
      else assert.match(step.summary, /can't run yet|not connected|open/i, `a circuit with a gap says so: ${step.summary}`)
      useDocStore.getState().undo(PAGE)
      assert.equal(Object.keys(useDocStore.getState().pages[PAGE].objects).length, before, 'one undo restores the drawing')
    } else {
      // a refusal is acceptable (an unsure part): it must say why, and change nothing
      assert.match(step.summary, /Not built/)
      assert.equal(Object.keys(useDocStore.getState().pages[PAGE].objects).length, n, 'nothing changed')
    }
  }
  assert.ok(clean >= 3, `built cleanly on ${clean}/6 hands`)
})
