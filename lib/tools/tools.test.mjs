// The tool layer against the REAL stores and engines: what a tool reports must
// be what the page actually contains afterwards.
// Run: npm run test:ai

import test from 'node:test'
import assert from 'node:assert/strict'
import { bundle } from '../../scripts/test/bundle.mjs'

const m = await bundle(
  `
export { runTool, listTools, toolSpecs, setToolGenerator } from '@/lib/tools/registry'
import '@/lib/tools/scene'
import '@/lib/tools/pages'
export { useDocStore } from '@/lib/store/document'
export { useWorkspaceStore } from '@/lib/store/workspace'
export { useRuntimeStore, stop } from '@/lib/physics/world'
export { serveCall, visibleSpecs, allowedIn, useBridge } from '@/lib/tools/bridge'
`,
  'tools'
)
const { runTool, listTools, toolSpecs, useDocStore, useWorkspaceStore, useRuntimeStore, stop } = m

const PAGE = 'p-test'
const ctx = { pageId: PAGE }
const objects = () => Object.values(useDocStore.getState().pages[PAGE]?.objects ?? {})
test.beforeEach(() => {
  stop()
  useDocStore.getState().loadPage(PAGE)
  useDocStore.getState().removeObjects(PAGE, objects().map((o) => o.id))
})

test('every tool has a name, a short summary and a valid object schema', () => {
  const specs = toolSpecs()
  assert.ok(specs.length >= 15, `expected a real catalogue, got ${specs.length}`)
  const seen = new Set()
  for (const s of specs) {
    assert.match(s.name, /^[a-z]+\.[a-z_]+$/, `bad tool name ${s.name}`)
    assert.ok(!seen.has(s.name), `duplicate ${s.name}`)
    seen.add(s.name)
    assert.equal(s.inputSchema.type, 'object', `${s.name} schema must be an object`)
    const words = listTools().find((t) => t.name === s.name).summary.split(/\s+/).length
    assert.ok(words <= 12, `${s.name} summary is ${words} words — a small model reads ONLY this`)
  }
})

test('unknown tools and bad arguments fail with a message the model can act on', async () => {
  const a = await runTool('scene.nope', {}, ctx)
  assert.equal(a.ok, false)
  assert.match(a.error, /Available:.*scene\.run/)
  const b = await runTool('scene.measure', {}, ctx)
  assert.equal(b.ok, false)
  assert.match(b.error, /Bad arguments for scene\.measure.*id/)
})

test('no page open → a clear refusal, not a crash', async () => {
  const r = await runTool('scene.describe', {}, { pageId: null })
  assert.equal(r.ok, false)
  assert.match(r.error, /Open a notebook page/)
})

test('scene.script lints first: a bad script changes nothing', async () => {
  const r = await runTool('scene.script', { script: 'var s = create("not-a-kind", {});' }, ctx)
  assert.equal(r.ok, false)
  assert.match(r.error, /rejected/)
  assert.equal(objects().length, 0)
})

test('scene.script builds a verified scene, and ONE undo removes all of it', async () => {
  const r = await runTool(
    'scene.script',
    { script: 'var b = create("battery", {V: 9});\nvar r = create("resistor", {R: 100});\nconnect(b.positive, r.a);\nconnect(r.b, b.negative);' },
    ctx
  )
  assert.equal(r.ok, true, r.error)
  assert.ok(objects().length >= 2, 'the scene should be on the page')
  const n = objects().length
  assert.match(r.summary, new RegExp(`Added ${n}`))
  await runTool('scene.undo', {}, ctx)
  assert.equal(objects().length, 0, 'one Ctrl+Z must remove the whole AI scene')
})

test('scene.add puts a note with its text on the page; describe sees it with its real id', async () => {
  const add = await runTool('scene.add', { component: 'note', text: 'check the units' }, ctx)
  assert.equal(add.ok, true, add.error)
  const note = objects().find((o) => o.geometry.kind === 'note')
  assert.ok(note)
  assert.equal(note.parameters.text.value, 'check the units')
  const d = await runTool('scene.describe', {}, ctx)
  assert.equal(d.ok, true)
  assert.ok(d.summary.includes(note.id), 'the digest must carry the real id so the model can address it')
})

test('scene.edit changes an existing object, and a stale id aborts the WHOLE batch', async () => {
  await runTool('scene.add', { component: 'note', text: 'a', x: 10, y: 10 }, ctx)
  const note = objects()[0]
  const good = await runTool('scene.edit', { ops: [{ op: 'update', id: note.id, position: { x: 500, y: 400 } }] }, ctx)
  assert.equal(good.ok, true, good.error)
  assert.deepEqual(useDocStore.getState().pages[PAGE].objects[note.id].position, { x: 500, y: 400 })
  const bad = await runTool(
    'scene.edit',
    { ops: [{ op: 'update', id: note.id, position: { x: 1, y: 1 } }, { op: 'remove', ids: ['ghost'] }] },
    ctx
  )
  assert.equal(bad.ok, false)
  assert.deepEqual(useDocStore.getState().pages[PAGE].objects[note.id].position, { x: 500, y: 400 }, 'half a patch must never apply')
})

test('scene.add rejects a component that does not exist and lists nothing it invented', async () => {
  const r = await runTool('scene.add', { component: 'flux-capacitor' }, ctx)
  assert.equal(r.ok, false)
  assert.equal(objects().length, 0)
})

test('scene.snapshot says so when the page is not on screen (no DOM) instead of throwing', async () => {
  const r = await runTool('scene.snapshot', {}, ctx)
  assert.equal(r.ok, false)
  assert.match(r.error, /not on screen/)
})

test('scene.components can be filtered', async () => {
  const r = await runTool('scene.components', { query: 'resistor' }, ctx)
  assert.equal(r.ok, true)
  assert.match(r.summary, /resistor/)
})

test('run → measure reads REAL physics: a dropped ball moves', async () => {
  const r = await runTool(
    'scene.script',
    { script: 'var g = create("ground", {x: 0, y: 700, width: 600, height: 20});\nvar m = create("mass", {mass: 1, x: 200, y: 50});' },
    ctx
  )
  assert.equal(r.ok, true, r.error)
  const mass = objects().find((o) => o.behaviors.some((b) => b.type === 'rigidBody'))
  assert.ok(mass, 'a rigid body exists')

  const early = await runTool('scene.measure', { id: mass.id, channel: 'y' }, ctx)
  assert.equal(early.ok, false, 'nothing to measure before running')
  assert.match(early.error, /Run the simulation/)

  assert.equal((await runTool('scene.run', {}, ctx)).ok, true)
  assert.equal(useRuntimeStore.getState().mode, 'running')
  await new Promise((r) => setTimeout(r, 600))
  const ch = await runTool('scene.measure', { id: mass.id }, ctx)
  assert.equal(ch.ok, true, ch.error)
  assert.match(ch.summary, /y/)
  // Dropped from 5 cm (the world is 1000 px/m) it hits the ground inside the
  // wait and may already be bouncing — so assert it MOVED and has energy,
  // not the sign of a velocity at an arbitrary instant.
  const y = await runTool('scene.measure', { id: mass.id, channel: 'y' }, ctx)
  assert.equal(y.ok, true, y.error)
  assert.ok(y.data.max - y.data.min > 5, `the ball fell: y range ${y.data.min}..${y.data.max}`)
  const ke = await runTool('scene.measure', { id: mass.id, channel: 'ke' }, ctx)
  assert.ok(ke.data.max > 0, 'it had kinetic energy')

  assert.equal((await runTool('scene.pause', {}, ctx)).ok, true)
  assert.equal(useRuntimeStore.getState().mode, 'paused')
  assert.equal((await runTool('scene.reset', {}, ctx)).ok, true)
  assert.equal(useRuntimeStore.getState().mode, 'edit')
  const bad = await runTool('scene.measure', { id: mass.id, channel: 'banana' }, ctx)
  assert.equal(bad.ok, false)
})

test('scene.run on an empty page says so instead of starting nothing', async () => {
  const r = await runTool('scene.run', {}, ctx)
  assert.equal(r.ok, false)
  assert.match(r.error, /empty/)
})

test('scene.build without a model fails honestly', async () => {
  m.setToolGenerator(null)
  const r = await runTool('scene.build', { request: 'a pendulum' }, ctx)
  assert.equal(r.ok, false)
  assert.match(r.error, /No AI model/)
})

test('scene.build uses the supplied generator, verifies, and places the result', async () => {
  m.setToolGenerator(async () => ({
    name: 'fake',
    generate: async () => 'var b = create("battery", {V: 5});\nvar r = create("resistor", {R: 10});\nconnect(b.positive, r.a);\nconnect(r.b, b.negative);',
  }))
  const r = await runTool('scene.build', { request: 'a battery and a resistor' }, ctx)
  assert.equal(r.ok, true, r.error)
  assert.ok(objects().length >= 2)
  m.setToolGenerator(null)
})

test('page tools: create a page, list it, open another, refuse a bad id', async () => {
  const ws = useWorkspaceStore.getState()
  const nb = ws.addNotebook('AI test notebook')
  const first = ws.addPageIn(nb, 'First')
  assert.equal(useWorkspaceStore.getState().activePageId, first)

  const made = await runTool('page.create', { name: 'Made by AI', kind: 'doc' }, ctx)
  assert.equal(made.ok, true, made.error)
  assert.equal(useWorkspaceStore.getState().activePageId, made.data.id, 'creating opens it')
  assert.equal(useWorkspaceStore.getState().nodes[made.data.id].pageKind, 'doc')

  const list = await runTool('page.list', { query: 'made by' }, ctx)
  assert.match(list.summary, /Made by AI \[doc\]/)

  const open = await runTool('page.open', { id: first }, ctx)
  assert.equal(open.ok, true, open.error)
  assert.equal(useWorkspaceStore.getState().activePageId, first)

  const bad = await runTool('page.open', { id: 'nope' }, ctx)
  assert.equal(bad.ok, false)
  assert.match(bad.error, /page\.list/)
})

test('slides.from_markdown makes a real deck page with one slide per heading', async () => {
  const ws = useWorkspaceStore.getState()
  const nb = ws.addNotebook('Deck notebook')
  const here = ws.addPageIn(nb, 'Anchor')
  const r = await runTool('slides.from_markdown', { markdown: '# Ohm\n- V = IR\n\n# Power\n- P = VI', title: 'Basics' }, { pageId: here })
  assert.equal(r.ok, true, r.error)
  const deck = useWorkspaceStore.getState().nodes[r.data.id]
  assert.equal(deck.pageKind, 'pptx')
  assert.ok(deck.docPages.length >= 2, `expected ≥ 2 slides, got ${deck.docPages.length}`)
})

test('bridge modes are enforced at EXECUTION, not just in the tool list', async () => {
  const { serveCall, visibleSpecs, allowedIn } = m
  assert.deepEqual(visibleSpecs('off'), [])
  const read = visibleSpecs('read').map((t) => t.name)
  assert.ok(read.includes('scene.describe') && read.includes('scene.measure'))
  assert.ok(!read.includes('scene.add') && !read.includes('scene.run') && !read.includes('scene.script'), 'read-only lists no writers and no runners')
  assert.equal(visibleSpecs('full').length, listTools().length)
  assert.equal(allowedIn('read', 'run'), false)

  // A client that ignores the list and calls a writer anyway is still stopped.
  const blocked = await serveCall('scene.add', { component: 'note', text: 'x' }, 'read')
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /forbidden|Read only/i)
  assert.equal(objects().length, 0, 'nothing was written')
  const unknown = await serveCall('nope.nope', {}, 'full')
  assert.equal(unknown.ok, false)
})
