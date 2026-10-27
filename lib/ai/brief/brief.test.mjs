// The page brief and the reply tidier. Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { bundle } from '../../../scripts/test/bundle.mjs'

const m = await bundle(`export { briefPage } from '@/lib/ai/brief/page-brief'\nexport { tidyReply } from '@/lib/ai/brief/reply'\nexport { bm25, clip } from '@/lib/ai/brief/lexical'`, 'brief')

const num = (v) => ({ kind: 'number', expr: String(v), value: v })
const str = (v) => ({ kind: 'string', value: v })
const obj = (id, name, kind, x, y, w, h, parameters = {}, behaviors = []) => ({ id, name, geometry: { kind }, position: { x, y }, size: { w, h }, rotation: 0, z: 0, behaviors, parameters, metadata: {} })

const projectile = {
  variables: [{ id: 'v', name: 'vx', expr: '10', value: 10 }],
  objects: Object.fromEntries([
    obj('s1', 'vxs', 'slider', 230, 257, 240, 80, { label: str('Horizontal speed (m/s)'), min: num(2), max: num(20), value: num(10), targetParamName: str('vx') }),
    obj('n1', 'note', 'note', 230, 647, 380, 153, { text: str('**Projectile motion.** The ball leaves at 10 m/s and 45° above the horizontal. The range is R = v² sin(2θ) / g = 10.2 m.') }),
    obj('g1', 'graph', 'graph', 230, 367, 380, 260, { sourceId: str('b1'), yChannels: str('vy') }),
    obj('b1', 'Ball', 'circle', 300, -13, 70, 70, {}, [{ type: 'rigidBody', enabled: true, params: { mass: num(2) } }]),
    obj('f1', 'floor', 'rect', 250, 97, 860, 26, {}, [{ type: 'staticBody', enabled: true, params: {} }]),
  ].map((o) => [o.id, o])),
}

test('a board is told in words: topic, controls with what they drive, graph with its source, parts with roles', () => {
  const b = m.briefPage({ title: 'Untitled', kind: 'board', doc: projectile, question: 'why does the range depend on angle?' })
  assert.match(b.text, /About: Projectile motion/)
  assert.match(b.text, /slider “Horizontal speed \(m\/s\)”.*sets the variable vx/)
  assert.match(b.text, /graph plotting vy of “Ball”/)
  assert.match(b.text, /“Ball”.*moves under physics/)
  assert.match(b.text, /“floor”.*fixed in place/)
  assert.doesNotMatch(b.text, /at \(\d+,\d+\)|\d+x\d+/, 'no raw coordinates or sizes in the account of the page')
  assert.equal(b.names.b1, 'Ball')
})

test('ids stay available for edits, in brackets', () => {
  const b = m.briefPage({ title: 'P', kind: 'board', doc: projectile })
  assert.match(b.text, /\[s1\]/)
  assert.match(b.text, /\[b1\]/)
})

test('a selection is named first and is never dropped', () => {
  const b = m.briefPage({ title: 'P', kind: 'board', doc: projectile, selection: ['b1'], budget: 500 })
  assert.match(b.text, /The student has selected: .*Ball/)
})

test('long material: best passages whole, the rest as an outline, within the budget', () => {
  const items = Array.from({ length: 60 }, (_, i) => ({
    kind: 'text',
    locator: `p. ${i + 1}`,
    text: i === 41 ? 'The Thevenin equivalent replaces a network by one voltage source in series with one resistor. To find it, remove the load and measure the open-circuit voltage.' : `Section ${i} discusses topic number ${i} of mechanical vibration in considerable and unremarkable detail, with several sentences of filler. ${'More filler text about nothing in particular. '.repeat(6)}`,
  }))
  const b = m.briefPage({ title: 'Notes', kind: 'pdf', items, question: 'explain the Thevenin equivalent', budget: 3000 })
  assert.ok(b.text.length <= 3200, `brief is ${b.text.length} chars`)
  assert.match(b.text, /p\. 42: .*Thevenin equivalent replaces a network/)
  assert.ok(b.stats.summarised > 0 && b.stats.shown < b.stats.items)
})

test('the same input gives the same brief', () => {
  const a = m.briefPage({ title: 'P', kind: 'board', doc: projectile, question: 'range' })
  const c = m.briefPage({ title: 'P', kind: 'board', doc: projectile, question: 'range' })
  assert.equal(a.text, c.text)
})

test('relevance: a question about resistors finds the passage about resistors', () => {
  const s = m.bm25('series resistors', ['The capacitor stores charge.', 'Resistors in series add: R = R1 + R2.', 'Light travels in straight lines.'])
  assert.ok(s[1] > s[0] && s[1] > s[2])
})

test('reply tidying: thinking, fences, filler, ids, stray maths and repeats go', () => {
  const raw = '<think>hmm</think>```markdown\nSure! The "b1" moves at $v = 10.\n\nThe range is long enough to repeat here.\n\nThe range is long enough to repeat here.\n```'
  const t = m.tidyReply(raw.replace('"b1"', '"mvj6i7byqamz9t"'), { mvj6i7byqamz9t: 'Ball' })
  assert.doesNotMatch(t, /think|```|Sure|mvj6i7/)
  assert.match(t, /“Ball” moves at v = 10/)
  assert.equal(t.split('The range is long enough to repeat here.').length - 1, 1)
})

// ── the cached summary map of a very long document ──────────────────────────
const s = await bundle(`export * from '@/lib/ai/brief/summary'\nexport { briefPage } from '@/lib/ai/brief/page-brief'`, 'brief-summary')

const longDoc = Array.from({ length: 80 }, (_, i) => ({ kind: 'text', locator: `p. ${i + 1}`, text: `Chapter ${i}: ${'This part explains a particular idea at some length with examples. '.repeat(8)}` }))

test('short documents are left to retrieval: no model call, no summary', async () => {
  let calls = 0
  const llm = { complete: async () => (calls++, 'x'), script: async () => '' }
  assert.equal(s.ensureSummary(longDoc.slice(0, 3), () => llm), undefined)
  assert.equal(calls, 0)
})

test('a long document is summarised section by section, then overall, and remembered under a hash of its text', async () => {
  const seen = []
  const llm = { complete: async (system, user) => (seen.push(system.slice(0, 20)), /one-line summaries/.test(system) ? '**This document teaches ideas.**' : `This section covers ${user.slice(0, 12).replace(/\W+/g, ' ')}.`), script: async () => '' }
  const sum = await s.summariseDocument(longDoc, llm)
  assert.ok(sum.groups.length > 3 && sum.groups.length <= 80)
  assert.equal(sum.groups[0].from, 0)
  assert.equal(sum.groups.at(-1).to, longDoc.length - 1, 'every item is inside some section')
  assert.equal(sum.overview, 'This document teaches ideas.', 'markdown is stripped before it is stored')
  assert.equal(s.cachedSummary(sum.key)?.overview, sum.overview)
  assert.equal(s.summaryFor(longDoc)?.key, sum.key)
  assert.equal(s.summaryFor(longDoc.map((i, n) => (n === 5 ? { ...i, text: i.text + ' edited' } : i))), undefined, 'a changed document is a new key')
})

test('a model that fails still leaves a map: each section falls back to its own opening', async () => {
  const llm = { complete: async () => { throw new Error('offline') }, script: async () => '' }
  const sum = await s.summariseDocument(longDoc.slice(0, 12), llm)
  assert.ok(sum.groups.every((g) => g.gist.length > 10))
  assert.equal(sum.overview, '')
})

test('the brief carries the overview and a section map, and still finds the passage the question needs', async () => {
  const llm = { complete: async (system) => (/one-line summaries/.test(system) ? 'An overview of the whole.' : 'A gist of the section.'), script: async () => '' }
  const items = longDoc.map((i, n) => (n === 63 ? { ...i, text: 'Kirchhoff’s current law says the currents at a node sum to zero. Use it to write node equations.' } : i))
  const sum = await s.summariseDocument(items, llm)
  const b = s.briefPage({ title: 'Notes', kind: 'pdf', items, question: 'what does Kirchhoff’s current law say?', budget: 3500, summary: sum })
  assert.match(b.text, /Overview: An overview of the whole\./)
  assert.match(b.text, /Section map:\n- p\. 1.*: A gist of the section\./)
  assert.match(b.text, /p\. 64: Kirchhoff’s current law says/)
  assert.ok(b.text.length <= 3800, `brief is ${b.text.length} chars`)
})
