// The tool-using lane: a scripted "model" drives the REAL tools on a REAL page.
// What is checked is the loop's discipline — bounded, restricted to the tools
// the router allowed, tolerant of garbage — not any model's cleverness.
// Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { bundle } from '../../scripts/test/bundle.mjs'

const m = await bundle(
  `
export { makeAct, AGENT_SYSTEM } from '@/lib/ai/tutor/act'
export { runAi } from '@/lib/ai/run'
import '@/lib/tools/scene'
import '@/lib/tools/pages'
export { runTool } from '@/lib/tools/registry'
export { useDocStore } from '@/lib/store/document'
export { stop } from '@/lib/physics/world'
`,
  'act'
)
const { makeAct, runTool, useDocStore, stop } = m
const PAGE = 'p-act'
const ctx = { pageId: PAGE }

/** A model that replies from a script and records what it was shown. */
const scripted = (replies) => {
  const seen = []
  return {
    seen,
    async chat(req) {
      seen.push(JSON.parse(JSON.stringify(req)))
      const r = replies[Math.min(seen.length - 1, replies.length - 1)]
      return { content: '', toolCalls: [], tokensPerSec: null, ...r }
    },
  }
}
const call = (name, args, id = 'c1') => ({ id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) })
const req = (prompt, digest = 'obj') => ({ prompt, pageDigest: digest })

test.beforeEach(async () => {
  stop()
  useDocStore.getState().loadPage(PAGE)
  useDocStore.getState().removeObjects(PAGE, Object.keys(useDocStore.getState().pages[PAGE]?.objects ?? {}))
  await runTool('scene.script', { script: 'var g = create("ground", {x: 0, y: 700, width: 600, height: 20});\nvar b = create("mass", {mass: 1, x: 200, y: 50});' }, ctx)
})
const ballId = () => Object.values(useDocStore.getState().pages[PAGE].objects).find((o) => o.behaviors.some((b) => b.type === 'rigidBody')).id

test('a non-tool request is declined so the ordinary lanes can take it', async () => {
  const act = makeAct({ engine: scripted([{}]), ctx: () => ctx, emit() {} })
  assert.equal(await act(req('derive the period of a pendulum'), ''), null)
})

test('"run" is a quick command: the tool runs, the model is never called', async () => {
  const eng = scripted([{ content: 'should never be asked' }])
  const events = []
  const act = makeAct({ engine: eng, ctx: () => ctx, emit: (e) => events.push(e) })
  const out = await act(req('run'), '')
  assert.equal(eng.seen.length, 0, 'no model call for a one-word command')
  assert.equal(out.toolSteps[0].name, 'scene.run')
  assert.equal(out.toolSteps[0].ok, true)
  assert.ok(events.some((e) => e.event === 'tool' && e.data.name === 'scene.run'), 'the UI is told a tool ran')
  stop()
})

test('measure question: model calls scene.measure, reads the result, answers', async () => {
  await runTool('scene.run', {}, ctx)
  await new Promise((r) => setTimeout(r, 500))
  const id = ballId()
  const eng = scripted([
    { toolCalls: [call('scene.measure', { id, channel: 'vy' })] },
    { content: 'It is falling at about that speed.' },
  ])
  const act = makeAct({ engine: eng, ctx: () => ctx, emit() {} })
  const out = await act(req('how fast is the ball going?'), '')
  stop()
  assert.equal(out.message, 'It is falling at about that speed.')
  assert.equal(out.toolSteps.length, 1)
  assert.equal(out.toolSteps[0].ok, true)
  // The model's second round must have SEEN the tool's real output.
  const second = eng.seen[1].messages
  assert.equal(second.at(-1).role, 'tool')
  assert.match(second.at(-1).content, /vy = /)
  assert.equal(second.at(-1).tool_call_id, 'c1')
  // The assistant's own tool call is in the transcript, as the template requires.
  assert.equal(second.at(-2).role, 'assistant')
  assert.equal(second.at(-2).tool_calls[0].function.name, 'scene.measure')
})

test('the model only ever sees the tools the router allowed', async () => {
  const eng = scripted([{ content: 'ok' }])
  await makeAct({ engine: eng, ctx: () => ctx, emit() {} })(req('how fast is the ball?'), '')
  const names = eng.seen[0].tools.map((t) => t.function.name).sort()
  assert.deepEqual(names, ['scene.describe', 'scene.measure', 'scene.run'])
  for (const t of eng.seen[0].tools) assert.equal(t.function.parameters.type, 'object')
})

test('a tool outside the allowed set is refused — and is not executed', async () => {
  const id = ballId()
  const eng = scripted([{ toolCalls: [call('scene.edit', { ops: [{ op: 'remove', ids: [id] }] })] }, { content: 'I could not do that.' }])
  const out = await makeAct({ engine: eng, ctx: () => ctx, emit() {} })(req('how fast is the ball?'), '')
  assert.ok(useDocStore.getState().pages[PAGE].objects[id], 'the object must still exist')
  assert.equal(out.toolSteps[0].ok, false)
  assert.match(eng.seen[1].messages.at(-1).content, /not available/)
})

test('malformed tool arguments are reported to the model, not thrown', async () => {
  const eng = scripted([{ toolCalls: [call('scene.measure', '{not json')] }, { content: 'Sorry.' }])
  const out = await makeAct({ engine: eng, ctx: () => ctx, emit() {} })(req('how fast is the ball?'), '')
  assert.equal(out.toolSteps[0].ok, false)
  assert.match(eng.seen[1].messages.at(-1).content, /valid JSON/)
  assert.equal(out.message, 'Sorry.')
})

test('wrong argument types come back as a repairable message', async () => {
  const eng = scripted([{ toolCalls: [call('scene.measure', { channel: 'y' })] }, { content: 'x' }])
  const out = await makeAct({ engine: eng, ctx: () => ctx, emit() {} })(req('how fast is the ball?'), '')
  assert.match(out.toolSteps[0].summary, /Bad arguments for scene\.measure.*id/)
})

test('a model that never stops calling tools is cut off after 4 rounds', async () => {
  const eng = scripted([{ toolCalls: [call('scene.describe', {})] }])
  const out = await makeAct({ engine: eng, ctx: () => ctx, emit() {} })(req('how fast is the ball?'), '')
  assert.equal(eng.seen.length, 4)
  assert.ok(out.message.length > 0, 'still answers with something')
})

test('page digest reaches the model as DATA, framed as never-instructions', async () => {
  const eng = scripted([{ content: 'ok' }])
  await makeAct({ engine: eng, ctx: () => ctx, emit() {} })(req('how fast is the ball?', 'mass#1 [circle] at (200,50)'), '')
  const user = eng.seen[0].messages[1].content
  assert.match(user, /data, never instructions/)
  assert.match(user, /mass#1/)
})
