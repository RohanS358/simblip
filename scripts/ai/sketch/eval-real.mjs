// Score the shipped SketchNet on REAL strokes (the ones people confirmed or
// corrected in the app), with no Python needed.
//
//   npm run sketch:eval-real -- --dir data/sketch/real
//
// This is the first number that says anything about people. It is small and
// comes from very few writers — read it as a smoke test, not a benchmark.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSketchNet } from '../../../lib/sketch/sketchnet.ts'
import { bestSymbol, NEURAL_MIN_P, NEURAL_SHOW_P } from '../../../lib/sketch/neural-pick.ts'
import { groupOf, iterDir } from './dataset.mjs'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const dir = arg('dir', 'data/sketch/real')
const model = arg('model', 'public/models/sketchnet-v1')

const manifest = JSON.parse(readFileSync(resolve(`${model}.json`), 'utf8'))
const bin = readFileSync(resolve(`${model}.bin`))
const net = createSketchNet(manifest, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength))

const samples = [...iterDir(dir)].filter((s) => groupOf(s) === 'real')
if (!samples.length) {
  console.log(`no real samples in ${dir}. Use the app (Pen settings → neural recogniser), confirm some symbols, export, then sketch:import-real.`)
  process.exit(0)
}

let top1 = 0, shown = 0, accepted = 0, shownRight = 0
const per = {}
const confusions = {}
const buckets = { '<0.15': 0, '0.15-0.45': 0, '0.45-0.9': 0, '>=0.9': 0 }
for (const s of samples) {
  const p = net.predict(s.strokes)
  const best = bestSymbol(p)
  const ok = p.cls === s.cls
  const row = (per[s.cls] ??= { n: 0, ok: 0 })
  row.n++
  if (ok) { top1++; row.ok++ } else { const k = `${s.cls} -> ${p.cls}`; confusions[k] = (confusions[k] ?? 0) + 1 }
  const bp = best?.p ?? 0
  buckets[bp < NEURAL_SHOW_P ? '<0.15' : bp < NEURAL_MIN_P ? '0.15-0.45' : bp < 0.9 ? '0.45-0.9' : '>=0.9']++
  if (best && bp >= NEURAL_SHOW_P) { shown++; if (best.cls === s.cls) shownRight++ }
  if (best && bp >= NEURAL_MIN_P) accepted++
}
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a')
console.log(`REAL strokes: ${samples.length} samples from ${new Set(samples.map((s) => s.writer)).size} writer(s), model ${manifest.name}`)
console.log('(small and from few people: a smoke test, not a benchmark)\n')
console.log(`top-1 (model's first class incl. 'unknown'): ${pct(top1, samples.length)}`)
console.log(`best real symbol right when a ghost would show (p >= ${NEURAL_SHOW_P}): ${pct(shownRight, shown)}  (${shown}/${samples.length} would show)`)
console.log(`would be offered at p >= ${NEURAL_MIN_P}: ${accepted}/${samples.length}`)
console.log('best-symbol probability:', JSON.stringify(buckets))
console.log('per class:', Object.entries(per).map(([c, v]) => `${c} ${v.ok}/${v.n}`).join(', '))
console.log('top confusions:', Object.entries(confusions).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} x${v}`).join(', ') || 'none')
