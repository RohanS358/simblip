// Run: node --experimental-strip-types --import ./scripts/test/register.mjs --test lib/sketch/values.test.mjs
//
// Reading "4.7k" from ink: grouping strokes into characters and lines, naming
// them, the unit rules, and which part a value belongs to. A fake character
// network stands in so each rule is tested on its own; the real one is checked
// against PyTorch in inkchars.test.mjs.

import test from 'node:test'
import assert from 'node:assert/strict'
import { attachValues, findText, readText, CHAR_MIN_P } from './values.ts'
import { shapeOf } from './extract.ts'

const LABELS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'k', 'M', 'm', 'u', 'n', 'p', 'V', 'A', 'F', 'H', 'Ω']
const UNKNOWN_CODE = 30

/** A character is a vertical stroke whose LENGTH encodes its label — the fake net decodes that. */
const char = (id, x, y, label) => {
  const code = label === '?' ? UNKNOWN_CODE : LABELS.indexOf(label)
  return { id, pts: [[x, y], [x + 1, y + 28 + code]] }
}
const dot = (id, x, y) => ({ id, pts: [[x, y], [x + 2, y], [x + 2, y + 2], [x, y + 2], [x, y]] })
const sh = (strokes) => strokes.map(shapeOf)

/** Names a single stroke from its length; anything else (a pair of strokes, an unknown code) is 'unknown'. */
const fakeChars = {
  predict: (strokes) => {
    if (strokes.length !== 1) return { cls: 'unknown', conf: 0.9, top: [{ cls: 'unknown', conf: 0.9 }], pose: 0, poseConf: 1 }
    const s = strokes[0]
    const len = Math.round(Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) - 28)
    const label = LABELS[len]
    return label
      ? { cls: label, conf: 0.99, top: [{ cls: label, conf: 0.99 }], pose: 0, poseConf: 1 }
      : { cls: 'unknown', conf: 0.95, top: [{ cls: 'unknown', conf: 0.95 }], pose: 0, poseConf: 1 }
  },
}
const U = 100
const row = (text, x0 = 100, y = 200, gap = 26) => {
  let x = x0
  return [...text].map((ch, i) => {
    const s = ch === '.' ? dot(`d${i}`, x + 2, y + 26) : char(`c${i}`, x, y, ch)
    x += gap
    return s
  })
}

test('a line of characters is read left to right, with the decimal point between them', () => {
  const r = readText(sh(row('4.7k')), fakeChars, U)
  assert.equal(r.length, 1)
  assert.equal(r[0].text, '4.7k')
  assert.equal(r[0].ok, true)
  assert.equal(r[0].strokeIds.length, 4)
})

test('units are read with the number: 9V, 100n, 10mH, 470Ω', () => {
  for (const text of ['9V', '100n', '10mH', '470Ω', '2.2u', '1M']) {
    const r = readText(sh(row(text)), fakeChars, U)
    assert.equal(r[0]?.text, text)
    assert.equal(r[0]?.ok, true, text)
  }
})

test('a misread unit letter does not spoil a good number; a misread digit does', () => {
  const trailing = readText(sh(row('10k?')), fakeChars, U)
  assert.equal(trailing[0].text, '10k')
  assert.equal(trailing[0].ok, true)
  const middle = readText(sh(row('1?k')), fakeChars, U)
  assert.equal(middle[0].ok, false, 'a hole in the middle is not guessed')
})

test('marks the network cannot name are not text at all', () => {
  const r = readText(sh(row('????')), fakeChars, U)
  assert.deepEqual(r, [])
})

test('two lines far apart are two readings', () => {
  const r = readText(sh([...row('10k', 100, 100), ...row('9V', 100, 400).map((s) => ({ ...s, id: s.id + 'b' }))]), fakeChars, U)
  assert.deepEqual(r.map((x) => x.text).sort(), ['10k', '9V'])
})

test('touching characters are split when the whole cluster has no name but its pieces do', () => {
  // "2" and "k" written so close their boxes overlap: the fake net cannot name the pair
  const a = char('a', 100, 200, '2')
  const b = char('b', 104, 200, 'k')
  const r = readText(sh([a, b]), fakeChars, U)
  assert.equal(r.length, 1)
  assert.equal(r[0].text, '2k')
})

test('findText: a line the symbol network is sure of is a symbol, not text', () => {
  const strokes = sh(row('11', 100, 200, 14)) // a battery's plates look like "11"
  const asBattery = { predict: () => ({ cls: 'battery', conf: 0.99, top: [{ cls: 'battery', conf: 0.99 }], pose: 0, poseConf: 1 }) }
  const asNothing = { predict: () => ({ cls: 'unknown', conf: 0.95, top: [{ cls: 'unknown', conf: 0.95 }, { cls: 'battery', conf: 0.02 }], pose: 0, poseConf: 1 }) }
  assert.deepEqual(findText(strokes, strokes, asBattery, fakeChars, U), [])
  assert.equal(findText(strokes, strokes, asNothing, fakeChars, U)[0].text, '11')
})

test('findText: strokes drawn inside another stroke (the V of a voltmeter) are never text', () => {
  const circle = { id: 'circle', pts: Array.from({ length: 40 }, (_, i) => [200 + 40 * Math.cos(i / 6.2), 200 + 40 * Math.sin(i / 6.2)]) }
  const v = char('v', 198, 190, 'V')
  const asNothing = { predict: () => ({ cls: 'unknown', conf: 0.95, top: [{ cls: 'unknown', conf: 0.95 }], pose: 0, poseConf: 1 }) }
  const bodies = sh([circle, v])
  assert.deepEqual(findText([bodies[1]], bodies, asNothing, fakeChars, U), [])
})

const part = (id, cls, x0, y0, x1, y1) => ({ id, cls, box: { x0, y0, x1, y1 } })

test('attachValues: a value goes to the nearest part, as that part\'s main parameter', () => {
  const parts = [part('n1', 'resistor', 100, 100, 200, 140), part('n2', 'resistor', 100, 400, 200, 440)]
  const reads = readText(sh([...row('4.7k', 110, 40), ...row('10k', 110, 330).map((s) => ({ ...s, id: s.id + 'b' }))]), fakeChars, U)
  const { attached, leftover } = attachValues(parts, reads, U)
  const byPart = Object.fromEntries(attached.map((a) => [a.partId, a]))
  assert.equal(byPart.n1.text, '4.7k')
  assert.equal(byPart.n1.param, 'R')
  assert.equal(byPart.n2.text, '10k')
  assert.equal(leftover.length, 0)
})

test('attachValues: a unit that belongs to another parameter is not forced onto the part', () => {
  const parts = [part('r', 'resistor', 100, 100, 200, 140), part('b', 'battery', 250, 100, 290, 160)]
  const reads = readText(sh(row('9V', 110, 40)), fakeChars, U)
  const { attached } = attachValues(parts, reads, 160)
  // the resistor is nearer, but 9V is a voltage: it can only belong to the battery
  assert.deepEqual(attached.map((a) => [a.partId, a.param]), [['b', 'V']])
})

test('attachValues: too far away, or on a part with no value, is left alone', () => {
  const parts = [part('g', 'gnd', 100, 100, 160, 140), part('r', 'resistor', 1000, 1000, 1100, 1040)]
  const reads = readText(sh(row('4.7k', 110, 40)), fakeChars, U)
  const { attached, leftover } = attachValues(parts, reads, U)
  assert.deepEqual(attached, [])
  assert.equal(leftover.length, 1)
})

test('attachValues: two labels never fight over one part', () => {
  const parts = [part('r', 'resistor', 100, 100, 200, 140)]
  const reads = readText(sh([...row('4.7k', 110, 40), ...row('10k', 110, 200).map((s) => ({ ...s, id: s.id + 'b' }))]), fakeChars, U)
  const { attached, leftover } = attachValues(parts, reads, U)
  assert.equal(attached.length, 1)
  assert.equal(leftover.length, 1)
})

test('nothing to read gives nothing, not an error', () => {
  assert.deepEqual(readText([], fakeChars, U), [])
  assert.deepEqual(attachValues([], [], U), { attached: [], leftover: [] })
  assert.ok(CHAR_MIN_P > 0 && CHAR_MIN_P < 1)
})
