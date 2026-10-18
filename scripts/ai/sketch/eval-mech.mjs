// Mechanics reader on the SYNTHETIC gold situations (generated hands; not real handwriting).
//   npm run sketch:eval-mech -- --n 8 --verbose
// For every situation, N differently drawn variants (writers: mouse / touchpad / finger / pen) are read
// back and compared with the scene that was drawn. Reports per situation and per device.

import { extractMechanics } from '../../../lib/sketch/mech.ts'
import { compareMech } from '../../../lib/sketch/compare-mech.ts'
import { MECH_SITUATIONS, makeMechScene } from '../../../lib/sketch/mech-synth.ts'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const N = Number(arg('n', 8))
const verbose = process.argv.includes('--verbose')
const only = arg('only')
const dump = process.argv.includes('--dump')
const devices = ['mouse', 'touchpad', 'finger', 'pen']

const per = []
const byDev = Object.fromEntries(devices.map((d) => [d, { n: 0, exact: 0 }]))
let gapOk = 0, gapN = 0
for (let i = 0; i < MECH_SITUATIONS.length; i++) {
  const sit = MECH_SITUATIONS[i]
  if (only && !sit.id.includes(only)) continue
  let exact = 0, n = 0
  const why = {}
  for (let k = 0; k < N; k++) {
    const dev = devices[k % devices.length]
    const scene = makeMechScene(i, 10 + k, dev)
    const ink = scene.strokes.map((s, j) => ({ id: `k${j}`, pts: s.map(([x, y]) => [x, y]) }))
    const got = extractMechanics(ink)
    if (scene.expect.kind === 'gap') {
      gapN++
      if (got.gaps.some((g) => g.what === 'pulley')) gapOk++
      continue
    }
    const c = compareMech(got.ir, scene.truth.ir)
    if (dump && !c.exact) {
      const f = (n) => `${n.id}:${n.cls}@${Math.round(n.bbox[0] + n.bbox[2] / 2)},${Math.round(n.bbox[1] + n.bbox[3] / 2)} ${n.bbox[2].toFixed(0)}x${n.bbox[3].toFixed(0)} a${(n.angle ?? 0).toFixed(0)}${n.values ? ' ' + JSON.stringify(n.values) : ''}`
      console.log(`--- ${sit.id} k=${k} ${dev}`)
      console.log(' truth:', scene.truth.ir.nodes.map(f).join(' | '), '| edges', scene.truth.ir.edges.map((e) => `${e.a.node}-${e.b.node}:${e.kind}`).join(' '))
      console.log(' got  :', got.ir.nodes.map(f).join(' | '), '| edges', got.ir.edges.map((e) => `${e.a.node}-${e.b.node}:${e.kind}`).join(' '), '| ignored', got.ignoredIds.length)
    }
    n++
    byDev[dev].n++
    if (c.exact) { exact++; byDev[dev].exact++ }
    else {
      const r = c.missed.length ? `missed ${c.missed.join(' ')}` : c.wrongClass.length ? `wrong ${c.wrongClass.join(' ')}` : c.extra ? `extra ${c.extra}` : c.edgesMatched < c.edgesTruth ? 'missing link' : c.edgesExtra ? 'extra link' : `angle ${c.notes.join('; ')}`
      why[r] = (why[r] ?? 0) + 1
    }
  }
  if (n) per.push({ id: sit.id, n, exact, why })
}
const tot = per.reduce((a, p) => a + p.n, 0)
const ex = per.reduce((a, p) => a + p.exact, 0)
console.log(`SYNTHETIC mechanics sketches (generated hands; not real-world validation) — ${tot} readings`)
console.log(`exact scene: ${ex}/${tot} (${((100 * ex) / Math.max(1, tot)).toFixed(1)}%)   pulley gap reported: ${gapOk}/${gapN}`)
for (const p of per) {
  console.log(`${p.id.padEnd(30)} ${String(p.exact).padStart(2)}/${p.n}${verbose && Object.keys(p.why).length ? '   ' + JSON.stringify(p.why) : ''}`)
}
for (const d of devices) console.log(`${d.padEnd(9)} ${byDev[d].exact}/${byDev[d].n}`)
