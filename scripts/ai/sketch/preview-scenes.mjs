// Contact sheet of synthetic whole-circuit sketches, to LOOK at.
//   npm run sketch:preview-scenes -- --layouts data/sketch/scenes/layouts-s1.json --n 12
// Blue = symbol ink, black = wires, red = junction dots.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeRng } from '../../../lib/sketch/rng.ts'
import { makeWriter } from '../../../lib/sketch/synth.ts'
import { drawScene } from '../../../lib/sketch/scene-synth.ts'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const file = resolve(arg('layouts', 'data/sketch/scenes/layouts-s1.json'))
const n = Number(arg('n', 12))
const { layouts } = JSON.parse(readFileSync(file, 'utf8'))
const rng = makeRng(Number(arg('seed', 5)))
const COLOR = { symbol: '#2563eb', wire: '#111', dot: '#dc2626' }
const cells = []
for (let i = 0; i < n; i++) {
  const layout = layouts[rng.int(0, layouts.length - 1)]
  const w = makeWriter(rng.fork(`w${i}`), `w${i}`)
  const scene = drawScene(layout, rng.fork(`s${i}`), w)
  const all = scene.strokes.flat()
  const x0 = Math.min(...all.map((p) => p[0])) - 10, y0 = Math.min(...all.map((p) => p[1])) - 10
  const W = Math.max(...all.map((p) => p[0])) - x0 + 10, H = Math.max(...all.map((p) => p[1])) - y0 + 10
  const k = Math.min(380 / W, 260 / H)
  const paths = scene.strokes.map((s, j) => `<polyline fill="none" stroke="${COLOR[scene.roles[j].role]}" stroke-width="1.3" stroke-linejoin="round" points="${s.map(([x, y]) => `${((x - x0) * k).toFixed(1)},${((y - y0) * k).toFixed(1)}`).join(' ')}"/>`).join('')
  const parts = scene.truth.nodes.map((nd) => nd.cls + (nd.values ? '(' + Object.values(nd.values).join(',') + ')' : '')).join(' · ')
  cells.push(`<div style="width:400px"><svg width="400" height="${Math.ceil(H * k) + 8}" style="border:1px solid #ddd">${paths}</svg><div style="font:11px sans-serif;color:#555">${scene.id} ${scene.device} — ${parts}</div></div>`)
}
const out = resolve('data/sketch/scenes-preview.html')
writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Synthetic circuit sketches</title><h3 style="font:14px sans-serif">SYNTHETIC whole-circuit sketches (generated hands). blue = parts, black = wires, red = dots</h3><div style="display:flex;flex-wrap:wrap;gap:12px">${cells.join('')}</div>`)
console.log('wrote', out)
