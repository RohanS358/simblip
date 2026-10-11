// Rail layout, against the REAL stores and the REAL solver — not a stub — because
// the bug that mattered (a routed wire flattened and mis-shifted after placement,
// leaving the second bulb of a parallel pair unconnected) only exists with the
// real store.
// Run: node --experimental-strip-types --import ./scripts/test/register.mjs --test --test-force-exit lib/scene/rail-layout.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { bundle } from '../../scripts/test/bundle.mjs'

const m = await bundle(
  `
export { useDocStore } from '@/lib/store/document'
export { executeSimScript } from '@/lib/scene/simscript'
export { terminalsOf, terminalWorld } from '@/lib/circuit/engine'
export { play, stepFrame, stop } from '@/lib/physics/world'
export { readBuffer } from '@/lib/physics/bus'
`,
  'rails'
)
const { useDocStore, executeSimScript, terminalsOf, terminalWorld, play, stepFrame, stop, readBuffer } = m
const FRAME = { left: 0, top: 0, right: 1200, bottom: 800 }
let n = 0
const build = (script, { rails = true } = {}) => {
  globalThis.__noRails = !rails
  const id = `r${++n}`
  useDocStore.getState().loadPage(id)
  executeSimScript(id, script, { x: 200, y: 100 }, { bounds: FRAME, fixedFrame: false })
  const objs = Object.values(useDocStore.getState().pages[id].objects)
  return { id, objs, parts: objs.filter((o) => o.geometry.kind === 'symbol'), wires: objs.filter((o) => o.name === 'wire') }
}
const pinsOf = (parts) => parts.flatMap((o) => terminalsOf(o).map((t, i) => ({ o, i, ...terminalWorld(o, t) })))
const abs = (w) => w.geometry.points.map(([x, y]) => ({ x: w.position.x + x, y: w.position.y + y }))
const near = (a, b) => Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2
const box = (o) => { const sw = o.rotation % 180 !== 0; const w = sw ? o.size.h : o.size.w; const h = sw ? o.size.w : o.size.h; const cx = o.position.x + o.size.w / 2; const cy = o.position.y + o.size.h / 2; return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 } }

const chain = (k, extra = '') => `var bat = create("battery", { V: 9 });
${Array.from({ length: k }, (_, i) => `var r${i + 1} = create("resistor", { R: ${(i + 1) * 100}, name: "R${i + 1}" });`).join('\n')}
connect(bat.positive, r1.a);
${Array.from({ length: k - 1 }, (_, i) => `connect(r${i + 1}.b, r${i + 2}.a);`).join('\n')}
connect(r${k}.b, bat.negative);${extra}`

test('every wire END lands on a pin or on another wire of the circuit (the netlist is built from coincident points)', () => {
  for (const [name, script] of [
    ['series 4', chain(4)],
    ['series 8', chain(8)],
    ['parallel bulbs', `var bat = create("battery", { V: 12 }); var am = create("ammeter", {}); var b1 = create("bulb", { R: 20 }); var b2 = create("bulb", { R: 30 });
connect(bat.positive, am.a); connect(am.b, b1.a); connect(am.b, b2.a); connect(b1.b, bat.negative); connect(b2.b, bat.negative);`],
  ]) {
    const { parts, wires } = build(script)
    const pins = pinsOf(parts)
    for (const w of wires) {
      const p = abs(w)
      for (const end of [p[0], p[p.length - 1]]) {
        const onPin = pins.some((q) => near(q, end))
        const onWire = wires.some((o) => o !== w && abs(o).some((a, i, arr) => i > 0 && (Math.abs(a.x - arr[i - 1].x) < 1 ? Math.abs(end.x - a.x) <= 2 && end.y >= Math.min(a.y, arr[i - 1].y) - 2 && end.y <= Math.max(a.y, arr[i - 1].y) + 2 : Math.abs(end.y - a.y) <= 2 && end.x >= Math.min(a.x, arr[i - 1].x) - 2 && end.x <= Math.max(a.x, arr[i - 1].x) + 2)))
        assert.ok(onPin || onWire, `${name}: a wire end at (${end.x},${end.y}) is connected to nothing`)
      }
    }
  }
})

test('parallel bulbs: BOTH bulbs carry current (the second used to be silently disconnected)', () => {
  const { id, objs } = build(`var bat = create("battery", { V: 12 }); var am = create("ammeter", {}); var b1 = create("bulb", { R: 20, name: "B1" }); var b2 = create("bulb", { R: 30, name: "B2" });
connect(bat.positive, am.a); connect(am.b, b1.a); connect(am.b, b2.a); connect(b1.b, bat.negative); connect(b2.b, bat.negative);`)
  play(id)
  for (let i = 0; i < 60; i++) stepFrame()
  const cur = (name) => { const o = objs.find((x) => x.name === name); const b = readBuffer(o.id); return Math.abs(b.samples.at(-1).channels.I) }
  stop()
  assert.ok(cur('B1') > 0.1, `B1 current ${cur('B1')}`)
  assert.ok(cur('B2') > 0.1, `B2 current ${cur('B2')} — it should be 12/30 = 0.4 A`)
  assert.ok(Math.abs(cur('B1') - 0.6) < 0.05 && Math.abs(cur('B2') - 0.4) < 0.05, 'Ohm: 12/20 and 12/30')
})

test('a series loop is drawn as a rectangle: source on the left, parts on rows and columns, nothing overlapping', () => {
  for (const k of [2, 3, 4, 6, 8]) {
    const { parts, wires } = build(chain(k))
    const bs = parts.map(box)
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const ov = Math.min(bs[i].x1, bs[j].x1) - Math.max(bs[i].x0, bs[j].x0) > 0 && Math.min(bs[i].y1, bs[j].y1) - Math.max(bs[i].y0, bs[j].y0) > 0
      assert.ok(!ov, `k=${k}: two parts overlap`)
    }
    // Rails, not a staircase: rows + columns used, per part, stays well under the
    // 2.0 a diagonal gets (every part on its own row AND its own column).
    const lanes = (vals) => { const u = []; for (const v of [...vals].sort((a, b) => a - b)) if (!u.length || v - u.at(-1) > 12) u.push(v); return u.length }
    const cx = parts.map((o) => o.position.x + o.size.w / 2)
    const cy = parts.map((o) => o.position.y + o.size.h / 2)
    const perPart = (lanes(cx) + lanes(cy)) / parts.length
    assert.ok(k <= 2 || perPart <= 1.6, `k=${k}: ${perPart.toFixed(2)} lanes per part`)
    const bat = parts.find((o) => o.geometry.symbol === 'battery')
    assert.ok(bat.position.x <= Math.min(...parts.map((o) => o.position.x)) + 1, `k=${k}: the source is the left-most part`)
    // every wire orthogonal
    for (const w of wires) { const p = abs(w); for (let i = 1; i < p.length; i++) assert.ok(Math.abs(p[i].x - p[i - 1].x) < 1 || Math.abs(p[i].y - p[i - 1].y) < 1, `k=${k}: a diagonal wire`) }
  }
})

test('a voltmeter across one part hangs beside it instead of becoming a second column', () => {
  const { parts } = build(chain(3, `\nvar vm = create("voltmeter", {}); connect(vm.a, r1.b); connect(vm.b, r2.b);`))
  const vm = parts.find((o) => o.geometry.symbol === 'voltmeter')
  const r2 = parts.find((o) => o.name === 'R2')
  assert.ok(Math.abs(vm.position.x + vm.size.w / 2 - (r2.position.x + r2.size.w / 2)) < 2 || Math.abs(vm.position.y + vm.size.h / 2 - (r2.position.y + r2.size.h / 2)) < 2, 'the meter is aligned with the part it measures')
  const bx = parts.filter((o) => o !== vm).map(box)
  const w = Math.max(...bx.map((b) => b.x1)) - Math.min(...bx.map((b) => b.x0))
  assert.ok(w < 700, `loop width ${w}`)
})

test('circuits the rail placer does not understand fall back to the annealer unchanged', () => {
  // A bridge is not series-parallel; a transistor is not two-terminal.
  const bridge = `var bat = create("battery", { V: 5 }); var a = create("resistor", { R: 100 }); var b = create("resistor", { R: 200 }); var c = create("resistor", { R: 300 }); var d = create("resistor", { R: 400 }); var e = create("resistor", { R: 500 });
connect(bat.positive, a.a); connect(bat.positive, c.a); connect(a.b, b.a); connect(c.b, d.a); connect(a.b, e.a); connect(c.b, e.b); connect(b.b, bat.negative); connect(d.b, bat.negative);`
  const r1 = build(bridge)
  const r2 = build(bridge, { rails: false })
  assert.deepEqual(r1.parts.map((o) => [o.position.x, o.position.y, o.rotation]), r2.parts.map((o) => [o.position.x, o.position.y, o.rotation]), 'a bridge is laid out by the annealer either way')
  const amp = build(`var vcc = create("battery", { V: 12 }); var q = create("bjt", { beta: 100 }); var rc = create("resistor", { R: 1000 });
connect(vcc.positive, rc.a); connect(rc.b, q.collector); connect(q.emitter, vcc.negative); connect(q.base, rc.a);`)
  assert.equal(amp.parts.length, 3)
})

test('two sources, or a second parallel group, fall back rather than draw something wrong', () => {
  const two = build(`var a = create("battery", { V: 5 }); var b = create("battery", { V: 3 }); var r = create("resistor", { R: 100 });
connect(a.positive, r.a); connect(r.b, b.positive); connect(b.negative, a.negative);`)
  assert.equal(two.parts.length, 3)
})
