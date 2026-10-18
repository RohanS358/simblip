// Run: node --experimental-strip-types --import ./scripts/test/register.mjs --test lib/sketch/corrections.test.mjs
//
// Saved corrections are the first REAL data this project gets, so the record
// must be valid, anonymous, local, bounded — and must flow through the same
// import/eval path as everything else.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  CORRECTIONS_KEY, MAX_CORRECTIONS, addCorrection, clearCorrections, loadCorrections, makeCorrection, toJsonl, writerId,
} from './corrections.ts'
import { SketchSample, parseShard } from './dataset.ts'
import { confidenceOf, ghostSize, nextPose, pointerDevice } from './ghost.ts'

const root = resolve(import.meta.dirname, '../..')
const memory = () => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), _m: m }
}
const zigzag = (n = 400) => Array.from({ length: n }, (_, i) => [100 + i * 0.5, 200 + (i % 8 < 4 ? -10 : 10), 0.5])
const input = (over = {}) => ({
  cls: 'resistor', pose: 0, strokes: [zigzag()], device: 'mouse', predicted: 'resistor', confidence: 0.59, changed: false, rotated: false, ...over,
})

test('a correction is a valid real sample: anonymous, local, held-out', () => {
  const s = makeCorrection(input(), 'anon-abc')
  assert.ok(SketchSample.safeParse(s).success)
  assert.equal(s.source, 'real')
  assert.equal(s.split, 'test')
  assert.equal(s.writer, 'anon-abc')
  assert.equal(s.meta.storage, 'local-only')
  assert.equal(s.meta.predicted, 'resistor')
  assert.equal(s.meta.changed, false)
})

test('long strokes are thinned, time starts at zero and never runs backwards', () => {
  const s = makeCorrection(input({ strokes: [zigzag(900), zigzag(300)] }), 'anon-x')
  let prev = -1
  for (const st of s.strokes) {
    assert.ok(st.length <= 66, `${st.length} points`)
    for (const [, , t] of st) { assert.ok(t >= prev); prev = t }
  }
  assert.equal(s.strokes[0][0][2], 0)
})

test('the stroke end point survives thinning', () => {
  const pts = zigzag(500)
  const s = makeCorrection(input({ strokes: [pts] }), 'anon-x')
  const last = s.strokes[0][s.strokes[0].length - 1]
  assert.equal(last[0], Math.round(pts[pts.length - 1][0] * 10) / 10)
})

test('pose folds for symmetric classes: a resistor turned 180 is recorded as 0', () => {
  assert.equal(makeCorrection(input({ pose: 180 }), 'a').pose, 0)
  assert.equal(makeCorrection(input({ cls: 'diode', pose: 180 }), 'a').pose, 180)
})

test('ids are unique', () => {
  const ids = new Set(Array.from({ length: 50 }, () => makeCorrection(input(), 'a').id))
  assert.equal(ids.size, 50)
})

test('the writer id is random, anonymous and stable on a device', () => {
  const store = memory()
  const a = writerId(store)
  assert.match(a, /^anon-[a-z0-9]{10}$/)
  assert.equal(writerId(store), a)
  assert.notEqual(writerId(memory()), a)
})

test('add / load / clear, newest last, and the store is bounded', () => {
  const store = memory()
  assert.deepEqual(loadCorrections(store), [])
  addCorrection(store, makeCorrection(input({ cls: 'diode' }), 'a'))
  addCorrection(store, makeCorrection(input({ cls: 'battery' }), 'a'))
  assert.deepEqual(loadCorrections(store).map((s) => s.cls), ['diode', 'battery'])
  const many = Array.from({ length: MAX_CORRECTIONS + 25 }, (_, i) => makeCorrection(input({ cls: i === 0 ? 'gnd' : 'resistor' }), 'a'))
  store.setItem(CORRECTIONS_KEY, JSON.stringify(many.slice(0, MAX_CORRECTIONS)))
  assert.equal(addCorrection(store, makeCorrection(input(), 'a')), MAX_CORRECTIONS)
  assert.ok(!loadCorrections(store).some((s) => s.cls === 'gnd'), 'the oldest was dropped')
  clearCorrections(store)
  assert.deepEqual(loadCorrections(store), [])
})

test('blocked or full storage never throws', () => {
  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('full') }, removeItem: () => { throw new Error('blocked') } }
  assert.deepEqual(loadCorrections(broken), [])
  assert.equal(addCorrection(broken, makeCorrection(input(), 'a')), 0)
  assert.doesNotThrow(() => clearCorrections(broken))
  assert.doesNotThrow(() => writerId({ ...broken, getItem: () => null, setItem: () => {} }))
})

test('corrupt entries are skipped, valid ones kept', () => {
  const store = memory()
  store._m.set(CORRECTIONS_KEY, JSON.stringify([makeCorrection(input(), 'a'), { id: 'junk' }, 42]))
  assert.equal(loadCorrections(store).length, 1)
})

test('ghost rules: colours, sizing, rotation, device', () => {
  assert.equal(confidenceOf(0.95), 'high')
  assert.equal(confidenceOf(0.7), 'medium')
  assert.equal(confidenceOf(0.59), 'low')
  assert.equal(confidenceOf(null), 'chosen')
  assert.deepEqual(ghostSize({ x0: 0, y0: 0, x1: 40, y1: 10 }, true), { w: 72, h: 36 }, 'small symbols get the minimum footprint')
  assert.deepEqual(ghostSize({ x0: 0, y0: 0, x1: 500, y1: 10 }, true), { w: 200, h: 100 }, '… and the maximum')
  assert.equal(nextPose(270), 0)
  assert.equal(pointerDevice('touch'), 'finger')
  assert.equal(pointerDevice('pen'), 'pen')
  assert.equal(pointerDevice('mouse'), 'mouse')
})

test('export → import-real → eval-real works end to end', () => {
  const dir = mkdtempSync(join(tmpdir(), 'real-'))
  try {
    const rows = [
      makeCorrection(input({ cls: 'resistor' }), 'anon-t1'),
      makeCorrection(input({ cls: 'diode', predicted: 'led', changed: true }), 'anon-t1'),
    ]
    const jsonl = join(dir, 'export.jsonl')
    writeFileSync(jsonl, toJsonl(rows))
    assert.equal(parseShard(toJsonl(rows)).length, 2)

    const flags = ['--experimental-strip-types', '--import', './scripts/test/register.mjs']
    const out = join(dir, 'real')
    const said = execFileSync('node', [...flags, 'scripts/ai/sketch/import-real.mjs', '--in', jsonl, '--out', out], { cwd: root }).toString()
    assert.match(said, /imported 2 real samples/)
    assert.ok(readdirSync(out).includes('MANIFEST.json'))
    // importing the same export twice must not double-count
    const twice = execFileSync('node', [...flags, 'scripts/ai/sketch/import-real.mjs', '--in', `${jsonl},${jsonl}`, '--out', out], { cwd: root }).toString()
    assert.match(twice, /imported 2 real samples/)

    const report = execFileSync('node', [...flags, 'scripts/ai/sketch/eval-real.mjs', '--dir', out], { cwd: root }).toString()
    assert.match(report, /REAL strokes: 2 samples from 1 writer/)
    assert.match(report, /smoke test, not a benchmark/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
