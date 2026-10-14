// BJT model: settable Vbe, real current gain, saturation.
// Run: node --test lib/circuit/bjt.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'bjt-'))
const entry = join(dir, 'e.ts')
const out = join(dir, 'o.mjs')
writeFileSync(entry, `
export { buildCircuit, stepCircuit, terminalsOf, terminalWorld } from '@/lib/circuit/engine'
export { componentById, fromRecognition } from '@/lib/scene/factory'
export { createBehavior } from '@/lib/behaviors/registry'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${out}`, `--alias:@=${root}`, '--platform=node'], { cwd: root, stdio: 'pipe' })
const m = await import(out)

/** Common-emitter: 9 V → Rc → C, 9 V → Rb → B, E → ground. Returns {ib, ic}. */
function run({ sym = 'bjt', Rb, Rc, beta = 100, Vbe }) {
  const part = (id, x, y, params = {}) => {
    const o = m.componentById(id).create({ x, y })
    for (const [k, v] of Object.entries(params)) o.parameters[k] = { kind: 'number', value: v }
    return o
  }
  const pnp = sym === 'bjt-pnp'
  const bat = part('battery', 0, 200, { V: 9 })
  const rb = part('resistor', 200, 0, { R: Rb })
  const rc = part('resistor', 200, 400, { R: Rc })
  const q = part(sym, 400, 100, { beta, ...(Vbe ? { Vbe } : {}) })
  const gnd = part('gnd', 400, 330)
  const rail = pnp ? 1 : 0 // NPN loads hang off +9 V, PNP off the emitter rail
  const objs = {}
  for (const o of [bat, rb, rc, q, gnd]) objs[o.id] = o
  const pin = (o, i) => m.terminalWorld(o, m.terminalsOf(o)[i])
  const wire = (a, ia, b, ib) => {
    const p = pin(a, ia), r = pin(b, ib)
    const w = m.fromRecognition({ kind: 'line', points: [[0, 0], [r.x - p.x, r.y - p.y]], x: p.x, y: p.y, w: Math.abs(r.x - p.x) || 2, h: Math.abs(r.y - p.y) || 2 })
    w.behaviors.push(m.createBehavior('wire'))
    objs[w.id] = w
  }
  if (!pnp) {
    wire(bat, 0, rb, 0); wire(bat, 0, rc, 0)        // +9 V to both resistors
    wire(rb, 1, q, 0); wire(rc, 1, q, 1)            // Rb → B, Rc → C
    wire(q, 2, gnd, 0); wire(bat, 1, gnd, 0)        // E and battery − to ground
  } else {
    wire(bat, 0, q, 2); wire(bat, 1, gnd, 0)        // PNP emitter on +9 V
    wire(q, 0, rb, 0); wire(rb, 1, gnd, 0)          // B → Rb → ground
    wire(q, 1, rc, 0); wire(rc, 1, gnd, 0)          // C → Rc → ground
  }
  const c = m.buildCircuit(Object.values(objs))
  for (let i = 0; i < 40; i++) m.stepCircuit(c, 1 / 120, i / 120, objs)
  const comp = c.comps.find((k) => k.id === q.id)
  return { ib: Math.abs(comp.outflow[0]), ic: Math.abs(comp.outflow[1]), mode: comp.state.on }
}

test('forward-active: Ic = beta · Ib, with Ib set by Vbe', () => {
  const r = run({ Rb: 1e6, Rc: 1e3 })
  const ib = (9 - 0.7) / (1e6 + 100)
  assert.ok(Math.abs(r.ib - ib) / ib < 0.02, `Ib ${r.ib} vs ${ib}`)
  assert.ok(Math.abs(r.ic - 100 * ib) / (100 * ib) < 0.02, `Ic ${r.ic} vs ${100 * ib}`)
  assert.equal(r.mode, 1)
})

test('Vbe is a parameter: 0.6 V gives more base current than 0.7 V', () => {
  const a = run({ Rb: 1e6, Rc: 1e3, Vbe: 0.6 })
  const b = run({ Rb: 1e6, Rc: 1e3, Vbe: 0.7 })
  assert.ok(a.ib > b.ib * 1.005, `${a.ib} vs ${b.ib}`)
})

test('beta is real: doubling it doubles Ic', () => {
  const a = run({ Rb: 1e6, Rc: 1e3, beta: 50 })
  const b = run({ Rb: 1e6, Rc: 1e3, beta: 100 })
  assert.ok(Math.abs(b.ic / a.ic - 2) < 0.05, `${b.ic / a.ic}`)
})

test('saturates when the load limits Ic below beta · Ib', () => {
  const r = run({ Rb: 1e4, Rc: 1e3 })
  assert.equal(r.mode, 2)
  assert.ok(Math.abs(r.ic - 9 / 1005) < 0.0006, `Ic ${r.ic}`) // ≈ 9 V / (Rc + Rsat)
})

test('PNP mirrors it', () => {
  const r = run({ sym: 'bjt-pnp', Rb: 1e6, Rc: 1e3 })
  const ib = (9 - 0.7) / (1e6 + 100)
  assert.ok(Math.abs(r.ic - 100 * ib) / (100 * ib) < 0.03, `Ic ${r.ic} vs ${100 * ib}`)
})
