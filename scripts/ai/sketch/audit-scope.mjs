// Which ink one Done reads: a label drawn LAST joins its circuit; two separate symbols stay separate. SYNTHETIC hands (not real-world validation).
//   node --experimental-strip-types --import ./scripts/test/register.mjs scripts/ai/sketch/audit-scope.mjs
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

// 5. a label drawn LAST (after the whole circuit), seed = that last stroke → still the whole circuit
{
  let ok = 0, n = 0; const bad = {}
  for (let i = 0; i < layouts.length; i++) for (const dev of devs) {
    const rng = makeRng(500 + i)
    const sc = drawScene(layouts[i], rng.fork('s'), makeWriter(rng.fork('w'), `dm-${i}-${dev}`, dev), undefined, undefined, { text: true })
    const idx = sc.strokes.map((_, k) => k)
    const isText = (k) => sc.roles[k].role === 'text'
    if (!idx.some(isText)) continue
    const order = [...idx.filter((k) => !isText(k)), ...idx.filter(isText)]
    const ink = order.map((k, j) => ({ id: `k${j}`, pts: sc.strokes[k] }))
    const r = readSketch('p', ink, ink[ink.length - 1].id, net, charNet)
    n++
    if (r.kind === 'circuit' && r.ghost.result.parts.length >= Math.max(2, layouts[i].ir.nodes.length - 1)) ok++
    else bad[label(r)] = (bad[label(r)] ?? 0) + 1
  }
  report('label drawn last → whole circuit', ok, n, bad)
}

// 6. two separate single symbols 150–300 px apart: each is still its own symbol (labels logic must not merge them)
{
  let ok = 0, n = 0; const bad = {}
  for (const gap of [150, 220, 300]) for (const [a, b] of [['resistor', 'capacitor'], ['diode', 'battery'], ['led', 'inductor'], ['and-gate', 'gnd']]) for (const dev of ['mouse', 'finger']) {
    const rng = makeRng(77)
    const da = drawSymbol(rng.fork('a'), makeWriter(rng.fork('wa'), `ta-${a}-${dev}`, dev), a)
    const db = drawSymbol(rng.fork('b'), makeWriter(rng.fork('wb'), `tb-${b}-${dev}`, dev), b)
    const ax1 = Math.max(...da.strokes.flat().map((p) => p[0])), bx0 = Math.min(...db.strokes.flat().map((p) => p[0]))
    const shifted = db.strokes.map((s) => s.map(([x, y]) => [x + (ax1 - bx0) + gap, y]))
    const ink = [...da.strokes, ...shifted].map((pts, k) => ({ id: `k${k}`, pts: pts.map(([x, y]) => [x, y]) }))
    const r = readSketch('p', ink, ink[ink.length - 1].id, net, charNet)
    n++
    if (r.kind === 'symbol' && r.pick.cls === b) ok++
    else bad[`${b}→${r.kind === 'symbol' ? r.pick.cls : label(r)}`] = (bad[`${b}→${r.kind === 'symbol' ? r.pick.cls : label(r)}`] ?? 0) + 1
  }
  report('two symbols apart → seed symbol read', ok, n, bad)
}
