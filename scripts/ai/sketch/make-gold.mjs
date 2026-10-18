// Regenerates scripts/ai/sketch/gold/*.json from the compact specs below.
// Run: node scripts/ai/sketch/make-gold.mjs
// The JSON files are the artefact (hand-editable); this only saves typing.
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const out = join(import.meta.dirname, 'gold')
mkdirSync(out, { recursive: true })

// "r1:resistor{R=1k}" → node; "a.p-b.q" → wire edge. Pins are SimScript anchors.
const parseNode = (s, i, domain) => {
  const m = s.match(/^(\w+):([\w+-]+?)(?:\{(.*)\})?$/)
  const [, id, cls, vals] = m
  const values = vals ? Object.fromEntries(vals.split(',').map((kv) => kv.split('='))) : undefined
  const placed = domain === 'mechanics' || domain === 'optics'
  return { id, cls, conf: 0.95, bbox: placed ? [60 + i * 120, 200, 100, 60] : [40 + i * 90, 60, 60, 30], rot: 0, ...(values ? { values } : {}), source: 'ink' }
}
const parseEdge = (s, kind = 'wire') => {
  const [, a, b] = s.match(/^(\w+(?:\.[\w+-]+?)?)-(\w+(?:\.[\w+-]+)?)$/)
  const [an, ap = 'centre'] = a.split('.')
  const [bn, bp = 'centre'] = b.split('.')
  return { a: { node: an, pin: ap }, b: { node: bn, pin: bp }, kind, conf: 0.95 }
}
const make = (name, domain, nodes, wires, extra = []) => {
  const ir = {
    domain,
    nodes: nodes.map((n, i) => parseNode(n, i, domain)),
    edges: [...wires.map((w) => parseEdge(w)), ...extra.map(([k, w]) => parseEdge(w, k))],
    labels: [], doubts: [],
  }
  writeFileSync(join(out, name + '.json'), JSON.stringify(ir, null, 2) + '\n')
}

// ── circuits (24) ──
make('series-bulb', 'circuit', ['b:battery{V=9}', 'r:resistor{R=330}', 'l:bulb'], ['b.positive-r.a', 'r.b-l.a', 'l.b-b.negative'])
make('series-two-r', 'circuit', ['b:battery{V=12}', 'r1:resistor{R=1k}', 'r2:resistor{R=2.2k}'], ['b.positive-r1.a', 'r1.b-r2.a', 'r2.b-b.negative'])
make('parallel-two-r', 'circuit', ['b:battery{V=6}', 'r1:resistor{R=100}', 'r2:resistor{R=220}'], ['b.positive-r1.a', 'r1.b-b.negative', 'b.positive-r2.a', 'r2.b-b.negative'])
make('divider', 'circuit', ['b:battery{V=10}', 'r1:resistor{R=10k}', 'r2:resistor{R=10k}', 'v:voltmeter'], ['b.positive-r1.a', 'r1.b-r2.a', 'r2.b-b.negative', 'v.a-r2.a', 'v.b-r2.b'])
make('rc-charge', 'circuit', ['b:battery{V=5}', 'r:resistor{R=1k}', 'c:capacitor{C=100u}'], ['b.positive-r.a', 'r.b-c.positive', 'c.negative-b.negative'])
make('rl-circuit', 'circuit', ['b:battery{V=5}', 'r:resistor{R=100}', 'l:inductor{L=10m}'], ['b.positive-r.a', 'r.b-l.a', 'l.b-b.negative'])
make('rlc-series', 'circuit', ['s:ac-source{V=10,f=50}', 'r:resistor{R=47}', 'l:inductor{L=100m}', 'c:capacitor{C=100u}'], ['s.positive-r.a', 'r.b-l.a', 'l.b-c.positive', 'c.negative-s.negative'])
make('led-limiter', 'circuit', ['b:battery{V=9}', 'r:resistor{R=470}', 'd:led'], ['b.positive-r.a', 'r.b-d.anode', 'd.cathode-b.negative'])
make('diode-forward', 'circuit', ['b:battery{V=5}', 'r:resistor{R=1k}', 'd:diode'], ['b.positive-d.anode', 'd.cathode-r.a', 'r.b-b.negative'])
make('half-wave-rectifier', 'circuit', ['s:ac-source{V=12,f=50}', 'd:diode', 'r:resistor{R=1k}'], ['s.positive-d.anode', 'd.cathode-r.a', 'r.b-s.negative'])
make('rectifier-filter', 'circuit', ['s:ac-source{V=12,f=50}', 'd:diode', 'c:capacitor{C=470u}', 'r:resistor{R=1k}'], ['s.positive-d.anode', 'd.cathode-c.positive', 'c.negative-s.negative', 'd.cathode-r.a', 'r.b-s.negative'])
make('zener-regulator', 'circuit', ['b:battery{V=12}', 'r:resistor{R=470}', 'z:zener', 'l:resistor{R=1k}'], ['b.positive-r.a', 'r.b-z.cathode', 'z.anode-b.negative', 'r.b-l.a', 'l.b-b.negative'])
make('bjt-switch', 'circuit', ['b:battery{V=9}', 'rb:resistor{R=10k}', 'q:bjt', 'l:bulb'], ['b.positive-l.a', 'l.b-q.collector', 'q.emitter-b.negative', 'b.positive-rb.a', 'rb.b-q.base'])
make('mosfet-switch', 'circuit', ['b:battery{V=9}', 'q:mosfet', 'l:bulb', 'v:battery{V=5}'], ['b.positive-l.a', 'l.b-q.drain', 'q.source-b.negative', 'v.positive-q.gate', 'v.negative-b.negative'])
make('opamp-follower', 'circuit', ['v:battery{V=2}', 'a:opamp'], ['v.positive-a.in+', 'a.in--a.out'])
make('opamp-inverting', 'circuit', ['v:battery{V=1}', 'r1:resistor{R=1k}', 'r2:resistor{R=10k}', 'a:opamp', 'g:gnd'], ['v.positive-r1.a', 'r1.b-a.in-', 'a.in--r2.a', 'r2.b-a.out', 'a.in+-g.terminal', 'v.negative-g.terminal'])
make('opamp-regulator', 'circuit', ['v:battery{V=3}', 'a:opamp', 'p:battery{V=12}', 'n:battery{V=12}'], ['v.positive-a.in+', 'a.in--a.out', 'p.positive-a.v+', 'n.negative-a.v-'])
make('switch-bulb', 'circuit', ['b:battery{V=9}', 's:switch', 'l:bulb'], ['b.positive-s.a', 's.b-l.a', 'l.b-b.negative'])
make('fuse-bulb', 'circuit', ['b:battery{V=9}', 'f:fuse', 'l:bulb'], ['b.positive-f.a', 'f.b-l.a', 'l.b-b.negative'])
make('ammeter-series', 'circuit', ['b:battery{V=9}', 'a:ammeter', 'r:resistor{R=220}'], ['b.positive-a.a', 'a.b-r.a', 'r.b-b.negative'])
make('potentiometer-divider', 'circuit', ['b:battery{V=9}', 'p:potentiometer{R=10k}', 'v:voltmeter'], ['b.positive-p.top', 'p.bottom-b.negative', 'v.a-p.wiper', 'v.b-p.bottom'])
make('transformer-load', 'circuit', ['s:ac-source{V=24,f=50}', 't:transformer', 'r:resistor{R=100}'], ['s.positive-t.p1', 's.negative-t.p2', 't.s1-r.a', 'r.b-t.s2'])
make('current-source-load', 'circuit', ['i:current-source{I=10m}', 'r:resistor{R=470}'], ['i.positive-r.a', 'r.b-i.negative'])
make('wheatstone', 'circuit', ['b:battery{V=10}', 'r1:resistor{R=1k}', 'r2:resistor{R=1k}', 'r3:resistor{R=2k}', 'r4:resistor{R=2k}', 'v:voltmeter'], ['b.positive-r1.a', 'b.positive-r3.a', 'r1.b-r2.a', 'r3.b-r4.a', 'r2.b-b.negative', 'r4.b-b.negative', 'v.a-r1.b', 'v.b-r3.b'])

// ── digital (8) ──
make('and-gate', 'digital', ['a:input', 'b:input', 'g:and-gate', 'y:output'], ['a.out-g.a', 'b.out-g.b', 'g.out-y.in'])
make('or-not', 'digital', ['a:input', 'b:input', 'g:or-gate', 'n:not-gate', 'y:output'], ['a.out-g.a', 'b.out-g.b', 'g.out-n.in', 'n.out-y.in'])
make('xor-gate', 'digital', ['a:input', 'b:input', 'g:xor-gate', 'y:output'], ['a.out-g.a', 'b.out-g.b', 'g.out-y.in'])
make('nand-gate', 'digital', ['a:input', 'b:input', 'g:nand-gate', 'y:output'], ['a.out-g.a', 'b.out-g.b', 'g.out-y.in'])
make('half-adder-gates', 'digital', ['a:input', 'b:input', 'x:xor-gate', 'n:and-gate', 's:output', 'c:output'], ['a.out-x.a', 'b.out-x.b', 'a.out-n.a', 'b.out-n.b', 'x.out-s.in', 'n.out-c.in'])
make('d-flip-flop', 'digital', ['d:input', 'k:clock', 'f:d-ff', 'q:output'], ['d.out-f.d', 'k.out-f.clk', 'f.q-q.in'])
make('toggle-ff', 'digital', ['k:clock', 'f:t-ff', 'q:output'], ['k.out-f.clk', 'f.q-q.in'])
make('counter', 'digital', ['k:clock', 'c:counter4', 'q:output'], ['k.out-c.clk', 'c.q0-q.in'])

// ── mechanics (6) ──
const M = (name, nodes, extra = []) => make(name, 'mechanics', nodes, [], extra)
M('block-on-ground', ['g:ground', 'b:block{mass=2}'])
M('spring-mass', ['w:ground', 'm:mass{mass=2}'], [['spring', 'w-m']])
M('pendulum', ['h:hinge', 'm:mass{mass=1}'], [['rod', 'h-m']])
M('rope-block', ['w:ground', 'b:block{mass=3}'], [['rope', 'w-b']])
M('damped-spring', ['w:ground', 'm:mass{mass=2}'], [['spring', 'w-m'], ['damper', 'w-m']])
M('charge-in-field', ['e:efield', 'q:charge{q=2}'])

// ── optics (2) ──
make('lens-image', 'optics', ['s:light-source', 'l:thin-lens{f=150}', 'sc:optical-screen'], [])
make('mirror-source', 'optics', ['s:light-source', 'm:optical-mirror'], [])
