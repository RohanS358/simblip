// Choosing a different local model per lane.
//
// The two lanes are separate calls that want different things. Writing
// SimScript is a coding task — the default `simblip-simscript` is a
// code-specialised base fine-tuned on the corpus. Writing a derivation is
// prose and mathematics, where a larger general model is often better and
// none of the SimScript tuning applies. One OLLAMA_MODEL forced both.
//
// The property that matters most here is that this stays INVISIBLE unless
// asked for: an unset environment must behave exactly as it did before.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')

/** Bundle generate.ts with a given env baked in. The model names are read at
 *  module scope, so each case needs its own build — which is also what makes
 *  this a real test of the fallback chain rather than of a mock. */
function load(env) {
  const dir = mkdtempSync(join(tmpdir(), 'simblip-model-lane-'))
  const entry = join(dir, 'entry.ts')
  const bundle = join(dir, 'b.mjs')
  writeFileSync(entry, `
export { ollamaGenerator, ollamaExplainGenerator, makeOllamaGenerator } from '@/lib/ai/generate'
`)
  // esbuild wants --define:K=V as a single argument. An undefined value is
  // baked in literally, which is what an unset variable must look like.
  const defines = Object.entries(env).map(
    ([k, v]) => `--define:process.env.${k}=${v === undefined ? 'undefined' : JSON.stringify(v)}`
  )
  execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
    `--alias:@=${root}`, '--external:react', ...defines], { cwd: root, stdio: 'pipe' })
  return import(bundle)
}

test('with nothing set, both lanes use the same default model', async () => {
  const m = await load({ OLLAMA_MODEL: undefined, OLLAMA_SCRIPT_MODEL: undefined, OLLAMA_EXPLAIN_MODEL: undefined })
  assert.equal(m.ollamaGenerator.name, 'ollama:simblip-simscript')
  assert.equal(m.ollamaExplainGenerator.name, 'ollama:simblip-simscript')
  // Same object, not merely an equal name: a "both" request must not warm or
  // hold two copies of one model.
  assert.equal(m.ollamaExplainGenerator, m.ollamaGenerator)
})

test('OLLAMA_MODEL alone still moves both lanes together', async () => {
  const m = await load({ OLLAMA_MODEL: 'gemma4:e4b', OLLAMA_SCRIPT_MODEL: undefined, OLLAMA_EXPLAIN_MODEL: undefined })
  assert.equal(m.ollamaGenerator.name, 'ollama:gemma4:e4b')
  assert.equal(m.ollamaExplainGenerator.name, 'ollama:gemma4:e4b')
  assert.equal(m.ollamaExplainGenerator, m.ollamaGenerator)
})

test('the explain lane can be pointed at its own model', async () => {
  const m = await load({ OLLAMA_MODEL: undefined, OLLAMA_SCRIPT_MODEL: undefined, OLLAMA_EXPLAIN_MODEL: 'gemma4:e4b' })
  assert.equal(m.ollamaGenerator.name, 'ollama:simblip-simscript', 'the script lane keeps the tuned model')
  assert.equal(m.ollamaExplainGenerator.name, 'ollama:gemma4:e4b')
  assert.notEqual(m.ollamaExplainGenerator, m.ollamaGenerator)
})

test('each lane can be set independently', async () => {
  const m = await load({ OLLAMA_MODEL: undefined, OLLAMA_SCRIPT_MODEL: 'qwen2.5-coder:7b', OLLAMA_EXPLAIN_MODEL: 'gemma4:e4b' })
  assert.equal(m.ollamaGenerator.name, 'ollama:qwen2.5-coder:7b')
  assert.equal(m.ollamaExplainGenerator.name, 'ollama:gemma4:e4b')
})

test('a per-lane override beats OLLAMA_MODEL', async () => {
  const m = await load({ OLLAMA_MODEL: 'qwen2.5:7b', OLLAMA_SCRIPT_MODEL: undefined, OLLAMA_EXPLAIN_MODEL: 'gemma4:e4b' })
  assert.equal(m.ollamaGenerator.name, 'ollama:qwen2.5:7b', 'unset lane falls back to OLLAMA_MODEL')
  assert.equal(m.ollamaExplainGenerator.name, 'ollama:gemma4:e4b')
})

test('the factory binds the model it was given', async () => {
  const m = await load({})
  assert.equal(m.makeOllamaGenerator('anything:1b').name, 'ollama:anything:1b')
})
