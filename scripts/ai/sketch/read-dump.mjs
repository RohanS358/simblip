// Reads a dumped scene (dump-scene.mjs output) with the real reader and prints what the
// preview would say, optionally at other drawing sizes.
//   node --experimental-strip-types --import ./scripts/test/register.mjs scripts/ai/sketch/read-dump.mjs public/_s1.json 1 0.62 0.4
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSketchNet } from '../../../lib/sketch/sketchnet.ts'
import { startCircuitGhost, toCheck } from '../../../lib/sketch/circuit-ghost.ts'

const base = resolve('public/models/sketchnet-v1')
const net = createSketchNet(JSON.parse(readFileSync(`${base}.json`, 'utf8')), (() => { const b = readFileSync(`${base}.bin`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) })())
// the app also passes the handwriting-character network (values like "4.7k"); so does this
const cbase = resolve('public/models/inkchars-v1')
const charNet = createSketchNet(JSON.parse(readFileSync(`${cbase}.json`, 'utf8')), (() => { const b = readFileSync(`${cbase}.bin`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) })())
const { strokes } = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'))
const scales = process.argv.slice(3).map(Number)
for (const s of scales.length ? scales : [1]) {
  const ink = strokes.map((pts, i) => ({ id: `k${i}`, pts: pts.map(([x, y, ...r]) => [x * s, y * s + Number(process.env.DY ?? 0), ...r]) }))
  const g = startCircuitGhost('p', ink, net, process.env.NO_CHARNET ? undefined : charNet)
  console.log(`scale ${s}:`, g ? `${g.result.parts.map((p) => p.cls).join(',')}; ${g.result.ir.edges.length} connections; to check ${toCheck(g)}` : 'nothing read')
}
