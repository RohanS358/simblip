// AUDIT: how long does pressing "Done drawing" block the page, for realistic and cluttered ink? (SYNTHETIC ink)
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSketchNet } from '../../../lib/sketch/sketchnet.ts'
import { readSketch } from '../../../lib/sketch/read-sketch.ts'
import { drawScene } from '../../../lib/sketch/scene-synth.ts'
import { makeMechScene } from '../../../lib/sketch/mech-synth.ts'
import { makeRng } from '../../../lib/sketch/rng.ts'
import { makeWriter } from '../../../lib/sketch/synth.ts'

const load = (n) => { const b = readFileSync(resolve(`public/models/${n}.bin`)); return createSketchNet(JSON.parse(readFileSync(resolve(`public/models/${n}.json`), 'utf8')), b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }
const net = load('sketchnet-v1'), charNet = load('inkchars-v1')
const { layouts } = JSON.parse(readFileSync(resolve('lib/sketch/golden/scene-layouts.json'), 'utf8'))
const rng = makeRng(3)
const circuit = (i, text, dx, dy) => {
  const w = makeWriter(rng.fork(`w${i}`), `perf${i}`)
  const sc = drawScene(layouts[i % layouts.length], rng.fork(`s${i}`), w, undefined, undefined, { text })
  return sc.strokes.map((pts) => pts.map(([x, y]) => [x + dx, y + dy]))
}
const time = (label, strokes) => {
  const ink = strokes.map((pts, k) => ({ id: `k${k}`, pts }))
  const t0 = performance.now()
  const r = readSketch('p', ink, ink[ink.length - 1].id, net, charNet)
  const ms = performance.now() - t0
  console.log(label.padEnd(58), `${String(ink.length).padStart(4)} strokes  ${ms.toFixed(0).padStart(6)} ms  →`, r.kind, r.kind === 'fail' ? r.failure.reason : '')
}
time('one circuit, no labels', circuit(1, false, 0, 0))
time('one circuit, with labels', circuit(2, true, 0, 0))
time('big circuit with labels (5 parts)', circuit(8, true, 0, 0))
// clutter: several earlier sketches near each other on the page, then the last one
const clutter = []
for (let k = 0; k < 4; k++) clutter.push(...circuit(k + 3, true, 60 * k, 40 * k))
time('4 labelled circuits overlapping within 200 px', clutter)
const m = makeMechScene(3, 10, 'mouse').strokes
time('a ramp scene', m)
time('a ramp scene + a circuit nearby', [...circuit(1, false, 700, 0), ...m])

// AUDIT: does a sketch NEXT TO another one still read as the right domain? (two circuits side by side, seed = last stroke of the 2nd)
console.log('\nneighbour test: circuit B drawn dx px to the right of circuit A (both with labels); read B')
for (const dx of [120, 200, 300, 500]) {
  let circ = 0, mech = 0, other = 0, n = 0
  for (let i = 0; i < 12; i++) {
    const a = circuit(i, true, 0, 0), b = circuit((i + 5) % layouts.length, true, 0, 0)
    const ax1 = Math.max(...a.flat().map((p) => p[0])), bx0 = Math.min(...b.flat().map((p) => p[0]))
    const bShift = b.map((s) => s.map(([x, y]) => [x + (ax1 - bx0) + dx, y]))
    const ink = [...a, ...bShift].map((pts, k) => ({ id: `k${k}`, pts }))
    const r = readSketch('p', ink, ink[ink.length - 1].id, net, charNet)
    n++
    if (r.kind === 'circuit') circ++; else if (r.kind === 'mechanics') mech++; else other++
  }
  console.log(`  gap ${String(dx).padStart(3)} px: read as circuit ${circ}/${n}, mechanics/optics ${mech}/${n}, other (symbol/failure) ${other}/${n}`)
}
