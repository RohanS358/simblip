// Does the generated scene actually WORK?
//
// A script can pass every static check — valid kinds, valid params, no syntax
// errors — and still produce a scene that does nothing. The classic failure:
// a spring whose endpoint sits a few pixels off the mass binds to nothing, so
// Play drops both under gravity and the "pendulum" is two objects falling.
// simscript-lint.ts cannot see this — it reads text, and the fault is
// geometric.
//
// These tests use the real verifier over hand-built scenes whose correctness
// is known independently, including numbers checked against textbook physics.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-verify-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'b.mjs')
writeFileSync(entry, `export { verifyScene } from '@/lib/scene/verify-scene'\n`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@=${root}`, '--external:react'], { cwd: root, stdio: 'pipe' })
const { verifyScene } = await import(bundle)

const mk = (id, kind, o = {}) => ({
  id,
  name: o.name ?? id,
  geometry: { kind, ...(o.points ? { points: o.points } : {}), ...(o.symbol ? { symbol: o.symbol } : {}) },
  position: o.pos ?? { x: 0, y: 0 },
  size: o.size ?? { w: 60, h: 60 },
  rotation: 0,
  z: 1,
  behaviors: (o.behaviors ?? []).map((t, i) => ({ id: `b${i}`, type: t, enabled: true, params: {} })),
  parameters: Object.fromEntries(
    Object.entries(o.params ?? {}).map(([k, v]) => [k, { kind: 'number', expr: String(v), value: v }])
  ),
  metadata: {},
})

// ── The failure that matters ────────────────────────────────────────────────

test('a connector attached to nothing is an error, not a pass', () => {
  // The endpoints are far from both bodies: buildWorld's point query finds
  // nothing there, so this scene renders correctly and does nothing on Play.
  const scene = [
    mk('hinge', 'circle', { pos: { x: 300, y: 80 }, size: { w: 20, h: 20 }, behaviors: ['hinge', 'staticBody'] }),
    mk('bob', 'circle', { pos: { x: 300, y: 320 }, behaviors: ['rigidBody'] }),
    mk('spr', 'line', { pos: { x: 0, y: 0 }, points: [[0, 0], [220, 0]], size: { w: 220, h: 2 }, behaviors: ['spring'], name: 'spring' }),
  ]
  const r = verifyScene(scene)
  assert.equal(r.ok, false)
  assert.match(r.issues[0].message, /not attached/i)
  assert.match(r.issues[0].message, /nothing will move/i, 'the message must say what the user will SEE')
})

test('a connector attached at only one end is still an error', () => {
  const scene = [
    mk('anchor', 'circle', { pos: { x: 100, y: 100 }, size: { w: 20, h: 20 }, behaviors: ['staticBody'] }),
    mk('bob', 'circle', { pos: { x: 900, y: 900 }, behaviors: ['rigidBody'] }),
    mk('rod', 'line', { pos: { x: 105, y: 105 }, points: [[0, 0], [50, 50]], size: { w: 50, h: 50 }, behaviors: ['rod'], name: 'rod' }),
  ]
  const r = verifyScene(scene)
  assert.equal(r.ok, false)
  assert.match(r.issues[0].message, /its end|both ends/i)
})

test('a correctly bound pendulum passes', () => {
  const scene = [
    mk('hinge', 'circle', { pos: { x: 300, y: 80 }, size: { w: 20, h: 20 }, behaviors: ['hinge', 'staticBody'] }),
    mk('bob', 'circle', { pos: { x: 290, y: 320 }, behaviors: ['rigidBody'] }),
    mk('rod', 'line', { pos: { x: 310, y: 90 }, points: [[0, 0], [10, 240]], size: { w: 10, h: 240 }, behaviors: ['rod'], name: 'rod' }),
  ]
  const r = verifyScene(scene)
  assert.equal(r.ok, true, r.issues.map((i) => i.message).join('; '))
})

test('a body with nothing to rest on or hang from is flagged', () => {
  const r = verifyScene([mk('b', 'circle', { behaviors: ['rigidBody'] })])
  assert.match(r.issues[0].message, /anchors|falls off-screen/i)
  // A warning, not an error: free fall IS sometimes the question.
  assert.equal(r.issues[0].level, 'warning')
  assert.equal(r.ok, true)
})

// ── Checked against theory ──────────────────────────────────────────────────

test('RLC resonance is computed from the real component values', () => {
  // f0 = 1/(2π√(LC)) with L=0.1 H, C=100 µF → 50.33 Hz. Verified by hand.
  const scene = [
    mk('r', 'symbol', { symbol: 'resistor', params: { R: 10 } }),
    mk('l', 'symbol', { symbol: 'inductor', params: { L: 0.1 } }),
    mk('c', 'symbol', { symbol: 'capacitor', params: { C: 100e-6 } }),
  ]
  const check = verifyScene(scene).checks.find((c) => /resonant/i.test(c.name))
  assert.ok(check, 'no resonance check was produced')
  assert.ok(Math.abs(check.expected - 50.33) < 0.05, `got ${check.expected}`)
})

test('the damping regime is reported as a finding, not as a failed check', () => {
  // α = R/2L = 50, ω₀ = 1/√(LC) = 316.2 → underdamped. These are SUPPOSED to
  // differ, so running them through the tolerance would flag every correct
  // circuit as a mismatch.
  const scene = [
    mk('r', 'symbol', { symbol: 'resistor', params: { R: 10 } }),
    mk('l', 'symbol', { symbol: 'inductor', params: { L: 0.1 } }),
    mk('c', 'symbol', { symbol: 'capacitor', params: { C: 100e-6 } }),
  ]
  const r = verifyScene(scene)
  assert.ok(r.findings.some((f) => /underdamped/i.test(f)), JSON.stringify(r.findings))
  assert.ok(r.checks.every((c) => c.ok), 'a correct circuit must not report a failed check')
})

test('a pendulum period matches T = 2π√(L/g)', () => {
  // 240px ≈ 0.24 m at PPM=1000 → T = 2π√(0.24/9.81) ≈ 0.983 s.
  const scene = [
    mk('hinge', 'circle', { pos: { x: 300, y: 80 }, size: { w: 20, h: 20 }, behaviors: ['hinge', 'staticBody'] }),
    mk('bob', 'circle', { pos: { x: 290, y: 320 }, behaviors: ['rigidBody'] }),
    mk('rod', 'line', { pos: { x: 310, y: 90 }, points: [[0, 0], [0, 240]], size: { w: 2, h: 240 }, behaviors: ['rod'], name: 'rod' }),
  ]
  const c = verifyScene(scene).checks.find((x) => /period/i.test(x.name))
  assert.ok(c, 'no period check')
  assert.ok(Math.abs(c.expected - 0.983) < 0.01, `got ${c.expected}`)
})

test('a voltage divider output is computed from the real values', () => {
  // 12 V across 1k and 2k → 8 V.
  const scene = [
    mk('bat', 'symbol', { symbol: 'battery', params: { V: 12 } }),
    mk('r1', 'symbol', { symbol: 'resistor', params: { R: 1000 } }),
    mk('r2', 'symbol', { symbol: 'resistor', params: { R: 2000 } }),
  ]
  const c = verifyScene(scene).checks.find((x) => /divider/i.test(x.name))
  assert.ok(c)
  assert.ok(Math.abs(c.expected - 8) < 0.01, `got ${c.expected}`)
})

// ── Not over-reaching ───────────────────────────────────────────────────────

test('an empty or non-physical scene produces no complaints', () => {
  assert.deepEqual(verifyScene([]).issues, [])
  const notes = [mk('n', 'note'), mk('t', 'text')]
  assert.deepEqual(verifyScene(notes).issues, [])
})

test('a scene with no recognised pattern yields no theory checks', () => {
  // A wrong "expected" would be worse than no check, so unknown shapes must
  // produce nothing rather than a guess.
  const scene = [mk('a', 'symbol', { symbol: 'resistor', params: { R: 10 } })]
  assert.deepEqual(verifyScene(scene).checks, [])
})

test('only the objects just created are blamed', () => {
  // A pre-existing dangling connector must not fail the script that ran now.
  const preexisting = mk('old', 'line', { points: [[0, 0], [100, 0]], size: { w: 100, h: 2 }, behaviors: ['spring'], name: 'old spring' })
  const fresh = mk('n', 'note')
  const r = verifyScene([preexisting, fresh], ['n'])
  assert.equal(r.ok, true, 'the new object is fine; the old mess is not its fault')
})
