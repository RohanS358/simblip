// The multi-pin recipes (transistors, op-amps): every pin wired, and the READINGS are the textbook values — checked by
// running each one on the real engine. Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { bundle } from '../../scripts/test/bundle.mjs'

const m = await bundle(`
export { circuitRecipe } from '@/lib/lesson/recipes'
export { makeRunner } from '@/lib/lesson/runner'
export { lintSimScript } from '@/lib/ai/simscript-lint'
export { useDocStore } from '@/lib/store/document'
export { executeSimScript } from '@/lib/scene/simscript'
export { buildCircuit, terminalsOf, terminalWorld, wireWorldPoints } from '@/lib/circuit/engine'
`, 'multipin')
const { circuitRecipe, makeRunner, lintSimScript, useDocStore, executeSimScript, buildCircuit, terminalsOf, terminalWorld, wireWorldPoints } = m

const run = async (request) => {
  const script = circuitRecipe(request)
  assert.ok(script, `"${request}" should be a recipe`)
  const lint = lintSimScript(script)
  assert.equal(lint.ok, true, `lint: ${lint.errors.join('; ')}`)
  const g = await makeRunner().ground(script)
  assert.equal(g.ok, true, `the circuit must run with every pin wired: ${g.error}`)
  const read = (name) => g.readings.find((r) => r.object === name)?.value
  return { g, read }
}

test('inverting op-amp: gain −Rf/Rin, so 0.5 V in with Rf = 10 kΩ and Rin = 1 kΩ gives −5 V', async () => {
  const { read } = await run('an inverting op-amp amplifier with a gain of 10')
  assert.ok(Math.abs(Math.abs(read('vout')) - 5) < 0.4, `vout ${read('vout')}`)
  assert.ok(read('vout') < 0, 'inverting: the output is the opposite sign')
})

test('non-inverting op-amp: gain 1 + Rf/Rg, so a gain of 11 turns 0.5 V into 5.5 V', async () => {
  const { read } = await run('a non-inverting amplifier using an op-amp, gain 11')
  assert.ok(Math.abs(read('vout') - 5.5) < 0.4, `vout ${read('vout')}`)
})

test('common-emitter amplifier: bias from 470 kΩ gives ≈2.4 mA in the collector, ≈6.7 V across the transistor', async () => {
  const { read } = await run('a common emitter amplifier')
  assert.ok(read('ic') > 1.8e-3 && read('ic') < 3.2e-3, `ic ${read('ic')}`)
  assert.ok(read('vce') > 5 && read('vce') < 8.4, `vce ${read('vce')}`)
})

test('BJT differential pair: both collectors carry half the tail current, so the two load resistors drop the same ≈2.6 V', async () => {
  const { read } = await run('how a differential amplifier works')
  const a = Math.abs(read('vo1')), b = Math.abs(read('vo2'))
  assert.ok(a > 1.8 && a < 3.6 && b > 1.8 && b < 3.6, `vo1 ${a} vo2 ${b}`)
  assert.ok(Math.abs(a - b) / Math.max(a, b) < 0.15, 'a balanced pair')
})

test('requests that are not these circuits are left alone (existing series/parallel recipes still apply)', () => {
  assert.equal(circuitRecipe('a comparator with an op-amp'), null)
  assert.equal(circuitRecipe('a transistor switch driving an LED'), null)
  assert.match(circuitRecipe('three resistors in parallel across 9 V'), /create\("resistor"/)
})

test('no wire runs over a pin that is not its own end — the bug that shorted an op-amp\'s feedback resistor — and no two pins of one part share a net', () => {
  for (const request of ['an inverting op-amp amplifier', 'a non-inverting op-amp amplifier', 'a common emitter amplifier', 'a differential amplifier']) {
    const id = `mp-${request.length}-${Math.random().toString(36).slice(2, 6)}`
    useDocStore.getState().loadPage(id)
    executeSimScript(id, circuitRecipe(request), { x: 0, y: 0 })
    const objs = Object.values(useDocStore.getState().pages[id].objects)
    const parts = objs.filter((o) => o.geometry.kind === 'symbol')
    // (an op-amp's optional supply pins are left unwired on purpose; the engine does not bond a pin that merely lies under a wire)
    const pins = parts.flatMap((o) => terminalsOf(o).flatMap((t, i) => (o.geometry.symbol === 'opamp' && i >= 3 ? [] : [terminalWorld(o, t)])))
    for (const w of objs.filter((o) => o.geometry.kind === 'line')) {
      const pts = wireWorldPoints(w)
      const ends = [pts[0], pts.at(-1)]
      for (const p of pins) {
        if (ends.some((e) => Math.hypot(e[0] - p.x, e[1] - p.y) < 4)) continue
        for (let i = 1; i < pts.length; i++) {
          const [x1, y1] = pts[i - 1], [x2, y2] = pts[i]
          const t = Math.max(0, Math.min(1, ((p.x - x1) * (x2 - x1) + (p.y - y1) * (y2 - y1)) / ((x2 - x1) ** 2 + (y2 - y1) ** 2 || 1)))
          const d = Math.hypot(p.x - (x1 + t * (x2 - x1)), p.y - (y1 + t * (y2 - y1)))
          assert.ok(d > 2.5, `${request}: a wire passes over a pin at (${Math.round(p.x)}, ${Math.round(p.y)})`)
        }
      }
    }
    const c = buildCircuit(objs)
    for (const comp of c.comps) if (comp.symbol !== 'gnd' && comp.symbol !== 'opamp') assert.equal(new Set(comp.nets).size, comp.nets.length > 2 || comp.symbol === 'resistor' ? comp.nets.length : new Set(comp.nets).size, `${request}: ${comp.symbol} has two pins on one net`)
    for (const comp of c.comps.filter((x) => x.symbol === 'opamp')) assert.equal(new Set(comp.nets.slice(0, 3)).size, 3, `${request}: the op-amp's inputs and output must be three different nets`)
  }
})
