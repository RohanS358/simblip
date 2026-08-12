// Regression test for the Inspector's field gestures.
//
// The bug this locks down: `scrubbable` defaulted to true and 19 of 20 call
// sites took the default, so dragging on an object name, a variable name or
// an expression ran `Number(value)` on text and committed the NaN. A 4px
// accidental drag renamed your object to "NaN". Arrow keys did the same.
//
// No test framework in this project — run it directly:
//   node components/workspace/expr-input.test.mjs
//
// The predicate is mirrored from inspector.tsx (a .tsx React module can't be
// imported here). Keep in sync with isNumericValue.

import assert from 'node:assert/strict'

const isNumericValue = (v) => v.trim() !== '' && Number.isFinite(Number(v))

// ── never scrub anything that isn't a plain number ──────────────────────────
// Every one of these used to be draggable and would commit "NaN".
for (const v of [
  'Mass 1',        // object name
  'my_var',        // variable name
  'sin(x)',        // expression
  '2*g',           // expression referencing a variable
  'Machine A — 4-year purchase', // cash-flow description
  'auto',          // graph axis range placeholder
  '[Voltmeter 1(V)]', // live-ref token
  'NaN',
  'Infinity',      // Number() accepts it; scrubbing it is meaningless
  '',              // Number('') === 0 — used to invent "10" out of nothing
  '   ',
]) {
  assert.equal(isNumericValue(v), false, `${JSON.stringify(v)} must NOT be scrubbable`)
}

// ── real numbers still scrub ────────────────────────────────────────────────
for (const v of ['12', '-3.5', '0', ' 7 ', '1e3', '0.001', '-0']) {
  assert.equal(isNumericValue(v), true, `${JSON.stringify(v)} must be scrubbable`)
}

// ── the scrub arithmetic itself, once the guard has passed ──────────────────
const scrub = (start, dx, mods = {}) => {
  const sensitivity = mods.shift ? 5 : mods.alt ? 0.05 : 0.5
  return String(Math.round((Number(start) + dx * sensitivity) * 1000) / 1000)
}
assert.equal(scrub('10', 20), '20', 'default sensitivity')
assert.equal(scrub('10', 20, { shift: true }), '110', 'shift = coarse')
assert.equal(scrub('10', 20, { alt: true }), '11', 'alt = fine')
assert.equal(scrub('10', -20), '0', 'dragging left decreases')
// Never produces NaN for a value that passed the guard.
for (const v of ['12', '-3.5', '0', '1e3']) {
  assert.ok(!scrub(v, 37).includes('NaN'), `${v} scrubs cleanly`)
}

// ── arrow nudge uses the same guard ─────────────────────────────────────────
const nudge = (v, dir, mods = {}) => {
  if (!isNumericValue(v)) return v // guarded: text is returned untouched
  const step = mods.shift ? 10 : mods.alt ? 0.01 : 1
  return String(Math.round((Number(v) + dir * step) * 1000) / 1000)
}
assert.equal(nudge('Mass 1', 1), 'Mass 1', 'arrow key leaves a name alone')
assert.equal(nudge('auto', -1), 'auto', 'arrow key leaves "auto" alone')
assert.equal(nudge('5', 1), '6')
assert.equal(nudge('5', 1, { shift: true }), '15')
assert.equal(nudge('5', -1, { alt: true }), '4.99')

// ── undo coalescing: commit-on-blur vs per-keystroke ────────────────────────
// Raw <input onChange> pushed one history entry per keystroke; the store
// coalesces only within 400ms, so a deliberate typist got one undo step per
// CHARACTER. Commit-on-blur is one entry per edit, at any typing speed.
const COALESCE_MS = 400
const entriesForTyping = (gaps) => {
  let last = -Infinity
  let t = 0
  let n = 0
  for (const g of gaps) {
    t += g
    if (t - last >= COALESCE_MS) {
      n++
      last = t
    }
  }
  return n
}
assert.equal(entriesForTyping([0, 500, 500, 500]), 4, 'per-keystroke: 4 entries for "2500"')
assert.equal(entriesForTyping([0]), 1, 'commit-on-blur: exactly one entry')

console.log('expr-input: all checks passed')
