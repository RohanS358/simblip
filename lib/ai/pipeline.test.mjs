// The two-lane AI pipeline: routing, few-shot retrieval, and answer shaping.
// Run: node --test lib/ai/pipeline.test.mjs
//
// Why this exists: the old pipeline answered EVERY question in SimScript,
// which builds scenes and cannot express a derivation. Asked to derive
// Gauss's law the model emitted create("shape"); asked to convert 173.625 to
// binary it emitted decNumber.toString(2), which SimScript cannot run. The
// course's own question set (public/100_Questions_All_Subjects.md) is 44
// derivations, 37 numericals and 19 short notes — mostly not simulations.
//
// These tests pin the three decisions that fix that, using the real 100
// questions as the fixture rather than invented prompts.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-pipeline-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'pipeline.mjs')

writeFileSync(entry, `
export { classifyIntent } from '@/lib/ai/route-intent'
export { retrieveExamples, fewShotMessages } from '@/lib/ai/few-shot'
export { cleanAnswer, toAnswerBlocks, blocksToSimScript } from '@/lib/ai/explain'
export { lintSimScript } from '@/lib/ai/simscript-lint'
export { buildSamples, buildModelfile } from '@/lib/ai/simscript-corpus'
export { renderLine } from '@/lib/text/render'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@=${root}`, '--external:react'], { cwd: root, stdio: 'pipe' })

const {
  classifyIntent, retrieveExamples, fewShotMessages,
  cleanAnswer, toAnswerBlocks, blocksToSimScript, lintSimScript, buildSamples, buildModelfile,
  renderLine,
} = await import(bundle)

/** The real course questions, with their [N]/[D]/[S] type markers. */
const questions = [
  ...readFileSync(join(root, 'public/100_Questions_All_Subjects.md'), 'utf8')
    .matchAll(/^(\d+)\.\s+\*\*\[([NDS])\]\*\*\s+(.+)$/gm),
].map((m) => ({ n: +m[1], type: m[2], q: m[3] }))

test('the fixture really is the 100-question set', () => {
  assert.equal(questions.length, 100)
})

test('no derivation or numerical is routed to simulate-only', () => {
  // The failure this guards: "Design a mod-6 counter and draw its timing
  // diagram" opens with a build verb, so a naive router sent it to SimScript
  // alone and silently dropped the state table carrying most of the marks.
  const lost = questions
    .filter((x) => x.type === 'D' || x.type === 'N')
    .filter((x) => classifyIntent(x.q) === 'simulate')
  assert.deepEqual(lost.map((x) => `Q${x.n}`), [],
    'these questions would lose their worked answer entirely')
})

test('every question gets an explanation lane', () => {
  const noProse = questions.filter((x) => classifyIntent(x.q) === 'simulate')
  assert.equal(noProse.length, 0)
})

test('a pure build request still skips the essay', () => {
  for (const p of [
    'Simulate a ball bouncing on the ground',
    'Build a pendulum and plot the angle',
    'Add a note summarising the experiment',
    'Make a voltage divider with a 9V battery',
  ]) {
    assert.equal(classifyIntent(p), 'simulate', `"${p}" should build, not explain`)
  }
})

test('a written artefact forces the explain lane even after a build verb', () => {
  assert.equal(classifyIntent('Draw the truth table for a full adder'), 'both')
  assert.equal(classifyIntent('Design a mod-6 counter and draw its timing diagram'), 'both')
})

test('retrieval finds the topically closest example', () => {
  const got = retrieveExamples('Build a pendulum and plot the angle', 3)
  assert.ok(got.length > 0, 'a pendulum prompt must retrieve something')
  assert.match(got[0].prompt, /pendulum/i)
})

test('few-shot comes back as alternating user/assistant turns', () => {
  const msgs = fewShotMessages('bouncing ball on the ground', 3)
  assert.ok(msgs.length > 0 && msgs.length % 2 === 0)
  msgs.forEach((m, i) => assert.equal(m.role, i % 2 === 0 ? 'user' : 'assistant'))
  // Every retrieved script must itself be valid, or few-shot teaches errors.
  for (let i = 1; i < msgs.length; i += 2) {
    assert.equal(lintSimScript(msgs[i].content).ok, true,
      `retrieved example does not lint: ${msgs[i].content.slice(0, 60)}`)
  }
})

test('an unrelated prompt retrieves nothing rather than noise', () => {
  assert.deepEqual(retrieveExamples('qwertyuiop zxcvbnm', 4), [])
})

test('the Modelfile actually carries examples', () => {
  // It used to emit FROM + SYSTEM and nothing else, so `ollama show` reported
  // "MESSAGE lines: 0" — all 84 corpus samples were built and never used.
  const mf = buildModelfile()
  const pairs = (mf.match(/MESSAGE user/g) ?? []).length
  assert.ok(pairs >= 10, `expected baked-in examples, got ${pairs}`)
  assert.equal(pairs, (mf.match(/MESSAGE assistant/g) ?? []).length)
})

test('LaTeX delimiters are rewritten to what the notebook renders', () => {
  // Measured: one real answer came back with 25 `\(` and zero `$`. The text
  // renderer only knows `$...$` (MATH_RE, lib/text/render.ts), so untouched
  // output renders as literal backslashes.
  const out = cleanAnswer('Given \\( R = 10 \\) ohms.\n\\[ E = \\frac{\\lambda}{2\\pi} \\]')
  assert.match(out, /\$R = 10\$/)
  assert.match(out, /\$E = \\frac\{\\lambda\}\{2\\pi\}\$/)
  assert.ok(!out.includes('\\('), 'no inline LaTeX delimiters may survive')
  assert.ok(!out.includes('\\['), 'no display LaTeX delimiters may survive')
})

test('a display equation becomes its own Formula block', () => {
  const blocks = toAnswerBlocks(cleanAnswer(
    '## Step 1\nGiven the field.\n\\[ E = \\frac{\\lambda}{2 \\pi \\epsilon_0 r} \\]\n**Answer:** done'
  ))
  const kinds = blocks.map((b) => b.kind)
  assert.deepEqual(kinds, ['text', 'formula', 'text'])
  assert.match(blocks[1].content, /\\frac/)
  assert.ok(!blocks[1].content.includes('$'), 'a Formula holds bare LaTeX')
})

test('a short expression stays inline instead of becoming a card', () => {
  // A three-term step does not deserve its own boxed Formula object, or a
  // derivation renders as a stack of tiny cards.
  const blocks = toAnswerBlocks('Then $x=1$\nand we are done.')
  assert.deepEqual(blocks.map((b) => b.kind), ['text'])
})

test('every corpus sample still lints', () => {
  // few-shot serves these verbatim to the model; a broken one teaches the
  // exact mistakes the linter exists to catch.
  const bad = buildSamples()
    .map((s) => [s.prompt, lintSimScript(s.script)])
    .filter(([, r]) => !r.ok)
  assert.deepEqual(bad.map(([p, r]) => `${p}: ${r.errors[0]}`), [])
})

test('a placed answer is valid SimScript', () => {
  // Answers reach the page through executeSimScript, the same verified path a
  // hand-typed script takes — so the generated placement must itself lint.
  const blocks = toAnswerBlocks(cleanAnswer(
    '## Back EMF\nGiven \\( V = 220 \\) V.\n\\[ E_b = V - I_a R_a = 220 - 10 = 210 \\]\n**Answer:** 210 V'
  ))
  const script = blocksToSimScript(blocks)
  assert.equal(lintSimScript(script).ok, true, lintSimScript(script).errors.join('; '))
  assert.match(script, /create\("formula"/)
  assert.match(script, /create\("text"/)
})

test('quotes and backslashes in an answer survive placement', () => {
  // LaTeX is nothing but backslashes; a naive template would produce a
  // syntax error the moment an answer contained \frac or a quoted term.
  const script = blocksToSimScript([
    { kind: 'text', content: 'He said "hello" and \\ escaped.' },
    { kind: 'formula', content: '\\frac{\\lambda}{2\\pi\\epsilon_0 r}' },
  ])
  assert.equal(lintSimScript(script).ok, true, lintSimScript(script).errors.join('; '))
})

test('blocks stack down the page instead of overlapping', () => {
  const script = blocksToSimScript(toAnswerBlocks('Step one.\n\n$E = mc^2 + 1234$\n\nStep two.'))
  const ys = [...script.matchAll(/y:\s*(\d+)/g)].map((m) => +m[1])
  assert.ok(ys.length >= 2)
  for (let i = 1; i < ys.length; i++) {
    assert.ok(ys[i] > ys[i - 1], `block ${i} must sit below block ${i - 1}`)
  }
})

test('inline maths renders mid-sentence, not only when it is the whole line', () => {
  // The bug behind "the numericals are not rendering": MATH_RE was anchored
  // (/^\$...\$$/) but runs are split at MARK boundaries only, so an
  // unformatted sentence is ONE run whose full text is not an expression.
  // "permittivities $\epsilon_1$ and $\epsilon_2$" therefore rendered as
  // literal source — inline maths only ever worked when an expression
  // happened to occupy a whole run by itself.
  const html = renderLine(
    'Consider two dielectrics with permittivities $\\epsilon_1$ and $\\epsilon_2$.', [], 0)
  assert.equal((html.match(/class="katex"/g) ?? []).length, 2)
  // KaTeX keeps the source in a MathML <annotation>, so check the rendered
  // half only: no unconsumed $ delimiter may reach the page.
  assert.ok(!html.includes('$'), 'no raw $ delimiter may survive')
})

test('a bare price is still not an equation', () => {
  // The space after $ is the Obsidian disambiguation; widening the match
  // must not start eating "it costs $5 and $10".
  const html = renderLine('it costs $5 and $10 total', [], 0)
  assert.ok(!html.includes('katex'))
})

test('maths inside a mark still renders, and text is still escaped', () => {
  const html = renderLine('see $E=mc^2$ here', [{ start: 0, end: 17, kind: 'bold' }], 0)
  assert.match(html, /<strong>/)
  assert.match(html, /class="katex"/)
  assert.ok(!renderLine('a < b', [], 0).includes('<b'), 'plain text stays escaped')
})

test('an answer from the explain lane renders end to end', () => {
  // cleanAnswer -> toAnswerBlocks -> renderLine is the whole notebook path.
  const blocks = toAnswerBlocks(cleanAnswer(
    'The field \\( E_{n,1} \\) equals \\( E_{n,2} \\) at the interface.'))
  const html = renderLine(blocks[0].content, [], 0)
  assert.equal((html.match(/class="katex"/g) ?? []).length, 2)
})

test.after(() => rmSync(dir, { recursive: true, force: true }))
