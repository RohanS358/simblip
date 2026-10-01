import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const tmp = mkdtempSync(join(tmpdir(), 'act-'))
execFileSync('npx', ['esbuild', 'lib/steplab/act.ts', '--bundle', '--format=esm', `--outfile=${tmp}/a.mjs`], { stdio: 'pipe' })
const { applyAct } = await import(`${tmp}/a.mjs`)
const g = (o) => (k) => o[k] ?? ''
test('cycle wraps', () => assert.deepEqual(applyAct({ do: 'cycle', param: 'a', values: ['x', 'y'] }, g({ a: 'y' })), [{ param: 'a', value: 'x' }]))
test('step clamps', () => assert.deepEqual(applyAct({ do: 'step', param: 'n', by: 1, max: 4 }, g({ n: '4' })), [{ param: 'n', value: '4' }]))
test('toggle adds sorted and removes', () => {
  assert.deepEqual(applyAct({ do: 'toggle', param: 'm', item: '3' }, g({ m: '1 5' })), [{ param: 'm', value: '1 3 5' }])
  assert.deepEqual(applyAct({ do: 'toggle', param: 'm', item: '3' }, g({ m: '1 3 5' })), [{ param: 'm', value: '1 5' }])
})
test('three-state toggle: none -> 1 -> X -> none', () => {
  const a = { do: 'toggle', param: 'm', item: '2', also: 'x' }
  assert.deepEqual(applyAct(a, g({ m: '', x: '' })), [{ param: 'm', value: '2' }])
  assert.deepEqual(applyAct(a, g({ m: '2', x: '' })), [{ param: 'm', value: '' }, { param: 'x', value: '2' }])
  assert.deepEqual(applyAct(a, g({ m: '', x: '2' })), [{ param: 'x', value: '' }])
})
test('char cycles one cell of a grid row', () => {
  assert.deepEqual(applyAct({ do: 'char', param: 'g', index: 1, row: 1, chars: '.#' }, g({ g: 'S..\n...' })), [{ param: 'g', value: 'S..\n.#.' }])
})
test('set toggles back off', () => {
  const a = { do: 'set', param: 'e', value: '5', off: '0' }
  assert.deepEqual(applyAct(a, g({ e: '0' })), [{ param: 'e', value: '5' }])
  assert.deepEqual(applyAct(a, g({ e: '5' })), [{ param: 'e', value: '0' }])
})

const act2 = await import(`${tmp}/a.mjs`)
test('plot click appends a data point from drawing coordinates', () => {
  const a = { do: 'plot', param: 'p', box: { x: 100, y: 0, w: 200, h: 100 }, dom: { x0: 0, x1: 10, y0: 0, y1: 5 } }
  // middle of the box -> (5, 2.5)
  assert.deepEqual(act2.applyPoint(a, g({ p: '1,1;2,2' }), 200, 50), [{ param: 'p', value: '1,1;2,2;5,2.5' }])
  // outside the box clamps to the edge
  assert.deepEqual(act2.applyPoint(a, g({ p: '' }), 0, 200), [{ param: 'p', value: '0,0' }])
})
test('plot click takes the class label, Shift the other one, and keeps newline lists', () => {
  const a = { do: 'plot', param: 'd', box: { x: 0, y: 0, w: 100, h: 100 }, dom: { x0: 0, x1: 10, y0: 0, y1: 10 }, label: ['1', '0'] }
  assert.deepEqual(act2.applyPoint(a, g({ d: '0,0,0\n1,1,1' }), 50, 50), [{ param: 'd', value: '0,0,0\n1,1,1\n5,5,1' }])
  assert.deepEqual(act2.applyPoint(a, g({ d: '0,0,0' }), 50, 50, true), [{ param: 'd', value: '0,0,0;5,5,0'.replace(';', ';') }])
})
test('dragging a point keeps its label; double-click removes it', () => {
  const m = { do: 'move', param: 'd', index: 1, box: { x: 0, y: 0, w: 100, h: 100 }, dom: { x0: 0, x1: 10, y0: 0, y1: 10 } }
  assert.deepEqual(act2.applyPoint(m, g({ d: '0,0,0;1,1,1' }), 20, 80), [{ param: 'd', value: '0,0,0;2,2,1' }])
  assert.deepEqual(act2.dropPoint(m, g({ d: '0,0,0;1,1,1;2,2,0' })), [{ param: 'd', value: '0,0,0;2,2,0' }])
})
