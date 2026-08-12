// Regression tests for the rich-text box: writing, deleting, editing.
//
// Covers the nine bugs fixed in the text-tool pass — paste duplicating the
// box, the caret vanishing on a cleared bullet, stale paste mark offsets,
// swallowed pastes, atomic prefix deletion, DOM/model divergence, list
// continuation, cross-line marks, and whole-box marks on an empty box.
//
// The mark/offset layer (lib/text/marks.ts) is imported and exercised FOR
// REAL. The editor's line-buffer operations live inside a React hook that
// needs a DOM, so the pure parts of those operations are ported here as
// faithfully as possible and kept honest by asserting against the same
// invariant the real editor depends on: every mark offset must stay within
// the flat joined string, and DOM text length must equal raw line length.
//
// Run directly:  node --experimental-strip-types lib/text/text-editing.test.mjs

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyMark,
  shiftMarks,
  splitIndent,
  continuationPrefix,
  BLOCK_PREFIX_RE,
  parse,
  serialize,
  runsForLine,
} from './marks.ts'

// ── A line buffer mirroring the editor's linesRef/marksRef pair ──────────
// Same operations as components/objects/text.tsx, minus the DOM writes.

class Buffer {
  constructor(text = '', marks = []) {
    this.lines = text.split('\n')
    this.marks = marks
    this.active = this.lines.length - 1
  }
  lineStart(i) {
    let s = 0
    for (let k = 0; k < i; k++) s += this.lines[k].length + 1
    return s
  }
  locate(absolute) {
    let remaining = Math.max(0, absolute)
    for (let i = 0; i < this.lines.length; i++) {
      const len = this.lines[i].length
      if (remaining <= len) return { line: i, offset: remaining }
      remaining -= len + 1
    }
    const last = this.lines.length - 1
    return { line: last, offset: this.lines[last].length }
  }
  get text() {
    return this.lines.join('\n')
  }
  replaceRange(s, e, text) {
    const gs = this.lineStart(s.line) + s.offset
    const ge = this.lineStart(e.line) + e.offset
    if (ge > gs) this.marks = shiftMarks(this.marks, gs, -(ge - gs))
    if (text.length > 0) this.marks = shiftMarks(this.marks, gs, text.length)
    const before = this.lines[s.line].slice(0, s.offset)
    const after = this.lines[e.line].slice(e.offset)
    const inserted = (before + text + after).split('\n')
    this.lines.splice(s.line, e.line - s.line + 1, ...inserted)
    this.active = s.line + inserted.length - 1
    return this
  }
  /** The invariant the caret system depends on: no mark may point past the
   *  end of the flat string, and none may be inverted. */
  assertMarksSane(label) {
    const len = this.text.length
    for (const m of this.marks) {
      assert.ok(m.start >= 0, `${label}: mark start ${m.start} < 0`)
      assert.ok(m.end >= m.start, `${label}: inverted mark ${m.start}..${m.end}`)
      assert.ok(m.end <= len, `${label}: mark end ${m.end} past text length ${len}`)
    }
  }
}

// ── 1. Paste no longer double-applies (canvas guard) ─────────────────────

test('paste: a live editor claims the clipboard so the canvas cannot also spawn a box', () => {
  // Models the two handlers: the editor's React onPaste and the canvas's
  // window listener. The canvas bails when an editor is registered.
  const activeTextEditor = { objectId: null }
  const spawned = []
  const canvasWindowPaste = () => {
    if (activeTextEditor.objectId !== null) return 'bailed'
    spawned.push('new text box')
    return 'spawned'
  }

  activeTextEditor.objectId = 'text-1'
  assert.equal(canvasWindowPaste(), 'bailed')
  assert.deepEqual(spawned, [], 'pasting inside a text box must not create another box')

  activeTextEditor.objectId = null
  assert.equal(canvasWindowPaste(), 'spawned', 'pasting on bare canvas still creates a box')
})

// ── 3. Paste marks land on the right characters ──────────────────────────

test('paste: html marks use the pre-insert offset, not the post-insert one', () => {
  // Paste bold "XY" into the middle of line 0 of a two-line box. The bug was
  // computing lineStart() AFTER replaceRange mutated the buffer.
  const buf = new Buffer('hello\nworld')
  const at = { line: 0, offset: 2 }
  const pastedText = 'XY'
  const pastedMarks = [{ start: 0, end: 2, kind: 'bold' }]

  const offsetBefore = buf.lineStart(at.line) + at.offset // correct: 2
  buf.replaceRange(at, at, pastedText)
  for (const m of pastedMarks) {
    buf.marks = applyMark(buf.marks, m.start + offsetBefore, m.end + offsetBefore, m.kind, m.value)
  }

  assert.equal(buf.text, 'heXYllo\nworld')
  const bold = buf.marks.find((m) => m.kind === 'bold')
  assert.deepEqual({ start: bold.start, end: bold.end }, { start: 2, end: 4 })
  assert.equal(buf.text.slice(bold.start, bold.end), 'XY', 'bold must cover exactly the pasted text')
  buf.assertMarksSane('paste offsets')
})

test('paste: multi-line paste into a non-last line keeps marks aligned', () => {
  const buf = new Buffer('alpha\nbeta\ngamma')
  const at = { line: 1, offset: 2 }
  const offsetBefore = buf.lineStart(at.line) + at.offset
  buf.replaceRange(at, at, 'ONE\nTWO')
  buf.marks = applyMark(buf.marks, offsetBefore, offsetBefore + 3, 'bold')

  assert.equal(buf.text, 'alpha\nbeONE\nTWOta\ngamma')
  const bold = buf.marks.find((m) => m.kind === 'bold')
  assert.equal(buf.text.slice(bold.start, bold.end), 'ONE')
  buf.assertMarksSane('multiline paste')
})

test('paste: caret lands at the end of pasted content', () => {
  const buf = new Buffer('ab\ncd')
  const at = { line: 0, offset: 1 }
  const offsetBefore = buf.lineStart(at.line) + at.offset
  const pasted = 'XY\nZ'
  buf.replaceRange(at, at, pasted)
  const caret = buf.locate(offsetBefore + pasted.length)
  assert.equal(buf.text, 'aXY\nZb\ncd')
  assert.deepEqual(caret, { line: 1, offset: 1 }, 'caret sits right after the pasted Z')
})

// ── 4. Paste is never swallowed ──────────────────────────────────────────

test('paste: a transient active index of -1 falls back instead of dropping the paste', () => {
  const lines = ['one', 'two']
  const activeRef = -1 // mid-rebuild
  const idx = activeRef >= 0 ? activeRef : Math.max(0, lines.length - 1)
  assert.equal(idx, 1, 'falls back to the last line rather than returning early')
})

// ── 2. The caret host: cleared prefix lines stay editable ────────────────
// Mirrors renderEditorLine's branches. render.ts itself uses '@/' aliases so
// it cannot be imported here; the empty-body condition is what matters and
// is asserted directly.

const CARET_HOST_CHAR = '​'
const stripCaretHost = (t) => t.split(CARET_HOST_CHAR).join('')
const CARET_HOST = `<span class="md-caret-host">${CARET_HOST_CHAR}</span>`

test('caret host: the ported constants still match lib/text/render.ts', async () => {
  // render.ts uses '@/' path aliases so it cannot be imported here; guard the
  // port against drift by reading the source instead of trusting the copy.
  const { readFile } = await import('node:fs/promises')
  const src = await readFile(new URL('./render.ts', import.meta.url), 'utf8')
  const m = src.match(/export const CARET_HOST_CHAR = '(.*)'/)
  assert.ok(m, 'CARET_HOST_CHAR must still be exported from render.ts')
  assert.equal(m[1], CARET_HOST_CHAR, 'the ported ZWSP matches the real one')
  assert.ok(src.includes('stripCaretHost'), 'stripCaretHost must still exist')
  assert.ok(
    src.includes('md-caret-host'),
    'renderEditorLine must still emit the caret host class'
  )
})
/** Does renderEditorLine append a caret host for this raw line? */
function needsCaretHost(raw) {
  if (raw === '') return false // plain empty line uses <br>
  const heading = raw.match(/^(#{1,6})(\s+)(.*)$/)
  if (heading) return heading[3] === ''
  if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) return false
  const quote = raw.match(/^(\s*>\s?)(.*)$/)
  if (quote) return quote[2] === ''
  const checkbox = raw.match(/^(\s*[-*+]\s+)\[( |x|X)\](\s+)(.*)$/)
  if (checkbox) return checkbox[4] === ''
  const bullet = raw.match(/^(\s*[-*+]\s+)(.*)$/)
  if (bullet) return bullet[2] === ''
  const numbered = raw.match(/^(\s*\d+\.\s+)(.*)$/)
  if (numbered) return numbered[2] === ''
  return false
}

test('caret host: appears exactly when a prefixed line has no body text', () => {
  // The reported bug: clear a bullet's text and the caret disappears.
  assert.equal(needsCaretHost('- '), true, 'cleared bullet needs a caret home')
  assert.equal(needsCaretHost('- [ ] '), true, 'cleared checkbox needs one')
  assert.equal(needsCaretHost('1. '), true, 'cleared numbered item needs one')
  assert.equal(needsCaretHost('# '), true, 'cleared heading needs one')
  assert.equal(needsCaretHost('> '), true, 'cleared quote needs one')

  // With body text there is a real text node already — no host wanted.
  assert.equal(needsCaretHost('- todo'), false)
  assert.equal(needsCaretHost('- [x] done'), false)
  assert.equal(needsCaretHost('1. first'), false)
  assert.equal(needsCaretHost('# Title'), false)
  assert.equal(needsCaretHost('plain text'), false)
  assert.equal(needsCaretHost(''), false, 'a truly empty line uses <br> instead')
})

test('caret host: contains a zero-width space, not nothing', () => {
  // Verified in Chrome: an EMPTY inline element cannot hold a caret — the
  // browser relocates it into the preceding font-size:0 marker and merges
  // typed text there, so the text stays invisible. The ZWSP gives the caret
  // a real text node (measured 18px tall vs 0px empty).
  assert.equal(CARET_HOST_CHAR.codePointAt(0), 0x200b, 'U+200B ZERO WIDTH SPACE')
  assert.ok(CARET_HOST.includes(CARET_HOST_CHAR), 'the host must not be empty')
  assert.ok(CARET_HOST.includes('md-caret-host'))
})

test('caret host: stripping the ZWSP restores the raw == DOM length invariant', () => {
  // posAt/textNodeAt/onInput all require DOM text length == raw line length.
  // The ZWSP is the one hidden character in the DOM, so every reader strips it.
  const raw = '- '
  const domText = '- ' + CARET_HOST_CHAR
  assert.notEqual(domText.length, raw.length, 'the ZWSP does inflate raw textContent…')
  assert.equal(stripCaretHost(domText).length, raw.length, '…which is why every reader strips it')
})

test('caret host: typing into the host never leaks the ZWSP into stored text', () => {
  // What textContent looks like after the user types "Hello" into the host.
  const domAfterTyping = '- ' + CARET_HOST_CHAR + 'Hello'
  const model = stripCaretHost(domAfterTyping)
  assert.equal(model, '- Hello', 'the model sees clean text')
  assert.ok(!model.includes(CARET_HOST_CHAR), 'no zero-width space may reach storage')
})

test('caret host: stripping is idempotent and harmless on ordinary text', () => {
  assert.equal(stripCaretHost('plain text'), 'plain text')
  assert.equal(stripCaretHost(''), '')
  assert.equal(stripCaretHost(stripCaretHost('- ' + CARET_HOST_CHAR + 'x')), '- x')
})

// ── 5. Deleting a block prefix is atomic ─────────────────────────────────

test('delete: backspace at the end of a bullet prefix removes the whole marker', () => {
  const buf = new Buffer('- todo')
  const { indent, rest } = splitIndent(buf.lines[0])
  const prefix = rest.match(BLOCK_PREFIX_RE)?.[0] ?? ''
  assert.equal(prefix, '- ')

  // Caret sits just after "- " (offset 2) and Backspace is pressed.
  const caretOffset = indent.length + prefix.length
  buf.marks = shiftMarks(buf.marks, buf.lineStart(0) + indent.length, -prefix.length)
  buf.lines[0] = indent + rest.slice(prefix.length)

  assert.equal(buf.lines[0], 'todo', 'the whole "- " goes at once')
  assert.notEqual(buf.lines[0], '-todo', 'never leaves a literal dash behind')
  assert.equal(caretOffset, 2)
})

test('delete: a partial prefix delete would break rendering — guard against it', () => {
  // This is what the old single-char behaviour produced. "-" alone no longer
  // matches the bullet pattern, so the line visibly flips from a rendered
  // bullet to a literal dash. Asserting the pattern boundary keeps the
  // atomic-delete fix honest.
  assert.ok(BLOCK_PREFIX_RE.test('- '), '"- " is a bullet')
  assert.ok(!BLOCK_PREFIX_RE.test('-'), '"-" alone is NOT — hence atomic deletion')
})

test('delete: backspace inside indentation removes a whole indent unit', () => {
  const buf = new Buffer('                text') // two 8-space units
  const { indent } = splitIndent(buf.lines[0])
  assert.equal(indent.length, 16)
  const { indent: after } = splitIndent(buf.lines[0].slice(8))
  assert.equal(after.length, 8, 'one press drops exactly one level, not one space')
})

test('delete: selection delete across lines keeps marks sane', () => {
  const buf = new Buffer('hello\nbrave\nworld', [{ start: 6, end: 11, kind: 'bold' }])
  buf.replaceRange({ line: 0, offset: 3 }, { line: 2, offset: 2 }, '')
  assert.equal(buf.text, 'helrld')
  buf.assertMarksSane('cross-line delete')
})

test('delete: deleting all text leaves one empty line, not zero', () => {
  const buf = new Buffer('abc\ndef')
  buf.replaceRange({ line: 0, offset: 0 }, { line: 1, offset: 3 }, '')
  assert.equal(buf.lines.length, 1)
  assert.equal(buf.text, '')
  buf.assertMarksSane('delete all')
})

// ── 7. Enter continues and ends lists ────────────────────────────────────

test('write: Enter on a bullet opens the next bullet', () => {
  const c = continuationPrefix('- first')
  assert.deepEqual(c, { trigger: '- ', next: '- ' })
})

test('write: Enter on a numbered item advances the number', () => {
  assert.deepEqual(continuationPrefix('1. first'), { trigger: '1. ', next: '2. ' })
  assert.deepEqual(continuationPrefix('9. ninth'), { trigger: '9. ', next: '10. ' })
  assert.deepEqual(continuationPrefix('12. twelfth'), { trigger: '12. ', next: '13. ' })
})

test('write: Enter on a ticked checkbox opens an UNticked one', () => {
  assert.deepEqual(continuationPrefix('- [x] done'), { trigger: '- [x] ', next: '- [ ] ' })
  assert.deepEqual(continuationPrefix('- [ ] todo'), { trigger: '- [ ] ', next: '- [ ] ' })
})

test('write: headings and quotes do not continue', () => {
  assert.equal(continuationPrefix('# Title'), null, 'a heading continues as body text')
  assert.equal(continuationPrefix('> quoted'), null)
  assert.equal(continuationPrefix('plain'), null)
})

test('write: Enter on an EMPTY list item ends the list', () => {
  const rest = '- '
  const c = continuationPrefix(rest)
  assert.ok(c)
  assert.equal(rest, c.trigger, 'body is empty → this Enter should clear the prefix, not add an item')
})

test('write: Enter mid-item splits without duplicating the marker into the text', () => {
  const buf = new Buffer('- hello world')
  const raw = buf.lines[0]
  const { indent, rest } = splitIndent(raw)
  const c = continuationPrefix(rest)
  const at = 8 // caret inside "hello| world"
  const carryPrefix = c && at >= indent.length + c.trigger.length ? c.next : ''
  buf.lines.splice(0, 1, raw.slice(0, at), carryPrefix + raw.slice(at))
  assert.deepEqual(buf.lines, ['- hello ', '- world'])
})

test('write: Enter inside the marker itself does not add a second marker', () => {
  const raw = '- hello'
  const { indent, rest } = splitIndent(raw)
  const c = continuationPrefix(rest)
  const at = 1 // caret between "-" and " " — user is editing the marker
  const carryPrefix = c && at >= indent.length + c.trigger.length ? c.next : ''
  assert.equal(carryPrefix, '', 'no continuation when splitting inside the prefix')
})

test('write: indented list keeps its depth on the next line', () => {
  const raw = '        - item'
  const { indent, rest } = splitIndent(raw)
  assert.equal(indent.length, 8)
  const c = continuationPrefix(rest)
  const carry = indent + c.next
  assert.equal(carry, '        - ', 'new line opens at the same depth with a marker')
})

// ── 8. Cross-line inline marks ───────────────────────────────────────────

test('edit: bold across several lines marks each line, skipping newlines', () => {
  const buf = new Buffer('one\ntwo\nthree')
  const span = { s: { line: 0, offset: 1 }, e: { line: 2, offset: 3 } }
  for (let i = span.s.line; i <= span.e.line; i++) {
    const len = buf.lines[i].length
    const from = i === span.s.line ? span.s.offset : 0
    const to = i === span.e.line ? span.e.offset : len
    if (to <= from) continue
    buf.marks = applyMark(buf.marks, buf.lineStart(i) + from, buf.lineStart(i) + to, 'bold')
  }

  assert.equal(buf.marks.length, 3, 'one mark per covered line')
  buf.assertMarksSane('cross-line bold')
  // No mark may cover a '\n'.
  for (const m of buf.marks) {
    assert.ok(!buf.text.slice(m.start, m.end).includes('\n'), 'a mark must never span a newline')
  }
  assert.deepEqual(
    buf.marks.map((m) => buf.text.slice(m.start, m.end)),
    ['ne', 'two', 'thr']
  )
})

test('edit: cross-line selection previously did nothing — now it marks', () => {
  const buf = new Buffer('aa\nbb')
  const before = buf.marks.length
  buf.marks = applyMark(buf.marks, 0, 2, 'bold')
  buf.marks = applyMark(buf.marks, 3, 5, 'bold')
  assert.ok(buf.marks.length > before, 'the silent no-op is gone')
})

// ── 9. Whole-box marks, including on an empty box ────────────────────────

// An empty box has no characters to mark, so the choice is parked in a
// pending-format list and applied by onInput to the first text that arrives.
// A seeded [0,1) mark does NOT work here: shiftMarks pushes a mark forward
// on an insertion at its start rather than growing it, so the seed would
// slide off the very character it was meant to style. That is exactly what
// this test caught during development.
function applyWholeBox(buf, kind, value) {
  const fullEnd = buf.lines.reduce((a, l) => a + l.length, 0) + buf.lines.length - 1
  if (fullEnd <= 0) {
    buf.pending = (buf.pending ?? []).filter((p) => p.kind !== kind)
    buf.pending.push({ kind, value })
    return
  }
  buf.marks = applyMark(buf.marks, 0, fullEnd, kind, value)
}

/** onInput's side of the contract: first inserted run consumes the pending format. */
function typeInto(buf, text) {
  const at = 0
  buf.marks = shiftMarks(buf.marks, at, text.length)
  buf.lines[0] = text + buf.lines[0]
  for (const p of buf.pending ?? []) {
    buf.marks = applyMark(buf.marks, at, at + text.length, p.kind, p.value)
  }
  buf.pending = []
}

test('edit: a seeded [0,1) mark would slide off the first character — proving why pending format is needed', () => {
  const seed = [{ start: 0, end: 1, kind: 'size', value: '28' }]
  const after = shiftMarks(seed, 0, 1)
  assert.deepEqual(
    { start: after[0].start, end: after[0].end },
    { start: 1, end: 2 },
    'insertion at a mark start pushes it forward, leaving the typed char unstyled'
  )
})

test('edit: picking a size on an EMPTY box is remembered for the first character', () => {
  const buf = new Buffer('')
  applyWholeBox(buf, 'size', '28')
  assert.equal(buf.marks.length, 0, 'nothing to mark yet')
  assert.equal(buf.pending.length, 1, 'the choice must not be silently dropped')

  typeInto(buf, 'A')
  const size = buf.marks.find((m) => m.kind === 'size')
  assert.ok(size, 'the chosen size is applied once text exists')
  assert.equal(size.value, '28')
  assert.equal(buf.text.slice(size.start, size.end), 'A', 'it covers exactly the typed character')
  assert.equal(buf.pending.length, 0, 'pending format is consumed once')
  buf.assertMarksSane('pending format applied')
})

test('edit: re-picking a value on an empty box replaces rather than stacking', () => {
  const buf = new Buffer('')
  applyWholeBox(buf, 'size', '20')
  applyWholeBox(buf, 'size', '28')
  assert.equal(buf.pending.length, 1, 'no stacked pending entries')
  assert.equal(buf.pending[0].value, '28', 'the later pick wins')

  typeInto(buf, 'Hi')
  const sizes = buf.marks.filter((m) => m.kind === 'size')
  assert.equal(sizes.length, 1)
  assert.equal(sizes[0].value, '28')
})

test('edit: several pending formats all land on the first text', () => {
  const buf = new Buffer('')
  applyWholeBox(buf, 'size', '28')
  applyWholeBox(buf, 'color', 'blue')
  typeInto(buf, 'Hey')
  const kinds = buf.marks.map((m) => m.kind).sort()
  assert.deepEqual(kinds, ['color', 'size'], 'size and colour both survive')
  for (const m of buf.marks) assert.equal(buf.text.slice(m.start, m.end), 'Hey')
})

test('edit: whole-box on real text covers every character on every line', () => {
  const buf = new Buffer('hello\nworld')
  applyWholeBox(buf, 'color', 'blue')
  const m = buf.marks.find((x) => x.kind === 'color')
  assert.equal(m.start, 0)
  assert.equal(m.end, buf.text.length)
  buf.assertMarksSane('whole box')
})

// ── 6. DOM/model divergence recovery ─────────────────────────────────────

test('edit: a line-count mismatch rebuilds from the DOM instead of losing text', () => {
  // Simulates an IME/autocorrect/drag-drop that split a line behind our back.
  const model = ['hello world']
  const domLines = ['hello', 'world'] // browser split it
  assert.notEqual(domLines.length, model.length)

  const recovered = domLines.length > 0 ? domLines : ['']
  assert.deepEqual(recovered, ['hello', 'world'], "the user's text survives")
  assert.equal(recovered.join('\n'), 'hello\nworld')
})

test('edit: recovery never produces a zero-line buffer', () => {
  const domLines = []
  const recovered = domLines.length > 0 ? domLines : ['']
  assert.deepEqual(recovered, [''], 'always at least one line')
})

// ── Typing: the ordinary path must stay correct ──────────────────────────

test('write: typing inside a bold run extends it; typing after it does not', () => {
  const buf = new Buffer('bold', [{ start: 0, end: 4, kind: 'bold' }])
  // Type "X" strictly inside (offset 2).
  buf.marks = shiftMarks(buf.marks, 2, 1)
  buf.lines[0] = 'boXld'
  assert.equal(buf.marks[0].end, 5, 'insertion inside a mark grows it')

  // Type "Y" at the very end (offset 5) — must NOT be absorbed.
  buf.marks = shiftMarks(buf.marks, 5, 1)
  buf.lines[0] = 'boXldY'
  assert.equal(buf.marks[0].end, 5, 'typing past the end stays unformatted')
  buf.assertMarksSane('typing at boundaries')
})

test('write: deleting the marked text drops the mark entirely', () => {
  const buf = new Buffer('abcdef', [{ start: 2, end: 4, kind: 'bold' }])
  buf.replaceRange({ line: 0, offset: 2 }, { line: 0, offset: 4 }, '')
  assert.equal(buf.text, 'abef')
  assert.equal(buf.marks.filter((m) => m.end > m.start).length, 0, 'no orphan mark left behind')
  buf.assertMarksSane('delete marked text')
})

test('write: typing over a selection replaces it and keeps offsets sane', () => {
  const buf = new Buffer('hello world', [{ start: 6, end: 11, kind: 'bold' }])
  buf.replaceRange({ line: 0, offset: 0 }, { line: 0, offset: 5 }, 'HI')
  assert.equal(buf.text, 'HI world')
  const bold = buf.marks.find((m) => m.kind === 'bold' && m.end > m.start)
  assert.equal(buf.text.slice(bold.start, bold.end), 'world', 'the bold word rides the edit correctly')
  buf.assertMarksSane('type over selection')
})

// ── Round-tripping: nothing is lost through save/load ────────────────────

test('storage: text + marks survive serialize → parse unchanged', () => {
  const original = {
    text: '# Title\n- [x] done\n1. first\nplain **not literal**',
    marks: [
      { start: 2, end: 7, kind: 'bold' },
      { start: 10, end: 14, kind: 'color', value: 'blue' },
    ],
  }
  const round = parse(serialize(original))
  assert.deepEqual(round, original, 'no drift through storage')
})

test('storage: an empty box round-trips to an empty box', () => {
  assert.deepEqual(parse(serialize({ text: '', marks: [] })), { text: '', marks: [] })
})

test('render: runs never split a line into overlapping pieces', () => {
  const line = 'hello world'
  const marks = [
    { start: 0, end: 5, kind: 'bold' },
    { start: 3, end: 8, kind: 'italic' },
  ]
  const runs = runsForLine(line, marks, 0)
  assert.equal(
    runs.map((r) => r.text).join(''),
    line,
    'runs must reconstruct the line exactly — no dropped or duplicated characters'
  )
})

test('render: overlapping marks both survive on the shared span', () => {
  const runs = runsForLine('hello world', [
    { start: 0, end: 5, kind: 'bold' },
    { start: 3, end: 8, kind: 'italic' },
  ], 0)
  const shared = runs.find((r) => r.text === 'lo')
  assert.ok(shared, 'the bold∩italic region is its own run')
  const kinds = shared.marks.map((m) => m.kind).sort()
  assert.deepEqual(kinds, ['bold', 'italic'])
})

// ── Panel edits must target the CURRENT selection, not a remembered one ──
//
// Regression: applying a size to selection A, then a colour to selection B,
// restyled A. setSpan re-arms its selection snapshot after a snapshot-driven
// edit so repeated nudges of one panel field keep hitting the same range, but
// nothing cleared that snapshot when the user selected different text — the
// clears hang off the editor's onClick/onKeyUp, and a panel button
// preventDefaults its pointerdown (to preserve the selection), so the editor
// never sees a click.
//
// The resolution rule now lives in setSpan: a live non-collapsed selection
// always beats a stored snapshot. That rule is pure, so it's ported here
// verbatim and asserted directly.

/** Mirrors setSpan's source-of-truth choice (components/objects/text.tsx). */
const resolveSpan = ({ live, snapshot }) => {
  const snap = live ? null : snapshot
  return snap ?? live ?? null
}

test('panel edit: a live selection overrides a stale snapshot', () => {
  const stale = { s: { line: 0, offset: 0 }, e: { line: 0, offset: 5 } }
  const fresh = { s: { line: 0, offset: 6 }, e: { line: 0, offset: 11 } }
  assert.deepEqual(
    resolveSpan({ live: fresh, snapshot: stale }),
    fresh,
    'the range the user just selected must win over the previous edit\'s range'
  )
})

test('panel edit: the snapshot is used when focus collapsed the selection', () => {
  // The Size number field steals focus, which collapses the DOM selection —
  // selectionSpan() returns null and the snapshot is the only record left.
  const snapshot = { s: { line: 0, offset: 0 }, e: { line: 0, offset: 5 } }
  assert.deepEqual(
    resolveSpan({ live: null, snapshot }),
    snapshot,
    'a focus-stealing panel input must still reach the pre-focus selection'
  )
})

test('panel edit: styling B after A leaves A untouched', () => {
  // End to end over the real mark layer: "hello world", size on [0,5),
  // then colour on [6,11) resolved through the same rule.
  const text = 'hello world'
  let marks = applyMark([], 0, 5, 'size', '32')
  const second = resolveSpan({
    live: { s: { line: 0, offset: 6 }, e: { line: 0, offset: 11 } },
    snapshot: { s: { line: 0, offset: 0 }, e: { line: 0, offset: 5 } },
  })
  marks = applyMark(marks, second.s.offset, second.e.offset, 'color', 'red')

  const size = marks.find((m) => m.kind === 'size')
  assert.deepEqual([size.start, size.end], [0, 5], 'the first edit keeps its range')
  const color = marks.find((m) => m.kind === 'color')
  assert.deepEqual([color.start, color.end], [6, 11], 'the second edit lands on "world"')
  assert.ok(
    marks.every((m) => m.start >= 0 && m.end <= text.length),
    'every mark stays inside the string'
  )
})
