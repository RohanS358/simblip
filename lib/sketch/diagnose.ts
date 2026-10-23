// Why a drawn circuit would not work, from its connections alone (no simulation, no recogniser).
//
// A tutor asked "why does the LED not light?" needs more than "it is open": which part is in backwards,
// which terminal is joined to nothing, whether the LED would be burnt out. This walks the circuit the way a
// student is taught to: follow the current from the battery's + terminal round to its − terminal.
//
//   • wires join pins into nets (the nets are what the reading's edges say; a person's corrections count);
//   • current can pass through a resistor, bulb, inductor, closed switch or ammeter either way, through a
//     diode / LED only from anode to cathode, and not through a capacitor or a voltmeter (DC);
//   • parts the walk does not understand (gates, transistors, op-amps) make the analysis say so instead of guess.
//
// Pure: Scene IR in, findings out. Unit-tested on hand-written circuits (lib/sketch/diagnose.test.mjs).

import type { SketchIRType } from './ir'

export type FindingKind = 'no-source' | 'open' | 'backwards' | 'short' | 'no-resistor' | 'blocked' | 'floating' | 'unsupported'

export interface Finding {
  kind: FindingKind
  /** One sentence a tutor can say. */
  message: string
  /** IR node ids the finding is about. */
  parts: string[]
}

const SOURCES = new Set(['battery', 'ac-source'])
/** Pass current both ways at DC. */
const CONDUCTORS = new Set(['resistor', 'bulb', 'inductor', 'switch', 'ammeter'])
/** Pass current one way: anode to cathode. */
const DIODES = new Set(['diode', 'led'])
/** Do not pass DC. */
const BLOCKERS = new Set(['capacitor', 'voltmeter'])
const LOADS = new Set(['resistor', 'bulb', 'led', 'diode'])
const RESISTIVE = new Set(['resistor', 'bulb'])
/** Parts this walk understands; anything else makes the answer partial. */
const KNOWN = new Set([...SOURCES, ...CONDUCTORS, ...DIODES, ...BLOCKERS, 'gnd'])

const label = (ir: SketchIRType, id: string): string => {
  const same = ir.nodes.filter((n) => n.cls === ir.nodes.find((m) => m.id === id)?.cls)
  const cls = (ir.nodes.find((n) => n.id === id)?.cls ?? id).replace(/-/g, ' ')
  return same.length > 1 ? `${cls} ${same.findIndex((n) => n.id === id) + 1}` : cls
}

class Dsu {
  private p = new Map<string, string>()
  find(x: string): string {
    if (!this.p.has(x)) this.p.set(x, x)
    let r = x
    while (this.p.get(r) !== r) r = this.p.get(r)!
    this.p.set(x, r)
    return r
  }
  union(a: string, b: string): void {
    this.p.set(this.find(a), this.find(b))
  }
}

interface Arc {
  from: string
  to: string
  part: string
  cls: string
}

export function diagnoseCircuit(ir: SketchIRType): Finding[] {
  const out: Finding[] = []
  const nodes = ir.nodes
  if (nodes.length === 0) return out

  const unsupported = nodes.filter((n) => !KNOWN.has(n.cls))
  const pinKey = (node: string, pin: string) => `${node}.${pin}`
  const dsu = new Dsu()
  for (const e of ir.edges) dsu.union(pinKey(e.a.node, e.a.pin), pinKey(e.b.node, e.b.pin))
  const net = (node: string, pin: string) => dsu.find(pinKey(node, pin))

  // which pins touch a wire at all
  const wired = new Set<string>()
  for (const e of ir.edges) {
    wired.add(pinKey(e.a.node, e.a.pin))
    wired.add(pinKey(e.b.node, e.b.pin))
  }
  const pinsOf = (cls: string): string[] =>
    SOURCES.has(cls) ? (cls === 'battery' ? ['positive', 'negative'] : ['a', 'b']) : DIODES.has(cls) ? ['anode', 'cathode'] : cls === 'gnd' ? ['a'] : ['a', 'b']

  if (!nodes.some((n) => SOURCES.has(n.cls))) {
    out.push({ kind: 'no-source', message: 'There is no battery or other source in the drawing, so nothing pushes current round the loop.', parts: [] })
  }

  // terminals joined to nothing
  const floating = nodes.flatMap((n) =>
    KNOWN.has(n.cls) && n.cls !== 'gnd' ? pinsOf(n.cls).filter((p) => !wired.has(pinKey(n.id, p))).map((p) => ({ n, p })) : []
  )
  for (const n of new Set(floating.map((f) => f.n))) {
    const pins = floating.filter((f) => f.n === n).map((f) => f.p)
    out.push({
      kind: 'floating',
      message: `The ${label(ir, n.id)} has ${pins.length === 1 ? 'a terminal' : 'terminals'} (${pins.join(', ')}) joined to nothing, so current cannot pass through it. Is a wire missing?`,
      parts: [n.id],
    })
  }

  // the walk
  const arcs: Arc[] = []
  for (const n of nodes) {
    if (CONDUCTORS.has(n.cls)) {
      const a = net(n.id, 'a')
      const b = net(n.id, 'b')
      arcs.push({ from: a, to: b, part: n.id, cls: n.cls }, { from: b, to: a, part: n.id, cls: n.cls })
    } else if (DIODES.has(n.cls)) {
      arcs.push({ from: net(n.id, 'anode'), to: net(n.id, 'cathode'), part: n.id, cls: n.cls })
    }
  }
  for (const src of nodes.filter((n) => n.cls === 'battery' || n.cls === 'ac-source')) {
    const pos = net(src.id, src.cls === 'battery' ? 'positive' : 'a')
    const neg = net(src.id, src.cls === 'battery' ? 'negative' : 'b')
    if (pos === neg) {
      out.push({ kind: 'short', message: `The ${label(ir, src.id)}'s two terminals are joined directly by wire: that is a short circuit.`, parts: [src.id] })
      continue
    }
    // states: (net, passedLed, hasResistance, hasLoad)
    const seen = new Set<string>()
    const stack: Array<{ n: string; led: boolean; r: boolean; load: boolean; via: string[] }> = [{ n: pos, led: false, r: false, load: false, via: [] }]
    let closed = false
    let shorted = false
    let ledNoR: string[] | null = null
    while (stack.length) {
      const s = stack.pop()!
      const key = `${s.n}|${+s.led}${+s.r}${+s.load}`
      if (seen.has(key)) continue
      seen.add(key)
      if (s.n === neg && s.via.length > 0) {
        closed = true
        if (!s.load) shorted = true
        if (s.led && !s.r && !ledNoR) ledNoR = s.via
        continue
      }
      for (const a of arcs) {
        if (a.from !== s.n) continue
        const node = nodes.find((x) => x.id === a.part)!
        stack.push({
          n: a.to,
          led: s.led || DIODES.has(node.cls),
          r: s.r || RESISTIVE.has(node.cls),
          load: s.load || LOADS.has(node.cls),
          via: s.via.includes(a.part) ? s.via : [...s.via, a.part],
        })
      }
    }
    if (closed && shorted) {
      out.push({ kind: 'short', message: `Current can go from the ${label(ir, src.id)}'s + terminal to its − terminal without passing through anything that uses it (only wire, a switch or an ammeter): a short circuit.`, parts: [src.id] })
    }
    if (closed && ledNoR) {
      const led = ledNoR.find((id) => DIODES.has(nodes.find((n) => n.id === id)?.cls ?? '')) ?? ledNoR[0]
      out.push({ kind: 'no-resistor', message: `The ${label(ir, led)} sits across the ${label(ir, src.id)} with no resistor in series to limit its current; a real ${nodes.find((n) => n.id === led)?.cls === 'led' ? 'LED' : 'diode'} would burn out.`, parts: [led] })
    }
    if (!closed) {
      // would reversing a diode / LED close the loop? Walk again with every diode conducting both ways.
      const both = [...arcs, ...arcs.filter((a) => DIODES.has(a.cls)).map((a) => ({ ...a, from: a.to, to: a.from }))]
      const reach = new Set<string>([pos])
      const viaDiode = new Map<string, Set<string>>()
      viaDiode.set(pos, new Set())
      const queue = [pos]
      while (queue.length) {
        const cur = queue.shift()!
        for (const a of both) {
          if (a.from !== cur) continue
          const rev = DIODES.has(a.cls) && !arcs.some((x) => x.part === a.part && x.from === a.from && x.to === a.to)
          const used = new Set(viaDiode.get(cur))
          if (rev) used.add(a.part)
          const prev = viaDiode.get(a.to)
          if (!reach.has(a.to) || (prev && used.size < prev.size)) {
            reach.add(a.to)
            viaDiode.set(a.to, used)
            queue.push(a.to)
          }
        }
      }
      if (reach.has(neg) && (viaDiode.get(neg)?.size ?? 0) > 0) {
        const wrong = [...(viaDiode.get(neg) ?? [])]
        out.push({
          kind: 'backwards',
          message: `The ${wrong.map((id) => label(ir, id)).join(' and ')} ${wrong.length === 1 ? 'is' : 'are'} in backwards: current can only pass a diode from its anode to its cathode, and here it would have to go the other way. Turn ${wrong.length === 1 ? 'it' : 'them'} round.`,
          parts: wrong,
        })
      } else if (floating.length === 0) {
        const blockers = nodes.filter((n) => BLOCKERS.has(n.cls))
        if (blockers.length > 0) {
          out.push({
            kind: 'blocked',
            message: `Direct current cannot pass the ${blockers.map((b) => label(ir, b.id)).join(' or ')} (a capacitor blocks it; a voltmeter in series passes almost none), so the loop is not complete.`,
            parts: blockers.map((b) => b.id),
          })
        } else {
          out.push({ kind: 'open', message: `There is no complete path from the ${label(ir, src.id)}'s + terminal round to its − terminal: the loop is broken somewhere.`, parts: [src.id] })
        }
      } else if (!out.some((f) => f.kind === 'floating')) {
        out.push({ kind: 'open', message: `There is no complete path from the ${label(ir, src.id)}'s + terminal round to its − terminal: the loop is broken somewhere.`, parts: [src.id] })
      }
    }
  }
  if (unsupported.length > 0) {
    out.push({
      kind: 'unsupported',
      message: `I did not trace through the ${[...new Set(unsupported.map((n) => n.cls.replace(/-/g, ' ')))].join(', ')} (I only follow batteries, resistors, bulbs, diodes, LEDs, switches, inductors and meters), so this check may be incomplete.`,
      parts: unsupported.map((n) => n.id),
    })
  }
  return out
}
