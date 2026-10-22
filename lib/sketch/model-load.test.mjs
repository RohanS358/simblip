// Run: node --experimental-strip-types --import ./scripts/test/register.mjs --test lib/sketch/model-load.test.mjs
// The recogniser download: a failure is retried (after a cooldown), not remembered forever; and the
// off-thread reader's fallback gives the same answer as reading directly.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadModel, modelFailed, resetModel, peekSketchNet, peekInkChars, MODEL_RETRY_MS } from './sketchnet.ts'
import { readSketchAsync, readHere } from './read-client.ts'
import { drawScene } from './scene-synth.ts'
import { makeWriter } from './synth.ts'
import { makeRng } from './rng.ts'

const root = resolve(import.meta.dirname, '../..')
let online = false
let fetches = 0
const realFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  fetches++
  if (!online) throw new Error('network down')
  const file = resolve(root, 'public', String(url).replace(/^\//, ''))
  const buf = readFileSync(file)
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(buf.toString('utf8')),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  }
}
test.after(() => { globalThis.fetch = realFetch })

test('a failed model download is retried after the cooldown and then succeeds', async () => {
  resetModel('sketchnet-v1')
  let clock = 1_000_000
  const now = () => clock
  online = false
  assert.equal(await loadModel('sketchnet-v1', '/models', now), null)
  assert.ok(modelFailed('sketchnet-v1'))
  // inside the cooldown: remembered, no new request
  const before = fetches
  assert.equal(await loadModel('sketchnet-v1', '/models', now), null)
  assert.equal(fetches, before, 'no hammering inside the cooldown')
  // network back, cooldown over: it loads
  online = true
  clock += MODEL_RETRY_MS + 1
  const net = await loadModel('sketchnet-v1', '/models', now)
  assert.ok(net, 'loaded on retry')
  assert.equal(modelFailed('sketchnet-v1'), false)
  // loaded: never fetched again
  const after = fetches
  await loadModel('sketchnet-v1', '/models', now)
  assert.equal(fetches, after)
})

test('with no worker available the async read falls back to reading directly, with the same answer', async () => {
  assert.equal(typeof Worker, 'undefined')
  resetModel('sketchnet-v1')
  resetModel('inkchars-v1')
  online = true
  await loadModel('sketchnet-v1')
  await loadModel('inkchars-v1')
  assert.ok(peekSketchNet() && peekInkChars())
  const { layouts } = JSON.parse(readFileSync(resolve(import.meta.dirname, 'golden/scene-layouts.json'), 'utf8'))
  const rng = makeRng(503)
  const sc = drawScene(layouts[3], rng.fork('s'), makeWriter(rng.fork('w'), 'ml', 'mouse'), undefined, undefined, { text: true })
  const ink = sc.strokes.map((pts, k) => ({ id: `k${k}`, pts }))
  const seed = ink[ink.length - 1].id
  const direct = readHere('p', ink, seed)
  const viaClient = await readSketchAsync('p', ink, seed)
  assert.equal(viaClient.kind, direct.kind)
  assert.equal(viaClient.kind, 'circuit')
})

test('when the recogniser cannot be downloaded the read says so instead of "still loading"', async () => {
  resetModel('sketchnet-v1')
  online = false
  await loadModel('sketchnet-v1')
  const r = readHere('p', [{ id: 'a', pts: [[0, 0], [50, 0], [100, 5]] }], 'a')
  assert.equal(r.kind, 'fail')
  assert.equal(r.failure.reason, 'not-loaded')
  assert.match(r.failure.message, /couldn't be downloaded/)
})
