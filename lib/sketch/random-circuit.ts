// Random but sensible wave-1 circuits, as Scene IR — the ground truth for the
// whole-circuit synthetic test set (scene-synth.ts draws them, the extractor
// reads the drawing back, and the two netlists are compared).
//
// Every circuit is a topology a student actually draws (series loop, parallel
// bank, divider with a meter, rectifier, transistor switch, inverting op-amp…)
// with parts and values drawn from realistic pools. Gates are left out: a gate
// network needs input/output parts that are not wave-1 symbols.

import type { Rng } from './rng'
import type { SketchIRType } from './ir'

type Pin = string // "node.pin"

const POOL = ['resistor', 'bulb', 'led', 'diode', 'inductor', 'capacitor', 'switch'] as const
const R_VALUES = ['100', '220', '470', '1k', '2.2k', '4.7k', '10k', '47k']

class Builder {
  nodes: SketchIRType['nodes'] = []
  edges: SketchIRType['edges'] = []
  private count = 0
  private rng: Rng
  constructor(rng: Rng) {
    this.rng = rng
  }

  part(cls: string, values?: Record<string, string>): string {
    const id = `n${++this.count}`
    this.nodes.push({ id, cls, conf: 1, bbox: [0, 0, 60, 30], rot: 0, source: 'ink', ...(values ? { values } : {}) })
    return id
  }

  wire(a: Pin, b: Pin) {
    const p = (s: string) => ({ node: s.slice(0, s.indexOf('.')), pin: s.slice(s.indexOf('.') + 1) })
    this.edges.push({ a: p(a), b: p(b), kind: 'wire', conf: 1 })
  }

  /** A random load part, with a realistic value where it has one. */
  load(): { id: string; in: Pin; out: Pin } {
    const cls = this.rng.pick(POOL)
    const id = this.part(cls, this.valuesFor(cls))
    const diode = cls === 'led' || cls === 'diode'
    // A diode is usually drawn forward; sometimes the lesson is that it is not.
    const reversed = diode && this.rng.chance(0.2)
    const [a, b] = diode ? ['anode', 'cathode'] : ['a', 'b']
    return reversed ? { id, in: `${id}.${b}`, out: `${id}.${a}` } : { id, in: `${id}.${a}`, out: `${id}.${b}` }
  }

  valuesFor(cls: string): Record<string, string> | undefined {
    const r = this.rng
    switch (cls) {
      case 'resistor': return { R: r.pick(R_VALUES) }
      case 'bulb': return { R: r.pick(['10', '20', '47']) }
      case 'capacitor': return { C: r.pick(['100n', '1u', '10u', '100u']) }
      case 'inductor': return { L: r.pick(['1m', '10m', '100m']) }
      case 'battery': return { V: r.pick(['3', '5', '9', '12']) }
      case 'ac-source': return { V: r.pick(['5', '12']), f: r.pick(['50', '60', '100']) }
      default: return undefined
    }
  }

  done(): SketchIRType {
    return { domain: 'circuit', nodes: this.nodes, edges: this.edges, labels: [], doubts: [] }
  }
}

export type Topology =
  | 'series' | 'parallel' | 'series-parallel' | 'divider' | 'rectifier' | 'bjt-switch' | 'inverting-opamp' | 'meters'

export const TOPOLOGIES: readonly Topology[] = [
  'series', 'parallel', 'series-parallel', 'divider', 'rectifier', 'bjt-switch', 'inverting-opamp', 'meters',
]

export function randomCircuit(rng: Rng, topology: Topology = rng.pick(TOPOLOGIES)): SketchIRType {
  const b = new Builder(rng)
  const bat = () => b.part('battery', b.valuesFor('battery'))

  if (topology === 'series') {
    const s = bat()
    const loads = Array.from({ length: rng.int(1, 4) }, () => b.load())
    b.wire(`${s}.positive`, loads[0].in)
    for (let i = 1; i < loads.length; i++) b.wire(loads[i - 1].out, loads[i].in)
    b.wire(loads[loads.length - 1].out, `${s}.negative`)
  } else if (topology === 'parallel') {
    const s = bat()
    for (let i = 0; i < rng.int(2, 3); i++) {
      const l1 = b.load()
      b.wire(`${s}.positive`, l1.in)
      if (rng.chance(0.4)) {
        const l2 = b.load()
        b.wire(l1.out, l2.in)
        b.wire(l2.out, `${s}.negative`)
      } else b.wire(l1.out, `${s}.negative`)
    }
  } else if (topology === 'series-parallel') {
    const s = bat()
    const r1 = b.load()
    const a = b.load()
    const c = b.load()
    b.wire(`${s}.positive`, r1.in)
    b.wire(r1.out, a.in)
    b.wire(r1.out, c.in)
    b.wire(a.out, `${s}.negative`)
    b.wire(c.out, `${s}.negative`)
  } else if (topology === 'divider') {
    const s = bat()
    const r1 = b.part('resistor', { R: rng.pick(R_VALUES) })
    const r2 = b.part('resistor', { R: rng.pick(R_VALUES) })
    const vm = b.part('voltmeter')
    const g = b.part('gnd')
    b.wire(`${s}.positive`, `${r1}.a`)
    b.wire(`${r1}.b`, `${r2}.a`)
    b.wire(`${r2}.b`, `${s}.negative`)
    b.wire(`${g}.terminal`, `${s}.negative`)
    b.wire(`${vm}.a`, `${r2}.a`)
    b.wire(`${vm}.b`, `${r2}.b`)
  } else if (topology === 'rectifier') {
    const ac = b.part('ac-source', b.valuesFor('ac-source'))
    const d = b.part('diode')
    const r = b.part('resistor', { R: rng.pick(R_VALUES) })
    b.wire(`${ac}.positive`, `${d}.anode`)
    b.wire(`${d}.cathode`, `${r}.a`)
    b.wire(`${r}.b`, `${ac}.negative`)
    if (rng.chance(0.5)) {
      const c = b.part('capacitor', b.valuesFor('capacitor'))
      b.wire(`${d}.cathode`, `${c}.a`)
      b.wire(`${c}.b`, `${ac}.negative`)
    }
  } else if (topology === 'bjt-switch') {
    const s = bat()
    const rb = b.part('resistor', { R: rng.pick(['4.7k', '10k', '47k']) })
    const rc = b.part('resistor', { R: rng.pick(['220', '470', '1k']) })
    const q = b.part('bjt')
    b.wire(`${s}.positive`, `${rb}.a`)
    b.wire(`${rb}.b`, `${q}.base`)
    b.wire(`${s}.positive`, `${rc}.a`)
    b.wire(`${rc}.b`, `${q}.collector`)
    b.wire(`${q}.emitter`, `${s}.negative`)
  } else if (topology === 'inverting-opamp') {
    const s = bat()
    const rin = b.part('resistor', { R: rng.pick(['1k', '2.2k']) })
    const rf = b.part('resistor', { R: rng.pick(['10k', '22k']) })
    const op = b.part('opamp')
    const g = b.part('gnd')
    b.wire(`${s}.positive`, `${rin}.a`)
    b.wire(`${rin}.b`, `${op}.in-`)
    b.wire(`${rf}.a`, `${op}.in-`)
    b.wire(`${rf}.b`, `${op}.out`)
    b.wire(`${op}.in+`, `${g}.terminal`)
    b.wire(`${s}.negative`, `${g}.terminal`)
  } else {
    const s = bat()
    const r = b.part('resistor', { R: rng.pick(R_VALUES) })
    const am = b.part('ammeter')
    const vm = b.part('voltmeter')
    b.wire(`${s}.positive`, `${r}.a`)
    b.wire(`${r}.b`, `${am}.a`)
    b.wire(`${am}.b`, `${s}.negative`)
    b.wire(`${vm}.a`, `${r}.a`)
    b.wire(`${vm}.b`, `${r}.b`)
  }
  return b.done()
}
