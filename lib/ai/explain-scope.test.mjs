// What the explain lane is allowed to answer WITH.
//
// Asked "create me slides along with simulation for simple pendulum", the
// written answer came back containing a Python script — numpy, matplotlib,
// scipy.integrate.solve_ivp — as "Slide 4: Simulation of Simple Pendulum".
//
// That is wrong twice over. The student cannot run Python here, and they do
// not need to: SIMBLIP *is* the simulator, and the very same turn already
// built a correct pendulum scene in the SimScript lane (hinge + mass + rod,
// with bob.swing plotted). The answer was teaching a workaround for a
// problem the product does not have.
//
// EXPLAIN_SYSTEM_PROMPT never mentioned that a simulator exists, so the
// model had no way to know. These tests pin the prompt's scope rather than
// the model's output: a prompt is the only lever here (there is no repair
// loop on prose — nothing about a derivation is statically checkable).

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-explain-scope-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'b.mjs')

writeFileSync(entry, `
export { EXPLAIN_SYSTEM_PROMPT } from '@/lib/ai/explain'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@=${root}`, '--external:react'], { cwd: root, stdio: 'pipe' })

const { EXPLAIN_SYSTEM_PROMPT } = await import(bundle)

test('the prompt tells the model it is inside a simulator', () => {
  // Without this the model answers "and simulation" with a Python script,
  // because as far as it knows there is nothing else to answer with.
  assert.match(EXPLAIN_SYSTEM_PROMPT, /simulat/i,
    'the answer lane never learns that the canvas can simulate')
})

test('the prompt forbids answering with runnable foreign code', () => {
  // The specific libraries the real failure reached for.
  const p = EXPLAIN_SYSTEM_PROMPT.toLowerCase()
  assert.ok(p.includes('python'), 'Python is the language it actually reached for; name it')
  assert.ok(/matplotlib|numpy|scipy/.test(p), 'name the plotting/solver libraries too')
})

test('the prompt points the simulation half at the canvas, not at the prose', () => {
  // The two lanes run on the SAME turn for a "both" question, so the written
  // half must defer to the scene rather than duplicate it badly.
  assert.match(EXPLAIN_SYSTEM_PROMPT, /canvas|scene|alongside|beside/i)
})

test.after(() => rmSync(dir, { recursive: true, force: true }))
