// Connector cleanliness: every flowchart in the course library, PLACED THE WAY THE APP
// PLACES IT (translated and possibly scaled into a viewport), must keep clean links:
// axis-aligned, attached to their boxes, and never cutting through a box they do not touch.
// Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { bundle } from '../../scripts/test/bundle.mjs'

const m = await bundle(`export { useDocStore } from '@/lib/store/document'\nexport { executeSimScript, shiftScene } from '@/lib/scene/simscript'`, 'diagram-routing')

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


// The label object is a padded transparent rect; what the eye sees is the text, so judge that.
const textRect = (o) => {
  const w = o.name.replace(/ label$/, '').length * 7.6 + 8, cx = o.position.x + o.size.w / 2, cy = o.position.y + o.size.h / 2
  return { x: cx - w / 2, x2: cx + w / 2, y: cy - 9, y2: cy + 9 }
}
const hitR = (a, b) => a.x < b.x2 - 1 && a.x2 > b.x + 1 && a.y < b.y2 - 1 && a.y2 > b.y + 1

// Diagrams as a model writes them for a generated lesson: hubs that fan out, side branches with labels.
const LESSON_DIAGRAMS = {
  devops: 'direction: right\n[Combines development and operations] as c #mint\n[DevOps] as d #blue\n[Faster software delivery] as f #amber\n[Uses automation] as a #violet\n[Improves collaboration] as i #rose\nc -> d : defines\nd -> f : goal\nd -> a : method\na -> i : outcome',
  cloud: 'direction: right\n[Cloud Native] as n #blue\n[Microservices] as m #mint\n[Containers] as c #amber\n[Scalable apps] as s #violet\n[Resilient apps] as r #rose\nn -> m : use\nn -> c : use\nn -> s : enable\nn -> r : enable',
  down: 'direction: down\n[Request] as q #blue\n[Load balancer] as l #mint\n[Server A] as a #amber\n[Server B] as b #amber\n[Database] as d #rose\nq -> l\nl -> a : route\nl -> b : route\na -> d\nb -> d',
}

test('a diagram laid into a lesson slide (moved after it was built) keeps its links clean and its labels on them', () => {
  const bad = []
  for (const [name, src] of Object.entries(LESSON_DIAGRAMS)) {
    const page = `lesson-${name}`
    m.useDocStore.getState().loadPage(page)
    m.executeSimScript(page, `diagram(${JSON.stringify(src)});`, { x: 0, y: 0 })
    const before = Object.values(m.useDocStore.getState().pages[page].objects)
    const shape = (o) => JSON.stringify([o.geometry.points, o.metadata.bends, o.size])
    const shapes = new Map(before.filter((o) => o.metadata.render === 'connector').map((o) => [o.id, shape(o)]))
    m.shiftScene(page, before.map((o) => o.id), 513, 287)
    const objs = Object.values(m.useDocStore.getState().pages[page].objects)
    for (const p of problems(page)) bad.push(`${name}: ${p}`)
    for (const c of objs.filter((o) => o.metadata.render === 'connector')) {
      if (shapes.get(c.id) !== shape(c)) bad.push(`${name}: "${c.name}" lost its routed shape when moved`)
      const labels = c.name.endsWith(' link') ? objs.filter((o) => o.name === c.name.replace(/ link$/, ' label')) : []
      if (!labels.length) continue
      const pts = [c.geometry.points[0], ...(c.metadata.bends ?? []), c.geometry.points[1]].map(([x, y]) => [c.position.x + x, c.position.y + y])
      // how far the label's text is from this arrow (0 when the line runs through or beside it)
      const dist = (label) => {
        const tr = textRect(label)
        let best = Infinity
        for (let i = 1; i < pts.length; i++) {
          const [x1, y1] = pts[i - 1], [x2, y2] = pts[i]
          const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 4))
          for (let k = 0; k <= steps; k++) {
            const px = x1 + ((x2 - x1) * k) / steps, py = y1 + ((y2 - y1) * k) / steps
            best = Math.min(best, Math.hypot(Math.max(tr.x - px, 0, px - tr.x2), Math.max(tr.y - py, 0, py - tr.y2)))
          }
        }
        return best
      }
      // (labels with the same words share a name, so: SOME label of that name must sit on this arrow)
      if (Math.min(...labels.map(dist)) > 22) bad.push(`${name}: the label of "${c.name}" floats away from its arrow`)
    }
    // No two labels may sit on top of each other, and none on a box.
    const tags = objs.filter((o) => o.name.endsWith(' label'))
    const boxes = objs.filter((o) => o.metadata.render !== 'connector' && o.geometry.kind !== 'text' && !o.name.endsWith(' label') && o.size.w > 40 && o.size.h > 30)
    const boxRect = (o) => ({ x: o.position.x, x2: o.position.x + o.size.w, y: o.position.y, y2: o.position.y + o.size.h })
    for (const [i, t] of tags.entries()) {
      for (const o of tags.slice(i + 1)) if (hitR(textRect(t), textRect(o))) bad.push(`${name}: labels "${t.name}" and "${o.name}" overlap`)
      for (const bx of boxes) if (hitR(textRect(t), boxRect(bx))) bad.push(`${name}: label "${t.name}" runs into the box "${bx.name.slice(0, 20)}"`)
    }
  }
  if (process.env.DUMP) console.log(bad.join('\n'))
  assert.deepEqual(bad, [])
})
