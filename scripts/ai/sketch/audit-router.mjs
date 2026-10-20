// End-to-end DOMAIN ROUTING through the real readSketch(): single symbols, circuits (with/without labels),
// mechanics and optics benches. SYNTHETIC hands (not real-world validation).
//   node --experimental-strip-types --import ./scripts/test/register.mjs scripts/ai/sketch/audit-router.mjs [--quick]
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSketchNet } from '../../../lib/sketch/sketchnet.ts'
import { readSketch } from '../../../lib/sketch/read-sketch.ts'
import { drawScene, } from '../../../lib/sketch/scene-synth.ts'
import { drawSymbol, makeWriter } from '../../../lib/sketch/synth.ts'
import { WAVE1_CLASSES } from '../../../lib/sketch/classes.ts'
import { makeMechScene, MECH_SITUATIONS } from '../../../lib/sketch/mech-synth.ts'
import { makeOpticsScene, OPTICS_SITUATIONS } from '../../../lib/sketch/optics-synth.ts'
import { makeRng } from '../../../lib/sketch/rng.ts'

const load = (n) => { const b = readFileSync(resolve(`public/models/${n}.bin`)); return createSketchNet(JSON.parse(readFileSync(resolve(`public/models/${n}.json`), 'utf8')), b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }
const net = load('sketchnet-v1'), charNet = load('inkchars-v1')
const { layouts } = JSON.parse(readFileSync(resolve('lib/sketch/golden/scene-layouts.json'), 'utf8'))
const devs = ['mouse', 'touchpad', 'finger', 'pen']
const quick = process.argv.includes('--quick')
const label = (r) => (r.kind === 'mechanics' ? r.ghost.domain : r.kind === 'fail' ? `fail:${r.failure.reason}` : r.kind)
const out = {}
const report = (name, ok, n, bad) => {
  out[name] = { ok, n }
  console.log(`${name.padEnd(34)} ${String(ok).padStart(4)}/${String(n).padEnd(4)} ${(100 * ok / n).toFixed(1).padStart(5)}%   ${Object.entries(bad).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}×${v}`).join(' ')}`)
}

// 1. single symbols (with leads) — must come back as that symbol
{
  let ok = 0, n = 0; const bad = {}
  for (const cls of WAVE1_CLASSES) for (const dev of devs) for (let k = 0; k < (quick ? 2 : 6); k++) {
    const rng = makeRng(k * 97 + 11)
    const d = drawSymbol(rng.fork('d'), makeWriter(rng.fork('w'), `sym-${cls}-${dev}-${k}`, dev), cls)
    const ink = d.strokes.map((s, j) => ({ id: `k${j}`, pts: s.map(([x, y]) => [x, y]) }))
    const r = readSketch('p', ink, ink[ink.length - 1].id, net, charNet)
    n++
    if (r.kind === 'symbol' && r.pick.cls === cls) ok++
    else { const key = `${cls}→${r.kind === 'symbol' ? r.pick.cls : label(r)}`; bad[key] = (bad[key] ?? 0) + 1 }
  }
  report('single symbol read right', ok, n, bad)
  const dom = Object.entries(bad).filter(([k]) => /→(mechanics|optics)$/.test(k)).reduce((a, [, v]) => a + v, 0)
  console.log(`   of the misses, sent to mechanics/optics: ${dom}`)
}

// 2. circuits, with and without handwritten labels — must stay circuits
for (const text of [false, true]) {
  let ok = 0, n = 0; const bad = {}
  for (let i = 0; i < layouts.length; i++) for (const dev of devs) {
    const rng = makeRng(500 + i)
    const sc = drawScene(layouts[i], rng.fork('s'), makeWriter(rng.fork('w'), `dm-${i}-${dev}`, dev), undefined, undefined, { text })
    const ink = sc.strokes.map((pts, k) => ({ id: `k${k}`, pts }))
    const r = readSketch('p', ink, ink[ink.length - 1].id, net, charNet)
    n++
    if (r.kind === 'circuit') ok++; else bad[label(r)] = (bad[label(r)] ?? 0) + 1
  }
  report(`circuit ${text ? 'with' : 'without'} labels → circuit`, ok, n, bad)
}

// 3. mechanics benches → mechanics (pulley → unsupported failure)
{
  let ok = 0, n = 0; const bad = {}
  for (let i = 0; i < MECH_SITUATIONS.length; i++) for (let k = 0; k < (quick ? 2 : 4); k++) {
    const sc = makeMechScene(i, 10 + k, devs[k % 4])
    const ink = sc.strokes.map((pts, j) => ({ id: `k${j}`, pts: pts.map(([x, y]) => [x, y]) }))
    const r = readSketch('p', ink, ink[ink.length - 1].id, net, charNet)
    const pulley = MECH_SITUATIONS[i].id === 'atwood-pulley'
    n++
    if (pulley ? label(r) === 'fail:unsupported' : label(r) === 'mechanics') ok++
    else { const key = `${MECH_SITUATIONS[i].id}→${label(r)}`; bad[key] = (bad[key] ?? 0) + 1 }
  }
  report('mechanics bench → mechanics', ok, n, bad)
}

// 4. optics benches that contain a lens → optics
{
  let ok = 0, n = 0; const bad = {}
  for (let i = 0; i < OPTICS_SITUATIONS.length; i++) for (let k = 0; k < (quick ? 2 : 4); k++) {
    const sc = makeOpticsScene(i, 10 + k, devs[k % 4])
    if (!sc.truth.ir.nodes.some((x) => x.cls === 'thin-lens')) continue
    const ink = sc.strokes.map((pts, j) => ({ id: `k${j}`, pts: pts.map(([x, y]) => [x, y]) }))
    const r = readSketch('p', ink, ink[ink.length - 1].id, net, charNet)
    n++
    if (label(r) === 'optics') ok++
    else { const key = `${OPTICS_SITUATIONS[i].id}→${label(r)}`; bad[key] = (bad[key] ?? 0) + 1 }
  }
  report('optics bench with lens → optics', ok, n, bad)
}
