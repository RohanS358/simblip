// AUDIT: the user's basic scenario — draw ONE symbol, press Done — through the real readSketch(). SYNTHETIC hands.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSketchNet } from '../../../lib/sketch/sketchnet.ts'
import { readSketch } from '../../../lib/sketch/read-sketch.ts'
import { drawSymbol } from '../../../lib/sketch/synth.ts'
import { WAVE1_CLASSES } from '../../../lib/sketch/classes.ts'
import { makeRng } from '../../../lib/sketch/rng.ts'
import { makeWriter } from '../../../lib/sketch/synth.ts'
const load = (n) => { const b = readFileSync(resolve(`public/models/${n}.bin`)); return createSketchNet(JSON.parse(readFileSync(resolve(`public/models/${n}.json`), 'utf8')), b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }
const net = load('sketchnet-v1'), charNet = load('inkchars-v1')
const per = {}
let n = 0, right = 0, wrongDomain = 0, failed = 0
const bad = {}
for (const cls of WAVE1_CLASSES) for (const dev of ['mouse', 'touchpad', 'finger', 'pen']) for (let k = 0; k < 6; k++) {
  const rng = makeRng(k * 97 + 11)
  const w = makeWriter(rng.fork('w'), `sym-${cls}-${dev}-${k}`, dev)
  const d = drawSymbol(rng.fork('d'), w, cls)
  const ink = d.strokes.map((s, j) => ({ id: `k${j}`, pts: s.map(([x, y]) => [x, y]) }))
  const r = readSketch('p', ink, ink[ink.length - 1].id, net, charNet)
  n++
  per[cls] ??= { n: 0, ok: 0 }
  per[cls].n++
  if (r.kind === 'symbol' && r.pick.cls === cls) { right++; per[cls].ok++ }
  else if (r.kind === 'mechanics') { wrongDomain++; bad[`${cls}→${r.ghost.domain}`] = (bad[`${cls}→${r.ghost.domain}`] ?? 0) + 1 }
  else if (r.kind === 'fail') { failed++; bad[`${cls}→fail:${r.failure.reason}`] = (bad[`${cls}→fail:${r.failure.reason}`] ?? 0) + 1 }
  else { const key = r.kind === 'symbol' ? `${cls}→symbol:${r.pick.cls}` : `${cls}→${r.kind}`; bad[key] = (bad[key] ?? 0) + 1 }
}
console.log(`single symbol, drawn with leads, read through readSketch: right ${right}/${n} (${(100 * right / n).toFixed(1)}%), wrong domain ${wrongDomain}, failed/declined ${failed}`)
console.log('per class', Object.entries(per).map(([c, v]) => `${c}:${v.ok}/${v.n}`).join(' '))
console.log('misses', JSON.stringify(Object.entries(bad).sort((a, b) => b[1] - a[1]).slice(0, 18)))
