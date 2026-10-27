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
