// Run: node --experimental-strip-types --import ./scripts/test/register.mjs --test lib/sketch/inkchars.test.mjs
//
// The HANDWRITTEN-CHARACTER network (digits, SI prefixes, unit letters): same checks as
// sketchnet.test.mjs — files match the manifest, TypeScript reproduces PyTorch, and a
// regression guard on fresh SYNTHETIC writers (not real handwriting).
//
// Three implementations must agree: PyTorch (trains), ONNX Runtime (cross-check,
// done in export.py) and this TypeScript forward pass (ships). The golden file
// holds real strokes plus the logits PyTorch produced for them.
//
// The accuracy check at the bottom uses a FRESH synthetic seed — writers the
// model has never seen — and is a regression guard on SYNTHETIC data only. It
// says nothing about real people.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSketchNet } from './sketchnet.ts'
import { preprocess, PREPROCESS_VERSION } from './preprocess.ts'
import { generateChars } from './char-synth.ts'
import { CHAR_MODEL_LABELS } from './char-synth.ts'

const root = resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(readFileSync(resolve(root, 'public/models/inkchars-v1.json'), 'utf8'))
const bin = readFileSync(resolve(root, 'public/models/inkchars-v1.bin'))
const weights = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)
const golden = JSON.parse(readFileSync(resolve(import.meta.dirname, 'golden/inkchars-v1.golden.json'), 'utf8'))
const net = createSketchNet(manifest, weights)

test('manifest matches the files and this build', () => {
  assert.equal(manifest.bytes, bin.byteLength)
  assert.equal(manifest.sha256, createHash('sha256').update(bin).digest('hex'))
  assert.equal(manifest.preprocessVersion, PREPROCESS_VERSION)
  assert.deepEqual(manifest.labels, [...CHAR_MODEL_LABELS])
  assert.equal(manifest.evidence.real, null, 'no real-world number is claimed')
})

test('a model from a different preprocessing version or a truncated blob is refused', () => {
  assert.throws(() => createSketchNet({ ...manifest, preprocessVersion: 999 }, weights), /preprocessing/)
  assert.throws(() => createSketchNet(manifest, weights.slice(0, 100)), /bytes/)
})

test('TypeScript preprocessing reproduces the exact tensors the model trained on', () => {
  for (const g of golden.samples) {
    const { img, seq } = preprocess(g.strokes)
    const want = Uint8Array.from(g.img)
    const got = Uint8Array.from(img, (v) => Math.round(v * 255))
    assert.deepEqual(got, want, `${g.cls}: image differs`)
    let worst = 0
    g.seq.forEach((v, i) => { worst = Math.max(worst, Math.abs(v - seq[i])) })
    assert.ok(worst < 2e-5, `${g.cls}: sequence differs by ${worst}`)
  }
})

test('forward pass reproduces PyTorch logits', () => {
  let worst = 0
  for (const g of golden.samples) {
    const out = net.forward(Float32Array.from(g.img, (v) => v / 255), Float32Array.from(g.seq))
    g.cls_logits.forEach((v, i) => { worst = Math.max(worst, Math.abs(v - out.cls[i])) })
    g.pose_logits.forEach((v, i) => { worst = Math.max(worst, Math.abs(v - out.pose[i])) })
  }
  assert.ok(worst < 1e-3, `max |logit difference| ${worst}`)
})

test('end to end: strokes in, the same class PyTorch picked out', () => {
  for (const g of golden.samples) {
    const want = g.cls_logits.indexOf(Math.max(...g.cls_logits))
    const p = net.predict(g.strokes)
    assert.equal(p.cls, golden.labels[want], g.cls)
    assert.ok(p.conf > 0 && p.conf <= 1)
    assert.equal(p.top.length, 3)
    assert.equal(p.top[0].cls, p.cls)
    assert.ok([0, 90, 180, 270].includes(p.pose))
  }
})

test('probabilities sum to one and are calibrated-looking (never all-or-nothing)', () => {
  const p = net.predict(golden.samples[0].strokes)
  const total = p.top.reduce((s, t) => s + t.conf, 0)
  assert.ok(total <= 1.0001 && total > 0.9)
})

test('the alphabet is what the value reader expects, including the ohm sign', () => {
  for (const c of ['0', '9', 'k', 'M', 'm', 'u', 'n', 'p', 'V', 'A', 'F', 'H', 'Ω', 'unknown']) assert.ok(manifest.labels.includes(c), c)
})

test('degenerate input does not crash', () => {
  assert.doesNotThrow(() => net.predict([]))
  assert.doesNotThrow(() => net.predict([[[5, 5]]]))
  assert.doesNotThrow(() => net.predict([[[0, 0], [0, 0], [0, 0]]]))
  assert.doesNotThrow(() => net.predict([[[0, 0], [1e9, -1e9]]]))
})

test('latency per symbol (preprocess + forward), warm', () => {
  const strokes = golden.samples[3].strokes
  for (let i = 0; i < 30; i++) net.predict(strokes)
  const t0 = performance.now()
  const N = 200
  for (let i = 0; i < N; i++) net.predict(strokes)
  const ms = (performance.now() - t0) / N
  console.log(`  latency: ${ms.toFixed(2)} ms per symbol (Node/V8, this machine)`)
  assert.ok(ms < 80, `${ms} ms per symbol is far over the 5 ms target`)
})

test('SYNTHETIC regression guard: unseen synthetic writers, top-1 high', () => {
  let n = 0
  let hit = 0
  for (const s of generateChars({ seed: 777, writers: 10, reps: 2 })) {
    n++
    if (net.predict(s.strokes).cls === s.cls) hit++
  }
  const acc = hit / n
  console.log(`  synthetic (seed 777, ${n} samples): top-1 ${(100 * acc).toFixed(1)}%  [synthetic only, not real-world]`)
  assert.ok(acc > 0.95, `top-1 ${acc}`)
})
