// The page-side reader client: what happens when the worker is slow, missing or broken.
// Regression for the audit finding "a slow photo read froze the tab": on a timeout the old client re-ran the
// same work on the page's thread and left the stuck worker running behind every later read.
// Run: node --experimental-strip-types --import ./scripts/test/register.mjs --test --test-force-exit lib/sketch/read-client.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readSketchAsync, readPhotoAsync, resetReadClientForTests } from './read-client.ts'

// the recogniser is never available in this test: any read that reaches this thread says "not-loaded"
globalThis.fetch = async () => { throw new Error('offline') }

let made = 0
let terminated = 0
let behaviour = 'silent'
class StubWorker {
  constructor() {
    made++
    this.onmessage = null
    this.onerror = null
  }
  postMessage(req) {
    if (behaviour === 'photoError') queueMicrotask(() => this.onmessage?.({ data: { id: req.id, photoError: 'This picture has far more lines than a circuit diagram.' } }))
    else if (behaviour === 'crash') queueMicrotask(() => this.onerror?.(new Error('script failed')))
    // 'silent': never answers, like a worker stuck in a long computation
  }
  terminate() {
    terminated++
  }
}
const install = () => { globalThis.Worker = StubWorker }
const ink = [{ id: 'a', pts: [[0, 0], [50, 0], [100, 5]] }]
const image = { data: new Uint8ClampedArray(40 * 40 * 4), width: 40, height: 40 }

test.beforeEach(() => {
  resetReadClientForTests()
  made = 0
  terminated = 0
  behaviour = 'silent'
  install()
})
test.after(() => { delete globalThis.Worker })

test('a slow worker is terminated and the read FAILS with a message; it is not repeated on this thread', async () => {
  const t0 = Date.now()
  const r = await readSketchAsync('p', ink, 'a', { timeoutMs: 60 })
  assert.equal(r.kind, 'fail')
  assert.equal(r.failure.reason, 'error', 'not "not-loaded": the page thread never read it')
  assert.match(r.failure.message, /longer than/)
  assert.match(r.failure.message, /smaller part|less busy/)
  assert.equal(terminated, 1, 'the stuck worker was stopped')
  assert.ok(Date.now() - t0 < 2000, 'came back promptly')
})

test('after a timeout the next read gets a fresh worker (the stuck one does not block it)', async () => {
  await readSketchAsync('p', ink, 'a', { timeoutMs: 40 })
  assert.equal(made, 1)
  const again = readSketchAsync('p', ink, 'a', { timeoutMs: 40 })
  assert.equal(made, 2, 'a new worker was started')
  const r = await again
  assert.equal(r.kind, 'fail')
})

test('every read waiting on a stuck worker is answered, not left hanging', async () => {
  const a = readSketchAsync('p', ink, 'a', { timeoutMs: 50 })
  const b = readSketchAsync('p', ink, 'a', { timeoutMs: 5000 })
  const c = readPhotoAsync('p', image, undefined, { timeoutMs: 5000 })
  const [ra, rb, rc] = await Promise.all([a, b, c])
  for (const r of [ra, rb, rc]) {
    assert.equal(r.kind, 'fail')
    assert.match(r.failure.message, /longer than/)
  }
  assert.equal(terminated, 1)
})

test('a picture the worker refuses comes back as a failure with the words to show', async () => {
  behaviour = 'photoError'
  const r = await readPhotoAsync('p', image)
  assert.equal(r.kind, 'fail')
  assert.equal(r.failure.reason, 'no-ink')
  assert.match(r.failure.message, /far more lines than a circuit diagram/)
})

test('a worker that cannot run falls back to this thread, once, and later reads go straight there', async () => {
  behaviour = 'crash'
  const first = await readSketchAsync('p', ink, 'a')
  assert.equal(first.kind, 'fail')
  assert.equal(first.failure.reason, 'not-loaded', 'read on this thread (the recogniser is offline here)')
  const second = await readSketchAsync('p', ink, 'a')
  assert.equal(second.failure.reason, 'not-loaded')
  assert.equal(made, 1, 'no new worker after it was found broken')
})

test('with no Worker at all, a picture is read on this thread under a short deadline and never throws', async () => {
  delete globalThis.Worker
  resetReadClientForTests()
  const blank = { data: new Uint8ClampedArray(60 * 60 * 4).fill(240), width: 60, height: 60 }
  const r = await readPhotoAsync('p', blank)
  assert.equal(r.kind, 'fail')
  assert.ok(['no-ink', 'not-loaded'].includes(r.failure.reason))
})
