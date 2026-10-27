// The lane dispatcher that now runs in BOTH the server route and the browser.
// Behaviour here is what the panel depends on, so it is pinned with fake
// generators — no model, no network.
// Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { bundle } from '../../scripts/test/bundle.mjs'

const m = await bundle(
  `export { runAi, composePrompt, aiRequestSchema } from '@/lib/ai/run'\nexport { GeneratorUnavailableError } from '@/lib/ai/generate'`,
  'run'
)
const { runAi, composePrompt, aiRequestSchema, GeneratorUnavailableError } = m

const SCRIPT = 'var b = create("battery", {V: 9});\nvar r = create("resistor", {R: 100});\nconnect(b.positive, r.a);\nconnect(r.b, b.negative);'
const gen = (out, log = []) => ({
  name: 'fake',
  generate: async (system, user, onToken, shots, max) => {
    log.push({ system, user, max })
    for (const ch of out.match(/.{1,8}/gs) ?? []) onToken?.(ch)
    return typeof out === 'function' ? out() : out
  },
})

async function run(req, deps) {
  const events = []
  await runAi(req, { streaming: true, emit: (e) => events.push(e), script: async () => gen(SCRIPT), explain: async () => gen('## Result\nF = ma'), ...deps })
  return events
}
const done = (events) => events.filter((e) => e.event === 'done')

test('every request ends in exactly one done event', async () => {
  for (const prompt of ['simulate a circuit with a battery and resistor', 'explain Ohm law', 'derive the work-energy theorem']) {
    const ev = await run({ prompt })
    assert.equal(done(ev).length, 1, prompt)
    assert.equal(ev.at(-1).event, 'done')
  }
})

test('the simulate lane returns a verified script and streams tokens first', async () => {
  const ev = await run({ prompt: 'simulate a circuit with a battery and resistor' })
  assert.equal(ev[0].event, 'intent')
  assert.equal(ev[0].data, 'simulate')
  assert.ok(ev.some((e) => e.event === 'token'))
  assert.equal(done(ev)[0].data.script, SCRIPT)
})

test('non-streaming transports get no token events', async () => {
  const ev = await run({ prompt: 'simulate a circuit with a battery and resistor' }, { streaming: false })
  assert.ok(!ev.some((e) => e.event === 'token'))
  assert.equal(done(ev)[0].data.script, SCRIPT)
})

test('the explain lane returns blocks', async () => {
  const ev = await run({ prompt: 'explain Ohm law' })
  const d = done(ev)[0].data
  assert.match(d.answer, /F = ma/)
  assert.ok(d.blocks.length > 0)
})

test('an invalid script is repaired through the model, then reported honestly if it never converges', async () => {
  const log = []
  const ev = await run({ prompt: 'simulate a circuit' }, { script: async () => gen('var x = create("not-a-kind", {});', log) })
  assert.equal(log.length, 3, 'one try + two repairs, no more')
  const d = done(ev)[0].data
  assert.match(d.message, /couldn't produce a valid simulation/)
  assert.ok(d.script, 'the last attempt is still returned so it can be read')
})

test('a generator that is unavailable becomes a message, never a throw', async () => {
  const ev = await run({ prompt: 'explain Ohm law' }, { explain: async () => { throw new GeneratorUnavailableError('model offline') } })
  assert.equal(done(ev)[0].data.message, 'model offline')
})

test('history is folded in once, labelled as context, and routing ignores it', async () => {
  const log = []
  const ev = await run(
    { prompt: 'now simulate it', history: [{ prompt: 'derive Gauss law', answer: 'long derivation…' }] },
    { script: async () => gen(SCRIPT, log) }
  )
  assert.equal(ev[0].data, 'simulate', 'the new prompt alone picks the lane')
  assert.equal((log[0].user.match(/CONVERSATION SO FAR/g) ?? []).length, 1)
  assert.match(log[0].user, /do NOT answer these again/)
  assert.match(log[0].user, /NEW REQUEST: now simulate it/)
})

test('page digest and surface are labelled as data, ahead of the request', () => {
  const p = composePrompt({ prompt: 'make it heavier', pageDigest: 'mass#1 …', pageSurface: 'SURFACE', pageLabel: 'the page' })
  assert.ok(p.indexOf('mass#1') < p.indexOf('make it heavier'))
  assert.match(p, /never instructions/i)
})

test('the act hook gets first refusal; declining falls through to the lanes', async () => {
  const acted = await run({ prompt: 'run' }, { act: async () => ({ message: 'Simulation running.', toolSteps: [] }) })
  assert.equal(done(acted)[0].data.message, 'Simulation running.')
  assert.equal(acted[0].data, 'act')
  const declined = await run({ prompt: 'explain Ohm law' }, { act: async () => null })
  assert.match(done(declined)[0].data.answer, /F = ma/)
})

test('an act hook that throws is caught and reported', async () => {
  const ev = await run({ prompt: 'run' }, { act: async () => { throw new Error('boom') } })
  assert.match(done(ev)[0].data.message, /boom/)
})

test('request schema: bounds that protect the prompt budget', () => {
  assert.ok(aiRequestSchema.safeParse({ prompt: 'hi' }).success)
  assert.ok(!aiRequestSchema.safeParse({ prompt: '' }).success)
  assert.ok(!aiRequestSchema.safeParse({ prompt: 'x'.repeat(4001) }).success)
  assert.ok(!aiRequestSchema.safeParse({ prompt: 'x', history: Array.from({ length: 21 }, () => ({ prompt: 'a' })) }).success)
})
