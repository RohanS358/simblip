// Does stroke → character grouping recover the characters that were written? (SYNTHETIC; the pool is the
// true text strokes, so only grouping is measured.)
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSketchNet } from '../../../lib/sketch/sketchnet.ts'
import { extractCircuit, shapeOf } from '../../../lib/sketch/extract.ts'
import { charClusters } from '../../../lib/sketch/values.ts'
import { drawScene } from '../../../lib/sketch/scene-synth.ts'
import { makeRng } from '../../../lib/sketch/rng.ts'
import { makeWriter } from '../../../lib/sketch/synth.ts'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const N = Number(arg('n', 100))
const load = (name) => { const b = readFileSync(resolve(`public/models/${name}.bin`)); return createSketchNet(JSON.parse(readFileSync(resolve(`public/models/${name}.json`), 'utf8')), b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }
const net = load('sketchnet-v1')
const chars = load('inkchars-v1')
const { layouts } = JSON.parse(readFileSync(resolve('lib/sketch/golden/scene-layouts.json'), 'utf8'))
const rng = makeRng(7)
const t = { chars: 0, perfect: 0, merged: 0, split: 0, dotsOk: 0, dots: 0 }
const bad = {}
for (let i = 0; i < N; i++) {
  const layout = layouts[rng.int(0, layouts.length - 1)]
  const w = makeWriter(rng.fork(`w${i}`), `dg-w${i}`)
  const sc = drawScene(layout, rng.fork(`s${i}`), w, undefined, undefined, { text: true })
  const ink = sc.strokes.map((pts, k) => ({ id: `k${k}`, pts }))
  const U = extractCircuit(ink, net, { charNet: chars }).unit
  const pool = ink.map((s, k) => ({ s, k })).filter(({ k }) => sc.chars[k]).map(({ s }) => shapeOf(s))
  const cl = charClusters(pool, chars, U)
  const clusterOf = new Map()
  cl.forEach((c, ci) => c.shapes.forEach((s) => clusterOf.set(s.id, ci)))
  const tags = new Map()
  sc.chars.forEach((c, k) => { if (c) tags.set(c, [...(tags.get(c) ?? []), `k${k}`]) })
  for (const [tag, ids] of tags) {
    const ch = tag.split(':')[1]
    const cis = new Set(ids.map((id) => clusterOf.get(id)))
    const c0 = [...cis][0]
    const members = new Set(cl[c0].shapes.map((s) => s.id))
    const exact = cis.size === 1 && members.size === ids.length
    if (ch === '.') { t.dots++; if (exact) t.dotsOk++; continue }
    t.chars++
    if (exact) t.perfect++
    else if (cis.size > 1) {
      t.split++; bad[`split ${ch}`] = (bad[`split ${ch}`] ?? 0) + 1
      if (process.argv.includes('--show') && t.split <= 8) {
        const box = (id) => { const sh = pool.find((x) => x.id === id); return sh.box }
        const whole = chars.predict(ids.map((id) => pool.find((x) => x.id === id).pts))
        console.log('SPLIT', tag, 'strokes', ids.map((id) => { const b = box(id); return `[${b.x0.toFixed(0)},${b.y0.toFixed(0)} ${(b.x1 - b.x0).toFixed(0)}x${(b.y1 - b.y0).toFixed(0)}]` }).join(' '), 'whole→', whole.cls, whole.conf.toFixed(2), 'clusters', [...cis].map((ci) => cl[ci].shapes.length + 'st').join(','), 'U', U.toFixed(0))
      }
    }
    else {
      t.merged++; bad[`merged ${ch}`] = (bad[`merged ${ch}`] ?? 0) + 1
      if (process.argv.includes('--show') && t.merged <= 8) {
        const mem = cl[c0].shapes.map((x) => { const tg = sc.chars[Number(x.id.slice(1))]; return `${tg.split('#')[1]}[${(x.box.x1 - x.box.x0).toFixed(0)}x${(x.box.y1 - x.box.y0).toFixed(0)}]` }).join(' ')
        const pr = chars.predict(cl[c0].shapes.map((x) => x.pts))
        console.log('MERGED', tag, 'cluster has', mem, 'named', pr.cls, pr.conf.toFixed(2))
      }
    }
  }
}
console.log('SYNTHETIC character grouping', JSON.stringify(t))
console.log('worst', JSON.stringify(Object.entries(bad).sort((a, b) => b[1] - a[1]).slice(0, 14)))
