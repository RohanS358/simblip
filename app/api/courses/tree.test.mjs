// The syllabus tree is derived from each lesson's stored '/'-separated path,
// so a lesson moves by editing one field. This pins the derivation: nesting,
// sibling order, and top-level lessons that have no unit at all.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// treeOf is module-private in route.ts (it has no business being public), so
// the test compiles the file and reaches it through a tiny re-export shim.
const dir = mkdtempSync(join(tmpdir(), 'tree-'))
const src = readFileSync(resolve(import.meta.dirname, 'route.ts'), 'utf8')
const fn = src.slice(src.indexOf('function treeOf'), src.indexOf('export async function GET'))
const shim = join(dir, 'tree.ts')
writeFileSync(shim, `
interface LessonRow { id: string; course_id: string; path: string; title: string; ord: number }
interface Node { name: string; lessons: { id: string; title: string }[]; children: Node[] }
${fn}
export { treeOf }
`)
const bundle = join(dir, 'tree.mjs')
execFileSync('npx', ['esbuild', shim, '--bundle', '--format=esm', '--outfile=' + bundle], { stdio: 'pipe' })
const { treeOf } = await import(bundle)

const row = (id, path, title) => ({ id, course_id: 'c', path, title, ord: 0 })

test('lessons group under their unit', () => {
  const t = treeOf([
    row('l1', 'DC Circuits', "Ohm's law"),
    row('l2', 'DC Circuits', "Kirchhoff's laws"),
  ])
  assert.equal(t.length, 1)
  assert.equal(t[0].name, 'DC Circuits')
  assert.deepEqual(t[0].lessons.map((l) => l.title), ["Ohm's law", "Kirchhoff's laws"])
})

test('a nested path builds nested units', () => {
  const t = treeOf([row('l1', 'DC Circuits/Resistance', 'Resistivity')])
  assert.equal(t[0].name, 'DC Circuits')
  assert.equal(t[0].children[0].name, 'Resistance')
  assert.equal(t[0].children[0].lessons[0].title, 'Resistivity')
})

test('separate units stay separate', () => {
  const t = treeOf([
    row('l1', 'DC Circuits', 'A'),
    row('l2', 'Electrostatics', 'B'),
  ])
  assert.deepEqual(t.map((n) => n.name), ['DC Circuits', 'Electrostatics'])
})

test('a lesson with no path sits at the top level', () => {
  const t = treeOf([row('l1', '', 'Standalone')])
  assert.equal(t.length, 1)
  assert.equal(t[0].name, '')
  assert.equal(t[0].lessons[0].title, 'Standalone')
})

test('units and loose lessons coexist, units first', () => {
  const t = treeOf([row('l1', 'Unit A', 'In a unit'), row('l2', '', 'Loose')])
  assert.equal(t[0].name, 'Unit A')
  assert.equal(t[t.length - 1].lessons[0].title, 'Loose')
})

test('no lessons means no tree', () => {
  assert.deepEqual(treeOf([]), [])
})

rmSync(dir, { recursive: true, force: true })
