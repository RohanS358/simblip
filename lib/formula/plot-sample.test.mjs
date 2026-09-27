// Adaptive function sampling (lib/formula/plot-sample.ts).
// Run: node --test lib/formula/plot-sample.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-plot-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'plot.mjs')
writeFileSync(entry, `export * from '@/lib/formula/plot-sample'\n`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`, `--alias:@=${root}`], { cwd: root, stdio: 'pipe' })
const { sampleFunctions, autoYDomain } = await import(bundle)

const gapsNear = (rows, j) => rows.filter((r) => Number.isNaN(r.ys[j])).map((r) => r.x)

test('tan x breaks at every pole in view, sin x never breaks', () => {
  const { rows, uniform } = sampleFunctions([Math.tan, Math.sin], -5, 5)
  const gaps = gapsNear(rows, 0)
  for (const pole of [-3 * Math.PI / 2, -Math.PI / 2, Math.PI / 2, 3 * Math.PI / 2])
    assert.ok(gaps.some((x) => Math.abs(x - pole) < 0.05), `no gap at ${pole}: ${gaps}`)
  assert.equal(gapsNear(rows, 1).length, 0)
  const dom = autoYDomain(uniform)
  assert.ok(dom && dom[1] < 50, `y-domain ignores the spikes: ${dom}`)
})

test('sqrt(4 − x²) is undefined outside |x| ≤ 2 — no fake flat line', () => {
  const { rows } = sampleFunctions([(x) => Math.sqrt(4 - x * x)], -5, 5)
  for (const r of rows) if (Math.abs(r.x) > 2.001) assert.ok(Number.isNaN(r.ys[0]), `value at ${r.x}`)
  // refinement finds the domain edge closely
  const defined = rows.filter((r) => Number.isFinite(r.ys[0])).map((r) => r.x)
  assert.ok(Math.min(...defined) < -1.99 && Math.max(...defined) > 1.99)
})

test('a smooth function keeps a modest point count', () => {
  const { rows, uniform } = sampleFunctions([(x) => x * x], 0, 10)
  assert.ok(rows.length < 600, `${rows.length} points`)
  assert.equal(autoYDomain(uniform), null)
})

test('parseEntry understands calculator-style input', async () => {
  const { parseEntry } = await import(bundle)
  assert.deepEqual(parseEntry('y = x^2'), { kind: 'fn', expr: 'x^2' })
  assert.deepEqual(parseEntry('f(x) = sin(x)'), { kind: 'fn', expr: 'sin(x)' })
  assert.deepEqual(parseEntry('sin(t)'), { kind: 'fn', expr: 'sin(t)' })
  assert.deepEqual(parseEntry('(x+1)*(x-1)'), { kind: 'fn', expr: '(x+1)*(x-1)' })
  assert.deepEqual(parseEntry('x == 2'), { kind: 'fn', expr: 'x == 2' })
  assert.deepEqual(parseEntry('x = 3'), { kind: 'vline', expr: '3' })
  assert.deepEqual(parseEntry('(1, 2), (3, 4)'), { kind: 'points', pts: [['1', '2'], ['3', '4']] })
  assert.deepEqual(parseEntry('(a, max(b, 2))'), { kind: 'points', pts: [['a', 'max(b, 2)']] })
  assert.deepEqual(parseEntry('(cos(t), sin(t))'), { kind: 'param', x: 'cos(t)', y: 'sin(t)', t0: '0', t1: '2*pi' })
  assert.deepEqual(parseEntry('(t*cos(t), t*sin(t)) t = 0.5..6*pi'), {
    kind: 'param', x: 't*cos(t)', y: 't*sin(t)', t0: '0.5', t1: '6*pi',
  })
})

test('axis ticks land on round 1-2-5 steps', async () => {
  const { niceTicks, niceDomain, fmtTick } = await import(bundle)
  assert.deepEqual(niceTicks(-10, 10, 5), { ticks: [-10, -5, 0, 5, 10], step: 5 })
  assert.deepEqual(niceTicks(0.13, 0.71, 5).ticks, [0.2, 0.4, 0.6])
  assert.deepEqual(niceTicks(0.13, 0.71, 10).ticks, [0.2, 0.3, 0.4, 0.5, 0.6, 0.7])
  assert.deepEqual(niceDomain(-0.93, 3.7, 5), [-1, 4])
  assert.equal(fmtTick(0.30000000000000004, 0.1), '0.3')
  assert.equal(fmtTick(250000, 50000), '2.5e5')
  assert.equal(fmtTick(-3, 1), '-3')
})
