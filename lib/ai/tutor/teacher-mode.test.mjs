// The assistant's Teacher switch: with it on, an ordinary question becomes a lesson about the open page;
// explicit commands keep their own route; with it off nothing changes. Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { bundle } from '../../../scripts/test/bundle.mjs'

const m = await bundle(`export { planFor } from '@/lib/ai/tutor/act'\nexport { askSystem } from '@/lib/lesson/solve'`, 'teacher-mode')

test('teacher on: a plain question goes to teach.ask', () => {
  const p = m.planFor({ prompt: 'why does the current drop here?', teacher: true })
  assert.deepEqual(p, { kind: 'direct', tool: 'teach.ask', args: { question: 'why does the current drop here?' } })
})

test('teacher on: explicit lessons and quick commands keep their route', () => {
  assert.equal(m.planFor({ prompt: "teach me Ohm's law", teacher: true }).tool, 'teach.lesson')
  assert.equal(m.planFor({ prompt: 'teach me whatever is in this page', teacher: true }).tool, 'teach.page')
  assert.equal(m.planFor({ prompt: 'run it', teacher: true }).kind, 'quick')
})

test('teacher off: ordinary questions are not turned into lessons', () => {
  assert.notEqual(m.planFor({ prompt: 'why does the current drop here?' })?.tool, 'teach.ask')
})

test('the ask prompt answers the question, not the whole page', () => {
  const s = m.askSystem('basic', false)
  assert.match(s, /Answer THE QUESTION/)
  assert.match(s, /do not recite the whole page/)
})
