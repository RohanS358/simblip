// Writes one generated hand-drawn circuit (strokes in page px) to a JSON file, for replaying
// into the real app to test draw → recognise → build → simulate.
//   node scripts/ai/sketch/dump-scene.mjs <layoutIndex> <outFile>
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { drawScene } from '../../../lib/sketch/scene-synth.ts'
import { makeRng } from '../../../lib/sketch/rng.ts'
import { makeWriter } from '../../../lib/sketch/synth.ts'

const i = Number(process.argv[2] ?? 0)
const out = resolve(process.argv[3] ?? 'scene-strokes.json')
const { layouts } = JSON.parse(readFileSync(resolve('lib/sketch/golden/scene-layouts.json'), 'utf8'))
const rng = makeRng(100 + i)
const scene = drawScene(layouts[i], rng.fork('s'), makeWriter(rng.fork('w'), `dump-${i}`, 'mouse'))
writeFileSync(out, JSON.stringify({ strokes: scene.strokes, nodes: scene.truth.nodes.map((n) => n.cls) }))
console.log(scene.strokes.length, 'strokes', scene.truth.nodes.map((n) => n.cls).join(','))
