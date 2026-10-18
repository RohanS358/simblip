// Writes one generated optics sketch (page px) to a JSON file, to replay into the real app.
//   node --experimental-strip-types --import ./scripts/test/register.mjs scripts/ai/sketch/dump-optics.mjs <situation-id> <seed> <device> <outFile>
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeOpticsScene, OPTICS_SITUATIONS } from '../../../lib/sketch/optics-synth.ts'

const [id, seed = '10', device = 'mouse', out = 'optics-strokes.json'] = process.argv.slice(2)
const i = OPTICS_SITUATIONS.findIndex((s) => s.id === id)
if (i < 0) throw new Error(`unknown situation "${id}": ${OPTICS_SITUATIONS.map((s) => s.id).join(', ')}`)
const scene = makeOpticsScene(i, Number(seed), device)
writeFileSync(resolve(out), JSON.stringify({ strokes: scene.strokes, expect: scene.expect, title: scene.title }))
console.log(scene.title, scene.strokes.length, 'strokes')
