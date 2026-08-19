// The numbers in an answer being true.
//
// Measured on five course numericals with independently verified answers,
// the local 7B got the PHYSICS right and the ARITHMETIC wrong: H = 8.73 A/m
// against a true 5.69, and 100 A/m for the same question on a re-run. At
// temperature 0.2 the same prompt yields different digits each time, so no
// prompt fixes it — the model is predicting digits rather than computing
// them. checkArithmetic() recomputes each completed substitution with the
// notebook's own mathjs evaluator.
//
// The dangerous direction here is a FALSE correction: rewriting work that
// was right corrupts a correct answer. Most of these tests therefore pin
// what must be left ALONE.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-arithmetic-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'b.mjs')
writeFileSync(entry, `export { checkArithmetic } from '@/lib/ai/arithmetic'\n`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@=${root}`, '--external:react'], { cwd: root, stdio: 'pipe' })
const { checkArithmetic } = await import(bundle)

const fix = (md) => checkArithmetic(md).fixes
const out = (md) => checkArithmetic(md).markdown

// ── Catching the real failures ──────────────────────────────────────────────

test('the measured H-field error is corrected', () => {
  // The exact line the model produced. Truth: 5.69 A/m.
  const md = '$H = \\frac{10 \\times 0.0025}{2 \\times (0.0169)^{1.5}} = 8.73$ A/m'
  const f = fix(md)
  assert.equal(f.length, 1)
  assert.equal(f[0].claimed, 8.73)
  assert.ok(Math.abs(f[0].actual - 5.6896) < 0.001, `got ${f[0].actual}`)
  assert.match(out(md), /5\.69/)
})

test('a plain division error is corrected', () => {
  const f = fix('$|\\Gamma| = \\frac{35.36}{127.48} = 0.31$')
  assert.equal(f.length, 1)
  assert.ok(Math.abs(f[0].actual - 0.2774) < 0.001)
})

test('several wrong lines in one answer are all corrected', () => {
  const md = [
    '$\\alpha = \\frac{10}{2 \\times 0.1} = 45$',
    '$|\\Gamma| = \\frac{35.36}{127.48} = 0.31$',
  ].join('\n\n')
  assert.equal(fix(md).length, 2)
})

test('the corrected value replaces only the number, keeping the unit', () => {
  const r = out('$H = \\frac{10 \\times 0.0025}{2 \\times (0.0169)^{1.5}} = 8.73$ A/m')
  assert.match(r, /A\/m/, 'the unit must survive')
  assert.doesNotMatch(r, /8\.73/, 'the wrong number must be gone')
})

// ── Leaving correct work alone (the expensive direction to get wrong) ───────

test('correct arithmetic is never touched', () => {
  for (const md of [
    '$E_b = 250 - 23 \\times 0.5 = 238.5$ V',
    '$I_f = 250/125 = 2$ A',
    '$\\alpha = \\frac{10}{2 \\times 0.1} = 50$',
    '$w_0 = 1/sqrt(0.1 \\times 100e-6) = 316.23$',
  ]) {
    assert.deepEqual(fix(md), [], `wrongly corrected: ${md}`)
    assert.equal(out(md), md)
  }
})

test('rounding is not treated as an error', () => {
  // A student writing 3.33 for 10/3 has not made a mistake.
  assert.deepEqual(fix('x = 10/3 = 3.33'), [])
  assert.deepEqual(fix('x = 2/3 = 0.667'), [])
  assert.deepEqual(fix('$H = \\frac{10 \\times 0.0025}{2 \\times (0.0169)^{1.5}} = 5.69$'), [])
})

test('a symbolic step is left alone', () => {
  // Correct as written, and there is nothing to compute.
  for (const md of ['$E_b = V - I_a R_a$', '$F = ma$', '$\\tau = \\frac{L}{R}$']) {
    assert.deepEqual(fix(md), [])
  }
})

test('an unresolved symbol is never guessed at', () => {
  // "m*a = 20" cannot be checked: m and a are unknown here. Substituting a
  // value for them would be inventing the answer.
  assert.deepEqual(fix('F = m*a = 20 N'), [])
  assert.deepEqual(fix('$V = I \\times R = 12$ V'), [])
})

test('prose and headings pass through untouched', () => {
  const md = '## Given\n\nThe response is underdamped.\n\n- Supply voltage, $V = 250$ V'
  assert.deepEqual(fix(md), [])
  assert.equal(out(md), md)
})

test('a stated given is not arithmetic', () => {
  // "$R_a = 0.5$ Ω" has no operator — nothing was computed, so nothing can
  // be wrong.
  assert.deepEqual(fix('- Armature resistance, $R_a = 0.5$ Ω'), [])
  assert.deepEqual(fix('- Current, $I = 25$ A'), [])
})

test('division by zero and other non-finite results are skipped', () => {
  assert.deepEqual(fix('x = 5/0 = 999'), [])
})

// ── Shape of the output ─────────────────────────────────────────────────────

test('a chain checks its final arithmetic step', () => {
  // "E = V - I*R = 250 - 12.5 = 200" — the last step is the wrong one.
  const f = fix('$E_b = 250 - 12.5 = 200$')
  assert.equal(f.length, 1)
  assert.equal(f[0].actual, 237.5)
})

test('the correction keeps the precision the model used', () => {
  const r = out('$x = \\frac{35.36}{127.48} = 0.31$')
  assert.match(r, /0\.2774|0\.28/, `unexpected formatting: ${r}`)
})

test('line count is preserved', () => {
  const md = 'a\n\n$x = 1+1 = 3$\n\nb'
  assert.equal(out(md).split('\n').length, md.split('\n').length)
})
