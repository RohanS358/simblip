// AUDIT: domain choice for circuits WITH handwritten value labels (the earlier test only used unlabelled circuits). SYNTHETIC.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSketchNet } from '../../../lib/sketch/sketchnet.ts'
import { readSketch } from '../../../lib/sketch/read-sketch.ts'
import { drawScene } from '../../../lib/sketch/scene-synth.ts'
import { makeRng } from '../../../lib/sketch/rng.ts'
import { makeWriter } from '../../../lib/sketch/synth.ts'
const load = (n) => { const b = readFileSync(resolve(`public/models/${n}.bin`)); return createSketchNet(JSON.parse(readFileSync(resolve(`public/models/${n}.json`), 'utf8')), b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }
const net = load('sketchnet-v1'), charNet = load('inkchars-v1')
const { layouts } = JSON.parse(readFileSync(resolve('lib/sketch/golden/scene-layouts.json'), 'utf8'))
for (const text of [false, true]) {
  const tally = {}
  let n = 0
  const misrouted = []
  for (let i = 0; i < layouts.length; i++) for (const dev of ['mouse', 'touchpad', 'finger', 'pen']) {
    const rng = makeRng(500 + i)
    const sc = drawScene(layouts[i], rng.fork('s'), makeWriter(rng.fork('w'), `dm-${i}-${dev}`, dev), undefined, undefined, { text })
    const ink = sc.strokes.map((pts, k) => ({ id: `k${k}`, pts }))
    const r = readSketch('p', ink, ink[ink.length - 1].id, net, charNet)
    const key = r.kind === 'mechanics' ? `WRONG DOMAIN (${r.ghost.domain})` : r.kind
    tally[key] = (tally[key] ?? 0) + 1
    n++
    if (r.kind === 'mechanics' && misrouted.length < 5) misrouted.push(`layout ${i} ${dev}: ${r.ghost.ir.nodes.map((x) => x.cls).join(',')}`)
  }
  console.log(`circuits ${text ? 'WITH' : 'without'} labels, n=${n}:`, JSON.stringify(tally))
  if (misrouted.length) console.log('   e.g.', misrouted.join(' | '))
}
