// Group containers. Children keep ABSOLUTE page positions and the group
// writes deltas, so the traps are geometric: a rotation that also translates
// (rotating the top-left corner instead of the centre), a resize that
// collapses children to zero, and cycles in the ownership graph hanging a
// walk.
//
// Run directly:  node lib/scene/group.test.mjs

import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'

// Compile the real module. `uid` is the only import and it's trivial, so it
// gets stubbed rather than dragging in the whole types module.
const srcPath = new URL('./group.ts', import.meta.url)
let source = readFileSync(srcPath, 'utf8')
  .replace(/^import type .*$/gm, '')
  .replace(/^import \{ uid \} from '\.\/types'$/m, "let __n = 0\nconst uid = () => `id${++__n}`")
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const out = join(mkdtempSync(join(tmpdir(), 'group-')), 'group.mjs')
writeFileSync(out, js)
const {
  childrenOf, groupOf, rootGroupOf, descendantIds, unionBox,
  makeGroup, refitGroup, moveGroupBy, scaleGroupTo, rotateGroupBy,
} = await import(`file://${out}`)

const box = (id, x, y, w, h, z = 1, rotation = 0) => ({
  id, name: id, geometry: { kind: 'rect' }, position: { x, y }, size: { w, h },
  rotation, z, behaviors: [], parameters: {}, metadata: {},
})
const grp = (id, children, x, y, w, h, z = 9, rotation = 0) => ({
  id, name: id, geometry: { kind: 'group', children }, position: { x, y },
  size: { w, h }, rotation, z, behaviors: [], parameters: {}, metadata: {},
})
const page = (...os) => Object.fromEntries(os.map((o) => [o.id, o]))
const round = (n) => Math.round(n * 1000) / 1000

// ── Bounding box ───────────────────────────────────────────────────────────
assert.equal(unionBox([]), null, 'no objects means no box')
assert.deepEqual(
  unionBox([box('a', 10, 10, 40, 20), box('b', 70, 50, 30, 30)]),
  { x: 10, y: 10, w: 90, h: 70 },
  'the union spans both'
)

// ── Building a group ───────────────────────────────────────────────────────
assert.equal(makeGroup([]), null, 'nothing to group')
assert.equal(makeGroup([box('a', 0, 0, 10, 10)]), null, 'one object is not a group')

const g = makeGroup([box('b', 70, 50, 30, 30, 5), box('a', 10, 10, 40, 20, 2)])
assert.deepEqual(g.position, { x: 10, y: 10 }, 'the group fits its members')
assert.deepEqual(g.size, { w: 90, h: 70 })
assert.deepEqual(g.geometry.children, ['a', 'b'], 'children are stored bottom-first by z')
assert.equal(g.z, 5, 'the group takes its topmost member’s z')

// ── Membership lookups ─────────────────────────────────────────────────────
const a = box('a', 10, 10, 40, 20)
const b = box('b', 70, 50, 30, 30)
const loose = box('loose', 500, 500, 10, 10)
const G = grp('G', ['a', 'b'], 10, 10, 90, 70)
const p = page(a, b, loose, G)

assert.deepEqual(childrenOf(G, p).map((o) => o.id), ['a', 'b'])
assert.deepEqual(childrenOf(grp('X', ['ghost'], 0, 0, 1, 1), p), [], 'missing ids are skipped, not thrown')
assert.equal(groupOf('a', p).id, 'G', 'a child finds its parent')
assert.equal(groupOf('loose', p), undefined, 'a top-level object has no parent')
assert.deepEqual(descendantIds(G, p), ['a', 'b'])

// Nested groups: clicking a leaf selects the OUTERMOST container.
const inner = grp('inner', ['a', 'b'], 10, 10, 90, 70, 4)
const outer = grp('outer', ['inner', 'loose'], 10, 10, 500, 500, 8)
const nested = page(a, b, loose, inner, outer)
assert.equal(rootGroupOf('a', nested), 'outer', 'a leaf resolves to the outermost group')
assert.equal(rootGroupOf('inner', nested), 'outer')
assert.equal(rootGroupOf('outer', nested), 'outer', 'the root resolves to itself')
assert.deepEqual(descendantIds(outer, nested).sort(), ['a', 'b', 'inner', 'loose'], 'walk is deep')

// Corrupt data must not hang the editor.
const cyc = page(grp('g1', ['g2'], 0, 0, 1, 1), grp('g2', ['g1'], 0, 0, 1, 1))
assert.equal(rootGroupOf('g1', cyc), 'g2', 'a cycle terminates instead of looping forever')
assert.deepEqual(descendantIds(cyc.g1, cyc), ['g2'], 'a cyclic walk terminates and excludes the root')

// ── Refit ──────────────────────────────────────────────────────────────────
assert.equal(refitGroup(G, p), G, 'an already-correct group keeps its identity')
const stale = grp('G', ['a', 'b'], 0, 0, 5, 5)
assert.deepEqual(refitGroup(stale, p).position, { x: 10, y: 10 }, 'a stale box re-fits to its children')
assert.deepEqual(refitGroup(stale, p).size, { w: 90, h: 70 })
assert.equal(refitGroup(grp('X', [], 0, 0, 1, 1), p), null, 'an empty group cannot be fitted')

// ── Move ───────────────────────────────────────────────────────────────────
const moved = moveGroupBy(G, p, { x: 50, y: -10 })
assert.deepEqual(moved, {
  G: { x: 60, y: 0 },
  a: { x: 60, y: 0 },
  b: { x: 120, y: 40 },
}, 'the group and every child shift by the same delta')

// Nested: moving the outer group carries the inner group AND its leaves.
const movedDeep = moveGroupBy(outer, nested, { x: 100, y: 0 })
assert.deepEqual(Object.keys(movedDeep).sort(), ['a', 'b', 'inner', 'loose', 'outer'])
assert.equal(movedDeep.a.x, 110, 'a leaf two levels down still moves')

// ── Resize ─────────────────────────────────────────────────────────────────
// Double the width, keep the height: children scale and stay in proportion.
const scaled = scaleGroupTo(G, p, { x: 10, y: 10, w: 180, h: 70 })
assert.deepEqual(scaled.G, { position: { x: 10, y: 10 }, size: { w: 180, h: 70 } })
assert.deepEqual(scaled.a, { position: { x: 10, y: 10 }, size: { w: 80, h: 20 } }, 'child at the origin doubles in width')
assert.deepEqual(scaled.b, { position: { x: 130, y: 50 }, size: { w: 60, h: 30 } }, 'child offset scales too')

// A child must never be scaled out of existence.
const collapsed = scaleGroupTo(G, p, { x: 10, y: 10, w: 0, h: 0 })
assert.ok(collapsed.a.size.w >= 1 && collapsed.a.size.h >= 1, 'children keep a minimum size')

// A zero-sized group cannot divide by zero.
const fromZero = scaleGroupTo(grp('Z', ['a'], 0, 0, 0, 0), page(a, grp('Z', ['a'], 0, 0, 0, 0)), { x: 0, y: 0, w: 50, h: 50 })
assert.ok(Number.isFinite(fromZero.a.position.x), 'no NaN from a zero-size group')

// ── Rotate ─────────────────────────────────────────────────────────────────
// The classic bug: rotating a child's top-left corner instead of its centre
// also translates it. Rotate a symmetric group 360° — everything must land
// exactly back where it started.
const sym = page(box('l', 0, 40, 20, 20), box('r', 80, 40, 20, 20), grp('S', ['l', 'r'], 0, 0, 100, 100))
const full = rotateGroupBy(sym.S, sym, 360)
assert.equal(round(full.l.position.x), 0, 'a full turn returns the child to its exact x')
assert.equal(round(full.l.position.y), 40, 'a full turn returns the child to its exact y')
assert.equal(round(full.r.position.x), 80)

// 180° about the centre swaps the two children's positions.
const half = rotateGroupBy(sym.S, sym, 180)
assert.equal(round(half.l.position.x), 80, 'the left child orbits to the right')
assert.equal(round(half.r.position.x), 0, 'the right child orbits to the left')
assert.equal(round(half.l.position.y), 40, 'y is unchanged for a horizontal pair')

// Children spin as well as orbit, so the group reads as one rigid object.
assert.equal(half.l.rotation, 180, 'the child spins by the same angle')
assert.equal(half.S.rotation, 180, 'the group records its own rotation')
assert.deepEqual(half.S.position, { x: 0, y: 0 }, 'the group box itself does not move when rotating')

// A child already at the centre stays put.
const centred = page(box('c', 40, 40, 20, 20), grp('C', ['c'], 0, 0, 100, 100))
const spun = rotateGroupBy(centred.C, centred, 90)
assert.equal(round(spun.c.position.x), 40, 'a centred child does not orbit')
assert.equal(round(spun.c.position.y), 40)

console.log('group: ok')
