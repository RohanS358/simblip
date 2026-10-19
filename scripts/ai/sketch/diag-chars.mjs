// How well does the character network read characters AS THEY APPEAR IN A SCENE, given perfect grouping?
// (SYNTHETIC.)  If this is high, the losses are in grouping/lines; if low, the network needs more variety.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSketchNet } from '../../../lib/sketch/sketchnet.ts'
import { drawScene } from '../../../lib/sketch/scene-synth.ts'
import { makeRng } from '../../../lib/sketch/rng.ts'
import { makeWriter } from '../../../lib/sketch/synth.ts'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const N = Number(arg('n', 120))
const b = readFileSync(resolve('public/models/inkchars-v1.bin'))
const chars = createSketchNet(JSON.parse(readFileSync(resolve('public/models/inkchars-v1.json'), 'utf8')), b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
const { layouts } = JSON.parse(readFileSync(resolve('lib/sketch/golden/scene-layouts.json'), 'utf8'))
const rng = makeRng(7)
let n = 0, ok = 0, unknown = 0
const byChar = {}
const conf = {}
for (let i = 0; i < N; i++) {
  const layout = layouts[rng.int(0, layouts.length - 1)]
  const w = makeWriter(rng.fork(`w${i}`), `dc-w${i}`)
  const sc = drawScene(layout, rng.fork(`s${i}`), w, undefined, undefined, { text: true })
  const groups = new Map()
  sc.chars.forEach((c, k) => { if (c) groups.set(c, [...(groups.get(c) ?? []), sc.strokes[k]]) })
  for (const [tag, strokes] of groups) {
    const ch = tag.split(':')[1]
    if (ch === '.') continue
    const p = chars.predict(strokes.map((s) => s.map(([x, y]) => [x, y])))
    n++
    byChar[ch] ??= { n: 0, ok: 0 }
    byChar[ch].n++
    if (p.cls === ch) { ok++; byChar[ch].ok++ }
    else { if (p.cls === 'unknown') unknown++; const k = `${ch}→${p.cls}`; conf[k] = (conf[k] ?? 0) + 1 }
  }
}
console.log(`SYNTHETIC in-scene characters, perfectly grouped: ${ok}/${n} = ${((100 * ok) / n).toFixed(1)}%  (read as unknown: ${unknown})`)
console.log('per char', Object.entries(byChar).map(([c, v]) => `${c}:${v.ok}/${v.n}`).join(' '))
console.log('confusions', JSON.stringify(Object.entries(conf).sort((a, b) => b[1] - a[1]).slice(0, 16)))
