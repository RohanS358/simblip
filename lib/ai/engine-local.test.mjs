// The on-device engine against a FAKE wllama: lifecycle, memory discipline,
// streaming, tool calls, cancellation. The real model is exercised in the
// browser (see docs) — this pins everything around it.
// Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { bundle } from '../../scripts/test/bundle.mjs'

const m = await bundle(
  `
export { LocalEngine } from '@/lib/ai/engine/local'
export { useEngine } from '@/lib/ai/engine/store'
export { MODELS, modelUrl, estimateRamMB } from '@/lib/ai/engine/catalog'
export { decide } from '@/lib/ai/engine/probe'
`,
  'engine'
)
const { LocalEngine, useEngine, MODELS, modelUrl, estimateRamMB, decide } = m

/** A wllama stand-in that records what it was asked and "downloads" on demand. */
function fakeWllama({ failQuantised = false, reply = [{ content: 'Hello' }], cached = [] } = {}) {
  const log = { loads: [], chats: [], exits: 0 }
  const entries = cached.map((t) => ({ name: t, size: MODELS[t].sizeMB * 1e6, metadata: { originalURL: modelUrl(MODELS[t]) } }))
  const w = {
    log,
    cacheManager: {
      list: async () => entries,
      deleteMany: async (p) => { for (let i = entries.length - 1; i >= 0; i--) if (p(entries[i])) entries.splice(i, 1) },
    },
    async loadModelFromUrl(url, params) {
      log.loads.push({ url, params })
      if (failQuantised && params.cache_type_k) throw new Error('no q8 kernels')
      params.progressCallback?.({ loaded: 50, total: 100 })
      params.progressCallback?.({ loaded: 100, total: 100 })
      if (!entries.some((e) => e.metadata.originalURL === url)) entries.push({ name: 'x', size: Infinity, metadata: { originalURL: url } })
    },
    async createChatCompletion(params) {
      log.chats.push(params)
      if (params.abortSignal?.aborted) throw new Error('aborted')
      return (async function* () {
        for (const chunk of reply) yield { choices: [{ delta: chunk, finish_reason: null }], timings: { predicted_per_second: 12.5 } }
      })()
    },
    isSupportWebGPU: () => false,
    getNumThreads: () => 1,
    async exit() { log.exits++ },
  }
  return w
}
const engineWith = (w, idleMs = 60_000) => new LocalEngine(async () => w, idleMs)
test.beforeEach(() => useEngine.setState({ state: 'unknown', tier: null, progress: 0, cached: [], error: null, tps: null }))

test('catalog: sizes are honest and the standard tier fits the 2 GB budget', () => {
  assert.ok(MODELS.standard.sizeMB > MODELS.lite.sizeMB)
  assert.ok(estimateRamMB(MODELS.standard) < 2000, `standard ≈ ${estimateRamMB(MODELS.standard)} MB must stay under the 2 GB cap`)
  assert.ok(estimateRamMB(MODELS.lite) < 1000)
  for (const t of Object.values(MODELS)) assert.match(modelUrl(t), /^https:\/\/huggingface\.co\/.+\/resolve\/main\/.+\.gguf$/)
})

test('probe decisions: weak devices are never offered a model they cannot run', () => {
  const base = { webgpu: false, isolated: false, cores: 4, memGB: 8, wasm: true }
  assert.equal(decide({ ...base, wasm: false }).recommended, null)
  assert.equal(decide({ ...base, memGB: 1 }).recommended, null, '1 GB → use the server')
  assert.equal(decide({ ...base, webgpu: true }).recommended, 'standard')
  assert.equal(decide({ ...base, webgpu: true, memGB: 4 }).recommended, 'lite', 'GPU but little RAM → Lite, leave room for the notebook')
  assert.equal(decide({ ...base }).recommended, 'lite', 'plain 4-core CPU → Lite')
  assert.equal(decide({ ...base, isolated: true, cores: 8 }).recommended, 'standard', 'fast multi-core CPU')
  assert.equal(decide({ ...base, memGB: null, webgpu: true }).recommended, 'standard', 'unknown memory is not treated as low')
})

test('ensure: downloads, reports progress, loads once, then is a no-op', async () => {
  const w = fakeWllama()
  const e = engineWith(w)
  const seen = []
  const off = useEngine.subscribe((s) => seen.push(s.state))
  await e.ensure('lite')
  off()
  assert.ok(seen.includes('downloading'), `states: ${seen}`)
  assert.equal(useEngine.getState().state, 'ready')
  assert.equal(useEngine.getState().tier, 'lite')
  assert.deepEqual(useEngine.getState().cached, ['lite'])
  assert.equal(w.log.loads.length, 1)
  assert.equal(w.log.loads[0].params.n_ctx, MODELS.lite.nCtx)
  assert.equal(w.log.loads[0].params.cache_type_k, 'q8_0', '8-bit KV cache keeps memory down')
  await e.ensure('lite')
  assert.equal(w.log.loads.length, 1, 'no reload')
  await Promise.all([e.ensure('lite'), e.ensure('lite')])
  assert.equal(w.log.loads.length, 1)
  await e.release()
})

test('an already-cached model skips the "downloading" state', async () => {
  const e = engineWith(fakeWllama({ cached: ['lite'] }))
  const seen = []
  const off = useEngine.subscribe((s) => seen.push(s.state))
  await e.ensure('lite')
  off()
  assert.ok(!seen.includes('downloading'))
  assert.ok(seen.includes('loading'))
  await e.release()
})

test('a backend without quantised-KV kernels falls back to a plain load', async () => {
  const w = fakeWllama({ failQuantised: true })
  const e = engineWith(w)
  await e.ensure('lite')
  assert.equal(w.log.loads.length, 2)
  assert.equal(w.log.loads[1].params.cache_type_k, undefined)
  assert.equal(useEngine.getState().state, 'ready')
  await e.release()
})

test('a failed load is an error state with a readable message, not a crash', async () => {
  const w = fakeWllama()
  w.loadModelFromUrl = async () => { throw new Error('network down') }
  const e = engineWith(w)
  await assert.rejects(e.ensure('standard'), /Could not load the on-device model: network down/)
  assert.equal(useEngine.getState().state, 'error')
  assert.match(useEngine.getState().error, /network down/)
  assert.equal(e.isReady(), false)
})

test('cancelling a download returns to "absent", not "error"', async () => {
  const w = fakeWllama()
  const ctl = new AbortController()
  w.loadModelFromUrl = async () => { ctl.abort(); throw new Error('aborted') }
  const e = engineWith(w)
  await assert.rejects(e.ensure('lite', ctl.signal), /cancelled/i)
  assert.equal(useEngine.getState().state, 'absent')
  assert.equal(useEngine.getState().error, null)
})

test('chat streams display tokens, hides think blocks, and returns the clean text + speed', async () => {
  const w = fakeWllama({ reply: [{ content: '<think>\n\n</think>\n\n' }, { content: 'Hel' }, { content: 'lo!' }] })
  const e = engineWith(w)
  await e.ensure('lite')
  const tokens = []
  const r = await e.chat({ messages: [{ role: 'user', content: 'hi' }], onToken: (t) => tokens.push(t) })
  assert.equal(r.content, 'Hello!')
  assert.equal(tokens.join(''), 'Hello!', 'think block never reaches the preview')
  assert.equal(r.tokensPerSec, 12.5)
  assert.equal(useEngine.getState().tps, 12.5)
  assert.equal(w.log.chats[0].chat_template_kwargs.enable_thinking, false, 'no minutes-long reasoning on a laptop')
  assert.equal(useEngine.getState().state, 'ready', 'back to ready after generating')
  await e.release()
})

test('chat assembles streamed tool calls (name and arguments arrive in pieces)', async () => {
  const w = fakeWllama({
    reply: [
      { tool_calls: [{ index: 0, id: 'a1', function: { name: 'scene.', arguments: '' } }] },
      { tool_calls: [{ index: 0, function: { name: 'measure', arguments: '{"id":"o' } }] },
      { tool_calls: [{ index: 0, function: { arguments: '1","channel":"y"}' } }] },
    ],
  })
  const e = engineWith(w)
  await e.ensure('lite')
  const r = await e.chat({
    messages: [{ role: 'user', content: 'x' }],
    tools: [{ type: 'function', function: { name: 'scene.measure', parameters: { type: 'object', properties: {} } } }],
  })
  assert.deepEqual(r.toolCalls, [{ id: 'a1', name: 'scene.measure', arguments: '{"id":"o1","channel":"y"}' }])
  assert.equal(w.log.chats[0].tool_choice, 'auto')
  await e.release()
})

test('requests are serialised: one model, one request at a time', async () => {
  const w = fakeWllama()
  let active = 0
  let peak = 0
  const orig = w.createChatCompletion.bind(w)
  w.createChatCompletion = async (p) => {
    active++; peak = Math.max(peak, active)
    await new Promise((r) => setTimeout(r, 15))
    const s = await orig(p)
    return (async function* () { for await (const c of s) yield c; active-- })()
  }
  const e = engineWith(w)
  await e.ensure('lite')
  await Promise.all([1, 2, 3].map(() => e.chat({ messages: [{ role: 'user', content: 'x' }] })))
  assert.equal(peak, 1)
  await e.release()
})

test('one failed request does not poison the queue', async () => {
  const w = fakeWllama()
  let n = 0
  const orig = w.createChatCompletion.bind(w)
  w.createChatCompletion = async (p) => { if (n++ === 0) throw new Error('kv_cache_full'); return orig(p) }
  const e = engineWith(w)
  await e.ensure('lite')
  await assert.rejects(e.chat({ messages: [{ role: 'user', content: 'a' }] }), /On-device generation failed: kv_cache_full/)
  assert.equal((await e.chat({ messages: [{ role: 'user', content: 'b' }] })).content, 'Hello')
  await e.release()
})

test('a user abort propagates as the abort, not as a model failure', async () => {
  const w = fakeWllama()
  const e = engineWith(w)
  await e.ensure('lite')
  const ctl = new AbortController()
  ctl.abort()
  await assert.rejects(e.chat({ messages: [{ role: 'user', content: 'a' }], signal: ctl.signal }), /aborted/)
  await e.release()
})

test('idle unload frees memory but keeps the file; the next request reloads from cache', async () => {
  const w = fakeWllama()
  const e = engineWith(w, 30)
  await e.ensure('lite')
  await e.chat({ messages: [{ role: 'user', content: 'x' }] })
  await new Promise((r) => setTimeout(r, 120))
  assert.equal(w.log.exits, 1, 'model freed after idling')
  assert.equal(useEngine.getState().state, 'unloaded')
  assert.deepEqual(useEngine.getState().cached, ['lite'], 'still downloaded')
  const r = await e.chat({ messages: [{ role: 'user', content: 'again' }] }, 'lite')
  assert.equal(r.content, 'Hello')
  await e.release()
})

test('switching tiers releases the old model first (never two resident)', async () => {
  const w = fakeWllama()
  const e = engineWith(w)
  await e.ensure('lite')
  await e.ensure('standard')
  assert.equal(w.log.exits, 1)
  assert.equal(useEngine.getState().tier, 'standard')
  await e.release()
})

test('remove deletes the cached file and updates the UI state', async () => {
  const e = engineWith(fakeWllama({ cached: ['lite'] }))
  await e.refreshCached()
  assert.deepEqual(useEngine.getState().cached, ['lite'])
  await e.remove('lite')
  assert.deepEqual(useEngine.getState().cached, [])
})

test('generator() adapts the engine to the interface the lint/repair pipeline already uses', async () => {
  const w = fakeWllama({ reply: [{ content: 'var a = 1;' }] })
  const e = engineWith(w)
  await e.ensure('lite')
  const out = await e.generator().generate('SYS', 'USER', undefined, [{ role: 'user', content: 'ex' }, { role: 'assistant', content: 'exa' }], 321)
  assert.equal(out, 'var a = 1;')
  const sent = w.log.chats[0]
  assert.deepEqual(sent.messages.map((x) => x.role), ['system', 'user', 'assistant', 'user'])
  assert.equal(sent.messages[0].content, 'SYS')
  assert.equal(sent.max_tokens, 321)
  await e.release()
})

test('chat without any model downloaded says how to fix it', async () => {
  const e = engineWith(fakeWllama())
  await assert.rejects(e.chat({ messages: [{ role: 'user', content: 'x' }] }), /not downloaded yet/)
})
