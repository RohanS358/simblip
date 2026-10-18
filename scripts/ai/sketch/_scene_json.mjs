import { readFileSync, writeFileSync } from 'node:fs'
import { drawScene } from '../../../lib/sketch/scene-synth.ts'
import { makeRng } from '../../../lib/sketch/rng.ts'
import { makeWriter } from '../../../lib/sketch/synth.ts'
const { layouts } = JSON.parse(readFileSync('data/sketch/scenes/layouts-s1.json', 'utf8'))
const want = process.argv[2] ?? 'battery+led+resistor'
const rng = makeRng(31)
let pick = layouts.filter((l) => l.ir.nodes.map((n) => n.cls).sort().join('+') === want)
if (!pick.length) pick = layouts.filter((l) => l.ir.nodes.length === 3)
const layout = pick[0]
const w = makeWriter(makeRng(3), 'demo', 'mouse')
const scene = drawScene(layout, rng, w, 'demo', 1.3)
const all = scene.strokes.flat()
const x0 = Math.min(...all.map((p) => p[0])), y0 = Math.min(...all.map((p) => p[1]))
const W = Math.max(...all.map((p) => p[0])) - x0, H = Math.max(...all.map((p) => p[1])) - y0
const k = Math.min(520 / W, 380 / H, 1.2)
const out = scene.strokes.map((s) => s.map(([x, y]) => [Math.round(140 + (x - x0) * k), Math.round(170 + (y - y0) * k)]))
writeFileSync('public/_scene.json', JSON.stringify({ strokes: out, truth: scene.truth.nodes.map((n) => n.cls + (n.values ? JSON.stringify(n.values) : '')), edges: scene.truth.edges.length }))
console.log('strokes', out.length, 'parts', scene.truth.nodes.map((n) => n.cls).join(','), 'edges', scene.truth.edges.length)
