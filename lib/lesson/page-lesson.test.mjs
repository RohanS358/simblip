// Reading a page and turning it into a tour. Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { bundle } from '../../scripts/test/bundle.mjs'

const m = await bundle(`
export { readPage, readSheet, flowBlocks } from '@/lib/lesson/page-read'
export { pageStoryboard, explainItems, fallbackLine } from '@/lib/lesson/page-lesson'
export { lintStoryboard } from '@/lib/lesson/storyboard'
export { useDocStore } from '@/lib/store/document'
export { executeSimScript } from '@/lib/scene/simscript'
`, 'page-lesson')
const { readPage, readSheet, flowBlocks, pageStoryboard, explainItems, fallbackLine, lintStoryboard, useDocStore, executeSimScript } = m

const page = (script) => { const id = `pl-${Math.random().toString(36).slice(2, 7)}`; useDocStore.getState().loadPage(id); executeSimScript(id, script, { x: 0, y: 0 }); return { id, doc: useDocStore.getState().pages[id] } }
const CIRCUIT = 'var bat = create("battery", { V: 9, name: "bat" });\nvar r1 = create("resistor", { R: 330, name: "r1" });\nvar am = create("ammeter", { name: "am" });\nconnect(bat.positive, am.a, "wire");\nconnect(am.b, r1.a, "wire");\nconnect(r1.b, bat.negative, "wire");'

test('a board is read in reading order: the note and the circuit (as ONE figure) side by side first, the formula below them last', () => {
  const { id, doc } = page(`var n = create("note", { x: 0, y: 0, text: "**Ohm's law** relates voltage and current." });\n${CIRCUIT}\nvar f = create("formula", { x: 0, y: 900, latex: "V = IR" });`)
  const items = readSheet(id, doc)
  const kinds = items.map((i) => i.kind)
  assert.equal(kinds.filter((k) => k === 'figure').length, 1, 'a circuit is one figure, not a dozen parts')
  assert.ok(kinds.includes('text'), 'the note is read too')
  assert.equal(kinds.at(-1), 'formula')
  const fig = items.find((i) => i.kind === 'figure')
  assert.ok(fig.ids.length >= 4 && fig.live, 'the figure holds its parts and knows it is a live simulation')
  assert.match(items.find((i) => i.kind === 'text').text, /^Ohm's law relates voltage and current\.$/, 'markdown is stripped from what is said')
})

test('document text is read block by block', () => {
  const flow = JSON.stringify({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Resistors' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'A resistor limits current.' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Measured in ohms' }] }] }] },
  ] })
  assert.deepEqual(flowBlocks(flow), ['Resistors', 'A resistor limits current.', 'Measured in ohms'])
  assert.deepEqual(flowBlocks(''), [])
})

test('the tour: focus each thing, then say it; every line is grounded; the storyboard is playable', async () => {
  const { id, doc } = page(`var n = create("note", { x: 0, y: 0, text: "Voltage pushes current." });\n${CIRCUIT}`)
  const reading = readPage({ title: 'My circuits', kind: 'board', sheets: [{ pageId: id, doc }] })
  const llm = { async complete(_s, user) { const idx = [...user.matchAll(/^#(\d+) /gm)].map((x) => Number(x[1])); return JSON.stringify({ lines: idx.map((i) => ({ i, text: `Item ${i} explained.` })) }) }, async script() { return '' } }
  const ex = await explainItems(llm, reading.items)
  assert.equal(ex.size, reading.items.length)
  const sb = pageStoryboard(reading, ex)
  assert.deepEqual(lintStoryboard(sb), [])
  assert.equal(sb.beats[0].t, 'title')
  const focusAt = sb.beats.findIndex((b) => b.t === 'focus')
  assert.equal(sb.beats[focusAt + 1].t, 'say', 'the thing is brought into view, then explained')
  assert.ok(sb.beats.some((b) => b.t === 'run'), 'the live simulation is run while she talks')
  assert.match(sb.beats.at(-1).text, /everything on this page/)
})

test('without a model she still reads the page: every item falls back to its own words', async () => {
  const { id, doc } = page(`var n = create("note", { x: 0, y: 0, text: "Voltage pushes current. It is measured in volts." });\n${CIRCUIT}`)
  const reading = readPage({ title: 'T', kind: 'board', sheets: [{ pageId: id, doc }] })
  const ex = await explainItems({ async complete() { return 'sorry, no' }, async script() { return '' } }, reading.items)
  assert.equal(ex.size, 0)
  const sb = pageStoryboard(reading, ex)
  assert.deepEqual(lintStoryboard(sb), [])
  assert.ok(sb.beats.some((b) => b.t === 'say' && /Voltage pushes current/.test(b.text)), 'text is read as written')
  assert.match(fallbackLine({ kind: 'formula', ids: ['x'], pageId: 'p', text: 'V = I R' }), /formula says/)
})
