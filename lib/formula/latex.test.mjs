// LaTeX → expression. Run: node lib/formula/latex.test.mjs
//
// Imports the REAL lib/formula/latex.ts (bundled with esbuild, which the repo
// already depends on via Next) so this tests the converter, not a copy.
//
// The bug being pinned: `graph.plot(E)` on a Formula card plotted nothing,
// because a card's LaTeX had no path to a number.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'latex-expr-'))
const bundle = join(dir, 'latex.mjs')
execFileSync('npx', ['esbuild', resolve(import.meta.dirname, 'latex.ts'),
  '--bundle', '--format=esm', `--outfile=${bundle}`], { stdio: 'pipe' })
const { latexToExpr } = await import(bundle)
const { create, all } = await import('mathjs')
const m = create(all, {})
rmSync(dir, { recursive: true, force: true })

const evalWith = (latex, scope) => {
  const r = latexToExpr(latex)
  assert.ok(r, `no expression for ${latex}`)
  return m.parse(r.expr).evaluate(scope)
}

test('fraction of greek symbols evaluates', () => {
  const v = evalWith('\\frac{\\sigma}{\\epsilon_0 \\epsilon_R}', { sigma: 8, epsilon_0: 2, epsilon_R: 2 })
  assert.equal(v, 2)
})

test('coefficient, abs bars and powers', () => {
  const v = evalWith('\\frac{1}{2} \\epsilon_0 |E|^2', { epsilon_0: 4, E: -3 })
  assert.equal(v, 18)
})

test('nested fractions and sqrt', () => {
  assert.equal(evalWith('\\sqrt{\\frac{\\frac{a}{b}}{c}}', { a: 8, b: 2, c: 1 }), 2)
})

test('a definition yields its name and only the right-hand side', () => {
  const r = latexToExpr('E = \\frac{V}{d}')
  assert.equal(r.name, 'E')
  assert.equal(m.parse(r.expr).evaluate({ V: 10, d: 2 }), 5)
})

test('\\ln is natural log, \\log is base 10', () => {
  assert.equal(evalWith('\\log{100}', {}), 2)
  assert.equal(Math.round(evalWith('\\ln{e}', { e: Math.E })), 1)
})

test('dressing that carries no maths is dropped', () => {
  assert.equal(evalWith('\\left( \\vec{v} \\cdot \\vec{v} \\right)', { v: 3 }), 9)
  assert.equal(evalWith('P_{\\text{out}} \\times 2', { P_out: 5 }), 10)
})

test('what has no scalar reading returns null, never a wrong number', () => {
  for (const bad of ['\\int_0^1 x\\,dx', '\\sum_{n=1}^{5} n', '', '\\frac{a}{}{', 'a = b = c'])
    assert.equal(latexToExpr(bad), null, bad)
})
