// Writes one generated mechanics sketch (page px) to a JSON file, to replay into the real app.
//   node --experimental-strip-types --import ./scripts/test/register.mjs scripts/ai/sketch/dump-mech.mjs <situation-id> <seed> <device> <outFile>
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeMechScene, MECH_SITUATIONS } from '../../../lib/sketch/mech-synth.ts'

const [id, seed = '10', device = 'mouse', out = 'mech-strokes.json'] = process.argv.slice(2)
const i = MECH_SITUATIONS.findIndex((s) => s.id === id)
if (i < 0) throw new Error(`unknown situation "${id}": ${MECH_SITUATIONS.map((s) => s.id).join(', ')}`)
const scene = makeMechScene(i, Number(seed), device)
writeFileSync(resolve(out), JSON.stringify({ strokes: scene.strokes, expect: scene.expect, title: scene.title }))
console.log(scene.title, scene.strokes.length, 'strokes')
