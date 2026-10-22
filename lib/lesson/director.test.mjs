// The Director with a scripted "model" and the REAL engine: the answer to every
// prediction must come from the simulator, never from the model. Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { bundle } from '../../scripts/test/bundle.mjs'

const m = await bundle(
  `
export { planTopic, directLesson, fmt } from '@/lib/lesson/director'
export { makeRunner } from '@/lib/lesson/runner'
export { PLAN_JSON_SCHEMA, parsePlan, extractJson } from '@/lib/lesson/plan'
export { lintStoryboard } from '@/lib/lesson/storyboard'
`,
  'director'
)
const { planTopic, directLesson, fmt, makeRunner, PLAN_JSON_SCHEMA, parsePlan, extractJson } = m

const CIRCUIT = `var bat = create("battery", { V: 9, name: "bat" });
var r1 = create("resistor", { R: 330, name: "r1" });
var am = create("ammeter", { name: "am" });
connect(bat.positive, am.a, "wire");
connect(am.b, r1.a, "wire");
connect(r1.b, bat.negative, "wire");`

const PLAN = {
  title: "Ohm's law",
  steps: [
    { heading: 'Pressure and flow', say: ['A battery pushes charge round a loop.', 'A resistor limits how much flows.'], scene: 'A 9 V battery across a 330 ohm resistor with an ammeter', experiment: 'double the resistance' },
    { heading: 'The relationship', say: ['Current depends on voltage and resistance.'], equation: 'I = \\frac{V}{R}' },
  ],
}
const llm = (over = {}) => ({
  async complete(system, user) {
    if (/choose ONE experiment/.test(system)) return over.proposal ?? JSON.stringify({ object: 'r1', param: 'R', to: 660, watch_object: 'am', watch_channel: 'I' })
    return JSON.stringify(over.plan ?? PLAN)
  },
  async script() { if (over.scriptFails) throw new Error('model unavailable'); return over.script ?? CIRCUIT },
})

test('plan parsing tolerates fences and chatter, and repairs with an error worded for the model', async () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a": {"b": "}"}}\n```\nhope that helps'), { a: { b: '}' } })
  assert.equal(parsePlan('{"title":"x","steps":[]}').ok, false)
  let calls = 0
  const flaky = { async complete(_s, user) { calls++; return calls === 1 ? 'not json at all' : JSON.stringify(PLAN) }, async script() { return CIRCUIT } }
  const plan = await planTopic(flaky, "Ohm's law", 'basic', PLAN_JSON_SCHEMA)
  assert.equal(plan.steps.length, 2)
  assert.equal(calls, 2)
})

test('fmt uses SI prefixes and units', () => {
  assert.equal(fmt(0.0273, 'I'), '27.3 mA')
  assert.equal(fmt(9, 'V'), '9 V')
  assert.equal(fmt(1500, 'R'), '1.5 kΩ')
})

test('the prediction answer comes from the simulator: doubling R halves the current', async () => {
  const { storyboard: sb, warnings } = await directLesson("Ohm's law", PLAN, { llm: llm(), runner: makeRunner(), level: 'basic' })
  assert.deepEqual(warnings, [])
  assert.deepEqual(m.lintStoryboard(sb), [])
  const kinds = sb.beats.map((b) => b.t)
  for (const k of ['title', 'say', 'scene', 'point', 'run', 'equation', 'predict', 'animate']) assert.ok(kinds.includes(k), `missing ${k}`)
  const p = sb.beats.find((b) => b.t === 'predict')
  assert.equal(p.choices[p.correct], 'It decreases.', 'doubling R must DECREASE the current — measured, not guessed')
  assert.match(p.responses[p.correct], /^Yes\. Am's current went from 27\.\d mA to 13\.\d mA/)
  assert.match(p.responses[0], /fair guess/)
  const reading = sb.beats.find((b) => b.t === 'say' && /settles at/.test(b.text))
  assert.match(reading.text, /am's current settles at 27\.\d mA/, 'the quoted number is the measured one: 9 V / 330 Ω')
  const a = sb.beats.find((b) => b.t === 'animate')
  assert.deepEqual([a.object, a.param, a.from, a.to], ['r1', 'R', 330, 660])
})

test('an invalid experiment proposal is retried, then dropped honestly — never invented', async () => {
  const bad = JSON.stringify({ object: 'ghost', param: 'R', to: 5, watch_object: 'am', watch_channel: 'I' })
  const { storyboard: sb, warnings } = await directLesson('x', PLAN, { llm: llm({ proposal: bad }), runner: makeRunner(), level: 'basic' })
  assert.ok(!sb.beats.some((b) => b.t === 'predict'))
  assert.match(warnings[0], /experiment left out \(no such object/)
})

test('a scene that does not run is skipped with a warning; no working scene at all is an honest failure', async () => {
  await assert.rejects(directLesson('x', PLAN, { llm: llm({ script: 'var a = create("not-a-thing", {})' }), runner: makeRunner(), level: 'basic' }), /could not build a working simulation/)
  await assert.rejects(directLesson('x', PLAN, { llm: llm({ scriptFails: true }), runner: makeRunner(), level: 'basic' }), /could not build/)
})

test('an experiment whose change moves nothing is not taught as "no effect"', async () => {
  // Rescale an inert parameter: the simulator measures no change anywhere, so the lesson must drop it.
  const inert = JSON.stringify({ object: 'am', param: 'x', to: 5, watch_object: 'am', watch_channel: 'I' })
  const { storyboard: sb, warnings } = await directLesson('x', PLAN, { llm: llm({ proposal: inert }), runner: makeRunner(), level: 'basic' })
  assert.ok(!sb.beats.some((b) => b.t === 'predict'))
  assert.ok(warnings.length >= 1)
})
