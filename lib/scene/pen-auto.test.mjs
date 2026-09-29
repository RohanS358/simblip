// Auto pen rules. Run directly:  node lib/scene/pen-auto.test.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const src = readFileSync(new URL('./pen-auto.ts', import.meta.url), 'utf8').replace(/^import .*$/m, '')
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { choosePenStyle, CHAIN_MS, MANUAL_HOLD_MS } = await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
)

const base = {
  now: 100_000, pointerType: 'mouse', running: false, overText: false,
  current: 'ink', lastAuto: null, lastStrokeAt: 0, manualAt: 0,
}
const pick = (o) => choosePenStyle({ ...base, ...o })

assert.equal(pick({}), 'pen', 'mouse → flat pen')
assert.equal(pick({ pointerType: 'pen' }), 'ink', 'stylus → pressure ink')
assert.equal(pick({ overText: true }), 'highlighter', 'over text → highlighter')
assert.equal(pick({ running: true, overText: true }), 'pointer', 'running sim beats text')
assert.equal(pick({ lastAuto: 'highlighter', lastStrokeAt: base.now - CHAIN_MS + 500 }), 'highlighter', 'chained strokes keep highlighter')
assert.equal(pick({ lastAuto: 'highlighter', lastStrokeAt: base.now - CHAIN_MS - 500 }), 'pen', 'idle highlighter resets')
assert.equal(pick({ manualAt: base.now - 1000, current: 'pointer', overText: true }), 'pointer', 'manual pick wins')
assert.equal(pick({ manualAt: base.now - MANUAL_HOLD_MS - 1, overText: true }), 'highlighter', 'manual hold expires')
console.log('pen-auto: ok')
