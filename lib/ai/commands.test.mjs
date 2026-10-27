// Slash commands are routed by name, never by guessing from the wording. Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { bundle } from '../../scripts/test/bundle.mjs'

const m = await bundle(`export * from '@/lib/ai/commands'\nexport { toolLabel, repeatsSteps } from '@/lib/tools/present'`, 'commands')

test('/teach names the lesson tool and passes the topic as typed', () => {
  const p = m.parseCommand('/teach whatever is in this page')
  assert.deepEqual(p.plan, { kind: 'tool', tool: 'teach.lesson', args: { topic: 'whatever is in this page' } })
})

test('/teach-page and /teach-course go to their own tools', () => {
  assert.equal(m.parseCommand('/teach-page').plan.tool, 'teach.page')
  assert.deepEqual(m.parseCommand('/teach-course basic circuits').plan.args, { name: 'basic circuits' })
})

test('missing argument, unknown command and non-commands', () => {
  assert.match(m.parseCommand('/teach').error, /needs something/)
  assert.match(m.parseCommand('/teech x').error, /don't have a \/teech/)
  assert.equal(m.parseCommand('/usr/bin/x'), null)
  assert.equal(m.parseCommand('teach me x'), null)
})

test('the menu filters by prefix', () => {
  assert.deepEqual(m.matchCommands('/teach').map((c) => c.name), ['teach', 'teach-page', 'teach-course'])
  assert.ok(m.matchCommands('/').length > 10)
  assert.deepEqual(m.matchCommands('hello'), [])
})

test('tools read as words, and an answer that repeats a step is dropped', () => {
  assert.equal(m.toolLabel('teach.lesson'), 'Teaching a lesson')
  assert.equal(m.toolLabel('foo.bar_baz'), 'Foo bar baz')
  assert.equal(m.repeatsSteps('Hi', [{ summary: 'Hi' }]), true)
  assert.equal(m.repeatsSteps('Other', [{ summary: 'Hi' }]), false)
})

const wm = await bundle(`export { parseWhen } from '@/lib/calendar/when'`, 'when')
const now = new Date(2026, 9, 27, 10, 0) // Tuesday 27 Oct 2026, 10:00

test('/remind, /event, /todo, /notes, /recall, /slides route to their tools', () => {
  assert.equal(m.parseCommand('/remind call mom tomorrow 5pm').plan.tool, 'life.remind')
  assert.equal(m.parseCommand('/event exam friday 10am').plan.tool, 'life.event')
  assert.deepEqual(m.parseCommand('/todo buy wire').plan.args, { text: 'buy wire' })
  assert.equal(m.parseCommand('/notes x').plan.tool, 'life.note')
  assert.deepEqual(m.parseCommand('/recall What is Ohm? | V = IR').plan.args, { conceptId: 'chat', front: 'What is Ohm?', back: 'V = IR' })
  assert.match(m.parseCommand('/recall just a question').error, /question and an answer/)
  assert.deepEqual(m.parseCommand('/slides ohms law').plan, { kind: 'lane', intent: 'explain', prompt: 'Make slides on ohms law' })
})

test('parseWhen finds the day, the time and the title', () => {
  assert.deepEqual(wm.parseWhen('call mom tomorrow 5pm', now), { title: 'call mom', date: '2026-10-28', time: '17:00' })
  assert.deepEqual(wm.parseWhen('exam on friday at 10:30', now), { title: 'exam', date: '2026-10-30', time: '10:30' })
  assert.deepEqual(wm.parseWhen('stretch in 2 hours', now), { title: 'stretch', date: '2026-10-27', time: '12:00' })
  assert.deepEqual(wm.parseWhen('submit report 2026-11-02', now), { title: 'submit report', date: '2026-11-02', time: undefined })
  assert.equal(wm.parseWhen('water plants at 9am', now).date, '2026-10-28')
  assert.equal(wm.parseWhen('just a title', now).date, undefined)
})
