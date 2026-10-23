// Per-system variables: scope/precedence (system > page > engine default),
// undo, and the AI edit ops that read/create/change/delete them.
//
// Run: node --test lib/ai/system-vars.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'sysvars-'))
const entry = join(dir, 'e.ts')
const out = join(dir, 'o.mjs')
writeFileSync(entry, `
export { useDocStore } from '@/lib/store/document'
export { createSystem, createGeometry } from '@/lib/scene/factory'
export { systemScope, systemOf, systemVarsOf } from '@/lib/formula/system-scope'
export { verifyPlan, describePlan } from '@/lib/ai/edit-ops'
export { applyPlan } from '@/lib/ai/apply-ops'
export { buildDigest } from '@/lib/ai/page-context'
export { wantsEdit } from '@/lib/ai/route-intent'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${out}`, `--alias:@=${root}`, '--platform=node'], { cwd: root, stdio: 'pipe' })
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
const m = await import(out)
const S = m.useDocStore
const st = () => S.getState()

/** Two systems side by side, one rect inside each, one outside both. */
function scene(P) {
  st().ensurePage(P)
  const left = m.createSystem('mechanics', { x: 0, y: 0 }); left.name = 'Left box'
  const right = m.createSystem('mechanics', { x: 600, y: 0 }); right.name = 'Right box'
  const mk = (x) => {
    const o = m.createGeometry('rect', { x, y: 100 })
    o.size = { w: 20, h: 20 }
    o.parameters.val = { kind: 'number', expr: 'k * 2', value: 0 }
    return o
  }
  const inL = mk(100), inR = mk(700), out = mk(1200)
  for (const o of [left, right, inL, inR, out]) st().addObject(P, o)
  return { left, right, inL, inR, out }
}
const val = (P, o) => st().pages[P].objects[o.id].parameters.val.value

test('system variable beats the page variable, only inside that system', () => {
  const P = 'p1'
  const s = scene(P)
  st().upsertVariable(P, 'k', '1')
  st().upsertSystemVariable(P, s.left.id, 'k', '10')
  assert.equal(val(P, s.inL), 20) // system k
  assert.equal(val(P, s.inR), 2) // other system: page k
  assert.equal(val(P, s.out), 2) // outside: page k
})

test('system vars see page vars, and re-solve when the page var changes', () => {
  const P = 'p2'
  const s = scene(P)
  st().upsertVariable(P, 'base', '3')
  st().upsertSystemVariable(P, s.left.id, 'k', 'base + 1')
  assert.equal(val(P, s.inL), 8)
  st().upsertVariable(P, 'base', '5')
  assert.equal(val(P, s.inL), 12)
})

test('engine overrides are scoped: g on one system leaves the other and the page alone', () => {
  const P = 'p3'
  const s = scene(P)
  st().upsertSystemVariable(P, s.left.id, 'g', '1.62')
  const page = { g: 9.81 }
  const L = st().pages[P].objects[s.left.id]
  const R = st().pages[P].objects[s.right.id]
  assert.equal(m.systemScope(L, page).g, 1.62)
  assert.equal(m.systemScope(R, page).g, 9.81)
  assert.equal(m.systemOf(st().pages[P].objects, st().pages[P].objects[s.inL.id]).id, s.left.id)
  assert.equal(m.systemOf(st().pages[P].objects, st().pages[P].objects[s.out.id]), undefined)
})

test('add / rename / delete via the store, and undo', async () => {
  const P = 'p4'
  const s = scene(P)
  st().addSystemVariable(P, s.left.id, 'k', '4')
  st().addSystemVariable(P, s.left.id, 'k', '5') // name clash → k1
  const vars = () => m.systemVarsOf(st().pages[P].objects[s.left.id])
  assert.deepEqual(vars().map((v) => v.name), ['k', 'k1'])
  st().updateSystemVariable(P, s.left.id, vars()[0].id, { expr: '7' })
  assert.equal(val(P, s.inL), 14)
  await new Promise((r) => setTimeout(r, 450)) // past the 400 ms undo-coalescing window
  st().removeSystemVariable(P, s.left.id, vars()[0].id)
  assert.deepEqual(vars().map((v) => v.name), ['k1'])
  st().undo(P)
  assert.deepEqual(vars().map((v) => v.name), ['k', 'k1'])
  // a plain object id is not a system: nothing is written into it
  st().addSystemVariable(P, s.inL.id, 'z', '1')
  assert.equal(st().pages[P].objects[s.inL.id].metadata.vars, undefined)
})

test('a bad expression errors that variable without poisoning the page', () => {
  const P = 'p5'
  const s = scene(P)
  st().upsertSystemVariable(P, s.left.id, 'bad', '1 +')
  assert.ok(m.systemVarsOf(st().pages[P].objects[s.left.id])[0].error)
  assert.equal(val(P, s.out), 0) // k undefined → 0, untouched
})

test('AI ops: set (by name and id), remove, and rejections', () => {
  const P = 'p6'
  const s = scene(P)
  const doc = () => st().pages[P]
  let plan = { summary: 'moon', ops: [
    { op: 'setVariable', name: 'g', expr: '1.62', system: 'left box' },
    { op: 'setVariable', name: 'k', expr: '3', system: s.right.id },
    { op: 'setVariable', name: 'k', expr: '1' },
  ] }
  assert.ok(m.verifyPlan(plan, doc()).ok)
  assert.ok(m.applyPlan(P, plan).ok)
  assert.equal(m.systemVarsOf(doc().objects[s.left.id])[0].name, 'g')
  assert.equal(val(P, s.inR), 6)
  assert.equal(val(P, s.inL), 2)
  assert.match(m.describePlan(plan, doc())[0], /Left box variable g = 1.62/)

  plan = { summary: 'x', ops: [{ op: 'removeVariable', name: 'g', system: 'Left box' }] }
  assert.ok(m.applyPlan(P, plan).ok)
  assert.equal(m.systemVarsOf(doc().objects[s.left.id]).length, 0)

  const bad = m.verifyPlan({ summary: 'x', ops: [{ op: 'setVariable', name: 'g', expr: '1', system: 'nope' }] }, doc())
  assert.equal(bad.ok, false)
  assert.match(bad.errors[0], /no system "nope".*Left box/)
  assert.equal(m.verifyPlan({ summary: 'x', ops: [{ op: 'removeVariable', name: 'zzz', system: 'Left box' }] }, doc()).ok, false)
  assert.equal(m.verifyPlan({ summary: 'x', ops: [{ op: 'removeVariable', name: 'zzz' }] }, doc()).ok, false)
})

test('the assistant can see system variables, and routes the request to edit', () => {
  const P = 'p7'
  const s = scene(P)
  st().upsertSystemVariable(P, s.left.id, 'g', '1.62')
  const text = m.buildDigest(st().pages[P]).text
  assert.match(text, new RegExp(`System ${s.left.id} "Left box" variables.*g=1.62`))
  for (const q of [
    'set gravity to 1.6 in the left system',
    'add a variable k = 3 to the mechanics box',
    'make the drag in this box zero',
    'delete the variable speed',
  ]) assert.equal(m.wantsEdit(q, true), true, q)
  assert.equal(m.wantsEdit('explain gravity', true), false)
})
