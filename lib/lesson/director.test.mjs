// The Director with a scripted "model" and the REAL engine: the answer to every
// prediction must come from the simulator, never from the model. Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { bundle } from '../../scripts/test/bundle.mjs'

const m = await bundle(
  `
export { planTopic, directLesson, fmt, NeedsClarification } from '@/lib/lesson/director'
export { makeRunner } from '@/lib/lesson/runner'
export { PLAN_JSON_SCHEMA, parsePlan, extractJson, normalizePlan } from '@/lib/lesson/plan'
export { lintStoryboard } from '@/lib/lesson/storyboard'
`,
  'director'
)
const { planTopic, directLesson, fmt, NeedsClarification, makeRunner, PLAN_JSON_SCHEMA, parsePlan, extractJson, normalizePlan } = m

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
    if (/concept diagram/.test(system)) return over.diagram ?? ''
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

test('a scene that does not run is skipped with a warning; with no working scene the lesson is delivered text-only and SAYS it is unverified', async () => {
  for (const bad of [{ script: 'var a = create("not-a-thing", {})' }, { scriptFails: true }]) {
    const { storyboard: sb, warnings } = await directLesson('x', PLAN, { llm: llm(bad), runner: makeRunner(), level: 'basic' })
    assert.ok(!sb.beats.some((b) => b.t === 'scene'))
    assert.match(sb.beats.find((b) => b.t === 'say').text, /not checked by the simulator/)
    assert.ok(warnings.some((w) => /unverified, text-only/.test(w)))
    assert.deepEqual(m.lintStoryboard(sb), [])
  }
})

test('an experiment whose change moves nothing is not taught as "no effect"', async () => {
  // Rescale an inert parameter: the simulator measures no change anywhere, so the lesson must drop it.
  const inert = JSON.stringify({ object: 'am', param: 'x', to: 5, watch_object: 'am', watch_channel: 'I' })
  const { storyboard: sb, warnings } = await directLesson('x', PLAN, { llm: llm({ proposal: inert }), runner: makeRunner(), level: 'basic' })
  assert.ok(!sb.beats.some((b) => b.t === 'predict'))
  assert.ok(warnings.length >= 1)
})

test('a topic the model does not recognise becomes a question, not an invented lesson', async () => {
  const unsure = { async complete() { return JSON.stringify({ title: 'Kendall', unsure: 'Did you mean Kendall’s tau (rank correlation) or Kendall’s notation for queues?', steps: [] }) }, async script() { return '' } }
  await assert.rejects(planTopic(unsure, "Kendall's theorem", 'basic', PLAN_JSON_SCHEMA), (e) => e instanceof NeedsClarification && /Kendall’s tau/.test(e.message))
  assert.equal(parsePlan('{"title":"x","steps":[{"heading":"a","say":["one two three"]}]}').ok, false, 'a plan with one step and no "unsure" is still invalid')
})

test('a plan in the wrong shape (what a hosted model returns when it ignores the schema) is repaired, not rejected', () => {
  // Real reply for "quantum physics": no title, no headings, "say" a string, and "unsure" set beside a full lesson.
  const reply = JSON.stringify({
    unsure: 'Do you mean quantum mechanics, quantum computing, or quantum physics in general?',
    steps: [
      { say: 'Particles like electrons can behave as waves.', scene: 'A particle wave simulator showing a single particle as a wave.' },
      { say: 'When observed, particles behave like particles.', scene: 'A particle wave simulator showing the wave collapsing into a particle.' },
      { say: 'The Schrödinger equation describes quantum states.', equation: 'i\\hbar \\frac{\\partial}{\\partial t} \\psi = \\hat{H} \\psi' },
    ],
  })
  const r = parsePlan(reply, 'quantum physics')
  assert.equal(r.ok, true)
  assert.equal(r.plan.title, 'Quantum Physics')
  assert.equal(r.plan.unsure, undefined, 'a lesson that was written is taught, not turned into a question')
  assert.deepEqual(r.plan.steps[0].say, ['Particles like electrons can behave as waves.'])
  assert.equal(r.plan.steps[0].heading, 'Particles like electrons can behave as waves')
  assert.ok(r.plan.steps[2].equation)
})

test('normalising never invents a lesson: no usable steps stays invalid; "unsure" with no steps stays a question', () => {
  assert.equal(parsePlan('{"title":"x","steps":[{"heading":"a"}]}').ok, false)
  const q = parsePlan('{"unsure":"Do you mean A or B?","steps":[]}', 'thing')
  assert.equal(q.ok, true)
  assert.equal(q.plan.unsure, 'Do you mean A or B?')
  assert.equal(normalizePlan({ steps: Array.from({ length: 12 }, () => ({ say: ['One two three.'] })) }, 't').steps.length, 8)
})

test('JSON slips a model actually makes are repaired: a doubled quote on a key, a dangling comma', () => {
  // Real: after a dropped "heading" the model wrote  { ""say": [...] }
  const reply = '{"title":"Newton","steps":[{"heading":"Inertia","say":["Objects keep moving."]},{\n  ""say": ["Force equals mass times acceleration."],\n "equation": "F = ma",\n},]}'
  const r = parsePlan(reply, 'newton')
  assert.equal(r.ok, true)
  assert.equal(r.plan.steps.length, 2)
  assert.equal(r.plan.steps[1].heading, 'Force equals mass times acceleration')
  assert.deepEqual(extractJson('{"a":[1,2,],}'), { a: [1, 2] })
  assert.deepEqual(extractJson('{"s":[{\n " "heading": "x"}]}'), { s: [{ heading: 'x' }] }) // a quote, a space, then the key
})

test('a step the simulator cannot draw gets a concept diagram, and every section reads title → picture → words', async () => {
  const diagram = 'direction: right\n[Electrons as waves] as w #blue\n[Pass two slits] as s #mint\n[Interference] as p #amber\nw -> s : travel\ns -> p : overlap'
  const { storyboard: sb } = await directLesson('x', PLAN, { llm: llm({ scriptFails: true, diagram }), runner: makeRunner(), level: 'basic', diagrams: true })
  const scenes = sb.beats.filter((b) => b.t === 'scene')
  assert.ok(scenes.length >= 1 && scenes.every((b) => b.script.startsWith('diagram(')), 'a diagram stands in for the missing simulation')
  // Each section: its scene comes BEFORE the lines said about it.
  const i = sb.beats.findIndex((b) => b.t === 'scene')
  assert.equal(sb.beats[i - 1].t, 'title')
  assert.equal(sb.beats[i + 1].t, 'say')
  assert.deepEqual(m.lintStoryboard(sb), [])
  // a nonsense diagram is dropped, not drawn
  const { storyboard: bare } = await directLesson('x', PLAN, { llm: llm({ scriptFails: true, diagram: 'I cannot draw that.' }), runner: makeRunner(), level: 'basic', diagrams: true })
  assert.ok(!bare.beats.some((b) => b.t === 'scene'))
})
