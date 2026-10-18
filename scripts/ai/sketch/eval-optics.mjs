// Optics reader on the SYNTHETIC gold situations (generated hands; not real handwriting).
//   npm run sketch:eval-optics -- --n 8 --dump
import { extractOptics } from '../../../lib/sketch/optics.ts'
import { compareMech } from '../../../lib/sketch/compare-mech.ts'
import { OPTICS_SITUATIONS, makeOpticsScene } from '../../../lib/sketch/optics-synth.ts'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const N = Number(arg('n', 8))
const only = arg('only')
const dump = process.argv.includes('--dump')
const devices = ['mouse', 'touchpad', 'finger', 'pen']
let tot = 0, ex = 0, fOk = 0, fTot = 0
const rows = []
for (let i = 0; i < OPTICS_SITUATIONS.length; i++) {
  const sit = OPTICS_SITUATIONS[i]
  if (only && !sit.id.includes(only)) continue
  let exact = 0
  for (let k = 0; k < N; k++) {
    const dev = devices[k % 4]
    const sc = makeOpticsScene(i, 10 + k, dev)
    const ink = sc.strokes.map((s, j) => ({ id: `k${j}`, pts: s.map(([x, y]) => [x, y]) }))
    const r = extractOptics(ink)
    const c = compareMech(r.ir, sc.truth.ir, { angleTol: 10 }) // a hand-drawn beam arrow is only roughly at its angle
    // focal lengths: within 20 % where the sketch carries marks
    for (const t of sc.truth.ir.nodes.filter((n) => n.cls === 'thin-lens' && n.values?.f)) {
      const g = r.ir.nodes.find((n) => n.cls === 'thin-lens' && Math.abs(n.bbox[0] - t.bbox[0]) < 30)
      if (g && sc.owners.includes('mark')) { fTot++; if (Math.abs(Number(g.values?.f) - Number(t.values.f)) <= 0.2 * Math.abs(Number(t.values.f)) && Math.sign(Number(g.values.f)) === Math.sign(Number(t.values.f))) fOk++ }
    }
    tot++
    if (c.exact) { exact++; ex++ }
    else if (dump) {
      const f = (n) => `${n.id}:${n.cls}@${Math.round(n.bbox[0] + n.bbox[2] / 2)},${Math.round(n.bbox[1] + n.bbox[3] / 2)} ${n.bbox[2].toFixed(0)}x${n.bbox[3].toFixed(0)} a${(n.angle ?? 0).toFixed(0)}${n.values ? ' f' + n.values.f : ''}`
      console.log(`--- ${sit.id} k=${k} ${dev}`)
      console.log(' truth:', sc.truth.ir.nodes.map(f).join(' | '))
      console.log(' got  :', r.ir.nodes.map(f).join(' | '), '| ignored', r.ignoredIds.length)
    }
  }
  rows.push([sit.id, exact])
}
console.log(`SYNTHETIC optics sketches (generated hands; not real-world validation) — ${tot} readings`)
console.log(`exact scene (classes, positions, tilt): ${ex}/${tot} (${((100 * ex) / Math.max(1, tot)).toFixed(1)}%)   focal length right (where marked): ${fOk}/${fTot}`)
for (const [id, e] of rows) console.log(`${id.padEnd(28)} ${e}/${N}`)
