// Lasso hit-testing. Run directly:  node lib/scene/lasso.test.mjs

import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'lasso-'))
const compile = (name, rewrite = (s) => s) => {
  const src = rewrite(readFileSync(new URL(`./${name}.ts`, import.meta.url), 'utf8'))
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  writeFileSync(join(dir, `${name}.mjs`), js)
}
compile('group', (s) => s.replace(/^import \{ uid \} from '\.\/types'$/m, 'const uid = () => "g"'))
compile('lasso', (s) => s.replace("from './group'", "from './group.mjs'"))
const { pointInPolygon, lassoHits } = await import(`file://${join(dir, 'lasso.mjs')}`)

const obj = (id, x, y, w, h, extra = {}) => ({
  id, name: id, geometry: { kind: 'rect' }, position: { x, y }, size: { w, h },
  rotation: 0, z: 1, behaviors: [], parameters: {}, metadata: {}, ...extra,
})
const page = (...os) => Object.fromEntries(os.map((o) => [o.id, o]))

// An OPEN "C" shape still selects what it encloses — the closing edge is implied.
const openC = [{ x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }]
assert.equal(pointInPolygon({ x: 50, y: 50 }, openC), true, 'implicitly closed')
assert.equal(pointInPolygon({ x: 150, y: 50 }, openC), false)

const objs = page(
  obj('in', 40, 40, 20, 20),
  obj('out', 200, 200, 20, 20),
  obj('ink', 80, 10, 40, 10, { geometry: { kind: 'stroke', points: [[0, 0], [10, 0], [30, 0], [40, 0]] } }),
  obj('hid', 40, 40, 5, 5, { metadata: { hidden: true } }),
)
// ink: points at x=80,90 inside (x<100), 110,120 outside → exactly half → selected
assert.deepEqual(lassoHits(openC, objs).sort(), ['in', 'ink'])

// A hit on a grouped child selects the group, once.
const grouped = page(
  obj('a', 10, 10, 10, 10), obj('b', 30, 30, 10, 10),
  obj('G', 10, 10, 30, 30, { geometry: { kind: 'group', children: ['a', 'b'] } }),
)
assert.deepEqual(lassoHits(openC, grouped), ['G'])

// Too few points to enclose anything.
assert.deepEqual(lassoHits([{ x: 0, y: 0 }, { x: 10, y: 10 }], objs), [])

console.log('lasso: ok')
