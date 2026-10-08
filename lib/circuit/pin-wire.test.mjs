// Run: node --test lib/circuit/pin-wire.test.mjs
// Wiring contract: a routed pin→pin wire is orthogonal and ends exactly on both
// pins; a wire crossing another hops, a T-junction does not.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'pin-wire-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'out.mjs')
writeFileSync(entry, `
export { pinHit, routePins, wireHit } from '@/lib/circuit/pin-wire'
export { hoppedPath } from '@/lib/circuit/hops'
export { componentById, fromRecognition } from '@/lib/scene/factory'
export { createBehavior } from '@/lib/behaviors/registry'
export { terminalsOf, terminalWorld } from '@/lib/circuit/engine'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`, `--alias:@=${root}`, '--external:react', '--external:zustand'], { cwd: root, stdio: 'pipe' })
const m = await import(bundle)

const part = (id, x, y) => m.componentById(id).create({ x, y })
const wire = (pts, anchors = {}) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const o = m.fromRecognition({ kind: 'line', points: [[pts[0][0] - Math.min(...xs), pts[0][1] - Math.min(...ys)], [pts.at(-1)[0] - Math.min(...xs), pts.at(-1)[1] - Math.min(...ys)]], x: Math.min(...xs), y: Math.min(...ys), w: 2, h: 2 })
  o.metadata.render = 'connector'
  o.metadata.bends = pts.slice(1, -1).map((p) => [p[0] - Math.min(...xs), p[1] - Math.min(...ys)])
  o.behaviors.push(m.createBehavior('wire'))
  return o
}

test('routed wire is orthogonal and lands exactly on both pins', () => {
  const a = part('resistor', 100, 100), b = part('led', 400, 300)
  const objs = { [a.id]: a, [b.id]: b }
  const pa = m.pinHit(objs, m.terminalWorld(a, m.terminalsOf(a)[1]), 2)
  const pb = m.pinHit(objs, m.terminalWorld(b, m.terminalsOf(b)[0]), 2)
  const r = m.routePins(objs, pa, pb)
  assert.deepEqual([r[0].x, r[0].y], [pa.point.x, pa.point.y])
  assert.deepEqual([r.at(-1).x, r.at(-1).y], [pb.point.x, pb.point.y])
  for (let i = 1; i < r.length; i++) assert.ok(Math.abs(r[i].x - r[i - 1].x) < 0.5 || Math.abs(r[i].y - r[i - 1].y) < 0.5)
})

test('crossing wires hop; a T-junction does not', () => {
  const h = wire([[0, 100], [200, 100]])
  const v = wire([[100, 0], [100, 200]])
  assert.match(m.hoppedPath(h, { [h.id]: h, [v.id]: v }), /A5 5/)
  const t = wire([[100, 0], [100, 100]]) // ends ON the horizontal
  assert.equal(m.hoppedPath(h, { [h.id]: h, [t.id]: t }), null)
})

test('wireHit finds a point mid-run', () => {
  const h = wire([[0, 100], [200, 100]])
  const hit = m.wireHit({ [h.id]: h }, { x: 80, y: 103 }, 6)
  assert.equal(hit.wireId, h.id)
  assert.ok(Math.abs(hit.point.y - 100) < 0.5 && hit.horizontal)
})
