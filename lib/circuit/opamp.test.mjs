// Op-amp supply rails + the linear-regulator circuit from the syllabus.
// Run: node --test lib/circuit/opamp.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'opamp-'))
const entry = join(dir, 'e.ts')
const out = join(dir, 'o.mjs')
writeFileSync(entry, `
export { buildCircuit, stepCircuit, terminalsOf, terminalWorld } from '@/lib/circuit/engine'
export { componentById, fromRecognition } from '@/lib/scene/factory'
export { createBehavior } from '@/lib/behaviors/registry'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${out}`, `--alias:@=${root}`, '--platform=node'], { cwd: root, stdio: 'pipe' })
const m = await import(out)

function scene() {
  const objs = {}
  const part = (id, x, y, params = {}) => {
    const o = m.componentById(id).create({ x, y })
    for (const [k, v] of Object.entries(params)) o.parameters[k] = { kind: 'number', value: v }
    objs[o.id] = o
    return o
  }
  const pin = (o, i) => m.terminalWorld(o, m.terminalsOf(o)[i])
  const wire = (a, ia, b, ib) => {
    const p = pin(a, ia), r = pin(b, ib)
    const w = m.fromRecognition({ kind: 'line', points: [[0, 0], [r.x - p.x, r.y - p.y]], x: p.x, y: p.y, w: Math.abs(r.x - p.x) || 2, h: Math.abs(r.y - p.y) || 2 })
    w.behaviors.push(m.createBehavior('wire'))
    objs[w.id] = w
  }
  const run = (steps = 120) => {
    const c = m.buildCircuit(Object.values(objs))
    for (let i = 0; i < steps; i++) m.stepCircuit(c, 1 / 120, i / 120, objs)
    return c
  }
  return { objs, part, wire, run }
}
const amps = (c, o) => c.comps.find((k) => k.id === o.id).outflow // current INTO each net

/** Inverting amp, gain −10, Vin = 2 V, load 1 kΩ. Optional ±5 V supplies. Returns Vout. */
function inverting({ supplies }) {
  const { part, wire, run } = scene()
  const vin = part('battery', 0, 0, { V: 2 })
  const rin = part('resistor', 300, 200, { R: 1000 })
  const rf = part('resistor', 300, 500, { R: 10000 })
  const op = part('opamp', 700, 100)
  const rl = part('resistor', 1000, 100, { R: 1000 })
  const g = part('gnd', 450, 60)
  const g2 = part('gnd', 0, 250)
  wire(vin, 0, rin, 0); wire(vin, 1, g2, 0)
  wire(rin, 1, op, 1); wire(rf, 0, op, 1)          // Rin → −, Rf from −
  wire(rf, 1, op, 2)                               // Rf to out
  wire(op, 0, g, 0)                                // + to ground
  const g3 = part('gnd', 1000, 300)
  wire(op, 2, rl, 0); wire(rl, 1, g3, 0)
  if (supplies) {
    const vcc = part('battery', 600, -250, { V: 5 })
    const vee = part('battery', 600, 420, { V: 5 })
    const g4 = part('gnd', 850, -330), g5 = part('gnd', 400, 480)
    wire(vcc, 0, op, 3); wire(vcc, 1, g4, 0)       // +5 V on V+
    wire(vee, 0, g5, 0); wire(vee, 1, op, 4)       // −5 V on V−
  }
  const c = run()
  return amps(c, rl)[1] * 1000 // I(a→b) · R = Vout (b is ground)
}

test('ideal (supplies unwired): no limit, output −20 V', () => {
  const v = inverting({ supplies: false })
  assert.ok(Math.abs(v - -20) < 0.2, `Vout ${v}`)
})

test('with ±5 V supplies the output clips at the lower rail + headroom (−4.5 V)', () => {
  const v = inverting({ supplies: true })
  assert.ok(Math.abs(v - -4.5) < 0.1, `Vout ${v}`)
})

/** Pass-transistor regulator (Vref 5 V, R2 100 Ω / R1 1 kΩ, load 30 Ω). Op-amp supplied from VIN. */
function regulator(vinV) {
  const { part, wire, run } = scene()
  const vin = part('battery', 0, 0, { V: vinV })
  const v1 = part('battery', 0, 400, { V: 5 })
  const r1 = part('resistor', 1200, 700, { R: 1000 })
  const r2 = part('resistor', 1200, 300, { R: 100 })
  const ro = part('resistor', 600, 100, { R: 1000 })
  const rl = part('resistor', 1800, 500, { R: 30 })
  const op = part('opamp', 500, 500)
  const q = part('bjt', 900, 100, { beta: 100 })
  const [g1, g2, g3, g4, g5] = [part('gnd', 0, 200), part('gnd', 0, 600), part('gnd', 1200, 900), part('gnd', 1800, 800), part('gnd', 500, 800)]
  wire(vin, 0, q, 1); wire(vin, 1, g1, 0)
  wire(vin, 0, op, 3); wire(op, 4, g5, 0)          // supplies: VIN and ground
  wire(q, 2, r2, 0); wire(q, 2, rl, 0)
  wire(r2, 1, r1, 0); wire(r2, 1, op, 1)
  wire(r1, 1, g3, 0); wire(rl, 1, g4, 0)
  wire(v1, 0, op, 0); wire(v1, 1, g2, 0)
  wire(op, 2, ro, 0); wire(ro, 1, q, 0)
  const c = run(240)
  return amps(c, rl)[1] * 30
}

test('regulator holds Vref·(1+R2/R1) = 5.5 V with plenty of headroom (VIN 9 V)', () => {
  const v = regulator(9)
  assert.ok(Math.abs(v - 5.5) < 0.05, `Vout ${v}`)
})

test('regulator drops out when VIN is too low to drive the pass transistor (VIN 6.5 V)', () => {
  const v = regulator(6.5)
  assert.ok(v < 5.4, `Vout ${v} should sag below 5.5`)
})
