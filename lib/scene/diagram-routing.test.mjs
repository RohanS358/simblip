// Connector cleanliness: every flowchart in the course library, PLACED THE WAY THE APP
// PLACES IT (translated and possibly scaled into a viewport), must keep clean links:
// axis-aligned, attached to their boxes, and never cutting through a box they do not touch.
// Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { bundle } from '../../scripts/test/bundle.mjs'

const m = await bundle(`export { useDocStore } from '@/lib/store/document'\nexport { executeSimScript } from '@/lib/scene/simscript'`, 'diagram-routing')

const scripts = []
for (const c of readdirSync('content/courses')) {
  for (const f of readdirSync(`content/courses/${c}`)) {
    if (f === 'course.json' || !f.endsWith('.json')) continue
    const d = JSON.parse(readFileSync(`content/courses/${c}/${f}`, 'utf8'))
    for (const s of d.sections ?? []) {
      for (const fig of [...(s.figures ?? []), ...(s.questions ?? []).map((q) => q.verify).filter(Boolean)]) {
        if (/\bdiagram\(/.test(fig.script)) scripts.push({ name: `${c}/${f}#${s.id}`, script: fig.script })
      }
    }
  }
}

const SURFACES = [
  { bounds: { left: 0, top: 0, right: 1400, bottom: 900 }, fixedFrame: false }, // roomy: translate only
  { bounds: { left: 0, top: 0, right: 700, bottom: 560 }, fixedFrame: false }, // tight: forces a scale-down
]

function problems(pageId) {
  const objs = Object.values(m.useDocStore.getState().pages[pageId].objects)
  const byId = new Map(objs.map((o) => [o.id, o]))
  const out = []
  const boxes = objs.filter((o) => o.metadata.render !== 'connector' && o.geometry.kind !== 'text' && o.size.w > 40 && o.size.h > 30)
  // A group frame encloses other boxes; a link running inside it is not crossing anything.
  const encloses = (a, b) => a !== b && b.position.x >= a.position.x - 1 && b.position.y >= a.position.y - 1 && b.position.x + b.size.w <= a.position.x + a.size.w + 1 && b.position.y + b.size.h <= a.position.y + a.size.h + 1
  const containers = new Set(boxes.filter((a) => boxes.some((b) => encloses(a, b))).map((a) => a.id))
  for (const c of objs.filter((o) => o.metadata.render === 'connector')) {
    const pts = [c.geometry.points[0], ...(c.metadata.bends ?? []), c.geometry.points[1]].map(([x, y]) => [c.position.x + x, c.position.y + y])
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i]
      if (Math.abs(x1 - x2) > 1 && Math.abs(y1 - y2) > 1) out.push(`${c.name}: slanted segment ${i}`)
    }
    const ends = [c.metadata.startAnchor?.objectId, c.metadata.endAnchor?.objectId]
    // a box the link does not start or end on must not be crossed (interior, with a 3px skin)
    for (const n of boxes.filter((o) => !ends.includes(o.id) && !containers.has(o.id))) {
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i - 1], [x2, y2] = pts[i]
        const lx = Math.min(x1, x2), hx = Math.max(x1, x2), ly = Math.min(y1, y2), hy = Math.max(y1, y2)
        const inside = hx > n.position.x + 3 && lx < n.position.x + n.size.w - 3 && hy > n.position.y + 3 && ly < n.position.y + n.size.h - 3
        if (inside) { out.push(`${c.name}: cuts through "${n.name.slice(0, 24)}"`); break }
      }
    }
    for (const [k, anchor] of [[0, c.metadata.startAnchor], [pts.length - 1, c.metadata.endAnchor]]) {
      const n = anchor && byId.get(anchor.objectId)
      if (!n) continue
      const [x, y] = pts[k]
      const near = x >= n.position.x - 4 && x <= n.position.x + n.size.w + 4 && y >= n.position.y - 4 && y <= n.position.y + n.size.h + 4
      if (!near) out.push(`${c.name}: end ${k === 0 ? 'start' : 'finish'} is detached from its box`)
    }
  }
  return out
}

test('the library has flowcharts to check', () => assert.ok(scripts.length >= 5, `only ${scripts.length}`))

for (const [si, surface] of SURFACES.entries()) {
  test(`every course flowchart keeps clean connectors when placed (${si === 0 ? 'translated' : 'scaled'})`, () => {
    const bad = []
    for (const [i, { name, script }] of scripts.entries()) {
      const page = `dr-${si}-${i}`
      m.useDocStore.getState().loadPage(page)
      m.executeSimScript(page, script, { x: 0, y: 0 }, surface)
      for (const p of problems(page)) bad.push(`${name} — ${p}`)
    }
    if (process.env.DUMP) console.log(bad.join("\n")); assert.deepEqual(bad.slice(0, 8), [], `${bad.length} connector problems across ${scripts.length} diagrams`)
  })
}
