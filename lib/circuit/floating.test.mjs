// A circuit with loose pins is a drawing, not a circuit. Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { bundle } from '../../scripts/test/bundle.mjs'

const m = await bundle(`
export { floatingPins } from '@/lib/circuit/floating'
export { useDocStore } from '@/lib/store/document'
export { executeSimScript } from '@/lib/scene/simscript'
export { terminalsOf, terminalWorld, wireWorldPoints } from '@/lib/circuit/engine'
`, 'floating')
const pins = (script) => {
  const id = `fl-${Math.random().toString(36).slice(2, 7)}`
  m.useDocStore.getState().loadPage(id)
  m.executeSimScript(id, script, { x: 0, y: 0 })
  return m.floatingPins(Object.values(m.useDocStore.getState().pages[id].objects))
}

test('a complete circuit has no loose pins', () => {
  assert.deepEqual(pins('var bat = create("battery", { V: 9, name: "bat" });\nvar r1 = create("resistor", { R: 330, name: "r1" });\nvar am = create("ammeter", { name: "am" });\nconnect(bat.positive, am.a, "wire");\nconnect(am.b, r1.a, "wire");\nconnect(r1.b, bat.negative, "wire");'), [])
})

test('the "differential amplifier" from the lesson — transistors with only a base wired — is flagged, with the pins named', () => {
  const loose = pins('var q1 = create("bjt", { beta: 100, name: "q1" });\nvar q2 = create("bjt", { beta: 100, name: "q2" });\nvar r1 = create("resistor", { R: 2200, name: "r1" });\nvar v1 = create("ac-source", { V: 0.1, name: "v1" });\nconnect(v1.positive, q1.base, "wire");\nconnect(r1.a, q2.base, "wire");')
  const q1 = loose.filter((p) => p.name === 'q1').map((p) => p.pin).sort()
  assert.ok(loose.length >= 4, `expected loose pins, got ${JSON.stringify(loose)}`)
  assert.ok(q1.length >= 1, 'q1 has pins connected to nothing')
})

test('pins that are optional by design are not loose: an op-amp without supply pins, a ground', () => {
  assert.deepEqual(pins('var v = create("battery", { V: 1, name: "v" });\nvar op = create("opamp", { name: "op" });\nvar rf = create("resistor", { R: 1000, name: "rf" });\nvar g = create("gnd", { name: "g" });\nconnect(v.positive, op.positive, "wire");\nconnect(op.negative, rf.a, "wire");\nconnect(rf.b, op.out, "wire");\nconnect(op.negative, g.a, "wire");\nconnect(v.negative, g.a, "wire");'), [])
})

test('at runtime too, "negative" on a transistor means its LAST pin (the emitter), not the second one (the collector)', () => {
  const id = 'fl-neg'
  m.useDocStore.getState().loadPage(id)
  m.executeSimScript(id, 'var q = create("bjt", { name: "q" });\nvar r = create("resistor", { name: "r", x: 600, y: 300 });\nconnect(r.a, q.negative, "wire");', { x: 0, y: 0 })
  const objs = Object.values(m.useDocStore.getState().pages[id].objects)
  const q = objs.find((o) => o.name === 'q')
  const wire = objs.find((o) => o.geometry.kind === 'line')
  const pts = m.wireWorldPoints(wire)
  const dist = (pin) => { const w = m.terminalWorld(q, m.terminalsOf(q)[pin]); return Math.min(...[pts[0], pts.at(-1)].map((e) => Math.hypot(e[0] - w.x, e[1] - w.y))) }
  assert.ok(dist(2) < 12, 'the wire lands on the emitter')
  assert.ok(dist(1) > 12, 'and not on the collector, where the two-terminal vocabulary used to put it')
})

test('a script that positions some parts and not others does not crash the circuit layout', () => {
  const id = 'fl-mixed'
  m.useDocStore.getState().loadPage(id)
  assert.doesNotThrow(() => m.executeSimScript(id, 'var bat = create("battery", { V: 9, name: "bat", x: 400, y: 300 });\nvar r1 = create("resistor", { R: 330, name: "r1" });\nvar r2 = create("resistor", { R: 330, name: "r2" });\nconnect(bat.positive, r1.a, "wire");\nconnect(r1.b, r2.a, "wire");\nconnect(r2.b, bat.negative, "wire");', { x: 0, y: 0 }))
  assert.equal(Object.values(m.useDocStore.getState().pages[id].objects).filter((o) => o.geometry.kind === 'line').length, 3)
})
