// A connection, once made, survives everything.
//
// Connector endpoints are stored as RELATIVE anchors — {objectId, t} on a
// boundary, {objectId, terminalId} on a symbol — never as absolute points, so
// the attachment is a reference that has to be re-resolved whenever the thing
// it points at moves. Every mutation path that can move or resize an object
// must therefore reproject, or the connector visually detaches and the user
// has to redraw it.
//
// These tests pin that invariant on the real store.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'conn-'))
const bundle = join(dir, 'doc.mjs')
const entry = join(dir, 'entry.ts')
writeFileSync(entry, `
export { useDocStore } from ${JSON.stringify(resolve(import.meta.dirname, 'document.ts'))}
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', '--outfile=' + bundle,
  '--alias:@=' + resolve(import.meta.dirname, '../..')], { stdio: 'pipe' })
const { useDocStore } = await import(bundle)

const P = 'conn-test'
const doc = () => useDocStore.getState()

/** A box at (x,y). */
function box(id, x, y, w = 80, h = 60) {
  return {
    id, name: id, geometry: { kind: 'rect' }, behaviors: [], parameters: {},
    position: { x, y }, size: { w, h }, rotation: 0, z: 1, metadata: {},
  }
}

/** A connector anchored to both boxes' boundaries. */
function connector(id, aId, bId, aT = 0.5, bT = 0.0) {
  return {
    id, name: id, geometry: { kind: 'line', points: [[0, 0], [100, 0]] },
    behaviors: [], parameters: {},
    position: { x: 0, y: 0 }, size: { w: 100, h: 2 }, rotation: 0, z: 2,
    metadata: {
      render: 'connector',
      startAnchor: { kind: 'boundary', objectId: aId, t: aT },
      endAnchor: { kind: 'boundary', objectId: bId, t: bT },
    },
  }
}

/** Where the connector's two ends actually sit, in world coordinates. */
function ends(pageId, connId) {
  const o = doc().pages[pageId].objects[connId]
  const pts = o.geometry.points
  const last = pts[pts.length - 1]
  return {
    a: { x: o.position.x + pts[0][0], y: o.position.y + pts[0][1] },
    b: { x: o.position.x + last[0], y: o.position.y + last[1] },
  }
}

/** Is `pt` on (or within tol of) `obj`'s bounding box edge? */
function touches(obj, pt, tol = 1.5) {
  const { x, y } = obj.position
  const { w, h } = obj.size
  const insideX = pt.x >= x - tol && pt.x <= x + w + tol
  const insideY = pt.y >= y - tol && pt.y <= y + h + tol
  const onVert = Math.abs(pt.x - x) <= tol || Math.abs(pt.x - (x + w)) <= tol
  const onHorz = Math.abs(pt.y - y) <= tol || Math.abs(pt.y - (y + h)) <= tol
  return insideX && insideY && (onVert || onHorz)
}

function freshPage() {
  doc().forgetPage?.(P)
  doc().ensurePage(P)
  useDocStore.setState((s) => ({
    pages: { ...s.pages, [P]: { objects: {}, variables: [] } },
  }))
  doc().addObject(P, box('A', 0, 0), { history: false })
  doc().addObject(P, box('B', 300, 0), { history: false })
  doc().addObject(P, connector('C', 'A', 'B'), { history: false })
}

test('a connector starts attached to both objects', () => {
  freshPage()
  doc().updateObject(P, 'A', { position: { x: 0, y: 0 } })
  const { a, b } = ends(P, 'C')
  const objs = doc().pages[P].objects
  assert.ok(touches(objs.A, a), `start ${JSON.stringify(a)} not on A`)
  assert.ok(touches(objs.B, b), `end ${JSON.stringify(b)} not on B`)
})

test('MOVING an object keeps both ends attached', () => {
  freshPage()
  doc().updateObject(P, 'A', { position: { x: 40, y: 120 } })
  const objs = doc().pages[P].objects
  const { a, b } = ends(P, 'C')
  assert.ok(touches(objs.A, a), `start ${JSON.stringify(a)} left A after move`)
  assert.ok(touches(objs.B, b), `end ${JSON.stringify(b)} left B after move`)
})

test('RESIZING an object keeps its end attached', () => {
  freshPage()
  doc().updateObject(P, 'B', { size: { w: 200, h: 160 } })
  const objs = doc().pages[P].objects
  const { b } = ends(P, 'C')
  assert.ok(touches(objs.B, b), `end ${JSON.stringify(b)} left B after resize`)
})

test('moving an object REPEATEDLY never drifts loose', () => {
  freshPage()
  for (let i = 1; i <= 25; i++) {
    doc().updateObject(P, 'A', { position: { x: i * 7, y: i * 5 } })
  }
  const objs = doc().pages[P].objects
  const { a } = ends(P, 'C')
  assert.ok(touches(objs.A, a), `start ${JSON.stringify(a)} drifted off A after 25 moves`)
})

test('moving BOTH ends keeps both attached', () => {
  freshPage()
  doc().updateObject(P, 'A', { position: { x: 20, y: 200 } })
  doc().updateObject(P, 'B', { position: { x: 420, y: 60 } })
  const objs = doc().pages[P].objects
  const { a, b } = ends(P, 'C')
  assert.ok(touches(objs.A, a), `start ${JSON.stringify(a)} left A`)
  assert.ok(touches(objs.B, b), `end ${JSON.stringify(b)} left B`)
})

test('UNDO restores a connection along with the move', () => {
  freshPage()
  doc().updateObject(P, 'A', { position: { x: 500, y: 500 } }, { history: true })
  doc().undo(P)
  const objs = doc().pages[P].objects
  const { a } = ends(P, 'C')
  assert.ok(touches(objs.A, a), `start ${JSON.stringify(a)} left A after undo`)
})

test('deleting one endpoint drops that anchor but keeps the other', () => {
  freshPage()
  doc().removeObjects(P, ['B'])
  const c = doc().pages[P].objects.C
  assert.equal(c.metadata.endAnchor, undefined, 'anchor to a deleted object must be dropped')
  assert.ok(c.metadata.startAnchor, 'the surviving anchor must be kept')
})

// ── Scripted wires ─────────────────────────────────────────────────────────
// connect() records the relationship in BEHAVIOR PARAMS (targetA/anchorA/
// targetB/anchorB), not in metadata.{start,end}Anchor. A reprojector that only
// reads metadata therefore never touches a scripted wire, and moving a
// component leaves its wiring behind — the same detachment, by a second route.

/** A wire as connect() builds one: relationship in behavior params. */
function wire(id, aId, bId, ax = 40, ay = 30, bx = 340, by = 30) {
  return {
    id, name: 'wire',
    geometry: { kind: 'line', points: [[0, 0], [bx - ax, by - ay]] },
    behaviors: [{
      id: id + '-b', type: 'wire', enabled: true,
      params: {
        targetA: { kind: 'string', value: aId }, anchorA: { kind: 'string', value: 'centre' },
        targetB: { kind: 'string', value: bId }, anchorB: { kind: 'string', value: 'centre' },
      },
    }],
    parameters: {},
    position: { x: ax, y: ay }, size: { w: Math.abs(bx - ax) || 4, h: Math.abs(by - ay) || 4 },
    rotation: 0, z: 2, metadata: { render: 'wire' },
  }
}

test('a SCRIPTED wire follows its component when it moves', () => {
  freshPage()
  doc().removeObjects(P, ['C']) // drop the hand-drawn connector; test the scripted one
  doc().addObject(P, wire('W', 'A', 'B'), { history: false })
  doc().updateObject(P, 'A', { position: { x: 0, y: 400 } })
  const objs = doc().pages[P].objects
  const { a } = ends(P, 'W')
  const centreA = { x: objs.A.position.x + objs.A.size.w / 2, y: objs.A.position.y + objs.A.size.h / 2 }
  assert.ok(
    Math.hypot(a.x - centreA.x, a.y - centreA.y) <= 2,
    `wire end ${JSON.stringify(a)} did not follow A to ${JSON.stringify(centreA)}`
  )
})

rmSync(dir, { recursive: true, force: true })
