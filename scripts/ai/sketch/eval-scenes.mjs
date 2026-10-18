// Whole-circuit evaluation on SYNTHETIC hand-drawn sketches.
//
//   npm run sketch:eval-scenes -- --layouts data/sketch/scenes/layouts-s1.json --n 300
//
// Draws circuits with generated hands, reads them back with the real pipeline
// (grouping → SketchNet → wires → nets), and compares each result to the circuit
// that was drawn. Reports exact-circuit rate, part and wiring accuracy and a
// taps-to-fix estimate, overall and per device / topology.
//
// SYNTHETIC: this measures the extractor on generated hands. It says nothing
// about real handwriting; real whole-circuit sketches are needed for that.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSketchNet } from '../../../lib/sketch/sketchnet.ts'
import { extractCircuit } from '../../../lib/sketch/extract.ts'
import { compareIR } from '../../../lib/sketch/compare-ir.ts'
import { drawScene } from '../../../lib/sketch/scene-synth.ts'
import { makeRng } from '../../../lib/sketch/rng.ts'
import { makeWriter } from '../../../lib/sketch/synth.ts'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const file = resolve(arg('layouts', 'data/sketch/scenes/layouts-s1.json'))
const N = Number(arg('n', 300))
const seed = Number(arg('seed', 7))
const verbose = process.argv.includes('--verbose')
const xopts = { tolPinK: arg('tolPin') ? Number(arg('tolPin')) : undefined, tolJoinK: arg('tolJoin') ? Number(arg('tolJoin')) : undefined, minPartP: arg('minPartP') ? Number(arg('minPartP')) : undefined }
const modelBase = resolve(arg('model', 'public/models/sketchnet-v1'))

const manifest = JSON.parse(readFileSync(`${modelBase}.json`, 'utf8'))
const bin = readFileSync(`${modelBase}.bin`)
const net = createSketchNet(manifest, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength))
const { layouts } = JSON.parse(readFileSync(file, 'utf8'))
const rng = makeRng(seed)

const agg = () => ({ n: 0, exact: 0, taps: 0, nodes: 0, matched: 0, classOk: 0, extra: 0, netsMissing: 0, netsExtra: 0, truthNets: 0 })
const total = agg()
const byDevice = {}
const byTopo = {}
const fails = []
const why = { opamp: 0, 'part missed/extra': 0, 'wrong class': 0, 'wiring only': 0 }
const t0 = Date.now()

for (let i = 0; i < N; i++) {
  const layout = layouts[rng.int(0, layouts.length - 1)]
  const w = makeWriter(rng.fork(`w${i}`), `eval-w${i}`)
  const scene = drawScene(layout, rng.fork(`s${i}`), w)
  const ink = scene.strokes.map((pts, k) => ({ id: `k${k}`, pts }))
  const got = extractCircuit(ink, net, xopts)
  const c = compareIR(got.ir, scene.truth)
  const topo = layout.ir.nodes.map((n) => n.cls).sort().join('+')
  for (const bucket of [total, (byDevice[scene.device] ??= agg()), (byTopo[topo] ??= agg())]) {
    bucket.n++
    bucket.exact += c.exact ? 1 : 0
    bucket.taps += c.taps
    bucket.nodes += c.truthNodes
    bucket.matched += c.matched
    bucket.classOk += c.classCorrect
    bucket.extra += c.extra
    bucket.netsMissing += c.netsMissing
    bucket.netsExtra += c.netsExtra
  }
  if (!c.exact) {
    const hasOpamp = scene.truth.nodes.some((n) => n.cls === 'opamp')
    if (hasOpamp) why.opamp++
    else if (c.missed || c.extra) why['part missed/extra']++
    else if (c.classCorrect < c.matched) why['wrong class']++
    else why['wiring only']++
  }
  if (!c.exact && fails.length < 8) fails.push({ id: scene.id, device: scene.device, c, got: got.ir.nodes.map((n) => n.cls).join(','), want: scene.truth.nodes.map((n) => n.cls).join(',') })
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a')
const line = (name, a) =>
  `${name.padEnd(12)} n=${String(a.n).padStart(4)}  exact ${pct(a.exact, a.n).padStart(6)}  parts found ${pct(a.matched, a.nodes).padStart(6)}  class ok ${pct(a.classOk, a.matched).padStart(6)}  extra ${a.extra}  nets missing/extra ${a.netsMissing}/${a.netsExtra}  taps/circuit ${(a.taps / a.n).toFixed(2)}`
console.log(`SYNTHETIC whole-circuit sketches (generated hands; not real-world validation) — ${N} circuits, ${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log(line('ALL', total))
console.log('why circuits fail (first matching reason):', JSON.stringify(why))
for (const [d, a] of Object.entries(byDevice)) console.log(line(d, a))
if (verbose) {
  const worst = Object.entries(byTopo).filter(([, a]) => a.n >= 3).sort((a, b) => a[1].exact / a[1].n - b[1].exact / b[1].n).slice(0, 8)
  console.log('\nweakest circuit kinds:')
  for (const [t, a] of worst) console.log('  ' + line(t.slice(0, 40), a))
  console.log('\nfirst failures:')
  for (const f of fails) console.log(' ', JSON.stringify(f))
}
