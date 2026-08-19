// Routing a "make me slides on X" request, and building a deck that reads
// like a deck rather than a wall of prose.
//
// Why this exists: asked "make me slides on different states of matter and
// their related graphs", the pipeline produced blocks-on-springs and an empty
// deck. Three separate faults, all reproduced here:
//
//   1. classifyIntent returned 'simulate' — BUILD_ONLY_RE matched the leading
//      "make" and never asked WHAT was being built. A slide deck is a written
//      artefact, so the explain lane was skipped entirely and no prose was
//      ever generated. That is why the answer was "potato": there was no
//      answer, only a scene.
//   2. retrieveExamples returned [] for the prompt, so the model had no
//      relevant worked example and fell back on the only thing the corpus
//      teaches densely — mechanics blocks and springs.
//   3. "Make slides" consumes turn.blocks, which only the explain lane fills,
//      so an empty lane produced an empty deck.
//
// States of matter is also a topic the engine genuinely CANNOT simulate
// (there is no thermal domain: see DOMAINS in simscript-corpus.ts), which is
// exactly the case the router must hand to prose rather than fake with blocks.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-slide-intent-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'b.mjs')

writeFileSync(entry, `
export { classifyIntent, wantsSlides } from '@/lib/ai/route-intent'
export { retrieveExamples } from '@/lib/ai/few-shot'
export { answerToSlides, blocksToSlides, deckTitle } from '@/lib/ai/slides'
export { toAnswerBlocks, cleanAnswer } from '@/lib/ai/explain'
export { parse } from '@/lib/text/marks'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@=${root}`, '--external:react'], { cwd: root, stdio: 'pipe' })

const { classifyIntent, wantsSlides, retrieveExamples, answerToSlides, blocksToSlides, deckTitle, toAnswerBlocks, cleanAnswer, parse } =
  await import(bundle)

/** A slide object's visible text. Formatting is out-of-band mark ranges over
 *  a plain string (lib/text/marks.ts), so a styled heading's parameter value
 *  is a serialized {text, marks} blob — deserialize() is what the renderer
 *  itself uses to get back to the words. */
const textOf = (o) => {
  const raw = o.parameters?.text?.value ?? ''
  return typeof raw === 'string' ? parse(raw).text : ''
}
const allText = (slides) => slides.flat().map(textOf).join('\n')

// ── 1. Routing ──────────────────────────────────────────────────────────────

test('"make me slides on X" is a written request, not a build order', () => {
  // The exact prompt that produced blocks-on-springs.
  const p = 'make me slides on different states of matter and their related graphs'
  assert.notEqual(classifyIntent(p), 'simulate',
    'routing this to simulate skips the explain lane, so the deck has nothing to say')
})

test('every phrasing of "make a deck about X" reaches the explain lane', () => {
  for (const p of [
    'make me slides on different states of matter and their related graphs',
    'make slides on Ohms law',
    'create a presentation about semiconductor diodes',
    'build me a deck on Newton laws',
    'make a powerpoint on thermodynamics',
    'make me notes on the states of matter',
  ]) {
    const intent = classifyIntent(p)
    assert.ok(intent === 'explain' || intent === 'both',
      `"${p}" routed to ${intent}; a deck needs prose to put on the slides`)
  }
})

test('a real build order is still a build order', () => {
  // The slides fix must not swallow the simulate lane it sits next to.
  for (const p of [
    'Simulate a ball bouncing on the ground',
    'Build a pendulum and plot the angle',
    'Make a voltage divider with a 9V battery',
    'Add a note summarising the experiment',
  ]) {
    assert.equal(classifyIntent(p), 'simulate', `"${p}" should build, not explain`)
  }
})

test('a slide request is detectable so the deck can be built automatically', () => {
  assert.equal(wantsSlides('make me slides on states of matter'), true)
  assert.equal(wantsSlides('create a presentation about diodes'), true)
  assert.equal(wantsSlides('make a powerpoint on thermodynamics'), true)
  assert.equal(wantsSlides('derive Gauss law'), false)
  assert.equal(wantsSlides('simulate a bouncing ball'), false)
  // "slide" as physics, not as a deck — a sliding block is a simulation.
  assert.equal(wantsSlides('a block sliding down an inclined plane'), false)
})

test('the 100-question set keeps its lanes', () => {
  // Guards the regression direction: widening the router for slides must not
  // start routing coursework away from the scene lane it already gets right.
  const questions = [
    ...readFileSync(join(root, 'public/100_Questions_All_Subjects.md'), 'utf8')
      .matchAll(/^(\d+)\.\s+\*\*\[([NDS])\]\*\*\s+(.+)$/gm),
  ].map((m) => ({ n: +m[1], q: m[3] }))
  assert.equal(questions.length, 100)
  const simulateOnly = questions.filter((x) => classifyIntent(x.q) === 'simulate')
  assert.deepEqual(simulateOnly.map((x) => `Q${x.n}`), [],
    'no coursework question may lose its written answer')
})

test('every syllabus topic can be asked for as slides', () => {
  // The five course syllabi (public/syllabus*.pdf) are the real coverage
  // target, not just the 100-question set: a student types a topic name
  // straight off the syllabus. Topic titles extracted from those PDFs, so
  // this pins the router against the actual curriculum wording — including
  // the ones that name simulatable hardware ("Bar pendulum", "Charging and
  // discharging of capacitor"), which must still reach the explain lane when
  // a deck was asked for.
  const topics = [
    'Bar pendulum',
    'Charging and discharging of capacitor',
    'Barrier tunneling (Reflection and transmission coefficient)',
    'Atomicity of gases',
    'Boundary value problems, Laplace and Poisson equations',
    'Capacitor with dielectrics: dielectrics and Gauss law',
    'Chromatism in lens combination',
    'Absorption coefficient',
    'Applications: Induction cooker, electric guitar, metal detector',
    'Bomb calorimeter',
    'Calorific value of foods and fuels',
  ]
  for (const t of topics) {
    const p = `make slides on ${t}`
    assert.equal(wantsSlides(p), true, `"${t}" not recognised as a slide request`)
    assert.notEqual(classifyIntent(p), 'simulate',
      `"${t}" routed to simulate-only, so its deck would have no content`)
  }
})

// ── 2. Retrieval ────────────────────────────────────────────────────────────

test('a topic the engine cannot simulate retrieves no misleading example', () => {
  // There is no thermal/states-of-matter domain in DOMAINS, so the honest
  // result is nothing — NOT four mechanics scenes that teach the model to
  // answer "states of matter" with blocks and springs.
  const got = retrieveExamples('different states of matter and their related graphs', 4)
  for (const ex of got) {
    assert.ok(!/spring|block|pendulum/i.test(ex.prompt),
      `retrieved "${ex.prompt}" for a thermodynamics question — this is what taught it blocks-on-springs`)
  }
})

// ── 3. Deck quality ─────────────────────────────────────────────────────────

const SAMPLE = `## Solid
Particles are packed in a fixed lattice.
- Definite shape and volume
- Strong intermolecular forces

## Liquid
Particles are close but mobile.
- Definite volume, no definite shape

## Gas
Particles are far apart and move freely.
- Neither definite shape nor volume`

test('each heading becomes its own slide, in order', () => {
  const slides = answerToSlides(SAMPLE, 'States of matter')
  // Slide 0 is the title; then one slide per heading.
  assert.ok(slides.length >= 4, `expected a title + 3 topic slides, got ${slides.length}`)
  const headingText = slides.slice(1).map((s) => s.map(textOf).join(' '))
  assert.match(headingText[0], /Solid/)
  assert.match(headingText[1], /Liquid/)
  assert.match(headingText[2], /Gas/)
})

test('a deck never emits a slide with no content on it', () => {
  // An empty body under a heading renders as a blank slide in Present mode —
  // the visible half of "the slides are potato".
  for (const md of [SAMPLE, '## Only a heading\n\n## Another\nWith a body.', 'Just prose, no headings at all.']) {
    const slides = answerToSlides(md, 'T')
    slides.forEach((objects, i) => {
      assert.ok(objects.length > 0, `slide ${i} has no objects`)
      const text = objects.map(textOf).join('').trim()
      assert.ok(text.length > 0, `slide ${i} renders blank`)
    })
  }
})

test('a heading with an only-whitespace body is one slide, never a duplicate', () => {
  // The original bug: the do/while always ran once (emitting a heading + an
  // empty body box) AND the trailing `if` pushed a second heading-only slide,
  // so an empty section rendered as two slides, one of them blank.
  // A real first section keeps the leading H1-as-title promotion out of it.
  const slides = answerToSlides('## Real\nSome content.\n\n## Empty\n\n   \n\t\n', 'T')
  const texts = slides.map((s) => s.map(textOf).join(' | '))
  assert.equal(texts.filter((t) => /Empty/.test(t)).length, 1,
    `"Empty" appeared on more than one slide: ${JSON.stringify(texts)}`)
  // and no slide is blank
  for (const t of texts) assert.ok(t.trim().length > 0, 'a blank slide was emitted')
})

test('the title slide carries the question, not a truncated fragment', () => {
  const slides = answerToSlides(SAMPLE, 'different states of matter and their related graphs')
  const title = slides[0].map(textOf).join(' ')
  assert.match(title, /states of matter/i)
})

test("the answer's own H1 titles the deck instead of becoming an empty slide", () => {
  // Measured against the real model: it opens an answer with "# States of
  // Matter" and then "## Introduction". That H1 is the document title, not a
  // section, so emitting it as its own slide produced a heading-only slide
  // immediately after the title slide — two title slides in a row.
  const slides = answerToSlides('# States of Matter\n\n## Introduction\nThree primary states.', 'make me slides on states of matter')
  const texts = slides.map((s) => s.map(textOf).join(' | '))
  const headingOnly = texts.slice(1).filter((t) => /^States of Matter\s*\|?\s*$/.test(t.trim()))
  assert.equal(headingOnly.length, 0, `emitted a redundant title slide: ${JSON.stringify(texts)}`)
  // The real content still survives.
  assert.match(texts.join('\n'), /Introduction/)
  assert.match(texts.join('\n'), /Three primary states/)
})

test('a lone H1 with body text under it still keeps its body', () => {
  // The H1 promotion must not swallow content that lives directly under it.
  const slides = answerToSlides('# Ohms Law\nV equals I times R.', 'Ohms law')
  assert.match(allText(slides), /V equals I times R/)
})

test('the deck is named after its subject, not the raw prompt', () => {
  // The page appeared in the sidebar as "make me slides on different states
  // of matter and their related gr…" — the request, not the document.
  const md = '# States of Matter\n\n## Solid\nPacked lattice.'
  assert.equal(deckTitle(md, 'make me slides on different states of matter'), 'States of Matter')
  // No H1 to borrow: fall back to the prompt, stripped of the request verb.
  assert.equal(deckTitle('## Solid\nPacked.', 'make me slides on states of matter'), 'States of matter')
})

test('a formula survives into the deck as readable maths', () => {
  const blocks = toAnswerBlocks(cleanAnswer('## Ideal gas\n\\[ PV = nRT \\]\nWhere $n$ is moles.'))
  const slides = blocksToSlides(blocks, 'Ideal gas law')
  const all = allText(slides)
  assert.match(all, /PV = nRT/, 'the equation must not vanish from the deck')
})

test('every object stays inside the fixed 960x540 slide canvas', () => {
  // pptx pages are a fixed 10x5.625in @96dpi; an object past that edge is
  // simply invisible in Present mode and in the exported file.
  for (const objects of answerToSlides(SAMPLE, 'States of matter')) {
    for (const o of objects) {
      const { x, y } = o.position
      const { w, h } = o.size
      assert.ok(x >= 0 && y >= 0, `object at (${x},${y}) is off the top-left`)
      assert.ok(x + w <= 960, `object right edge ${x + w} > 960`)
      assert.ok(y + h <= 540, `object bottom edge ${y + h} > 540`)
    }
  }
})

// ── 4. Legibility ───────────────────────────────────────────────────────────

test('body text is sized for a room, not for a document', () => {
  // Default body text renders at ~15px on a 960x540 slide — that is document
  // size, and it is why a generated deck read as a wall of grey. Slides are
  // viewed from across a room, so the body carries an explicit size mark.
  const slides = answerToSlides(SAMPLE, 'States of matter')
  const bodies = slides.slice(1).flatMap((s) => s.slice(1)) // drop each heading
  assert.ok(bodies.length > 0, 'expected body objects to check')
  for (const b of bodies) {
    const raw = b.parameters?.text?.value ?? ''
    const { marks } = parse(raw)
    const size = marks.find((m) => m.kind === 'size')
    assert.ok(size, 'body text has no explicit size mark, so it renders at document size')
    assert.ok(['l', 'xl'].includes(size.value) || Number(size.value) >= 18,
      `body size ${size?.value} is too small to read on a slide`)
  }
})

test('a slide heading outranks its body visually', () => {
  // Both were 'l' (20px), so heading and body differed only by weight — on a
  // projected slide that reads as one undifferentiated block of text.
  const slides = answerToSlides('## Solid State\n- Fixed shape', 'T')
  const [heading, body] = slides[1]
  const sizeOf = (o) => {
    const mk = parse(o.parameters.text.value).marks.find((m) => m.kind === 'size')
    return mk ? (({ s: 12, m: 15, l: 20, xl: 28 })[mk.value] ?? Number(mk.value)) : 15
  }
  assert.ok(sizeOf(heading) > sizeOf(body),
    `heading (${sizeOf(heading)}px) must be larger than body (${sizeOf(body)}px)`)
})

test('markdown bullets become real bullet glyphs', () => {
  // "- Definite shape" rendered literally as a hyphen. A deck shows bullets.
  const slides = answerToSlides('## Solid\n- Definite shape\n- Fixed volume', 'T')
  const body = allText(slides)
  assert.ok(!/^\s*-\s/m.test(body), `raw "- " markdown survived into the slide: ${JSON.stringify(body)}`)
  assert.match(body, /[•‣]/, 'expected a real bullet glyph')
})

test('a nested bullet keeps its indentation', () => {
  const slides = answerToSlides('## Solid\n- Properties:\n  - Tightly packed\n  - Vibrating', 'T')
  const body = allText(slides)
  assert.match(body, /Tightly packed/)
  // The nested item must still be visibly indented relative to its parent.
  const line = body.split('\n').find((l) => /Tightly packed/.test(l))
  assert.match(line, /^\s+/, 'nested bullet lost its indentation')
})

test('an unclosed or line-spanning bold marker never shows as asterisks', () => {
  // Both seen from the real model: generation hits its token limit mid-
  // emphasis ("- **Stopband:** ... \\( f_{"), or emphasis opens on one line
  // and closes on the next. migrateLegacyMarkdown pairs markers within a
  // line, so the orphan survived and printed as literal ** on the slide.
  for (const md of [
    '## H\n**Unclosed bold',
    '## H\nLine one **spanning\nnewline** end',
    '## H\n- **Stopband:** Frequencies between $f_1$ and **',
  ]) {
    const body = allText(answerToSlides(md, 'q'))
    assert.ok(!body.includes('**'), `literal ** survived: ${JSON.stringify(body)}`)
  }
})

test('bold markers do not survive as literal asterisks', () => {
  // "**Definition**: ..." showed the stars on the slide.
  const slides = answerToSlides('## Solid\n- **Definition**: fixed shape', 'T')
  const body = allText(slides)
  assert.ok(!body.includes('**'), `literal ** reached the slide: ${JSON.stringify(body)}`)
  assert.match(body, /Definition/)
})

test('a heading does not announce its own slide number', () => {
  // The model writes "## Slide 3: Units and Conversions". On an actual slide
  // the "Slide 3:" is noise — and it goes stale the moment a long section
  // splits into a (continued) slide, so slide 5 of the deck read "Slide 4:".
  const slides = answerToSlides('## Slide 1: Introduction\nBody.\n\n## Slide 2: Units\nMore.', 'T')
  const texts = slides.map((s) => s.map(textOf).join(' | '))
  for (const t of texts) {
    assert.ok(!/\bSlide\s*\d+\s*:/i.test(t), `heading still announces a slide number: ${JSON.stringify(t)}`)
  }
  // The real heading text survives.
  assert.match(texts.join('\n'), /Introduction/)
  assert.match(texts.join('\n'), /Units/)
})

test('every shape of self-numbered heading is stripped', () => {
  // Found by generating decks for 20 real course questions: the model
  // numbers its own slides in several shapes, and a naive "^Slide N:" strip
  // caught only the plainest. Each of these leaked in a real generation.
  for (const form of [
    '## Slide 1: Intro',
    '## **Slide 2: Setup**',   // bolded heading
    '### Slide 3: Deep',       // sub-heading, lands in the body
    '## Slide 4 - Solve',      // dash instead of colon
    '## Slide 8 — Dash',       // em dash
    '## Slide 5',              // bare number, no title at all
    '**Slide 6: Bold line**',  // a bold body line used as a pseudo-heading
    '## Slide 7:Tight',        // no space after the colon
  ]) {
    const slides = answerToSlides(`${form}\nBody text.`, 'q')
    const all = allText(slides)
    assert.ok(!/slide\s*\d+/i.test(all), `"${form}" leaked a slide number: ${JSON.stringify(all)}`)
    assert.match(all, /Body text/, `"${form}" lost its body`)
  }
})

test('a sub-heading is a styled line, never a literal ###', () => {
  // Only #/## start a new slide, so ### fell through to the body verbatim and
  // rendered as "### Graphs of Solid State" on the slide.
  const slides = answerToSlides('## Solid\nIntro line.\n### Graphs of Solid State\n- A curve', 'T')
  const body = allText(slides)
  assert.ok(!body.includes('###'), `literal ### reached the slide: ${JSON.stringify(body)}`)
  assert.match(body, /Graphs of Solid State/, 'the sub-heading text itself must survive')
})

test('splitting a section never cuts a line in half', () => {
  // Slide 9 of a real deck ended "4. **Charles's Law (Pressure vs. Volume" —
  // the chunk boundary landed mid-line, orphaning an unclosed ** marker.
  const long = Array.from({ length: 30 }, (_, i) => `- Item ${i} ` + 'x'.repeat(120))
  const slides = answerToSlides(`## Big\n${long.join('\n')}`, 'T')
  for (const line of allText(slides).split('\n')) {
    const stars = (line.match(/\*\*/g) ?? []).length
    assert.equal(stars % 2, 0, `orphaned ** on line: ${JSON.stringify(line)}`)
  }
})

test('a long section splits across slides without losing a single line', () => {
  const lines = Array.from({ length: 40 }, (_, i) => `- Point number ${i} about the topic`)
  const slides = answerToSlides(`## Big\n${lines.join('\n')}`, 'T')
  const rendered = allText(slides)
  for (const l of lines) {
    // The leading "- " is rendered as a bullet glyph, so match the content.
    const content = l.replace(/^-\s+/, '')
    assert.ok(rendered.includes(content), `lost "${content}" when splitting the section`)
  }
  assert.ok(slides.length > 2, 'a 40-line section must not be crammed onto one slide')
})

test.after(() => rmSync(dir, { recursive: true, force: true }))
