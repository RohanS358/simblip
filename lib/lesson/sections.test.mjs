// Section geometry: where the next idea goes, and which section a beat belongs to.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxOf, nextOrigin, sectionAt, sectionTitle, SECTION_GAP, bulletFor, notesMarkdown, notesHeight, definitionFrom, buildSummary, summaryMarkdown, glossaryMarkdown, studyMarkdown } from './sections.ts'

const o = (x, y, w, h) => ({ position: { x, y }, size: { w, h } })

test('the next section starts below everything, left-aligned with it', () => {
  assert.deepEqual(boxOf([o(10, 20, 100, 50), o(60, 100, 200, 80)]), { x: 10, y: 20, w: 250, h: 160 })
  assert.deepEqual(nextOrigin([o(10, 20, 100, 50), o(60, 100, 200, 80)], { x: 0, y: 0 }), { x: 10, y: 180 + SECTION_GAP })
  assert.deepEqual(nextOrigin([], { x: 40, y: 40 }), { x: 40, y: 40 })
})

test('a beat belongs to the latest section opened at or before it', () => {
  const secs = [{ id: 's1', beat: 1 }, { id: 's2', beat: 5 }]
  assert.equal(sectionAt(secs, 0), null)
  assert.equal(sectionAt(secs, 3).id, 's1')
  assert.equal(sectionAt(secs, 9).id, 's2')
})

test('a section is named after the chapter card before it, else Part N', () => {
  const beats = [{ t: 'title', text: 'Current' }, { t: 'scene' }, { t: 'say' }]
  assert.equal(sectionTitle(beats, 1, 1), 'Current')
  assert.equal(sectionTitle([{ t: 'scene' }], 0, 3), 'Part 3')
})

test('a spoken line becomes a short study bullet; fillers and fragments do not', () => {
  assert.equal(bulletFor('Current is the flow of charge round the circuit. It is measured in amperes.'), 'Current is the flow of charge round the circuit.')
  assert.equal(bulletFor('Now watch this.'), null)
  assert.equal(bulletFor("Let's look at the picture."), null)
  assert.ok(bulletFor('A '.repeat(120)).length <= 151)
})

test('the notes block is a heading and bullets, and grows with them', () => {
  assert.equal(notesMarkdown(['One.', 'Two.']), '**Key points**\n\n- One.\n- Two.')
  assert.ok(notesHeight(['a '.repeat(30), 'b '.repeat(30)]) > notesHeight(['a']))
})

test('definitions are found when a sentence names or defines a term, and not otherwise', () => {
  assert.deepEqual(definitionFrom('The opposition a part gives to the current is called resistance.')?.term, 'resistance')
  assert.equal(definitionFrom('Current is the flow of charge past a point each second.')?.term, 'current')
  assert.equal(definitionFrom('This is called a mistake you should avoid making again soon.'), null)
  assert.equal(definitionFrom('Press Simulate and watch the ammeter settle down.'), null)
  assert.equal(definitionFrom('Short.'), null)
  assert.equal(definitionFrom('Everything that follows is an attempt to predict numbers like these before measuring.'), null)
  assert.equal(definitionFrom('Something else is a good idea to try when you have time to spare.'), null)
})

test('the notes block adds a "Words to know" list when there are definitions', () => {
  const md = notesMarkdown(['A point.'], [{ term: 'current', meaning: 'flow of charge' }])
  assert.match(md, /Key points[\s\S]*Words to know[\s\S]*\*\*current\*\* — flow of charge/)
  assert.ok(notesHeight(['a'], 400, [{ term: 't', meaning: 'm '.repeat(40) }]) > notesHeight(['a']))
})

test('the summary gathers every section: points, formulas, a sorted glossary without duplicates', () => {
  const secs = [
    { id: 's1', title: 'Setup', ids: [], beat: 0, bullets: ['One.', 'Two.', 'Three.', 'Four.'], formulas: [{ latex: 'V=IR', text: 'Ohm' }], definitions: [{ term: 'voltage', meaning: 'push' }], checks: [] },
    { id: 's2', title: 'Sweep', ids: [], beat: 4, bullets: ['Five.'], definitions: [{ term: 'Voltage', meaning: 'dup' }, { term: 'current', meaning: 'flow' }], checks: [{ q: 'Q?', a: 'A' }] },
    { id: 's3', title: 'Empty', ids: [], beat: 9 },
  ]
  const sum = buildSummary('Ohm', secs)
  assert.deepEqual(sum.parts.map((p) => p.title), ['Setup', 'Sweep'])
  assert.deepEqual(sum.glossary.map((g) => g.term), ['current', 'voltage'])
  assert.deepEqual(sum.formulas, [{ latex: 'V=IR', text: 'Ohm', section: 'Setup' }])
  assert.match(summaryMarkdown(sum), /\*\*1\. Setup\*\*[\s\S]*- Three\.(?![\s\S]*- Four)/)
  assert.match(glossaryMarkdown(sum), /Words to remember/)
  assert.equal(glossaryMarkdown({ ...sum, glossary: [] }), '')
})

test('the study notes export has each section, its formulas and checks, then a formula sheet and glossary', () => {
  const md = studyMarkdown('Ohm', [{ id: 's1', title: 'Setup', ids: [], beat: 0, bullets: ['Point one.'], formulas: [{ latex: 'V=IR', text: 'Ohm' }], definitions: [{ term: 'voltage', meaning: 'push' }], checks: [{ q: 'Q?', a: 'A' }] }])
  assert.match(md, /^# Ohm/)
  assert.match(md, /## 1\. Setup[\s\S]*- Point one\.[\s\S]*\$V=IR\$ — Ohm[\s\S]*Answer: A[\s\S]*## Formula sheet[\s\S]*## Glossary/)
})

test('long lines are cut at a natural pause, and Check lines stay out of the key points', () => {
  const long = 'Commit to an answer before reading on, because being wrong here is the most useful thing that can happen in this lesson since it is the fastest way to find out what you believe.'
  const b = bulletFor(long)
  assert.ok(b.endsWith('…') && b.length < 150 && b.startsWith('Commit to an answer before reading on'))
  const sum = buildSummary('T', [{ id: 's', title: 'A', ids: [], beat: 0, bullets: ['Real point here, long enough.', 'Check: question — answer'], checks: [{ q: 'q', a: 'a' }] }])
  assert.deepEqual(sum.parts[0].points, ['Real point here, long enough.'])
})
