// Why handwritten values are misread (SYNTHETIC scenes with labels drawn).
//   node --experimental-strip-types --import ./scripts/test/register.mjs scripts/ai/sketch/diag-values.mjs --n 80
// For each label that was drawn: was it found as text, and what did it read as?
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSketchNet } from '../../../lib/sketch/sketchnet.ts'
import { extractCircuit } from '../../../lib/sketch/extract.ts'
import { drawScene } from '../../../lib/sketch/scene-synth.ts'
import { makeRng } from '../../../lib/sketch/rng.ts'
import { makeWriter } from '../../../lib/sketch/synth.ts'
import { mainParamOf } from '../../../lib/sketch/compile.ts'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const N = Number(arg('n', 80))
const load = (name) => { const b = readFileSync(resolve(`public/models/${name}.bin`)); return createSketchNet(JSON.parse(readFileSync(resolve(`public/models/${name}.json`), 'utf8')), b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }
const net = load('sketchnet-v1')
const charNet = load('inkchars-v1')
const { layouts } = JSON.parse(readFileSync(resolve('lib/sketch/golden/scene-layouts.json'), 'utf8'))
const rng = makeRng(7)
const tally = { labels: 0, found: 0, exact: 0, lenDiff: 0, subst: 0, unknown: 0, notFound: 0, wrongPart: 0, unitOnly: 0 }
const confusions = {}
const samples = []
const where = {}
const dropTally = {}
for (let i = 0; i < N; i++) {
  const layout = layouts[rng.int(0, layouts.length - 1)]
  const w = makeWriter(rng.fork(`w${i}`), `diag-w${i}`)
  const scene = drawScene(layout, rng.fork(`s${i}`), w, undefined, undefined, { text: true })
  const ink = scene.strokes.map((pts, k) => ({ id: `k${k}`, pts }))
  globalThis.__drops = []
  const got = extractCircuit(ink, net, { charNet })
  // the strokes that carry each part's label
  const byOwner = new Map()
  scene.roles.forEach((r, k) => { if (r.role === 'text') byOwner.set(r.owner, [...(byOwner.get(r.owner) ?? []), `k${k}`]) })
  for (const n of layout.ir.nodes) {
    const key = mainParamOf(n.cls)
    const want = key ? n.values?.[key] : undefined
    if (!want) continue
    const ids = byOwner.get(n.id) ?? []
    if (!ids.length) continue
    tally.labels++
    const drops = (globalThis.__drops ?? []).filter((d) => d.ids.some((x) => ids.includes(x)))
    for (const d of drops) dropTally[d.reason] = (dropTally[d.reason] ?? 0) + 1
    const hits = (got.texts ?? []).filter((t) => t.strokeIds.some((s) => ids.includes(s)))
    if (!hits.length) { tally.notFound++; samples.push(`${want}  → (not found as text)`); continue }
    tally.found++
    const read = hits.map((h) => h.text).join('|')
    const wantU = want.replace(/[ΩVAFH]$/, '')
    const readU = read.replace(/[ΩVAFH]$/, '')
    if (readU === wantU) { tally.exact++; continue }
    // where did the label's strokes end up?
    const textIds = new Set((got.texts ?? []).flatMap((t) => t.strokeIds))
    for (const id of ids) {
      const loc = textIds.has(id) ? 'text' : got.parts.some((p) => p.strokeIds.includes(id)) ? 'PART' : got.wireIds.includes(id) ? 'WIRE' : got.dotIds.includes(id) ? 'DOT' : got.ignoredIds.includes(id) ? 'ignored' : 'other'
      where[loc] = (where[loc] ?? 0) + 1
    }
    if (read.includes('?')) tally.unknown++
    if (hits.length > 1) tally.wrongPart++
    else if (readU.length !== wantU.length) tally.lenDiff++
    else tally.subst++
    if (readU.length === wantU.length) for (let c = 0; c < wantU.length; c++) if (readU[c] !== wantU[c]) { const k2 = `${wantU[c]}→${readU[c]}`; confusions[k2] = (confusions[k2] ?? 0) + 1 }
    samples.push(`${want}  → ${read}`)
  }
}
console.log('SYNTHETIC labels', JSON.stringify(tally))
console.log('where strokes of misread labels went', JSON.stringify(where))
console.log('label lines dropped, by reason', JSON.stringify(dropTally))
console.log('char confusions', JSON.stringify(Object.entries(confusions).sort((a, b) => b[1] - a[1]).slice(0, 14)))
console.log('samples', samples.slice(0, 30).join('  ;  '))
