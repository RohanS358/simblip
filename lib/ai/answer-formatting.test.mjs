// Formatting bugs in how an AI answer lands on the canvas — found by driving
// the real app in a browser on a genuine "derive the energy density between
// charged plates in a dielectric" question and measuring the rendered DOM,
// not by inspection.
//
// 1. Ordered-list renumbering: a derivation's steps are routinely broken up
//    by an unindented explanation paragraph between items ("1. **Step**" /
//    body text / "2. **Step**" / body text / ...) — every real model output
//    tested wrote it this way. renderMarkdown() (lib/text/render.ts) treats
//    each interruption as the end of one <ol> and the start of a new one,
//    and a fresh <ol> always counts from 1 unless told otherwise — so
//    "1,2,3,4,5" rendered as "1,1,1,1,1" in the browser. Fix: carry the
//    source line's own digit into <ol start="N">.
//
// 2. Formula card height: blocksToSimScript()'s formulaHeight() estimate
//    (lib/ai/explain.ts) is the ONLY way to size a Formula object before it
//    exists — KaTeX hasn't typeset it yet. Measured against real
//    .katex-display heights in the browser (a bare \frac renders 38-47px,
//    nested \frac still only ~50px — KaTeX does not stack height per
//    nested tall element), the old per-occurrence multiplier estimated
//    78-94px: 1.6-2x too generous, leaving a card that visibly loomed over
//    text blocks half its height right above and below it.
//
// Run: node --test lib/ai/answer-formatting.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-answer-fmt-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'b.mjs')

writeFileSync(entry, `
export { renderMarkdown } from '@/lib/text/render'
export { toAnswerBlocks, blocksToSimScript } from '@/lib/ai/explain'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@=${root}`], { cwd: root, stdio: 'pipe' })

const { renderMarkdown, toAnswerBlocks, blocksToSimScript } = await import(bundle)

const olStarts = (html) => [...html.matchAll(/<ol(?:\s+start="(\d+)")?>/g)].map((m) => (m[1] ? Number(m[1]) : 1))

test('a derivation whose steps are split by body paragraphs still numbers 1,2,3', () => {
  const md = [
    '1. **Electric Field Between Plates:**',
    'The electric field between two plates is given by:',
    '',
    '2. **Energy Density in an Electrostatic Field:**',
    'The energy density is given by:',
    '',
    '3. **Result:**',
    'Substituting gives the final expression.',
  ].join('\n')
  const html = renderMarkdown(md, [])
  assert.deepEqual(olStarts(html), [1, 2, 3], html)
})

test('a single unbroken list still starts at 1 with no start attribute', () => {
  const html = renderMarkdown('1. First\n2. Second\n3. Third', [])
  assert.ok(!html.includes('start='), 'an unbroken list should not need start=')
  assert.deepEqual(olStarts(html), [1])
})

test('a list that genuinely starts mid-count (user-authored) is respected', () => {
  const html = renderMarkdown('5. Fifth item', [])
  assert.deepEqual(olStarts(html), [5])
})

test('formula card height is calibrated to real KaTeX sizes, not a 2x-generous guess', () => {
  const blocks = [{ kind: 'formula', content: 'E = \\frac{\\sigma}{\\epsilon_0 \\epsilon_r}' }]
  const script = blocksToSimScript(blocks)
  const h = Number(script.match(/height:\s*(\d+)/)[1])
  // Real .katex-display height for this exact expression measured 38-47px
  // in-browser. The card must stay comfortably clear of that (never clip)
  // but should no longer sit near 2x it.
  assert.ok(h >= 44 && h <= 75, `formula card height ${h} should be close to the ~40px rendered content, not ~80-95px`)
})

test('a display equation still promotes out of the surrounding prose', () => {
  const blocks = toAnswerBlocks('Given the setup:\n$E = \\frac{\\sigma}{\\epsilon_0 \\epsilon_r}$\nwhich is the result.')
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ['text', 'formula', 'text']
  )
})
