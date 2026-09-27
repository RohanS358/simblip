// Closed-form checks for the waves and quantum engines — each assertion is a
// textbook identity the rendered figures depend on.
//
// Run: node --test lib/waves/waves-quantum.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-wq-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'wq.mjs')
writeFileSync(entry, `export * as W from '@/lib/waves/engine'\nexport * as Q from '@/lib/quantum/engine'\n`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`, `--alias:@=${root}`], { cwd: root, stdio: 'pipe' })
const { W, Q } = await import(bundle)
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol

test('standing-wave envelope: first maximum sits at d = θλ/4π for an inductive load', () => {
  const gamma = W.lineReflectionCoefficient(50, W.C(50, 50)) // Γ = 0.447∠63.4°
  const theta = W.cArg(gamma)
  const env = W.voltageEnvelope(gamma, Math.PI, 2001)
  const iMax = env.indexOf(Math.max(...env))
  const bdMax = (iMax / 2000) * Math.PI
  assert.ok(near(bdMax, theta / 2, 2e-3), `max at βd=${bdMax}, expected ${theta / 2}`)
  assert.ok(near(Math.max(...env), 1 + W.cAbs(gamma), 1e-6))
})

test('line voltage: the envelope of the instantaneous wave is |V(d)|', () => {
  const gamma = W.C(0.3, -0.4)
  const bd = 0.7
  let peak = 0
  for (let i = 0; i < 3600; i++) peak = Math.max(peak, Math.abs(W.lineVoltage(gamma, bd, (i / 3600) * 2 * Math.PI)))
  const env = Math.sqrt(1 + 0.25 + 2 * 0.5 * Math.cos(2 * bd - W.cArg(gamma)))
  assert.ok(near(peak, env, 1e-4))
})

test('boundary: tangential E continuous at x = 0 (τ = 1 + Γ)', () => {
  const m1 = { epsr: 1, mur: 1, sigma: 0 }
  const m2 = { epsr: 4, mur: 1, sigma: 0.3 }
  const e1 = W.intrinsicImpedance(1, m1)
  const e2 = W.intrinsicImpedance(1, m2)
  const g = W.reflectionCoefficient(e1, e2)
  const tau = W.transmissionCoefficient(e1, e2)
  const p1 = W.propagationConstant(1, m1)
  const p2 = W.propagationConstant(1, m2)
  for (const wt of [0, 0.9, 2.3, 4]) {
    const left = W.boundaryField(-1e-9, wt, g, tau, p1.beta, p2.alpha, p2.beta)
    const right = W.boundaryField(0, wt, g, tau, p1.beta, p2.alpha, p2.beta)
    assert.ok(near(left, right, 1e-6), `${left} vs ${right}`)
  }
  // air → εr = 4 lossless: Γ = −1/3
  const g0 = W.reflectionCoefficient(e1, W.intrinsicImpedance(1, { epsr: 4, mur: 1, sigma: 0 }))
  assert.ok(near(g0.re, -1 / 3) && near(g0.im, 0))
})

test('barrier: exact ψ gives the closed-form T, conserves |r|²+|t|², is continuous', () => {
  for (const [E, V0, L] of [[0.5, 1, 1], [2, 1, 1.5], [1, 1, 0.8], [0.2, 3, 0.5]]) {
    const s = Q.solveBarrier(E, V0, L)
    const T = W.cAbs(s.t) ** 2
    const R = W.cAbs(s.r) ** 2
    assert.ok(near(T, Q.transmissionCoefficient(E, V0, L), 1e-5), `T ${T} vs ${Q.transmissionCoefficient(E, V0, L)}`)
    assert.ok(near(T + R, 1, 1e-6), `R+T=${T + R}`)
    for (const x of [0, L]) {
      const a = s.psi(x - 1e-7)
      const b = s.psi(x + 1e-7)
      assert.ok(near(a.re, b.re, 1e-4) && near(a.im, b.im, 1e-4), `ψ jumps at x=${x}`)
    }
  }
})

test('well superposition: sloshes with period 2π/(E2−E1) and stays normalized', () => {
  const L = 1
  const period = (2 * Math.PI) / (Q.energyLevel(2, L) - Q.energyLevel(1, L))
  const norm = (t) => {
    let s = 0
    for (let i = 0; i < 2000; i++) s += Q.superpositionDensity(1, 2, L, ((i + 0.5) / 2000) * L, t) * (L / 2000)
    return s
  }
  assert.ok(near(norm(0), 1, 1e-4) && near(norm(0.37), 1, 1e-4))
  const x = 0.25
  assert.ok(near(Q.superpositionDensity(1, 2, L, x, 0), Q.superpositionDensity(1, 2, L, x, period), 1e-9))
  assert.ok(!near(Q.superpositionDensity(1, 2, L, x, 0), Q.superpositionDensity(1, 2, L, x, period / 2), 1e-3))
})
