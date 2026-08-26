// Round-trip tests for the StoredText <-> ProseMirror converters
// (lib/text/pm.ts).
//
// The property that matters: every existing {text, marks} consumer
// (pptx-export, docx-export, presentation-view, selection-actions) keeps
// working after the editor starts holding a ProseMirror document, because
// anything holding one converts back first. So for any legacy content the
// app can currently produce:
//
//     pmDocToStoredText(storedTextToPmDoc(x))  ==  x
//
// Marks are compared PER VISIBLE CHARACTER, not range-for-range. A legacy
// mark may span a '\n' and cover block-prefix characters ("- ", "# "),
// neither of which exists in a ProseMirror document (a newline is a node
// boundary; a list marker is structure), so a round-tripped mark comes back
// fragmented — one range over "a\nb" returns as two. That is semantically
// identical: every character a reader can see keeps exactly its formatting,
// and no consumer asks what covers a newline (runsForLine, which
// pptx-export and every renderer walk, resolves marks per character).
//
// So the assertion builds a per-character formatting map for both sides and
// compares those, ignoring the invisible gaps. See the fragmentation note in
// pm.ts. Size presets ('l') resolve to their px value ('20') on the way
// through — resolveSizePx accepts both and every consumer calls it — so
// sizes are compared resolved.
//
// Run: node --test lib/text/pm.test.mjs

import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// pm.ts imports lib/text/marks with the project's extensionless '@/…' style,
// which bare Node cannot resolve — bundle first, exactly as
// lib/ai/slides.test.mjs does.
const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-pm-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'pm.mjs')

writeFileSync(entry, `
export { storedTextToPmDoc, pmDocToStoredText, parseDoc, serializeDoc, isPmDoc } from '@/lib/text/pm'
export { serialize, TEXT_FONTS, TEXT_WEIGHTS } from '@/lib/text/marks'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@=${root}`], { cwd: root, stdio: 'pipe' })

const {
  storedTextToPmDoc,
  pmDocToStoredText,
  parseDoc,
  serializeDoc,
  isPmDoc,
  serialize,
  TEXT_FONTS,
  TEXT_WEIGHTS,
} = await import(bundle)

// ── Comparison ───────────────────────────────────────────────────────────

const SIZE_PRESETS = { s: 12, m: 15, l: 20, xl: 28 }
/** A size mark's value is either a preset id or a bare number; both resolve
 *  to the same px, which is all resolveSizePx — and therefore every
 *  consumer — ever reads. */
const resolveSize = (v) => String(SIZE_PRESETS[v] ?? v)

const markKey = (m) => `${m.kind}=${m.kind === 'size' ? resolveSize(m.value) : (m.value ?? '')}`

/** Offsets that cannot carry a mark in a ProseMirror document, and are
 *  therefore excluded from the comparison: newlines (node boundaries) and
 *  the block-prefix / indent characters that become node structure rather
 *  than text. Everything NOT in this set is a character a reader can see,
 *  and every one of those must keep its formatting exactly. */
function structuralOffsets(text) {
  const skip = new Set()
  let offset = 0
  for (const raw of text.split('\n')) {
    const body = raw.replace(/^ */, '')
    const indentLen = raw.length - body.length
    const prefix = body.match(/^(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+)/)
    const structural = indentLen + (prefix ? prefix[0].length : 0)
    for (let i = 0; i < structural; i++) skip.add(offset + i)
    // A horizontal rule is entirely structure.
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(body)) {
      for (let i = 0; i < raw.length; i++) skip.add(offset + i)
    }
    offset += raw.length
    skip.add(offset) // the '\n' itself
    offset += 1
  }
  return skip
}

/** The formatting in force at each VISIBLE character offset, as a sorted key
 *  string. Structural offsets map to null and are skipped — see above. */
function formatPerChar(stored, skip) {
  const map = []
  for (let i = 0; i < stored.text.length; i++) {
    if (skip.has(i)) {
      map.push(null)
      continue
    }
    const keys = stored.marks.filter((m) => m.start <= i && m.end > i).map(markKey)
    map.push([...new Set(keys)].sort().join(','))
  }
  return map
}

function roundTrip(stored) {
  return pmDocToStoredText(storedTextToPmDoc(stored))
}

/** Asserts the round-trip preserves the flat text exactly, and preserves the
 *  formatting of every visible character. Ranges are deliberately NOT
 *  compared range-for-range — see the fragmentation note at the top. */
function assertRoundTrip(stored, label) {
  const back = roundTrip(stored)
  assert.equal(back.text, stored.text, `${label}: text changed`)

  const skip = structuralOffsets(stored.text)
  const want = formatPerChar(stored, skip)
  const got = formatPerChar(back, skip)
  for (let i = 0; i < want.length; i++) {
    if (want[i] === null) continue
    assert.equal(
      got[i],
      want[i],
      `${label}: formatting changed at offset ${i} (${JSON.stringify(stored.text[i])}) — ` +
        `expected [${want[i]}], got [${got[i]}]`
    )
  }
}

// ── Plain text and paragraphs ────────────────────────────────────────────

test('plain single line round-trips', () => {
  assertRoundTrip({ text: 'Hello world', marks: [] }, 'single line')
})

test('multiple paragraphs round-trip', () => {
  assertRoundTrip({ text: 'First line\nSecond line\nThird', marks: [] }, 'paragraphs')
})

test('empty text produces a valid one-paragraph doc', () => {
  const doc = storedTextToPmDoc({ text: '', marks: [] })
  assert.equal(doc.type, 'doc')
  assert.equal(doc.content.length, 1)
  assert.equal(doc.content[0].type, 'paragraph')
  assert.equal(pmDocToStoredText(doc).text, '')
})

test('blank line between paragraphs survives', () => {
  assertRoundTrip({ text: 'One\n\nTwo', marks: [] }, 'blank line')
})

// ── Toggle marks ─────────────────────────────────────────────────────────

test('every toggle mark kind round-trips', () => {
  for (const kind of ['bold', 'italic', 'underline', 'strike', 'highlight', 'code']) {
    assertRoundTrip({ text: 'styled text here', marks: [{ start: 0, end: 6, kind }] }, kind)
  }
})

test('overlapping toggle marks round-trip', () => {
  assertRoundTrip(
    {
      text: 'bold and italic',
      marks: [
        { start: 0, end: 8, kind: 'bold' },
        { start: 5, end: 15, kind: 'italic' },
      ],
    },
    'overlapping toggles'
  )
})

test('three stacked marks on one word round-trip', () => {
  assertRoundTrip(
    {
      text: 'triple',
      marks: [
        { start: 0, end: 6, kind: 'bold' },
        { start: 0, end: 6, kind: 'italic' },
        { start: 0, end: 6, kind: 'underline' },
      ],
    },
    'stacked'
  )
})

// ── Exclusive marks (the four that collapse into textStyle) ──────────────

test('color mark round-trips for presets and custom hex', () => {
  assertRoundTrip({ text: 'colored', marks: [{ start: 0, end: 7, kind: 'color', value: 'blue' }] }, 'preset color')
  assertRoundTrip({ text: 'colored', marks: [{ start: 0, end: 7, kind: 'color', value: '#ff8800' }] }, 'hex color')
})

test('size mark round-trips, presets normalising to px', () => {
  // A preset id ('l') resolves to its px value on the way in, so it comes
  // back as the number — the same value resolveSizePx would have produced,
  // which is all any consumer reads.
  const back = roundTrip({ text: 'sized', marks: [{ start: 0, end: 5, kind: 'size', value: 'l' }] })
  assert.equal(back.marks.length, 1)
  assert.equal(back.marks[0].kind, 'size')
  assert.equal(back.marks[0].value, '20')

  assertRoundTrip({ text: 'sized', marks: [{ start: 0, end: 5, kind: 'size', value: '22' }] }, 'custom size')
})

test('font mark round-trips through the stack lookup', () => {
  for (const id of ['sans', 'mono', 'montserrat', 'georgia', 'comic']) {
    assert.ok(TEXT_FONTS[id], `${id} should be a known font`)
    assertRoundTrip({ text: 'fonted', marks: [{ start: 0, end: 6, kind: 'font', value: id }] }, `font ${id}`)
  }
})

test('weight mark round-trips through the weight lookup', () => {
  for (const id of Object.keys(TEXT_WEIGHTS)) {
    assertRoundTrip({ text: 'weighted', marks: [{ start: 0, end: 8, kind: 'weight', value: id }] }, `weight ${id}`)
  }
})

test('all four exclusive kinds on one range round-trip together', () => {
  assertRoundTrip(
    {
      text: 'everything',
      marks: [
        { start: 0, end: 10, kind: 'color', value: 'mint' },
        { start: 0, end: 10, kind: 'size', value: '28' },
        { start: 0, end: 10, kind: 'font', value: 'playfair' },
        { start: 0, end: 10, kind: 'weight', value: 'semibold' },
      ],
    },
    'four exclusives'
  )
})

test('exclusive and toggle marks coexist on one range', () => {
  assertRoundTrip(
    {
      text: 'mixed styling',
      marks: [
        { start: 0, end: 5, kind: 'bold' },
        { start: 0, end: 5, kind: 'color', value: 'rose' },
        { start: 6, end: 13, kind: 'italic' },
        { start: 6, end: 13, kind: 'size', value: '12' },
      ],
    },
    'mixed'
  )
})

// ── Links (and the https gate) ───────────────────────────────────────────

test('https link round-trips', () => {
  assertRoundTrip(
    { text: 'click here', marks: [{ start: 0, end: 5, kind: 'link', value: 'https://example.com' }] },
    'link'
  )
})

test('non-http link value is dropped, text preserved', () => {
  const back = roundTrip({
    text: 'click here',
    marks: [{ start: 0, end: 5, kind: 'link', value: 'javascript:alert(1)' }],
  })
  assert.equal(back.text, 'click here')
  assert.equal(back.marks.filter((m) => m.kind === 'link').length, 0, 'javascript: URL must not survive')
})

// ── Block structure ──────────────────────────────────────────────────────

test('every heading level round-trips', () => {
  for (let n = 1; n <= 6; n++) {
    assertRoundTrip({ text: `${'#'.repeat(n)} Heading ${n}`, marks: [] }, `h${n}`)
  }
})

test('heading with marks on its body round-trips', () => {
  // Offsets are into the FULL string, so the body of "## Title" starts at 3.
  assertRoundTrip({ text: '## Title', marks: [{ start: 3, end: 8, kind: 'bold' }] }, 'marked heading')
})

test('bullet list round-trips', () => {
  assertRoundTrip({ text: '- one\n- two\n- three', marks: [] }, 'bullets')
})

test('ordered list round-trips and preserves its start digit', () => {
  assertRoundTrip({ text: '1. one\n2. two\n3. three', marks: [] }, 'ordered from 1')
  assertRoundTrip({ text: '3. three\n4. four', marks: [] }, 'ordered from 3')
})

test('checklist round-trips with checked state', () => {
  assertRoundTrip({ text: '- [ ] todo\n- [x] done', marks: [] }, 'checklist')
})

test('blockquote round-trips, consecutive lines grouped', () => {
  assertRoundTrip({ text: '> quoted\n> more quoted', marks: [] }, 'blockquote')
  const doc = storedTextToPmDoc({ text: '> a\n> b', marks: [] })
  assert.equal(doc.content.length, 1, 'consecutive quote lines are one blockquote')
  assert.equal(doc.content[0].type, 'blockquote')
  assert.equal(doc.content[0].content.length, 2, 'holding two paragraphs')
})

test('horizontal rule round-trips', () => {
  assertRoundTrip({ text: 'above\n---\nbelow', marks: [] }, 'hr')
})

test('marks inside a list item round-trip', () => {
  // "- first" — body starts at offset 2.
  assertRoundTrip({ text: '- first\n- second', marks: [{ start: 2, end: 7, kind: 'bold' }] }, 'marked bullet')
})

// ── Indentation becomes real nesting ─────────────────────────────────────

const IND = '        ' // INDENT_UNIT, 8 spaces

test('nested bullets become nested lists and round-trip', () => {
  const stored = { text: `- top\n${IND}- nested\n- back`, marks: [] }
  const doc = storedTextToPmDoc(stored)
  assert.equal(doc.content.length, 1, 'one outer list')
  const items = doc.content[0].content
  assert.equal(items.length, 2, 'two top-level items')
  assert.ok(
    items[0].content.some((c) => c.type === 'bulletList'),
    'the nested list lives inside the first item'
  )
  assertRoundTrip(stored, 'nested bullets')
})

test('two levels of nesting round-trip', () => {
  assertRoundTrip({ text: `- a\n${IND}- b\n${IND}${IND}- c`, marks: [] }, 'deep nesting')
})

test('a document starting indented still produces a valid doc', () => {
  const doc = storedTextToPmDoc({ text: `${IND}- orphan`, marks: [] })
  assert.equal(doc.type, 'doc')
  assert.ok(doc.content.length > 0)
})

// ── Storage generations ──────────────────────────────────────────────────

test('isPmDoc distinguishes the three stored generations', () => {
  assert.equal(isPmDoc(''), false)
  assert.equal(isPmDoc('plain markdown **text**'), false)
  assert.equal(isPmDoc(serialize({ text: 'hi', marks: [] })), false, 'legacy {text,marks} is not a PM doc')
  assert.equal(isPmDoc(serializeDoc(storedTextToPmDoc({ text: 'hi', marks: [] }))), true)
})

test('parseDoc reads all three generations', () => {
  // Generation 3: ProseMirror JSON, used directly.
  const pm = storedTextToPmDoc({ text: 'direct', marks: [] })
  assert.deepEqual(parseDoc(serializeDoc(pm)), pm)

  // Generation 2: today's {text, marks}.
  const legacy = serialize({ text: 'stored', marks: [{ start: 0, end: 6, kind: 'bold' }] })
  const fromLegacy = parseDoc(legacy)
  assert.equal(fromLegacy.type, 'doc')
  assert.equal(pmDocToStoredText(fromLegacy).text, 'stored')
  assert.equal(pmDocToStoredText(fromLegacy).marks[0].kind, 'bold')

  // Generation 1: raw markdown delimiters, via migrateLegacyMarkdown.
  const fromRaw = parseDoc('**bold** and plain')
  assert.equal(pmDocToStoredText(fromRaw).text, 'bold and plain')
  assert.ok(
    pmDocToStoredText(fromRaw).marks.some((m) => m.kind === 'bold'),
    'legacy ** delimiters migrate into a real mark'
  )
})

test('parseDoc on garbage does not throw', () => {
  for (const raw of ['{', '{"type":', '{"nope":true}', '[]', 'null']) {
    const doc = parseDoc(raw)
    assert.equal(doc.type, 'doc', `parseDoc(${JSON.stringify(raw)}) should still return a doc`)
  }
})

// ── Realistic composites ─────────────────────────────────────────────────

test('a full formatted document round-trips', () => {
  const text = [
    '# Chapter One',
    'Some intro text with emphasis.',
    '## Details',
    '- first point',
    `${IND}- nested detail`,
    '- second point',
    '> A quotation here.',
    '1. step one',
    '2. step two',
    '- [ ] unfinished',
    '- [x] finished',
    '---',
    'Closing paragraph.',
  ].join('\n')

  const marks = [
    { start: 2, end: 13, kind: 'bold' },
    { start: 14, end: 18, kind: 'italic' },
    { start: 14, end: 18, kind: 'color', value: 'violet' },
    { start: 48, end: 55, kind: 'size', value: '28' },
  ]
  assertRoundTrip({ text, marks }, 'full document')
})

test('AI-slide shaped content round-trips (bold + xl size heading)', () => {
  // Matches exactly what lib/ai/slides.ts's aiSlideHeading emits.
  const heading = 'Newton’s Second Law'
  const back = roundTrip({
    text: heading,
    marks: [
      { start: 0, end: heading.length, kind: 'bold' },
      { start: 0, end: heading.length, kind: 'size', value: 'xl' },
    ],
  })
  assert.equal(back.text, heading)
  assert.ok(back.marks.some((m) => m.kind === 'bold'))
  assert.equal(back.marks.find((m) => m.kind === 'size').value, '28')
})

test('inline math text is carried through untouched', () => {
  // $…$ is resolved by the renderer, not the model — it must survive as
  // literal characters so the math extension can pick it up later.
  assertRoundTrip({ text: 'permittivity $\\epsilon_1$ here', marks: [] }, 'inline math')
})

test('unicode and emoji offsets survive', () => {
  const text = 'café — naïve 🎉 done'
  assertRoundTrip({ text, marks: [{ start: 0, end: 4, kind: 'bold' }] }, 'unicode')
})

// ── Lossy-by-design cases keep their text ────────────────────────────────

test('unsupported nodes degrade to text rather than vanishing', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1' }] },
      {
        type: 'table',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cell text' }] }],
      },
    ],
  }
  const back = pmDocToStoredText(doc)
  assert.ok(back.text.includes('const x = 1'), 'code block text survives')
  assert.ok(back.text.includes('cell text'), 'table text survives')
})

// ── Fragmentation is expected (see the note at the top and in pm.ts) ─────

test('a mark spanning a newline fragments but keeps every character formatted', () => {
  const stored = { text: 'line one\nline two', marks: [{ start: 0, end: 17, kind: 'size', value: '20' }] }
  const back = roundTrip(stored)
  assert.equal(back.text, stored.text)
  // Two ranges out, not one — the newline cannot carry a mark.
  assert.equal(back.marks.length, 2, 'expected the range to split at the newline')
  assert.deepEqual(
    back.marks.map((m) => [m.start, m.end]),
    [[0, 8], [9, 17]]
  )
  // …but every visible character still resolves to the same size.
  assertRoundTrip(stored, 'size across a newline')
})

test('a mark covering block prefixes keeps the body formatted', () => {
  // The legacy range covers "- a\n- b" entirely, prefixes included; only the
  // body characters exist in ProseMirror.
  const stored = { text: '- a\n- b', marks: [{ start: 0, end: 7, kind: 'size', value: '20' }] }
  const back = roundTrip(stored)
  assert.equal(back.text, stored.text)
  for (const i of [2, 6]) {
    assert.ok(
      back.marks.some((m) => m.start <= i && m.end > i && m.kind === 'size'),
      `body character at ${i} lost its size`
    )
  }
})

test('a multi-line AI slide body keeps its size on every visible character', () => {
  // Exactly the shape lib/ai/slides.ts emits: one size mark over a whole
  // multi-line, multi-prefix body. This is the case that first exposed
  // fragmentation against real content.
  const text = '- The capacitance C\n- The stored energy U\n1. Start from C = eps\n2. Substitute'
  assertRoundTrip({ text, marks: [{ start: 0, end: text.length, kind: 'size', value: 'l' }] }, 'ai body')
})

test('legacy HTML-era documents open as text, not tag soup', () => {
  // The oldest stored generation: raw execCommand HTML. parse() alone does
  // not strip tags, so this is the regression guard for parseDoc doing it.
  const doc = parseDoc('<div>Hello <b>world</b></div><div>second line</div>')
  const { text } = pmDocToStoredText(doc)
  assert.ok(!text.includes('<'), `tags leaked into text: ${JSON.stringify(text)}`)
  assert.ok(text.includes('Hello world'), text)
  assert.ok(text.includes('second line'), text)
})
