// Phase S0 exit: every gold IR compiles → lints clean → (for circuits) runs in
// the real engine; bad IR produces clear errors, never a crash.
// Run: node --experimental-strip-types --import ./scripts/test/register.mjs --test lib/sketch/compile.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { compileIR } from './compile.ts'
import { lintSimScript } from '../ai/simscript-lint.ts'
import { parseQuantity } from './units.ts'

const goldDir = resolve(import.meta.dirname, '../../scripts/ai/sketch/gold')
const files = readdirSync(goldDir).filter((f) => f.endsWith('.json'))

test('gold set has 40 files', () => assert.equal(files.length, 40))

for (const f of files) {
  test(`gold ${f} compiles and lints clean in <20ms`, () => {
    const ir = JSON.parse(readFileSync(join(goldDir, f), 'utf8'))
    const t0 = performance.now()
    const r = compileIR(ir)
    const ms = performance.now() - t0
    assert.deepEqual(r.errors, [])
    const l = lintSimScript(r.script)
    assert.deepEqual(l.errors, [], r.script)
    assert.ok(ms < 20, `compile took ${ms}ms`)
  })
}

test('appendix C example compiles to the documented script', () => {
  const ir = {
    domain: 'circuit',
    nodes: [
      { id: 'n1', cls: 'battery', conf: 0.97, bbox: [40, 60, 30, 60], rot: 90, source: 'ink' },
      { id: 'n2', cls: 'resistor', conf: 0.95, values: { R: '1k' }, bbox: [120, 50, 60, 24], rot: 0, source: 'ink' },
      { id: 'n3', cls: 'diode', conf: 0.88, bbox: [220, 60, 40, 30], rot: 180, source: 'ink' },
    ],
    edges: [
      { a: { node: 'n1', pin: 'positive' }, b: { node: 'n2', pin: 'a' }, kind: 'wire', conf: 0.96 },
      { a: { node: 'n2', pin: 'b' }, b: { node: 'n3', pin: 'anode' }, kind: 'wire', conf: 0.92 },
      { a: { node: 'n3', pin: 'cathode' }, b: { node: 'n1', pin: 'negative' }, kind: 'wire', conf: 0.95 },
    ],
    labels: [], doubts: [],
  }
  const r = compileIR(ir)
  assert.ok(r.ok, r.errors.join('\n'))
  assert.match(r.script, /create\("resistor", \{ R: 1000 \}\)/)
  assert.match(r.script, /connect\(n3\.cathode, n1\.negative\)/)
  // battery voltage was never written → ghost must ask
  assert.ok(r.doubts.some((d) => d.ref === 'n1' && d.why === 'unreadable-value'))
})

test('errors are clear, never a throw', () => {
  const bad = compileIR({ domain: 'circuit', nodes: [{ id: 'a', cls: 'resistor', conf: 1, bbox: [0, 0, 1, 1], rot: 0, source: 'ink' },
    { id: 'z', cls: 'flux-capacitor', conf: 1, bbox: [0, 0, 1, 1], rot: 0, source: 'ink' }],
    edges: [{ a: { node: 'a', pin: 'nope' }, b: { node: 'q', pin: 'a' }, kind: 'wire', conf: 1 }], labels: [], doubts: [] })
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.some((e) => /flux-capacitor/.test(e)))
  assert.ok(bad.errors.some((e) => /unknown node "q"/.test(e)))
  assert.equal(compileIR({ nope: 1 }).ok, false)
  assert.equal(compileIR(null).ok, false)
})

test('low-confidence nodes become doubts; unreadable values too', () => {
  const r = compileIR({ domain: 'circuit', nodes: [
    { id: 'r', cls: 'resistor', conf: 0.4, values: { R: 'banana' }, bbox: [0, 0, 1, 1], rot: 0, source: 'ink' }], edges: [], labels: [], doubts: [] })
  assert.ok(r.doubts.some((d) => d.why === 'low-confidence'))
  assert.ok(r.doubts.some((d) => d.why === 'unreadable-value'))
})

test('units', () => {
  for (const [s, v] of [['1k', 1000], ['10 kΩ', 1e4], ['4.7u', 4.7e-6], ['100 µF', 1e-4], ['9V', 9], ['2M', 2e6], ['10m', 0.01], ['50Hz', 50], ['330', 330]])
    assert.equal(parseQuantity(s), v, s)
  assert.equal(parseQuantity('abc'), null)
})
