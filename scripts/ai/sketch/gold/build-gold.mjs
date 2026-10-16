// Writes the gold Scene-IR set (Phase S0 exit criterion: every gold IR
// compiles, lints, and simulates).
//
//   node scripts/ai/sketch/gold/build-gold.mjs
//
// Each circuit below is written as a compact netlist — parts and wires — and
// expanded into a full Scene IR (bboxes, confidences, pose) so the checked-in
// JSON is exactly what a perfect recogniser would emit. The JSON files are the
// artefacts; this script only exists so a human can read 44 circuits at a
// glance and fix one without hand-editing coordinates.
//
// `expect` is what the real circuit engine must report after compiling:
//   { part, channel, value, tol }   relative tolerance (default 5 %)
//   { part, channel, value, abs }   absolute tolerance, for zeros
//   { part, channel, min / max }    one-sided bound

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = dirname(fileURLToPath(import.meta.url))

const P = (id, cls, values) => ({ id, cls, values })
const W = (a, b) => [a, b]
const pin = (s) => {
  const i = s.indexOf('.')
  return { node: s.slice(0, i), pin: s.slice(i + 1) }
}

/** Parts that carry a polarity/orientation in a real sketch; others are upright. */
const toIR = (domain, parts, wires) => ({
  domain,
  nodes: parts.map((p, i) => ({
    id: p.id,
    cls: p.cls,
    conf: 1,
    bbox: [40 + (i % 6) * 110, 40 + Math.floor(i / 6) * 90, 60, 30],
    rot: 0,
    ...(p.values ? { values: p.values } : {}),
    source: 'ink',
  })),
  edges: wires.map(([a, b]) => ({ a: pin(a), b: pin(b), kind: 'wire', conf: 1 })),
  labels: [],
  doubts: [],
})

const SPECS = []
const circuit = (name, description, parts, wires, expect = []) =>
  SPECS.push({ name, description, domain: 'circuit', parts, wires, expect })
const digital = (name, description, parts, wires, expect = []) =>
  SPECS.push({ name, description, domain: 'digital', parts, wires, expect })

const bat = (id, V) => P(id, 'battery', { V })

// ── Series and parallel ────────────────────────────────────────────────────
circuit('series-two-resistors', '12 V across 1k + 2k in series → 4 mA.',
  [bat('b1', '12'), P('r1', 'resistor', { R: '1k' }), P('r2', 'resistor', { R: '2k' })],
  [W('b1.positive', 'r1.a'), W('r1.b', 'r2.a'), W('r2.b', 'b1.negative')],
  [{ part: 'r1', channel: 'I', value: 0.004 }, { part: 'r2', channel: 'I', value: 0.004 }])

circuit('series-three-resistors', '9 V across 100 + 200 + 700 ohm in series → 9 mA.',
  [bat('b1', '9'), P('r1', 'resistor', { R: '100' }), P('r2', 'resistor', { R: '200' }), P('r3', 'resistor', { R: '700' })],
  [W('b1.positive', 'r1.a'), W('r1.b', 'r2.a'), W('r2.b', 'r3.a'), W('r3.b', 'b1.negative')],
  [{ part: 'r2', channel: 'I', value: 0.009 }])

circuit('parallel-two-resistors', 'Two 1k resistors straight across 10 V → 10 mA each.',
  [bat('b1', '10'), P('r1', 'resistor', { R: '1k' }), P('r2', 'resistor', { R: '1k' })],
  [W('b1.positive', 'r1.a'), W('r1.b', 'b1.negative'), W('b1.positive', 'r2.a'), W('r2.b', 'b1.negative')],
  [{ part: 'r1', channel: 'I', value: 0.01 }, { part: 'r2', channel: 'I', value: 0.01 }])

circuit('parallel-bank-three', '1k, 2k, 3k across 12 V → 12, 6, 4 mA.',
  [bat('b1', '12'), P('r1', 'resistor', { R: '1k' }), P('r2', 'resistor', { R: '2k' }), P('r3', 'resistor', { R: '3k' })],
  [W('b1.positive', 'r1.a'), W('r1.b', 'b1.negative'), W('b1.positive', 'r2.a'), W('r2.b', 'b1.negative'),
   W('b1.positive', 'r3.a'), W('r3.b', 'b1.negative')],
  [{ part: 'r1', channel: 'I', value: 0.012 }, { part: 'r2', channel: 'I', value: 0.006 }, { part: 'r3', channel: 'I', value: 0.004 }])

circuit('series-parallel', '1k in series with (2k ∥ 2k) from 12 V → 6 mA total, 3 mA per branch.',
  [bat('b1', '12'), P('r1', 'resistor', { R: '1k' }), P('r2', 'resistor', { R: '2k' }), P('r3', 'resistor', { R: '2k' })],
  [W('b1.positive', 'r1.a'), W('r1.b', 'r2.a'), W('r1.b', 'r3.a'), W('r2.b', 'b1.negative'), W('r3.b', 'b1.negative')],
  [{ part: 'r1', channel: 'I', value: 0.006 }, { part: 'r2', channel: 'I', value: 0.003 }])

circuit('voltage-divider', 'Equal resistors halve 10 V.',
  [bat('b1', '10'), P('r1', 'resistor', { R: '1k' }), P('r2', 'resistor', { R: '1k' })],
  [W('b1.positive', 'r1.a'), W('r1.b', 'r2.a'), W('r2.b', 'b1.negative')],
  [{ part: 'r2', channel: 'V', value: 5 }])

circuit('divider-gnd-voltmeter', 'Divider with a ground symbol and a voltmeter across the lower resistor.',
  [bat('b1', '10'), P('r1', 'resistor', { R: '1k' }), P('r2', 'resistor', { R: '1k' }), P('g1', 'gnd'), P('vm1', 'voltmeter')],
  [W('b1.positive', 'r1.a'), W('r1.b', 'r2.a'), W('r2.b', 'b1.negative'), W('g1.terminal', 'b1.negative'),
   W('vm1.a', 'r2.a'), W('vm1.b', 'r2.b')],
  [{ part: 'vm1', channel: 'V', value: 5 }])

circuit('bulb-series', 'A 20 ohm bulb in series with 70 ohm from 9 V → 100 mA.',
  [bat('b1', '9'), P('l1', 'bulb', { R: '20' }), P('r1', 'resistor', { R: '70' })],
  [W('b1.positive', 'l1.a'), W('l1.b', 'r1.a'), W('r1.b', 'b1.negative')],
  [{ part: 'l1', channel: 'I', value: 0.1 }])

circuit('ammeter-series', 'An ammeter in series reads the loop current: 6 V / 300 ohm = 20 mA.',
  [bat('b1', '6'), P('r1', 'resistor', { R: '300' }), P('am1', 'ammeter')],
  [W('b1.positive', 'r1.a'), W('r1.b', 'am1.a'), W('am1.b', 'b1.negative')],
  [{ part: 'am1', channel: 'I', value: 0.02 }])

circuit('batteries-series-aiding', 'Two 3 V cells stacked (+ to −) behind 600 ohm → 10 mA.',
  [bat('b1', '3'), bat('b2', '3'), P('r1', 'resistor', { R: '600' })],
  [W('b1.positive', 'r1.a'), W('r1.b', 'b2.negative'), W('b2.positive', 'b1.negative')],
  [{ part: 'r1', channel: 'I', value: 0.01 }])

circuit('switch-open', 'An open switch breaks the loop → no current.',
  [bat('b1', '9'), P('s1', 'switch', { closed: '0' }), P('r1', 'resistor', { R: '100' })],
  [W('b1.positive', 's1.a'), W('s1.b', 'r1.a'), W('r1.b', 'b1.negative')],
  [{ part: 'r1', channel: 'I', value: 0, abs: 1e-4 }])

circuit('fuse-series', 'A 1 A fuse passes 50 mA without blowing.',
  [bat('b1', '5'), P('f1', 'fuse', { Imax: '1' }), P('r1', 'resistor', { R: '100' })],
  [W('b1.positive', 'f1.a'), W('f1.b', 'r1.a'), W('r1.b', 'b1.negative')],
  [{ part: 'r1', channel: 'I', value: 0.05 }])

circuit('wheatstone-bridge', 'Balanced bridge of four 1k resistors: the meter across the middle reads 0 V.',
  [bat('b1', '10'), P('r1', 'resistor', { R: '1k' }), P('r2', 'resistor', { R: '1k' }),
   P('r3', 'resistor', { R: '1k' }), P('r4', 'resistor', { R: '1k' }), P('vm1', 'voltmeter')],
  [W('b1.positive', 'r1.a'), W('r1.b', 'r3.a'), W('r3.b', 'b1.negative'),
   W('b1.positive', 'r2.a'), W('r2.b', 'r4.a'), W('r4.b', 'b1.negative'),
   W('vm1.a', 'r1.b'), W('vm1.b', 'r2.b')],
  [{ part: 'vm1', channel: 'V', value: 0, abs: 0.01 }])

circuit('current-source-load', 'A 10 mA source into 100 ohm → 1 V.',
  [P('i1', 'current-source', { I: '10m' }), P('r1', 'resistor', { R: '100' })],
  [W('i1.positive', 'r1.a'), W('r1.b', 'i1.negative')],
  [{ part: 'r1', channel: 'V', value: 1 }])

circuit('pot-divider', 'A 1k pot at mid-travel feeding a 1k load: 10 V → 4 V.',
  [bat('b1', '10'), P('p1', 'potentiometer', { R: '1k', ratio: '0.5' }), P('rl', 'resistor', { R: '1k' })],
  [W('b1.positive', 'p1.top'), W('p1.bottom', 'b1.negative'), W('p1.wiper', 'rl.a'), W('rl.b', 'b1.negative')],
  [{ part: 'rl', channel: 'V', value: 4, tol: 0.1 }])

// ── Diodes ─────────────────────────────────────────────────────────────────
circuit('led-resistor', 'Switch, 330 ohm and an LED from 5 V: about 9 mA.',
  [bat('b1', '5'), P('s1', 'switch', { closed: '1' }), P('r1', 'resistor', { R: '330' }), P('d1', 'led')],
  [W('b1.positive', 's1.a'), W('s1.b', 'r1.a'), W('r1.b', 'd1.anode'), W('d1.cathode', 'b1.negative')],
  [{ part: 'r1', channel: 'I', value: 0.0091, tol: 0.3 }])

circuit('led-reversed', 'The same LED drawn backwards: no current — the lesson "why does it not light?".',
  [bat('b1', '5'), P('r1', 'resistor', { R: '330' }), P('d1', 'led')],
  [W('b1.positive', 'r1.a'), W('r1.b', 'd1.cathode'), W('d1.anode', 'b1.negative')],
  [{ part: 'r1', channel: 'I', value: 0, abs: 1e-3 }])

circuit('diode-forward', '5 V, 1k and a silicon diode: about 4.3 mA.',
  [bat('b1', '5'), P('r1', 'resistor', { R: '1k' }), P('d1', 'diode')],
  [W('b1.positive', 'r1.a'), W('r1.b', 'd1.anode'), W('d1.cathode', 'b1.negative')],
  [{ part: 'r1', channel: 'I', value: 0.0043, tol: 0.3 }])

circuit('diode-reverse', 'Diode reversed: blocks.',
  [bat('b1', '5'), P('r1', 'resistor', { R: '1k' }), P('d1', 'diode')],
  [W('b1.positive', 'r1.a'), W('r1.b', 'd1.cathode'), W('d1.anode', 'b1.negative')],
  [{ part: 'r1', channel: 'I', value: 0, abs: 1e-3 }])

circuit('half-wave-rectifier', 'AC source, diode and load — structural.',
  [P('ac1', 'ac-source', { V: '5', f: '50' }), P('d1', 'diode'), P('r1', 'resistor', { R: '1k' })],
  [W('ac1.positive', 'd1.anode'), W('d1.cathode', 'r1.a'), W('r1.b', 'ac1.negative')])

circuit('zener-regulator', '12 V through 470 ohm into a 5.1 V zener with a 1k load: the load sits near 5.1 V.',
  [bat('b1', '12'), P('r1', 'resistor', { R: '470' }), P('z1', 'zener', { Vz: '5.1' }), P('r2', 'resistor', { R: '1k' })],
  [W('b1.positive', 'r1.a'), W('r1.b', 'z1.cathode'), W('r1.b', 'r2.a'), W('z1.anode', 'b1.negative'), W('r2.b', 'b1.negative')],
  [{ part: 'r2', channel: 'V', value: 5.1, tol: 0.15 }])

// ── Reactive ───────────────────────────────────────────────────────────────
circuit('rc-charge', 'A capacitor charging through 1k — structural.',
  [bat('b1', '5'), P('r1', 'resistor', { R: '1k' }), P('c1', 'capacitor', { C: '100u' })],
  [W('b1.positive', 'r1.a'), W('r1.b', 'c1.a'), W('c1.b', 'b1.negative')])

circuit('rl-circuit', 'An inductor in series with a resistor — structural.',
  [bat('b1', '5'), P('r1', 'resistor', { R: '100' }), P('l1', 'inductor', { L: '10m' })],
  [W('b1.positive', 'r1.a'), W('r1.b', 'l1.a'), W('l1.b', 'b1.negative')])

circuit('rlc-series-ac', 'Series RLC from an AC source — structural.',
  [P('ac1', 'ac-source', { V: '10', f: '100' }), P('r1', 'resistor', { R: '50' }),
   P('l1', 'inductor', { L: '10m' }), P('c1', 'capacitor', { C: '10u' })],
  [W('ac1.positive', 'r1.a'), W('r1.b', 'l1.a'), W('l1.b', 'c1.a'), W('c1.b', 'ac1.negative')])

circuit('transformer-load', 'AC into a 2:1 transformer feeding a resistor — structural.',
  [P('ac1', 'ac-source', { V: '10', f: '50' }), P('t1', 'transformer', { n: '2' }), P('r1', 'resistor', { R: '100' })],
  [W('ac1.positive', 't1.primary+'), W('ac1.negative', 't1.primary-'),
   W('t1.secondary+', 'r1.a'), W('r1.b', 't1.secondary-')])

// ── Transistors and op-amps ────────────────────────────────────────────────
circuit('bjt-switch', 'NPN saturated through a 10k base resistor: the collector load carries milliamps.',
  [bat('b1', '5'), P('rb', 'resistor', { R: '10k' }), P('rc', 'resistor', { R: '1k' }), P('q1', 'bjt')],
  [W('b1.positive', 'rb.a'), W('rb.b', 'q1.base'), W('b1.positive', 'rc.a'),
   W('rc.b', 'q1.collector'), W('q1.emitter', 'b1.negative')],
  [{ part: 'rc', channel: 'I', min: 0.003 }])

circuit('bjt-bias-divider', 'Common-emitter stage with a base divider and emitter resistor.',
  [bat('b1', '12'), P('r1', 'resistor', { R: '47k' }), P('r2', 'resistor', { R: '10k' }),
   P('rc', 'resistor', { R: '2.2k' }), P('re', 'resistor', { R: '1k' }), P('q1', 'bjt')],
  [W('b1.positive', 'r1.a'), W('r1.b', 'r2.a'), W('r1.b', 'q1.base'), W('r2.b', 'b1.negative'),
   W('b1.positive', 'rc.a'), W('rc.b', 'q1.collector'), W('q1.emitter', 're.a'), W('re.b', 'b1.negative')],
  [{ part: 'rc', channel: 'I', min: 0.0005 }])

circuit('mosfet-switch', 'NMOS driven by a 5 V gate supply switches a 1k load.',
  [bat('b1', '5'), bat('b2', '5'), P('rd', 'resistor', { R: '1k' }), P('m1', 'mosfet')],
  [W('b2.positive', 'm1.gate'), W('b2.negative', 'b1.negative'), W('b1.positive', 'rd.a'),
   W('rd.b', 'm1.drain'), W('m1.source', 'b1.negative')],
  [{ part: 'rd', channel: 'I', min: 0.001 }])

circuit('opamp-inverting', 'Inverting amplifier, gain −10: 1 V in drives 1 mA through the feedback resistor.',
  [bat('vin', '1'), P('rin', 'resistor', { R: '1k' }), P('rf', 'resistor', { R: '10k' }), P('op1', 'opamp'), P('g1', 'gnd')],
  [W('vin.positive', 'rin.a'), W('rin.b', 'op1.in-'), W('rf.a', 'op1.in-'), W('rf.b', 'op1.out'),
   W('op1.in+', 'g1.terminal'), W('vin.negative', 'g1.terminal')],
  [{ part: 'rf', channel: 'I', value: 0.001, tol: 0.1 }])

circuit('opamp-follower', 'Voltage follower holds 3 V across a 1k load.',
  [bat('vin', '3'), P('op1', 'opamp'), P('rl', 'resistor', { R: '1k' }), P('g1', 'gnd')],
  [W('vin.positive', 'op1.in+'), W('op1.out', 'op1.in-'), W('op1.out', 'rl.a'),
   W('rl.b', 'g1.terminal'), W('vin.negative', 'g1.terminal')],
  [{ part: 'rl', channel: 'V', value: 3, tol: 0.1 }])

// ── Digital ────────────────────────────────────────────────────────────────
const gate2 = (name, kind, a, b, out, description) =>
  digital(name, description,
    [P('in1', 'input', { value: String(a) }), P('in2', 'input', { value: String(b) }), P('g1', kind), P('out1', 'output')],
    [W('in1.output', 'g1.input1'), W('in2.output', 'g1.input2'), W('g1.output', 'out1.input')],
    [{ part: 'out1', channel: 'value', value: out, abs: 0.01 }])

gate2('and-1-1', 'and-gate', 1, 1, 1, 'AND of 1,1 is 1.')
gate2('and-1-0', 'and-gate', 1, 0, 0, 'AND of 1,0 is 0.')
gate2('or-0-1', 'or-gate', 0, 1, 1, 'OR of 0,1 is 1.')
gate2('xor-1-1', 'xor-gate', 1, 1, 0, 'XOR of 1,1 is 0.')
gate2('nand-1-1', 'nand-gate', 1, 1, 0, 'NAND of 1,1 is 0.')
gate2('nor-0-0', 'nor-gate', 0, 0, 1, 'NOR of 0,0 is 1.')

digital('not-1', 'NOT of 1 is 0.',
  [P('in1', 'input', { value: '1' }), P('g1', 'not-gate'), P('out1', 'output')],
  [W('in1.output', 'g1.input'), W('g1.output', 'out1.input')],
  [{ part: 'out1', channel: 'value', value: 0, abs: 0.01 }])

digital('half-adder-gates', 'XOR + AND build a half adder: 1+1 → sum 0, carry 1.',
  [P('ina', 'input', { value: '1' }), P('inb', 'input', { value: '1' }), P('x1', 'xor-gate'), P('a1', 'and-gate'),
   P('os', 'output'), P('oc', 'output')],
  [W('ina.output', 'x1.input1'), W('inb.output', 'x1.input2'), W('ina.output', 'a1.input1'), W('inb.output', 'a1.input2'),
   W('x1.output', 'os.input'), W('a1.output', 'oc.input')],
  [{ part: 'os', channel: 'value', value: 0, abs: 0.01 }, { part: 'oc', channel: 'value', value: 1, abs: 0.01 }])

digital('half-adder-block', 'The half-adder block: 1+1 → sum 0, carry 1.',
  [P('ina', 'input', { value: '1' }), P('inb', 'input', { value: '1' }), P('ha', 'half-adder'), P('os', 'output'), P('oc', 'output')],
  [W('ina.output', 'ha.a'), W('inb.output', 'ha.b'), W('ha.sum', 'os.input'), W('ha.carry', 'oc.input')],
  [{ part: 'os', channel: 'value', value: 0, abs: 0.01 }, { part: 'oc', channel: 'value', value: 1, abs: 0.01 }])

digital('full-adder-block', 'The full-adder block: 1+1+1 → sum 1, carry 1.',
  [P('ina', 'input', { value: '1' }), P('inb', 'input', { value: '1' }), P('inc', 'input', { value: '1' }),
   P('fa', 'full-adder'), P('os', 'output'), P('oc', 'output')],
  [W('ina.output', 'fa.a'), W('inb.output', 'fa.b'), W('inc.output', 'fa.cin'), W('fa.sum', 'os.input'), W('fa.carry', 'oc.input')],
  [{ part: 'os', channel: 'value', value: 1, abs: 0.01 }, { part: 'oc', channel: 'value', value: 1, abs: 0.01 }])

digital('mux-select', '2:1 mux with select=1 passes in1.',
  [P('i0', 'input', { value: '0' }), P('i1', 'input', { value: '1' }), P('sel', 'input', { value: '1' }),
   P('m1', 'mux'), P('out1', 'output')],
  [W('i0.output', 'm1.in0'), W('i1.output', 'm1.in1'), W('sel.output', 'm1.sel'), W('m1.out', 'out1.input')],
  [{ part: 'out1', channel: 'value', value: 1, abs: 0.01 }])

digital('sr-latch-set', 'Set=1, reset=0 drives Q high.',
  [P('s', 'input', { value: '1' }), P('r', 'input', { value: '0' }), P('l1', 'sr-latch'), P('out1', 'output')],
  [W('s.output', 'l1.s'), W('r.output', 'l1.r'), W('l1.q', 'out1.input')],
  [{ part: 'out1', channel: 'value', value: 1, abs: 0.01 }])

digital('d-ff-clock', 'D flip-flop clocked at 1 Hz — structural.',
  [P('d', 'input', { value: '1' }), P('clk', 'clock', { f: '1' }), P('ff', 'd-ff'), P('out1', 'output')],
  [W('d.output', 'ff.d'), W('clk.output', 'ff.clk'), W('ff.q', 'out1.input')])

digital('counter-clock', '4-bit counter on a clock — structural.',
  [P('clk', 'clock', { f: '1' }), P('c1', 'counter4'), P('o0', 'output'), P('o1', 'output')],
  [W('clk.output', 'c1.clk'), W('c1.q0', 'o0.input'), W('c1.q1', 'o1.input')])

mkdirSync(OUT, { recursive: true })
for (const s of SPECS) {
  const file = { name: s.name, description: s.description, ir: toIR(s.domain, s.parts, s.wires), expect: s.expect }
  writeFileSync(join(OUT, `${s.name}.json`), JSON.stringify(file, null, 2) + '\n')
}
console.log(`wrote ${SPECS.length} gold IR files to ${OUT}`)
