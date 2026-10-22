// Sequencer behaviour with a scripted Stage. Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { perform, catchUp } from './player.ts'

const sb = {
  title: 'T',
  beats: [
    { t: 'title', text: 'A' },
    { t: 'scene', script: 'S1', clear: true },
    { t: 'say', text: 'one' },
    { t: 'equation', latex: 'E1' },
    { t: 'predict', id: 'q', prompt: 'p', choices: ['a', 'b'], correct: 1, responses: ['why a', 'yes b'], demo: 'DEMO' },
    { t: 'scene', script: 'S2', clear: true },
    { t: 'say', text: 'two' },
  ],
}
const fake = (answer = 1, aliveFor = Infinity) => {
  const log = []
  let beats = 0
  const stage = {
    say: async (t) => void log.push(`say:${t}`),
    title: async (t) => void log.push(`title:${t}`),
    scene: async (s) => void log.push(`scene:${s}`),
    equation: async (l) => void log.push(`eq:${l}`),
    run: async (s) => void log.push(`run:${s}`),
    point: async (o) => void log.push(`point:${o}`),
    animate: async (o, p, f, t) => void log.push(`animate:${o}.${p}:${f}->${t}`),
    ask: async () => answer,
    record: (b, c) => log.push(`record:${b.id}:${c === b.correct}`),
    onBeat: () => { beats++ },
    alive: () => beats < aliveFor,
    gate: async () => {},
  }
  return { stage, log }
}

test('plays every beat in order; a right answer is explained then demonstrated', async () => {
  const { stage, log } = fake(1)
  assert.equal(await perform(sb, stage), 'done')
  assert.deepEqual(log, ['title:A', 'scene:S1', 'say:one', 'eq:E1', 'record:q:true', 'say:yes b', 'scene:DEMO', 'run:4', 'scene:S2', 'say:two'])
})

test('a wrong prediction gets the reason for their choice, then the right answer, and is recorded as a miss', async () => {
  const { stage, log } = fake(0)
  await perform(sb, stage)
  const i = log.indexOf('record:q:false')
  assert.ok(i > 0)
  assert.equal(log[i + 1], 'say:why a')
  assert.match(log[i + 2], /^say:The answer is: b\. yes b/)
})

test('stopping mid-lesson halts immediately and reports it', async () => {
  const { stage, log } = fake(1, 3)
  assert.equal(await perform(sb, stage), 'stopped')
  assert.ok(!log.includes('say:two'))
})

test('seeking re-applies the latest scene and equations so the narration has its picture', async () => {
  assert.deepEqual(catchUp(sb, 4).map((b) => b.t === 'scene' ? b.script : b.latex), ['S1', 'E1'])
  assert.deepEqual(catchUp(sb, 0), [])
  const { stage, log } = fake(1)
  await perform(sb, stage, 6) // jump straight to "two"
  assert.deepEqual(log, ['scene:S2', 'say:two'])
})

test('point and animate beats are performed in order', async () => {
  const sb2 = { title: 'T', beats: [{ t: 'point', object: 'r1', text: 'look' }, { t: 'animate', object: 'r1', param: 'R', from: 100, to: 1000, seconds: 5 }] }
  const { stage, log } = fake()
  await perform(sb2, stage)
  assert.deepEqual(log, ['point:r1', 'animate:r1.R:100->1000'])
})
