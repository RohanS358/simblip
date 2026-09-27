// LC tank energy check for the BDF2 companion models (lib/circuit/engine.ts).
// A lossless LC must keep oscillating at f = 1/(2π√LC); backward Euler lost
// ~15% of its energy per cycle at 1 Hz.
//
// Run: node --test lib/circuit/companion.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-lc-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'lc.mjs')
writeFileSync(entry, `export { capCompanion, indCompanion } from '@/lib/circuit/engine'\n`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`, `--alias:@=${root}`], { cwd: root, stdio: 'pipe' })
const { capCompanion, indCompanion } = await import(bundle)

test('LC tank at 1 Hz keeps its amplitude and frequency over 10 cycles', () => {
  const C = 0.01
  const L = 1 / ((2 * Math.PI) ** 2 * C) // f = 1 Hz
  const dt = 1 / 120
  const cs = { v: 1 } // capacitor starts charged to 1 V
  const ls = { i: 0 }
  let v = 1
  let peak = 0
  let lastSign = 1
  const crossings = []
  for (let n = 1; n <= 1200; n++) {
    // One node, cap and inductor in parallel to ground: KCL gc·v + ic0 + gl·v + il0 = 0
    const c = capCompanion(C, cs, dt)
    const l = indCompanion(L, ls, dt)
    v = -(c.i0 + l.i0) / (c.g + l.g)
    const iL = l.g * v + l.i0
    cs.v2 = cs.v; cs.v = v; cs.hist = (cs.hist ?? 0) + 1
    ls.i2 = ls.i; ls.i = iL; ls.hist = (ls.hist ?? 0) + 1
    if (n > 1080) peak = Math.max(peak, Math.abs(v))
    const sign = Math.sign(v)
    if (sign !== 0 && sign !== lastSign) crossings.push(n * dt)
    if (sign !== 0) lastSign = sign
  }
  assert.ok(peak > 0.9, `amplitude after 10 cycles ${peak}`)
  const period = (2 * (crossings[crossings.length - 1] - crossings[0])) / (crossings.length - 1)
  assert.ok(Math.abs(period - 1) < 0.01, `period ${period}`)
})
