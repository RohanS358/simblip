// Show how the extractor read each synthetic scene: ink coloured by what it
// became (one colour per recognised part, black = wire, red = dot, grey = ignored),
// with the guessed class over each part and the true class in green.
//
//   npm run sketch:debug-scenes -- --n 10 --only-fails
//
// Writes data/sketch/scenes-debug.html. Uses the same draws as eval-scenes.mjs
// (same --seed), so scene numbers line up.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSketchNet } from '../../../lib/sketch/sketchnet.ts'
import { extractCircuit } from '../../../lib/sketch/extract.ts'
import { compareIR } from '../../../lib/sketch/compare-ir.ts'
import { drawScene } from '../../../lib/sketch/scene-synth.ts'
import { makeRng } from '../../../lib/sketch/rng.ts'
import { makeWriter } from '../../../lib/sketch/synth.ts'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const file = resolve(arg('layouts', 'data/sketch/scenes/layouts-s1.json'))
const want = Number(arg('n', 10))
const seed = Number(arg('seed', 7))
const scan = Number(arg('scan', 150))
const onlyFails = process.argv.includes('--only-fails')
const skip = Number(arg('skip', 0))
const without = arg('without', '')
const withText = process.argv.includes('--text')
const modelBase = resolve(arg('model', 'public/models/sketchnet-v1'))

const manifest = JSON.parse(readFileSync(`${modelBase}.json`, 'utf8'))
const bin = readFileSync(`${modelBase}.bin`)
const net = createSketchNet(manifest, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength))
const { layouts } = JSON.parse(readFileSync(file, 'utf8'))
let charNet
if (withText) {
  const cm = JSON.parse(readFileSync(resolve('public/models/inkchars-v1.json'), 'utf8'))
  const cb = readFileSync(resolve('public/models/inkchars-v1.bin'))
  charNet = createSketchNet(cm, cb.buffer.slice(cb.byteOffset, cb.byteOffset + cb.byteLength))
}
const rng = makeRng(seed)
const PAL = ['#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c']
const cells = []
let shown = 0, failsSeen = 0

for (let i = 0; i < scan && shown < want; i++) {
  const layout = layouts[rng.int(0, layouts.length - 1)]
  const w = makeWriter(rng.fork(`w${i}`), `eval-w${i}`)
  const scene = drawScene(layout, rng.fork(`s${i}`), w, undefined, undefined, { text: withText })
  const ink = scene.strokes.map((pts, k) => ({ id: `k${k}`, pts }))
  const got = extractCircuit(ink, net, { charNet })
  const c = compareIR(got.ir, scene.truth)
  if (onlyFails && c.exact) continue
  if (process.argv.includes('--parts-only') && !(c.missed || c.extra)) continue
  if (process.argv.includes('--nets-only') && !(c.missed === 0 && c.extra === 0 && c.classCorrect === c.matched)) continue
  if (without && scene.truth.nodes.some((n) => n.cls === without)) continue
  if (failsSeen++ < skip) continue
  const colorOf = new Map()
  ;(got.texts ?? []).forEach((t) => t.strokeIds.forEach((id) => colorOf.set(id, '#dc2626')))
  got.parts.forEach((p, k) => p.strokeIds.forEach((id) => colorOf.set(id, PAL[k % PAL.length])))
  const all = scene.strokes.flat()
  const x0 = Math.min(...all.map((p) => p[0])) - 14, y0 = Math.min(...all.map((p) => p[1])) - 14
  const W = Math.max(...all.map((p) => p[0])) - x0 + 14, H = Math.max(...all.map((p) => p[1])) - y0 + 14
  const k = Math.min(520 / W, 420 / H)
  const X = (x) => ((x - x0) * k).toFixed(1), Y = (y) => ((y - y0) * k).toFixed(1)
  const lines = ink.map((s) => {
    const col = colorOf.get(s.id) ?? (got.wireIds.includes(s.id) ? '#111' : got.dotIds.includes(s.id) ? '#dc2626' : '#aaa')
    const dash = got.ignoredIds.includes(s.id) ? ' stroke-dasharray="3 2"' : ''
    return `<polyline fill="none" stroke="${col}" stroke-width="1.4"${dash} points="${s.pts.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ')}"/>`
  }).join('')
  const labels = got.parts.map((p) => `<text x="${X((p.box.x0 + p.box.x1) / 2)}" y="${Y(p.box.y0) - 3}" font-size="11" fill="#444" text-anchor="middle">${p.cls} ${Math.round(p.conf * 100)}</text>`).join('') +
    scene.truth.nodes.map((n) => `<text x="${X(n.bbox[0] + n.bbox[2] / 2)}" y="${Y(n.bbox[1] + n.bbox[3]) + 11}" font-size="10" fill="#16a34a" text-anchor="middle">${n.cls}</text>`).join('')
  cells.push(`<div style="width:540px"><svg width="540" height="${Math.ceil(H * k) + 20}" style="border:1px solid #ddd">${lines}${labels}</svg><div style="font:11px sans-serif;color:#444">${scene.id} ${scene.device} unit=${got.unit.toFixed(0)} — ${c.exact ? 'EXACT' : `parts ${c.matched}/${c.truthNodes} class ${c.classCorrect}/${c.matched} nets -${c.netsMissing}/+${c.netsExtra}`}; wires=${got.wireIds.length} dots=${got.dotIds.length} ignored=${got.ignoredIds.length}</div></div>`)
  shown++
}
const out = resolve('data/sketch/scenes-debug.html')
writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Extractor debug</title><h3 style="font:14px sans-serif">SYNTHETIC scenes read by the extractor — colour = recognised part; black = wire; red = dot; grey dashed = ignored; green label = truth</h3><div style="display:flex;flex-wrap:wrap;gap:12px">${cells.join('')}</div>`)
console.log('wrote', out, shown, 'scenes')
