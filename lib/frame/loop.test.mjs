// The frame loop is deterministic and runs with no window at all.
import test from 'node:test'
import assert from 'node:assert/strict'
import { FrameLoop, damp, smoothstep } from './loop.ts'

test('headless: render() calls every painter once per frame at a fixed step', () => {
  const loop = new FrameLoop({ fps: 30, clock: null })
  const seen = []
  loop.add((f) => seen.push([f.n, Number(f.t.toFixed(4)), Number(f.dt.toFixed(4))]))
  loop.render(0.1)
  assert.deepEqual(seen, [[0, 0, 0.0333], [1, 0.0333, 0.0333], [2, 0.0667, 0.0333]])
  assert.equal(loop.frame, 3)
})

test('the same painter produces the same frames every run', () => {
  const run = () => { const l = new FrameLoop({ fps: 60, clock: null }); let x = 0; l.add((f) => { x = damp(x, 10, 0.2, f.dt) }); l.render(1); return x }
  assert.equal(run(), run())
})

test('a removed painter stops being called', () => {
  const loop = new FrameLoop({ fps: 10, clock: null })
  let n = 0
  const off = loop.add(() => n++)
  loop.render(0.3); off(); loop.render(0.3)
  assert.equal(n, 3)
})

test('live: a slow tick spends banked time in whole fixed steps, capped', () => {
  let cb = null, t = 0
  const clock = { now: () => t, request: (f) => { cb = f; return 1 }, cancel: () => { cb = null } }
  const loop = new FrameLoop({ fps: 10, clock })
  let n = 0
  loop.add(() => n++)
  loop.start()
  t = 350; cb(350) // 0.35 s elapsed -> capped to 0.25 s = 2 steps (the remainder carries)
  assert.equal(n, 2)
  loop.stop()
  assert.equal(loop.running, false)
})

test('damp halves the gap every half-life; smoothstep is clamped', () => {
  assert.ok(Math.abs(damp(0, 8, 1, 1) - 4) < 1e-9)
  assert.equal(smoothstep(0, 1, -5), 0)
  assert.equal(smoothstep(0, 1, 7), 1)
})
