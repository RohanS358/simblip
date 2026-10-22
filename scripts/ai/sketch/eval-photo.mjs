// Photo path on SYNTHETIC photos (clean circuits drawn by the generator, rendered to pixels and spoiled like a
// phone photo). NOT real-photo validation: no real photographs have been evaluated yet.
//   node --experimental-strip-types --import ./scripts/test/register.mjs scripts/ai/sketch/eval-photo.mjs [--n 40] [--hard]
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSketchNet } from '../../../lib/sketch/sketchnet.ts'
import { readPhoto } from '../../../lib/sketch/photo/index.ts'
import { renderPhoto } from '../../../lib/sketch/photo/synth-photo.ts'
import { drawScene } from '../../../lib/sketch/scene-synth.ts'
import { makeWriter } from '../../../lib/sketch/synth.ts'
import { makeRng } from '../../../lib/sketch/rng.ts'
import { compareIR } from '../../../lib/sketch/compare-ir.ts'
const load = (n) => { const b = readFileSync(resolve(`public/models/${n}.bin`)); return createSketchNet(JSON.parse(readFileSync(resolve(`public/models/${n}.json`), 'utf8')), b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }
const net = load('sketchnet-v1'), charNet = load('inkchars-v1')
const { layouts } = JSON.parse(readFileSync(resolve('lib/sketch/golden/scene-layouts.json'), 'utf8'))
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const N = Number(arg('n', layouts.length)); const W = Number(arg('width', 2)); const Z = Number(arg('zoom', 1)); const hard = process.argv.includes('--hard')
let classOk = 0, matchedN = 0, netsMiss = 0, netsExtra = 0, n = 0, circuit = 0, partsFound = 0, partsTruth = 0, exact = 0; const why = {}
for (let i = 0; i < Math.min(N, layouts.length); i++) {
  const rng = makeRng(900 + i)
  const sc = drawScene(layouts[i], rng.fork('s'), makeWriter(rng.fork('w'), `ph-${i}`, 'pen'), undefined, undefined, { text: false })
  const img = renderPhoto(sc.strokes, rng.fork('p'), hard ? { width: 4, blur: 2, shade: 0.3, noise: 10, tilt: 3 } : { width: W, blur: 1, shade: 0.12, noise: 4, tilt: 0, zoom: Z })
  const r = readPhoto(img, net, charNet)
  n++
  partsTruth += sc.truth.nodes.length
  if ('error' in r) { why[r.error.slice(0, 40)] = (why[r.error.slice(0, 40)] ?? 0) + 1; continue }
  if (r.result.kind !== 'circuit') { const k = r.result.kind === 'fail' ? 'fail:' + r.result.failure.reason : r.result.kind; why[k] = (why[k] ?? 0) + 1; continue }
  circuit++
  const got = r.result.ghost.result
  partsFound += got.parts.length
  // back into the truth's coordinates (the picture was shifted and shrunk); tilt cannot be undone, so hard mode compares part lists
  const sc2 = r.ink.scale
  const mapped = { ...got.ir, nodes: got.ir.nodes.map((nd) => ({ ...nd, bbox: [nd.bbox[0] / sc2 - img.shiftX, nd.bbox[1] / sc2 - img.shiftY, nd.bbox[2] / sc2, nd.bbox[3] / sc2] })) }
  const sameParts = got.ir.nodes.map((x) => x.cls).sort().join() === sc.truth.nodes.map((x) => x.cls).sort().join()
  const cmpx = compareIR(mapped, sc.truth)
  if (process.argv.includes('--detail') && i === 0) console.log('pred', JSON.stringify(mapped.nodes.map((x) => [x.cls, x.bbox.map(Math.round)])), 'truth', JSON.stringify(sc.truth.nodes.map((x) => [x.cls, x.bbox.map(Math.round)])), 'shift', img.shiftX, img.shiftY, 'scale', sc2)
  if (process.argv.includes('--detail') && sameParts) console.log(i, 'matched', cmpx.matched, '/', cmpx.truthNodes, 'class ok', cmpx.classCorrect, 'nets missing/extra', cmpx.netsMissing, cmpx.netsExtra, 'edges', got.ir.edges.length, 'truth edges', sc.truth.edges.length)
  if (!hard) { classOk += cmpx.classCorrect; matchedN += cmpx.matched; netsMiss += cmpx.netsMissing; netsExtra += cmpx.netsExtra }
  const good = hard ? sameParts : cmpx.exact
  if (good) exact++; else why[sameParts ? 'right parts, wrong wiring' : 'wrong parts'] = (why[sameParts ? 'right parts, wrong wiring' : 'wrong parts'] ?? 0) + 1
}
console.log(`SYNTHETIC photos${hard ? ' (hard: blur, shade, noise, tilt)' : ''} n=${n}: read as circuit ${circuit}/${n}, scene right ${exact}/${n} (${(100 * exact / n).toFixed(0)}%), parts ${partsFound}/${partsTruth}`)
if (!hard) console.log(`parts matched by position ${matchedN}/${partsTruth}, of those right class ${classOk}; nets missing/extra ${netsMiss}/${netsExtra}`)
console.log('why not:', JSON.stringify(why))
