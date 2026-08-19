// Reaching the specialist labs at all — the DSA Lab and the cash-flow card —
// and giving the model input for them that actually runs.
//
// Both had the SAME pair of faults, found the same way: the engine is real,
// the router could not reach it, and the corpus taught an empty example.
//
// Why this exists: the lab (lib/dsa/) is a full C++ interpreter — vector,
// stack, queue, map, set, structs, pointers, recursion — but the AI could
// not get a student to it. Two independent faults:
//
//   1. route-intent.ts had ZERO algorithm vocabulary. SIMULATE_RE covered
//      mechanics, circuits, digital, optics and fields, so every DSA prompt
//      fell through to the 'explain' default and came back as prose with no
//      lab on the canvas. Measured before the fix: 8 of 12 DSA prompts routed
//      to explain, including "open a DSA lab with merge sort" — a prompt that
//      names the product feature outright. The 4 that worked did so by
//      accident, matching 'simulate'/'build'/'step', never anything DSA.
//   2. The corpus taught the lab with ONE raw-array bubble sort and a single
//      prompt line, `dsa(source: C++ code)`. Nothing told the model the STL
//      works, so it had every reason to write C-style arrays forever.
//
// The second half of this file is the part that matters most: a few-shot is
// only worth having if the interpreter can RUN it. Every DSA sample in the
// corpus is executed here and must both survive and print something — a
// sample that silently errors teaches the model to emit broken C++.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-lab-intent-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'b.mjs')

writeFileSync(entry, `
export { classifyIntent } from '@/lib/ai/route-intent'
export { buildSamples, SIMSCRIPT_SYSTEM_PROMPT } from '@/lib/ai/simscript-corpus'
export { runCpp } from '@/lib/dsa/interpreter'
export { readSpec, metrics } from '@/lib/econ/engine'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@=${root}`, '--external:react'], { cwd: root, stdio: 'pipe' })

const { classifyIntent, buildSamples, SIMSCRIPT_SYSTEM_PROMPT, runCpp, readSpec, metrics } =
  await import(bundle)

// ── 1. Routing ──────────────────────────────────────────────────────────────

// Every one of these routed to 'explain' before the fix unless marked.
const DSA_PROMPTS = [
  'Visualize bubble sort on an array of 6 elements',
  'Open a DSA lab with merge sort',
  'Demonstrate a linked list traversal',
  'Show how a queue works with enqueue and dequeue',
  'Visualize Dijkstra shortest path',
  'Trace recursion for fibonacci',
  'Show a hash map / unordered_map in action',
  'Sort an array using selection sort and show each swap',
  'Insert into a binary search tree',
  'Run a depth-first search over a graph',
  'Show me a stack overflow with deep recursion',
  'Walk through quicksort partitioning',
]

test('a DSA prompt reaches the canvas, not the prose lane', () => {
  for (const p of DSA_PROMPTS) {
    const got = classifyIntent(p)
    assert.notEqual(got, 'explain',
      `"${p}" routed to explain — the DSA Lab is never created, so the answer is prose about an algorithm the engine could have animated`)
  }
})

test('an algorithm question that also asks for exposition gets both lanes', () => {
  // The derivation-shaped case: the student wants the explanation AND the
  // running lab beside it. Same 'both' bias the router already applies to
  // "derive the torque equation of a DC motor".
  assert.equal(classifyIntent('Explain quicksort with a visualization'), 'both')
})

test('the DSA words do not hijack non-algorithm prompts', () => {
  // 'map', 'search', 'array' and 'stack' are common English. Each of these
  // must keep its pre-existing lane.
  for (const p of [
    'Make me slides on thermodynamics',
    'Make me notes on the states of matter',
    'Define entropy and discuss its significance',
    'What is the photoelectric effect',
  ]) {
    assert.equal(classifyIntent(p), 'explain', `"${p}" should stay in the prose lane`)
  }
  assert.equal(classifyIntent('Simulate a bouncing ball'), 'simulate')
})

// ── 2. The prompt teaches the real interpreter ──────────────────────────────

test('the system prompt names the containers the interpreter supports', () => {
  // Without these the model writes C-style arrays for everything, because the
  // only worked example it had used one.
  for (const c of ['vector', 'stack', 'queue', 'map', 'unordered_map', 'set', 'recursion']) {
    assert.ok(SIMSCRIPT_SYSTEM_PROMPT.includes(c),
      `the prompt never mentions ${c}, so the model has no reason to believe it runs`)
  }
})

// ── 3. Every taught sample actually runs ────────────────────────────────────

const dsaSamples = buildSamples().filter((s) => s.script.includes('create("dsa"'))

test('the corpus teaches the DSA Lab with more than one example', () => {
  assert.ok(dsaSamples.length >= 5,
    `only ${dsaSamples.length} DSA sample(s) — one bubble sort is what made every generated lab look the same`)
})

test('every DSA sample compiles, runs, and prints something', () => {
  for (const s of dsaSamples) {
    const m = s.script.match(/source:\s*"((?:[^"\\]|\\.)*)"/)
    assert.ok(m, `no source string in the sample for: ${s.prompt}`)
    // The corpus stores C++ as a JS string literal; unescape it the same way
    // the transpiler does before handing it to the lab.
    const cpp = JSON.parse('"' + m[1] + '"')

    const trace = runCpp(cpp)
    assert.equal(trace.error, undefined,
      `"${s.prompt}" fails in the interpreter (${trace.error}) — teaching the model C++ that does not run`)

    // `output` is cumulative per step, so the last step holds everything the
    // program ever printed. A silent run means the student watches nothing.
    const out = (trace.steps[trace.steps.length - 1]?.output ?? '').trim()
    assert.ok(out.length > 0, `"${s.prompt}" produced no console output`)
  }
})

test('the samples cover the STL, not just raw arrays', () => {
  const all = dsaSamples.map((s) => s.script).join('\n')
  for (const c of ['vector<', 'stack<', 'queue<', 'unordered_map<', 'struct ']) {
    assert.ok(all.includes(c), `no sample demonstrates ${c}`)
  }
})

// ── 4. Engineering economics reaches the cashflow card ──────────────────────
//
// Identical pair of faults to the DSA Lab. The card draws the timeline AND
// computes PW/FW/AW/IRR/BC live from a structured spec (lib/econ/engine.ts),
// but SIMULATE_RE had no economics vocabulary, so 7 of the 9 prompts below
// routed to explain. Worse, BOTH corpus samples built the card EMPTY —
// `create("cashflow", {})` — so even a lucky route produced a blank timeline
// and left the student re-entering numbers the question had already given.

test('an engineering-economics prompt reaches the cashflow card', () => {
  for (const p of [
    'Find the NPV of a project at 10% MARR',
    'Compute the IRR for this investment',
    'Show a cash flow diagram with salvage value',
    'Engineering economics: present worth analysis of two alternatives',
    'What is the payback period for a machine costing 50000',
    'Annual worth of an asset with 8% interest',
    'Benefit cost ratio analysis',
    'Draw a cash flow diagram for a 10000 investment returning 3000 a year',
  ]) {
    assert.notEqual(classifyIntent(p), 'explain',
      `"${p}" routed to explain — the card that solves it is never created`)
  }
})

test('the system prompt documents the real spec shape', () => {
  for (const k of ['marr', 'discrete', 'annuities', 'salvage', 'periods']) {
    assert.ok(SIMSCRIPT_SYSTEM_PROMPT.includes(k),
      `the prompt never mentions spec.${k}, so the model cannot populate the card`)
  }
})

const cashSamples = buildSamples().filter((s) => s.script.includes('create("cashflow"'))

test('no sample builds an empty cashflow card', () => {
  assert.ok(cashSamples.length >= 5, `only ${cashSamples.length} cashflow sample(s)`)
  for (const s of cashSamples) {
    assert.ok(s.script.includes('spec:'),
      `"${s.prompt}" creates the card with no spec — a blank timeline is not an answer`)
  }
})

test('every cashflow spec parses and solves to sane economics', () => {
  for (const s of cashSamples) {
    const m = s.script.match(/spec:\s*(\{[\s\S]*?\})\s*\}\s*\)/)
    assert.ok(m, `could not read a spec out of: ${s.prompt}`)
    // The corpus stores a JS object literal, which is what create() receives.
    const spec = readSpec(JSON.stringify(eval('(' + m[1] + ')')))

    assert.ok(spec.marr > 0, `${s.prompt}: MARR must be a positive percent`)
    assert.ok(spec.discrete.length > 0 || spec.annuities.length > 0,
      `${s.prompt}: a card with no flows draws nothing`)
    // Every worked example starts with money going OUT — an investment with
    // no initial outlay has no rate of return to find.
    assert.ok(spec.discrete.some((d) => d.amount < 0),
      `${s.prompt}: no initial investment (a negative discrete flow)`)

    const r = metrics(spec)
    for (const [k, v] of Object.entries({ pw: r.pw, fw: r.fw, aw: r.aw, cr: r.cr })) {
      assert.ok(Number.isFinite(v), `${s.prompt}: ${k} came out ${v}`)
    }
    assert.ok(r.n >= 1, `${s.prompt}: horizon collapsed to ${r.n}`)
  }
})
