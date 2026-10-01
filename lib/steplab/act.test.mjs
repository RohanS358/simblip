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
