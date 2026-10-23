// Circuit diagnosis from connections alone: the questions a tutor asks ("why does the LED not light?").
// Hand-written circuits, no recogniser. Run: node --experimental-strip-types --import ./scripts/test/register.mjs --test --test-force-exit lib/sketch/diagnose.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { diagnoseCircuit } from './diagnose.ts'

const node = (id, cls) => ({ id, cls, conf: 1, bbox: [0, 0, 10, 10], rot: 0, source: 'ink' })
const e = (a, ap, b, bp) => ({ a: { node: a, pin: ap }, b: { node: b, pin: bp }, kind: 'wire', conf: 1 })
const ir = (nodes, edges) => ({ domain: 'circuit', nodes: nodes.map(([id, cls]) => node(id, cls)), edges, labels: [], doubts: [] })
const kinds = (f) => f.map((x) => x.kind).sort()

// battery + → resistor → LED anode, LED cathode → battery −   (a working LED circuit)
const good = ir([['b', 'battery'], ['r', 'resistor'], ['d', 'led']], [e('b', 'positive', 'r', 'a'), e('r', 'b', 'd', 'anode'), e('d', 'cathode', 'b', 'negative')])

test('a correct LED circuit has nothing to report', () => {
  assert.deepEqual(diagnoseCircuit(good), [])
})

test('an LED in backwards is named, with the fix', () => {
  const rev = ir([['b', 'battery'], ['r', 'resistor'], ['d', 'led']], [e('b', 'positive', 'r', 'a'), e('r', 'b', 'd', 'cathode'), e('d', 'anode', 'b', 'negative')])
  const f = diagnoseCircuit(rev)
  assert.deepEqual(kinds(f), ['backwards'])
  assert.match(f[0].message, /led.*in backwards/i)
  assert.match(f[0].message, /anode to its cathode/)
  assert.deepEqual(f[0].parts, ['d'])
})

test('a missing wire: the terminal that joins nothing is named, and the loop is called open', () => {
  const broken = ir([['b', 'battery'], ['r', 'resistor'], ['d', 'led']], [e('b', 'positive', 'r', 'a'), e('r', 'b', 'd', 'anode')])
  const f = diagnoseCircuit(broken)
  assert.ok(kinds(f).includes('floating'))
  const led = f.find((x) => x.kind === 'floating' && x.parts.includes('d'))
  assert.match(led.message, /led.*cathode.*joined to nothing/i)
  assert.ok(f.some((x) => x.kind === 'floating' && x.parts.includes('b')), 'and the battery terminal that was meant to join it')
})

test('no source at all', () => {
  const f = diagnoseCircuit(ir([['r', 'resistor'], ['d', 'led']], [e('r', 'b', 'd', 'anode'), e('d', 'cathode', 'r', 'a')]))
  assert.ok(kinds(f).includes('no-source'))
})

test('an LED straight across the battery would burn out: no series resistor', () => {
  const f = diagnoseCircuit(ir([['b', 'battery'], ['d', 'led']], [e('b', 'positive', 'd', 'anode'), e('d', 'cathode', 'b', 'negative')]))
  assert.deepEqual(kinds(f), ['no-resistor'])
  assert.match(f[0].message, /no resistor in series/)
})

test('a short circuit: only wire and a switch between the terminals', () => {
  const f = diagnoseCircuit(ir([['b', 'battery'], ['s', 'switch']], [e('b', 'positive', 's', 'a'), e('s', 'b', 'b', 'negative')]))
  assert.deepEqual(kinds(f), ['short'])
  // two terminals wired directly together
  const w = diagnoseCircuit(ir([['b', 'battery']], [e('b', 'positive', 'b', 'negative')]))
  assert.deepEqual(kinds(w), ['short'])
})

test('a capacitor in series blocks DC, and says so rather than "broken somewhere"', () => {
  const f = diagnoseCircuit(ir([['b', 'battery'], ['c', 'capacitor'], ['r', 'resistor']], [e('b', 'positive', 'c', 'a'), e('c', 'b', 'r', 'a'), e('r', 'b', 'b', 'negative')]))
  assert.deepEqual(kinds(f), ['blocked'])
  assert.match(f[0].message, /capacitor blocks it/)
})

test('a loop with a resistor but no way round is "open", and two resistors in parallel are fine', () => {
  const open = diagnoseCircuit(ir([['b', 'battery'], ['r1', 'resistor'], ['r2', 'resistor']], [e('b', 'positive', 'r1', 'a'), e('r1', 'b', 'r2', 'a'), e('r2', 'b', 'b', 'negative'), ]))
  assert.deepEqual(open, [])
  const dead = diagnoseCircuit(ir([['b', 'battery'], ['r1', 'resistor'], ['r2', 'resistor']], [e('b', 'positive', 'r1', 'a'), e('r1', 'b', 'r2', 'a'), e('r2', 'b', 'r1', 'b'), e('b', 'negative', 'b', 'negative')]))
  assert.ok(kinds(dead).includes('open') || kinds(dead).includes('floating'))
})

test('parts it does not understand make the answer say so instead of guessing', () => {
  const f = diagnoseCircuit(ir([['b', 'battery'], ['g', 'and-gate'], ['r', 'resistor']], [e('b', 'positive', 'r', 'a'), e('r', 'b', 'b', 'negative')]))
  assert.ok(kinds(f).includes('unsupported'))
  assert.match(f.find((x) => x.kind === 'unsupported').message, /and gate/)
})

test('a drawn LED circuit drawn from layout data diagnoses cleanly (the reader and the diagnosis agree on pin names)', async () => {
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const { layouts } = JSON.parse(readFileSync(resolve(import.meta.dirname, 'golden/scene-layouts.json'), 'utf8'))
  let checked = 0
  for (const l of layouts) {
    const classes = new Set(l.ir.nodes.map((n) => n.cls))
    if (![...classes].every((c) => ['battery', 'resistor', 'led', 'diode', 'bulb', 'switch', 'inductor', 'capacitor'].includes(c))) continue
    const f = diagnoseCircuit(l.ir)
    for (const x of f) assert.ok(['no-source', 'open', 'backwards', 'short', 'no-resistor', 'blocked', 'floating', 'unsupported'].includes(x.kind))
    checked++
  }
  assert.ok(checked >= 4, `checked ${checked} layouts`)
})
