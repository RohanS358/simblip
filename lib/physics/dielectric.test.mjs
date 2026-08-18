// Electrostatics of a dielectric region — ENEX 254 §2.7 (energy density) and
// §2.9 (relative permittivity), the heaviest chapter in the EM syllabus.
//
// Why this exists: SimScript could NAME properties the engine never modelled.
// `addproperty(slab, "efield", { epsr: 4, sigma: 1 })` linted clean, stored
// both keys, and the solver read neither — a question about a dielectric
// produced a scene with no dielectric, reported as success. Two things are
// pinned here: the physics is real SI (a numerical answer must be correct to
// the digit), and inventing a param is now a lint ERROR rather than a silent
// no-op.
//
// Run: node --test lib/physics/dielectric.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-dielectric-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'd.mjs')

writeFileSync(entry, `
export { dielectricValues } from '@/lib/physics/world'
export { lintSimScript } from '@/lib/ai/simscript-lint'
export { BEHAVIOR_SPECS } from '@/lib/behaviors/registry'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@=${root}`], { cwd: root, stdio: 'pipe' })

const { dielectricValues, lintSimScript, BEHAVIOR_SPECS } = await import(bundle)

const EPS0 = 8.8541878128e-12
/** Agreement to ~10 significant figures — a marked numerical answer. */
const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= Math.abs(b) * 1e-9, `${msg}: got ${a}, want ${b}`)

test('Q8: E and energy density between charged plates in a dielectric', () => {
  // "Two infinite parallel plates carrying +sigma and -sigma separated by a
  // dielectric of relative permittivity 4. Find E and the energy density."
  const r = dielectricValues(1, 4, 0.001) // sigma = 1 uC/m^2, er = 4, d = 1 mm
  close(r.E, 1e-6 / (4 * EPS0), 'E = sigma/(eps0 epsr)')
  close(r.u, 0.5 * 4 * EPS0 * r.E ** 2, 'u = 1/2 eps E^2')
  // Sanity against the hand-worked figures, so a refactor that keeps the
  // formulas self-consistent but wrong still fails.
  assert.equal(r.E.toExponential(3), '2.824e+4')
  assert.equal(r.u.toExponential(3), '1.412e-2')
})

test('D depends on the free charge only, never on the medium', () => {
  // The distinction between D and E is the entire point of section 2.9.
  for (const epsr of [1, 4, 80]) {
    close(dielectricValues(2.5, epsr, 0.001).D, 2.5e-6, `D at epsr=${epsr}`)
  }
})

test('inserting a dielectric weakens E by exactly epsr', () => {
  const vac = dielectricValues(1, 1, 0.001)
  const die = dielectricValues(1, 4, 0.001)
  close(vac.E / die.E, 4, 'E ratio')
})

test('capacitance per unit area follows eps/d', () => {
  const r = dielectricValues(1, 4, 0.002)
  close(r.capPerArea, (4 * EPS0) / 0.002, 'C/A')
  // A zero gap is a divide-by-zero, not an infinity to propagate into a plot.
  assert.equal(dielectricValues(1, 4, 0).capPerArea, 0)
})

test('a param the behavior does not have is a lint error, not a silent drop', () => {
  // The original bug, verbatim: this used to return ok:true and model nothing.
  const r = lintSimScript(
    'var s = create("rect", { x: 0, y: 0, width: 300, height: 200 });\n' +
    'addproperty(s, "efield", { epsr: 4, sigma: 1 });'
  )
  assert.equal(r.ok, false)
  assert.match(r.errors.join(' '), /has no "epsr" param/)
  // The message must name the real params, or the repair round is a guess.
  assert.match(r.errors.join(' '), /Ex, Ey/)
})

test('the dielectric behavior carries the syllabus parameters', () => {
  const spec = BEHAVIOR_SPECS.find((b) => b.type === 'dielectric')
  assert.ok(spec, 'dielectric must be registered')
  assert.deepEqual(spec.params.map((p) => p.name).sort(), ['epsr', 'mur', 'sigma'])
  assert.equal(spec.live, true, 'a registered-but-dead behavior is the bug this fixes')
})

test('a correct dielectric scene lints, and its channels are plottable', () => {
  const ok = lintSimScript(
    'var slab = create("dielectric", { x: 200, y: 180, width: 360, height: 200, epsr: 4, sigma: 1 });\n' +
    'graph.plot(slab.E);'
  )
  assert.equal(ok.ok, true, ok.errors.join('; '))
  const bad = lintSimScript('var slab = create("dielectric", { epsr: 4 });\ngraph.plot(slab.velocity);')
  assert.equal(bad.ok, false)
  assert.match(bad.errors.join(' '), /no channel "velocity"/)
})

test.after(() => rmSync(dir, { recursive: true, force: true }))
