// Run: node --test lib/store/reproject-heal.test.mjs
// Moving or rotating a part must never leave a slanted wire behind.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from '../../scripts/test/exec.mjs'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'heal-'))
const entry = join(dir, 'e.ts')
const out = join(dir, 'o.mjs')
writeFileSync(entry, `
export { useDocStore } from '@/lib/store/document'
export { componentById } from '@/lib/scene/factory'
export { routePins, pinHit } from '@/lib/circuit/pin-wire'
export { fromRecognition } from '@/lib/scene/factory'
export { createBehavior } from '@/lib/behaviors/registry'
export { terminalsOf, terminalWorld } from '@/lib/circuit/engine'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${out}`, `--alias:@=${root}`, '--platform=node'], { cwd: root, stdio: 'pipe' })
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
const m = await import(out)
const S = m.useDocStore

/** Wire two pins exactly as the canvas gesture does. */
function wirePins(P, a, ia, b, ib) {
  const objs = S.getState().pages[P].objects
  const pa = { objectId: a.id, idx: ia, point: m.terminalWorld(a, m.terminalsOf(a)[ia]) }
  const pb = { objectId: b.id, idx: ib, point: m.terminalWorld(b, m.terminalsOf(b)[ib]) }
  const r = m.routePins(objs, pa, pb)
  const minX = Math.min(...r.map((q) => q.x)), minY = Math.min(...r.map((q) => q.y))
  const loc = (q) => [q.x - minX, q.y - minY]
  const w = m.fromRecognition({ kind: 'line', points: [loc(r[0]), loc(r.at(-1))], x: minX, y: minY, w: 10, h: 10 })
  w.metadata.render = 'connector'
  w.metadata.startAnchor = { kind: 'terminal', objectId: a.id, terminalId: String(ia) }
  w.metadata.endAnchor = { kind: 'terminal', objectId: b.id, terminalId: String(ib) }
  w.metadata.bends = r.slice(1, -1).map(loc)
  w.behaviors.push(m.createBehavior('wire'))
  S.getState().addObject(P, w)
  return w.id
}
const chainOf = (o) => [o.geometry.points[0], ...(o.metadata.bends ?? []), o.geometry.points.at(-1)]
const square = (c) => c.every((q, i) => i === 0 || Math.abs(q[0] - c[i - 1][0]) < 0.6 || Math.abs(q[1] - c[i - 1][1]) < 0.6)

for (const [name, act] of [
  ['dragged far', (P, b) => S.getState().updateObject(P, b.id, { position: { x: 40, y: 520 } })],
  ['dragged a little', (P, b) => S.getState().updateObject(P, b.id, { position: { x: b.position.x - 70, y: b.position.y + 35 } })],
  ['rotated 90°', (P, b) => S.getState().updateObject(P, b.id, { rotation: 90 })],
]) {
  test(`wire stays orthogonal when its part is ${name}`, () => {
    const P = 'heal-' + name
    S.getState().ensurePage(P)
    const a = m.componentById('resistor').create({ x: 100, y: 100 })
    const b = m.componentById('bjt').create({ x: 420, y: 300 })
    const c = m.componentById('opamp').create({ x: 100, y: 400 })
    for (const o of [a, b, c]) S.getState().addObject(P, o)
    const w1 = wirePins(P, a, 1, b, 0)
    const w2 = wirePins(P, c, 2, a, 0)
    act(P, b)
    const objs = S.getState().pages[P].objects
    for (const id of [w1, w2]) assert.ok(square(chainOf(objs[id])), `${name}: slanted ${JSON.stringify(chainOf(objs[id]))}`)
    // …and both ends still sit exactly on their pins
    const end = (id, last) => { const o = objs[id]; const q = last ? o.geometry.points.at(-1) : o.geometry.points[0]; return [o.position.x + q[0], o.position.y + q[1]] }
    const near = (p, o, i) => { const t = m.terminalWorld(objs[o], m.terminalsOf(objs[o])[i]); return Math.hypot(p[0] - t.x, p[1] - t.y) < 1 }
    assert.ok(near(end(w1, true), b.id, 0), `${name}: wire 1 end left its pin`)
    assert.ok(near(end(w2, true), a.id, 0), `${name}: wire 2 end left its pin`)
    assert.ok(near(end(w1, false), a.id, 1), `${name}: wire 1 start left its pin`)
  })
}
