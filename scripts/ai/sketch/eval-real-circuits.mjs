// REAL hand-drawn circuits (the strokes of a real person, exported from the app), read two ways:
//   ink   — as drawn on the canvas;
//   image — the same strokes rendered to a picture (a scan of a hand-drawn page) and read by the photo path.
// The data stays on this machine (data/sketch/real-local/, git-ignored). Labels are the assistant's reading of
// the drawings, not the author's: treat the numbers as a smoke test of REAL handwriting, not a benchmark.
//   node --experimental-strip-types --import ./scripts/test/register.mjs scripts/ai/sketch/eval-real-circuits.mjs [--models <dir>]
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSketchNet } from '../../../lib/sketch/sketchnet.ts'
import { readSketch } from '../../../lib/sketch/read-sketch.ts'
import { readPhoto } from '../../../lib/sketch/photo/index.ts'
import { renderPhoto } from '../../../lib/sketch/photo/synth-photo.ts'
import { makeRng } from '../../../lib/sketch/rng.ts'
import { diagnoseCircuit } from '../../../lib/sketch/diagnose.ts'
import { irOf } from '../../../lib/sketch/circuit-ghost.ts'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const dir = resolve(arg('data', 'data/sketch/real-local'))
if (!existsSync(dir + '/user-ink.json')) { console.log('no real circuits in', dir, '(nothing to evaluate)'); process.exit(0) }
const models = resolve(arg('models', 'public/models'))
const load = (base, n) => { const b = readFileSync(`${base}/${n}.bin`); return createSketchNet(JSON.parse(readFileSync(`${base}/${n}.json`, 'utf8')), b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }
const net = load(models, 'sketchnet-v1'), charNet = load(resolve('public/models'), 'inkchars-v1')
const raw = JSON.parse(readFileSync(dir + '/user-ink.json', 'utf8'))
const { circuits } = JSON.parse(readFileSync(dir + '/labels.json', 'utf8'))
let partsWant = 0, partsRight = 0, loops = 0
for (const c of circuits) {
  const strokes = raw.slice(c.strokes[0], c.strokes[1] + 1).map((s) => ({ id: s.id, pts: s.pts }))
  const seed = strokes[strokes.length - 1].id
  const describe = (r) => r.kind === 'circuit' ? { parts: r.ghost.result.parts.map((p) => p.cls), edges: r.ghost.result.ir.edges.length, loose: r.ghost.result.looseEnds?.length ?? 0, found: diagnoseCircuit(irOf(r.ghost)).map((f) => f.kind) } : { kind: r.kind === 'fail' ? 'fail:' + r.failure.reason : r.kind }
  const ink = readSketch('p', strokes, seed, net, charNet)
  // the same strokes as a picture: line width like a pen on a screen, light blur and shading
  const img = renderPhoto(strokes.map((s) => s.pts), makeRng(5), { width: 3, blur: 1, shade: 0.1, noise: 3, margin: 60 })
  const ph = readPhoto(img, net, charNet)
  const di = describe(ink), dp = 'error' in ph ? { kind: 'refused: ' + ph.error.slice(0, 50) } : describe(ph.result)
  const score = (d) => { const want = [...c.parts]; let r = 0; for (const p of d.parts ?? []) { const k = want.indexOf(p); if (k >= 0) { want.splice(k, 1); r++ } } return r }
  console.log(`${c.name} want ${c.parts.join(',')}`)
  console.log(`   ink   : ${d2s(di)}   right ${score(di)}/${c.parts.length}`)
  console.log(`   image : ${d2s(dp)}   right ${score(dp)}/${c.parts.length}`)
  partsWant += 2 * c.parts.length; partsRight += score(di) + score(dp)
}
function d2s(d) { return d.parts ? `${d.parts.join(',')} | edges ${d.edges} loose ${d.loose} | check: ${d.found.join(',') || 'nothing wrong found'}` : d.kind }
console.log(`REAL hand-drawn (3 circuits x ink+image): expected parts found ${partsRight}/${partsWant}   [labels by the assistant]`)
