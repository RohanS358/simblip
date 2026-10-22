// SYNTHETIC "photo" samples for training SketchNet: each symbol is rendered to pixels (printed-style and
// hand-style hands, varied line width, blur, shading, noise, resolution), then run through the REAL photo
// pipeline (threshold, thinning, tracing). The traced strokes are the sample. A network trained only on pen
// strokes meets traced strokes in a photographed diagram (no timing, cut at junctions, burrs at corners);
// training on what the pipeline really produces closes that gap.
//
//   node --experimental-strip-types --import ./scripts/test/register.mjs scripts/ai/sketch/synth-photo-data.mjs --seed 5 --writers 200 --reps 6 --out data/sketch/synthetic-photo
// Output has the same shape as synth.mjs, source "synthetic" / "synthetic-negative".

import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { drawSymbol, drawNegative, makeWriter, GENERATOR_VERSION } from '../../../lib/sketch/synth.ts'
import { WAVE1_CLASSES, ALL_LABELS, CLASS_LIST_VERSION, UNKNOWN_CLASS } from '../../../lib/sketch/classes.ts'
import { makeRng } from '../../../lib/sketch/rng.ts'
import { photoToInk } from '../../../lib/sketch/photo/index.ts'
import { renderPhoto, printedWriter } from '../../../lib/sketch/photo/synth-photo.ts'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const seed = Number(arg('seed', 5)), writers = Number(arg('writers', 200)), reps = Number(arg('reps', 6))
const out = resolve(arg('out', 'data/sketch/synthetic-photo'))
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const root = makeRng(seed)
const order = root.fork('split').shuffle(Array.from({ length: writers }, (_, i) => i))
const splitOf = new Map()
order.forEach((w, rank) => { const f = rank / writers; splitOf.set(w, f < 0.7 ? 'train' : f < 0.85 ? 'val' : 'test') })

const buffers = { train: [], val: [], test: [] }
const shards = []
const counts = { split: { train: 0, val: 0, test: 0 }, cls: {}, device: {} }
const next = { train: 0, val: 0, test: 0 }
const flush = (split) => {
  if (!buffers[split].length) return
  const file = `${split}-${String(next[split]++).padStart(4, '0')}.jsonl.gz`
  const bytes = gzipSync(Buffer.from(buffers[split].join('\n') + '\n'), { level: 9 })
  writeFileSync(join(out, file), bytes)
  shards.push({ file, split, count: buffers[split].length, sha256: createHash('sha256').update(bytes).digest('hex') })
  buffers[split] = []
}

/** Traced strokes have no timing: give them a plausible one (steady speed, a pause between strokes). */
const withTime = (strokes) => {
  let t = 0
  return strokes.map((s) => {
    const out = []
    for (let i = 0; i < s.length; i++) {
      if (i) t += Math.max(1, Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]) / 0.5)
      out.push([s[i][0], s[i][1], Math.round(t)])
    }
    t += 150
    return out
  })
}

const t0 = Date.now()
let dropped = 0
for (let wi = 0; wi < writers; wi++) {
  const wid = `photo-${seed}-w${String(wi).padStart(4, '0')}`
  const wrng = root.fork(wid)
  const printed = wrng.chance(0.55)
  const style = printed ? printedWriter(wid) : makeWriter(wrng, wid, 'pen')
  const split = splitOf.get(wi)
  const cam = { width: wrng.pick([2, 2, 3, 4]), blur: wrng.pick([0, 1, 1, 2]), shade: wrng.range(0, 0.25), noise: wrng.range(0, 6), zoom: wrng.pick([1, 1, 2, 3]) }
  const make = (id, cls, drawn, source, pose) => {
    const rng = wrng.fork(id)
    const img = renderPhoto(drawn.strokes, rng.fork('p'), { ...cam, margin: 40 })
    const r = photoToInk(img)
    if ('error' in r || r.ink.strokes.length === 0) { dropped++; return }
    const strokes = withTime(r.ink.strokes.map((s) => s.pts.map(([x, y]) => [x, y])))
    buffers[split].push(JSON.stringify({ id, cls, pose, strokes, source, writer: wid, device: 'pen', split, meta: { generator: GENERATOR_VERSION, seed, photo: true, printed, zoom: cam.zoom, width: cam.width } }))
    counts.split[split]++
    counts.cls[cls] = (counts.cls[cls] ?? 0) + 1
    counts.device.pen = (counts.device.pen ?? 0) + 1
    if (buffers[split].length >= 4000) flush(split)
  }
  for (const cls of WAVE1_CLASSES) for (let r = 0; r < reps; r++) {
    const id = `${wid}-${cls}-${r}`
    const d = drawSymbol(wrng.fork(id), style, cls)
    make(id, cls, d, 'synthetic', d.pose)
  }
  for (let r = 0; r < reps; r++) {
    const id = `${wid}-${UNKNOWN_CLASS}-${r}`
    const d = drawNegative(wrng.fork(id), style)
    make(id, UNKNOWN_CLASS, d, 'synthetic-negative', 0)
  }
  if (wi % 20 === 0) console.log(`writer ${wi}/${writers}  ${((Date.now() - t0) / 1000).toFixed(0)}s`)
}
for (const k of Object.keys(buffers)) flush(k)
const total = Object.values(counts.split).reduce((a, b) => a + b, 0)
writeFileSync(join(out, 'MANIFEST.json'), JSON.stringify({
  name: `synthetic-photo-s${seed}`,
  notice: 'SYNTHETIC. Generated symbols rendered to pixels and traced by the photo pipeline. Not real photographs.',
  source: ['synthetic', 'synthetic-negative'], licence: 'generated by SIMBLIP (no third-party data)',
  generatorVersion: GENERATOR_VERSION, classListVersion: CLASS_LIST_VERSION, labels: ALL_LABELS,
  options: { seed, writers, reps, photo: true }, total, counts, dropped, splitRule: 'by writer', shards,
}, null, 2) + '\n')
console.log(`wrote ${total} samples (${dropped} dropped) to ${out} in ${((Date.now() - t0) / 1000).toFixed(0)}s`)
