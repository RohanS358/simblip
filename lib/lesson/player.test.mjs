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
    settle: async () => {},
    scene: async (s) => void log.push(`scene:${s}`),
    equation: async (l) => void log.push(`eq:${l}`),
    run: async (s) => void log.push(`run:${s}`),
    point: async (o) => void log.push(`point:${o}`),
    lab: async (o, n) => void log.push(`lab:${o}:${n}`),
    code: async (o, n) => void log.push(`code:${o}:${n.length}`),
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

test('seeking rebuilds EVERY earlier section (the board keeps them all), instantly', async () => {
  assert.deepEqual(catchUp(sb, 4).map((b) => b.t === 'title' ? `T:${b.text}` : b.t === 'scene' ? b.script : b.t === 'say' ? `say:${b.text}` : b.latex), ['T:A', 'S1', 'say:one', 'E1'])
  assert.deepEqual(catchUp(sb, 0), [])
  // a prediction's demo is a section too, so a seek past it brings it back
  assert.deepEqual(catchUp(sb, 6).filter((b) => b.t === 'scene').map((b) => b.script), ['S1', 'DEMO', 'S2'])
  const { stage, log } = fake(1)
  await perform(sb, stage, 7) // jump straight past "two"
  assert.deepEqual(log, ['title:A', 'scene:S1', 'say:one', 'eq:E1', 'scene:DEMO', 'scene:S2', 'say:two'])
})

test('point and animate beats are performed in order', async () => {
  const sb2 = { title: 'T', beats: [{ t: 'point', object: 'r1', text: 'look' }, { t: 'animate', object: 'r1', param: 'R', from: 100, to: 1000, seconds: 5 }] }
  const { stage, log } = fake()
  await perform(sb2, stage)
  assert.deepEqual(log, ['point:r1', 'animate:r1.R:100->1000'])
})

test('a lab beat steps the named stepper', async () => {
  const { stage, log } = fake()
  await perform({ title: 'T', beats: [{ t: 'lab', object: 'lab', steps: 8 }] }, stage)
  assert.deepEqual(log, ['lab:lab:8'])
})

test('a code beat walks the DSA Lab through its narrated steps', async () => {
  const { stage, log } = fake()
  await perform({ title: 'T', beats: [{ t: 'code', object: 'lab', narration: [{ step: 0, text: 'start' }, { step: 5, text: 'swap' }] }] }, stage)
  assert.deepEqual(log, ['code:lab:2'])
})
