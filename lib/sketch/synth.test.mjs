// Run: node --experimental-strip-types --import ./scripts/test/register.mjs --test lib/sketch/synth.test.mjs
//
// The synthetic generator's contract: reproducible, writer-split, well-formed,
// and clearly labelled synthetic. These do not say the data is REALISTIC —
// only a person looking at the contact sheet (npm run sketch:preview) and,
// ultimately, real-world validation can say that.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { generate } from './synth.ts'
import { GLYPHS, FRAME } from './glyphs.ts'
import { makeRng } from './rng.ts'
import { SketchSample, parseShard } from './dataset.ts'
import { ALL_LABELS, POSE_SYMMETRY, UNKNOWN_CLASS, WAVE1_CLASSES, canonicalPose } from './classes.ts'
import { KNOWN_KINDS } from '../ai/simscript-corpus.ts'
import { assertWriterDisjoint, groupOf, loadDir } from '../../scripts/ai/sketch/dataset.mjs'

const small = { seed: 3, writers: 24, reps: 2 }
const all = [...generate(small)]

test('every wave-1 class is a real SimScript kind with a glyph and a pose rule', () => {
  for (const c of WAVE1_CLASSES) {
    assert.ok(KNOWN_KINDS.has(c), `${c} is not a SimScript kind`)
    assert.equal(typeof GLYPHS[c], 'function', `${c} has no glyph`)
    assert.ok(c in POSE_SYMMETRY, `${c} has no pose rule`)
  }
  assert.equal(new Set(WAVE1_CLASSES).size, WAVE1_CLASSES.length, 'no duplicate classes')
})

test('every glyph is a non-empty set of strokes inside a sane frame', () => {
  for (const c of WAVE1_CLASSES) {
    for (let i = 0; i < 20; i++) {
      const g = GLYPHS[c](makeRng(i))
      assert.ok(g.strokes.length >= 2, `${c} draws something`)
      for (const s of g.strokes) {
        assert.ok(s.pts.length >= 2, `${c} stroke has points`)
        for (const [x, y] of s.pts) {
          assert.ok(Number.isFinite(x) && Number.isFinite(y))
          assert.ok(x > -10 && x < FRAME.w + 10 && y > -20 && y < FRAME.h + 10, `${c} point ${x},${y} outside the frame`)
        }
      }
    }
  }
})

test('same options give an identical dataset; a different seed gives a different one', () => {
  const again = [...generate(small)]
  assert.equal(JSON.stringify(again), JSON.stringify(all))
  const other = [...generate({ ...small, seed: 4 })]
  assert.notEqual(JSON.stringify(other[0].strokes), JSON.stringify(all[0].strokes))
})

test('samples are well-formed: valid schema, finite numbers, time never runs backwards', () => {
  for (const s of all) {
    assert.ok(SketchSample.safeParse(s).success, `${s.id} fails the schema`)
    let prev = -1
    for (const st of s.strokes) {
      assert.ok(st.length >= 2, `${s.id} has a one-point stroke`)
      for (const [x, y, t] of st) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(t), `${s.id} non-finite`)
        assert.ok(t >= prev, `${s.id} time goes backwards`)
        prev = t
      }
    }
    assert.equal(s.strokes[0][0][2], 0, `${s.id} does not start at t=0`)
  }
})

test('every label is present and counts are balanced per writer', () => {
  const byCls = {}
  for (const s of all) byCls[s.cls] = (byCls[s.cls] ?? 0) + 1
  assert.deepEqual(Object.keys(byCls).sort(), [...ALL_LABELS].sort())
  for (const c of WAVE1_CLASSES) assert.equal(byCls[c], small.writers * small.reps, c)
  assert.equal(byCls[UNKNOWN_CLASS], small.writers * small.reps * 2)
})

test('splits are by writer: no writer appears in two splits, and all three exist', () => {
  assertWriterDisjoint(all)
  const splits = new Set(all.map((s) => s.split))
  assert.deepEqual([...splits].sort(), ['test', 'train', 'val'])
})

test('everything is labelled synthetic; unknown is the negative source', () => {
  for (const s of all) {
    assert.ok(s.source === 'synthetic' || s.source === 'synthetic-negative', s.id)
    assert.equal(groupOf(s), 'synthetic')
    assert.equal(s.source === 'synthetic-negative', s.cls === UNKNOWN_CLASS, s.id)
  }
})

test('devices follow the audience: mouse + touchpad most, pen rarest', () => {
  const big = [...generate({ seed: 9, writers: 400, reps: 1 })]
  const writers = new Map(big.map((s) => [s.writer, s.device]))
  const n = (d) => [...writers.values()].filter((x) => x === d).length
  assert.ok(n('mouse') + n('touchpad') > n('finger') + n('pen'))
  assert.ok(n('pen') < n('finger') && n('pen') < n('touchpad'))
  assert.ok(n('pen') > 0, 'pen still appears')
})

test('pose labels fold symmetric classes: a resistor is never 180 degrees', () => {
  const big = [...generate({ seed: 5, writers: 60, reps: 3 })]
  for (const s of big) {
    if (POSE_SYMMETRY[s.cls] === 'rot180') assert.ok(s.pose === 0 || s.pose === 90, `${s.cls} pose ${s.pose}`)
  }
  assert.equal(canonicalPose('resistor', 180), 0)
  assert.equal(canonicalPose('diode', 180), 180)
  assert.ok(big.some((s) => s.cls === 'diode' && s.pose === 180), 'diodes do appear reversed')
})

test('the data is varied: samples of one class differ, and sizes span a range', () => {
  const rs = all.filter((s) => s.cls === 'resistor')
  assert.equal(new Set(rs.map((s) => JSON.stringify(s.strokes))).size, rs.length)
  const widths = rs.map((s) => { const xs = s.strokes.flat().map((p) => p[0]); return Math.max(...xs) - Math.min(...xs) })
  assert.ok(Math.max(...widths) / Math.min(...widths) > 1.5, 'symbol size varies')
  const strokeCounts = new Set(all.filter((s) => s.cls === 'battery').map((s) => s.strokes.length))
  assert.ok(strokeCounts.size > 1, 'the number of pen strokes varies for one class')
})

test('parseShard rejects a malformed line with its line number', () => {
  assert.throws(() => parseShard(JSON.stringify(all[0]) + '\n{"id":"x"}\n'), /line 2/)
})

test('loadDir verifies a shard against MANIFEST.json and notices tampering', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sketch-shards-'))
  try {
    const bytes = gzipSync(Buffer.from(all.slice(0, 5).map((s) => JSON.stringify(s)).join('\n') + '\n'))
    writeFileSync(join(dir, 'train-0000.jsonl.gz'), bytes)
    writeFileSync(join(dir, 'MANIFEST.json'), JSON.stringify({ shards: [{ file: 'train-0000.jsonl.gz', sha256: createHash('sha256').update(bytes).digest('hex') }] }))
    assert.equal(loadDir(dir).length, 5)
    writeFileSync(join(dir, 'train-0000.jsonl.gz'), gzipSync(Buffer.from(JSON.stringify(all[0]) + '\n')))
    assert.throws(() => loadDir(dir), /does not match MANIFEST/)
    assert.deepEqual(readdirSync(dir).sort(), ['MANIFEST.json', 'train-0000.jsonl.gz'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('real-data shards load through the same path, in their own group', () => {
  const real = { ...all[0], id: 'real-1', source: 'real', writer: 'anon-1' }
  assert.ok(SketchSample.safeParse(real).success)
  assert.equal(groupOf(real), 'real')
})
