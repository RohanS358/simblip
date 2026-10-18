// Run: node --experimental-strip-types --import ./scripts/test/register.mjs --test lib/sketch/neural-pick.test.mjs
//
// The acceptance rules for a held symbol, with a fake network so each rule is
// tested on its own. The numbers in the first test are real: the first
// mouse-drawn resistor scored resistor 0.59 / unknown 0.34 against the model
// trained on generated strokes.

import test from 'node:test'
import assert from 'node:assert/strict'
import { pickNeural, bestSymbol, NEURAL_MIN_P } from './neural-pick.ts'

const pred = (top, pose = 0) => ({ cls: top[0][0], conf: top[0][1], top: top.map(([cls, conf]) => ({ cls, conf })), pose, poseConf: 0.9 })
/** A network whose answer depends only on how many strokes it is shown. */
const netBy = (byCount) => ({ predict: (strokes) => byCount[strokes.length] ?? pred([['unknown', 0.99], ['resistor', 0.005], ['diode', 0.005]]) })
const line = (x0, y0, x1, y1) => [[x0, y0], [x1, y1]]

test('a real first stroke: resistor 0.59 beats unknown 0.34 and is accepted', () => {
  const net = netBy({ 1: pred([['resistor', 0.59], ['unknown', 0.34], ['inductor', 0.05]]) })
  const r = pickNeural(net, line(0, 0, 80, 10), [])
  assert.equal(r.kind, 'place')
  assert.equal(r.cls, 'resistor')
  assert.deepEqual(r.absorb, [])
})

test('confident "unknown" with nothing else plausible is declined, with a reason', () => {
  const net = netBy({ 1: pred([['unknown', 0.96], ['capacitor', 0.02], ['switch', 0.01]]) })
  const r = pickNeural(net, line(0, 0, 80, 10), [])
  assert.equal(r.kind, 'decline')
  assert.match(r.message, /capacitor 2%/)
})

test('a vague best guess below the bar is declined and says so', () => {
  const net = netBy({ 1: pred([['unknown', 0.7], ['diode', NEURAL_MIN_P - 0.1], ['led', 0.1]]) })
  const r = pickNeural(net, line(0, 0, 80, 10), [])
  assert.equal(r.kind, 'decline')
  assert.match(r.message, /diode/)
})

test('bestSymbol skips unknown wherever it sits in the ranking', () => {
  assert.deepEqual(bestSymbol(pred([['unknown', 0.6], ['battery', 0.3], ['gnd', 0.1]])), { cls: 'battery', p: 0.3 })
  assert.equal(bestSymbol({ cls: 'unknown', conf: 1, top: [{ cls: 'unknown', conf: 1 }], pose: 0, poseConf: 1 }), null)
})

test('two touching strokes read as one symbol: the group is placed and the old strokes absorbed', () => {
  const net = netBy({
    1: pred([['unknown', 0.9], ['capacitor', 0.05], ['switch', 0.03]]),
    2: pred([['battery', 0.82], ['capacitor', 0.1], ['unknown', 0.05]], 90),
  })
  const plate = { id: 'a', pts: line(100, 0, 100, 40) }
  const r = pickNeural(net, line(112, 10, 112, 30), [plate])
  assert.equal(r.kind, 'place')
  assert.equal(r.cls, 'battery')
  assert.equal(r.pose, 90)
  assert.deepEqual(r.absorb, ['a'])
  assert.deepEqual(r.box, { x0: 100, y0: 0, x1: 112, y1: 40 }, 'box covers the whole group')
})

test('a lone stroke that already reads well does not swallow its neighbours', () => {
  const net = netBy({
    1: pred([['resistor', 0.7], ['unknown', 0.2], ['inductor', 0.05]]),
    2: pred([['inductor', 0.74], ['resistor', 0.2], ['unknown', 0.03]]), // better, but not by enough
  })
  const r = pickNeural(net, line(0, 0, 80, 10), [{ id: 'n', pts: line(0, 5, 80, 12) }])
  assert.equal(r.cls, 'resistor')
  assert.deepEqual(r.absorb, [])
})

test('a clearly better group does win over an acceptable lone stroke', () => {
  const net = netBy({
    1: pred([['resistor', 0.5], ['unknown', 0.4], ['inductor', 0.05]]),
    2: pred([['capacitor', 0.9], ['unknown', 0.05], ['battery', 0.03]]),
  })
  const r = pickNeural(net, line(0, 0, 0, 40), [{ id: 'n', pts: line(10, 0, 10, 40) }])
  assert.equal(r.cls, 'capacitor')
  assert.deepEqual(r.absorb, ['n'])
})

test('strokes that are far away are never pulled in', () => {
  const net = netBy({ 1: pred([['resistor', 0.6], ['unknown', 0.3], ['inductor', 0.05]]) })
  const r = pickNeural(net, line(0, 0, 80, 10), [{ id: 'far', pts: line(500, 500, 560, 520) }])
  assert.deepEqual(r.absorb, [])
})

test('grouping chains through neighbours and stops at the cap', () => {
  const seen = []
  const net = { predict: (s) => { seen.push(s.length); return pred([['unknown', 0.99], ['resistor', 0.005], ['diode', 0.005]]) } }
  const chain = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, pts: line(i * 20, 0, i * 20 + 10, 10) }))
  pickNeural(net, line(-20, 0, -5, 10), chain)
  assert.ok(Math.max(...seen) <= 7, `group of ${Math.max(...seen)} strokes`)
})
