// answerToSlides()/blocksToSlides() — an AI answer split into slide content.
// Splitting rule: a Markdown heading starts a new slide, matching the
// Given:/To Find:/Derivation: structure EXPLAIN_SYSTEM_PROMPT already
// produces, so no new prompt behaviour is needed to get a real deck.
//
// Run: node --test lib/ai/slides.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-slides-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 's.mjs')

writeFileSync(entry, `
export { answerToSlides, blocksToSlides } from '@/lib/ai/slides'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@=${root}`], { cwd: root, stdio: 'pipe' })

const { answerToSlides, blocksToSlides } = await import(bundle)

const text = (obj) => (obj.parameters.text?.kind === 'string' ? obj.parameters.text.value : '')

test('slide 1 is always the title, built from the question', () => {
  const slides = answerToSlides('Some answer.', 'What is impulse?')
  assert.equal(slides.length >= 1, true)
  assert.match(text(slides[0][0]), /What is impulse\?/)
})

test('a heading starts a new slide, in order', () => {
  const md = ['# Given:', '- Two plates.', '# Derivation:', 'E = sigma / eps.'].join('\n')
  const slides = answerToSlides(md, 'Q')
  // slide 0 = title, then one slide per heading
  assert.equal(slides.length, 3)
  assert.match(text(slides[1][0]), /Given:/)
  assert.match(text(slides[2][0]), /Derivation:/)
})

test('prose before the first heading is folded into a slide, not dropped', () => {
  const md = ['Some lead-in text.', '# Result:', 'u = 1/2 eps E^2.'].join('\n')
  const slides = answerToSlides(md, 'Q')
  const allText = slides.flat().map(text).join(' ')
  assert.match(allText, /Some lead-in text/)
  assert.match(allText, /Result:/)
})

test('a section too long for one slide splits into (continued) slides, never truncates', () => {
  const longLines = Array.from({ length: 40 }, (_, i) => `Line ${i} of a very long derivation with real content.`)
  const md = ['# Derivation:', ...longLines].join('\n')
  const slides = answerToSlides(md, 'Q')
  const derivationSlides = slides.slice(1) // everything after the title
  assert.equal(derivationSlides.length > 1, true, 'a 40-line section must span more than one slide')
  assert.match(text(derivationSlides[1][0]), /continued/)
  // No line was dropped in the split.
  const allBody = derivationSlides.map((s) => text(s[1])).join('\n')
  for (const line of longLines) assert.match(allBody, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('blocksToSlides renders a formula block as inline $...$ text, not dropped', () => {
  const blocks = [
    { kind: 'text', content: '# Result:\nThe final expression is:' },
    { kind: 'formula', content: 'u = \\frac{1}{2}\\epsilon E^2' },
  ]
  const slides = blocksToSlides(blocks, 'Energy density')
  const allText = slides.flat().map(text).join(' ')
  assert.match(allText, /\\frac\{1\}\{2\}\\epsilon E\^2/)
})

test('every slide object stays within the fixed slide canvas (10x5.625in @ 96dpi = 960x540)', () => {
  const md = ['# A:', 'short body'].join('\n')
  const slides = answerToSlides(md, 'Q')
  for (const objs of slides) {
    for (const o of objs) {
      assert.ok(o.position.x + o.size.w <= 960, `object right edge ${o.position.x + o.size.w} exceeds slide width`)
      assert.ok(o.position.y + o.size.h <= 540, `object bottom edge ${o.position.y + o.size.h} exceeds slide height`)
    }
  }
})
