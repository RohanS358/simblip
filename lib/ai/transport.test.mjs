// Where a request goes (device vs server), and the SSE reader the server path uses.
// Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { bundle } from '../../scripts/test/bundle.mjs'

const m = await bundle(
  `
export { resolveRoute, streamAi, useServerOnce } from '@/lib/ai/transport'
export { useEngine, useEnginePrefs } from '@/lib/ai/engine/store'
`,
  'transport'
)
const { resolveRoute, streamAi, useServerOnce, useEngine, useEnginePrefs } = m

const set = (backend, cached, tier = null) => {
  useEnginePrefs.setState({ backend, tier })
  useEngine.setState({ cached, tier: null, caps: { webgpu: false, isolated: false, cores: 4, memGB: 8, wasm: true, recommended: 'lite', reason: '' } })
}

test('auto: server until a model is downloaded, then the device', () => {
  set('auto', [])
  assert.deepEqual(resolveRoute(), { where: 'server' })
  set('auto', ['lite'])
  assert.deepEqual(resolveRoute(), { where: 'device', tier: 'lite' })
})

test('the tier in use is the preferred one if downloaded, else any downloaded one', () => {
  set('auto', ['lite', 'standard'], 'standard')
  assert.equal(resolveRoute().tier, 'standard')
  set('auto', ['lite'], 'standard')
  assert.equal(resolveRoute().tier, 'lite', 'a preferred-but-missing model never blocks the chat')
})

test('device-only with nothing downloaded is blocked with an instruction, never silently sent out', () => {
  set('device', [])
  const r = resolveRoute()
  assert.equal(r.where, 'blocked')
  assert.match(r.why, /Download the Lite model first/)
})

test('server-only never uses the device even when a model exists', () => {
  set('server', ['standard'])
  assert.deepEqual(resolveRoute(), { where: 'server' })
})

const sse = (frames, split) => {
  const text = frames.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('')
  const enc = new TextEncoder().encode(text)
  const parts = [enc.slice(0, split), enc.slice(split)]
  return new Response(new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(p)); c.close() } }), { headers: { 'Content-Type': 'text/event-stream' } })
}

test('the server path reads SSE even when a frame is split across chunks', async () => {
  set('server', [])
  let sent
  globalThis.fetch = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return sse([['intent', 'simulate'], ['token', 'var a'], ['done', { message: 'ok', script: 'var a = 1;' }]], 37) }
  const got = []
  await streamAi({ prompt: 'x' }, new AbortController().signal, (e) => got.push(e))
  assert.equal(sent.url, '/api/ai')
  assert.equal(sent.body.stream, true)
  assert.deepEqual(got.map((e) => e.event), ['intent', 'token', 'done'])
  assert.equal(got[2].data.script, 'var a = 1;')
})

test('"use the server" applies to ONE request and is then spent', async () => {
  set('auto', ['lite'])
  let calls = 0
  globalThis.fetch = async () => { calls++; return sse([['done', { message: 'from server' }]], 5) }
  useServerOnce()
  assert.deepEqual(resolveRoute(), { where: 'server' })
  const got = []
  await streamAi({ prompt: 'x' }, new AbortController().signal, (e) => got.push(e))
  assert.equal(calls, 1)
  assert.equal(got[0].data.message, 'from server')
  assert.deepEqual(resolveRoute(), { where: 'device', tier: 'lite' }, 'the next request is back on the device')
})

test('a blocked route answers with the reason, as a normal done event', async () => {
  set('device', [])
  const got = []
  await streamAi({ prompt: 'x' }, new AbortController().signal, (e) => got.push(e))
  assert.equal(got.length, 1)
  assert.equal(got[0].event, 'done')
  assert.match(got[0].data.message, /Download the Lite model/)
})
