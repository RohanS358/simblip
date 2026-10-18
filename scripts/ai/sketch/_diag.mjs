import { readFileSync } from 'node:fs'
import { drawScene } from '../../../lib/sketch/scene-synth.ts'
import { makeRng } from '../../../lib/sketch/rng.ts'
import { makeWriter } from '../../../lib/sketch/synth.ts'
import { boxOf, diagOf, pathLength, rdp, dist } from '../../../lib/sketch/geom.ts'
import { shapeOf } from '../../../lib/sketch/extract.ts'
const { layouts } = JSON.parse(readFileSync('data/sketch/scenes/layouts-s1.json', 'utf8'))
const rng = makeRng(7)
const wantId = process.argv[2]
for (let i = 0; i < 150; i++) {
  const layout = layouts[rng.int(0, layouts.length - 1)]
  const w = makeWriter(rng.fork(`w${i}`), `eval-w${i}`)
  const scene = drawScene(layout, rng.fork(`s${i}`), w)
  if (scene.id !== wantId) continue
  console.log(scene.id, scene.device, 'writer rounding', w.rounding.toFixed(2), 'wobble', w.wobble.toFixed(1), 'size', w.size.toFixed(0))
  scene.strokes.forEach((s, k) => {
    const sh = shapeOf({ id: 'x', pts: s })
    console.log(String(k).padStart(2), scene.roles[k].role.padEnd(6), scene.roles[k].owner.padEnd(5), 'len', sh.len.toFixed(0).padStart(4), 'diag', sh.diag.toFixed(0).padStart(4), 'chord/len', (sh.chord / sh.len).toFixed(2), 'simp', sh.simp.length, sh.straight ? 'STRAIGHT' : '', sh.ortho ? 'ORTHO' : '', sh.closed ? 'CLOSED' : '')
  })
}
