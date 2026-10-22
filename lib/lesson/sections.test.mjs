// Section geometry: where the next idea goes, and which section a beat belongs to.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxOf, nextOrigin, sectionAt, sectionTitle, SECTION_GAP, bulletFor, notesMarkdown, notesHeight } from './sections.ts'

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
